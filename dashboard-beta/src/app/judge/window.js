var React = require('react');
var { useState } = React;
var useAsk = require('../okc/ask');
var makeFindings = require('./findings');
var makeJudges = require('./judges');

//the Judge tab: what has been read, what is being read, and what it concluded.
//
//TWO FIELDS THAT ARE NOT THE SAME QUESTION, and the port inherits the
//distinction rather than flattening it:
//
//  concluded   what the JUDGE recommends. Parsed from the line its own prompt
//              asks it to end on — accept/reject for a change this host made,
//              true/false/unclear for a claim somebody made about the code,
//              yes/no for a pull request that arrived.
//
//  verdict     accepted or rejected. Whether the change is fit to go out.
//
//They came apart badly once: a check-a-claim confirmed a reviewer's request —
//CLAIM: true, meaning "yes, that is worth doing" — and it was filed as
//`rejected`, which then read to the cut gate as a failed review of the branch.
//A confirmed, worth-doing improvement registering as a reason the change could
//not go out. So a check-a-claim writes no verdict now, and this shows both
//columns rather than picking one and hoping.
//
//AND "DONE" DOES NOT MEAN IT SAID ANYTHING. A judgement that ran and concluded
//nothing is a real and useful state — it is the difference between "nobody has
//looked" and "somebody looked and would not say" — and half of the ones on this
//host that said nothing said nothing because they CRASHED.

plugin.consumes = ['shell', 'theme', 'okc', 'remember'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc, remember } = imports;
    var { Pane, Panel, Cols, Col, Stack, TitleRow, Grow, Card, CardTitle, CardSub,
        Badge, Chips, Chip, Button, Finder, Skeleton, Empty, Note, Mono,
        Kv, KvRow, Notice, ask } = theme;
    var Findings = makeFindings(theme, okc);

    //A CRASH AND A SILENCE ARE NOT ONE THING, and this tab could not tell them
    //apart at first. Both look identical here — done, no verdict, nothing
    //concluded — and the difference is the run's exit code, which lives on
    //`attempts`, which the list leaves out on purpose: carrying it made that
    //action 77,000 characters and a list a supervisor could not read.
    //
    //Computing it here anyway ran `(j.attempts || [])` over a field that is not
    //present, found nothing, and reported a confident FALSE standing in for "I
    //was not told" — a zero that looked like good news.
    //
    //FIXED ON THE OTHER SIDE, which is where it belonged: the list carries
    //`crashed` now, derived where the attempts actually are. Same shape as the
    //tasks board carrying `reads` rather than the commits it worked that out
    //from — the raw material stays out and the answer it was wanted for comes
    //along.
    //
    //THREE VALUES. `null` means no exit code was ever recorded, which is every
    //judgement from before the queue kept them. It is not evidence of a clean
    //run, and this shows it as its own thing rather than folding it into either.

    function Judgement({ j }) {
        var said = j.concluded;
        return (
            <div className="card">
                <div className="card-title">
                    <Mono>{j.ref || ('J' + j.number)}</Mono>{' '}
                    <Badge kind={j.state == 'done' ? '' : 'run'}>{j.state}</Badge>{' '}
                    {j.verdict
                        ? <Badge kind={j.verdict == 'accepted' ? 'ok' : 'bad'}>{j.verdict}</Badge>
                        : null}
                    {' '}
                    {said ? <Badge kind={said == 'accept' ? 'ok' : said == 'reject' ? 'bad' : ''}>{'it said: ' + said}</Badge> : null}
                    {j.state == 'done' && !said && !j.verdict
                        ? <Badge kind={j.crashed === true ? 'bad' : 'warn'}>
                            {j.crashed === true ? 'crashed, said nothing'
                                : j.crashed === false ? 'ran, said nothing'
                                    : 'said nothing, and no exit was recorded'}
                        </Badge>
                        : null}
                </div>
                <div className="card-sub">
                    {j.subject ? <Mono>{j.subject.name || j.subject.branch}</Mono> : null}
                    {j.job ? <span>{' · ' + j.job}</span> : null}
                    {j.machine ? <span>{' · '}<Mono>{j.machine}</Mono></span> : null}
                    {j.by ? <span>{' · asked by ' + j.by}</span> : null}
                </div>
                {j.question ? <div className="note muted">{j.question}</div> : null}
            </div>
        );
    }

    function Judge() {
        var { state, error, reads } = useAsk(okc, 'judging', {}, 5000);

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Empty>asking…</Empty></Pane>;

        var rows = (state.judgements || []).slice().reverse();
        var live = rows.filter(function (j) { return j.state == 'queued' || j.state == 'given'; });
        var done = rows.filter(function (j) { return live.indexOf(j) < 0; });

        //COUNTED APART, because they are different situations: one is a fault
        //to go looking at and the other is a survey answering the way surveys
        //do. Folding them together puts a phantom chore on somebody's list and
        //hides a real failure inside it.
        var mute = done.filter(function (j) { return !j.verdict && !j.concluded; });
        var broke = mute.filter(function (j) { return j.crashed === true; });
        var quiet = mute.filter(function (j) { return j.crashed !== true; });

        return (
            <Pane>
                {error ? <Note kind="bad">{error}</Note> : null}

                {broke.length
                    ? <Note kind="bad">{broke.length + ' crashed without saying anything — a fault to look at, not a decision to make'}</Note>
                    : null}
                {quiet.length
                    ? <Note kind="warn">{quiet.length + ' ended without saying anything, which for a survey is the ordinary answer'}</Note>
                    : null}

                <Panel>
                    <div className="card-title">{'Reading now (' + live.length + ')'}</div>
                    {live.length
                        ? live.map(function (j) { return <Judgement key={j.id} j={j} />; })
                        : <Empty>nothing is being read</Empty>}
                </Panel>

                <Panel>
                    <div className="card-title">{'Read (' + done.length + ')'}</div>
                    {done.length
                        ? done.slice(0, 12).map(function (j) { return <Judgement key={j.id} j={j} />; })
                        : <Empty>nothing has been read yet</Empty>}
                    {done.length > 12 ? <Note>{'showing the newest 12 of ' + done.length}</Note> : null}
                </Panel>

                <Note>{'read ' + reads + ' time(s), every 5s · ' + (state.note || '')}</Note>
            </Pane>
        );
    }

    //---- the pane the tab is really about ----------------------------------
    //
    //A JUDGEMENT CHANGES NOTHING - it may not even push to what it reads - so
    //everything it has to say is in what it handed back. That is why HANDED BACK
    //is a column of its own rather than a footnote on the detail: there is no
    //diff to look at afterwards, no commit, no branch that moved. The files are
    //the entire output.
    //
    //THREE COLUMNS, and the middle one is a fact table rather than prose. What
    //it read, what kind of thing that was, what it decided, why, which judge
    //read it, under which rules, and on what machine - each is one line and each
    //is a question somebody actually asks.
    //`subject` IS AN OBJECT AND RENDERING IT TOOK THE WHOLE APP DOWN.
    //
    //It is `{ kind, branch, name }` - a branch cut or a PR cut, said in a shape
    //rather than a string. `<Mono>{on.subject}</Mono>` therefore handed React an
    //object as a child, which throws; and a throw in render does not blank one
    //pane, it unmounts the entire tree. The window came up with no tabs, no
    //chrome and nothing to click, so there was no way to navigate away from the
    //pane that was doing it.
    //
    //The socket stayed up, which is what made it diagnosable at all:
    //`windowControls` still answered, with `on: "?"` and zero buttons - a page
    //that is alive and rendering nothing.
    //
    //WHAT IT ALSO SAYS is worth keeping rather than flattening: `kind` is the
    //difference between reading a branch this host made and reading somebody
    //else's pull request that arrived, and those are not the same act.
    function subjectOf(j) {
        var s = j && j.subject;
        if (!s) return { name: j && j.title || '?', kind: null };
        if (typeof s == 'string') return { name: s, kind: null };
        return { name: s.name || s.branch || s.source || '?', kind: s.kind || null };
    }
    //THE ORIGINAL'S OWN WORDS. "branch cut - the work as it stands" is doing
    //something a bare kind does not: it says the reading is of a moving thing,
    //which is why a judgement can go stale. And a pull request is somebody
    //else's change that ARRIVED - a different act, with a different ending.
    var KINDS = {
        branch: 'branch cut \u2014 the work as it stands',
        cut: 'PR cut \u2014 a change that has been sent out',
        pull: "pull request \u2014 somebody else's change, which arrived"
    };

    function Judgements() {
        var { state, error, reads } = useAsk(okc, 'judging', {}, 8000);
        var [find, setFind] = useState('');
        var [only, setOnly] = remember.use('judge', 'only', null);
        var [picked, setPicked] = remember.use('judge', 'picked', null);
        var [said, setSaid] = useState(null);

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Skeleton rows={5} /></Pane>;

        var all = state.judgements || [];
        var counts = {
            waiting: all.filter(function (j) { return j.state == 'queued' || j.state == 'waiting'; }).length,
            running: all.filter(function (j) { return j.state == 'running'; }).length,
            //A CRASH AND A SILENCE ARE NOT ONE THING - see the note above, and
            //the false zero that computing it here once produced.
            crashed: all.filter(function (j) { return j.crashed === true; }).length,
            saidNothing: all.filter(function (j) { return j.state == 'done' && !j.concluded && !j.crashed; }).length
        };

        var rows = all.filter(function (j) {
            var hay = ((j.ref || '') + ' ' + subjectOf(j).name + ' ' + (j.title || '') + ' ' + (j.question || '')).toLowerCase();
            if (find && hay.indexOf(find.toLowerCase()) < 0) return false;
            if (only == 'waiting') return j.state == 'queued' || j.state == 'waiting';
            if (only == 'running') return j.state == 'running';
            if (only == 'crashed') return j.crashed === true;
            if (only == 'saidNothing') return j.state == 'done' && !j.concluded && !j.crashed;
            return true;
        });

        var on = all.filter(function (j) { return (j.ref || String(j.number)) == picked; })[0] || null;

        //NOT PORTED: "WAITING TO BE READ", and this is a deliberate stop rather
        //than an oversight.
        //
        //The original leads its list with a card - not a filter - saying "Still
        //carrying something, and nothing CURRENT has read it", with a Judge it
        //button on each. It is the one row that wants a person, and a card is
        //right where a filter would be wrong: a filter has to be thought of.
        //
        //What it needs is not a list any action returns. `judging.waiting` is a
        //COUNT of queued judgements, not this; `judgements.cuts[].reads` is
        //about PR cuts, not branches. The real question is "this branch carries
        //something, and every judgement of it was read at commits it no longer
        //has" - staleness against the branch tips, which is computed on the
        //other side.
        //
        //I guessed at the field twice. Both times the card silently did not
        //appear, which is the worst outcome available: a pane that looks
        //complete and is quietly missing the row somebody came for. Better to
        //leave it out and say so than to show a third guess.

        var chip = function (key, word) {
            return <Chip on={only == key} count={counts[key]}
                onClick={function () { setOnly(only == key ? null : key); }}>{word}</Chip>;
        };

        function say(j) {
            ask({
                title: 'Put this judgement on GitHub?',
                plain: [
                    'It goes on the pull request as a comment, signed by this host, where the person who opened it will read it.',
                    'It is not a review and it approves nothing. It is what the judge found, said out loud.',
                    'Somebody else opened that pull request. This is publishing to their repository.'
                ],
                cost: 'A comment on somebody else\u2019s pull request. It can be deleted on GitHub, not from here.',
                confirm: 'Say it',
                protect: true,
                onYes: function () {
                    return okc.call('judgementSay', { id: j.ref || String(j.number) }).then(
                        function (r) { setSaid({ text: r.note || 'Said.' }); },
                        function (e) { setSaid({ bad: true, text: e.message }); throw e; }
                    );
                }
            });
        }

        function bin(j) {
            ask({
                title: 'Throw ' + (j.ref || j.number) + ' away?',
                plain: [
                    'The judgement goes. Any verdict it reached stays on the cut - that was recorded there when it was decided.',
                    'What it handed back goes with it, and that is the only account of what it read.'
                ],
                cost: 'The findings cannot be brought back.',
                confirm: 'Throw it away',
                danger: true,
                protect: true,
                onYes: function () {
                    return okc.call('judgementRemove', { id: j.ref || String(j.number) }).then(
                        function (r) { setSaid({ text: r.note || 'Gone.' }); setPicked(null); },
                        function (e) { setSaid({ bad: true, text: e.message }); throw e; }
                    );
                }
            });
        }

        return (
            <Pane>
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}
                <Note>
                    What has been read and what it found. A judgement changes nothing &mdash; it may not
                    even push to what it reads &mdash; so everything it has to say is in what it handed back.
                </Note>

                <Cols>
                    <Col narrow>
                        <TitleRow>Judgements<Grow /><span className="muted">{all.length}</span></TitleRow>
                        <Finder value={find} onChange={setFind} placeholder="find a judgement" />
                        <Chips>
                            {chip('waiting', 'waiting')}
                            {chip('running', 'running')}
                            {chip('crashed', 'crashed')}
                            {chip('saidNothing', 'said nothing')}
                        </Chips>
                        <Stack>
                            {rows.length ? rows.map(function (j) {
                                var id = j.ref || String(j.number);
                                return (
                                    <Card key={id} pick on={id == picked} onClick={function () { setPicked(id); }}>
                                        {/* THE REF AND WHAT IT READ ON ONE LINE,
                                            with the state pushed right. A list of
                                            refs is unreadable and a list of titles
                                            cannot be pointed at; together they are
                                            how somebody says "look at J68". */}
                                        <CardTitle>
                                            <span><Mono>{id}</Mono>{' ' + (j.title || subjectOf(j).name)}</span>
                                            <Grow />
                                            <Badge kind={j.state == 'done' ? '' : 'run'}>{j.state}</Badge>
                                            {j.crashed === true ? <Badge kind="bad">crashed</Badge> : null}
                                        </CardTitle>
                                        <CardSub><Mono>{subjectOf(j).name}</Mono></CardSub>
                                        {/* BOTH ANSWERS, NEVER ONE, and stacked so
                                            neither is read as the other. `concluded`
                                            is what the judge recommends; `verdict`
                                            is whether the change may go out. They
                                            came apart once and a confirmed
                                            improvement was filed as a reason the
                                            change could not land. */}
                                        <div className="badges">
                                            {j.concluded ? <Badge kind="ok">{j.concluded}</Badge> : null}
                                            {j.verdict ? <Badge kind={j.verdict == 'accepted' ? 'ok' : 'bad'}>{j.verdict}</Badge> : null}
                                        </div>
                                    </Card>
                                );
                            }) : <Empty>{all.length ? 'nothing matches' : 'nothing has been read yet'}</Empty>}
                        </Stack>
                    </Col>

                    <Col>
                        <h2>Judgement <span className="muted">{on ? '\u2014 ' + (on.ref || on.number) : '\u2014 nothing selected'}</span></h2>
                        {on ? (
                            <Panel>
                                <Kv>
                                    <KvRow label="reads"><Mono>{subjectOf(on).name}</Mono></KvRow>
                                    <KvRow label="which is a">
                                        {KINDS[subjectOf(on).kind] || subjectOf(on).kind || <span className="muted">not recorded</span>}
                                    </KvRow>
                                    <KvRow label="state">{on.state}</KvRow>
                                    {/* WHAT THE JUDGE RECOMMENDS AND WHETHER IT MAY
                                        GO OUT, on two lines with two labels. */}
                                    <KvRow label="it concluded">
                                        {on.concluded
                                            ? <Badge kind="ok">{on.concluded}</Badge>
                                            : <span className="muted">it would not say</span>}
                                    </KvRow>
                                    <KvRow label="verdict">
                                        {on.verdict
                                            ? <Badge kind={on.verdict == 'accepted' ? 'ok' : 'bad'}>{on.verdict}</Badge>
                                            : <span className="muted">none recorded &mdash; a check-a-claim writes none</span>}
                                    </KvRow>
                                    {on.note ? <KvRow label="because"><div className="console short">{on.note}</div></KvRow> : null}
                                    <KvRow label="judged by">{on.by || <span className="muted">not recorded</span>}</KvRow>
                                    <KvRow label="judge">{on.job || <span className="muted">none</span>}</KvRow>
                                    <KvRow label="told">{on.promptName || on.promptId || <span className="muted">none</span>}</KvRow>
                                    <KvRow label="under">{on.contractName || on.contractId || <span className="muted">no rules</span>}</KvRow>
                                    <KvRow label="read on">{on.machine ? <Mono>{on.machine}</Mono> : <span className="muted">not yet</span>}</KvRow>
                                    {on.tag ? <KvRow label="wants a machine tagged"><Mono>{on.tag}</Mono></KvRow> : null}
                                    {on.question ? <KvRow label="asked about">{on.question}</KvRow> : null}
                                </Kv>

                                <div className="row" style={{ marginTop: '10px' }}>
                                    {/* SAYING IT PUBLISHES TO SOMEBODY ELSE'S
                                        REPOSITORY, which is why it is purple AND
                                        why it is only here for a pull request.
                                        There is nowhere to say a judgement of a
                                        branch cut this host made - the original
                                        offers the button on an arrived pull
                                        request and nowhere else, and showing it
                                        always would be offering an act with no
                                        destination. */}
                                    {subjectOf(on).kind == 'pull'
                                        ? <Button protect onClick={function () { say(on); }}
                                            title="put what it found on the pull request, as a comment">Say it</Button>
                                        : null}
                                    <Button kind="danger" protect onClick={function () { bin(on); }}>Throw it away</Button>
                                </div>
                                <Note>
                                    &ldquo;Open in VS Code&rdquo; and &ldquo;Open a terminal&rdquo; are not built here yet
                                    &mdash; they need the Terminal tab.
                                </Note>
                            </Panel>
                        ) : <Panel><Empty>pick a judgement on the left</Empty></Panel>}
                    </Col>

                    <Col wide>
                        <h2>Handed back</h2>
                        <Findings id={on ? (on.ref || String(on.number)) : null} />
                    </Col>
                </Cols>

                <Note>
                    {'read ' + reads + ' time(s), every 8s \u00b7 ' + (state.note || '')}
                </Note>
                {/* SAID ON THE PANE, not only in the source. Somebody who knows
                    the old window will look for this card and should be told it
                    is absent rather than conclude nothing is waiting. */}
                <Note kind="warn">
                    The &ldquo;Waiting to be read&rdquo; card is not built here yet &mdash; the one that
                    says a branch is carrying something no current judgement describes. Until it is,
                    this list does not tell you what still needs reading.
                </Note>
            </Pane>
        );
    }

    shell.tab({ name: 'Judge', order: 40 });
    shell.pane({ tab: 'Judge', name: 'Judgement', order: 10, Component: Judgements });
    shell.pane({ tab: 'Judge', name: 'Judges', order: 20, Component: makeJudges(theme, okc) });
    shell.pane({ tab: 'Judge', name: 'Recent', order: 30, Component: Judge });

    await register(null, {});
}
module.exports = plugin;
