var crypto = require('node:crypto');

//---------------------------------------------------------------------------
//who is watching what, and whether the answer has actually changed.
//
//THE WINDOW POLLED, AND EVERY PANE POLLED SEPARATELY. Forty `setInterval`s in
//the page, each asking the server the same way a person would, each getting back
//the same answer as last time and handing it to React to re-render. With every
//tab open that is nearly three hundred calls a minute to say nothing happened.
//
//THE TIMER MOVES TO THE SERVER AND THE WIRE GOES QUIET. A pane says what it
//wants and how often it would like to know; the server asks on that cadence, and
//sends something back ONLY when the answer is not the one the pane already has.
//A tab sitting open on an unchanging board costs nothing across the socket at
//all.
//
//---- why this is a file with no socket and no clock in it -----------------
//
//BECAUSE THE INTERESTING PART IS THE BOOKKEEPING, and bookkeeping tested through
//a socket and a real timer is bookkeeping tested slowly and flakily. What is
//here decides WHICH watches are due, WHETHER an answer differs, and what happens
//to a socket's watches when it goes away. ./server.js owns the one interval and
//the emitting.
//
//---- what it has to get right --------------------------------------------
//
//A SLOW ANSWER MUST NOT PILE UP. An action taking three seconds on a two-second
//cadence would otherwise be dispatched again while the first is still out, and
//then again, until the queue is the app. A watch that is out is not due.
//
//A SOCKET THAT GOES AWAY TAKES ITS WATCHES WITH IT. The page reloads on every
//hot update in this app, so sockets come and go constantly; a registry that
//leaked them would have the server polling on behalf of pages that closed hours
//ago, and nothing on screen would ever say so.
//
//THE SAME PANE ASKING TWICE IS ONE WATCH. React mounts, effects re-run, and a
//pane that changed one argument should not leave the old watch running.
//
//AND A FAILURE IS NOT AN ANSWER. If the action throws, the last good hash stays
//— so the recovery, when it comes, is seen as a change and sent. Recording the
//failure as the new state would mean the pane never hears that it recovered.
//---------------------------------------------------------------------------

//THE FASTEST ANYTHING MAY BE WATCHED. A pane asking for fifty milliseconds is a
//pane that has mistaken a watch for an animation, and the cost lands on the
//server rather than on the page that asked — which is exactly the kind of thing
//that has to be refused where it is cheap to refuse.
var FLOOR = 1000;

//AND THE SLOWEST USEFUL DEFAULT, for a caller that asks to be watched without
//saying how often.
var USUAL = 5000;

function hashOf(value) {
    //`undefined` IS NOT `null` IS NOT MISSING, and JSON.stringify collapses the
    //first to nothing at all — so it is spelled out rather than hashed as an
    //empty string, which is what a failed action would otherwise look like.
    if (value === undefined) return 'undefined';
    var text;
    try { text = JSON.stringify(value); }
    catch (e) {
        //A CYCLE, OR SOMETHING THAT WILL NOT SERIALISE. It could not have crossed
        //the socket either, so this is not the place to complain about it — but
        //it must never hash equal to the last one, or a pane would stop being
        //told about a thing this cannot describe.
        return 'unhashable-' + crypto.randomUUID();
    }
    if (text === undefined) return 'undefined';
    return crypto.createHash('sha1').update(text).digest('base64');
}

module.exports = function Watching(opts) {
    var o = opts || {};
    var floor = o.floor == null ? FLOOR : o.floor;
    var usual = o.usual == null ? USUAL : o.usual;

    //KEYED BY SOCKET AND BY THE PANE'S OWN ID TOGETHER. Two windows open on the
    //same board want the same watch and must each get their own answer, and a
    //page cannot be trusted to invent an id nobody else picked.
    var all = new Map();

    function keyOf(who, id) { return JSON.stringify([String(who), String(id)]); }

    function add(who, it) {
        var w = it || {};
        if (!w.action) throw new Error('a watch is of an action, and none was named');
        if (w.id == null) throw new Error('a watch needs an id of the asker\'s own, so it can be taken off again');

        var every = Number(w.everyMs);
        if (!(every > 0)) every = usual;
        //RAISED RATHER THAN REFUSED. A pane asking too often is asking for
        //something reasonable too eagerly, and dropping the watch would leave it
        //with no data at all — which is a worse answer than a slower one.
        if (every < floor) every = floor;

        var key = keyOf(who, w.id);
        var was = all.get(key);

        var watch = {
            key: key,
            who: who,
            id: w.id,
            action: String(w.action),
            args: w.args || {},
            everyMs: every,
            //DUE IMMEDIATELY IS WRONG HERE. The pane has just read the answer
            //itself — that is what it is watching FROM — so the first check
            //belongs one cadence away. Starting at zero means every mount costs
            //an extra call for an answer the page already has.
            at: (o.now ? o.now() : Date.now()),
            //WHAT THE ASKER ALREADY HAS. Handed in, when the pane knows it, so
            //the first check can be silent — otherwise the first tick always
            //looks like a change and every pane gets one pointless update.
            hash: w.hash == null ? null : String(w.hash),
            out: false,
            sent: 0,
            checks: 0
        };

        //SAME PANE, SAME ID, DIFFERENT QUESTION. The old one goes, and its hash
        //goes with it: it is the fingerprint of a different question's answer.
        if (was) all.delete(key);
        all.set(key, watch);
        return watch;
    }

    function drop(who, id) { return all.delete(keyOf(who, id)); }

    function dropAll(who) {
        var gone = 0;
        all.forEach(function (w, key) {
            if (w.who === who) { all.delete(key); gone++; }
        });
        return gone;
    }

    //WHAT IS DUE, AND NOTHING THAT IS ALREADY OUT. See the header: a three-second
    //action on a two-second cadence would otherwise be dispatched for ever.
    function due(now) {
        var when = now == null ? (o.now ? o.now() : Date.now()) : now;
        var ready = [];
        all.forEach(function (w) {
            if (w.out) return;
            if (when - w.at >= w.everyMs) ready.push(w);
        });
        return ready;
    }

    function started(w, now) {
        var it = all.get(w.key);
        if (!it) return false;
        it.out = true;
        it.at = now == null ? (o.now ? o.now() : Date.now()) : now;
        return true;
    }

    //THE ANSWER CAME BACK. Says whether it is worth sending, which is the whole
    //reason any of this exists.
    function answered(w, answer, now) {
        var it = all.get(w.key);
        //THE PANE WENT AWAY WHILE ITS ANSWER WAS IN FLIGHT, which is ordinary:
        //somebody changed tab. Nothing to record and nobody to send it to.
        if (!it) return { changed: false, gone: true };

        it.out = false;
        it.checks++;
        if (now != null) it.at = now;

        var next = hashOf(answer);
        var same = it.hash === next;
        it.hash = next;
        if (!same) it.sent++;
        return { changed: !same, gone: false };
    }

    //AND A FAILURE LEAVES THE LAST GOOD FINGERPRINT ALONE, so that when the
    //action starts working again the pane is told. Recording the failure as the
    //new state would make the recovery look like more of the same.
    function failed(w, now) {
        var it = all.get(w.key);
        if (!it) return { gone: true };
        it.out = false;
        it.checks++;
        if (now != null) it.at = now;
        return { gone: false };
    }

    return {
        add: add,
        drop: drop,
        dropAll: dropAll,
        due: due,
        started: started,
        answered: answered,
        failed: failed,
        count: function () { return all.size; },
        hashOf: hashOf,
        about: function () {
            var rows = [];
            all.forEach(function (w) {
                rows.push({
                    who: w.who, id: w.id, action: w.action, everyMs: w.everyMs,
                    checks: w.checks,
                    //COUNTED SEPARATELY BECAUSE THE GAP BETWEEN THEM IS THE POINT.
                    //Nine hundred checks and four sends is this working; nine
                    //hundred and nine hundred is a watch on something that is
                    //never the same twice, which is worth finding.
                    sent: w.sent
                });
            });
            return rows;
        }
    };
};
