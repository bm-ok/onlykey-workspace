var React = require('react');
var useAsk = require('../okc/ask');

//the Lines pane: every named line, and why it exists.
//
//WHAT A LINE IS, because it is the idea the whole app is arranged around and it
//has no equivalent on GitHub. A change here is not a branch — it is ONE branch
//per repository, named once and moved as a unit. GitHub cannot hold that: each
//repository only ever sees its own half, so "has this landed" is a question no
//single repository can answer and every one of them will answer confidently.
//
//WHY EACH ONE EXISTS IS THE USEFUL COLUMN. A list of names is a list of names.
//`why` carries the judgement that established the work was real — which is the
//difference between a change somebody can act on six weeks later and one nobody
//dares touch because nobody remembers what it was for.
//
//AND THE REPOSITORIES IT REACHES ARE NOT ALWAYS ALL OF THEM. A line that spans
//two of three is an ordinary state, not a broken one: the third simply carries
//nothing. Showing the count makes the half-landed case — the one this whole
//idea exists to prevent — visible before it is a problem rather than after.

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    //THIS PANE'S OWN LOOK, which the theme does not promise. See ./lines.scss.
    require('./lines.scss');
    var { shell, theme, okc } = imports;
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
        var { state, error, reads } = useAsk(okc, 'lines', {}, 10000);

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

    shell.pane({ tab: 'Repositories', name: 'Branches Lines', order: 70, Component: Lines });

    await register(null, {});
}
module.exports = plugin;
