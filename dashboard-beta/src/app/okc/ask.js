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
module.exports = function useAsk(okc, action, args, everyMs) {
    var [state, setState] = useState(null);
    var [error, setError] = useState(null);
    var [reads, setReads] = useState(0);
    var seq = useRef(0);
    var alive = useRef(true);

    var key = JSON.stringify(args || {});

    useEffect(function () {
        alive.current = true;
        var mine = 0;

        function read() {
            var n = ++seq.current;
            okc.call(action, args).then(function (v) {
                if (!alive.current || n < mine) return;//a stale answer, arriving late
                mine = n;
                setState(v);
                setError(null);
                setReads(function (x) { return x + 1; });
            }, function (e) {
                if (!alive.current || n < mine) return;
                //the last good answer stays on the screen underneath it
                setError(e.message);
            });
        }

        read();
        var t = everyMs ? setInterval(read, everyMs) : null;
        return function () {
            alive.current = false;
            if (t) clearInterval(t);
        };
    }, [action, key, everyMs]);

    return { state, error, reads };
};
