//the window half of the okc plugin: one way to ask the running dashboard
//something. its node half, in ./server.js, holds the socket.
//
//NO UI HERE ON PURPOSE. This is the transport and nothing else, so a tab that
//wants data consumes `okc` and knows nothing about sockets, and this file can
//change how it reaches the dashboard without touching a single tab.
//
//ONE CALL, BY NAME. The dashboard's whole surface is a table of named actions —
//its own window, its CLI and its drills all reach it the same way — so there is
//one function here rather than a method per action. A per-action wrapper would
//be a second list to keep in step with a table that already exists.

var useAsk = require('./ask');

plugin.consumes = ['io'];
plugin.provides = ['okc'];
async function plugin(imports, register) {
    var io = imports.io;
    var up = false;
    var listeners = [];

    //---- TWO WIRES, AND THEY WERE ONE ANSWER --------------------------------
    //
    //`up` IS THE OTHER APP. ./server.js holds a local socket to the dashboard
    //being ported FROM, and `okc:up` reports that socket — it arrives here over
    //THIS app's socket.io, which is a different wire entirely.
    //
    //`wire` IS THIS ONE: whether the page can reach its own server at all.
    //
    //THEY WERE REPORTED AS ONE BOOLEAN and the dot in the corner had two states
    //for three facts, so the ordinary state of a port in progress — this app
    //perfectly healthy, the old one deliberately stopped — drew the same red as
    //this app being dead. Red that is correct most of the time is a dot nobody
    //looks at, which is the whole value of having one.
    var wire = !!(io && io.connected);
    var wireListeners = [];

    function announce(v) {
        up = !!v;
        listeners.forEach(function (fn) { fn(up); });
    }

    function announceWire(v) {
        if (wire === !!v) return;
        wire = !!v;
        wireListeners.forEach(function (fn) { fn(wire); });
    }

    io.on('okc:up', announce);

    //ASKED ONCE, BECAUSE THE ANNOUNCEMENT MAY ALREADY HAVE HAPPENED. The server
    //emits on connection; this plugin attaches its listener when the graph
    //reaches it, which is afterwards. Waiting to be told left the dot red over
    //a panel that was plainly working.
    io.emit('okc:up?', {}, announce);

    //AND THE WIRE ITSELF, because `okc:up` can only ever arrive from a server
    //that is still there. Driving the dot from that message alone means the one
    //event it cannot report is the one that matters: when the socket drops,
    //nothing is emitted, `up` stays true, and the dot stays green over a page
    //that can no longer ask anything.
    //
    //THIS HAS ALREADY COST AN HOUR. The window sat there fully painted, dot
    //green, while every call from outside answered "no page is connected" — and
    //because the panes here fetch once rather than poll, nothing on the screen
    //went stale to give it away. A green dot has to mean the wire is open, or it
    //is worse than no dot at all.
    //
    //AND `announce(false)` HERE IS NOT A GUESS — it is the honest answer. With
    //this wire down nothing can tell us about the other one, and "we do not
    //know" has to read as "no" for anything a person might act on.
    io.on('disconnect', function () { announceWire(false); announce(false); });
    io.on('connect', function () { announceWire(true); io.emit('okc:up?', {}, announce); });

    function call(action, args) {
        return new Promise(function (resolve, reject) {
            io.emit('okc:call', { action: action, args: args || {} }, function (reply) {
                if (reply && reply.ok) resolve(reply.result);
                else reject(new Error((reply && reply.error) || 'no answer from the dashboard'));
            });
        });
    }

    var api = {
        //THE SOCKET ITSELF, for the one caller that needs more than
        //`call`: the shell listens for navigation pushed from outside. Not
        //handed out casually — a tab that reached for this instead of
        //`call` would be talking to the wire rather than to the table.
        io: io,
        call: call,
        get connected() { return up; },
        //AND WHETHER THIS APP'S OWN WIRE IS OPEN, which is a different question
        //and is the one that means something is wrong here rather than there.
        get wire() { return wire; },
        //WHETHER THE DASHBOARD IS THERE IS EVERY TAB'S BUSINESS, and it
        //changes often — it is restarted whenever its own code is worked
        //on. Subscribing beats each tab polling for it.
        onUp: function (fn) {
            listeners.push(fn);
            fn(up);
            return function () { listeners = listeners.filter(function (x) { return x != fn; }); };
        },
        //THE SAME SHAPE FOR THE SAME REASON, and called back straight away so a
        //subscriber that mounts after the socket is already open is not left
        //holding the value this plugin was built with.
        onWire: function (fn) {
            wireListeners.push(fn);
            fn(wire);
            return function () { wireListeners = wireListeners.filter(function (x) { return x != fn; }); };
        }
    };

    //ASKING THE SAME QUESTION ON A CADENCE, ON THE SERVICE THAT ANSWERS IT.
    //
    //This was a file every tab reached across for — `require('../okc/ask')` in
    //thirty-one of them, each one spelling out how many folders deep the
    //reaching file happened to sit. Its first argument was always this object;
    //every caller wrote `useAsk(okc, ...)` with the `okc` it had already
    //declared. A function whose first parameter is its receiver is a method.
    //
    //IT WAS ALSO A DECLARED BOUNDARY BEING WALKED AROUND. ../shell/window.js
    //says it plainly — "a tab is a plugin with a declared boundary: it consumes
    //`okc` to ask the dashboard something and it cannot reach anything it did
    //not declare" — and thirty-one tabs declared `okc` and then reached past it
    //to a file inside it anyway.
    //
    //`./ask` is a sibling, so this survives the folder being moved. The
    //requires it replaces did not: every one of them counted levels.
    api.use = function (action, args, everyMs) { return useAsk(api, action, args, everyMs); };

    await register(null, { okc: api });
}
module.exports = plugin;
