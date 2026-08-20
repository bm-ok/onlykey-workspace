var React = require('react');

module.exports = function lines(theme, okc) {
    var { Pane, Panel, Badge, Empty, Note, Mono, Skeleton} = theme;

    function Line({ g }) {
        var on = g.on || [];
        return (
            <div className="card">
                <div className="card-title">
                    <Mono>{g.name}</Mono>{' '}
                    <Badge>{on.length + ' repositor' + (on.length == 1 ? 'y' : 'ies')}</Badge>
                    {g.proposed ? <span>{' '}<Badge kind="run">proposed</Badge></span> : null}
                </div>

                {on.length ? (
                    <table className="kv"><tbody>
                        {on.map(function (p) {
                            return (
                                <tr key={p.repo}>
                                    <th>{p.repo}</th>
                                    <td><Mono>{p.branch}</Mono></td>
                                </tr>
                            );
                        })}
                    </tbody></table>
                ) : <Empty>this line names no branch in any repository</Empty>}

                {g.why ? <div className="note muted">{g.why}</div> : null}
            </div>
        );
    }

    function Lines() {
        var { state, error, reads } = okc.use('lines', {}, 10000);

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Skeleton rows={4} /></Pane>;

        var groups = state.groups || [];

        return (
            <Pane>
                {error ? <Note kind="bad">{error}</Note> : null}
                <Panel>
                    <div className="card-title">{groups.length + ' line' + (groups.length == 1 ? '' : 's')}</div>
                    {groups.length
                        ? groups.map(function (g) { return <Line key={g.name} g={g} />; })
                        : <Empty>no lines yet — a line is made from a branch, and is what a change has to be before it can be compared or sent out</Empty>}
                </Panel>
                <Note>{'read ' + reads + ' time(s), every 10s'}</Note>
            </Pane>
        );
    }

    return Lines;
};
