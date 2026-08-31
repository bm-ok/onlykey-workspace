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
        //TWO NAMES ON PURPOSE. `okc.use` hands back { state, error, reads, again }
        //and test/rules/ask-hook-shape.test.js holds every pane to reading only
        //those — so a hook assigned straight to its `.state` reads, to that
        //check, as a pane inventing fields on the hook itself.
        var boardRead = okc.use('branchBoard', {}, 15000);
        var board = boardRead.state;
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

            //---- AND THE HEAD BRANCHES, WHICH ARE ALWAYS THERE ------------
            //
            //THIS PANE WAS A DEAD END WITH NOTHING TO PROMOTE. A line was made
            //out of a cut and nothing else, so a workspace with no cuts had a
            //`+` that existed only to refuse — and the message told you to go
            //to another pane, cut a branch, and come back, which is a long way
            //round for "name where these repositories are now".
            //
            //THE SAME STARTING POINT ../branches OFFERS. Branches Cut takes HEAD
            //as a place to cut from; this takes it as a place to name. One idea,
            //offered in both places, rather than a rule that holds on one pane
            //and not the other.
            //
            //A DIFFERENT DOOR, BECAUSE IT IS A DIFFERENT ACT. Promoting a cut is
            //`branchAsLine` — one branch name, found wherever it exists. The
            //HEADs are a branch PER REPOSITORY and may differ, which is the whole
            //reason a line exists here, and `lineSave` is the door that takes
            //them.
            var heads = repos.filter(function (r) { return r.on; });

            //EVERY REPOSITORY IN THE WORKSPACE, because the dialog below asks
            //about each of them. `board.repos` is the workspace's own list;
            //`repos` here is only the ones that reported a HEAD, which is nearly
            //always the same list and is not the one to build a form from.
            var allRepos = (board && board.repos && board.repos.length)
                ? board.repos.slice()
                : repos.map(function (r) { return r.repo; });
            var picks = could.map(function (b) {
                return { value: 'cut:' + b.name, label: b.name + ' — ' + (b.summary || 'nothing on it yet') };
            });
            if (heads.length) {
                picks = picks.concat([{
                    value: 'head:',
                    label: 'HEAD branches — ' + heads.map(function (r) { return r.repo + ':' + r.on; }).join(', ')
                }]);
            }

            if (!picks.length && !allRepos.length) {
                setSaid({
                    bad: true,
                    text: 'There is nothing to make a line out of — this workspace has no repositories in it.'
                });
                return;
            }

            //---- ONE ROW PER REPOSITORY, WHICH IS WHAT A LINE IS -------------
            //
            //THIS ASKED FOR ONE POINT AND A LINE IS NOT ONE POINT. The record
            //has always held a repo-to-branch MAP -- `on` in lines.json, and
            //`lineSave` takes it -- and the dialog could only offer a branch
            //name that happened to exist in several repositories at once. So a
            //line whose repositories are on different branches could be stored,
            //read, compared and cut from, and could not be MADE here.
            //
            //WHICH IS THE ORDINARY CASE THE MOMENT ANYTHING IS BROUGHT DOWN
            //FROM ORIGIN ON ITS OWN: one repository on 5.7.0-modern-rewrite and
            //eight on master is a line somebody wants and could not name.
            function branchesIn(repo) {
                return (board && board.branches || [])
                    .filter(function (b) { return (b.in || []).indexOf(repo) >= 0; })
                    .map(function (b) { return b.name; })
                    .sort();
            }

            //---- AND THE POINT STAYS, AS THE THING THAT FILLS THEM IN --------
            //
            //NINE DROPDOWNS IS NINE DECISIONS, and the answer is usually "the
            //same cut everywhere". So the first field still offers the whole
            //shape at once and writes the rest, which are then there to be
            //corrected. See `fills` in ../../ui/theme/dialog.js.
            //
            //IT FILLS THE NAME AND THE REASON TOO, and only when they are still
            //empty. `branchAsLine` took the reason off the cut on the server,
            //where somebody could neither see it nor change it before it was
            //written; the same inheritance is worth more in the box, where it
            //can be read and edited.
            function fillsFrom(value, values) {
                var out = {};
                var typed = String((values && values.name) || '').trim();
                var said = String((values && values.why) || '').trim();

                if (value === 'head:') {
                    allRepos.forEach(function (r) {
                        var h = repos.filter(function (x) { return x.repo === r; })[0];
                        out['on:' + r] = (h && h.on) || '';
                    });
                    return out;
                }

                var b = String(value || '').replace(/^cut:/, '');
                if (!b) return out;

                var entry = (board && board.branches || []).filter(function (x) { return x.name === b; })[0];
                allRepos.forEach(function (r) {
                    out['on:' + r] = (entry && (entry.in || []).indexOf(r) >= 0) ? b : '';
                });

                if (!typed) out.name = b;
                if (!said && entry && entry.note && entry.note.reason) out.why = entry.note.reason;
                return out;
            }

            var fields = [{
                name: 'point',
                label: 'Start from',
                options: [{ value: '', label: 'pick each repository below' }].concat(picks),
                fills: fillsFrom,
                hint: 'Fills the rows below in one go. Change any of them afterwards.'
            }];

            allRepos.forEach(function (r) {
                fields.push({
                    name: 'on:' + r,
                    label: r,
                    //LEAVING ONE OUT IS A REAL ANSWER. A line does not have to
                    //name every repository, and a dropdown that cannot say
                    //"none" would put a branch in one it has nothing to do with.
                    options: [{ value: '', label: '— not in this line —' }]
                        .concat(branchesIn(r).map(function (n) { return { value: n, label: n }; }))
                });
            });

            fields.push({ name: 'name', label: 'Call the line', placeholder: 'leave blank to keep the branch name' });
            fields.push({ name: 'why', label: 'Why it exists', placeholder: 'what it is for, read six weeks from now' });

            ask({
                title: 'Name a line',
                plain: [
                    'A line is one branch per repository, moved and compared as one thing. This moves nothing and pushes nothing — it names branches that already exist.',
                    //THE PROTECTION IS THE POINT AND IT IS EASY TO MISS. Said in
                    //the same words as the Branches Cut pane says it, because it
                    //is the same act and two descriptions of one act is how the
                    //two drift apart.
                    'AND IT PROTECTS THE BRANCHES: no machine may push to them afterwards. Work goes onto its own cut and is merged in, which is what makes chaining safe.',
                    'They do not have to be the same branch, and it does not have to name every repository.'
                ],
                fields: fields,
                cost: 'Machines stop being able to push to what it names.',
                confirm: 'Name it',
                onYes: function (f) {
                    var on = {};
                    allRepos.forEach(function (r) {
                        var v = String(f['on:' + r] || '').trim();
                        if (v) on[r] = v;
                    });

                    if (!Object.keys(on).length) {
                        throw new Error('This names no branches. Pick one in at least one repository, '
                            + 'or start from a point above to fill them all in.');
                    }

                    var title = String(f.name || '').trim();
                    if (!title) {
                        //ONE NAME IS A NAME TO FALL BACK ON; several is not, and
                        //that is the whole reason a line has a name of its own.
                        var names = Object.keys(on).map(function (r) { return on[r]; })
                            .filter(function (v, i, a) { return a.indexOf(v) === i; });
                        if (names.length !== 1) {
                            throw new Error('Give the line a name. It names ' + names.join(', ')
                                + ', so there is no one branch name to call it after.');
                        }
                        title = names[0];
                    }

                    return tell(okc.call('lineSave', { name: title, why: f.why || undefined, on: on }))
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
