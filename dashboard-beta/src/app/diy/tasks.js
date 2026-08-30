var React = require('react');
var { useState } = React;

//---------------------------------------------------------------------------
//THE LOOK, BEFORE ANY OF IT WORKS.
//
//NOTHING HERE ASKS THE APP ANYTHING. Every seat below is written into this
//file, the presses say so and do nothing, and that is the point: the shape gets
//approved before a line of the back half is written, because a pane built first
//and shown last means every correction costs a rewrite and the person looking at
//it carries the risk of my guesses.
//
//WHAT A SEAT IS. A worker is a seat, and today the app builds one for a model:
//a machine out of the pool, a branch cut laid on it, a credential lent to it, a
//session run against a brief, pushed back to the cut. DIY is the same seat with
//a person in it — running their own session, by hand — and nothing downstream
//taking what comes out.
//
//SO THE LIST IS SEATS, NOT MACHINES. The machine is one of the four things a
//seat is made of. Reading the pane as a machine list is what the first attempt
//at this did, and it put the plumbing on screen and the work behind it.
//
//AND THE FOUR PIECES READ AS A CHECKLIST, because the question in front of
//somebody coming back to this tomorrow is never "what is the state of my VM" —
//it is "can I get back to work, and if not, what is missing".
//---------------------------------------------------------------------------

//---- WRITTEN IN, ON PURPOSE ------------------------------------------------
//
//Three seats in three different states, because a pane that has only ever been
//drawn with everything working is a pane whose empty and half-ready cases get
//designed by accident.
var SEATS = [
    {
        id: 'a',
        name: 'flat workspace layout',
        notes: 'Make setup.sh build from the flat layout instead of cloning into onlykey/.',
        state: 'open',
        cut: { branch: 'diy/flat-workspace-layout', repos: 9, commits: 3 },
        machine: { name: 'beta-worker1', running: true, mine: true },
        signIn: { as: 'worker-b2', held: true },
        pushed: [
            { repo: 'node-onlykey-emulator', commits: 2, last: 'setup.sh: build from siblings' },
            { repo: 'OnlyKey-App', commits: 1, last: 'point the component paths at ../' },
            { repo: 'libraries', commits: 0, last: null },
            { repo: 'python-onlykey', commits: 0, last: null }
        ]
    },
    {
        id: 'b',
        name: 'try the new key path',
        notes: 'See whether the app key can replace the per-machine one end to end.',
        state: 'open',
        cut: null,
        machine: null,
        signIn: null,
        pushed: []
    },
    {
        id: 'c',
        name: 'okpqc venv upgrade',
        notes: 'Done — left here until I decide whether it becomes a pull request.',
        state: 'done',
        cut: { branch: 'diy/okpqc-venv', repos: 9, commits: 7 },
        machine: null,
        signIn: null,
        pushed: [{ repo: 'python-onlykey', commits: 7, last: 'okpqc: pin the venv' }]
    }
];

//---- THE CUTS THERE ARE, ALSO WRITTEN IN --------------------------------
//
//A real one asks the app which branches exist. This is a list so the dialog can
//be judged with something in it: a picker whose only state anybody ever sees is
//empty is a picker nobody can tell is wrong.
//
//"none yet" IS AN OPTION AND IS FIRST. A piece of work can be written down
//before there is anywhere to push it — that is the ordinary way round, since the
//describing is what tells you what to cut.
var CUTS = [
    { value: '', label: 'none yet — pick one later' },
    { value: 'diy/flat-workspace-layout', label: 'diy/flat-workspace-layout — 9 repos, 3 commits' },
    { value: 'diy/okpqc-venv', label: 'diy/okpqc-venv — 9 repos, 7 commits' },
    { value: 'diy/app-key-path', label: 'diy/app-key-path — 9 repos, nothing on it yet' }
];

module.exports = function tasks(theme) {
    var {
        Pane, Panel, Cols, Col, Stack, TitleRow, Grow, Card, CardTitle, CardSub,
        Badge, Button, Empty, Note, Notice, Mono, Muted, Plus, Group, Head, Part, PartWhy, ask
    } = theme;

    //---- what a seat is made of, and whether it is there --------------------
    //
    //ONE FUNCTION, SO THE CARD AND THE CHECKLIST CANNOT DISAGREE. The badge on
    //the card in the list and the rows in the middle column are two readings of
    //the same four facts, and two readings is how a pane says "ready" beside a
    //list of what is missing.
    function piecesOf(s) {
        return [
            {
                key: 'machine',
                what: 'a machine of my own',
                there: !!s.machine,
                right: s.machine
                    ? <span><Mono>{s.machine.name}</Mono>{' '}<Badge kind={s.machine.running ? 'ok' : ''}>{s.machine.running ? 'running' : 'off'}</Badge></span>
                    : <Badge kind="warn">none yet</Badge>,
                why: s.machine
                    ? 'Out of the pool and yours. The queue will not take it and nothing rolls it back while you are in it.'
                    : 'Nothing is set aside for this yet. Taking one keeps the queue off it for as long as you want it.'
            },
            {
                key: 'cut',
                what: 'a branch cut to push into',
                there: !!s.cut,
                right: s.cut
                    ? <span><Mono>{s.cut.branch}</Mono>{' '}<Muted>{s.cut.repos + ' repos'}</Muted></span>
                    : <Badge kind="warn">none picked</Badge>,
                why: s.cut
                    ? 'Every repository is on this branch on the machine, with origin pointing back at this host — so a push lands here, not on GitHub.'
                    : 'This is the bucket the work goes into. Pick a cut that exists, or make one.'
            },
            {
                key: 'signin',
                what: 'my Claude sign-in on it',
                there: !!(s.signIn && s.signIn.held),
                right: s.signIn && s.signIn.held
                    ? <span><Mono>{s.signIn.as}</Mono>{' '}<Badge kind="ok">held</Badge></span>
                    : <Badge kind="warn">not lent yet</Badge>,
                why: s.signIn && s.signIn.held
                    ? 'Typing claude in a terminal in there works, as you. It stays on the machine until it is taken back.'
                    : 'Without it, claude on the machine cannot authenticate and the session will not start.'
            }
        ];
    }

    function Seat({ s, on, onPick }) {
        var missing = piecesOf(s).filter(function (p) { return !p.there; }).length;
        return (
            <Card pick on={on} onClick={onPick}>
                <CardTitle>
                    {s.name}{' '}
                    {s.state === 'done'
                        ? <Badge>done</Badge>
                        : missing
                            ? <Badge kind="warn">{missing + ' to set up'}</Badge>
                            : <Badge kind="ok">ready</Badge>}
                </CardTitle>
                <CardSub>
                    {s.cut ? <Mono>{s.cut.branch}</Mono> : <Muted>no cut yet</Muted>}
                </CardSub>
            </Card>
        );
    }

    function Tasks() {
        //HELD IN THE WINDOW AND NOWHERE ELSE, while this is the look. A seat
        //made here survives until the page reloads, which is enough to judge how
        //adding one FEELS and is honest about keeping nothing.
        var [seats, setSeats] = useState(SEATS);
        var [picked, setPicked] = useState('a');
        var [said, setSaid] = useState(null);

        var s = seats.filter(function (x) { return x.id === picked; })[0] || null;
        var pieces = s ? piecesOf(s) : [];
        var ready = s && pieces.every(function (p) { return p.there; });

        //EVERY PRESS SAYS THE SAME THING, because a mock whose buttons quietly
        //do nothing is one somebody tests by pressing and then distrusts.
        function notYet() {
            setSaid('This is the look, not the working thing. Nothing is wired up behind these yet.');
        }

        //---- STARTING ONE -------------------------------------------------
        //
        //WHAT IT IS CALLED, WHAT IT IS, AND WHERE IT PUSHES. The machine and the
        //sign-in are still not asked for: they are not decisions a person makes
        //at the moment they start, they are setup, and the one press works them
        //out afterwards. A form that asked for them here would be asking
        //somebody to configure a runner before they have written down what they
        //are doing.
        //
        //THE TITLE IS ITS OWN FIELD, AND WAS NOT AT FIRST. The first line of the
        //description was being taken as the name, which reads as a saving until
        //you look at the list: what titles a card well is three or four words,
        //and the first line somebody writes when asked what they are doing is a
        //sentence. So the list filled with truncated sentences and the one place
        //a name is actually READ was the one place it was derived.
        function makeOne() {
            ask({
                title: 'Start a piece of work',
                plain: [
                    'Yours, and nothing else touches it: not the queue, not the judge, not the sweep.',
                    'The machine and your sign-in are set up by the one press afterwards.'
                ],
                fields: [
                    {
                        name: 'title', label: 'Title', needed: true,
                        placeholder: 'a few words — this is what the list shows',
                        hint: 'Short enough to pick out of a list of a dozen a fortnight from now.'
                    },
                    {
                        name: 'what', label: 'What are you doing?', multiline: true, rows: 6,
                        placeholder: 'In your own words.',
                        hint: 'This is for you to read when you come back to it — not a brief, and nothing is sent anywhere.'
                    },
                    {
                        name: 'cut', label: 'Branch cut to push into', options: CUTS,
                        hint: 'The bucket the work goes in. Every repository sits on this branch on the machine, with origin pointing back at this host.'
                    }
                ],
                confirm: 'Start it',
                onYes: function (f) {
                    //THE TITLE IS THE ONE THAT IS REFUSED WITHOUT. A piece of
                    //work with no description is a note to self somebody has not
                    //written yet; one with no name is a blank row in the list.
                    var name = String(f.title || '').trim();
                    if (!name) throw new Error('Give it a title — it is what the list shows.');

                    var text = String(f.what || '').trim();
                    var id = 'n' + Date.now().toString(36);
                    var cut = f.cut
                        ? { branch: f.cut, repos: 9, commits: 0 }
                        : null;

                    setSeats(function (was) {
                        return [{
                            id: id,
                            name: name,
                            notes: text,
                            state: 'open',
                            cut: cut,
                            machine: null,
                            signIn: null,
                            pushed: cut ? [] : []
                        }].concat(was);
                    });
                    setPicked(id);
                    setSaid('Written down here in the window only — this is still the look, so it goes when the page reloads.');
                }
            });
        }

        return (
            <Pane>
                {said ? <Notice kind="ok" onClose={function () { setSaid(null); }}>{said}</Notice> : null}
                <Cols>
                    <Col narrow>
                        <TitleRow>
                            My work<Grow />
                            <span className="muted">{seats.length}</span>
                            <Plus title="Start a new piece of work of my own" onClick={makeOne} />
                        </TitleRow>
                        <Stack>
                            {seats.map(function (x) {
                                return <Seat key={x.id} s={x} on={x.id === picked}
                                    onPick={function () { setPicked(x.id); }} />;
                            })}
                        </Stack>
                        <Note>Mine, and self-managed. Nothing here is queued, and no supervisor asks about it.</Note>
                    </Col>

                    {/*---- AND THE NAME IS NOT IN THE HEADING --------------

                        `h2` uppercases, and a name in caps is a different name
                        to the eye than the one in the list two inches to the
                        left — ../ui/theme/bits.js says so about `Head`, and it
                        is truer of these, which somebody named themselves. So
                        the heading is a fixed label and the name is a line of
                        ordinary text under it. */}
                    <Col>
                        <TitleRow>This piece of work<Grow /></TitleRow>

                        {!s ? <Empty>Pick something on the left.</Empty> : (
                            <Panel>
                                <CardTitle>
                                    {s.name}{' '}
                                    {s.state === 'done' ? <Badge>done</Badge> : ready ? <Badge kind="ok">ready</Badge> : null}
                                </CardTitle>
                                {/* THE DESCRIPTION IS OPTIONAL, so its absence is
                                    drawn rather than left as an empty paragraph
                                    that reads as a rendering fault. */}
                                {s.notes
                                    ? <p>{s.notes}</p>
                                    : <p><Muted>Nothing written down about this one.</Muted></p>}

                                {/*---- THE SEAT, AS FOUR ROWS ----------------

                                    NAME LEFT, STATE RIGHT, AND A SENTENCE
                                    UNDER IT. The sentence is the half that
                                    matters when a row is not ready: "none
                                    picked" says what is wrong and nothing
                                    about what to do, and the whole reason
                                    somebody is looking here is the second
                                    question. */}
                                <Group>
                                    <Head>What this seat is made of</Head>
                                    {pieces.map(function (p) {
                                        return (
                                            <div key={p.key}>
                                                <Part right={p.right}>{p.what}</Part>
                                                <PartWhy>{p.why}</PartWhy>
                                            </div>
                                        );
                                    })}
                                </Group>

                                {/*---- AND THE ONE PRESS ---------------------

                                    NOT ONE OF SIX BUTTONS. Bringing the
                                    machine up, laying the cut on it, lending
                                    the sign-in and opening the editor are four
                                    acts to the app and ONE act to the person:
                                    let me get back to work. So it is one
                                    press, it says what it will do, and the
                                    rows above are where you look when it
                                    cannot.

                                    PURPLE BECAUSE IT OPENS A WINDOW ON THIS
                                    DESK. Everything else here talks to a
                                    machine; this one reaches onto the
                                    operator's own computer, which is out of
                                    bounds for anything but a person. */}
                                <div className="row" style={{ marginTop: '12px' }}>
                                    <Button kind="ok" protect onClick={notYet}>
                                        {ready ? 'Open it in VS Code' : 'Set it up and open it'}
                                    </Button>
                                    <Button onClick={notYet}>Watch the session</Button>
                                </div>
                                <PartWhy>
                                    {ready
                                        ? 'Opens ' + s.cut.branch + ' on ' + s.machine.name + ', over ssh, with this app’s own key.'
                                        : 'Takes a machine, lays the cut on it, lends your sign-in, then opens it — in that order, saying what it is doing.'}
                                </PartWhy>

                                <div className="row" style={{ marginTop: '12px' }}>
                                    <Button onClick={notYet}>{s.state === 'done' ? 'Open it again' : 'Mark it done'}</Button>
                                    <Button onClick={notYet}>Give the machine back</Button>
                                </div>
                            </Panel>
                        )}
                    </Col>

                    <Col wide>
                        <TitleRow>What I have pushed<Grow /></TitleRow>
                        {!s || !s.cut ? <Empty>No cut yet, so there is nowhere for work to have gone.</Empty> : (
                            <Panel>
                                {/* WHAT THIS SECTION IS, THEN WHICH — the shape
                                    `Head` was built for. The branch goes in
                                    `Muted`, which is the kit's own reset for
                                    the uppercasing: a branch name read
                                    character by character must not be shouted,
                                    and .carries-head .muted exists for exactly
                                    this. */}
                                <Group>
                                    <Head>the cut <Muted>{s.cut.branch}</Muted></Head>
                                    {s.pushed.map(function (r) {
                                        return (
                                            <div key={r.repo}>
                                                <Part right={r.commits
                                                    ? <Badge kind="ok">{r.commits + (r.commits === 1 ? ' commit' : ' commits')}</Badge>
                                                    : <Muted>nothing yet</Muted>}>
                                                    <Mono>{r.repo}</Mono>
                                                </Part>
                                                {r.last ? <PartWhy>{r.last}</PartWhy> : null}
                                            </div>
                                        );
                                    })}
                                </Group>

                                {/*---- WHAT DOES NOT HAPPEN TO IT ------------

                                    SAID OUT LOUD, because every other pane
                                    that looks like this one is a pane where
                                    something downstream is about to act. A
                                    person who assumes the loop will pick this
                                    up is a person whose work sits there. */}
                                <Note>
                                    Nothing reads this. No judge, no queue, no sweep, and no pull request until
                                    you decide there should be one.
                                </Note>
                                <div className="row">
                                    <Button onClick={notYet}>Cut a pull request from it</Button>
                                </div>
                            </Panel>
                        )}
                    </Col>
                </Cols>
            </Pane>
        );
    }

    return Tasks;
};
