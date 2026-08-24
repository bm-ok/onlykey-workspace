var React = require('react');
var { useState, useEffect } = React;

//---------------------------------------------------------------------------
//the drills are running.
//
//ON WHILE A RUN IS GOING AND OFF WHEN IT IS NOT. Nothing subtler: the question
//it answers is "is it running", asked from across a room, so while it is true it
//is the loudest thing in the window.
//
//THE TEXT DOES NOT TICK, AND THAT IS THE DESIGN. A banner counting seconds is
//rewritten on every read, which flickers and takes a person's selection with it
//mid-copy. The words are fixed and the border breathes instead — see the
//`running-banner` keyframes in the theme's stylesheet, which say the same thing
//and touch no character of text. Anyone who has turned motion off still gets the
//colour, which carries the whole message on its own.
//
//IT CANNOT LIE AFTER A RESTART. A run in flight when the dashboard stops is
//marked interrupted on the way back up, so this goes out with it rather than
//sitting purple for ever over nothing.
//---------------------------------------------------------------------------

module.exports = function running(theme, okc, shell) {
    var { Banner, Linky } = theme;

    return function Running() {
        //---- TOLD, NOT ASKED ----------------------------------------------
        //
        //THIS POLLED `suites` EVERY THREE SECONDS, for ever. That answer is
        //built by walking the whole drill registry and reading the run records
        //off disk, and almost every one of them says "nothing is running".
        //
        //AND IT COULD NOT SEE A SHORT RUN AT ALL. "the refusals" finishes in
        //214ms; a three-second poll lands either side of it and never inside.
        //No cadence fixes that — only being told does, which is the whole point
        //of there being a socket.
        //
        //THREE PARTS, AND ../../core/okc PAID FOR THE THIRD. Told on change,
        //told again on connect, and ASKED once here — because the connect emit
        //does not wait for this component to mount, and a banner that missed it
        //would stay down for the length of a run.
        var [going, setGoing] = useState(null);

        useEffect(function () {
            var alive = true;

            function heard(now) { if (alive) setGoing(now || null); }
            okc.io.on('tests:running', heard);

            //THE ONE ASK, for the race above. Anything after this arrives as an
            //event.
            okc.io.emit('tests:running?', {}, heard);

            return function () { alive = false; okc.io.off('tests:running', heard); };
        }, []);

        if (!going) return null;

        //THE CHECK IN FLIGHT, shown as it is stored — "suite / test / check" —
        //rather than taken apart and put back together differently.
        var doing = typeof going == 'object' ? String(going.doing || '') : '';
        var passed = typeof going == 'object' ? going.passed : null;
        var failed = typeof going == 'object' ? going.failed : null;
        var score = [
            passed ? passed + ' passed' : null,
            failed ? failed + ' failed' : null
        ].filter(Boolean).join(', ');

        return (
            <Banner kind="running">
                <strong>Drills running</strong>
                <span>
                    {doing
                        ? ' — ' + doing + (score ? ' · ' + score : '')
                        : ' — starting' + (score ? ' · ' + score : '')}
                </span>
                {/* NOT BUILT: "Stop it". The old window puts a linky here that
                    calls `suiteStop`, and stopping a run is an act with a cost
                    — the step in flight finishes and the ones after it are not
                    tried — so it belongs behind the gate rather than behind a
                    bare press. The Test tab already has a Stop that says so.
                    Sending somebody there is honest; a second, ungated stop
                    beside it would be a second set of rules. */}
                <Linky onClick={function () { shell.go('Test'); }}>Go to the drills</Linky>
            </Banner>
        );
    };
};
