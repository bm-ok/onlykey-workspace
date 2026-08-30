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
    //A MACHINE TAGGED `diy` THAT NOTHING ELSE HAS IS ALREADY MINE. Which is the
    //correction this pane needed: it read the machine RECORDED ON THE SEAT, so
    //a workspace with a diy machine sitting in the pool, free, off, waiting,
    //drew "none yet" — in the same words as a workspace with no machine at all.
    //One of those is a press away and the other is a machine build away, and
    //the pane said the same thing about both.
    //
    //THE ROWS ANSWER "have I got what I need", not "what has been claimed".
    //Claiming is what the press does; a checklist that lists the press's own
    //steps as things missing is a checklist you cannot ever satisfy by hand.
    function freeMachines(pool) {
        return ((pool && pool.machines) || []).filter(function (m) { return !m.usedBy; });
    }
    function freeSignIns(pool) {
        return ((pool && pool.signIns) || []).filter(function (g) { return !g.holder; });
    }

    function piecesOf(s, cutsBy, pool) {
        var m = s.machine && s.machine.there ? s.machine : null;
        var known = s.cut ? cutsBy[s.cut] : null;

        //NAMED AND GONE IS A THING TO SAY. The server answers `there: false` for
        //a machine deleted out from under a piece of work, and that is neither
        //"mine" nor "none" — it is a machine this seat still points at.
        var lost = s.machine && !s.machine.there ? s.machine : null;
        var take = m ? null : freeMachines(pool)[0];
        var lend = s.signIn ? null : freeSignIns(pool)[0];
        var anyMachine = ((pool && pool.machines) || []).length;
        var anySignIn = ((pool && pool.signIns) || []).length;

        function state(v) {
            return <Badge kind={v.running ? 'ok' : ''}>{v.running ? (v.connected ? 'running' : 'running, not dialled in') : 'off'}</Badge>;
        }

        return [
            {
                key: 'machine',
                what: 'a machine of my own',
                there: !!(m || take),
                right: m
                    ? <span><Mono>{m.name}</Mono>{' '}{state(m)}</span>
                    : take
                        ? <span><Mono>{take.name}</Mono>{' '}<Badge kind={take.running ? 'ok' : ''}>{take.running ? 'running' : 'off'}</Badge></span>
                        : lost
                            ? <span><Mono>{lost.name}</Mono>{' '}<Badge kind="bad">gone</Badge></span>
                            : <Badge kind={anyMachine ? 'warn' : 'bad'}>{anyMachine ? 'all taken' : 'none tagged diy'}</Badge>,
                why: m
                    ? 'Out of the pool and yours. The queue will not take it and nothing rolls it back while you are in it.'
                    : take
                        ? 'Tagged diy and nothing else has it, so it is yours. Opening takes it out of the pool and starts it.'
                        : lost
                            ? 'It was taken for this and is not in the register any more — it was deleted somewhere else, and no other diy machine is free to replace it.'
                            : anyMachine
                                ? 'Every diy machine is already held by something else on this list. Finish one, or tag another machine diy.'
                                : 'Nothing here is tagged diy. Tag one on Runners → Virtual machines → Tags. A worker will not do: the queue would take it back underneath you.'
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
                there: !!(s.signIn || lend),
                right: s.signIn
                    ? <span><Mono>{s.signIn.as}</Mono>{' '}<Badge kind="ok">held</Badge></span>
                    : lend
                        ? <Mono>{lend.name}</Mono>
                        : <Badge kind={anySignIn ? 'warn' : 'bad'}>{anySignIn ? 'all lent out' : 'none kept'}</Badge>,
                why: s.signIn
                    ? 'Typing claude in a terminal in there works, as you. It stays on the machine until it is taken back.'
                    : lend
                        ? 'Kept here and on no machine, so it is free to lend. Opening puts it on the machine, and it stays there until it is taken back.'
                        : anySignIn
                            ? 'Your diy sign-in is out on another machine. Take it back on Keys, or add a second one.'
                            : 'There is no diy sign-in. Add one on Keys → Claude DIY — without it claude on the machine cannot authenticate. A worker key cannot be lent to a diy machine.'
            }
        ];
    }

    function Seat({ s, cutsBy, pool, on, onPick }) {
        var missing = piecesOf(s, cutsBy, pool).filter(function (p) { return !p.there; }).length;
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

        //---- THE CUTS ARE FETCHED WHEN A PICKER OPENS ---------------------
        //
        //THEY USED TO RIDE ALONG WITH THE POLL, and finding out which branches
        //are cuts means walking the repositories — so the pane paid for that
        //every few seconds to draw a list nothing was looking at. On nine
        //repositories that is most of what made this tab slow.
        //
        //`cutsBy` IS ONLY FOR THE REPO COUNT beside a cut's name in the
        //checklist, so it is empty until a dialog has been opened once. An
        //absent count draws as nothing rather than as a wrong number.
        var [cuts, setCuts] = useState([]);

        var cutsBy = {};
        cuts.forEach(function (c) { cutsBy[c.branch] = c; });

        var s = items.filter(function (x) { return x.id === picked; })[0] || null;

        //---- WHAT IS ON THE CUT, ASKED ONLY WHEN SOMEBODY ASKS -------------
        //
        //`branchArtifacts` TAKES ELEVEN SECONDS on a project of nine
        //repositories: it walks every one of them for a log and a diff. This
        //pane polled it every fifteen seconds, so one call finished four seconds
        //before the next began and the tab took half a minute to show anything.
        //
        //IT WAS NEVER MEASURED ANYWHERE REAL. On a workspace of three small
        //repositories it was fast enough to look free, and it went out on a
        //timer beside reads that genuinely are.
        //
        //NO INTERVAL AND NO SELECTION TRIGGER. ../core/okc/ask.js reads once
        //when `everyMs` is falsy, and the branch is only set by a press — so
        //picking a seat costs nothing and the eleven seconds are spent when
        //somebody has asked for them and is expecting a wait.
        var [reading, setReading] = useState(null);
        var { state: carries } = okc.use(reading ? 'branchArtifacts' : null, { branch: reading });

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

            //IT ONLY ASKS WHEN THERE IS SOMETHING TO DECIDE. One free diy
            //machine and one free diy sign-in is not a choice — it is the
            //answer, and putting it behind a dialog made the simplest possible
            //case, a person with exactly what they need, the slow one.
            //
            //THE SERVER PICKS, NOT THIS. `diyOpen` takes the only free one when
            //there is only one, so the command line behaves the same way and
            //this pane is not the place the rule lives. Which is why `go()` here
            //passes nothing: what it means is "you decide", not "I forgot".
            var pickMachine = needsMachine && freeMachines(got).length > 1;
            var pickSignIn = needsSignIn && freeSignIns(got).length > 1;

            function go(extra) {
                setSaid({ text: 'Setting ' + x.title + ' up. It says what it is doing in Live — starting a machine '
                    + 'and laying the workspace down takes a few minutes the first time.' });
                return run('diyOpen', Object.assign({ id: x.id }, extra || {}));
            }

            if (!pickMachine && !pickSignIn) return go();

            ask({
                title: 'Open ' + x.title,
                plain: [
                    'It takes the machine out of the pool, brings it up, lays ' + x.cut + ' on it, lends it your '
                        + 'sign-in, and opens it in VS Code.',
                    'Every step it does not need is skipped, so this is the slow press and the ones after it are not.'
                ],
                fields: [
                    pickMachine ? {
                        name: 'machine', label: 'Which machine', needed: true, options: machineOptions(),
                        hint: 'It comes out of the pool and stays yours until you give it back. Nothing else will be given work on it.'
                    } : null,
                    pickSignIn ? {
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
        //TAKING THE LIST AS AN ARGUMENT, because the caller has just awaited it
        //and React has not re-rendered yet — reading `cuts` here would read the
        //state as it was before the fetch, and the picker would open empty the
        //first time and correct itself on the second press.
        function cutOptions(exceptId, list) {
            var free = (list || []).filter(function (c) { return !c.takenBy || c.takenBy.id === exceptId; });
            return [{ value: '', label: 'none yet — pick one later' }].concat(free.map(function (c) {
                return { value: c.branch, label: c.branch + ' — ' + c.repos + ' repos' };
            }));
        }

        function gone(exceptId, list) {
            return (list || []).filter(function (c) { return c.takenBy && c.takenBy.id !== exceptId; }).length;
        }

        //WHAT EACH ONE IS ALREADY DOING, ON ITS OWN LINE. A list of bare machine
        //names asks somebody to remember which of them is holding the work they
        //were doing on Tuesday — and taking the wrong one is not a mistake you
        //find out about until the workspace has been laid over the top.
        //ONLY THE FREE ONES, because this only opens when there is more than one
        //free — so a machine another piece of work is sitting on is not a choice
        //here, it is a mistake with a workspace laid over the top of it.
        function machineOptions() {
            return freeMachines(got).map(function (m) {
                var says = [];
                if (m.branch) says.push('on ' + m.branch);
                says.push(m.running ? 'running' : 'off');
                return { value: m.name, label: m.name + ' — ' + says.join(', ') };
            });
        }

        function signInOptions() {
            return freeSignIns(got).map(function (g) {
                return { value: g.name, label: g.name + ' (' + g.role + ')' };
            });
        }

        //---- starting one ---------------------------------------------------
        //
        //THREE FIELDS. The machine and the sign-in are not decisions a person
        //makes at the moment they start — they are setup, and the one press
        //works them out afterwards. A form that asked for them here would be
        //asking somebody to configure a runner before they have written down
        //what they are doing.
        //---- THE CUTS, BEFORE A DIALOG THAT NEEDS THEM --------------------
        //
        //AWAITED RATHER THAN DRAWN FROM A POLL. `ask` builds its fields once,
        //when it opens, so the list has to be in hand first — a dialog that
        //filled in a second later would be one somebody had already answered.
        //
        //THE PRESS IS WHAT PAYS FOR IT, which is the whole point: seconds spent
        //when a picker is opened rather than seconds spent every few seconds
        //whether or not anyone is looking.
        async function withCuts() {
            try {
                var said = await okc.call('diyCuts', {});
                var got2 = (said && said.cuts) || [];
                setCuts(got2);
                return got2;
            } catch (e) {
                //A PICKER WITH NOTHING IN IT IS STILL USABLE — "none yet" is a
                //real answer — so this says what went wrong and opens anyway
                //rather than swallowing the press.
                setSaid({ bad: true, text: 'Could not read the branch cuts: ' + e.message });
                return [];
            }
        }

        async function makeOne() {
            var have = await withCuts();
            var short = gone(null, have);
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
                        name: 'cut', label: 'Branch cut to push into', options: cutOptions(null, have),
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
        async function editOne(x) {
            var have = await withCuts();
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
                            name: 'cut', label: 'Branch cut to push into', options: cutOptions(x.id, have),
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

        var pieces = s ? piecesOf(s, cutsBy, got) : [];
        var ready = s && pieces.every(function (p) { return p.there; });

        //WHICH ONES THE PRESS WOULD ACTUALLY USE — the seat's own if it has
        //them, otherwise the free one the rows above are already showing. Read
        //off the same two functions the rows use, so the sentence under the
        //button and the checklist above it cannot name different machines.
        var willUse = {
            machine: (s && s.machine && s.machine.there && s.machine.name)
                || (freeMachines(got)[0] || {}).name || null,
            signIn: (s && s.signIn && s.signIn.as)
                || (freeSignIns(got)[0] || {}).name || null
        };

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
                                    return <Seat key={x.id} s={x} cutsBy={cutsBy} pool={got} on={x.id === picked}
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
                                {/* WHAT IT IS ABOUT TO DO, WITH THE NAMES IN IT.
                                    "Takes a machine, lays the cut on it, lends
                                    your sign-in" is a description of a
                                    mechanism; `ok-diy1`, `dashboard/setup`,
                                    `diy-b2` is a description of what happens
                                    when you press it — and this press starts a
                                    VM, so being able to read it back before
                                    pressing is the point.

                                    IT NAMES THE MACHINE IT WOULD TAKE, not just
                                    the one already taken: with one free machine
                                    the press no longer asks, so this line is the
                                    only place the choice is shown at all. */}
                                <PartWhy>
                                    {!s.cut
                                        ? 'Give it a cut first — there is nowhere for the work to go.'
                                        : !ready
                                            ? 'Set the rows above right first — each one says what would fix it.'
                                            : willUse.machine === (s.machine && s.machine.name)
                                                ? 'Opens ' + s.cut + ' on ' + willUse.machine + ', over ssh, with this app’s own key.'
                                                : 'Takes ' + willUse.machine + ', starts it, lays ' + s.cut + ' on it'
                                                    + (willUse.signIn ? ', lends it ' + willUse.signIn : '')
                                                    + ', then opens it in VS Code.'}
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

                                    {/*---- ASKED FOR, NOT ASSUMED ------------

                                        READING THIS IS SECONDS OF WORK, not a
                                        field. It is a log and a diff in every
                                        repository the branch is cut in, so on a
                                        real project it is a wait — and a wait
                                        somebody chose is a different thing from
                                        a tab that hangs.

                                        THE BUTTON SAYS HOW LONG. A press with
                                        no idea of the cost is one somebody makes
                                        twice, then decides the app is broken. */}
                                    {reading !== s.cut
                                        ? <div>
                                            <Part right={<Button onClick={function () { setReading(s.cut); }}>Read it</Button>}>
                                                what is on it
                                            </Part>
                                            <PartWhy>
                                                A log and a diff in each of the repositories this branch is cut
                                                in — seconds rather than instant, so it is read when you ask.
                                            </PartWhy>
                                        </div>
                                        : !carries
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
