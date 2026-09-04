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
        Note, Mono, Kv, KvRow, Notice, Editor, Markdown, ask
    } = theme;

    function sized(n) {
        if (n == null) return null;
        return n < 2048 ? n + ' characters' : (Math.round(n / 102.4) / 10) + 'k characters';
    }

    return function Notes() {
        var got = okc.use('workstrapRead', {}, 0);
        var said = got.state;

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
