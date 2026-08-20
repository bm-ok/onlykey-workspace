var React = require('react');
var { useState, useEffect, useRef } = React;

module.exports = function changes(theme, okc, remember) {
    var {
        Pane, Panel, Cols, Col, Card, CardTitle, CardSub,
        Badge, Button, Views, Skeleton, Empty, Note, Mono, Notice, ask, ago, Group, Head
    } = theme;

    //A REAL MINUS SIGN, not a hyphen. It sits beside a plus and has to read as
    //its opposite at a glance.
    var plusMinus = function (a, r) { return '+' + a + ' −' + r; };

    //A repository has nothing to show for three different reasons and they are
    //not the same news. Folding them together reports a broken setup as a
    //finished change.
    var carries = function (r) { return !r.missing && !r.noBase && !r.empty; };

    //---- the diff ----------------------------------------------------------
    //
    //A unified diff arrives already marked up: the first character of every line
    //says what it is, so the whole job is telling those three kinds apart. The
    //marks stay IN the text because a diff is copied into issues, where the
    //colour does not travel and the marks are the entire meaning.
    //
    //SIDE BY SIDE IS NOT PORTED and that is a gap rather than a decision. The old
    //window offers both and remembers which you used; the two-column version
    //needs the vendored editor for its gutters, its markers and its tied
    //scrolling — two columns that scroll independently being two views of two
    //files, which is what it exists to stop being — and that editor is not in
    //this app. Saying so beats a toggle that does nothing.
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
        var { state, error } = okc.use('changeDiff', {
            source: cmp.source, target: cmp.target, repo: pick.repo, file: pick.file
        }, 0);

        if (!state && error) return <Panel><Note kind="bad">{error}</Note></Panel>;
        if (!state) return <Panel><Skeleton rows={4} /></Panel>;

        return (
            <Panel>
                <CardTitle><Mono>{pick.repo + ' · ' + pick.file}</Mono></CardTitle>
                <CardSub>{state.base + ' → ' + state.head}</CardSub>
                {state.diff ? <Diff text={state.diff} /> : <Empty>no changes</Empty>}
                {/* THE REASON THIS GAVE STOPPED BEING TRUE. It said side by side
                    "needs the editor this app does not vendor" — and ui/editor
                    vendors ace now, so the sentence was describing a version of
                    the app that no longer exists. What is actually missing is
                    smaller and worth naming: two editors whose scrolling is tied
                    together. Two columns that scroll apart are two views of two
                    files, which is the thing side by side exists to stop being. */}
                <Note>Side by side is not built here yet — it needs two editors scrolled together, and only one is wired up.</Note>
            </Panel>
        );
    }

    //---- the pane ----------------------------------------------------------

    function Changes() {
        var lines = okc.use('lines', {}, 0);
        //WHICH TWO LINES, AND WHICH LOOK. Reading a change is not something
        //somebody finishes in one sitting, and coming back to a blank pane is
        //how a review gets started again from the top.
        var [from, setFrom] = remember.use('changes', 'from', null);
        var [into, setInto] = remember.use('changes', 'into', null);
        var [look, setLook] = remember.use('changes', 'look', 'files');
        var [cmp, setCmp] = useState(null);
        var [busy, setBusy] = useState(false);
        var [err, setErr] = useState(null);
        var [said, setSaid] = useState(null);
        //The file, too — it is the thing being read.
        var [pick, setPick] = remember.use('changes', 'file', null);

        //KEPT UNTIL THE QUESTION CHANGES. See the header: this is the expensive
        //pane. The key is a JSON pair rather than the two names joined — a line
        //is called things like "testing2 line", so a space is part of a name and
        //two different pairs could produce one key.
        var kept = useRef({ key: null, at: 0, value: null });

        var groups = (lines.state && lines.state.groups) || [];
        //A BROKEN LINE CANNOT BE COMPARED, so it is not offered. It names a
        //branch that is missing somewhere, and reading it produces an answer
        //about a thing that is not there.
        var usable = groups.filter(function (g) { return !(g.broken || []).length; });
        var proposed = usable.filter(function (g) { return g.marked; });

        useEffect(function () {
            if (!usable.length) return;
            //A PROPOSED LINE FIRST IF THERE IS ONE, because that is somebody
            //waiting on a read. Otherwise whatever is there: opening on nothing
            //is worse than opening on a pair that turns out to be level.
            var f = usable.some(function (g) { return g.name == from; })
                ? from
                : (proposed[0] || usable[0]).name;
            if (f != from) setFrom(f);

            var others = usable.filter(function (g) { return g.name != f; });
            if (!others.some(function (g) { return g.name == into; })) {
                //THE LINE IN USE IS WHAT WORK IS COUNTED FROM, so it is the one
                //a proposal almost always goes into. Guessed, not assumed — it
                //is a dropdown, and being wrong costs one click.
                var guess = others.filter(function (g) { return !g.marked; })[0] || others[0];
                setInto(guess ? guess.name : null);
            }
        }, [groups.length, from]);

        useEffect(function () {
            if (!from || !into || from == into) { setCmp(null); return; }
            var key = JSON.stringify([from, into]);
            if (kept.current.key == key && Date.now() - kept.current.at < 30000) {
                setCmp(kept.current.value);
                return;
            }
            setBusy(true);
            setPick(null);
            var alive = true;
            okc.call('changeRead', { source: from, target: into }).then(function (d) {
                kept.current = { key: key, at: Date.now(), value: d };
                if (!alive) return;
                setCmp(d); setErr(null); setBusy(false);
            }, function (e) {
                if (!alive) return;
                setErr(e.message); setCmp(null); setBusy(false);
            });
            return function () { alive = false; };
        }, [from, into]);

        //THE FIRST FILE, PICKED FOR YOU — and this effect sits with the others,
        //ABOVE every early return, which is the whole reason it is written here
        //rather than tucked beside the code that uses it.
        //
        //It was a helper called further down the body, after the "still loading"
        //returns. React counts hooks by call order, so on the render where the
        //data arrived it saw one more hook than the render before and threw
        //"Rendered more hooks than during the previous render" — taking the
        //whole pane down. The comment on that helper said it had to run
        //unconditionally. It was then called conditionally.
        var carrying = cmp ? (cmp.repos || []).filter(carries) : [];
        var shape = carrying.map(function (r) { return r.repo + ':' + (r.files || []).length; }).join('|');
        useEffect(function () {
            if (!carrying.length) return;
            var stillThere = pick && carrying.some(function (r) {
                return r.repo == pick.repo && (r.files || []).some(function (f) { return f.file == pick.file; });
            });
            if (stillThere) return;
            var first = carrying.filter(function (r) { return (r.files || []).length; })[0];
            setPick(first ? { repo: first.repo, file: first.files[0].file } : null);
        }, [shape]);

        if (!lines.state && lines.error) return <Pane><Note kind="bad">{lines.error}</Note></Pane>;
        if (!lines.state) return <Pane><Skeleton rows={3} /></Pane>;

        //NO LINES AT ALL IS DIFFERENT FROM NOTHING PROPOSED, and only the first
        //of those stops this pane working.
        if (!usable.length) {
            return (
                <Pane>
                    <Panel>
                        <Empty>No lines are named yet, so there is nothing to compare.</Empty>
                        <Empty>
                            A branch that carries finished work is made into a line — &ldquo;Make it a
                            line&rdquo;, on Branches. A line is what can be compared and sent.
                        </Empty>
                    </Panel>
                </Pane>
            );
        }

        //THE WHOLE DANCE ABOVE THIS IS GONE, AND WITH IT THE REASON FOR IT.
        //Two variables used to be computed here rather than in `className`,
        //under a comment explaining that the class guard reads every string
        //literal inside a className={...} and that hoisting the comparison once
        //was not enough. All of it was this pane working around a check because
        //the kit had no element for two views of one subject. It has one now —
        //`Views` — and the class lives in the kit where the guard expects it.
        var onFiles = look == 'files';

        var marked = usable.filter(function (g) { return g.name == from && g.marked; })[0];
        var others = usable.filter(function (g) { return g.name != from; });
        var repos = (cmp && cmp.repos) || [];

        function withdraw() {
            ask({
                title: 'Stop proposing "' + from + '"?',
                plain: [
                    'It stops being a proposal and goes back to being a line.',
                    'Its branches stay protected, because they are still named in a line. Forget the line on the Lines tab to build on them directly again.',
                    'Nothing that has already landed is undone.'
                ],
                confirm: 'Take it back',
                danger: true,
                onYes: function () {
                    return okc.call('lineWithdraw', { name: from }).then(
                        function (r) {
                            kept.current = { key: null, at: 0, value: null };
                            setSaid({ text: r.note || 'Taken back.' });
                            lines.again();
                        },
                        function (e) { setSaid({ bad: true, text: e.message }); throw e; }
                    );
                }
            });
        }

        return (
            <Pane>
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}

                {/* THE COMPARISON IS THE THING BEING READ, so the choice about
                    what is being compared stays on one row above it. */}
                <div className="change-pick">
                    <span className="muted">What</span>
                    <select value={from || ''} onChange={function (e) { setFrom(e.target.value); setPick(null); }}>
                        {usable.map(function (g) {
                            return <option key={g.name} value={g.name}>{g.name + (g.marked ? ' — proposed' : '')}</option>;
                        })}
                    </select>
                    <span className="muted">carries that</span>
                    <select value={into || ''} onChange={function (e) { setInto(e.target.value); setPick(null); }}>
                        {others.map(function (g) {
                            return <option key={g.name} value={g.name}>{g.name + (g.marked ? ' — proposed' : '')}</option>;
                        })}
                    </select>
                    <span className="muted">does not</span>
                    {/* WHO PROPOSED IT AND WHY, which is what turns a comparison
                        into somebody waiting on an answer. */}
                    {marked
                        ? <span className="muted">
                            {'proposed ' + ago(marked.marked.at)
                                + (marked.marked.by ? ' by ' + marked.marked.by : '')
                                + (marked.marked.why ? ' — ' + marked.marked.why : '')}
                        </span>
                        : null}
                </div>

                {err ? <Note kind="bad">{err}</Note> : null}
                {!into ? <Note kind="warn">There is no other line to compare it against. Name the line it would go into on the Lines tab.</Note> : null}
                {/* WHAT THIS PANE IS, AND THAT IT IS SAFE. The old window opens
                    with this and it was dropped in the port — which loses the
                    one sentence saying you may read everything here without
                    changing anything. On the pane whose whole job is the last
                    look before a change leaves this computer, that is the
                    sentence somebody most needs to have read. */}
                <Note>
                    What a proposed line would land, read before anything leaves this computer: the
                    commits, and the diff per repository. Nothing here changes anything &mdash; it is
                    the last look.
                </Note>

                {busy && !cmp ? <Skeleton rows={3} /> : null}

                {cmp ? (
                    <Cols>
                        <Col narrow>
                            <Views names={['Files', 'Commits']} on={look}
                                onPick={function (n) { setLook(n.toLowerCase()); }} />

                            {onFiles ? (
                                carrying.length ? carrying.map(function (r) {
                                    return (
                                        <div key={r.repo}>
                                            <div className="change-repo">
                                                {r.repo + ' — ' + r.files.length + (r.moreFiles ? '+' + r.moreFiles : '') + ' file(s)'}
                                            </div>
                                            {r.files.map(function (f) {
                                                var on = pick && pick.repo == r.repo && pick.file == f.file;
                                                return (
                                                    <button key={f.file} title={f.file}
                                                        className={'change-file' + (on ? ' on' : '')}
                                                        onClick={function () { setPick({ repo: r.repo, file: f.file }); }}>
                                                        {/* THE PATH READS RIGHT TO LEFT so a long one keeps
                                                            its FILENAME rather than its first directory.
                                                            Truncating the other way hides the only part
                                                            that tells two rows apart. */}
                                                        <span className="path">{f.file}</span>
                                                        {f.binary
                                                            ? <span className="muted">binary</span>
                                                            : <span>
                                                                <span className="plus">{'+' + f.added}</span>{' '}
                                                                <span className="minus">{'−' + f.removed}</span>
                                                            </span>}
                                                    </button>
                                                );
                                            })}
                                            {r.moreFiles
                                                ? <div className="card-sub">{'and ' + r.moreFiles + ' more not listed'}</div>
                                                : null}
                                        </div>
                                    );
                                }) : <Empty>No files differ.</Empty>
                            ) : (
                                carrying.length ? carrying.map(function (r) {
                                    return (
                                        <Group key={r.repo}>
                                            <Head>
                                                <span>{r.repo}</span>
                                                <span className="muted">{r.ahead + ' on top of ' + r.base}</span>
                                            </Head>
                                            {(r.commits || []).map(function (c) {
                                                return (
                                                    <div className="change-commit" key={c.sha}>
                                                        <span className="mono sha">{c.sha}</span>
                                                        <span className="subject">{c.subject}</span>
                                                        <span className="muted who">{c.who + ', ' + ago(c.at)}</span>
                                                    </div>
                                                );
                                            })}
                                            {r.more ? <div className="card-sub">{'and ' + r.more + ' more'}</div> : null}
                                        </Group>
                                    );
                                }) : <Empty>Nothing to land — these two lines carry the same commits.</Empty>
                            )}
                        </Col>

                        <Col>
                            <h2>What it carries</h2>
                            <Card>
                                <CardTitle>
                                    <span>{cmp.summary}</span>
                                    {cmp.anything
                                        ? <Badge>{plusMinus(cmp.added, cmp.removed)}</Badge>
                                        : <Badge kind="muted">nothing in it</Badge>}
                                </CardTitle>

                                {repos.map(function (r) {
                                    return (
                                        <div className="group-part" key={r.repo}>
                                            <span className="mono">{r.repo + '  ' + r.head + ' → ' + r.base}</span>
                                            <span className={r.missing ? 'muted' : r.noBase ? 'bad' : r.empty ? 'muted' : ''}>
                                                {r.missing ? 'not in this repository'
                                                    : r.noBase ? r.base + ' is not here'
                                                        : r.empty ? 'nothing to land'
                                                            : r.ahead + ' commit(s), ' + plusMinus(r.added, r.removed)}
                                            </span>
                                        </div>
                                    );
                                })}

                                {/* "WHY IS THAT REPOSITORY NOT LISTED" is the first
                                    question a reader has, so it is answered here
                                    rather than left to be worked out. */}
                                {(cmp.onlyInSource || []).length
                                    ? <CardSub>{cmp.onlyInSource.join(', ') + ' — in "' + cmp.source + '" only, so there is nowhere in "' + cmp.target + '" for it to land.'}</CardSub>
                                    : null}
                                {(cmp.onlyInTarget || []).length
                                    ? <CardSub>{cmp.onlyInTarget.join(', ') + ' — in "' + cmp.target + '" only; this line never reached it.'}</CardSub>
                                    : null}
                            </Card>

                            <Panel>
                                <div className="row">
                                    {/* DISABLED AND SAYING WHERE INSTEAD, rather
                                        than absent. Somebody looking for the
                                        button that sends a change should find out
                                        it is next door, not that it does not
                                        exist. */}
                                    <Button kind="ok" disabled
                                        title="Not here — a change is sent from the Cuts pane">
                                        Open pull requests
                                    </Button>
                                    <Button kind="danger" onClick={withdraw}
                                        disabled={!marked}
                                        title={marked
                                            ? 'Stop proposing this line, so work on it can continue'
                                            : 'this line is not proposed, so there is nothing to take back'}>
                                        Take it back
                                    </Button>
                                </div>

                                {/* THE ARGUMENT, KEPT, because it is the reason
                                    this pane cannot do the obvious thing and
                                    somebody will otherwise put it back. */}
                                <Note>
                                    <strong>Nothing here lands a change. </strong>
                                    {'A default branch is protected, and that includes from this app. "' + cmp.source
                                        + '" becomes one pull request per repository — '
                                        + (carrying.map(function (r) { return r.repo; }).join(', ') || 'none yet')
                                        + ' — tracked together so the change lands only when all of them do. That is the Cuts pane.'}
                                </Note>
                            </Panel>
                        </Col>

                        <Col wide>
                            <h2>The change</h2>
                            {onFiles
                                ? (pick
                                    ? <FileDiff key={pick.repo + ':' + pick.file} cmp={cmp} pick={pick} />
                                    : <Panel><Empty>pick a file on the left</Empty></Panel>)
                                : <Panel><Empty>the commits are on the left</Empty></Panel>}
                        </Col>
                    </Cols>
                ) : null}
            </Pane>
        );
    }

    return Changes;
};
