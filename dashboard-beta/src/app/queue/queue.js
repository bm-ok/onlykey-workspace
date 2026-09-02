var React = require('react');

module.exports = function queue(theme, okc, shell) {
    var { Pane, Panel, Badge, Button, Empty, Note, Mono, Linky, Row, Skeleton,
        Stack, Card, CardTitle, CardSub } = theme;

    //---- whether any of this is going to happen -----------------------------
    //
    //THE BOARD DID NOT SAY, AND IT IS THE FIRST THING IT SHOULD SAY. A judgement
    //sat under "Waiting" beside a machine marked "free" for as long as anybody
    //cared to look at it, and the screen was perfectly correct: that IS what is
    //waiting and that IS which machine is free. What it left out is that the
    //tick was off, so the answer to "why has nothing happened" was on the page
    //the whole time as an absence — and an absence is not something a person can
    //be expected to read.
    //
    //IT DOES NOT GROW A START BUTTON. The queue's tick is a cron job, and ../cron
    //already draws Start, Stop and Run now for every job there is. A second
    //button here is a second copy of one switch, and the two would eventually
    //disagree about what they mean. So this points at the one that exists.
    //
    //IT IS NOT A GUARDED PRESS ANY MORE, and this pane used to say it was. The
    //gate is on the WORK: nothing is waiting below that was not built from a
    //job, a prompt and a contract somebody approved, and approving is what
    //refuses over the wire. See ./server.js.
    //---- THERE IS NO "START IT NEXT TIME" SWITCH, AND THERE WAS ------------
    //
    //`Start the queue when the app starts` was a Toggle here, over
    //`queueAutoStart`. It is gone and the queue always comes up running, like
    //every other timer this app has — see the argument at `cron.add` in
    //./server.js.
    //
    //WHAT IT COST WAS A PAGE THAT LOOKED FINE. A host whose whole job is handing
    //work to machines came up not doing it, and the only sign was work sitting
    //still — which looks exactly like no machine being free.
    //
    //AND IT PUT TWO CLOCKS ON ONE SCREEN. This switch was what happens NEXT
    //time; the note above it is what is happening NOW. Two nearly identical
    //sentences a line apart, and the one somebody read first decided what they
    //believed. One of them is enough, and it is the one about now.

    function Standing({ state }) {
        var waiting = (state.waiting || []).length;
        var free = (state.machines || []).filter(function (m) { return m.free; }).length;

        //ARMED AND RUNNING ARE DIFFERENT, and the Cron pane keeps them apart for
        //a reason worth repeating here: this half is rebuilt on every save and
        //the job is not, so there is a moment after each one where the clock
        //turns with nothing behind it.
        if (!state.tickHere) {
            return <Note kind="warn">{'The tick is not armed on this host, so nothing below will be given out '
                + 'however much is waiting. That is what the moment after a save looks like — it comes back by itself.'}</Note>;
        }

        if (state.ticking) {
            var by = state.startedBy;
            return <Note kind="ok">{'The queue is running'
                + (by && by.by ? ', started by ' + by.by : '')
                + ' — it looks every ' + (state.every || '?') + ' and gives waiting work to free machines.'}</Note>;
        }

        return (
            <Note kind="bad">
                {'The queue is STOPPED. '
                    + (waiting
                        //THE SHARPEST VERSION OF THE SENTENCE, when there is
                        //something to lose by not reading it.
                        ? waiting + ' waiting, ' + free + ' machine(s) free, and none of it moves until it is started. '
                        : 'Nothing is waiting, so nothing is being missed. ')
                    //AND WHY IT IS STOPPED, WHICH IS THE ACTIONABLE HALF — and
                    //there is only one answer now. The queue comes up running on
                    //every start, so a stopped one was stopped by somebody or by
                    //something asking on their behalf. "It came up this way" used
                    //to be the other possibility and no longer is.
                    + 'It comes up running on every start, so something stopped it after that — a press, or '
                    + 'a call to queueStop. '}
                <Linky onClick={function () { shell.go('Settings', 'Cron'); }}>Start it under Settings, Cron</Linky>
            </Note>
        );
    }

    function Machines({ rows }) {
        if (!rows || !rows.length) return <Empty>no machines</Empty>;
        return (
            <table className="kv">
                <tbody>
                    {rows.map(function (m) {
                        return (
                            <tr key={m.name}>
                                <th><Mono>{m.name}</Mono></th>
                                <td>
                                    {(m.kinds || []).length
                                        ? (m.kinds || []).map(function (k) { return <span key={k}><Badge>{k}</Badge>{' '}</span>; })
                                        : <span><Badge>no role — the queue leaves it alone</Badge>{' '}</span>}
                                    {/* "NOT FREE" RATHER THAN "BUSY", because the
                                        answer carries one flag and several
                                        reasons. beta-super1 is powered off and
                                        tagged supervisor — it is never given task
                                        work at all — and this said `busy` about
                                        it, in warning yellow, next to a sentence
                                        saying it is never given task work.

                                        The column answers one question: can the
                                        queue give this work now. `why` says which
                                        of the reasons it is, and inventing a word
                                        the answer does not contain is how a board
                                        comes to disagree with its own note. */}
                                    <Badge kind={m.free ? 'ok' : 'muted'}>{m.free ? 'free' : 'not free'}</Badge>
                                    {m.why ? <Note>{m.why}</Note> : null}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        );
    }

    //---- THE KIT'S CARD, NOT THE CLASS NAME ---------------------------------
    //
    //This wrote `className="card"` by hand, which is the one thing a pane may
    //not do -- and it is worth saying what that actually cost here, because the
    //classes were all spelled correctly and the check that looks for misspelt
    //ones had nothing to say.
    //
    //A CARD CARRIES NO MARGIN. Everything in this app is spaced by its
    //CONTAINER: `.stack` has a gap, and the theme's `Stack` is what you get when
    //you use `Card`. Reaching past the kit meant reaching past the container
    //too, so these sat flush against each other -- in a list whose other gaps,
    //eight pixels further up the same pane, were right.
    //
    //../ui/theme/dashboard.scss now closes the join wherever it happens, so this
    //would look right either way. It is still written through the kit, because
    //the next thing a Card learns is a thing these would not.
    //`take` IS PASSED ONLY BY THE WAITING LIST, which is what decides whether a
    //row can be taken back. The same card draws what is running and what has
    //already run, and neither of those is something this undoes: one is a machine
    //working and the other is over.
    function Work({ rows, empty, take, busy }) {
        if (!rows || !rows.length) return <Empty>{empty}</Empty>;
        return (
            <Stack>
                {rows.map(function (r, i) {
                    return (
                        <Card key={r.id || r.ref || i}>
                            <CardTitle>
                                <Badge kind={r.kind == 'judgement' ? 'run' : ''}>{r.ref || r.kind}</Badge>
                                {' '}{r.title}
                            </CardTitle>
                            {r.on ? <CardSub><Mono>{r.on}</Mono></CardSub> : null}
                            {take
                                ? <Row>
                                    {/* NOT GUARDED. Queueing something is the act
                                        that spends a machine; taking it back out
                                        spends nothing and can be undone by
                                        queueing it again. A gate here would ask
                                        somebody to confirm the safe direction. */}
                                    <Button disabled={busy} onClick={function () { take(r); }}>
                                        Take it back out
                                    </Button>
                                </Row>
                                : null}
                        </Card>
                    );
                })}
            </Stack>
        );
    }

    function Queue() {
        var { state, error, reads, again } = okc.use('queueState', {}, 3000);

        //---- TAKING SOMETHING BACK OUT OF THE QUEUE ------------------------
        //
        //THE WAY OUT THAT DID NOT EXIST. Work could go in and only come out by
        //running: the choices were to let a machine spend twenty minutes on
        //something somebody had changed their mind about, or to throw the task
        //away and lose what it says.
        //
        //IT MATTERS MOST WHEN NOTHING IS HAPPENING. Work queued against a host
        //that cannot dispatch it -- no machine free, or no sign-in to give it --
        //sits here looking inert and starts the moment somebody fixes the
        //unrelated thing.
        //
        //TWO DOORS FOR THE TWO KINDS, because a task and a judgement are kept by
        //different plugins and each refuses for its own reasons. The row already
        //says which it is.
        var [taking, setTaking] = React.useState(false);
        var [said, setSaid] = React.useState(null);

        function take(row) {
            setTaking(true);
            setSaid(null);
            okc.call(row.kind === 'judgement' ? 'judgementUnqueue' : 'taskUnqueue', { id: row.id }).then(
                function (r) {
                    setSaid({ text: (r && r.note) || (row.ref + ' is out of the queue.') });
                    setTaking(false);
                    again();
                },
                function (e) {
                    //SAID, NOT SWALLOWED. The refusal for one already given out
                    //names the state it is in, and that is the answer somebody
                    //needs: the machine is working and stopping it is a different
                    //act on a different thing.
                    setSaid({ bad: true, text: e.message });
                    setTaking(false);
                    again();
                }
            );
        }

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Skeleton rows={4} /></Pane>;

        return (
            <Pane>
                {/* THE ERROR SITS ABOVE THE LAST GOOD ANSWER rather than
                    replacing it. A board that blanks when the dashboard
                    restarts says "there is nothing" when it means "I could not
                    ask", and those are different sentences. */}
                {error ? <Note kind="bad">{error}</Note> : null}
                {said ? <Note kind={said.bad ? 'bad' : 'ok'}>{said.text}</Note> : null}

                <Standing state={state} />

                <div className="cols">
                    <div className="col">
                        <Panel>
                            <CardTitle>Machines</CardTitle>
                            <Machines rows={state.machines} />
                        </Panel>
                    </div>
                    <div className="col">
                        <Panel>
                            <CardTitle>In flight</CardTitle>
                            <Work rows={state.inFlight} empty="nothing is running" />
                            <CardTitle>Waiting</CardTitle>
                            <Work rows={state.waiting} empty="nothing is queued" take={take} busy={taking} />
                        </Panel>
                    </div>
                </div>

                <Panel>
                    <CardTitle>Lately</CardTitle>
                    <Work rows={(state.history || []).slice(0, 8)} empty="nothing has run" />
                </Panel>

                <Note>{'read ' + reads + ' time(s) · the queue itself ticks every ' + (state.every || '?')}</Note>
                <Note><Mono>{state.order}</Mono></Note>
            </Pane>
        );
    }

    return Queue;
};
