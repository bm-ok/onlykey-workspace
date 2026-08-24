var React = require('react');

module.exports = function queue(theme, okc, shell) {
    var { Pane, Panel, Badge, Empty, Note, Mono, Linky, Skeleton} = theme;

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
    //IT DOES NOT GROW A START BUTTON. The queue's tick is a cron job with
    //`humanOnly` on it, and ../cron already draws a guarded Start for every job
    //there is. ./server.js says why in as many words: only a person may start
    //it, said in ONE place, so `cronStart` and `queueStart` refuse together —
    //"a second copy is how the two come to disagree about what is allowed". A
    //second button is a second copy. So this points at the one that exists.
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
                        ? waiting + ' waiting, ' + free + ' machine(s) free, and none of it moves until somebody starts it. '
                        : 'Nothing is waiting, so nothing is being missed. ')
                    + 'It comes up stopped every time and on purpose — it rolls a real machine back, hands it a '
                    + 'credential, and runs instructions on it unattended. '}
                <Linky onClick={function () { shell.go('Settings', 'Cron'); }}>Start it in Settings, under Cron</Linky>
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
                                    {m.why ? <div className="note muted">{m.why}</div> : null}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        );
    }

    function Work({ rows, empty }) {
        if (!rows || !rows.length) return <Empty>{empty}</Empty>;
        return (<>
            {rows.map(function (r, i) {
                return (
                    <div className="card" key={r.id || r.ref || i}>
                        <div className="card-title">
                            <Badge kind={r.kind == 'judgement' ? 'run' : ''}>{r.ref || r.kind}</Badge>
                            {' '}{r.title}
                        </div>
                        {r.on ? <div className="card-sub"><Mono>{r.on}</Mono></div> : null}
                    </div>
                );
            })}
        </>);
    }

    function Queue() {
        var { state, error, reads } = okc.use('queueState', {}, 3000);

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

                <div className="cols">
                    <div className="col">
                        <Panel>
                            <div className="card-title">Machines</div>
                            <Machines rows={state.machines} />
                        </Panel>
                    </div>
                    <div className="col">
                        <Panel>
                            <div className="card-title">In flight</div>
                            <Work rows={state.inFlight} empty="nothing is running" />
                            <div className="card-title" style={{ marginTop: '12px' }}>Waiting</div>
                            <Work rows={state.waiting} empty="nothing is queued" />
                        </Panel>
                    </div>
                </div>

                <Panel>
                    <div className="card-title">Lately</div>
                    <Work rows={(state.history || []).slice(0, 8)} empty="nothing has run" />
                </Panel>

                <Note>{'read ' + reads + ' time(s) · the queue itself ticks every ' + (state.every || '?')}</Note>
                <Note><Mono>{state.order}</Mono></Note>
            </Pane>
        );
    }

    return Queue;
};
