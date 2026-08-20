var React = require('react');
var { useState, useEffect } = React;
var useAsk = require('../okc/ask');

//---------------------------------------------------------------------------
//Changes: what one line carries that another does not.
//
//THE QUESTION THIS ANSWERS IS THE ONE ASKED BEFORE SENDING. A change spans
//several repositories, so "what is in this" is a question about all of them
//together, and each repository can only answer its own third. Reading three
//separate comparisons and holding them in your head is how a half-empty change
//gets sent — and it is exactly the case the whole idea of a line exists to
//prevent.
//
//COMPARED, NOT MERGED. Nothing here writes anything. It reads two lines and
//says what the difference is, which is what somebody needs before pressing
//anything on the Cuts pane next door.
//
//A REPOSITORY THAT CARRIES NOTHING IS A REAL ANSWER. A change that touches two
//of three is ordinary; a change that touches ONE when it should touch three is
//the half-landed case. Both look identical unless the empty ones are on the
//screen saying they are empty, so they are.
//---------------------------------------------------------------------------

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    require('./changes.scss');
    var { shell, theme, okc } = imports;
    var {
        Pane, Panel, Cols, Col, Stack, Card, CardTitle, CardSub,
        Badge, Button, Skeleton, Empty, Note, Mono, Spec, Kv, KvRow, Notice, ask
    } = theme;

    //---- the diff ----------------------------------------------------------
    //
    //A unified diff arrives already marked up: the first character of every line
    //says what it is. So the whole job here is telling those three kinds apart
    //at a glance, and the marks are kept in the text because a diff is something
    //people copy into an issue, where the colour does not travel and the marks
    //are the entire meaning.
    function Diff({ text }) {
        var lines = String(text || '').split('\n');
        return (
            <pre className="diff">
                {lines.map(function (l, i) {
                    var kind = 'l';
                    if (l.slice(0, 2) == '@@') kind = 'l hunk';
                    else if (l.slice(0, 3) == '+++' || l.slice(0, 3) == '---' || l.slice(0, 5) == 'diff ' || l.slice(0, 6) == 'index ') kind = 'l meta';
                    else if (l[0] == '+') kind = 'l add';
                    else if (l[0] == '-') kind = 'l del';
                    return <span className={kind} key={i}>{l === '' ? ' ' : l}</span>;
                })}
            </pre>
        );
    }

    function FileDiff({ cmp, pick }) {
        var { state, error } = useAsk(okc, 'changeDiff', {
            source: cmp.source, target: cmp.target, repo: pick.repo, file: pick.file
        }, 0);

        if (!state && error) return <Panel><Note kind="bad">{error}</Note></Panel>;
        if (!state) return <Panel><Skeleton rows={3} /></Panel>;

        return (
            <Panel>
                <CardTitle><Mono>{pick.file}</Mono></CardTitle>
                <CardSub>{pick.repo + ' — ' + state.base + ' → ' + state.head}</CardSub>
                {state.diff
                    ? <Diff text={state.diff} />
                    : <Empty>no textual difference — it may be a binary file, or a mode change</Empty>}
            </Panel>
        );
    }

    //---- the pane ----------------------------------------------------------

    function Changes() {
        var lines = useAsk(okc, 'lines', {}, 0);
        var [from, setFrom] = useState(null);
        var [into, setInto] = useState('default');
        var [cmp, setCmp] = useState(null);
        var [busy, setBusy] = useState(false);
        var [err, setErr] = useState(null);
        var [said, setSaid] = useState(null);
        var [pick, setPick] = useState(null);

        var groups = (lines.state && lines.state.groups) || [];

        //THE FIRST LINE THAT IS NOT THE TARGET, so the pane opens on something
        //rather than on two empty dropdowns. Opening empty is a screen that
        //looks broken and is only waiting to be told what to compare.
        useEffect(function () {
            if (from || !groups.length) return;
            var first = groups.filter(function (g) { return g.name != into; })[0];
            if (first) setFrom(first.name);
        }, [groups.length]);

        useEffect(function () {
            if (!from || !into || from == into) { setCmp(null); return; }
            setBusy(true);
            setPick(null);
            var alive = true;
            okc.call('changeRead', { source: from, target: into }).then(function (d) {
                if (!alive) return;
                setCmp(d); setErr(null); setBusy(false);
            }, function (e) {
                if (!alive) return;
                setErr(e.message); setCmp(null); setBusy(false);
            });
            return function () { alive = false; };
        }, [from, into]);

        if (!lines.state && lines.error) return <Pane><Note kind="bad">{lines.error}</Note></Pane>;
        if (!lines.state) return <Pane><Skeleton rows={3} /></Pane>;

        function withdraw() {
            ask({
                title: 'Take "' + from + '" back out of being proposed?',
                plain: [
                    'It stops being proposed, and work on it can continue.',
                    'Nothing on GitHub changes, and nothing here is deleted.'
                ],
                confirm: 'Withdraw it',
                onYes: function () {
                    return okc.call('lineWithdraw', { name: from }).then(
                        function (r) { setSaid({ text: r.note || 'Withdrawn.' }); },
                        function (e) { setSaid({ bad: true, text: e.message }); throw e; }
                    );
                }
            });
        }

        var repos = (cmp && cmp.repos) || [];
        var carrying = repos.filter(function (r) { return r.ahead; });

        return (
            <Pane>
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}

                {/* THE CHOICE IS ABOUT WHAT IS BEING COMPARED and stays on one
                    row above everything, because the comparison is the thing
                    being read and should get the width. */}
                <div className="change-pick">
                    <span className="muted">What</span>
                    <select value={from || ''} onChange={function (e) { setFrom(e.target.value); }}>
                        {groups.map(function (g) { return <option key={g.name} value={g.name}>{g.name}</option>; })}
                    </select>
                    <span className="muted">carries that</span>
                    <select value={into} onChange={function (e) { setInto(e.target.value); }}>
                        {groups.map(function (g) { return <option key={g.name} value={g.name}>{g.name}</option>; })}
                    </select>
                    <span className="muted">does not</span>
                    <Button disabled={!from || from == into || busy}
                        onClick={function () { var f = from; setFrom(null); setTimeout(function () { setFrom(f); }, 0); }}>
                        {busy ? 'comparing…' : 'Compare again'}
                    </Button>
                </div>

                {err ? <Note kind="bad">{err}</Note> : null}
                {from == into ? <Note kind="warn">Those are the same line. Pick two different ones.</Note> : null}

                {busy && !cmp ? <Skeleton rows={3} /> : null}

                {cmp ? (
                    <Cols>
                        <Col narrow>
                            <h2>Files <span className="muted">{cmp.files ? '— ' + cmp.files : ''}</span></h2>
                            {carrying.length ? (
                                <Stack>
                                    {carrying.map(function (r) {
                                        return (
                                            <div key={r.repo}>
                                                <CardSub><Mono>{r.repo}</Mono></CardSub>
                                                {(r.files || []).map(function (f) {
                                                    var id = r.repo + ':' + f.file;
                                                    var on = pick && (pick.repo + ':' + pick.file) == id;
                                                    return (
                                                        <Card key={id} pick on={on}
                                                            onClick={function () { setPick({ repo: r.repo, file: f.file }); }}>
                                                            <CardTitle><Mono>{f.file}</Mono></CardTitle>
                                                            <CardSub>
                                                                <span className="ok">{'+' + f.added}</span>{' '}
                                                                <span className="bad">{'-' + f.removed}</span>
                                                                {f.binary ? <span>{' '}<Badge kind="muted">binary</Badge></span> : null}
                                                            </CardSub>
                                                        </Card>
                                                    );
                                                })}
                                                {r.moreFiles
                                                    ? <CardSub>{'and ' + r.moreFiles + ' more'}</CardSub>
                                                    : null}
                                            </div>
                                        );
                                    })}
                                </Stack>
                            ) : <Empty>nothing is carried — the two lines are level</Empty>}
                        </Col>

                        <Col>
                            <h2>What it carries</h2>
                            <Panel>
                                <CardTitle>{cmp.summary || 'nothing'}</CardTitle>
                                <CardSub>
                                    {cmp.commits + ' commit(s), ' + cmp.files + ' file(s), '}
                                    <span className="ok">{'+' + cmp.added}</span>{' '}
                                    <span className="bad">{'-' + cmp.removed}</span>
                                </CardSub>

                                {/* EVERY REPOSITORY, INCLUDING THE EMPTY ONES.
                                    A change that touches one of three when it
                                    should touch three looks exactly like a
                                    change that touches one on purpose, unless
                                    the other two are on the screen saying they
                                    carry nothing. */}
                                <Kv>
                                    {repos.map(function (r) {
                                        return (
                                            <KvRow key={r.repo} label={r.repo}>
                                                {r.missing
                                                    ? <span className="muted">does not have this branch</span>
                                                    : r.ahead
                                                        ? r.ahead + ' commit' + (r.ahead == 1 ? '' : 's') + ' past ' + r.base
                                                        : <span className="muted">{'carries nothing — level with ' + r.base}</span>}
                                            </KvRow>
                                        );
                                    })}
                                </Kv>
                            </Panel>

                            {carrying.length ? (
                                <Panel>
                                    <CardTitle>Commits</CardTitle>
                                    {carrying.map(function (r) {
                                        return (
                                            <Spec key={r.repo} summary={r.repo + ' — ' + r.ahead}>
                                                <Kv>
                                                    {(r.commits || []).map(function (c) {
                                                        return (
                                                            <KvRow key={c.sha} label={c.sha}>
                                                                <div>{c.subject}</div>
                                                                {/* WHO WROTE IT IS A MACHINE'S NAME
                                                                    here, and that is worth seeing: it
                                                                    is how somebody tells work a person
                                                                    did from work a run did. */}
                                                                <div className="muted">{(c.who || '') + (c.at ? ' · ' + String(c.at).slice(0, 10) : '')}</div>
                                                            </KvRow>
                                                        );
                                                    })}
                                                </Kv>
                                                {r.more ? <Note>{'and ' + r.more + ' more'}</Note> : null}
                                            </Spec>
                                        );
                                    })}
                                </Panel>
                            ) : null}

                            <Panel>
                                <div className="row">
                                    <Button onClick={withdraw}
                                        title={'Take ' + from + ' back out of being proposed'}>
                                        Withdraw it
                                    </Button>
                                </div>
                                <Note>
                                    Nothing on this pane writes anything. Sending and merging are next door,
                                    under Cuts.
                                </Note>
                            </Panel>
                        </Col>

                        <Col wide>
                            <h2>The change</h2>
                            {pick
                                ? <FileDiff key={pick.repo + ':' + pick.file} cmp={cmp} pick={pick} />
                                : <Panel><Empty>pick a file on the left</Empty></Panel>}
                        </Col>
                    </Cols>
                ) : null}
            </Pane>
        );
    }

    shell.pane({ tab: 'Repositories', name: 'Changes', order: 25, Component: Changes });

    await register(null, {});
}
module.exports = plugin;
