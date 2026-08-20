var React = require('react');
var { useState } = React;

module.exports = function may(theme, okc) {
    var {
        Pane, Panel, Cols, Col, Stack, Card, CardTitle, CardSub, Badge, Button,
        Chips, Chip, Finder, Skeleton, Empty, Note, Mono, Kv, KvRow, Notice, Code, ask
    } = theme;

    function May() {
        var { state, error } = okc.use('supervisorMay', {}, 0);
        var [find, setFind] = useState('');

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Skeleton rows={4} /></Pane>;

        var all = state.may || [];
        var rows = all.filter(function (a) {
            if (!find) return true;
            return ((a.action || '') + ' ' + (a.why || '')).toLowerCase().indexOf(find.toLowerCase()) >= 0;
        });

        return (
            <Pane>
                {/* THE STRONGEST SENTENCE ON THIS TAB, and it is why there are no
                    buttons here at all. A permission list that anything reaching
                    this app could edit is not a permission list — and a
                    supervisor able to widen its own is not supervised. This
                    changes in a checkout, in a commit, with a message. */}
                <Note kind="warn">
                    <strong>Read only. </strong>
                    A permission list that anything reaching this app could edit is not a permission
                    list — this changes in a checkout, in a commit, with a message. The reasons below
                    are what the supervisor is shown when it asks what it may do.
                </Note>

                <Panel>
                    <CardTitle>{'What it may do — ' + all.length + ' action(s)'}</CardTitle>
                    <Finder value={find} onChange={setFind} placeholder="find an action" />
                    {rows.length ? (
                        <Kv>
                            {rows.map(function (a) {
                                return <KvRow key={a.action} label={a.action}>{a.why}</KvRow>;
                            })}
                        </Kv>
                    ) : <Empty>nothing matches</Empty>}
                </Panel>
                {state.note ? <Note>{state.note}</Note> : null}
            </Pane>
        );
    }

    //---- the list ----------------------------------------------------------

    return May;
};
