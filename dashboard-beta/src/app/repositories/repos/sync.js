var React = require('react');
var { useState, useEffect, useCallback } = React;

//---------------------------------------------------------------------------
//SYNC: THE WHOLE WORKSPACE, IN ONE PLACE, IN THE RIGHT ORDER.
//
//THREE COPIES OF EVERY DEFAULT BRANCH, AND THEY DRIFT IN ONE DIRECTION. A
//change lands in the repository work goes to; the person's fork is behind it;
//this host is behind the fork. Bringing them back is two acts per repository
//-- Sync fork (GitHub, one call) and then fetch-and-fast-forward here -- and
//before this pane they were a verb with no button and a button three panes
//away on a card about lines. One table, every repository, both standings,
//and one press that does all of it in the order that is correct.
//
//THE STANDINGS COME FROM THE SWEEP: `repositories` carries behindTarget (the
//fork against where its work goes, GitHub's compare) and inStep (this host
//against the fork). Nothing here is measured twice.
//
//---- AND THE THIRD DRIFT, WHICH THIS PANE DID NOT HAVE -------------------
//
//THERE ARE THREE GAPS, NOT TWO. A fork drifts from the project it was FORKED
//FROM; it drifts from where its work GOES; and this host drifts from the fork.
//The sentence at the top of this pane names three copies and the pane measured
//the last two.
//
//AND THE BUTTON WAS WIRED TO THE WRONG ONE. `Sync fork` presses `repoForkSync`,
//which is GitHub's merge-upstream and always pulls from the PARENT — but it was
//enabled off `behindTarget`, which measures where work GOES. In this workspace
//every repository sends work to its own fork, so `behindTarget` is null on all
//nine, so `Sync fork` was disabled on every card in the list, permanently,
//however far behind its parent the fork had drifted. Four of them had, and the
//only place that could be discovered was a button on a different tab that fixed
//it without saying what it had done.
//
//SO `repoForkBehind` IS READ HERE TOO, and it is what enables the button that
//acts on it. Read on arrival and after anything that could move it — never on a
//timer, because it is a call or two per repository and nothing about it changes
//while somebody reads the page.
//---------------------------------------------------------------------------

module.exports = function sync(theme, okc) {
    var { Pane, Panel, Stack, TitleRow, Grow, Card, CardTitle, CardSub, Badge, Badges,
        Button, Empty, Note, Notice, Skeleton, Mono, Muted, Kv, KvRow, KvSub, ago, ask } = theme;

    //---- WHAT A SYNC WOULD DO, ROW BY ROW, BEFORE IT DOES IT ---------------
    //
    //A CONFIRM DIALOG THAT DESCRIBES A CATEGORY IS NOT A DRY RUN. "Each fork's
    //default branch is pulled up from the repository it was forked from" is
    //true of every press ever made and says nothing about THIS one: how many
    //move, which, by how many commits, and which cannot move at all. Somebody
    //pressed it and came back with "i have no idea what that did" — and they
    //were right, because the only report was a count, after the fact.
    //
    //ALL FOUR FACTS ARE ON `repoForkBehind`, so all four are on the row. A fork
    //that is level says so rather than being left out: "nothing to do" is the
    //answer somebody is looking for as often as the other one.
    function ForkRows({ rows }) {
        if (!rows || !rows.length) return null;
        return (
            <Kv roomy>
                {rows.map(function (r) {
                    return (
                        <KvRow key={r.repo} label={r.repo}>
                            {r.why
                                ? <KvSub>{r.why}</KvSub>
                                : <React.Fragment>
                                    <div>
                                        <Mono>{r.branch}</Mono>{' '}
                                        <Badge kind={r.behind ? 'warn' : 'ok'}>
                                            {r.behind ? r.behind + ' behind' : 'level'}
                                        </Badge>
                                        {/* AHEAD IS NOT A PROBLEM AND IS THE
                                            WHOLE STORY on a fork a cut just
                                            merged into — it says the work is
                                            there, which is why there is
                                            nothing to pull down. */}
                                        {r.ahead ? <span>{' '}<Muted>{r.ahead + ' ahead'}</Muted></span> : null}
                                    </div>
                                    <KvSub>{'from ' + r.parent}</KvSub>
                                </React.Fragment>}
                        </KvRow>
                    );
                })}
            </Kv>
        );
    }

    //---- AND THE OTHER HALF OF THE PRESS ----------------------------------
    //
    //THE FORK TABLE WAS THE WHOLE DRY RUN, and "Catch up everything" is two
    //acts, not one: forks on GitHub, then a fetch into the working tree on this
    //computer. The second half was a sentence with a count in it while the first
    //had a row per repository — so the half that touches the files somebody has
    //open was the half described in the least detail.
    //
    //BOTH COMMITS, BECAUSE "behind" ON ITS OWN IS NOT CHECKABLE. `head` is what
    //is checked out here and `upstreamHead` is what the fork is at; a person who
    //wants to know what is about to arrive can read the two and go and look.
    function HereRows({ rows }) {
        if (!rows || !rows.length) return null;
        var at = function (s) { return s ? String(s).slice(0, 7) : '?'; };
        return (
            <Kv roomy>
                {rows.map(function (r) {
                    var h = hereOf(r);
                    return (
                        <KvRow key={r.repo} label={r.repo}>
                            <div>
                                <Mono>{r.default || 'default branch'}</Mono>{' '}
                                <Badge kind={h.kind}>{h.word}</Badge>
                            </div>
                            <KvSub>
                                {r.inStep === false
                                    ? 'at ' + at(r.head) + ' → ' + at(r.upstreamHead)
                                    : 'at ' + at(r.head)}
                            </KvSub>
                        </KvRow>
                    );
                })}
            </Kv>
        );
    }

    //---- WHERE ITS WORK GOES, WHICH IS NOT A QUESTION ABOUT BEING A FORK ----
    //
    //THIS LED WITH `!r.fork` AND ANSWERED "not a fork". True of
    //`onlykey-testing`, and an answer to the other question: its work goes to
    //`bm-ok/onlykey-testing`, which is its own remote, so it sends work to
    //itself exactly as all eight of its neighbours do. The badge said otherwise
    //and the badge is labelled "work goes".
    //
    //`behindTarget` IS NULL FOR THREE DIFFERENT REASONS and only one of them is
    //"it sends work to itself" — see where it is built: nothing picked, the
    //target IS this repository, or the target's default branch could not be
    //read. Read off the target rather than inferred from the absence, so the
    //three stop collapsing into whichever sentence was written first.
    function standingOf(r) {
        var bt = r.behindTarget || null;
        var to = (r.target && r.target.on) || null;
        var self = r.remote && r.remote.owner ? r.remote.owner + '/' + r.remote.repo : null;

        //NOWHERE PICKED IS NOT "LEVEL". A repository with no target cannot open
        //a pull request at all, which is worth saying rather than leaving as a
        //quiet muted word among eight that mean everything is fine.
        if (!to) return { fork: { word: 'nowhere picked', kind: 'warn' }, behind: 0 };
        if (self && to === self) return { fork: { word: 'sends work to itself', kind: 'muted' }, behind: 0 };
        if (!bt) return { fork: { word: 'goes to ' + to + ', not compared', kind: 'muted' }, behind: 0 };
        if (bt.why) return { fork: { word: 'could not compare', kind: 'warn' }, behind: 0, why: bt.why };
        if (bt.behind > 0) return { fork: { word: bt.behind + ' behind ' + bt.on, kind: 'warn' }, behind: bt.behind };
        return { fork: { word: 'level with ' + bt.on + (bt.ahead ? ' (' + bt.ahead + ' ahead)' : ''), kind: 'ok' }, behind: 0 };
    }

    //THE FORK AGAINST THE PROJECT IT CAME FROM. `repoForkBehind` answers one row
    //per repository, and every row is drawn — "level" is the answer somebody is
    //looking for as often as the other one, and a card that simply omits it
    //cannot be told from a card nobody asked about.
    function parentOf(r, rows) {
        if (!rows) return { word: 'asking GitHub…', kind: 'muted', behind: 0, asking: true };
        var w = rows.filter(function (x) { return x.repo === r.repo; })[0];
        if (!w) return { word: 'not asked', kind: 'muted', behind: 0 };
        if (w.why) return { word: w.why, kind: 'muted', behind: 0, why: w.why };
        if (w.behind > 0) {
            return {
                word: w.behind + ' behind ' + w.parent, kind: 'warn', behind: w.behind,
                from: w.parent, branch: w.branch
            };
        }
        //AHEAD IS THE WHOLE STORY ON A FORK A CUT JUST MERGED INTO. It says the
        //work is there, which is WHY there is nothing to pull down — without it
        //"level" reads as "nothing has happened".
        return {
            word: 'level with ' + w.parent + (w.ahead ? ' (' + w.ahead + ' ahead)' : ''),
            kind: 'ok', behind: 0, from: w.parent, branch: w.branch
        };
    }

    function hereOf(r) {
        if (!r.checked) return { word: 'not asked yet', kind: 'muted' };
        if (r.inStep === true) return { word: 'at your fork’s commit', kind: 'ok' };
        if (r.inStep === false) return { word: 'behind your fork', kind: 'warn' };
        return { word: 'not known', kind: 'muted' };
    }

    return function Sync() {
        var repos = okc.use('repositories', {}, 10000);
        var lines = okc.use('lines', {}, 15000);
        var [busy, setBusy] = useState(null);
        var [said, setSaid] = useState(null);

        //null while it has never been asked, so `parentOf` can say "asking"
        //rather than draw a standing it does not have.
        var [forks, setForks] = useState(null);

        var readForks = useCallback(function () {
            return okc.call('repoForkBehind', {}).then(function (v) {
                setForks((v && v.repos) || []); return v;
            }, function () {
                //A ROW PER REPOSITORY IS THE CONTRACT, so a failure is an empty
                //list and every card says "not asked" — never a stale standing
                //from before whatever went wrong.
                setForks([]); return null;
            });
        }, []);

        useEffect(function () { readForks(); }, [readForks]);

        function tell(p, after) {
            return p.then(
                function (r) { setSaid({ text: (r && r.note) || 'Done.', bad: !!(r && r.stuck) }); repos.again(); lines.again(); readForks(); if (after) after(r); },
                function (e) { setSaid({ bad: true, text: e.message }); }
            ).then(function () { setBusy(null); });
        }

        //---- NEITHER PRESS GOES WITHOUT SAYING WHAT IT WOULD DO -------------
        //
        //ASKED AT THE PRESS, not taken off the badges. The standings on screen
        //can be minutes old and a dry run that is minutes old is not a dry run
        //— it is the same guess with a table around it. One call, awaited, and
        //the badges are refreshed from the same answer on the way past.
        //
        //IF IT CANNOT BE READ the dialog says so and still offers the press.
        //Not knowing is a reason to be careful, not a reason to be unable to
        //act.
        function withRows(then) {
            return okc.call('repoForkBehind', {}).then(function (v) {
                var rows = (v && v.repos) || [];
                setForks(rows);
                return then(rows, false);
            }, function () { return then(forks || [], true); });
        }

        function everything() {
            return withRows(function (rows, blind) {
                var moving = rows.filter(function (r) { return r.behind > 0; });
                var behindHere = (repos.state && (repos.state.repos || []).filter(function (r) { return r.inStep === false; })) || [];
                //TWO SECTIONS, BECAUSE IT IS TWO ACTS. One happens on GitHub and
                //touches nothing on this computer; the other is a fetch into the
                //working tree here. Told as one list they read as one act with
                //some detail, and the half that changes files on this machine
                //was the half with no rows under it.
                return ask({
                    title: 'Catch the whole workspace up?',
                    wide: true,
                    plain: [
                        'Forks first, then this host — the other way round and this host fast-forwards onto a '
                            + 'fork that is itself behind.',
                        {
                            heading: 'GitHub: fork sync',
                            body: (
                                <div>
                                    <p>{blind
                                        ? 'GitHub could not be asked how far each fork is behind, so what follows '
                                            + 'is what the press does rather than what it would do here.'
                                        : moving.length
                                            ? moving.map(function (r) { return r.repo + ' (' + r.behind + ')'; }).join(', ')
                                                + ' pulled up from their parents. Every other fork is level and is left alone.'
                                            : 'Nothing. Every fork this app can ask about is already level with its parent.'}</p>
                                    <ForkRows rows={rows} />
                                </div>
                            )
                        },
                        {
                            heading: 'Remote → local',
                            body: (
                                <div>
                                    <p>{behindHere.length
                                        ? behindHere.length + ' default branch(es) fetched from your fork and '
                                            + 'fast-forwarded. Only fast-forwarded, never merged, so nothing you have '
                                            + 'here is rewritten.'
                                        : 'Nothing to fetch — every default branch here is already at its fork’s commit.'}</p>
                                    <HereRows rows={(repos.state && repos.state.repos) || []} />
                                </div>
                            )
                        }
                    ].filter(Boolean),
                    confirm: 'Catch it up',
                    onYes: function () { setBusy('*'); setSaid(null); return tell(okc.call('workspaceSync', {})); }
                });
            });
        }

        function forkSync(r) {
            return withRows(function (rows, blind) {
                var mine = rows.filter(function (x) { return x.repo === r.repo; });
                var w = mine[0] || null;
                return ask({
                    title: 'Pull ' + r.repo + ' up from its parent?',
                    wide: true,
                    plain: [
                        {
                            heading: 'GitHub: fork sync',
                            body: (
                                <div>
                                    <p>{blind || !w
                                        ? 'GitHub could not be asked how far this fork is behind, so what follows '
                                            + 'is what the press does rather than what it would do here.'
                                        : w.why
                                            ? 'It cannot be pulled up: ' + w.why
                                            : w.behind
                                                ? 'GitHub merges ' + w.parent + ' ' + w.branch + ' into your fork — '
                                                    + w.behind + ' commit(s), in one call.'
                                                : 'It is already level with ' + w.parent + ', so this would change nothing.'}</p>
                                    <ForkRows rows={mine} />
                                </div>
                            )
                        },
                        {
                            heading: 'Remote → local',
                            body: (
                                <div>
                                    <p>Nothing. This press only moves the fork on GitHub — the copy here stays
                                        where it is, and is a commit further behind afterwards than it was before.</p>
                                    <HereRows rows={((repos.state && repos.state.repos) || [])
                                        .filter(function (x) { return x.repo === r.repo; })} />
                                </div>
                            )
                        }
                    ].filter(Boolean),
                    confirm: w && w.behind ? 'Pull it up' : 'Sync it anyway',
                    onYes: function () {
                        setBusy('fork:' + r.repo); setSaid(null);
                        return tell(okc.call('repoForkSync', { repo: r.repo }).then(function (x) {
                            return okc.call('repositoriesCheck', { repo: r.repo }).then(function () { return x; });
                        }));
                    }
                });
            });
        }
        function pullHere(r) { setBusy('here:' + r.repo); setSaid(null); return tell(okc.call('repoSyncBranch', { repo: r.repo, branch: r.default || undefined })); }
        function askGitHub() { setBusy('ask'); setSaid(null); return tell(okc.call('repositoriesCheck', {})); }
        function syncLine(g) { setBusy('line:' + g.name); setSaid(null); return tell(okc.call('lineSync', { name: g.name })); }

        if (repos.error && !repos.state) return <Pane><Note kind="bad">{repos.error}</Note></Pane>;
        if (!repos.state) return <Pane><Skeleton rows={4} /></Pane>;

        var rows = repos.state.repos || [];
        var forksBehind = rows.filter(function (r) { return standingOf(r).behind > 0; }).length;
        var parentBehind = rows.filter(function (r) { return parentOf(r, forks).behind > 0; }).length;
        var hereBehind = rows.filter(function (r) { return r.inStep === false; }).length;
        var allLines = (lines.state && (lines.state.lines || lines.state.groups)) || [];
        var linesBehind = allLines.filter(function (g) { return g.sync === 'behind' || g.sync === 'conflict'; }).length;
        var oldest = rows.map(function (r) { return r.checked; }).filter(Boolean).sort()[0] || null;

        return (
            <Pane>
                <Note>
                    Three gaps per repository and they close in one order: your fork behind the project it was
                    forked from, your fork behind where its work goes, and this host behind your fork. Every card
                    says where it stands on all three, and every press that closes one is here.
                </Note>
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}

                <Panel>
                    <CardTitle>
                        <span>The workspace</span>
                        <Grow />
                        {parentBehind ? <Badge kind="warn">{parentBehind + ' fork(s) behind their parent'}</Badge> : null}
                        {forksBehind ? <Badge kind="warn">{forksBehind + ' behind where work goes'}</Badge> : null}
                        {hereBehind ? <Badge kind="warn">{hereBehind + ' behind here'}</Badge> : null}
                        {!parentBehind && !forksBehind && !hereBehind && oldest && forks
                            ? <Badge kind="ok">everything level</Badge> : null}
                        <span className="muted">{oldest ? 'asked GitHub ' + ago(oldest) : 'not asked yet'}</span>
                    </CardTitle>
                    <div className="row" style={{ marginTop: '8px' }}>
                        <Button kind="ok" disabled={!!busy} onClick={everything}
                            title="Every fork behind where its work goes is synced on GitHub, then every default branch here is fetched and fast-forwarded, then GitHub is asked again">
                            {busy === '*' ? 'catching up…' : 'Catch up everything'}
                        </Button>
                        <Button disabled={!!busy} onClick={askGitHub} title="Re-read every repository's standing from GitHub">
                            {busy === 'ask' ? 'asking…' : 'Ask GitHub again'}
                        </Button>
                    </div>
                </Panel>

                <TitleRow>Repositories<Grow /><span className="muted">{rows.length}</span></TitleRow>
                {!rows.length
                    ? <Panel><Empty>No repositories in this workspace.</Empty></Panel>
                    : <Stack>
                        {rows.map(function (r) {
                            var s = standingOf(r);
                            var p = parentOf(r, forks);
                            var h = hereOf(r);
                            return (
                                <Card key={r.repo}>
                                    <CardTitle>
                                        <Mono>{r.repo}</Mono>
                                        <span className="muted">{r.default ? ' ' + r.default : ''}</span>
                                        <Grow />
                                        {/* THE THREE GAPS IN THE ORDER THE
                                            SENTENCE AT THE TOP NAMES THEM, so
                                            reading left to right is reading a
                                            change's way down to this host. */}
                                        <Badge kind={p.kind}>{'parent: ' + p.word}</Badge>
                                        <Badge kind={s.fork.kind}>{'work goes: ' + s.fork.word}</Badge>
                                        <Badge kind={h.kind}>{'here: ' + h.word}</Badge>
                                    </CardTitle>
                                    {s.why ? <CardSub><span className="muted">{s.why}</span></CardSub> : null}
                                    <div className="row" style={{ marginTop: '6px' }}>
                                        {/*---- ENABLED OFF THE AXIS IT ACTS ON

                                            This read `s.behind` — the fork
                                            against where work GOES — while the
                                            press it fires merges from the
                                            PARENT. Where those are the same
                                            repository the button was dead on
                                            every card in the workspace. */}
                                        <Button kind="ok" disabled={!!busy || !p.behind} onClick={function () { forkSync(r); }}
                                            title={p.behind
                                                ? 'GitHub merges ' + p.from + ' ' + p.branch + ' into your fork, one call'
                                                : p.asking ? 'still asking GitHub how far behind it is'
                                                    : p.why ? p.why : 'already level with ' + (p.from || 'its parent')}>
                                            {busy === 'fork:' + r.repo ? 'syncing…' : 'Sync fork'}
                                        </Button>
                                        <Button disabled={!!busy || r.inStep === true} onClick={function () { pullHere(r); }}
                                            title={r.inStep === true ? 'already at your fork’s commit' : 'fetch from your remote and fast-forward ' + (r.default || 'the default branch')}>
                                            {busy === 'here:' + r.repo ? 'pulling…' : 'Pull ' + (r.default || 'default') + ' here'}
                                        </Button>
                                    </div>
                                </Card>
                            );
                        })}
                    </Stack>}

                <TitleRow>Lines<Grow /><span className="muted">{lines.state ? allLines.length : ''}</span></TitleRow>
                {!lines.state
                    ? <Skeleton rows={2} />
                    : !allLines.length
                        ? <Panel><Empty>No lines are named.</Empty></Panel>
                        : <Stack>
                            {allLines.map(function (g) {
                                var kind = g.sync === 'ok' ? 'ok' : g.sync === 'conflict' ? 'bad' : g.sync === 'behind' ? 'warn' : 'muted';
                                var word = g.sync === 'ok' ? 'in step' : g.sync === 'conflict' ? 'moved on both sides' : g.sync === 'behind' ? 'a part is behind' : 'never pushed';
                                return (
                                    <Card key={g.name}>
                                        <CardTitle>
                                            <Mono>{g.name}</Mono>
                                            <Grow />
                                            <Badge kind={kind}>{word}</Badge>
                                        </CardTitle>
                                        <Badges>
                                            {(g.on || []).map(function (o) {
                                                return <span key={o.repo} className="muted">{o.repo + ' ' + o.branch}</span>;
                                            })}
                                        </Badges>
                                        <div className="row" style={{ marginTop: '6px' }}>
                                            <Button disabled={!!busy || g.sync === 'ok'} onClick={function () { syncLine(g); }}
                                                title={g.sync === 'ok' ? 'every branch it names is at origin' : 'fetch and fast-forward every branch this line names'}>
                                                {busy === 'line:' + g.name ? 'syncing…' : 'Sync the line'}
                                            </Button>
                                        </div>
                                    </Card>
                                );
                            })}
                        </Stack>}
                {linesBehind ? <Note kind="warn">{linesBehind + ' line(s) have a part behind or moved on both sides.'}</Note> : null}
            </Pane>
        );
    };
};
