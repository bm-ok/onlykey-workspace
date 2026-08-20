var React = require('react');
var { useState, useEffect, useRef } = React;

module.exports = function changes(theme, okc, remember) {
    var {
        Pane, Panel, Cols, Col, Card, CardTitle, CardSub,
        Badge, Button, Views, Toggle, Code, Skeleton, Empty, Note, Mono, Notice, ask, ago, Group, Head
    } = theme;

    //A REAL MINUS SIGN, not a hyphen. It sits beside a plus and has to read as
    //its opposite at a glance.
    var plusMinus = function (a, r) { return '+' + a + ' −' + r; };

    //WHICH KIND, ON EVERY ENTRY. A dropdown holding both would otherwise be one
    //alphabetical run in which a line and a branch look identical — and they are
    //not the same kind of thing to compare. A line reaching fewer repositories
    //than there are says so, because that changes what the answer means before
    //anything is compared.
    var label = function (g) {
        if (!g.branch) {
            return g.name + (g.marked ? ' — proposed' : ' — line')
                + (g.repos && g.repos.length ? ' (' + g.repos.length + ')' : '');
        }
        return g.name + ' — branch (' + ((g.repos || []).length) + ')';
    };

    //A repository has nothing to show for three different reasons and they are
    //not the same news. Folding them together reports a broken setup as a
    //finished change.
    //A REPOSITORY CARRIES SOMETHING when it has both sides and there is a
    //difference. The four answers a row can give — neither, only one, both with
    //nothing, both with something — are the server half's, and only the last is
    //a change to read.
    var carries = function (r) { return r.has === 'both' && (r.files || []).length > 0; };

    //---- the diff ----------------------------------------------------------
    //
    //A unified diff arrives already marked up: the first character of every line
    //says what it is, so the whole job is telling those three kinds apart. The
    //marks stay IN the text because a diff is copied into issues, where the
    //colour does not travel and the marks are the entire meaning.
    //
    //THIS IS ONE OF THE TWO READINGS NOW — see `SideBySide` below, and the switch
    //between them. This one stays the default because it is the right thing for a
    //change of any size; the other answers a different question and costs two
    //file reads to do it.
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

    //---- side by side ------------------------------------------------------
    //
    //THE TWO READINGS ANSWER DIFFERENT QUESTIONS, which is why this is a switch
    //and not a replacement. A unified diff answers "what changed" and is the
    //right thing to read for a change of any size. Side by side answers "what is
    //this file now, and what was it" — which is what somebody wants when the
    //change is three lines and the code AROUND those lines is the actual
    //question, and what a `<pre>` of `@@ -1 +1 @@` cannot show at all.
    //
    //IT IS `Code` FROM THE KIT, so it is the same read-only editor the approval
    //dialogs use — syntax coloured, not editable, cursor hidden. Two of them, one
    //per side.
    //
    //A MISSING SIDE IS AN ANSWER. A file added on the head has no `before` and a
    //deleted one has no `after`; the server half answers `null` for those, and an
    //empty half that SAYS why reads as the file having been added rather than as
    //something having failed to load.
    function SideBySide({ cmp, pick }) {
        var { state, error } = okc.use('compareFile', {
            base: cmp.base, head: cmp.head, repo: pick.repo, file: pick.file
        }, 0);

        if (!state && error) return <Note kind="bad">{error}</Note>;
        if (!state) return <Skeleton rows={4} />;

        //THE MODE FROM THE FILE'S OWN NAME. The kit defaults to plain text on
        //purpose — most of what this app shows is prose — but a file called
        //`.js` is not prose, and reading a change in it uncoloured is the thing
        //the editor exists to stop.
        var dot = String(pick.file).lastIndexOf('.');
        var ext = dot < 0 ? '' : String(pick.file).slice(dot + 1).toLowerCase();
        var mode = ext == 'js' || ext == 'jsx' || ext == 'json' ? 'javascript'
            : ext == 'md' ? 'markdown' : 'text';

        return (
            <Cols>
                <Col>
                    <CardSub>{state.base}</CardSub>
                    {state.before == null
                        ? <Empty>not on this side — the file is added by the change</Empty>
                        : <Code text={state.before} mode={mode} tall />}
                </Col>
                <Col>
                    <CardSub>{state.head}</CardSub>
                    {state.after == null
                        ? <Empty>not on this side — the file is deleted by the change</Empty>
                        : <Code text={state.after} mode={mode} tall />}
                </Col>
            </Cols>
        );
    }

    function FileDiff({ cmp, pick, side, setSide }) {
        var { state, error } = okc.use('compareDiff', {
            base: cmp.base, head: cmp.head, repo: pick.repo, file: pick.file
        }, 0);

        if (!state && error) return <Panel><Note kind="bad">{error}</Note></Panel>;
        if (!state) return <Panel><Skeleton rows={4} /></Panel>;

        return (
            <Panel>
                <CardTitle><Mono>{pick.repo + ' · ' + pick.file}</Mono></CardTitle>
                <CardSub>{state.base + ' → ' + state.head}</CardSub>

                {/* A SWITCH, NOT TWO BUTTONS. Which way this file is read is a
                    STATE somebody sets and keeps — it is remembered across files
                    and across sittings — rather than an act performed once. */}
                <Toggle on={side} onChange={setSide}>Side by side</Toggle>

                {side
                    ? <SideBySide cmp={cmp} pick={pick} />
                    : (state.diff ? <Diff text={state.diff} /> : <Empty>no changes</Empty>)}

                {/* NOT TIED TOGETHER YET, and that is the one thing still missing
                    rather than a vague gap. Two columns that scroll apart are two
                    views of two files, which is what side by side exists to stop
                    being. The kit exports `Editor` beside `Code` for exactly this
                    — reaching the instance to tie two of them — and nothing does
                    it yet. */}
                {side ? <Note>Their scrolling is not tied together yet, so a long file has to be followed on both sides.</Note> : null}
            </Panel>
        );
    }

    //---- the pane ----------------------------------------------------------

    function Changes() {
        //WHAT THERE IS TO COMPARE — lines and branches together, from this
        //plugin's own server half. The pane used to ask `lines`, which is why it
        //could only ever compare two lines.
        var refs = okc.use('compareRefs', {}, 0);
        //WHICH TWO LINES, AND WHICH LOOK. Reading a change is not something
        //somebody finishes in one sitting, and coming back to a blank pane is
        //how a review gets started again from the top.
        var [from, setFrom] = remember.use('changes', 'from', null);
        var [into, setInto] = remember.use('changes', 'into', null);
        var [look, setLook] = remember.use('changes', 'look', 'files');
        //WHICH WAY A FILE IS READ, kept the same way the rest of this pane's
        //choices are. Somebody who reads side by side reads the next file that
        //way too, and being put back to a unified diff on every pick is being
        //asked the same question over and over.
        var [side, setSide] = remember.use('changes', 'side', false);
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

        //A BROKEN LINE CANNOT BE COMPARED, so it is not offered. It names a
        //branch that is missing somewhere, and reading it produces an answer
        //about a thing that is not there.
        var namedLines = ((refs.state && refs.state.lines) || []).filter(function (g) { return !g.broken; });
        var branches = (refs.state && refs.state.branches) || [];

        //ONE LIST, LINES FIRST, AND EACH SAYS WHICH IT IS. A line and a branch
        //are picked the same way and mean different things — a line is a change
        //that has been named and is going somewhere, a branch is where work
        //happens — so the list keeps them apart rather than mixing them into one
        //alphabetical run where neither can be found.
        var usable = namedLines.concat(branches.map(function (b) {
            return { name: b.name, repos: b.repos, branch: true };
        }));
        var proposed = namedLines.filter(function (g) { return g.marked; });

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
        }, [usable.length, from]);

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
            //`from` CARRIES, `into` IS WHAT IT WOULD GO INTO — so from is the
            //HEAD and into is the BASE. Backwards here is a diff that reads
            //inside out, every addition shown as a removal, and nothing on
            //screen saying so.
            okc.call('compare', { base: into, head: from }).then(function (d) {
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

        if (!refs.state && refs.error) return <Pane><Note kind="bad">{refs.error}</Note></Pane>;
        if (!refs.state) return <Pane><Skeleton rows={3} /></Pane>;

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

        var marked = namedLines.filter(function (g) { return g.name == from && g.marked; })[0];
        var others = usable.filter(function (g) { return g.name != from; });
        var repos = (cmp && cmp.repos) || [];

        //WHAT THE OLD ACTION HANDED OVER AND `compare` DOES NOT, worked out from
        //the rows it does. `compare` says what each repository has; whether that
        //adds up to "nowhere for this to land" is the pane's reading of it, and
        //keeping the arithmetic here means the action stays a statement of fact.
        var onlyHead = repos.filter(function (r) { return r.has === 'only the head'; })
            .map(function (r) { return r.repo; });
        var onlyBase = repos.filter(function (r) { return r.has === 'only the base'; })
            .map(function (r) { return r.repo; });
        var totalAdded = repos.reduce(function (n, r) { return n + (r.added || 0); }, 0);
        var totalRemoved = repos.reduce(function (n, r) { return n + (r.removed || 0); }, 0);


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
                            refs.again();
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
                    {/* A <label>, NOT A <span>, AND THAT IS NOT A DETAIL. The
                        driver names a field by the label before it or around it
                        — see core/drive's `labelOf` — so these two, which are
                        the most important controls on the pane, were reported
                        with no name at all and could not be reached from the
                        command line or by a drill. They also could not be
                        guarded, since a guard is by the words on a control.
                        It looks identical; `label.muted` carries the same rule
                        the span did. */}
                    <label className="muted">What</label>
                    <select value={from || ''} onChange={function (e) { setFrom(e.target.value); setPick(null); }}>
                        {usable.map(function (g) {
                            return <option key={g.name} value={g.name}>{label(g)}</option>;
                        })}
                    </select>
                    <label className="muted">carries that</label>
                    <select value={into || ''} onChange={function (e) { setInto(e.target.value); setPick(null); }}>
                        {others.map(function (g) {
                            return <option key={g.name} value={g.name}>{label(g)}</option>;
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
                                                <span className="muted">{r.commits.length + ' on top of ' + r.base}</span>
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
                                        ? <Badge>{plusMinus(totalAdded, totalRemoved)}</Badge>
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
                                                            : r.commits.length + ' commit(s), ' + plusMinus(r.added, r.removed)}
                                            </span>
                                        </div>
                                    );
                                })}

                                {/* "WHY IS THAT REPOSITORY NOT LISTED" is the first
                                    question a reader has, so it is answered here
                                    rather than left to be worked out. */}
                                {onlyHead.length
                                    ? <CardSub>{onlyHead.join(', ') + ' — in "' + cmp.head + '" only, so there is nowhere in "' + cmp.base + '" for it to land.'}</CardSub>
                                    : null}
                                {onlyBase.length
                                    ? <CardSub>{onlyBase.join(', ') + ' — in "' + cmp.base + '" only; ' + (cmp.head || 'it') + ' never reached it.'}</CardSub>
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
                                    {'A default branch is protected, and that includes from this app. "' + cmp.head
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
                                    ? <FileDiff key={pick.repo + ':' + pick.file} cmp={cmp} pick={pick} side={side} setSide={setSide} />
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
