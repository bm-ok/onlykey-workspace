//---------------------------------------------------------------------------
//one live log, tagged, that everything writes into.
//
//THE FIRST OF THE DASHBOARD'S OWN LOGIC TO LIVE HERE. Everything under
//../../../app that answers a question still asks the dashboard for it, over the
//relay in ../okc/server.js. This does not: the log is kept here, by this app,
//about what this app did. Every action module ported after this one writes into
//it, which is why it came first.
//
//Tags rather than levels or separate files, because the question a person
//actually asks is "what happened with the VM" or "what did git do", and that is
//a filter, not a place to go looking. Every line carries where it came from, so
//the log is one stream you narrow rather than several you correlate.
//
//IT IS IN MEMORY ON PURPOSE, AND THE REAL REASON IS CREDENTIALS. Command output
//goes through here — `out()` exists for exactly that — and command output during
//ordinary use carries sign-in URLs, tokens being placed, and whatever a worker
//printed. Writing this stream to a file would put all of it on disk, in
//cleartext, in a file nothing else in this app treats as a secret.
//
//So the cost is accepted, and it is a real cost: a restart loses the record of
//what somebody did. If a durable record is ever wanted it needs redaction at the
//boundary and a decision about where it lives — see `keeper` below, which is the
//one seam it may arrive through — not an append call added here.
//
//IN main.js AND NOT server.js, WHICH IS THE ONE THING THAT CHANGED IN THE MOVE.
//Over there the log died with the process, and this app's own development
//restarts it every few minutes; "who unmarked that group?" was unanswerable for
//exactly that reason. The node bundle is rebuilt on every save and main is not,
//so kept here the log now survives the saves — the same argument that already
//puts the window, the tray and the action table on this side.
//---------------------------------------------------------------------------

var MAX = 2000;

//A CREDENTIAL IS NEVER A LINE HERE, WHATEVER PRINTED IT.
//
//Not being written to disk was taken as enough once. It is not: the window draws
//this on the Live tab, `windowShot` photographs it, and `logSince` hands it to
//whoever asks at the command line. A worker credential went through all three,
//and every byte of an access token and a refresh token was sitting in the log I
//was reading.
//
//NARROW ON PURPOSE. A guest's output is full of commit hashes and base64, and
//scrubbing anything long and random would make this log useless for the thing it
//exists for. These two shapes cannot be anything else.
//
//AND IT IS THE SECOND LINE OF DEFENCE, not the first. What must not be in a log
//must not be sent to one. This is here because "must not" is a rule somebody has
//to be right about every single time.
var NEVER = [
    //Anthropic's own key shapes, which say what they are.
    [/\bsk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-<redacted>'],
    //The credential file's own fields, whether or not the value looks like a key.
    [/("(?:access|refresh)Token"\s*:\s*")[^"]+/gi, '$1<redacted>']
];

function noCredentials(text) {
    var out = String(text == null ? '' : text);
    NEVER.forEach(function (pair) { out = out.replace(pair[0], pair[1]); });
    return out;
}

plugin.consumes = [];
plugin.provides = ['log'];
async function plugin(imports, register) {
    var entries = [];
    var listeners = [];
    var seq = 0;

    //THE ONE PLACE ANYTHING FROM HERE MAY REACH DISK, and there is exactly one
    //slot rather than a list. A durable record is a decision about redaction and
    //about where it lives; a list of sinks would let the second one be added
    //without either question being asked again.
    var keep = null;

    function add(tags, text, level) {
        var entry = {
            id: ++seq,
            at: new Date().toISOString(),
            tags: tags.filter(Boolean).filter(function (t, i, all) { return all.indexOf(t) == i; }),
            level: level || 'info',
            text: noCredentials(String(text)).replace(/\s+$/, '')
        };
        entries.push(entry);
        if (entries.length > MAX) entries.splice(0, entries.length - MAX);

        try { if (keep) keep(entry); } catch (e) { /* the line is still live; only the note is lost */ }

        //A LISTENER THAT THROWS IS DROPPED, because the alternative is one bad
        //watcher taking down every write to the log for the rest of the process.
        listeners.slice().forEach(function (fn) {
            try { fn(entry); } catch (e) { listeners = listeners.filter(function (x) { return x !== fn; }); }
        });
        return entry;
    }

    //A logger with its tags already on it, so callers never have to remember to
    //tag consistently — untagged lines are the ones that make a filter useless.
    function on() {
        var tags = [].slice.call(arguments);
        function said(level) {
            return function (text) {
                return add(tags.concat([].slice.call(arguments, 1)), text, level);
            };
        }
        return {
            info: said('info'),
            good: said('good'),
            warn: said('warn'),
            bad: said('bad'),
            //Multi-line command output, split so each line is filterable alone.
            out: function (text) {
                var more = [].slice.call(arguments, 1);
                String(text).split('\n').filter(function (l) { return l.trim(); })
                    .forEach(function (l) { add(tags.concat(more), l, 'out'); });
            },
            on: function () { return on.apply(null, tags.concat([].slice.call(arguments))); }
        };
    }

    //EVERYTHING AFTER AN ID — UNLESS THAT ID IS FROM A LOG THAT NO LONGER EXISTS.
    //
    //Ids count from 1 and reset when this log does, because it is in memory and
    //is what is happening NOW. So a watcher that reconnects afterwards asks for
    //"everything after 412" of a log whose newest line is 3, and is answered with
    //nothing, for ever: connected, healthy, and never printing another line. That
    //is worse than dropping out, because it looks exactly like a quiet system.
    //
    //An id higher than anything here cannot be one of ours, so it is read as
    //"start again" rather than as a filter — which is the honest answer, since
    //this log did just begin.
    function since(id) {
        var from = Number(id || 0);
        var newest = entries.length ? entries[entries.length - 1].id : 0;
        if (from > newest) return entries.slice();
        return entries.filter(function (e) { return e.id > from; });
    }

    //Every tag currently in the log, with how many lines carry it. The window
    //builds its filters from this rather than from a hardcoded list, so a new tag
    //anywhere shows up as a filter without anything being registered.
    function tags() {
        var count = {};
        entries.forEach(function (e) {
            e.tags.forEach(function (t) { count[t] = (count[t] || 0) + 1; });
        });
        return Object.keys(count)
            .map(function (t) { return { tag: t, n: count[t] }; })
            .sort(function (a, b) { return b.n - a.n; });
    }

    await register(null, {
        log: {
            add: add,
            on: on,
            since: since,
            tags: tags,
            subscribe: function (fn) {
                listeners.push(fn);
                return function () { listeners = listeners.filter(function (x) { return x !== fn; }); };
            },
            clear: function () { entries.length = 0; },
            all: function () { return entries; },
            //Handed the durable record when there is one. See ../events.
            keeper: function (fn) {
                keep = fn;
                return function () { if (keep === fn) keep = null; };
            }
        }
    });
}
module.exports = plugin;
