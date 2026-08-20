var React = require('react');

module.exports = function queue(theme, okc) {
    var { Pane, Panel, Badge, Empty, Note, Mono, Skeleton} = theme;

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
                <p className="note muted mono">{state.order}</p>
            </Pane>
        );
    }

    return Queue;
};
