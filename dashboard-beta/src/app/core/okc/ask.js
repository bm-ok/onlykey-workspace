var React = require('react');
var { useState, useEffect, useRef } = React;

//asking the dashboard the same question on a cadence, as a hook.
//
//SHARED BECAUSE EVERY TAB WANTS IT AND ALL OF THEM WANT IT THE SAME WAY. The
//old window has this shape written out per pane, and the differences between
//the copies are not decisions — they are drift.
//
//WHAT IT HAS TO GET RIGHT, and each of these is a fault the old one paid for:
//
//  it stops when the tab is not showing. An unmounted component's interval
//  keeps running otherwise, and the whole reason the shell mounts one tab at a
//  time is so a panel nobody is looking at asks nothing.
//
//  a late answer to a question asked before the last one does not overwrite a
//  newer one. Two reads in flight and the slower one landing second is a panel
//  that flickers backwards.
//
//  an error does not blank what is already there. "It could not be read" and
//  "there is nothing" are different sentences, and showing the second for the
//  first is how a person concludes their machines are gone.
//
//---- and it no longer holds a timer --------------------------------------
//
//IT POLLED, AND EVERY PANE POLLED SEPARATELY. Forty `setInterval`s in the page,
//each asking the server the same way a person would, each getting back the same
//answer as last time and handing it to React to re-render a board identical to
//the one already on screen. With every tab open that was nearly three hundred
//calls a minute to say that nothing had happened.
//
//NOW THE PANE SAYS WHAT IT WANTS AND IS TOLD WHEN IT CHANGES. The cadence is
//still the pane's — it is the same third argument, and no call site changed —
//but it is now a request rather than a timer: the server asks on that cadence
//and sends something back only when the answer differs from the one this pane
//already has. A tab open on an unchanging board costs nothing across the wire.
//
//THE FIRST READ IS STILL A READ. The pane draws immediately from `okc.call`
//rather than waiting a cadence to be told what it could have asked for — the
//watch is for what happens AFTER that.
//
//AND THE SERVER FORGETS ON A RECONNECT, so this asks again on `connect`. The
//page reloads on every hot update in this app and the socket drops with it; a
//pane that registered once would go quiet for ever, which looks exactly like a
//board where nothing is happening.
//
//`everyMs` OF NOTHING STILL MEANS "ONCE". A pane that wants one answer asks for
//one answer and registers no watch at all.
//
//---- what happens with no socket ------------------------------------------
//
//IT FALLS BACK TO THE TIMER IT USED TO BE. `okc.io` is the real socket in the
//window and is absent in a harness that stands `okc` up with a `call` and
//nothing else — and a hook that threw there would make every pane untestable
//without a server. The behaviour is the old one exactly, which is also what
//makes the fallback safe to leave in.

//AN ID OF THIS PANE'S OWN, so the server can tell two watches apart on one
//socket. A counter rather than anything derived from the action and arguments:
//two panes watching the same question with the same arguments are two panes, and
//both have to be told.
var nextId = 1;

module.exports = function useAsk(okc, action, args, everyMs) {
    var [state, setState] = useState(null);
    var [error, setError] = useState(null);
    var [reads, setReads] = useState(0);
    var seq = useRef(0);
    var alive = useRef(true);
    var mine = useRef('ask-' + (nextId++));
    //ASKING AGAIN, ON DEMAND. An act changes the thing being polled, and waiting
    //out the rest of the interval to find out shows a stale answer for up to the
    //full cadence — which reads as the act having done nothing, and is how
    //somebody presses it a second time.
    var now = useRef(function () {});

    var key = JSON.stringify(args || {});

    useEffect(function () {
        alive.current = true;
        var latest = 0;
        var id = mine.current;
        var io = okc && okc.io;

        //---- NOTHING TO ASK YET, WHICH IS NOT THE SAME AS ASKING FOR NOTHING --
        //
        //A PANE WITH A SELECTION HAS A STATE WITH NOTHING SELECTED, and asking
        //`contractVersions` with no id is a question with no answer: the door
        //rightly refuses it, the pane holds the refusal, and a person who has
        //picked nothing is told something could not be read.
        //
        //A HOOK CANNOT BE SKIPPED — React counts them — so the SKIP IS HERE, and
        //a falsy action means "not yet". It also clears, because the answer to
        //the last question is about something that is no longer picked, and a
        //stale one under a new selection is worse than an empty panel.
        if (!action) {
            setState(null);
            setError(null);
            return function () { alive.current = false; now.current = function () {}; };
        }

        //WHAT COMES BACK, FROM EITHER DIRECTION. A read this pane asked for and
        //an update the server pushed are the same event as far as the screen is
        //concerned, so they land in one place.
        function got(v) {
            if (!alive.current) return;
            setState(v);
            setError(null);
            setReads(function (x) { return x + 1; });
        }

        function read() {
            var n = ++seq.current;
            okc.call(action, args).then(function (v) {
                if (!alive.current || n < latest) return;//a stale answer, arriving late
                latest = n;
                got(v);
            }, function (e) {
                if (!alive.current || n < latest) return;
                //the last good answer stays on the screen underneath it
                setError(e.message);
            });
        }

        now.current = read;
        read();

        if (!everyMs) return function () { alive.current = false; now.current = function () {}; };

        //---- THE TIMER, WHICH IS ONLY REACHED WITHOUT A SOCKET -------------
        if (!io) {
            var t = setInterval(read, everyMs);
            return function () {
                alive.current = false;
                now.current = function () {};
                clearInterval(t);
            };
        }

        //---- OR THE WATCH, WHICH IS THE ORDINARY CASE ---------------------
        function onChanged(msg) {
            if (!msg || msg.id !== id) return;
            //A PUSHED ANSWER IS NEWER THAN ANY READ IN FLIGHT, because the server
            //only sends one having just asked. Claiming the sequence keeps a slow
            //read that lands afterwards from overwriting it with something older.
            latest = ++seq.current;
            got(msg.result);
        }

        function register() {
            io.emit('okc:watch', { id: id, action: action, args: args || {}, everyMs: everyMs });
        }

        io.on('okc:changed', onChanged);
        io.on('connect', register);
        register();

        return function () {
            alive.current = false;
            now.current = function () {};
            io.off('okc:changed', onChanged);
            io.off('connect', register);
            //TOLD RATHER THAN LEFT TO THE DISCONNECT. A tab switch unmounts the
            //pane without touching the socket, so nothing else would ever take
            //this watch off and the server would go on asking on behalf of a
            //pane that is not on screen — which is the exact cost this replaced.
            io.emit('okc:unwatch', { id: id });
        };
    }, [action, key, everyMs]);

    return { state, error, reads, again: function () { now.current(); } };
};
