var React = require('react');
var { useState } = React;

//THE LAST PART OF A PATH, EITHER SEPARATOR. The server puts `name` on every row
//it answers with, but a folder somebody has this second chosen is not a row yet
//and the confirm dialog still has to call it something.
function nameOf(dir) {
    var parts = String(dir == null ? '' : dir).replace(/[\\/]+$/, '').split(/[\\/]/);
    return parts[parts.length - 1] || String(dir || '');
}

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
        //WHAT IS BEING LOOKED THROUGH, or null for "not looking". The answer from
        //`folderList` is kept whole rather than picked apart, because every field
        //on it — where we are, what is above, the drives — is a place to go next.
        var [browsing, setBrowsing] = useState(null);
        var [busy, setBusy] = useState(false);

        //WHAT THIS FOLDER IS ARMED TO DO, asked of the settings themselves
        //rather than described here. Every one of these follows the folder, so
        //the answer is about the workspace open now and changes when it does.
        //
        //ABOVE THE EARLY RETURNS, like every hook. Two panes in this app have
        //already been broken by a `use` that sat below one — React counts them
        //and the count has to be the same every render.
        var set = okc.use('settings', {}, 20000);
        var armed = set.state && set.state.settings ? (function (s) {
            var t = set.state.tests || {};
            return [
                { what: 'Watching GitHub', on: s.watchGitHub === true,
                    said: s.watchGitHub ? 'yes — issues and pull requests here are swept every five minutes' : 'no' },
                { what: 'Supervisor may wake itself', on: s.supervisorWakes === true,
                    said: s.supervisorWakes ? 'yes — it starts a machine and spends tokens on its own' : 'no' },
                //NO "Queue starts by itself" ROW, because it is no longer a
                //thing about this workspace that could be otherwise. The queue
                //comes up running on every host — see `cron.add` in
                //../queue/server.js. A row that reads "yes" on every machine
                //there will ever be is a row nobody can learn anything from, and
                //this list is what is ARMED HERE as against somewhere else.
                { what: 'Whose word counts', on: (s.githubTrusted || []).length > 0,
                    said: (s.githubTrusted || []).length
                        ? (s.githubTrusted || []).map(function (x) { return x && x.login ? x.login : x; }).join(', ')
                        : 'nobody — nothing arriving from GitHub can be a request' },
                { what: 'The tag', on: !!s.githubMarker,
                    said: s.githubMarker ? s.githubMarker + ':' : 'none set' },
                { what: 'Sent without being read', on: !!(s.githubReplyDirect || s.githubCloseDirect || s.githubReviewDirect),
                    said: [s.githubReplyDirect ? 'replies' : null, s.githubCloseDirect ? 'closes' : null,
                        s.githubReviewDirect ? 'reviews' : null].filter(Boolean).join(', ') || 'nothing — every one is drafted for you' },
                { what: 'The drills', on: t.allowed === true,
                    said: t.allowed ? 'ON here — they write to repositories' : 'off' }
            ];
        })(set.state.settings) : null;

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

        //ONE DIALOG FOR EVERY WAY OF OPENING ONE. It takes a `{name, dir}` rather
        //than a row off the list, because the folder somebody has just chosen is
        //not on the list yet and was the one path that switched workspace
        //without asking.
        function use(w) {
            ask({
                title: 'Open "' + w.name + '"?',
                plain: [
                    'Everything on the other tabs becomes a statement about this folder instead.',
                    //WHAT IS ARMED DOES NOT COME WITH YOU, and this is the
                    //moment to say it: watching GitHub, the supervisor waking
                    //itself, whose word counts, what goes out unread and the
                    //drills are each set for one folder. A workspace opened for
                    //the first time can do none of them.
                    'Nothing that arms this app comes with you. Watching GitHub, waking the supervisor, '
                        + 'whose comments count, what is sent without being read and the drills are all set '
                        + 'for one folder — a new one starts able to do none of it.',
                    'What was set for this folder before is still there, and what is set for the one you are leaving stays with it.'
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
                    'Repositories, Worker, Queue, Judge and Supervisor switch off until one is open again, because they are questions about a folder and there would be none.'
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
        //
        //AND FOR A WHILE BOTH BUTTONS DID THE SAME THING, because `workspaceAdd`
        //called the same function `workspaceUse` does: "Remember it" moved the
        //whole app to another folder with no dialog. ../workspace/server.js says
        //what changed. Here the consequence is that the opening path now goes
        //through `use()` — the same confirm as the "Open it" on every card —
        //rather than calling the action itself.
        //
        //NAMED rememberFolder AND NOT remember. There is a service called
        //`remember` — where somebody was looking, kept across restarts — and
        //this is a button that files a folder with the dashboard. Two unrelated
        //things under one word in one app is how the wrong one gets reached for.
        //---- FINDING ONE ----------------------------------------------------
        //
        //TWO WAYS, AND THE FIRST IS THE DESKTOP'S OWN. `folderPick` is answered
        //by the node half, which is the only part of this app with an nw to
        //reach — see ../core/window/main.js. It answers three ways and each is
        //different: a path, nothing at all (somebody backed out, which is an
        //answer and not a failure), or `unavailable`, which is what a browser tab
        //gets because there is no desktop to ask. Only the last one falls
        //through to the list below.
        function look(at) {
            setBusy(true);
            return okc.call('folderList', at ? { at: at } : {}).then(function (d) {
                setBrowsing(d);
                setBusy(false);
            }, function (e) {
                setBusy(false);
                setSaid({ bad: true, text: e.message });
            });
        }

        //BOTH AT ONCE, AND THAT IS DELIBERATE.
        //
        //The obvious shape is: ask for the dialog, and open the list only if the
        //dialog says it is not there. It has one failure nobody can see coming —
        //a dialog that opens and never answers, or never opens at all, is
        //indistinguishable from a person taking their time looking, so the only
        //way out of it is a clock, and until the clock runs out the button is a
        //button that did nothing.
        //
        //So the list opens IMMEDIATELY and the dialog is asked for beside it. If
        //the dialog answers, its path wins and the list goes away; if it never
        //does, nothing was waiting on it. The window is never in the state of
        //having nothing to show.
        function choose() {
            look(browsing ? browsing.at : null);
            okc.call('folderPick', { startAt: browsing ? browsing.at : null }).then(function (d) {
                if (d && d.path) { setBrowsing(null); setWhere(d.path); }
                //`unavailable`, or backed out. The list is already up, and
                //saying "nothing was chosen" to somebody who chose nothing on
                //purpose is noise.
            }, function () {
                //THE ACTION MAY NOT EXIST AT ALL — under plain node, or a main
                //half from before it did. "No such action" is the same fact as
                //`unavailable` wearing a refusal, and the list covers both.
            });
        }

        function rememberFolder(andOpen, folder) {
            var d = String(folder == null ? where : folder).trim();
            if (!d) { setSaid({ bad: true, text: 'Say which folder.' }); return; }
            tell(okc.call('workspaceAdd', { dir: d })).then(function () {
                setWhere('');
                setBrowsing(null);
                if (andOpen) use({ name: nameOf(d), dir: d });
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
                {/* `state.note` was read here and never answered — see the note
                    where "In the way" used to be. What it was for is below, in
                    two panels that read the settings rather than a field.

                    A WARNING STOOD HERE for a folder that was open without
                    anybody here having chosen it — borrowed from the app this
                    one was ported from, which meant everything kept per
                    workspace depended on that app still answering. There is no
                    way to be in that state now, so there is nothing to warn
                    about. */}

                <Cols>
                    <Col wide>
                        {/* LOOKING FOR ONE HAPPENS WHERE THERE IS ROOM FOR IT.
                            The panel that starts the search is narrow, because
                            it is three buttons; a list of somebody's disk is
                            not, and cramming it beside them is how a list ends
                            up two words wide. */}
                        {browsing ? (
                            <Panel>
                                <CardTitle>
                                    Looking for a folder
                                    <Grow />
                                    <Button onClick={function () { setBrowsing(null); }}>Stop looking</Button>
                                </CardTitle>
                                <CardSub><Mono>{browsing.at}</Mono></CardSub>

                                <div className="row" style={{ marginTop: '6px' }}>
                                    <Button disabled={!browsing.up || busy}
                                        title={browsing.up ? 'up to ' + browsing.up : 'this is as far up as it goes'}
                                        onClick={function () { look(browsing.up); }}>Up</Button>
                                    {(browsing.roots || []).map(function (r) {
                                        return <Button key={r.dir} disabled={busy}
                                            onClick={function () { look(r.dir); }}>{r.name}</Button>;
                                    })}
                                </div>

                                {/* THE FOLDER SOMEBODY IS STANDING IN IS A
                                    CANDIDATE TOO, and the count says whether it
                                    is the right one before anything is chosen —
                                    which is the thing the desktop's own dialog
                                    cannot tell them. */}
                                <div className="row" style={{ marginTop: '6px' }}>
                                    <span className="muted">
                                        {browsing.here == null
                                            ? 'this folder could not be counted'
                                            : browsing.here + ' git repositor' + (browsing.here == 1 ? 'y' : 'ies') + ' in this folder'}
                                    </span>
                                    <Grow />
                                    <Button kind="ok" disabled={busy}
                                        onClick={function () { rememberFolder(false, browsing.at); }}>Remember this one</Button>
                                    <Button disabled={busy}
                                        onClick={function () { rememberFolder(true, browsing.at); }}>Remember and open it</Button>
                                </div>

                                <Stack>
                                    {(browsing.entries || []).length ? browsing.entries.map(function (e) {
                                        return (
                                            <Card key={e.dir}>
                                                <CardTitle>
                                                    <Mono>{e.name}</Mono>
                                                    {/* POINTING AT A REPOSITORY INSTEAD OF AT THE
                                                        FOLDER THAT HOLDS SEVERAL is the other way
                                                        to get this wrong, and it looks identical
                                                        from a path. */}
                                                    {e.isRepo ? <Badge kind="warn">a repository itself</Badge> : null}
                                                    {e.repos ? <Badge kind="ok">{e.repos + ' inside'}</Badge> : null}
                                                    <Grow />
                                                    <Button disabled={busy}
                                                        onClick={function () { look(e.dir); }}>Look inside</Button>
                                                    <Button kind="ok" disabled={busy}
                                                        title={e.repos ? 'remember this folder' : 'it holds no git repositories'}
                                                        onClick={function () { rememberFolder(false, e.dir); }}>Remember it</Button>
                                                </CardTitle>
                                            </Card>
                                        );
                                    }) : <Empty>nothing but files in here</Empty>}
                                </Stack>
                            </Panel>
                        ) : null}

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
                                            {/* NOTHING IN IT IS A STATE, AND IT
                                                DREW AS A HEALTHY ONE. `0
                                                repositories` in the same grey as
                                                `3 repositories` is the difference
                                                between a workspace and a folder
                                                somebody picked by mistake, said
                                                in a way nobody reads. */}
                                            {w.repos === 0 ? <Badge kind="warn">nothing in it</Badge> : null}
                                            <Grow />
                                            <span className="muted">
                                                {w.repos == null
                                                    ? 'not counted'
                                                    : (w.repos === 0
                                                        ? 'no git repositories one level down'
                                                        : w.repos + ' repositor' + (w.repos == 1 ? 'y' : 'ies'))}
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

                        {/* "IN THE WAY" WAS HERE AND WAS NEVER GOING TO DRAW.
                            It read `state.inTheWay`, which this app's
                            `workspaces` has never answered with — it belongs to
                            the shape of the app being ported FROM. Markup
                            guarded by a field that is always undefined is not a
                            feature waiting to work; it is a paragraph nobody can
                            tell is dead by looking at the screen, which is the
                            only place most of this gets checked. */}
                        <Panel>
                            <CardTitle>
                                What this workspace is armed to do
                                {armed && !armed.some(function (a) { return a.on; })
                                    ? <Badge kind="ok">nothing</Badge> : null}
                            </CardTitle>
                            <CardSub>
                                Every switch that arms this app follows the folder it was set for, so a
                                workspace opened for the first time can do none of this until somebody says so.
                            </CardSub>
                            {armed ? (
                                <Kv>
                                    {armed.map(function (a) {
                                        return <KvRow key={a.what} label={a.what}>{a.said}</KvRow>;
                                    })}
                                </Kv>
                            ) : <Note>reading…</Note>}
                        </Panel>

                        <Panel>
                            <CardTitle>What follows the folder</CardTitle>
                            {/* KEPT TRUE BY HAND, and the two places that decide
                                it are named so the next person can check rather
                                than trust this. */}
                            <CardSub>
                                Switching workspace switches all of this to the new folder&rsquo;s own, and back
                                again on returning &mdash; nothing is thrown away. What is set for one folder is
                                not set for the next.
                            </CardSub>
                            <Kv>
                                <KvRow label="Follows the folder">
                                    the repositories and what was learnt about them, tasks, judgements, lines,
                                    PR cuts, drafts and what was sent, the jobs, the supervisor&rsquo;s
                                    conversation, todo list, notebook and proposed skills, and every switch on
                                    Settings except the supervisor sign-in
                                </KvRow>
                                <KvRow label="Stays with this computer">
                                    the machines, the keys and sign-ins, the guards, and the contract and
                                    prompt library
                                </KvRow>
                            </Kv>
                            <Note>Kept here: <Mono>{state.where || '?'}</Mono></Note>
                        </Panel>
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
                            {/* THE BUTTON COMES FIRST BECAUSE IT IS THE ANSWER.
                                Typing an absolute path is the one input in this
                                window that cannot be checked as it is typed —
                                a trailing slash, a backslash eaten on the way,
                                the wrong drive — and it was the only way in. */}
                            <div className="row">
                                <Button kind="ok" disabled={busy}
                                    onClick={choose}>{busy ? 'waiting…' : 'Choose a folder…'}</Button>
                                <Button disabled={busy}
                                    onClick={function () { look(browsing ? browsing.at : null); }}>Look through this computer</Button>
                            </div>

                            <Form>
                                <Field f={{ name: 'dir', label: 'Or type the path', placeholder: 'path to a folder of repositories' }}
                                    value={where} onChange={setWhere} />
                            </Form>
                            <div className="row">
                                <Button kind="ok" onClick={function () { rememberFolder(false); }}>Remember it</Button>
                                <Button onClick={function () { rememberFolder(true); }}>Remember and open it</Button>
                            </div>
                            {/* WHICH OF THE TWO DOES WHAT, said where the two
                                are. They were the same act for long enough that
                                the difference is worth a sentence. */}
                            <Note>Remembering puts it on the list and changes nothing else. Opening is the act that makes every other tab a statement about that folder, and it asks first.</Note>
                            {/* WHY THERE ARE TWO BUTTONS AND NOT ONE. The
                                desktop's dialog is not reachable from a browser
                                tab — this page is served over http, so it has no
                                nw at all and the node half has to be asked. When
                                there is nothing to ask, the second one is the
                                answer rather than a message saying so. */}
                            <Note>Choose opens this computer's own folder dialog. In a browser tab there is none, so the list is used instead — and it says how many repositories each folder holds, which the dialog cannot.</Note>
                        </Panel>

                        {/* WHAT THIS FOLDER IS ALLOWED TO DO, READ RATHER THAN
                            DESCRIBED.

                            This panel used to open with "0 of this app's actions
                            are questions about a folder of repositories" — a
                            count of a field the server has never answered with,
                            so the sentence arguing that a fact beats a rule was
                            itself printing a number that was not one.

                            Every switch that arms this app follows the folder
                            now, so what is armed HERE is a real question with a
                            real answer, and it is the one somebody opening a
                            workspace for the first time actually has. */}
                    </Col>
                </Cols>

                <Note>{'read ' + reads + ' time(s), every 15s'}</Note>
            </Pane>
        );
    }

    return Workspaces;
};
