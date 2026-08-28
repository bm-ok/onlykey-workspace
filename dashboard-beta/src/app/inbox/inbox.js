var React = require('react');
var { useState } = React;

module.exports = function inbox(theme, okc, remember) {
    var {
        Pane, Panel, Card, CardTitle, CardSub, Badge, Button, Stack,
        Chips, Chip, Skeleton, Empty, Note, Mono, Spec, ago
    } = theme;

    //---- WHERE A ROW SENDS YOU, IN THIS APP'S OWN WORDS --------------------
    //
    //THERE WERE TWO TRANSLATION TABLES HERE, and they are gone. The server said
    //`chat`, `repos`, `tasks` — the view ids of the app being ported from — and
    //this turned them into tab names on the way to the screen.
    //
    //IT WAS THE WRONG PLACE FOR THE KNOWING, and one entry was simply wrong:
    //`actions: 'Actions'`, a tab this app has never had, because that library is
    //split across Worker and Judge here. Every row that used it drew a "Go to
    //Actions" button, and pressing it did nothing whatsoever — ../ui/shell threw
    //the refusal away rather than saying it. Two silences, stacked, and neither
    //of them fails anything.
    //
    //AND IT WOULD HAVE BLOCKED THE NEXT THING. A badge is a fact about the tab
    //row, so for the server to say which tab is waiting on somebody, the server
    //has to know this app's tab names. It cannot, while the only place they are
    //written down is a lookup in the window.
    //
    //SO THE SOURCES NAME BETA'S TABS AND PANES DIRECTLY — see the `inbox.at(...)`
    //calls in ../library/server.js and ../runners/machines/server.js. If one is
    //wrong now, ../ui/shell says so out loud instead of doing nothing.

    function Inbox() {
        var { state, error, reads, again } = okc.use('inbox', {}, 15000);
        var [only, setOnly] = remember.use('inbox', 'only', null);
        var [went, setWent] = useState(null);

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Skeleton rows={4} /></Pane>;

        var all = state.items || [];
        var kinds = {};
        all.forEach(function (i) { kinds[i.kind] = (kinds[i.kind] || 0) + 1; });

        var rows = only ? all.filter(function (i) { return i.kind == only; }) : all;

        function goTo(i) {
            var w = i.where || {};
            var tab = w.view;
            var pane = w.pane || null;
            if (!tab) { setWent({ bad: true, text: 'this one does not say where to go' }); return; }
            //REMEMBERED FIRST, THEN SHOWN. `pick` is which row the pane should
            //land on, and every pane already remembers its own selection — so
            //writing it before switching means arriving with the thing selected
            //rather than at the top of a list.
            if (w.pick) {
                //WHICH AREA, AND WHICH KEY. Most panes remember their row as
                //`picked`; the Skill pane remembers `which`. A pick written to
                //the wrong key is a pane that opens at the top of its list and
                //an inbox that looks like it does nothing.
                var slot = {
                    Todo: ['todo', 'picked'], 'PR cuts': ['cuts', 'picked'], 'Branches Cut': ['branches', 'picked'],
                    'Virtual machines': ['machines', 'picked'], Judgement: ['judge', 'picked'],
                    Issues: ['issues', 'picked'], Skill: ['skill', 'which'],
                    //TWO THAT WERE MISSING, FOUND BY PRESSING: a line to retire
                    //landed on Branches Lines with the last pick still picked,
                    //and a fork behind lands on Repos, whose pick is `repo`.
                    'Branches Lines': ['lines', 'line'], Repos: ['repos', 'repo']
                }[pane];
                if (slot) remember.write(slot[0], slot[1], w.pick);
            }
            okc.call('show', { tab: tab, pane: pane || undefined }).then(
                function () { },
                function (e) { setWent({ bad: true, text: e.message }); }
            );
        }

        return (
            <Pane>
                {went ? <Note kind="bad">{went.text}</Note> : null}

                <Panel>
                    <CardTitle>
                        {all.length ? all.length + ' waiting on you' : 'Nothing is waiting on you'}
                        {state.away ? <Badge kind="muted">{state.away + ' elsewhere'}</Badge> : null}
                    </CardTitle>
                    {/* NOTHING WAITING IS THE GOOD ANSWER and should read like
                        one. An empty list that looks like a broken list is how
                        somebody goes looking for the thing that is not there. */}
                    {/* AND THE EMPTY SENTENCE IS THE ACTION'S, NOT THIS PANE'S.
                        It said "Everything that needed a person has had one",
                        which is a bigger claim than this app can make: the list
                        is composed from the sources that have been ported, and
                        four more are not being read at all. An empty inbox whose
                        own words promise completeness is the failure the list
                        exists to prevent, arriving through the list.

                        The action names what it is not reading and says so in
                        `note`; this shows it rather than talking over it. */}
                    {!all.length
                        ? <CardSub>{state.note || 'Everything that needed a person has had one.'}</CardSub>
                        : <CardSub>Each of these is stopped until somebody decides something.</CardSub>}
                    {Object.keys(kinds).length > 1 ? (
                        <Chips>
                            {Object.keys(kinds).map(function (k) {
                                return (
                                    <Chip key={k} on={only == k} count={kinds[k]}
                                        onClick={function () { setOnly(only == k ? null : k); }}>{k}</Chip>
                                );
                            })}
                        </Chips>
                    ) : null}
                </Panel>

                <Stack>
                    {rows.map(function (i) {
                        var w = i.where || {};
                        var tab = w.view;
                        var pane = w.pane || null;
                        return (
                            <Card key={i.key || i.id}>
                                <CardTitle>
                                    <Badge kind="warn">{i.kind}</Badge>
                                    <span>{i.what}</span>
                                </CardTitle>
                                <CardSub>{ago(i.since)}</CardSub>

                                {/* THE REASON IS FOLDED, and it has to be. These
                                    run to a thousand words — a whole analysis
                                    with what was found, why it happened and what
                                    to do — and eight of them unfolded is a page
                                    nobody reads. Folded, the list stays a list
                                    and the argument is one click away. */}
                                {i.why
                                    ? <Spec summary="why"><div className="md">{i.why}</div></Spec>
                                    : null}

                                <div className="row" style={{ marginTop: '8px' }}>
                                    <Button
                                        disabled={!tab}
                                        title={tab ? 'go to ' + tab + (pane ? ' / ' + pane : '') : 'this one does not say where'}
                                        onClick={function () { goTo(i); }}>
                                        {tab ? 'Go to ' + tab + (pane ? ' / ' + pane : '') : 'nowhere to go'}
                                    </Button>
                                    {w.pick ? <span className="muted">{'it is ' + w.pick}</span> : null}
                                </div>
                            </Card>
                        );
                    })}
                    {!rows.length && all.length ? <Empty>nothing of that kind</Empty> : null}
                </Stack>

                <Note>{'read ' + reads + ' time(s), every 15s'}</Note>
            </Pane>
        );
    }

    return Inbox;
};
