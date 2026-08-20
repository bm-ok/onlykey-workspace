var React = require('react');
var useAsk = require('../okc/ask');

//the Queue tab: what is running, what is waiting, and which machines are free.
//
//FIRST OF THE TABS BECAUSE IT IS THE HARDEST TO GET RIGHT, not the easiest. It
//is a live board on a short refresh, and the old window is full of discipline
//about redrawing that exists for one reason: rewriting text that is IDENTICAL
//destroys the selection somebody is in the middle of making. Over there every
//paint compares a signature and returns early. Here that is React's job.
//
//So select the ordering sentence at the bottom and leave it selected while the
//read count ticks. If it survives, a large part of the old ui/ is deleted
//rather than ported.

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc } = imports;
    var { Pane, Panel, Badge, Empty, Note, Mono } = theme;

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
        var { state, error, reads } = useAsk(okc, 'queueState', {}, 3000);

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Empty>asking…</Empty></Pane>;

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

    shell.tab({ name: 'Queue', order: 20, Component: Queue });

    await register(null, {});
}
module.exports = plugin;
