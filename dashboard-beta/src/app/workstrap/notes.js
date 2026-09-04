var React = require('react');
var { useState, useEffect } = React;

//---------------------------------------------------------------------------
//THE WORKSPACE'S OWN NOTES, IN THE WINDOW.
//
//WHAT A MACHINE IS TOLD ABOUT THIS PROJECT before it touches it: how to get the
//workspace into a state where the code runs, how to build it, how to test it,
//how to run it, and whatever is peculiar to it. Every worker, judge and DIY seat
//is given this as `~/workspace/CLAUDE.md` when it boots.
//
//SO IT IS EDITED HERE AND NOWHERE ELSE, FOR NOW. A machine that could rewrite
//what every future machine is told is the thing that wants an approval step in
//front of it — and that step is the next piece of work rather than this one, so
//until it exists `workstrapSave` refuses everything but a person at this window.
//
//THE FILE IS SHARED AND IT LEAVES THIS HOST. That is worth saying on the pane
//rather than only in the document: what goes in here is handed to every machine
//that opens the workspace, which is exactly the property that makes a secret
//written in it a secret given away.
//---------------------------------------------------------------------------

module.exports = function notes(theme, okc) {
    var {
        Pane, Panel, Stack, TitleRow, Grow, Badge, Button, Views, Skeleton,
        Note, Mono, Kv, KvRow, Notice, Editor, Markdown, Diff, Card, CardTitle,
        CardSub, Code, ask
    } = theme;

    //THE SAME SHORTENING EVERY OTHER PANE USES, defined here because it is two
    //lines and a shared one would be a service nobody asked for.
    var day = function (s) { return s ? String(s).replace('T', ' ').slice(0, 16) : null; };

    function sized(n) {
        if (n == null) return null;
        return n < 2048 ? n + ' characters' : (Math.round(n / 102.4) / 10) + 'k characters';
    }

    //---- WHAT A MACHINE WROTE, WAITING TO BE READ --------------------------
    //
    //ABOVE THE DOCUMENT, WHICH IS THE ONE PLACE ON THIS PANE THAT ASKS FOR
    //ANYTHING. Everything below it is a thing to read; this is a thing to
    //decide, and a decision under a screenful of prose is one nobody makes.
    //
    //A DIFFERENCE AND NOT THE WHOLE FILE. What matters is what CHANGED — a
    //machine that added two lines about a virtualenv sends back three thousand
    //characters, and reading them all to find the two is how somebody approves
    //without looking.
    function Waiting({ rows, now, again }) {
        if (!rows || !rows.length) return null;

        function take(x) {
            ask({
                title: 'Take the notes ' + x.machine + ' wrote?',
                plain: [
                    'They become the workspace notes: every worker, judge and DIY seat that opens this workspace from now on is given them.',
                    x.is === 'forked'
                        ? 'This was written on top of an older version — the notes here changed while that machine was running. Taking it keeps what the machine wrote and drops what changed here in the meantime.'
                        : 'It was written on top of exactly what is here now, so nothing else is lost.',
                    'What is here now is kept as a version, so it can be read again afterwards.'
                ],
                cost: 'What is here now is replaced.',
                confirm: 'Take it',
                danger: x.is === 'forked',
                onYes: function () {
                    return okc.call('workstrapApprove', { machine: x.machine }).then(function () { again(); });
                }
            });
        }

        function drop(x) {
            ask({
                title: 'Throw away what ' + x.machine + ' wrote?',
                plain: [
                    'It is not kept anywhere else. That machine has been stopped or rolled back, so this is the only copy of what it wrote.'
                ],
                cost: 'Gone, and not recoverable.',
                confirm: 'Throw it away',
                danger: true,
                onYes: function () {
                    return okc.call('workstrapDiscard', { machine: x.machine }).then(function () { again(); });
                }
            });
        }

        return (
            <Panel>
                <TitleRow>
                    <span>What a machine wrote</span>
                    <Grow />
                </TitleRow>

                {rows.map(function (x) {
                    return (
                        <Card key={x.machine}>
                            <CardTitle>
                                <Mono>{x.machine}</Mono>
                                <Badge kind={x.is === 'forked' ? 'warn' : 'ok'}>
                                    {x.is === 'forked' ? 'written on an older version' : 'a change'}
                                </Badge>
                            </CardTitle>
                            <CardSub>
                                {day(x.at)}{x.why ? ' · ' + x.why : ''}
                                {x.added != null ? ' · ' + x.added + ' added, ' + x.gone + ' removed' : ''}
                            </CardSub>

                            <Note>{x.note}</Note>

                            {/* WHAT CHANGED, BEFORE THE SIDE-BY-SIDE. A change
                                appended to the end of a long document leaves both
                                panes of a diff showing identical text, and the
                                only way to see it is to scroll — which is how
                                somebody approves without looking. This is the
                                same arithmetic the version history is written
                                with, so it counts the lines the same way. */}
                            {x.asText ? <Code text={x.asText} mode="diff" /> : null}

                            {/* STALE MEANS THE DIFFERENCE BELOW IS AGAINST THE
                                WRONG THING, and saying so is the whole of what
                                this flag is for: `workstrapApprove` refuses in
                                that case, and a button that refuses without
                                warning is a button that looks broken. */}
                            {x.stale ? (
                                <Notice kind="warn">
                                    The notes here have changed since this was read, so this difference is
                                    against an older version. Taking it is refused until the pane is read
                                    again — nothing is lost.
                                </Notice>
                            ) : null}

                            <Diff left={now} right={x.text} mode="markdown" height={320} />

                            <div className="row">
                                <Button kind="ok" disabled={x.stale}
                                    title={x.stale ? 'read it again first' : 'make it the workspace notes'}
                                    onClick={function () { take(x); }}>Take it</Button>
                                <Button onClick={function () { drop(x); }}>Throw it away</Button>
                            </div>
                        </Card>
                    );
                })}
            </Panel>
        );
    }

    return function Notes() {
        var got = okc.use('workstrapRead', {}, 0);
        var said = got.state;

        //ASKED ON A CADENCE, unlike the document beside it: a machine going to
        //sleep is something that happens while this pane is open, and a proposal
        //that only appears when somebody switches tab is one that waits a day.
        var queue = okc.use('workstrapWaiting', {}, 5000);

        var [look, setLook] = useState('Read');
        var [draft, setDraft] = useState(null);
        var [problem, setProblem] = useState(null);

        var served = (said && said.text) || '';

        //---- WHAT IS IN THE BOX IS WHAT IS SERVED, UNTIL IT IS TOUCHED ------
        //
        //`draft` IS NULL FOR "NOTHING TYPED YET" rather than a copy of the
        //served text, and the difference is what makes the Save button honest:
        //with a copy, an edit that was typed and undone still reads as a change,
        //and every open pane would offer to save a document identical to the one
        //already there.
        //
        //RESET WHEN THE SERVED COPY CHANGES UNDER IT — a save from elsewhere, or
        //a workspace switch. Not while something is being written: a pane that
        //throws away what somebody is halfway through typing because a poll came
        //back is worse than one showing a stale document.
        useEffect(function () {
            if (draft === null) setProblem(null);
        }, [served]);

        var writing = draft === null ? served : draft;
        var changed = draft !== null && draft !== served;

        function save() {
            ask({
                title: 'Save the workspace notes?',
                plain: [
                    'This is what every worker, judge and DIY seat is given as ~/workspace/CLAUDE.md when it boots.',
                    'It replaces what is there now. Nothing keeps the previous copy yet, so what it says now is gone.',
                    'It is not sent to a supervisor: a supervisor cannot see the code, so it has no use for how to build or test it.'
                ],
                cost: 'Every machine that opens this workspace from now on reads what you save.',
                confirm: 'Save it',
                onYes: function () {
                    return okc.call('workstrapSave', { text: writing }).then(function () {
                        setDraft(null);
                        setProblem(null);
                        got.again();
                    }, function (e) {
                        setProblem(e.message);
                        throw e;
                    });
                }
            });
        }

        if (!said) return <Pane><Skeleton /></Pane>;

        return (
            <Pane>
                <Stack>
                    <TitleRow>
                        <span>What this workspace is</span>
                        {' '}
                        {/* WHOSE COPY THIS IS, AND IT IS THE FIRST THING WORTH
                            KNOWING. "Somebody wrote this about this project" and
                            "this is what every empty workspace gets" read
                            identically once both are just text, and only one of
                            them is worth believing. */}
                        <Badge kind={said.mine ? 'ok' : 'warn'}>
                            {said.mine ? "this workspace's" : 'the starter, not filled in yet'}
                        </Badge>

                        {/* A SPACER, NOT A WRAPPER. `Grow` is `<span class="grow" />`
                            and takes no children at all — so a title put INSIDE it
                            renders as nothing, silently, with the pane otherwise
                            perfect. That is how this heading and its badge were
                            missing from the first version of this pane: no error, no
                            warning, and every check green. It pushes what FOLLOWS it
                            to the right. */}
                        <Grow />
                        <Views names={['Read', 'Write']} on={look} onPick={setLook} />
                        {look == 'Write'
                            ? <Button kind="ok" disabled={!changed}
                                title={changed ? 'save it for every machine' : 'nothing has changed'}
                                onClick={save}>Save it</Button>
                            : null}
                    </TitleRow>

                    {problem ? <Notice kind="bad">{problem}</Notice> : null}

                    <Waiting
                        rows={queue.state && queue.state.waiting}
                        now={(queue.state && queue.state.now) || served}
                        again={function () { queue.again(); got.again(); }} />

                    {!said.mine ? (
                        <Note>
                            Nobody has written this workspace up yet, so machines are given the starter —
                            which tells them what the file is for and asks them to fill it in. Saving over
                            it makes it this workspace's own.
                        </Note>
                    ) : null}

                    <Panel>
                        <Kv>
                            <KvRow label="kept at"><Mono>{said.at || 'no workspace is open'}</Mono></KvRow>
                            <KvRow label="a machine reads it at"><Mono>~/workspace/CLAUDE.md</Mono></KvRow>
                            {/* WHO GETS IT, SAID ON THE PANE. The fence is in the
                                guest door and is invisible from here otherwise —
                                and "why has the supervisor not read this" is
                                exactly the question somebody will have. */}
                            <KvRow label="given to">a worker, a judge, or a DIY seat — not a supervisor</KvRow>
                            <KvRow label="refreshed">on every boot, from this host</KvRow>
                            <KvRow label="size">{sized(said.bytes)}</KvRow>
                        </Kv>
                    </Panel>

                    <Panel>
                        {look == 'Read'
                            ? <Markdown text={served} height="620px" />
                            : (
                                <div>
                                    <Note>
                                        Say how to finalise the workspace, build it, test it, run it and debug
                                        it — the commands, not a description of them. It is shared between every
                                        machine, so no tokens, no keys, no passwords.
                                    </Note>
                                    <Editor text={writing} mode="markdown" min={20} max={900}
                                        editable onChange={setDraft} />
                                </div>
                            )}
                    </Panel>
                </Stack>
            </Pane>
        );
    };
};
