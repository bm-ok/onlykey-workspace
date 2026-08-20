var React = require('react');
var { useState } = React;

module.exports = function workspace(theme, okc) {
    var {
        Pane, Panel, Cols, Col, Stack, TitleRow, Grow, Card, CardTitle, CardSub,
        Badge, Button, Skeleton, Empty, Note, Mono, Kv, KvRow, Notice, Form, Field, ask
    } = theme;

    //THE TABS THAT ARE QUESTIONS ABOUT A FOLDER. Named here rather than each tab
    //deciding for itself: it is one property of the app, and a tab that gated
    //itself would be a tab that could forget to.

    function Workspaces() {
        var { state, error, reads, again } = okc.use('workspaces', {}, 15000);
        var [said, setSaid] = useState(null);
        var [where, setWhere] = useState('');

        var open = state ? state.open : null;
        var cur = state && state.current ? state.current : null;
        //THE COUNT LIVES ON THE KNOWN ENTRY, NOT ON `current`, which is how the
        //card came out reading "undefined repositories". Two shapes describing
        //one folder, and only one of them counts.
        var mine = cur && state ? (state.known || []).filter(function (w) { return w.dir == cur.dir; })[0] : null;
        var name = cur ? cur.name : null;
        var repos = mine ? mine.repos : (cur ? cur.repos : null);

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Skeleton rows={3} /></Pane>;

        var known = state.known || [];

        function tell(p) {
            return p.then(
                function (r) { setSaid({ text: r.note || 'Done.' }); again(); },
                function (e) { setSaid({ bad: true, text: e.message }); throw e; }
            );
        }

        function use(w) {
            ask({
                title: 'Open "' + w.name + '"?',
                plain: [
                    'Everything on the other tabs becomes a statement about this folder instead.',
                    state.note || null,
                    'Testing mode, if it is on, is on for one named folder and switches off when the folder changes.'
                ],
                confirm: 'Open it',
                onYes: function () { return tell(okc.call('workspaceUse', { dir: w.dir })); }
            });
        }

        function close() {
            ask({
                title: 'Close "' + name + '"?',
                plain: [
                    'Nothing is forgotten and nothing on disk is touched. This app simply stops being about that folder.',
                    'Repositories and Tasks switch off until one is open again, because they are questions about a folder and there would be none.'
                ],
                confirm: 'Close it',
                danger: true,
                onYes: function () { return tell(okc.call('workspaceClose', {})); }
            });
        }

        function forget(w) {
            ask({
                title: 'Forget "' + w.name + '"?',
                plain: [
                    'It comes off this list. Nothing on disk is touched, and what is known about it is kept — open it again and its tasks and branch reasons are still there.'
                ],
                confirm: 'Forget it',
                danger: true,
                onYes: function () { return tell(okc.call('workspaceForget', { dir: w.dir })); }
            });
        }

        //REMEMBERING AND OPENING ARE TWO ACTS, and the old pane offers both.
        //Adding a folder you are not switching to is an ordinary thing — you are
        //setting up, not moving — and one button that always switches makes that
        //impossible to say.
        //NAMED rememberFolder AND NOT remember. There is a service called
        //`remember` — where somebody was looking, kept across restarts — and
        //this is a button that files a folder with the dashboard. Two unrelated
        //things under one word in one app is how the wrong one gets reached for.
        function rememberFolder(andOpen) {
            var d = where.trim();
            if (!d) { setSaid({ bad: true, text: 'Say which folder.' }); return; }
            tell(okc.call('workspaceAdd', { dir: d })).then(function () {
                setWhere('');
                if (andOpen) return tell(okc.call('workspaceUse', { dir: d }));
            }).catch(function () { /* already reported */ });
        }

        return (
            <Pane>
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}
                {error ? <Note kind="bad">{error}</Note> : null}

                <TitleRow>
                    {open ? <span>{'Workspaces — serving '}<Mono>{name}</Mono></span> : <span>Workspaces — none open</span>}
                    <Grow />
                    {open ? <Button kind="danger" onClick={close}>Close this workspace</Button> : null}
                </TitleRow>

                {/* WHAT FOLLOWS THE FOLDER AND WHAT STAYS WITH THE HOST. This is
                    the thing everyone gets wrong the first time, so it leads
                    rather than sitting in a footnote. */}
                {state.note ? <Note>{state.note}</Note> : null}

                <Cols>
                    <Col wide>
                        <Stack>
                            {known.length ? known.map(function (w) {
                                return (
                                    <Card key={w.dir} on={w.current}>
                                        <CardTitle>
                                            <Mono>{w.name}</Mono>
                                            {w.current ? <Badge kind="ok">in use</Badge> : null}
                                            {/* THERE OR NOT. A folder that has been
                                                moved or deleted is still remembered,
                                                and saying so beats a refusal when
                                                somebody clicks. */}
                                            {w.there === false ? <Badge kind="bad">not where it was</Badge> : null}
                                            <Grow />
                                            <span className="muted">
                                                {w.repos == null ? 'not counted' : w.repos + ' repositor' + (w.repos == 1 ? 'y' : 'ies')}
                                            </span>
                                        </CardTitle>
                                        <CardSub><Mono>{w.dir}</Mono></CardSub>
                                        <div className="row" style={{ marginTop: '6px' }}>
                                            {w.current
                                                ? <span className="muted">In use</span>
                                                : <Button
                                                    disabled={w.there === false}
                                                    title={w.there === false ? 'it is not where it was' : 'serve this folder instead'}
                                                    onClick={function () { use(w); }}>Open it</Button>}
                                            <Button kind="danger"
                                                disabled={w.current}
                                                title={w.current ? 'close it before forgetting it' : 'take it off this list'}
                                                onClick={function () { forget(w); }}>Forget it</Button>
                                        </div>
                                    </Card>
                                );
                            }) : <Empty>no folder is known yet — remember one on the right</Empty>}
                        </Stack>

                        {(state.inTheWay || []).length ? (
                            <Panel>
                                <CardTitle>In the way</CardTitle>
                                <CardSub>Folders that would clash with one of the above.</CardSub>
                                <Kv>
                                    {state.inTheWay.map(function (x, i) {
                                        return <KvRow key={i} label={x.name || x.dir}>{x.why || ''}</KvRow>;
                                    })}
                                </Kv>
                            </Panel>
                        ) : null}
                    </Col>

                    <Col narrow>
                        <Panel>
                            <CardTitle>Add a folder</CardTitle>
                            {/* NOTHING IS WRITTEN INTO IT, which is the question
                                anybody sensible asks before pointing a tool at
                                their repositories. */}
                            <CardSub>
                                A folder whose subdirectories are git repositories. Nothing is written into
                                it — what this app learns about a workspace is kept beside its own state,
                                out of reach of a <Mono>git clean</Mono>.
                            </CardSub>
                            <Form>
                                <Field f={{ name: 'dir', label: 'The folder', placeholder: 'path to a folder of repositories' }}
                                    value={where} onChange={setWhere} />
                            </Form>
                            <div className="row">
                                <Button kind="ok" onClick={function () { rememberFolder(false); }}>Remember it</Button>
                                <Button onClick={function () { rememberFolder(true); }}>Remember and open it</Button>
                            </div>
                            {/* THE FOLDER PICKER IS NOT PORTED. Over there a
                                Choose button opens the native dialog, which is an
                                nw.js affordance a browser tab does not have —
                                and this app is meant to work in both. Typing a
                                path works everywhere; saying so beats a button
                                that exists in one of the two places. */}
                            <Note>Type the path. The native folder picker is not built here yet.</Note>
                        </Panel>

                        <Panel>
                            <CardTitle>What belongs to a workspace</CardTitle>
                            {/* THE COUNT IS THE ARGUMENT. "Some tabs need a
                                folder" is a rule somebody takes on trust; "92 of
                                this app's actions are refused by name while none
                                is open" is a fact they can check. */}
                            <CardSub>
                                {(state.gated ? state.gated.length : 0) + ' of this app’s actions are questions about a '
                                    + 'folder of repositories, and are refused by name while none is open — everything '
                                    + 'under Repositories, Branches, PR cuts and Tasks.'}
                            </CardSub>
                            <CardSub>
                                The rest are about this computer: virtual machines, the terminal, the keys
                                and the live log. They keep working, because putting a machine away is how
                                you get to close a workspace.
                            </CardSub>
                            <Note><Mono>{state.where || '?'}</Mono></Note>
                        </Panel>
                    </Col>
                </Cols>

                <Note>{'read ' + reads + ' time(s), every 15s'}</Note>
            </Pane>
        );
    }

    return Workspaces;
};
