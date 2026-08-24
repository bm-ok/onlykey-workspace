var React = require('react');

module.exports = function queue(theme, okc, shell) {
    var { Pane, Panel, Badge, Empty, Note, Mono, Linky, Row, Toggle, Skeleton,
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
    //---- and whether it will come up running next time ----------------------
    //
    //THE SWITCH LIVES HERE AND NOT ON THE CRON PANE, which is where somebody
    //pressing Start actually is. That pane draws every job the same way and
    //takes no view on any of them — putting one job's setting on it is how a
    //guard belonging to the queue ended up in the generic scheduler in the first
    //place, which is the thing that was just taken back out.
    //
    //IT DOES NOT START THE QUEUE. Two facts, kept apart: this is what happens
    //NEXT time the app starts, and the note above is what is happening now. One
    //press meaning both is a press whose effect depends on when it was made.
    function AutoStart({ state, again }) {
        return (
            <Row>
                <Toggle
                    on={!!state.autoStart}
                    onChange={function (on) {
                        okc.call('settingSet', { name: 'queueAutoStart', value: on ? 'true' : 'false' })
                            .then(function () { if (again) again(); });
                    }}>Start the queue when the app starts</Toggle>
            </Row>
        );
    }

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
                    //AND WHY IT IS STOPPED, WHICH IS THE ACTIONABLE HALF. "It
                    //came up this way" and "somebody stopped it" call for
                    //different things — and with the switch below on, the second
                    //is the only explanation left, so saying the first would send
                    //somebody to a setting that is already the way they want it.
                    + (state.autoStart
                        ? 'It is set to start with the app, so something stopped it after that — a press, or a '
                            + 'restart since the setting was changed. '
                        : 'It comes up this way, and an app restart is enough to do it. ')}
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
                                    <Badge kind={m.free ? 'ok' : 'warn'}>{m.free ? 'free' : 'busy'}</Badge>
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
    function Work({ rows, empty }) {
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
                        </Card>
                    );
                })}
            </Stack>
        );
    }

    function Queue() {
        var { state, error, reads, again } = okc.use('queueState', {}, 3000);

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Skeleton rows={4} /></Pane>;

        return (
            <Pane>
                {/* THE ERROR SITS ABOVE THE LAST GOOD ANSWER rather than
                    replacing it. A board that blanks when the dashboard
                    restarts says "there is nothing" when it means "I could not
                    ask", and those are different sentences. */}
                {error ? <Note kind="bad">{error}</Note> : null}

                <Standing state={state} />
                <AutoStart state={state} again={again} />

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
                            <Work rows={state.waiting} empty="nothing is queued" />
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
