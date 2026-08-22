var React = require('react');
var { useState, useEffect, useRef } = React;

module.exports = function terminal(theme, okc, shell) {
    var { Pane, Panel, TitleRow, Grow, Row, Button, Badge, Skeleton, Empty, Note, Mono, Term } = theme;

    //---- a machine's console -------------------------------------------------
    //
    //A CONSOLE IS NOT A SHELL, and the difference is why one of them can be here
    //and the other cannot. A shell is bytes travelling both ways on their own
    //websocket, which this half does not relay. A console is a FILE — VirtualBox
    //copies the guest's serial port into it, and reading a file is an ordinary
    //action like any other.
    //
    //SO THIS IS THE ONE TERMINAL THIS TAB CAN HONESTLY SHOW, and it happens to be
    //the one worth the most: it is the only way to watch a boot that never
    //finishes. There is no agent yet during an install, so nothing else in this
    //app can say anything about a machine for twenty-five minutes.
    //
    //READ-ONLY ON PURPOSE. No `onData`, so ../ui/xterm gives it no cursor and no
    //stdin — a blinking cursor on a captured log is a promise that a keystroke
    //goes somewhere.
    function Console({ vms }) {
        var [on, setOn] = useState(null);
        var [err, setErr] = useState(null);
        var [note, setNote] = useState(null);
        var term = useRef(null);
        var seen = useRef(0);

        //ONLY WHAT IS NEW, WRITTEN ONCE. The whole file is up to a megabyte of a
        //boot; rewriting it every poll would flicker, lose the scroll position,
        //and destroy a selection somebody is mid-copy of.
        useEffect(function () {
            if (!on) return;

            var alive = true;
            seen.current = 0;
            if (term.current) term.current.clear();

            async function read() {
                try {
                    //A GENEROUS TAIL. `of` says how long the file is, so what has
                    //arrived since last time is the difference — and asking for
                    //more than that costs nothing but is the only way to be sure
                    //a burst was not missed.
                    var got = await okc.call('vmLog', { name: on, which: 'console', lines: 800 });
                    if (!alive) return;

                    var lines = got.lines || [];
                    var total = got.of || lines.length;
                    var fresh = seen.current === 0 ? lines : lines.slice(Math.max(0, lines.length - (total - seen.current)));

                    //A BURST BIGGER THAN THE WINDOW IS SAID, not silently
                    //dropped. A console that skipped a thousand lines without
                    //mentioning it is a console nobody can reason from.
                    if (seen.current && total - seen.current > lines.length) {
                        setNote((total - seen.current - lines.length) + ' lines went by faster than this could read them');
                    }

                    seen.current = total;
                    setErr(null);
                    if (fresh.length && term.current) term.current.write(fresh.join('\r\n') + '\r\n');
                } catch (e) {
                    if (alive) setErr(e.message);
                }
            }

            read();
            var t = setInterval(read, 2000);
            return function () { alive = false; clearInterval(t); };
        }, [on]);

        var watchable = (vms || []).filter(function (v) { return v.serial; });

        return (
            <Panel>
                <TitleRow>
                    <span>A machine&rsquo;s console</span>
                    <Grow />
                    {on ? <Badge kind="run">{on}</Badge> : null}
                </TitleRow>

                {!watchable.length
                    ? <Empty>No machine here has its console captured, so there is nothing to watch.</Empty>
                    : <Row>
                        {watchable.map(function (v) {
                            return (
                                <Button key={v.name} kind={v.name === on ? 'ok' : undefined}
                                    onClick={function () { setOn(v.name === on ? null : v.name); setNote(null); }}>
                                    {v.name}
                                </Button>
                            );
                        })}
                    </Row>}

                {err ? <Note kind="bad">{err}</Note> : null}
                {note ? <Note kind="warn">{note}</Note> : null}

                {on
                    ? <Term ref={term} height={420} />
                    : watchable.length
                        ? <Note>Pick a machine to read what it wrote to its serial port. This is the only
                            view of a machine that works before its agent exists &mdash; during an install,
                            or when a boot does not finish.</Note>
                        : null}
            </Panel>
        );
    }

    function Terminal() {
        var q = okc.use('vmList', {}, 8000);

        //RUNNING AND UNWATCHABLE. Only while one is actually running, so this is
        //silent on a quiet host.
        var dark = (((q.state && q.state.vms) || [])
            .filter(function (v) { return v.running && !v.serial; })
            .map(function (v) { return v.name; }));

        return (
            <Pane>
                <TitleRow>
                    <span>Terminal</span>
                    <Grow />
                    {/* THERE AND REFUSED, NOT ABSENT. Somebody who knows this
                        tab looks for this button; a missing one reads as a
                        different app, and a present one that says why reads as
                        this one with nothing open. */}
                    <Button disabled title="nothing is open to close">Close it</Button>
                </TitleRow>
                <Note>
                    Started from a task, and they arrive here. Over ssh, with this app&rsquo;s own key
                    &mdash; the same way in as <Mono>okc.js vmShell</Mono> and the same way VS Code
                    connects, so if one works they all do.
                </Note>

                <Panel>
                    <Empty>No terminals are open.</Empty>
                    <Empty>
                        They start from a task, the same way VS Code does &mdash; take a task and choose
                        &ldquo;in a terminal&rdquo;, and the shell lands here with the branch checked out and
                        the machine signed in. Then type <Mono>claude</Mono>, or anything else.
                    </Empty>

                    {/* A SPINNER THAT NEVER STOPS IS WORSE THAN AN ERROR.
                        Keyed on `!q.state` alone, a call that FAILED looked
                        exactly like one still on its way: `vmList` is relayed,
                        so with the other app stopped this pane sat on a skeleton
                        for ever and `npm run walk` could only report it as
                        "still arriving" — the one pane in forty-eight it could
                        say nothing about at all.
                        `okc.use` hands back the error beside the answer; this
                        was reading one of the two. */}
                    {!q.state && !q.error ? <Skeleton rows={1} /> : null}
                    {!q.state && q.error ? <Note kind="warn">{q.error}</Note> : null}
                    {dark.length ? (
                        <Note kind="warn">
                            {dark.join(', ') + (dark.length === 1 ? ' is' : ' are')
                                + ' running with no console being captured, so there is nothing to show for '
                                + (dark.length === 1 ? 'it' : 'them')
                                + '. The serial port is what makes a boot watchable, and VirtualBox will only'
                                + ' add one to a machine that is switched off — so this cannot be turned on'
                                + ' mid-install. An install turns it on by itself from now on.'}
                        </Note>
                    ) : null}

                    <Button onClick={function () { shell.go('Worker', 'Board'); }}>Go to the tasks</Button>
                </Panel>

                <Console vms={(q.state && q.state.vms) || []} />

                {/* NOT BUILT, AND THE REASON IS NOT "IT WAS FIDDLY".
                    //
                    A live shell is not an action. Everything else on this tab —
                    and in this whole app — arrives over the one action socket
                    this half relays; a terminal is a separate websocket carrying
                    bytes both ways, and relaying it is a piece of plumbing
                    rather than a pane. Until that exists, an xterm here would be
                    a black square that never fills, which is worse than a
                    sentence.

                    What IS here is real: the tab is in its right place, the
                    empty state is the old one word for word, and the warning
                    about a machine running unwatched works — that is the part of
                    this pane that has ever caught anything. */}
                <Note kind="warn">
                    A terminal that is actually open cannot be shown here yet. Bytes to and from a shell
                    travel on their own websocket rather than through the action socket this half relays,
                    and that relay is not built &mdash; so a shell started from a task runs, and lands, and
                    is reachable with <Mono>okc.js vmShell</Mono>, but there is no window on it here.
                </Note>
            </Pane>
        );
    }

    return Terminal;
};
