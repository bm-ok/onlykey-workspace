var makeWriter = require('./writer');
var React = require('react');
var { useState, useEffect, useCallback } = React;

//---------------------------------------------------------------------------
//PR cuts: a change once it has left.
//
//ONE ACT, ONE PULL REQUEST PER REPOSITORY, held together and edited as one
//thing. GITHUB CANNOT DO THIS PART — it has no idea the three are one change.
//Each repository sees its own, each is approved on its own, and "is it in"
//cannot be answered by looking at any single one of them. Nor can three
//descriptions of one change stay in step by hand: the second repository ends up
//with last week's title, and a reviewer reads a different story depending on
//which one they happened to open.
//
//READ FROM GITHUB ON PURPOSE, NEVER ON A TIMER. Every state on this pane is
//somebody else's fact and a network call to learn. So it is read once when the
//pane is opened — a pane that says "not read yet" and does nothing is a pane
//that looks broken — and after that it is a button. Same rule the old window
//arrived at, and the reason this is the one pane in the app with no cadence.
//
//THE TWO PURPLE BUTTONS LIVE HERE, and this is what they were built for.
//
//  Send it   pushes branches to GitHub and opens pull requests. Visible to
//            anyone who can see those repositories, the moment it happens.
//  Merge it  a commit on a real default branch. The one thing on this screen
//            that cannot be undone from this window.
//
//A supervisor may prepare either one and may say it is ready. The press is a
//person's. That is not a policy written down somewhere — the command line is
//refused, by name, with the reason. See ../guards/ and ../drive/.
//---------------------------------------------------------------------------

plugin.consumes = ['shell', 'theme', 'okc', 'remember'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc, remember } = imports;
    var {
        Pane, Panel, Cols, Col, Stack, TitleRow, Grow, Card, CardTitle, CardSub,
        Badge, Chips, Chip, Button, Finder, Skeleton, Empty, Note, Mono, Link,
        Kv, KvRow, Notice, ask
    } = theme;

    var idOf = function (c) { return c.source + ' -> ' + c.target; };
    var day = function (s) { return s ? String(s).replace('T', ' ').slice(0, 16) : null; };

    //WHERE EACH HALF IS GOING, as a table rather than a sentence.
    //
    //Written as prose this was mangled three times running: a destination ran
    //together as one word, the repository name repeated on every line, and the
    //order read backwards. It is a grid however it is worded, so it is a grid —
    //and the dialog uses this same component rather than describing it again,
    //because the last thing read before publishing should not be a second
    //telling.
    function Where({ pulls }) {
        if (!pulls || !pulls.length) return null;
        return (
            <table className="kv where"><tbody>
                {pulls.map(function (p) {
                    return (
                        <tr key={p.repo}>
                            <th>{p.repo}</th>
                            <td>
                                <div><Mono>{p.head || p.on || '?'}</Mono></div>
                                <div className="sub muted">{'into '}<Mono>{p.into || p.base || '?'}</Mono></div>
                            </td>
                        </tr>
                    );
                })}
            </tbody></table>
        );
    }

    //---- the left column ---------------------------------------------------

    function state(c) {
        if (c.draft) return { kind: 'warn', word: 'written, not sent' };
        if (c.landed) return { kind: 'ok', word: 'landed' };
        var open = (c.pulls || []).filter(function (p) { return p.state == 'open'; }).length;
        if (open) return { kind: '', word: open + ' open' };
        return { kind: 'muted', word: c.summary || 'sent' };
    }

    function Row({ c, on, onPick }) {
        var s = state(c);
        return (
            <Card pick on={on} onClick={onPick}>
                <CardTitle><Mono>{c.source}</Mono> <Badge kind={s.kind}>{s.word}</Badge></CardTitle>
                {/* WHERE IT IS GOING IS HALF THE NAME. A cut is a pair of lines,
                    and a list of sources alone cannot tell two cuts of the same
                    branch into different targets apart. */}
                <CardSub>{'into '}<Mono>{c.target}</Mono></CardSub>
                {(c.pulls || []).length
                    ? <CardSub>{c.pulls.length + ' pull request' + (c.pulls.length == 1 ? '' : 's')
                        + (c.mergedCount ? ', ' + c.mergedCount + ' merged' : '')}</CardSub>
                    : null}
            </Card>
        );
    }

    //---- the right column --------------------------------------------------

    function Pull({ p }) {
        var kind = p.merged ? 'ok' : p.state == 'closed' ? 'bad' : p.draft ? 'warn' : '';
        var word = p.merged ? 'merged' : p.state == 'closed' ? 'closed without merging' : p.draft ? 'draft on GitHub' : 'open';
        return (
            <Card>
                <CardTitle>
                    <Mono>{p.repo}</Mono>
                    {p.number ? <Mono>{'#' + p.number}</Mono> : null}
                    <Badge kind={kind}>{word}</Badge>
                </CardTitle>
                {p.title ? <CardSub>{p.title}</CardSub> : null}
                <Kv>
                    <KvRow label="from"><Mono>{p.head || '?'}</Mono></KvRow>
                    <KvRow label="into"><Mono>{p.base || p.into || '?'}</Mono></KvRow>
                    {p.by ? <KvRow label="opened by">{p.by}</KvRow> : null}
                    {p.updated ? <KvRow label="last touched">{day(p.updated)}</KvRow> : null}
                </Kv>
                {/* THE LINK OPENS IN THE PERSON'S REAL BROWSER. Reviewing is done
                    over there; this pane is for knowing whether the three halves
                    agree, which is the part over there cannot answer. */}
                {p.url ? <Link href={p.url}>{p.url}</Link> : null}
            </Card>
        );
    }

    //---- the pane ----------------------------------------------------------

    function Cuts() {
        var [got, setGot] = useState(null);
        var [drafts, setDrafts] = useState(null);
        var [err, setErr] = useState(null);
        var [said, setSaid] = useState(null);
        var [busy, setBusy] = useState(false);
        var [find, setFind] = useState('');
        var [only, setOnly] = remember.use('cuts', 'only', null);
        //READING A CUT IS NOT DONE IN ONE SITTING. It is a pull request per
        //repository and the point of the pane is deciding whether to send or
        //merge it, so coming back to a blank panel is starting the read again
        //from the top.
        var [picked, setPicked] = remember.use('cuts', 'picked', null);

        //DRAFTS ARE LOCAL AND ANSWER INSTANTLY; cuts are a network call. Asked
        //separately so the one row on the screen that wants a person is not
        //waiting behind GitHub being asked about seventeen things that do not.
        var readDrafts = useCallback(function () {
            return okc.call('prDrafts', {}).then(function (d) { setDrafts(d.drafts || []); },
                function () { setDrafts([]); });
        }, []);

        var read = useCallback(function () {
            setBusy(true);
            return okc.call('prCuts', {}).then(function (d) {
                setGot(d); setErr(null); setBusy(false);
            }, function (e) {
                setErr(e.message); setBusy(false);
            });
        }, []);

        useEffect(function () { readDrafts(); read(); }, [readDrafts, read]);

        if (!got && !drafts && !err) return <Pane><Skeleton rows={4} /></Pane>;

        //A DRAFT IS A CUT THAT HAS NOT LEFT, so it belongs in the same list. It
        //is the row somebody is most likely to be looking for, so it sorts
        //first rather than being a separate panel somewhere else.
        var waiting = (drafts || []).map(function (w) {
            return { source: w.source, target: w.target, draft: true, landed: false, pulls: [], summary: 'written, not sent', said: w };
        });
        var all = waiting.concat((got && got.cuts) || []);

        var counts = {
            drafts: waiting.length,
            open: all.filter(function (c) { return !c.draft && !c.landed; }).length,
            landed: all.filter(function (c) { return c.landed; }).length
        };

        var rows = all.filter(function (c) {
            if (find && (c.source + ' ' + c.target).toLowerCase().indexOf(find.toLowerCase()) < 0) return false;
            if (only == 'drafts') return !!c.draft;
            if (only == 'open') return !c.draft && !c.landed;
            if (only == 'landed') return !!c.landed;
            return true;
        });

        var on = all.filter(function (c) { return idOf(c) == picked; })[0] || null;
        var openPulls = on ? (on.pulls || []).filter(function (p) { return p.number && !p.merged && p.state == 'open'; }) : [];

        function tell(p) {
            return p.then(
                function (r) { setSaid({ text: r.note || 'Done.' }); return read().then(readDrafts); },
                function (e) { setSaid({ bad: true, text: e.message }); throw e; }
            );
        }

        function send(c) {
            var t = (c.said && c.said.title) || null;
            ask({
                title: 'Send "' + c.source + '" into "' + c.target + '"?',
                plain: [
                    'One pull request in each repository that carries something, tracked together as one cut.',
                    t ? 'Titled "' + t + '"' : 'It has no title of its own, so the template supplies one.',
                    //WHERE THE TOKEN LIVES IS PART OF THE ANSWER. Somebody
                    //reading this is entitled to know that no machine is being
                    //handed a credential to do it.
                    'Nothing is pushed from a machine. This host holds the token and does both steps itself.'
                ],
                //GITHUB'S KIND OF DRAFT IS NOT THIS APP'S KIND. This app's draft
                //has not been sent. GitHub's has been opened and is marked not
                //ready for review — so the option belongs with the act of
                //opening, which is here, and not with the writing.
                fields: [{
                    name: 'asDraft', type: 'checkbox', label: 'Open them as drafts on GitHub',
                    hint: 'They are opened and visible either way. A GitHub draft says "not ready for review" and cannot be merged until somebody marks it ready.'
                }],
                cost: 'This pushes branches to GitHub and opens pull requests. Both are visible to anyone who can see those repositories.',
                confirm: 'Push and open them',
                protect: true,
                onYes: function (f) {
                    return tell(okc.call('prCutMake', {
                        source: c.source, target: c.target,
                        title: t || undefined,
                        body: (c.said && c.said.body) || undefined,
                        draft: f.asDraft === true
                    })).then(function () { setPicked(idOf(c)); });
                }
            });
        }

        function land(c) {
            var open = (c.pulls || []).filter(function (p) { return p.number && !p.merged && p.state == 'open'; });
            ask({
                title: open.length > 1 ? 'Merge all ' + open.length + ' pull requests in this cut?' : 'Merge this pull request?',
                plain: [
                    open.map(function (p) { return p.repo + ' #' + p.number; }).join(', ') + ' — merged into ' + c.target + ', on GitHub, now.',
                    'This is the one thing here that cannot be undone from this window: it is a commit on a real default branch. Reverting it afterwards is a change of its own.',
                    'Afterwards each fork is behind its parent. Sync the forks, then this host, before cutting anything new from them.',
                    //The same table the panel draws. Somebody who scrolled past
                    //the destinations should not have to trust their memory of
                    //them at the moment of pressing.
                    <Where key="where" pulls={open} />
                ],
                cost: 'A commit on a real default branch, in ' + open.length + ' repositor' + (open.length == 1 ? 'y' : 'ies') + '.',
                confirm: open.length > 1 ? 'Merge all of them' : 'Merge it',
                protect: true,
                onYes: function () { return tell(okc.call('prCutLand', { source: c.source, target: c.target })); }
            });
        }

        function forget(c) {
            ask({
                title: 'Stop tracking "' + c.source + '"?',
                plain: [
                    'It comes off this list. The pull requests on GitHub are untouched — they stay open, or stay merged, exactly as they are.',
                    'What is lost is the fact that they are ONE change, which is the part GitHub does not hold.'
                ],
                confirm: 'Stop tracking it',
                danger: true,
                onYes: function () {
                    return tell(okc.call('prCutForget', { source: c.source, target: c.target }))
                        .then(function () { setPicked(null); });
                }
            });
        }

        var chip = function (key, word) {
            return <Chip on={only == key} count={counts[key]}
                onClick={function () { setOnly(only == key ? null : key); }}>{word}</Chip>;
        };

        return (
            <Pane>
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}
                {err ? <Note kind="bad">{err}</Note> : null}

                <Cols>
                    <Col narrow>
                        <TitleRow>PR cuts<Grow /><span className="muted">{all.length}</span></TitleRow>
                        <Finder value={find} onChange={setFind} placeholder="find a source or target" />
                        <Chips>
                            {chip('drafts', 'not sent')}
                            {chip('open', 'out')}
                            {chip('landed', 'landed')}
                        </Chips>
                        <Stack>
                            {/* A SKELETON WHILE THE FIRST READ IS OUT, because
                                the alternative is a confident lie. This read
                                takes about sixteen seconds — twenty cuts, each
                                one a question put to GitHub — and for all of
                                that the column said "nothing has been written or
                                sent", which is a true-sounding sentence about a
                                question that had not been answered yet.

                                "Not read yet" and "there is nothing" are
                                different, and only one of them is worth acting
                                on. Photographs of this pane during that window
                                are how it was caught. */}
                            {busy && !got
                                ? <Skeleton rows={4} />
                                : rows.length
                                    ? rows.map(function (c) {
                                        return <Row key={idOf(c)} c={c} on={idOf(c) == picked}
                                            onPick={function () { setPicked(idOf(c)); }} />;
                                    })
                                    : <Empty>{all.length ? 'nothing matches' : 'nothing has been written or sent'}</Empty>}
                        </Stack>
                    </Col>

                    <Col>
                        <h2>Actions <span className="muted">{on ? '— ' + on.source : '— nothing selected'}</span></h2>
                        <Panel>
                            <div className="row">
                                {/* READ, NOT REFRESH. Every row on this pane is
                                    somebody else's fact, and the button says
                                    where it is being fetched from so nobody
                                    wonders why it takes a moment. */}
                                {/* IT TAKES AS LONG AS IT TAKES, and saying so
                                    is better than a spinner: one question per
                                    cut, put to somebody else's service. */}
                                <Button disabled={busy} onClick={read}>
                                    {busy ? 'asking GitHub…' : 'Read them from GitHub'}
                                </Button>
                            </div>

                            {!on ? <Empty>pick a cut on the left</Empty> : (
                                <div className="row" style={{ marginTop: '8px' }}>
                                    {on.draft
                                        ? <Button kind="ok" protect onClick={function () { send(on); }}>Send it</Button>
                                        : null}

                                    <Button protect
                                        disabled={!openPulls.length}
                                        title={openPulls.length
                                            ? 'Merge ' + openPulls.length + ' pull request(s) into ' + on.target
                                            : on.landed ? 'it has landed already' : 'nothing in it is open'}
                                        onClick={function () { land(on); }}>
                                        {openPulls.length > 1 ? 'Merge all of them' : 'Merge it'}
                                    </Button>

                                    {!on.draft
                                        ? <Button kind="danger" onClick={function () { forget(on); }}>Stop tracking it</Button>
                                        : null}
                                </div>
                            )}

                            {on && on.landed
                                ? <Note kind="warn">
                                    It has landed. Each fork is now behind its parent — sync the forks, then
                                    this host, before cutting anything new from them.
                                </Note>
                                : null}
                        </Panel>
                    </Col>

                    <Col wide>
                        <h2>What it is</h2>
                        {!on ? <Panel><Empty>nothing picked</Empty></Panel> : (
                            <div>
                                <Panel>
                                    <Kv>
                                        <KvRow label="from"><Mono>{on.source}</Mono></KvRow>
                                        <KvRow label="into"><Mono>{on.target}</Mono></KvRow>
                                        <KvRow label="state">{state(on).word}</KvRow>
                                        {on.opened ? <KvRow label="opened">{day(on.opened) + (on.by ? ' by ' + on.by : '')}</KvRow> : null}
                                        {on.summary ? <KvRow label="summary">{on.summary}</KvRow> : null}
                                    </Kv>
                                    {on.draft && on.said && on.said.title
                                        ? <Note>{'Titled "' + on.said.title + '"'}</Note>
                                        : null}
                                </Panel>

                                {(on.pulls || []).length
                                    ? <Stack>{on.pulls.map(function (p) { return <Pull key={p.repo} p={p} />; })}</Stack>
                                    : (
                                        <Panel>
                                            {/* NOT SENT IS NOT THE SAME AS NOTHING
                                                THERE, and the difference is the
                                                whole state of this row. */}
                                            <Empty>
                                                Nothing is on GitHub for this one yet — it has been written and not sent.
                                            </Empty>
                                        </Panel>
                                    )}
                            </div>
                        )}
                        {got && got.note ? <Note>{got.note}</Note> : null}
                    </Col>
                </Cols>
            </Pane>
        );
    }

    shell.pane({ tab: 'Repositories', name: 'PR cuts', order: 100, Component: Cuts });
    //THE ONE THAT WRITES, BESIDE THE ONE THAT SENDS. Two panes rather than one
    //screen that does both, because the difference between thinking and doing
    //should not be a button the mouse is already over.
    shell.pane({ tab: 'Repositories', name: 'New PR Cut', order: 110, Component: makeWriter(theme, okc, remember) });

    await register(null, {});
}
module.exports = plugin;
