var React = require('react');
var { useState } = React;

module.exports = function api(theme, okc) {
    var { Pane, Act, Badge, Finder, Skeleton, Empty, Note, Chips, Chip } = theme;

    function Api() {
        //ASKED ONCE. The table is fixed for the life of the process — an action
        //appears when the server half reloads, and the window reloads with it —
        //so polling it every few seconds would be two hundred and fifty rows
        //re-fetched to say the same thing.
        var q = okc.use('actions', {}, 0);
        var [find, setFind] = useState('');

        if (q.error && !q.state) return <Pane><Note kind="bad">{q.error}</Note></Pane>;
        if (!q.state) return <Pane><Skeleton rows={6} /></Pane>;

        var all = q.state.actions || [];
        var missing = q.state.missing || [];
        var want = find.trim().toLowerCase();

        //MATCHED ON THE NAME AND ON WHAT IT IS FOR. Somebody looking for "how do
        //I delete a branch" does not know it is called `branchDelete`, and a
        //filter that only searched names would answer "nothing" to the search
        //that this pane exists to serve.
        var rows = !want ? all : all.filter(function (a) {
            return String(a.name).toLowerCase().indexOf(want) >= 0
                || String(a.about || '').toLowerCase().indexOf(want) >= 0;
        });

        return (
            <Pane>
                <Note>
                    Every capability this app has, generated from the action table itself. Nothing can
                    exist without appearing here &mdash; and nothing here can be pressed: the window, the
                    command line and the drills all reach these by name, and every refusal that applies
                    there applies to them.
                </Note>

                {/* A LIST THAT COULD NOT BE READ IS NOT AN EMPTY ONE, and this
                    is the whole reason the count is worth saying out loud. With
                    the relay down this pane would otherwise show ten actions
                    under the sentence "nothing can exist without appearing
                    here" — which reads as two hundred and fifty capabilities
                    having been lost rather than as one socket being shut. */}
                {missing.map(function (m, i) { return <Note key={i} kind="warn">{m}</Note>; })}

                <Finder value={find} onChange={setFind}
                    placeholder="find one — by name, or by what it is for" />
                <Chips>
                    {/* THE COUNT IS THE FILTER'S ANSWER. "247 of 256" is what
                        says the search did something; a list that silently
                        shortens leaves somebody unsure whether they typed it
                        wrong. */}
                    <Chip count={rows.length} on={!!want}>
                        {want ? 'matching, of ' + all.length : 'actions'}
                    </Chip>
                </Chips>

                {rows.length ? rows.map(function (a) {
                    return (
                        <Act key={a.name} name={a.name}
                            about={<span>
                                {a.about}
                                {/* WHICH HALF ANSWERS IT, and during a port that
                                    is the most interesting fact about an action.
                                    The ones this app owns are unmarked, because
                                    that is where they are all going; the mark is
                                    on what has not moved yet, and it comes off
                                    by itself on the day it does. */}
                                {a.where && a.where != 'here'
                                    ? <Badge kind="muted" title={'still answered by ' + a.where}>{a.where}</Badge>
                                    : null}
                            </span>}
                            takes={(a.takes || []).join(', ')} />
                    );
                }) : <Empty>{'Nothing is called that, and nothing is for that.'}</Empty>}
            </Pane>
        );
    }

    return Api;
};
