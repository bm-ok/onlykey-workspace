var crypto = require('crypto');

//---------------------------------------------------------------------------
//WHO IS DIALLED IN, AND WHAT IT TOOK TO GET IN.
//
//THIS SIDE LISTENS; THE MACHINE DIALS IN. The inversion is the whole point: the
//ephemeral side is the wrong one to own the socket. A machine rebooting is then
//an ordinary client reconnecting, and this side keeps the log and the live view
//across it. The other way round, every reboot is an error to handle.
//
//NOTHING IS ACCEPTED BEFORE A VALID HELLO, so an unauthenticated socket can do
//exactly one thing: be closed.
//---------------------------------------------------------------------------

//HOW LONG A MACHINE MAY SAY NOTHING before it is assumed gone. The agent beats
//every twenty seconds, so this is three missed beats.
//
//TCP WILL NOT NOTICE FOR US. A machine killed mid-sentence leaves a socket on
//this side that looks perfectly healthy, forever.
var SILENT_TOO_LONG = 70000;

//THE SOCKET'S FAR END, NOT WHAT THE MACHINE SAYS ABOUT ITSELF.
//
//A machine lists every address it has, and once docker is installed that
//includes a bridge address that is real inside it and unreachable from here. A
//packet has already come back along this one.
function addressOf(from) {
    return String(from == null ? '' : from)
        .replace(/^::ffff:/, '')   //an IPv4 address arriving over a v6 socket
        .replace(/:\d+$/, '');     //the far end's port, which is nobody's address
}

//A TOKEN IS COMPARED IN CONSTANT TIME.
//
//`!==` leaks how much of a guess was right through how long the comparison took,
//and this compare is reachable by anything that can open a socket to this host —
//which is every machine on the network, not only ours. The length check first
//because timingSafeEqual throws on a mismatch, and a length is not the secret.
function sameToken(given, expected) {
    if (typeof given !== 'string' || typeof expected !== 'string') return false;
    if (given.length !== expected.length || !expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

module.exports = function roster(deps) {
    var d = deps || {};
    var say = d.say || function () { return { good: function () {}, warn: function () {}, info: function () {} }; };
    var now = d.now || function () { return Date.now(); };
    var stamp = d.stamp || function () { return new Date().toISOString(); };

    //WHAT TOKEN A MACHINE SHOULD HAVE. Handed in rather than read here, because
    //this file must not know about the registry — ../ours already knows about
    //the machines, and the other direction would be a cycle.
    var tokenFor = d.tokenFor || function () { return null; };

    //TOLD, RATHER THAN INFERRED. This is the only moment anything knows a
    //machine has finished being built.
    var onHello = d.onHello || null;

    //AND WHO NEEDS TO KNOW WHEN ONE GOES. A job waiting on a machine that has
    //gone will never be answered; without being told, it sits until its timeout,
    //so asking a destroyed machine to do something appears to HANG rather than
    //to fail.
    var onGone = d.onGone || function () {};

    var silentTooLong = d.silentTooLong || SILENT_TOO_LONG;

    var agents = {};   //vm name -> { since, from, facts, lastSeen, write, close }

    //---- getting in --------------------------------------------------------
    //
    //RETURNS WHAT HAPPENED rather than acting on the socket, so every rule below
    //can be checked without one.
    function hello(msg, socket) {
        var m = msg || {};
        var s = socket || {};

        if (m.type !== 'hello') return { fault: 'said something before hello' };

        var expected = tokenFor(m.vm);

        //AN UNKNOWN MACHINE HAS NO TOKEN, and the answer is the same as a wrong
        //one. Saying which would tell anything that can open a socket whether a
        //name is one of ours.
        if (!sameToken(m.token, expected)) {
            return { fault: 'claimed to be "' + m.vm + '" without the right token' };
        }

        var vm = m.vm;

        //A SECOND MACHINE CLAIMING THE SAME NAME REPLACES THE FIRST. Usually
        //this is the same machine reconnecting after a reboot, which is the
        //ordinary case rather than the exception.
        var had = agents[vm];
        if (had && had.write !== s.write) drop(vm, 'was replaced by a new connection');

        agents[vm] = {
            since: stamp(),
            from: s.from || null,
            facts: m.facts || {},
            lastSeen: now(),
            write: s.write || function () {},
            close: s.close || function () {}
        };

        say('vm', vm, 'channel').good(vm + ' dialled in from ' + addressOf(s.from));

        if (onHello) {
            try {
                onHello(vm, { address: addressOf(s.from), user: (m.facts || {}).user || null });
            } catch (e) {
                //NOT WORTH DROPPING A SESSION OVER, AND NOT WORTH SAYING NOTHING
                //ABOUT EITHER. This once swallowed silently, and what it
                //swallowed was a TypeError on the third line of the handler — so
                //for every machine older than its first boot, the rest of what
                //happens when one dials in simply did not happen, and no line
                //anywhere said so. It took adding something below it and
                //watching that not run.
                say('vm', vm, 'channel').warn('something went wrong handling its arrival: ' + e.message);
            }
        }

        return { vm: vm };
    }

    //---- staying in --------------------------------------------------------

    //ANYTHING AT ALL COUNTS AS A SIGN OF LIFE, not only a beat.
    function seen(vm) {
        var agent = agents[vm];
        if (agent) agent.lastSeen = now();
        return !!agent;
    }

    //A BEAT CARRIES THE FACTS THAT CHANGE.
    //
    //`desktop` HAS TO COME ON THE BEAT rather than only at hello, because it is
    //FALSE when a machine first connects and becomes true a minute or two later
    //— the agent starts as soon as the network works, well before anybody has a
    //graphical session. Recorded at hello only, it would say "no desktop" for
    //the rest of the machine's life.
    function beat(vm, msg) {
        var agent = agents[vm];
        if (!agent) return false;
        var m = msg || {};

        if (typeof m.desktop === 'boolean' && agent.facts.desktop !== m.desktop) {
            agent.facts.desktop = m.desktop;
            say('vm', vm, 'guest').info(m.desktop
                ? 'its desktop session is up'
                : 'its desktop session has gone');
        }

        //AND HOW MUCH OF ITSELF IT IS USING, which VirtualBox cannot answer: its
        //memory metrics come FROM the guest additions, so a machine built
        //without them — now every runner with no desktop — reports nothing on
        //the host side at all. The machine knows, and it is already talking to
        //us every twenty seconds.
        //
        //KEPT QUIETLY. This changes constantly and a log line per beat would
        //bury everything else. It is a fact to look at, not an event.
        if (typeof m.memoryUsedMB === 'number') {
            agent.facts.memoryUsedMB = m.memoryUsedMB;
            if (typeof m.memoryTotalMB === 'number') agent.facts.memoryTotalMB = m.memoryTotalMB;
        }

        //ANSWERED, BECAUSE A ONE-WAY HEARTBEAT PROVES NOTHING.
        //
        //The machine cannot tell a working connection from a severed one by
        //SENDING: the data sits in its kernel's buffer being retransmitted for
        //about fifteen minutes, and every send succeeds. What it can measure is
        //silence FROM HERE — so there has to be something to be silent. Without
        //this reply a machine that lost its network stayed stuck forever and
        //never redialled.
        try { agent.write({ type: 'beat' }); } catch (e) { /* it is going anyway */ }
        return true;
    }

    //A MACHINE THAT STOPS ANSWERING HAS TO BE NOTICED HERE, because TCP will
    //not do it: one killed mid-sentence leaves a socket that looks healthy.
    function sweep() {
        var at = now();
        var dropped = [];
        Object.keys(agents).forEach(function (name) {
            var quiet = at - agents[name].lastSeen;
            if (quiet > silentTooLong) {
                drop(name, 'has said nothing for ' + Math.round(quiet / 1000) + 's, so it is treated as gone');
                dropped.push(name);
            }
        });
        return dropped;
    }

    //---- going --------------------------------------------------------------
    //
    //EVERYTHING THAT ENDS A SESSION, IN ONE PLACE, so nothing is half-forgotten.
    function drop(name, why) {
        var agent = agents[name];
        if (!agent) return false;

        delete agents[name];
        try { agent.close(); } catch (e) { /* already gone */ }

        //TOLD BEFORE ANYTHING ELSE CAN ASK. Whoever is waiting on this machine
        //gets an answer instead of a timeout.
        try { onGone(name, why); } catch (e) { /* said below */ }

        say('vm', name, 'channel').warn(name + ' ' + why);
        return true;
    }

    function connected(name) { return Object.prototype.hasOwnProperty.call(agents, name); }

    function get(name) { return agents[name] || null; }

    //WHAT A CARD READS. Deliberately not the socket, and deliberately not the
    //token: this answer is drawn on screen and photographed by `capture`.
    function list() {
        return Object.keys(agents).map(function (name) {
            return {
                vm: name,
                since: agents[name].since,
                from: agents[name].from,
                facts: agents[name].facts
            };
        });
    }

    function all(why) {
        Object.keys(agents).forEach(function (name) { drop(name, why || 'this host is shutting down'); });
    }

    return {
        hello: hello, seen: seen, beat: beat, sweep: sweep, drop: drop,
        connected: connected, get: get, list: list, dropAll: all,
        SILENT_TOO_LONG: silentTooLong
    };
};

module.exports.addressOf = addressOf;
module.exports.sameToken = sameToken;
module.exports.SILENT_TOO_LONG = SILENT_TOO_LONG;
