var React = require('react');

module.exports = function conflicts(theme, okc) {
    var { Pane, Panel, Badge, Empty, Note, Mono, Skeleton} = theme;

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
        var { state, error, reads } = okc.use('conflicts', {}, 15000);

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Skeleton rows={4} /></Pane>;

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

    return Conflicts;
};
