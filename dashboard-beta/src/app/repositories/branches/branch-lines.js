var React = require('react');
var { useState } = React;

//---------------------------------------------------------------------------
//THE LINES PANE: every named line, and why it exists.
//
//A LIST AND A DETAIL, not six expanded cards. Six lines with three repositories
//each is eighteen rows of mostly-identical branch names, and the reason a line
//exists — which is a paragraph somebody wrote at the time — is the thing worth
//reading and the thing that gets scrolled past. One at a time, with its reason
//in full.
//
//THE HEAD BRANCHES CARD IS FIRST AND IS NOT A LINE. It is what each repository
//counts from right now, read from git, and it is here because it is where
//everything starts — and because a repository's own HEAD is always protected
//whether or not any line names it.
//
//CALLED "HEAD BRANCHES" BECAUSE THAT IS WHAT THEY ARE. This said "Default
//branches", which invites the question "default for what" and has a different
//answer on GitHub than it does here. The value comes from `refs.head` of each
//repository — literally its HEAD — and naming it after the thing it is read
//from is the only name that cannot drift from it.
//
//`marked` AND NOT `proposed`. The first version of this file read `g.proposed`,
//which the action has never returned, so the badge could not render and a line
//that WAS up for landing looked like any other. A field name that is nearly
//right is invisible: React renders `undefined` as nothing at all.
//---------------------------------------------------------------------------

module.exports = function lines(theme, okc, shell, remember) {
    var {
        Pane, Panel, Cols, Col, Stack, TitleRow, Grow, Plus, Card, CardTitle,
        Badge, Button, Empty, Note, Notice, Mono, Muted, Kv, KvRow, Group, Part,
        Skeleton, ask
    } = theme;

    var short = function (s) { return s ? String(s).slice(0, 7) : null; };
    var day = function (s) { return s ? String(s).slice(0, 10) : null; };

    //WHERE THE LINE AS A WHOLE STANDS, said as a word. `null` is not unknown: it
    //is a line origin has never seen any part of, which is ordinary for work
    //that has not gone anywhere yet.
    function Sync({ g }) {
        if (g.sync === 'conflict') return <Badge kind="bad">a part moved on both sides</Badge>;
        if (g.sync === 'behind') return <Badge kind="warn">a part is behind</Badge>;
        if (g.sync === 'ok') return <Badge kind="ok">in step</Badge>;
        return <Badge>never pushed</Badge>;
    }

    return function Lines() {
        var { state, error, reads, again } = okc.use('lines', {}, 10000);
        //THE CUTS, so the press below can offer them. Asked here rather than
        //inside it because a dialog cannot wait on a read.
        var board = okc.use('branchBoard', {}, 15000).state;
        var [picked, setPicked] = remember.use('lines', 'line', null);
        var [said, setSaid] = useState(null);
        var [busy, setBusy] = useState(null);

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Skeleton rows={4} /></Pane>;

        var all = state.lines || state.groups || [];
        var repos = state.repos || [];
        var on = all.filter(function (g) { return g.name === picked; })[0] || null;

        function tell(p) {
            return p.then(
                function (r) { setSaid({ text: r.note }); again(); },
                function (e) { setSaid({ bad: true, text: e.message }); }
            );
        }

        //---- fetching, and it only ever fast-forwards ----------------------
        //
        //THE ONLY THING ON THIS PANE THAT WRITES TO A REPOSITORY, and it writes
        //in the one direction that cannot lose anything: a branch that has moved
        //HERE is reported and left alone. A line that has moved on both sides
        //cannot be helped by this at all — the button says so rather than trying
        //and failing.
        //
        //STILL RELAYED. `lineSync` and `repoSync` run in the app being ported
        //from, because ../../git refuses every write and the door for them is
        //not built yet. Pressing these does the real thing, through the relay,
        //exactly as it does over there — and nothing here changes when they move.
        function syncLine(g) {
            setBusy(g.name);
            setSaid(null);
            return okc.call('lineSync', { name: g.name }).then(
                function (r) { setSaid({ bad: !!r.stuck, text: r.note }); again(); },
                function (e) { setSaid({ bad: true, text: e.message }); }
            ).then(function () { setBusy(null); });
        }

        function syncDefaults() {
            setBusy('*');
            setSaid(null);
            return okc.call('repoSync', {}).then(
                function (r) { setSaid({ bad: !r.moved, text: r.note }); again(); },
                function (e) { setSaid({ bad: true, text: e.message }); }
            ).then(function () { setBusy(null); });
        }

        //---- A LINE IS MADE OUT OF A CUT ------------------------------------
        //
        //THIS BUTTON USED TO CALL `lineSave` WITH NOTHING, which names whatever
        //branch each repository is on right now — and on this host that can
        //only ever be the default branches. `branchCreate` uses `git branch`
        //and not `checkout -b`, deliberately, so cutting a branch does not move
        //HEAD; and ../branches/freeing.js actively steps this host BACK onto its
        //defaults so a guest is able to push. Nothing in this app moves a
        //repository onto a work branch, because the work does not happen here.
        //
        //SO THE ONLY LINE THAT PRESS COULD EVER MAKE WAS A SECOND COPY OF
        //`default`, under a different name. It read as the way to make a line,
        //it was the only such button on the pane that lists lines, and it was
        //the one shape the chain does not have. Somebody asked for a line, was
        //given this, and made a branch cut instead — which is the same wrong
        //turn from the other direction.
        //
        //THE CHAIN IS: line → cut → LINE → PR cut. A line is what a cut
        //becomes once it carries something, so this asks which cut, and calls
        //the door that does that — the same `branchAsLine` the Branches Cut
        //pane calls. It is offered here as well because this is the pane
        //somebody is looking at when they want a line.
        //
        //`lineSave` IS NOT GONE and is not offered here. It is how the baseline
        //itself was made, once, and the CLI still has it.
        function name() {
            var could = (board && board.branches || []).filter(function (b) {
                //A CUT, NOT YET A LINE. `protected` covers both halves — a
                //branch a line already names, and a repository's own default.
                return b.cut && !b.protected && !(b.asDefault || []).length;
            });

            if (!could.length) {
                setSaid({
                    bad: true,
                    text: 'There is no cut to make a line out of. A line is what a branch cut becomes once it '
                        + 'carries something — cut one on Branches Cut first, put the work on it, then come back.'
                });
                return;
            }

            ask({
                title: 'Make a line out of a cut',
                plain: [
                    'A line is one branch per repository, moved and compared as one thing. This moves nothing and pushes nothing — it names a cut that already exists.',
                    //THE PROTECTION IS THE POINT AND IT IS EASY TO MISS. Said in
                    //the same words as the Branches Cut pane says it, because it
                    //is the same act and two descriptions of one act is how the
                    //two drift apart.
                    'AND IT PROTECTS THE BRANCH: no machine may push to it afterwards. Work goes onto its own cut and is merged in, which is what makes chaining safe.'
                ],
                fields: [
                    {
                        name: 'branch', label: 'Which cut', options: could.map(function (b) {
                            return { value: b.name, label: b.name + ' — ' + (b.summary || 'nothing on it yet') };
                        })
                    },
                    { name: 'name', label: 'Call the line', placeholder: 'leave blank to keep the branch name' },
                    { name: 'why', label: 'Why it exists', placeholder: 'what it is for, read six weeks from now' }
                ],
                cost: 'Machines stop being able to push to it.',
                confirm: 'Make it a line',
                onYes: function (f) {
                    var b = f.branch || could[0].name;
                    var title = (f.name || '').trim() || b;
                    return tell(okc.call('branchAsLine', { branch: b, name: title, why: f.why || undefined }))
                        .then(function () { setPicked(title); });
                }
            });
        }

        function propose(g) {
            ask({
                title: 'Propose "' + g.name + '" for landing?',
                plain: [
                    'It appears on the left of a comparison, as the thing being proposed rather than the thing being worked on.',
                    'Nothing is pushed and nothing is merged. Its branches stay exactly as they are, and stay protected.',
                    'Withdraw it to carry on working.'
                ],
                fields: [{ name: 'why', label: 'Why it is ready', placeholder: 'what was done, and what says it is finished' }],
                confirm: 'Propose it',
                onYes: function (f) { return tell(okc.call('linePropose', { name: g.name, why: f.why })); }
            });
        }

        //---- RETIRING, WHICH IS NOT FORGETTING ------------------------------
        //
        //FORGET IS "I do not want this line"; RETIRE IS "this landed, tidy it
        //up". They are different acts and the second is the one that was
        //missing, so a line that finished had no ending: four of the six here
        //had merged weeks earlier and were still named, still protecting their
        //branches, still taking a place a cut could have gone.
        //
        //THE BRANCHES ARE OFFERED AND NOT ASSUMED. Forgetting the line already
        //frees the board; deleting what it named is the part that cannot be
        //undone, so it is a box rather than a consequence.
        //
        //AND THE FORK IS NOT TOUCHED, said here rather than discovered. A branch
        //on somebody's fork is theirs, and a pull request open from one is on
        //it — ../repos/branchDeleteRemote is the door for that, pressed on
        //purpose.
        function retire(g) {
            ask({
                title: 'Retire the line "' + g.name + '"?',
                plain: [
                    'Its change landed in ' + (g.where || 'its target') + ', so this line has done its job.',
                    'It goes from this list, and its branches stop being protected by it.'
                ],
                //`checkbox`, WHICH IS THE NAME ../ui/theme/dialog.js ACTUALLY
                //TESTS FOR. This said `check` and would have rendered a text box
                //asking somebody to type the word — the same shape as the
                //`proposed` badge this file's own header records getting wrong,
                //and as `orphaned` on the pane next door. A name that is nearly
                //right is invisible.
                fields: [{
                    name: 'branches', label: 'Also delete the branches it named', type: 'checkbox',
                    hint: 'they are already merged. Anything on the fork is untouched either way'
                }],
                cost: 'The name, the reason and the arrangement are gone. Deleting the branches cannot be undone from here.',
                confirm: 'Retire it',
                protect: true,
                onYes: function (f) {
                    return tell(okc.call('lineRetire', {
                        name: g.name,
                        branches: !!(f && (f.branches === true || f.branches === 'true'))
                    })).then(function () { setPicked(null); });
                }
            });
        }

        function forget(g) {
            ask({
                title: 'Forget the line "' + g.name + '"?',
                danger: true,
                plain: [
                    'The line is gone from this list. Its branches are untouched — nothing is deleted and nothing is pushed.',
                    //BOTH HALVES, because the second is not obvious from the word
                    //"forget" and is the one with a consequence.
                    'They also stop being protected by it, so work can be done directly on them again.'
                ],
                cost: 'Whatever this line was measured against goes with it, and a change made from it is no longer named.',
                confirm: 'Forget it',
                //A PERSON'S PRESS. It is not undoable from here — the name, the
                //reason and the arrangement are gone.
                protect: true,
                onYes: function () {
                    return tell(okc.call('lineForget', { name: g.name })).then(function () { setPicked(null); });
                }
            });
        }

        return (
            <Pane>
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}
                {error ? <Note kind="bad">{error}</Note> : null}

                <Note>
                    A line names one branch per repository, so work can be cut from a point rather
                    than from a branch at a time. A line is protected: work is merged into one and
                    never done on one, which is what keeps it clean enough to open pull requests from.
                </Note>

                <Cols>
                    <Col narrow>
                        {/* `Grow` IS A SPACER, NOT A WRAPPER — it renders an
                            empty span and takes no children. This read
                            `<Grow>Lines</Grow>` and the heading came out blank
                            in both columns, which looks exactly like a heading
                            somebody chose not to have. Same shape as the
                            `proposed` badge above: a name that is nearly right
                            renders as nothing at all. */}
                        <TitleRow>
                            Lines<Grow />
                            <Plus title="Make a line out of a branch cut — a line is what a cut becomes once it carries something" onClick={name} />
                        </TitleRow>
                        <Stack>
                            {/* WHAT EACH REPOSITORY COUNTS FROM RIGHT NOW, read from
                                git rather than stored. Not a line, and first,
                                because it is what a new one would be made of. */}
                            <Card>
                                <CardTitle>
                                    HEAD branches
                                    <Grow />
                                    <Plus disabled={busy === '*'} onClick={syncDefaults}
                                        title="Fetch from origin and fast-forward every default branch. Only fast-forwards: anything that has moved on here is reported and left alone.">
                                        {busy === '*' ? '…' : '⟳'}
                                    </Plus>
                                </CardTitle>
                                <Kv>
                                    {repos.map(function (r) {
                                        return <KvRow key={r.repo} label={r.repo}><Mono>{r.on || '(none)'}</Mono></KvRow>;
                                    })}
                                </Kv>
                                <Note>
                                    What each repository is on, read from git and always protected. This is where
                                    work starts: cut a branch from here on Branches Cut, and name that cut a line
                                    once it carries something. A branch is measured against the line it was cut
                                    from, not against these.
                                </Note>
                            </Card>

                            {all.map(function (g) {
                                return (
                                    <Card key={g.name} pick on={g.name === picked} onClick={function () { setPicked(g.name); }}>
                                        <CardTitle>
                                            <Mono>{g.name}</Mono>
                                            {g.marked ? <span>{' '}<Badge kind="run">proposed</Badge></span> : null}
                                            {/* HOW IT ENDS, ON THE ROW. Four of
                                                the six lines here had landed and
                                                nothing said so — they read
                                                exactly like the baseline and
                                                like work still in progress. */}
                                            {g.ends === 'landed' ? <span>{' '}<Badge kind="ok">landed</Badge></span> : null}
                                            {g.ends === 'out' ? <span>{' '}<Badge kind="warn">out for review</Badge></span> : null}
                                            {g.receives ? <span>{' '}<Badge kind="muted">a baseline</Badge></span> : null}
                                        </CardTitle>
                                        <div className="muted">
                                            {(g.on || []).length + ' repositor' + ((g.on || []).length === 1 ? 'y' : 'ies')}
                                            {g.ends === 'landed' && g.where ? ' · landed in ' + g.where : ''}
                                            {g.receives ? ' · ' + g.receives + ' cut(s) made into it' : ''}
                                        </div>
                                    </Card>
                                );
                            })}
                        </Stack>
                        {!all.length ? <Empty>no lines yet — a line is what a change has to be before it can be compared or sent out</Empty> : null}
                    </Col>

                    <Col>
                        <TitleRow>{'What a line is — ' + all.length}<Grow /></TitleRow>
                        {!on ? <Panel><Empty>nothing picked</Empty></Panel> : (
                            <Panel>
                                {/* NAME, WHY AND THE SYNC ON ONE LINE, which is
                                    how the app being ported from draws it. The
                                    reason a line exists is the thing worth
                                    reading, and putting it on its own row below
                                    the name made the panel a stack of short
                                    lines hugging the left edge of a full-width
                                    column. */}
                                <CardTitle>
                                    <Mono>{on.name}</Mono>{' '}
                                    <Sync g={on} />
                                    {on.marked ? <span>{' '}<Badge kind="run">proposed</Badge></span> : null}
                                    {on.why ? <span>{' '}<Muted>{on.why}</Muted></span> : null}
                                    <Grow />
                                    <Plus disabled={busy === on.name}
                                        onClick={function () { syncLine(on); }}
                                        title={on.sync === 'conflict'
                                            ? 'Part of this line has moved on both sides. A fast-forward cannot help — see Conflicts.'
                                            : on.sync === 'behind'
                                                ? 'Fetch from origin and fast-forward every branch "' + on.name + '" names, as one act'
                                                : 'Every branch this line names already matches origin'}>
                                        {busy === on.name ? '…' : '⟳'}
                                    </Plus>
                                </CardTitle>

                                {/* NAME LEFT, FACTS RIGHT, and the facts travel
                                    together. `Part` is the kit's row for exactly
                                    this and its own comment says it was paid for
                                    once already IN THIS LIST — a `Kv` table
                                    hugs the left, which in a full-width column
                                    puts the branch three inches from the
                                    repository it belongs to and nowhere near the
                                    edge a reader scans down. */}
                                <Group>
                                    {(on.on || []).map(function (p) {
                                        return (
                                            <Part key={p.repo} right={
                                                <span>
                                                    <Mono>{p.branch}</Mono>
                                                    {p.at ? <span>{'  '}<Muted>{short(p.at)}</Muted></span> : null}
                                                    {/* GONE READS DIFFERENTLY FROM
                                                        NEVER MOVED. */}
                                                    {!p.there ? <span>{' '}<Badge kind="bad">gone</Badge></span> : null}
                                                    {p.there && p.state && p.state !== 'same'
                                                        ? <span>{' '}<Badge kind={p.state === 'diverged' ? 'bad' : 'warn'}>{p.state}</Badge></span>
                                                        : null}
                                                </span>
                                            }>{p.repo}</Part>
                                        );
                                    })}
                                </Group>

                                {on.broken.length ? <Note kind="bad">{on.broken.join('; ')}</Note> : null}
                                {on.missing.length ? (
                                    //NOT A FAULT, and the wording says so.
                                    <Note>{'Not named in ' + on.missing.join(', ') + ' — a line made when there were fewer repositories still describes those.'}</Note>
                                ) : null}
                                {on.marked ? (
                                    <Note kind="warn">
                                        {'Proposed ' + (day(on.marked.at) || '') + (on.marked.by ? ' by ' + on.marked.by : '')
                                            + (on.marked.why ? ' — ' + on.marked.why : '')}
                                    </Note>
                                ) : null}

                                <div className="row">
                                    {/* A LINE THAT HAS LANDED IS FINISHED, and
                                        what it wants is not "propose it" — that
                                        already happened, weeks ago in four cases
                                        here. Offering the next step of a flow
                                        that is over is how a board fills up with
                                        things nobody can tell apart. */}
                                    {on.ends === 'landed' ? null : on.marked
                                        ? <Button onClick={function () { return tell(okc.call('lineWithdraw', { name: on.name })); }}>
                                            Withdraw it
                                        </Button>
                                        : <Button kind="ok" onClick={function () { propose(on); }}>
                                            Propose it for landing
                                        </Button>}
                                    {on.ends === 'landed'
                                        ? <Button kind="ok" protect onClick={function () { retire(on); }}>Retire it</Button>
                                        : null}
                                    <Button kind="danger" protect onClick={function () { forget(on); }}>Forget it</Button>
                                </div>
                            </Panel>
                        )}
                    </Col>
                </Cols>

                <Note>{'read ' + reads + ' time(s), every 10s'}</Note>
            </Pane>
        );
    };
};
