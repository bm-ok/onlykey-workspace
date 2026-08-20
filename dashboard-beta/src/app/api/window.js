var React = require('react');
var { useState } = React;
var useAsk = require('../okc/ask');

//---------------------------------------------------------------------------
//API: every capability this server has.
//
//GENERATED FROM THE ACTION TABLE, WHICH IS WHY IT CANNOT GO STALE. This is not
//documentation somebody keeps in step — it is the table itself, listed. An
//action that exists appears here the moment it exists, and one that is deleted
//stops appearing. A hand-written page would drift within a week and be believed
//for a year.
//
//WHICH ALSO MAKES IT THE ANSWER TO "WHAT CAN THIS THING DO". The window, the
//command line and the drills all reach the same table by name — there is one
//surface, and this is it written out. If something cannot be done from here, it
//cannot be done.
//
//IT IS NOT AN HTTP API, AND THE SENTENCE MATTERS. The old window's version of
//this pane says "generated from /api/actions". Here the list arrives over the
//socket, like every other answer, because that was a deliberate choice rather
//than an accident of porting: the command line goes through a local socket, and
//the browser half speaks socket.io over http. There is no url that returns
//this, and saying there is would send somebody looking for one.
//
//READ-ONLY, AND NOTHING HERE PRESSES ANYTHING. A list of everything the app can
//do, with a button beside each, would be the single widest hole this app could
//have — every refusal on every other pane bypassed by the reference page.
//---------------------------------------------------------------------------

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc } = imports;
    var { Pane, Act, Badge, Finder, Skeleton, Empty, Note, Chips, Chip } = theme;

    function Api() {
        //ASKED ONCE. The table is fixed for the life of the process — an action
        //appears when the server half reloads, and the window reloads with it —
        //so polling it every few seconds would be two hundred and fifty rows
        //re-fetched to say the same thing.
        var q = useAsk(okc, 'actions', {}, 0);
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

    //A TAB OF ITS OWN AND LAST BUT ONE, exactly where the old window puts it:
    //Live, Terminal, Keys, Test, API. It is a reference rather than a place work
    //happens, which is why it sits at the cold end of the row.
    shell.tab({ name: 'API', order: 120, Component: Api });

    await register(null, {});
}
module.exports = plugin;
