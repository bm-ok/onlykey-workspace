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

    //---- THE WIRE, WHICH IS WHETHER THIS PAGE CAN REACH ITS OWN SERVER ------
    //
    //THERE WERE TWO OF THESE. Alongside it, `up` reported a second socket — the
    //one ./server.js held to the dashboard this app was ported FROM — and the
    //two were reported as one boolean, so the dot in the corner had two states
    //for three facts. The ordinary state of a port in progress, this app healthy
    //and the old one deliberately stopped, drew the same red as this app being
    //dead. Both the second socket and that confusion are gone.
    var wire = !!(io && io.connected);
    var wireListeners = [];

    function announceWire(v) {
        if (wire === !!v) return;
        wire = !!v;
        wireListeners.forEach(function (fn) { fn(wire); });
    }

    //THE WIRE ITSELF, AND IT HAS ALREADY COST AN HOUR. The window sat there
    //fully painted, dot green, while every call from outside answered "no page
    //is connected" — and because the panes here fetch once rather than poll,
    //nothing on the screen went stale to give it away. A green dot has to mean
    //the wire is open, or it is worse than no dot at all.
    io.on('disconnect', function () { announceWire(false); });
    io.on('connect', function () { announceWire(true); });

    //---- WHETHER THIS WINDOW IS BEING DRIVEN FROM OUTSIDE -----------------
    //
    //`windowClick` and `windowFill` exist so the window can be tested from the
    //command line — it was the one half of this app with no way in, so every
    //fault in a click handler was found by a person clicking it. A driven press
    //reaches exactly the handlers a real press reaches, which is the point: a
    //test that took a different path would not be testing the button.
    //
    //AND THAT IS ALSO THE HAZARD. The window is where a person is assumed to be.
    //Approving is refused over the wire precisely because a model may write one
    //and may not ratify its own. A driven press is not refused outright —
    //testing the approve button means being able to press it — but it must not
    //be able to CLAIM to be a person, because "somebody read this and approved
    //it" is the whole of what that record asserts.
    //
    //So it is marked, and the mark travels with every call the press causes.
    //
    //CLEARED BY A REAL HUMAN TOUCH, NOT BY A TIMER. A press sets off work that
    //finishes whenever it finishes — a dialog opened now and confirmed in a
    //minute is one act — so there is no duration that is right. What is
    //unambiguous is somebody putting their hand on the window: `isTrusted` is
    //set by the browser and cannot be forged from script, so the first genuine
    //mousedown or keypress says a person is here again.
    //
    //IT STAYS SET UNTIL THEN, WHICH IS THE SAFE WAY ROUND. The worst that does
    //is describe a person's action as driven; the alternative is describing a
    //model's action as a person's.
    //
    //AND IT IS READABLE, which is not decoration. Without it the only way to
    //find out whether the window thought it was being driven was to watch what
    //an approval did — and over there that is how a stuck flag went unnoticed
    //for an evening.
    var drivenFromTheWire = false;

    if (typeof document != 'undefined' && document.addEventListener) {
        ['mousedown', 'keydown', 'wheel'].forEach(function (kind) {
            document.addEventListener(kind, function (e) {
                if (e && e.isTrusted) drivenFromTheWire = false;
            }, true);
        });
    }

    function call(action, args) {
        //THE MARK RIDES WITH THE CALL rather than being asked for at the far
        //end: by the time the action runs, the press that caused it is over.
        var sending = drivenFromTheWire
            ? Object.assign({}, args || {}, { _driven: true })
            : (args || {});

        return new Promise(function (resolve, reject) {
            io.emit('okc:call', { action: action, args: sending }, function (reply) {
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

        //SET BY ../drive AROUND A DRIVEN PRESS, and read by anything that needs
        //to say whether this window currently believes a person is at it.
        driving: function (on) { drivenFromTheWire = !!on; },
        get driven() { return drivenFromTheWire; },
        //WHETHER THIS APP'S OWN WIRE IS OPEN, which is the question that means
        //something is wrong HERE rather than anywhere else.
        get wire() { return wire; },
        //SUBSCRIBED RATHER THAN POLLED, and called back straight away so a
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
