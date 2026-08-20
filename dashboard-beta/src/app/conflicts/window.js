var React = require('react');
var useAsk = require('../okc/ask');

//the Conflicts pane, inside the Repositories tab.
//
//IT DOES NOT IMPORT THE TAB AND THE TAB DOES NOT LIST IT. This folder names
//`Repositories` in one string and appears there; ../repos knows nothing about
//it. Delete this folder and the tab is fine, add another and nothing needs
//editing — which is the whole reason the remaining panes can be ported
//independently.
//
//WHAT A CONFLICT IS HERE. Not a merge that failed — one that WOULD fail, worked
//out before anybody is asked to do it. A change is cut across several
//repositories at once, so "will this land" is a question about all of them
//together, and the answer arriving at merge time in one repository out of three
//is the case this whole idea exists to prevent.
//
//AND "STUCK" IS A DIFFERENT ANSWER FROM "CONFLICTS". One is a comparison that
//came back badly; the other is a comparison that could not be made — a
//repository that could not be read, a branch that is not there. Reporting the
//second as the first would say a change is broken when what is broken is the
//asking.

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc } = imports;
    var { Pane, Panel, Badge, Empty, Note, Mono } = theme;

    function Row({ c }) {
        return (
            <div className="card">
                <div className="card-title">
                    <Mono>{c.branch || c.source || c.name || 'a change'}</Mono>
                    {c.into || c.target ? <span>{' → '}<Mono>{c.into || c.target}</Mono></span> : null}
                </div>
                {c.repo || c.repos ? (
                    <div className="card-sub"><Mono>{c.repos ? c.repos.join(', ') : c.repo}</Mono></div>
                ) : null}
                {c.why || c.note ? <div className="note muted">{c.why || c.note}</div> : null}
            </div>
        );
    }

    function Conflicts() {
        var { state, error, reads } = useAsk(okc, 'conflicts', {}, 15000);

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Empty>asking…</Empty></Pane>;

        var clashes = state.conflicts || [];
        var stuck = state.stuck || [];

        return (
            <Pane>
                {error ? <Note kind="bad">{error}</Note> : null}

                <Panel>
                    <div className="card-title">
                        {'Would not merge'}
                        {clashes.length ? <span>{' '}<Badge kind="bad">{clashes.length}</Badge></span> : null}
                    </div>
                    {clashes.length
                        ? clashes.map(function (c, i) { return <Row key={i} c={c} />; })
                        : <Empty>nothing conflicts — every change that is out would still land</Empty>}
                </Panel>

                {/* SHOWN EVEN WHEN EMPTY IS WRONG HERE, and shown when it is not
                    is the point: a repository that could not be read is not a
                    repository with no conflicts, and folding the two together is
                    how "all clear" gets reported for something nobody managed to
                    look at. */}
                {stuck.length ? (
                    <Panel>
                        <div className="card-title">
                            {'Could not be compared'}{' '}<Badge kind="warn">{stuck.length}</Badge>
                        </div>
                        {stuck.map(function (c, i) { return <Row key={i} c={c} />; })}
                    </Panel>
                ) : null}

                <Note>{(state.note || '') + ' · read ' + reads + ' time(s)'}</Note>
            </Pane>
        );
    }

    shell.pane({ tab: 'Repositories', name: 'Conflicts', order: 40, Component: Conflicts });

    await register(null, {});
}
module.exports = plugin;
