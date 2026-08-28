var React = require('react');
var { useState, useEffect, useRef } = React;

//---------------------------------------------------------------------------
//THE INSTRUCTIONS A MODEL IS GIVEN, READ AND WRITTEN IN THE WINDOW.
//
//THIS IS THE ACTUAL CONTROL SURFACE OF THE WHOLE APP. A supervisor decides what
//work there is; a worker does a piece of it; a judge says whether it holds. What
//each of those believes it is, is a markdown file on this host — and every one
//of them is fetched fresh at the head of a turn, so changing one here changes
//what happens next without restarting or touching a machine.
//
//---- three acts, and they are not the same act ----------------------------
//
//  READING     what is served right now. The default, and the only thing that
//              happens without a press.
//  WRITING     a person rewriting it. Guarded, because it changes what a
//              machine is told, and the command line is refused it outright:
//              ./server.js takes `text` from the window only.
//  ANSWERING   a proposal the supervisor made about its own instructions.
//              Guarded for a different reason — the thing that wrote it may not
//              ratify it, which is the line the whole library rests on too.
//
//THE PANE USED TO DO ONE OF THE THREE. It put the document on the screen and
//said, in a warning, that saving was not ported and that a proposal had nowhere
//to go. Both halves existed on the server the whole time.
//
//---- and what it has been ------------------------------------------------
//
//A SKILL IS REWRITTEN IN PLACE, so before ../core/versions the previous answer
//was gone: "it has been working to different instructions since Tuesday" was not
//a question anybody could ask. Every save and every approval keeps a copy now,
//and the panel at the bottom is where you read them against each other.
//---------------------------------------------------------------------------

module.exports = function skill(theme, okc, remember) {
    var {
        Pane, Panel, Cols, Col, Stack, TitleRow, Grow, Card, CardTitle, CardSub,
        Badge, Button, Chips, Chip, Views, Skeleton, Empty, Note, Mono, Kv, KvRow,
        Notice, Code, Editor, Diff, ask
    } = theme;

    var day = function (s) { return s ? String(s).replace('T', ' ').slice(0, 16) : null; };

    function sized(n) {
        if (n == null) return 'not on the search path';
        return n < 2048 ? n + ' characters' : (Math.round(n / 102.4) / 10) + 'k characters';
    }

    //---- the row in the master column --------------------------------------
    //
    //THE THREE WERE CHIPS IN A HEADING, which is a control rather than a list:
    //it shows what you can switch to and nothing about any of them. Whether one
    //has a proposal waiting, whether its file is even on the search path, and how
    //much of its past is kept are all things worth seeing without clicking.
    function Row({ x, on, onPick }) {
        return (
            <Card pick on={on} onClick={onPick}>
                <CardTitle>
                    <span>{x.title}</span>
                    {x.waiting ? <Badge kind="warn">waiting on you</Badge> : null}
                    {!x.there ? <Badge kind="bad">not there</Badge> : null}
                </CardTitle>
                <CardSub>{x.about}</CardSub>
                <CardSub>
                    <Mono>{x.which}</Mono>
                    <span>{' · ' + sized(x.bytes)}</span>
                    {x.kept ? <span>{' · ' + x.kept + ' kept'}</span> : null}
                </CardSub>
            </Card>
        );
    }

    function Skill() {
        var [which, setWhich] = remember.use('skill', 'which', 'supervisor');
        var [said, setSaid] = useState(null);

        //---- THREE VIEWS, AND EACH IS ONE OF THE THREE ACTS -----------------
        //
        //  Read     what is served right now
        //  Write    changing it -- one editor, the document as it stands
        //  Review   what is waiting on a person, and what it has been
        //
        //WRITE WAS A SIDE-BY-SIDE AND THAT WAS THE CONFUSION. Two panes of the
        //same document, one of them typeable, asks you to work out which half
        //you are in before you can start -- and the comparison is not what you
        //want while writing anyway. It is what you want when DECIDING, which is
        //a different view and now a different tab.
        //
        //NOT REMEMBERED. Reading is what this pane is for and writing is an act;
        //a pane that reopens in the editor because somebody was typing in it last
        //week is a pane that opens holding a lock nobody meant to take.
        var [look, setLook] = useState('Read');
        var [draft, setDraft] = useState(null);
        var [atVer, setAtVer] = useState(null);

        var list = okc.use('skills', {}, 0);
        var one = okc.use('skills', { which: which }, 0);
        var kept = okc.use('skillVersions', { which: which }, 0);
        var older = okc.use(atVer ? 'skillVersion' : null, { which: which, at: atVer }, 0);

        //THE LISTENER BELOW IS BOUND ONCE and would otherwise hold the first
        //render's reads — see ../library/library.js, where exactly that made a
        //panel say nothing had ever been approved with the copy on disk.
        var refresh = useRef(function () {});
        refresh.current = function () { list.again(); one.again(); kept.again(); older.again(); };

        //A DRAFT AND A VERSION BOTH BELONG TO THE SKILL THEY ARE OF. Kept across
        //a switch, the draft would be one document's text about to be saved over
        //another's — which is the single worst thing this pane could do.
        useEffect(function () { setDraft(null); setAtVer(null); setLook('Read'); }, [which]);

        //---- SAYING THE WINDOW IS HOLDING SOMETHING ------------------------
        //
        //THE POINT OF THE HANDSHAKE: a save from anywhere else is refused while
        //this is true, so somebody typing here is not overwritten mid-sentence by
        //a drill or another window. ./server.js keeps it in memory and only the
        //window may set it.
        //
        //AND IT IS RELEASED ON THE WAY OUT. A pane that claimed to be holding
        //edits and then unmounted would block every save until the app restarted,
        //which is a lock nobody can see and nobody can clear.
        var holding = look === 'Write' && draft != null;
        useEffect(function () {
            okc.call('skillHolding', { which: which, holding: holding }).catch(function () { /* said below */ });
            return function () {
                if (holding) okc.call('skillHolding', { which: which, holding: false }).catch(function () {});
            };
        }, [which, holding]);

        if (!one.state && one.error) return <Pane><Note kind="bad">{one.error}</Note></Pane>;
        if (!one.state || !list.state) return <Pane><Skeleton rows={4} /></Pane>;

        var it = one.state;
        var served = it.text || '';
        var proposed = it.proposed || null;
        var rows = list.state.skills || [];

        //WHAT IS IN THE EDITOR: the draft if there is one, otherwise what is
        //served. Not an empty box, because an editor that opens empty on a
        //document this size reads as the document having been lost.
        var writing = draft == null ? served : draft;

        var showing = atVer ? older.state : ((kept.state && kept.state.newest) || null);
        var versions = (kept.state && kept.state.versions) || [];

        function tell(p) {
            return p.then(
                function (r) { setSaid({ text: (r && r.note) || 'Done.' }); refresh.current(); },
                function (e) { setSaid({ bad: true, text: e.message }); throw e; }
            );
        }

        //---- writing it, which is not the same as serving it ----------------
        //
        //A SAVE HERE PROPOSES; IT DOES NOT WRITE. Writing the file straight out
        //would make this the one document in the app that changes what a machine
        //is told with a single press, while a contract of forty words needs a
        //person to read it and say so afterwards. A skill is twenty-seven
        //thousand characters and outranks the brief.
        //
        //SO THE TWO ACTS STAY APART, and they are apart for the supervisor too:
        //what it proposes and what you write land in the same place, are read
        //the same way, and are approved by the same press. One review surface,
        //whoever wrote the thing being reviewed.
        //
        //WHICH ALSO MEANS THE DRAFT SURVIVES THE PANE. It is kept where a
        //proposal is kept rather than in this component, so switching away and
        //coming back does not silently throw away an afternoon.
        function save() {
            ask({
                title: 'Propose this as ' + it.title + '?',
                plain: [
                    'Nothing is served from this yet. It goes to Review, beside anything the supervisor has '
                        + 'proposed, and takes effect when it is approved there.',
                    'Saying why is not a formality: it is what you or somebody else will be reading in Review '
                        + 'when deciding, and six weeks from now it is the only record of what this was for.'
                ],
                fields: [
                    { name: 'why', label: 'What you changed, and why', needed: true, multiline: true, rows: 3,
                      placeholder: 'what this changes about how it works' }
                ],
                confirm: 'Propose it',
                protect: true,
                onYes: function (f) {
                    if (!(f.why || '').trim()) {
                        throw new Error('Say why. It is the half of this that is actually being approved.');
                    }
                    return tell(okc.call('skillPropose', { which: which, text: writing, why: f.why.trim() }))
                        .then(function () { setDraft(null); setLook('Review'); });
                }
            });
        }

        function discard() {
            ask({
                title: 'Throw away these edits?',
                plain: ['Nothing has been proposed, so nothing changes anywhere.'],
                confirm: 'Throw them away',
                danger: true,
                onYes: function () { setDraft(null); setLook('Read'); }
            });
        }

        //---- answering a proposal -------------------------------------------

        function approve() {
            ask({
                title: 'Make this ' + it.title + '?',
                plain: [
                    'It becomes the document fetched onto the machine at the head of the next turn, and every '
                        + 'one after it.',
                    'The argument made for it: ' + proposed.why,
                    'What is served is on the left; what would replace it is on the right.',
                    <Diff key="body" left={served} right={proposed.text} mode="markdown" height={340} />
                ],
                wide: true,
                cost: 'It changes what it believes it is, from its next waking on.',
                confirm: 'Approve it',
                protect: true,
                onYes: function () { return tell(okc.call('skillApprove', { which: which })); }
            });
        }

        function reject() {
            ask({
                title: 'Turn this down?',
                plain: [
                    'The proposal goes and the skill is unchanged.',
                    //THE REASON IS THE POINT, and the dialog says so rather than
                    //treating it as a form field: it is the only thing that
                    //changes what gets proposed next.
                    'Your reason is said into the conversation, which it reads at the head of every waking. It '
                        + 'is the whole of what the next proposal has to go on — without it, the same one '
                        + 'comes back.'
                ],
                fields: [
                    { name: 'why', label: 'Why not', needed: true, multiline: true, rows: 4,
                      placeholder: 'what is wrong with it, or what would have to be true for you to say yes' }
                ],
                confirm: 'Turn it down',
                danger: true,
                onYes: function (f) {
                    if (!(f.why || '').trim()) throw new Error('Say why. That sentence is the whole of what it learns.');
                    return tell(okc.call('skillReject', { which: which, why: f.why.trim() }));
                }
            });
        }

        return (
            <Pane>
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}

                <Cols>
                    <Col narrow>
                        {/* `Grow` IS A SPACER, NOT A WRAPPER. Written as
                            `<Grow>Skills</Grow>` the heading rendered as an empty
                            flexing box and the word did not appear — see
                            ../library/library.js, which has the shape right. */}
                        <TitleRow>
                            Skills<Grow />
                            <Badge kind="muted">{rows.length}</Badge>
                        </TitleRow>
                        <Stack>
                            {rows.map(function (x) {
                                return <Row key={x.which} x={x} on={x.which == which}
                                    onPick={function () { setWhich(x.which); }} />;
                            })}
                        </Stack>
                        <Note>
                            Each is fetched from this host at the head of a turn. Nothing is installed on a
                            machine, so a change here takes effect on the next one and restarts nothing.
                        </Note>
                    </Col>

                    <Col>

                        <Panel>
                            <div className="head-row">
                                <CardTitle>{it.title}</CardTitle>
                                <div className="head-controls">
                                    {/* THREE VIEWS, AND EACH IS ONE ACT. Not an
                                        "edit" button that changes what is under
                                        the pointer: which one you are in is
                                        readable without pressing anything. */}
                                    <Views names={['Read', 'Write', 'Review']} on={look} onPick={setLook} />
                                    {look == 'Write'
                                        ? <Button kind="ok" protect disabled={writing === served}
                                            title={writing === served ? 'nothing has changed' : 'propose it'}
                                            onClick={save}>Save it</Button>
                                        : null}
                                    {look == 'Write' && draft != null
                                        ? <Button kind="danger" onClick={discard}>Throw it away</Button>
                                        : null}
                                </div>
                            </div>
                            <CardSub>{it.about}</CardSub>

                            {/* SAID WHEREVER YOU ARE STANDING. A change waiting
                                on a person, visible only from the tab nobody is
                                on, is a decision made by silence — which is the
                                fault the master column was rebuilt for and is
                                just as true one tab away. */}
                            {proposed && look != 'Review'
                                ? <Note kind="warn">
                                    A change is waiting on you. Read it in <strong>Review</strong> — nothing is
                                    served from it until it is approved there.
                                </Note>
                                : null}

                            <Kv>
                                <KvRow label="size">{sized(it.characters) + ' · ' + it.lines + ' lines'}</KvRow>
                                <KvRow label="last written">{day(it.edited) || 'not known'}</KvRow>
                                <KvRow label="read from"><Mono>{it.where}</Mono></KvRow>
                            </Kv>

                            {look == 'Read' ? (
                                //A SKILL IS A MARKDOWN FILE, so it is read as one.
                                <Code text={served} mode="markdown" tall />
                            ) : null}

                            {look == 'Write' ? (
                                <div>
                                    {/*---- ONE EDITOR, NOT A COMPARISON --------

                                        THIS WAS SIDE BY SIDE AND IT WAS THE
                                        WRONG TOOL FOR THE JOB. Two panes of the
                                        same document with one of them typeable
                                        asks somebody to work out which half they
                                        are in before they can start a sentence —
                                        and while WRITING, the comparison answers
                                        a question nobody is asking yet. It is
                                        the question you ask when DECIDING, which
                                        is the next tab along. */}
                                    <Note kind="warn">
                                        This is the document as it stands, and it takes typing. Nothing is served
                                        from what you write here: pressing Save it puts it in <strong>Review</strong>,
                                        where it is read against what is served now and approved or turned down.
                                    </Note>
                                    <Note>
                                        While there are unsaved edits here, a save from anywhere else is refused
                                        rather than allowed to overwrite them.
                                    </Note>
                                    <Editor text={writing} mode="markdown" min={20} max={900}
                                        editable onChange={setDraft} />
                                </div>
                            ) : null}
                        </Panel>

                        {look == 'Review' ? (
                            <div>
                            {/*---- WHAT IS WAITING, FIRST -----------------------

                                ABOVE THE DOCUMENT, WHICH IS THE ONE PLACE THIS PANE
                                PUTS SOMETHING ABOVE WHAT IS SERVED. A proposal is
                                the only thing here that is waiting on a person, and
                                a decision that has to be scrolled to is a decision
                                made by silence. */}
                            {proposed ? (
                                <Panel>
                                    <div className="head-row">
                                        <CardTitle>
                                            It has asked for a change{' '}
                                            <Badge kind="warn">waiting on you</Badge>
                                        </CardTitle>
                                        <div className="head-controls">
                                            <Button kind="ok" protect onClick={approve}>Approve it</Button>
                                            <Button kind="danger" onClick={reject}>Turn it down</Button>
                                        </div>
                                    </div>

                                    <Kv>
                                        <KvRow label="because">{proposed.why}</KvRow>
                                        <KvRow label="asked by">{proposed.by || 'not recorded'}</KvRow>
                                        <KvRow label="asked at">{day(proposed.at)}</KvRow>
                                        <KvRow label="size">
                                            {proposed.characters + ' characters, against ' + proposed.was}
                                            <span className="muted">
                                                {' — ' + (proposed.characters >= proposed.was ? '+' : '')
                                                    + (proposed.characters - proposed.was)}
                                            </span>
                                        </KvRow>
                                        {proposed.replaced
                                            ? <KvRow label="replaced">
                                                <span className="muted">{'an earlier proposal from '
                                                    + day(proposed.replaced) + ', which was never answered'}</span>
                                            </KvRow>
                                            : null}
                                    </Kv>

                                    <Note>
                                        Nothing is served from this. What is served is on the left, the proposal is on
                                        the right, and only the changed lines are marked.
                                    </Note>
                                    <Diff left={served} right={proposed.text} mode="markdown" height={420} />
                                </Panel>
                            ) : null}
                            {/*---- AND WHAT IT HAS BEEN -------------------------

                                NOTHING HERE UNTIL SOMETHING IS KEPT, rather than an
                                empty panel: a copy is kept from the first save or
                                approval made through this app, and a file that
                                existed before that has no past this can show. */}
                            {versions.length ? (
                                <Panel>
                                    <CardTitle>
                                        {'What it has been'}{' '}
                                        <Badge kind="muted">{versions.length + ' kept'}</Badge>
                                    </CardTitle>
                                    <CardSub>
                                        A copy is kept every time a person writes one or approves one — what they put
                                        their name to, and what changed to reach it.
                                    </CardSub>

                                    <Chips>
                                        {versions.map(function (v, i) {
                                            var mineNow = atVer ? atVer == v.at : i === 0;
                                            return (
                                                <Chip key={v.at} on={mineNow}
                                                    onClick={function () { setAtVer(i === 0 ? null : v.at); }}>
                                                    {day(v.at) + (v.first ? ' · first' : ' · +' + v.added + ' / -' + v.gone)}
                                                </Chip>
                                            );
                                        })}
                                    </Chips>

                                    {showing ? (
                                        <div>
                                            <Kv>
                                                <KvRow label="written by">
                                                    {(showing.by || 'somebody') + ', ' + day(showing.at)}
                                                </KvRow>
                                                <KvRow label="what changed">{showing.note}</KvRow>
                                                {showing.why ? <KvRow label="because">{showing.why}</KvRow> : null}
                                            </Kv>

                                            {/* THE FROZEN DIFF, NOT ONE WORKED OUT
                                                NOW. It was computed against what
                                                stood before it and kept beside it, so
                                                what this version was a change TO
                                                cannot be quietly rewritten by
                                                whatever is newest today. */}
                                            {showing.first
                                                ? <Code text={showing.text} mode="markdown" tall />
                                                : <Code text={showing.changed || ''} mode="diff" tall />}
                                            {showing.first
                                                ? <Note>
                                                    The first version kept of this, so it is not a change to anything —
                                                    what is above is the document as it stood.
                                                </Note>
                                                : null}

                                            {/* AND THE ONE COMPARISON THAT IS NOT A
                                                RECORD: the newest kept version
                                                against the file as it is now. They
                                                differ when something wrote it
                                                outside this app. */}
                                            {!atVer && String(showing.text) !== String(served) ? (
                                                <div>
                                                    <Note kind="warn">
                                                        And the file has changed since. What was kept is on the left;
                                                        what is served now is on the right — something wrote it without
                                                        coming through this pane.
                                                    </Note>
                                                    <Diff left={showing.text} right={served} mode="markdown" height={340} />
                                                </div>
                                            ) : null}
                                        </div>
                                    ) : <Skeleton rows={3} />}
                                </Panel>
                            ) : (
                                <Panel>
                                    <CardTitle>What it has been</CardTitle>
                                    <Empty>
                                        Nothing kept yet. A copy is kept from the first save or approval made here —
                                        what the file was before that is not recoverable.
                                    </Empty>
                                </Panel>
                            )}
                            </div>
                        ) : null}

                    </Col>
                </Cols>
            </Pane>
        );
    }

    return Skill;
};
