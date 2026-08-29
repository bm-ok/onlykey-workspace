var React = require('react');
var { useState } = React;

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
//---------------------------------------------------------------------------

module.exports = function sync(theme, okc) {
    var { Pane, Panel, Stack, TitleRow, Grow, Card, CardTitle, CardSub, Badge, Badges,
        Button, Empty, Note, Notice, Skeleton, Mono, ago } = theme;

    function standingOf(r) {
        var bt = r.behindTarget || null;
        if (!r.fork) return { fork: { word: 'not a fork', kind: 'muted' }, behind: 0 };
        if (!bt) return { fork: { word: 'sends work to itself', kind: 'muted' }, behind: 0 };
        if (bt.why) return { fork: { word: 'could not compare', kind: 'warn' }, behind: 0, why: bt.why };
        if (bt.behind > 0) return { fork: { word: bt.behind + ' behind ' + bt.on, kind: 'warn' }, behind: bt.behind };
        return { fork: { word: 'level with ' + bt.on + (bt.ahead ? ' (' + bt.ahead + ' ahead)' : ''), kind: 'ok' }, behind: 0 };
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

        function tell(p, after) {
            return p.then(
                function (r) { setSaid({ text: (r && r.note) || 'Done.', bad: !!(r && r.stuck) }); repos.again(); lines.again(); if (after) after(r); },
                function (e) { setSaid({ bad: true, text: e.message }); }
            ).then(function () { setBusy(null); });
        }

        function everything() { setBusy('*'); setSaid(null); return tell(okc.call('workspaceSync', {})); }
        function forkSync(r) { setBusy('fork:' + r.repo); setSaid(null); return tell(okc.call('repoForkSync', { repo: r.repo }).then(function (x) { return okc.call('repositoriesCheck', { repo: r.repo }).then(function () { return x; }); })); }
        function pullHere(r) { setBusy('here:' + r.repo); setSaid(null); return tell(okc.call('repoSyncBranch', { repo: r.repo, branch: r.default || undefined })); }
        function askGitHub() { setBusy('ask'); setSaid(null); return tell(okc.call('repositoriesCheck', {})); }
        function syncLine(g) { setBusy('line:' + g.name); setSaid(null); return tell(okc.call('lineSync', { name: g.name })); }

        if (repos.error && !repos.state) return <Pane><Note kind="bad">{repos.error}</Note></Pane>;
        if (!repos.state) return <Pane><Skeleton rows={4} /></Pane>;

        var rows = repos.state.repos || [];
        var forksBehind = rows.filter(function (r) { return standingOf(r).behind > 0; }).length;
        var hereBehind = rows.filter(function (r) { return r.inStep === false; }).length;
        var allLines = (lines.state && (lines.state.lines || lines.state.groups)) || [];
        var linesBehind = allLines.filter(function (g) { return g.sync === 'behind' || g.sync === 'conflict'; }).length;
        var oldest = rows.map(function (r) { return r.checked; }).filter(Boolean).sort()[0] || null;

        return (
            <Pane>
                <Note>
                    Three copies of every default branch, and they drift one way: a change lands where work goes,
                    your fork is behind it, this host is behind your fork. Catching up is those two steps in that
                    order, and this is where all of them are.
                </Note>
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}

                <Panel>
                    <CardTitle>
                        <span>The workspace</span>
                        <Grow />
                        {forksBehind ? <Badge kind="warn">{forksBehind + ' fork(s) behind'}</Badge> : null}
                        {hereBehind ? <Badge kind="warn">{hereBehind + ' behind here'}</Badge> : null}
                        {!forksBehind && !hereBehind && oldest ? <Badge kind="ok">everything level</Badge> : null}
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
                            var h = hereOf(r);
                            return (
                                <Card key={r.repo}>
                                    <CardTitle>
                                        <Mono>{r.repo}</Mono>
                                        <span className="muted">{r.default ? ' ' + r.default : ''}</span>
                                        <Grow />
                                        <Badge kind={s.fork.kind}>{'fork: ' + s.fork.word}</Badge>
                                        <Badge kind={h.kind}>{'here: ' + h.word}</Badge>
                                    </CardTitle>
                                    {s.why ? <CardSub><span className="muted">{s.why}</span></CardSub> : null}
                                    <div className="row" style={{ marginTop: '6px' }}>
                                        <Button kind="ok" disabled={!!busy || !s.behind} onClick={function () { forkSync(r); }}
                                            title={s.behind ? 'GitHub merges ' + r.behindTarget.on + ' ' + r.behindTarget.base + ' into your fork, one call' : 'nothing to sync from'}>
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
