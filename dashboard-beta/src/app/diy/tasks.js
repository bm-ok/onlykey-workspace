var React = require('react');
var { useState } = React;

//---------------------------------------------------------------------------
//MY OWN WORK — the pane.
//
//WHAT A SEAT IS. A worker is a seat, and today the app builds one for a model:
//a machine out of the pool, a branch cut laid on it, a credential lent to it, a
//session run against a brief, pushed back to the cut. DIY is the same seat with
//a person in it — running their own session, by hand — and nothing downstream
//taking what comes out.
//
//SO THE LIST IS SEATS, NOT MACHINES. The machine is one of the three things a
//seat is made of. The first attempt at this pane was a machine list, and it put
//the plumbing on screen and the work behind it.
//
//AND THE PIECES READ AS A CHECKLIST, because the question in front of somebody
//coming back to this tomorrow is never "what is the state of my VM" — it is
//"can I get back to work, and if not, what is missing".
//
//THE LOOK WAS AGREED BEFORE ANY OF THIS WAS WIRED, against seats written into
//this file. That is why the shape here is not a first draft: it is the third,
//and the two before it were thrown away on a screenshot rather than after a
//week of back end built on the wrong idea.
//---------------------------------------------------------------------------

module.exports = function tasks(theme, okc, remember) {
    var {
        Pane, Panel, Cols, Col, Stack, TitleRow, Grow, Card, CardTitle, CardSub,
        Badge, Button, Empty, Note, Notice, Mono, Muted, Plus, Skeleton, Group, Head, Part, PartWhy, ask
    } = theme;

    //---- what a seat is made of, and whether it is there --------------------
    //
    //ONE FUNCTION, SO THE CARD AND THE CHECKLIST CANNOT DISAGREE. The badge on
    //the card in the list and the rows in the middle column are two readings of
    //the same three facts, and two readings is how a pane says "ready" beside a
    //list of what is missing.
    function piecesOf(s, cutsBy) {
        var m = s.machine;
        var known = s.cut ? cutsBy[s.cut] : null;

        return [
            {
                key: 'machine',
                what: 'a machine of my own',
                //A MACHINE THAT IS NAMED AND GONE IS NOT A MACHINE. The server
                //answers `there: false` for one deleted out from under a piece
                //of work, and counting it as present would draw a seat as ready
                //that cannot be opened.
                there: !!(m && m.there),
                right: !m
                    ? <Badge kind="warn">none yet</Badge>
                    : !m.there
                        ? <span><Mono>{m.name}</Mono>{' '}<Badge kind="bad">gone</Badge></span>
                        : <span><Mono>{m.name}</Mono>{' '}<Badge kind={m.running ? 'ok' : ''}>{m.running ? (m.connected ? 'running' : 'running, not dialled in') : 'off'}</Badge></span>,
                why: !m
                    ? 'Nothing is set aside for this yet. Taking one keeps the queue off it for as long as you want it.'
                    : !m.there
                        ? 'It was taken for this and is not in the register any more — it was deleted somewhere else. Opening this will take another.'
                        : 'Out of the pool and yours. The queue will not take it and nothing rolls it back while you are in it.'
            },
            {
                key: 'cut',
                what: 'a branch cut to push into',
                there: !!s.cut,
                right: s.cut
                    ? <span><Mono>{s.cut}</Mono>{known ? <span>{' '}<Muted>{known.repos + ' repos'}</Muted></span> : null}</span>
                    : <Badge kind="warn">none picked</Badge>,
                why: s.cut
                    ? 'Every repository is on this branch on the machine, with origin pointing back at this host — so a push lands here, not on GitHub.'
                    : 'This is the bucket the work goes into. Pick one with Edit, or cut one in Repositories.'
            },
            {
                key: 'signin',
                what: 'my Claude sign-in on it',
                there: !!s.signIn,
                right: s.signIn
                    ? <span><Mono>{s.signIn.as}</Mono>{' '}<Badge kind="ok">held</Badge></span>
                    : <Badge kind="warn">not lent yet</Badge>,
                why: s.signIn
                    ? 'Typing claude in a terminal in there works, as you. It stays on the machine until it is taken back.'
                    : 'Without it, claude on the machine cannot authenticate and the session will not start.'
            }
        ];
    }

    function Seat({ s, cutsBy, on, onPick }) {
        var missing = piecesOf(s, cutsBy).filter(function (p) { return !p.there; }).length;
        return (
            <Card pick on={on} onClick={onPick}>
                <CardTitle>
                    {s.title}{' '}
                    {s.state === 'done'
                        ? <Badge>done</Badge>
                        : missing
                            ? <Badge kind="warn">{missing + ' to set up'}</Badge>
                            : <Badge kind="ok">ready</Badge>}
                </CardTitle>
                <CardSub>
                    {s.cut ? <Mono>{s.cut}</Mono> : <Muted>no cut yet</Muted>}
                </CardSub>
            </Card>
        );
    }

    function Tasks() {
        var { state: got, error, again } = okc.use('diy', {}, 5000);
        //WHERE SOMEBODY WAS LOOKING, WHICH IS ALL `remember` MAY KEEP. The
        //pieces of work themselves are the workspace's, in its own drawer.
        var [picked, setPicked] = remember.use('diy', 'picked', null);
        var [said, setSaid] = useState(null);

        var items = (got && got.items) || [];
        var cuts = (got && got.cuts) || [];

        var cutsBy = {};
        cuts.forEach(function (c) { cutsBy[c.branch] = c; });

        var s = items.filter(function (x) { return x.id === picked; })[0] || null;

        //WHAT IS ON THE CUT, ASKED ONLY WHEN THERE IS ONE. ../core/okc/ask.js
        //takes a falsy action to mean "not yet", which is how a pane with a
        //selection avoids asking a question that has no answer.
        var { state: carries } = okc.use(s && s.cut ? 'branchArtifacts' : null, { branch: s && s.cut }, 15000);

        function run(action, args, saying) {
            return okc.call(action, args).then(function (r) {
                again();
                setSaid({ text: saying || (r && r.note) || 'Done.' });
                return r;
            }, function (e) {
                setSaid({ bad: true, text: e.message });
                throw e;
            });
        }

        function notYet() {
            setSaid({ text: 'Not wired up yet — this one is still to come.' });
        }

        //---- THE ONE PRESS --------------------------------------------------
        //
        //IT ASKS ONLY WHAT IT CANNOT KNOW, AND ONLY ONCE. Which machine and
        //which sign-in are a person's choice, and the piece of work remembers
        //both — so the first press has a dialog in front of it and every one
        //after it does not.
        //
        //THE SERVER REFUSES EITHER WAY. `diyOpen` names the free machines and
        //sign-ins in its refusal; this dialog is the courtesy in front of that,
        //the same way the cut picker is in front of the one-per-cut rule.
        function open(x) {
            var needsMachine = !x.machine || !x.machine.there;
            var needsSignIn = !x.signIn && !(x.machine && x.machine.holdsCredential);

            function go(extra) {
                setSaid({ text: 'Setting ' + x.title + ' up. It says what it is doing in Live — starting a machine '
                    + 'and laying the workspace down takes a few minutes the first time.' });
                return run('diyOpen', Object.assign({ id: x.id }, extra || {}));
            }

            if (!needsMachine && !needsSignIn) return go();

            ask({
                title: 'Open ' + x.title,
                plain: [
                    'It takes the machine out of the pool, brings it up, lays ' + x.cut + ' on it, lends it your '
                        + 'sign-in, and opens it in VS Code.',
                    'Every step it does not need is skipped, so this is the slow press and the ones after it are not.'
                ],
                fields: [
                    needsMachine ? {
                        name: 'machine', label: 'Which machine', needed: true, options: machineOptions(),
                        hint: 'It comes out of the pool and stays yours until you give it back. Nothing else will be given work on it.'
                    } : null,
                    needsSignIn ? {
                        name: 'signIn', label: 'Which sign-in', needed: true, options: signInOptions(),
                        hint: 'Lent to the machine so claude runs in there as you. It stays until it is taken back.'
                    } : null
                ].filter(Boolean),
                confirm: 'Set it up and open it',
                onYes: function (f) {
                    var extra = {};
                    if (f.machine) extra.machine = f.machine;
                    if (f.signIn) extra.signIn = f.signIn;
                    return go(extra);
                }
            });
        }

        //THE CUTS SOMETHING ELSE ALREADY HAS ARE NOT OFFERED. The refusal lives
        //in the store; this is the courtesy in front of it, because a picker
        //that lists something and then rejects it taught you the rule by wasting
        //the attempt.
        function cutOptions(exceptId) {
            var free = cuts.filter(function (c) { return !c.takenBy || c.takenBy.id === exceptId; });
            return [{ value: '', label: 'none yet — pick one later' }].concat(free.map(function (c) {
                return { value: c.branch, label: c.branch + ' — ' + c.repos + ' repos' };
            }));
        }

        function gone(exceptId) {
            return cuts.filter(function (c) { return c.takenBy && c.takenBy.id !== exceptId; }).length;
        }

        //WHAT EACH ONE IS ALREADY DOING, ON ITS OWN LINE. A list of bare machine
        //names asks somebody to remember which of them is holding the work they
        //were doing on Tuesday — and taking the wrong one is not a mistake you
        //find out about until the workspace has been laid over the top.
        function machineOptions() {
            return ((got && got.machines) || []).map(function (m) {
                var says = [];
                if (m.usedBy) says.push('already ' + m.usedBy);
                else if (m.keptBack) says.push('kept back');
                if (m.branch) says.push('on ' + m.branch);
                says.push(m.running ? 'running' : 'off');
                return { value: m.name, label: m.name + ' — ' + says.join(', ') };
            });
        }

        function signInOptions() {
            return ((got && got.signIns) || []).map(function (g) {
                return {
                    value: g.name,
                    label: g.name + ' (' + g.role + ')' + (g.holder ? ' — on ' + g.holder : '')
                };
            });
        }

        //---- starting one ---------------------------------------------------
        //
        //THREE FIELDS. The machine and the sign-in are not decisions a person
        //makes at the moment they start — they are setup, and the one press
        //works them out afterwards. A form that asked for them here would be
        //asking somebody to configure a runner before they have written down
        //what they are doing.
        function makeOne() {
            var short = gone(null);
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
                        name: 'cut', label: 'Branch cut to push into', options: cutOptions(null),
                        hint: 'The bucket the work goes in. Every repository sits on this branch on the machine, with '
                            + 'origin pointing back at this host.'
                            + (short ? ' ' + short + ' already belong to something here and are not offered — one piece of work per cut.' : '')
                    }
                ],
                confirm: 'Start it',
                onYes: function (f) {
                    return okc.call('diyStart', { title: f.title, notes: f.what, cut: f.cut || undefined })
                        .then(function (r) {
                            again();
                            if (r && r.id) setPicked(r.id);
                            setSaid({ text: (r && r.note) || 'Started.' });
                        }, function (e) { setSaid({ bad: true, text: e.message }); throw e; });
                }
            });
        }

        //---- changing one ---------------------------------------------------
        //
        //THE CUT IS NOT EDITABLE ONCE SET. It is the bucket: the machine's whole
        //workspace is laid down on that branch and commits sit on it, so
        //changing it would not MOVE anything — it would point this somewhere
        //else and orphan what was pushed. Shown disabled rather than hidden,
        //because "this cannot change" is a different sentence from "there is
        //nothing here". The store refuses it too — this is the courtesy.
        function editOne(x) {
            var has = !!x.cut;
            ask({
                title: 'Change ' + x.title,
                plain: has
                    ? ['The cut cannot be changed: work is already pushed to it, and pointing this somewhere else '
                        + 'would leave that behind with nothing naming it.']
                    : ['No cut has been picked yet, so one can still be set here. After that it is fixed.'],
                fields: [
                    {
                        name: 'title', label: 'Title', needed: true, value: x.title,
                        hint: 'Short enough to pick out of a list of a dozen a fortnight from now.'
                    },
                    {
                        name: 'what', label: 'What are you doing?', multiline: true, rows: 6, value: x.notes,
                        placeholder: 'In your own words.',
                        hint: 'For you to read when you come back to it. Nothing is sent anywhere.'
                    },
                    has
                        ? {
                            name: 'cut', label: 'Branch cut', value: x.cut, disabled: true,
                            hint: 'Fixed for the life of this piece of work. To work on another branch, start another one.'
                        }
                        : {
                            name: 'cut', label: 'Branch cut to push into', options: cutOptions(x.id),
                            hint: 'Settable once. Cuts that belong to something else here are not offered.'
                        }
                ],
                confirm: 'Save it',
                onYes: function (f) {
                    //THE CUT IS ONLY SENT WHEN THERE WAS NONE. The disabled
                    //field submits its value, and sending it back would be this
                    //pane asking to set the cut it already has on every save.
                    var patch = { id: x.id, title: f.title, notes: f.what || '' };
                    if (!has && f.cut) patch.cut = f.cut;
                    return run('diyChange', patch, 'Changed.');
                }
            });
        }

        if (!got && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!got) return <Pane><Skeleton rows={4} /></Pane>;

        var pieces = s ? piecesOf(s, cutsBy) : [];
        var ready = s && pieces.every(function (p) { return p.there; });

        //WHAT IS ACTUALLY ON THE BRANCH, per repository — and only the ones
        //carrying something, because nine rows of "nothing yet" is a wall that
        //hides the two that matter.
        var repos = ((carries && carries.git && carries.git.repos) || []);
        var carrying = repos.filter(function (r) { return r.ahead > 0; });

        return (
            <Pane>
                {error ? <Note kind="bad">{error}</Note> : null}
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}
                <Cols>
                    <Col narrow>
                        <TitleRow>
                            My work<Grow />
                            <span className="muted">{items.length}</span>
                            <Plus title="Start a new piece of work of my own" onClick={makeOne} />
                        </TitleRow>
                        <Stack>
                            {items.length
                                ? items.map(function (x) {
                                    return <Seat key={x.id} s={x} cutsBy={cutsBy} on={x.id === picked}
                                        onPick={function () { setPicked(x.id); }} />;
                                })
                                : <Empty>{got.note || 'Nothing of your own yet.'}</Empty>}
                        </Stack>
                        <Note>Mine, and self-managed. Nothing here is queued, and no supervisor asks about it.</Note>
                    </Col>

                    {/* THE NAME IS NOT IN THE HEADING. `h2` uppercases, and a
                        name in caps is a different name to the eye than the one
                        in the list two inches to the left — ../ui/theme/bits.js
                        says so about `Head`, and it is truer of these, which
                        somebody named themselves. */}
                    <Col>
                        <TitleRow>This piece of work<Grow /></TitleRow>

                        {!s ? <Empty>Pick something on the left.</Empty> : (
                            <Panel>
                                <CardTitle>
                                    {s.title}{' '}
                                    {s.state === 'done' ? <Badge>done</Badge> : ready ? <Badge kind="ok">ready</Badge> : null}
                                </CardTitle>
                                {s.notes
                                    ? <p>{s.notes}</p>
                                    : <p><Muted>Nothing written down about this one.</Muted></p>}

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

                                    NOT ONE OF SIX BUTTONS. Taking a machine,
                                    laying the cut on it, lending the sign-in
                                    and opening the editor are four acts to the
                                    app and ONE act to the person: let me get
                                    back to work. The rows above are where you
                                    look when it cannot.

                                    PURPLE BECAUSE IT OPENS A WINDOW ON THIS
                                    DESK, which is out of bounds for anything
                                    but a person. */}
                                <div className="row" style={{ marginTop: '12px' }}>
                                    <Button kind="ok" protect
                                        disabled={!s.cut}
                                        title={s.cut ? 'set it up if it needs it, then open it' : 'it has no cut to work on yet'}
                                        onClick={function () { open(s); }}>
                                        {ready ? 'Open it in VS Code' : 'Set it up and open it'}
                                    </Button>
                                    <Button disabled={!s.machine || !s.machine.there} onClick={notYet}>Watch the session</Button>
                                </div>
                                <PartWhy>
                                    {!s.cut
                                        ? 'Give it a cut first — there is nowhere for the work to go.'
                                        : ready
                                            ? 'Opens ' + s.cut + ' on ' + s.machine.name + ', over ssh, with this app’s own key.'
                                            : 'Takes a machine, lays the cut on it, lends your sign-in, then opens it — in that order, saying what it is doing.'}
                                </PartWhy>

                                <div className="row" style={{ marginTop: '12px' }}>
                                    <Button onClick={function () { editOne(s); }}>Edit</Button>
                                    <Button onClick={function () {
                                        return run('diyChange', { id: s.id, state: s.state === 'done' ? 'open' : 'done' },
                                            s.state === 'done' ? 'Open again.' : 'Called done. Nothing else changes — the machine and the branch are as they were.');
                                    }}>{s.state === 'done' ? 'Open it again' : 'Mark it done'}</Button>
                                    <Button kind="danger" protect onClick={function () {
                                        ask({
                                            title: 'Take "' + s.title + '" off the list?',
                                            plain: [
                                                'It goes from this list and nothing else happens.',
                                                s.cut ? '"' + s.cut + '" and everything pushed to it stay exactly as they are.' : null,
                                                s.machine ? s.machine.name + ' stays yours until you give it back on Runners.' : null
                                            ],
                                            confirm: 'Forget it',
                                            onYes: function () {
                                                return run('diyForget', { id: s.id }).then(function () { setPicked(null); });
                                            }
                                        });
                                    }}>Forget it</Button>
                                </div>
                            </Panel>
                        )}
                    </Col>

                    <Col wide>
                        <TitleRow>What I have pushed<Grow /></TitleRow>
                        {!s ? <Empty>nothing selected</Empty> : !s.cut ? <Empty>No cut yet, so there is nowhere for work to have gone.</Empty> : (
                            <Panel>
                                {/* WHAT THIS SECTION IS, THEN WHICH. The branch
                                    goes in `Muted`, which is the kit's own reset
                                    for the uppercasing — a branch name read
                                    character by character must not be shouted. */}
                                <Group>
                                    <Head>the cut <Muted>{s.cut}</Muted></Head>
                                    {!carries
                                        ? <Skeleton rows={2} />
                                        : carrying.length
                                            ? carrying.map(function (r) {
                                                var top = (r.commits || [])[0];
                                                return (
                                                    <div key={r.repo}>
                                                        <Part right={<Badge kind="ok">{r.ahead + (r.ahead === 1 ? ' commit' : ' commits')}</Badge>}>
                                                            <Mono>{r.repo}</Mono>
                                                        </Part>
                                                        <PartWhy>{top ? (top.subject || top.message || top.id) : 'ahead of ' + r.base}</PartWhy>
                                                    </div>
                                                );
                                            })
                                            : <Empty>{'Nothing pushed yet. The branch is cut in ' + repos.length + ' repositories and every one is level with its base.'}</Empty>}
                                </Group>

                                {/*---- WHAT DOES NOT HAPPEN TO IT ------------

                                    SAID OUT LOUD, because every other pane that
                                    looks like this one is a pane where something
                                    downstream is about to act. A person who
                                    assumes the loop will pick this up is a
                                    person whose work sits there. */}
                                <Note>
                                    Nothing reads this. No judge, no queue, no sweep, and no pull request until
                                    you decide there should be one.
                                </Note>
                                <div className="row">
                                    <Button disabled={!carrying.length} onClick={notYet}>Cut a pull request from it</Button>
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
