var React = require('react');
var { useState, useEffect } = React;
var useAsk = require('../okc/ask');

//---------------------------------------------------------------------------
//the Inbox: everything waiting on you, and where to go for it.
//
//BEHIND THE BRAND, NOT IN THE ROW OF TABS. Over there it sits at the far left
//with a count on it, and that placement is the argument: this is not a tab you
//browse to, it is where the app tells you something needs you. Putting it in the
//row beside Repositories would make it one more place to check.
//
//WHY IT EXISTS AT ALL. Every pane in this app is mounted only while it is
//showing, so a tab nobody is looking at asks nothing — which is right for a
//panel and useless for "is something blocked on me". A job sat unapproved and a
//pull request sat drafted and unsent, and the only way to find either was to be
//told. One action counts the lot, in one pass, from anywhere.
//
//EVERY ITEM KNOWS WHERE IT LIVES. `where` is a view, a pane and a thing to pick,
//so the answer to "and where do I do that" is a button rather than a hunt. That
//is the difference between a list of complaints and a list of work.
//---------------------------------------------------------------------------

plugin.consumes = ['shell', 'theme', 'okc', 'remember'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc, remember } = imports;
    var {
        Pane, Panel, Card, CardTitle, CardSub, Badge, Button, Stack,
        Chips, Chip, Skeleton, Empty, Note, Mono, Spec
    } = theme;

    var ago = function (at) {
        if (!at) return '';
        var s = Math.max(0, (Date.now() - new Date(at).getTime()) / 1000);
        if (s < 90) return 'just now';
        if (s < 5400) return Math.round(s / 60) + ' minutes ago';
        if (s < 129600) return Math.round(s / 3600) + ' hours ago';
        return Math.round(s / 86400) + ' days ago';
    };

    //THE OLD WINDOW'S VIEW NAMES ARE NOT THIS APP'S TAB NAMES, and an item that
    //cannot say where to go is worse than one that says nothing. `where.view` is
    //`chat`, `repos`, `tasks` — the ids over there. Mapped here, in one table,
    //rather than by each item guessing.
    var VIEWS = {
        chat: 'Supervisor', repos: 'Repositories', tasks: 'Tasks', queue: 'Queue',
        judge: 'Judge', actions: 'Actions', runners: 'Runners', live: 'Live',
        keys: 'Keys', tests: 'Test', settings: 'Settings'
    };
    var PANES = {
        todo: 'Todo', chat: 'Chat', skill: 'Skill', may: 'What it may do',
        cuts: 'PR cuts', branchcuts: 'Branches Cut', baselines: 'Branches Lines',
        changes: 'Changes', conflicts: 'Conflicts', flow: 'Graph',
        guests: 'Claude Worker', judgesignins: 'Claude Judge', supervisors: 'Claude supervisor',
        machines: 'Virtual machines', guest: 'Claude Sessions',
        jobs: 'Jobs', prompts: 'Prompts', contracts: 'Contracts'
    };

    function Inbox() {
        var { state, error, reads, again } = useAsk(okc, 'inbox', {}, 15000);
        var [only, setOnly] = remember.use('inbox', 'only', null);
        var [went, setWent] = useState(null);

        //THE COUNT IS PUSHED TO THE BRAND, because that is the whole point of it
        //being counted here: it has to be visible from somewhere else.
        var count = state ? state.count : null;
        useEffect(function () { shell.badge('Inbox', count || 0); }, [count]);

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Skeleton rows={4} /></Pane>;

        var all = state.items || [];
        var kinds = {};
        all.forEach(function (i) { kinds[i.kind] = (kinds[i.kind] || 0) + 1; });

        var rows = only ? all.filter(function (i) { return i.kind == only; }) : all;

        function goTo(i) {
            var w = i.where || {};
            var tab = VIEWS[w.view] || w.view;
            var pane = w.pane ? (PANES[w.pane] || w.pane) : null;
            if (!tab) { setWent({ bad: true, text: 'this one does not say where to go' }); return; }
            //REMEMBERED FIRST, THEN SHOWN. `pick` is which row the pane should
            //land on, and every pane already remembers its own selection — so
            //writing it before switching means arriving with the thing selected
            //rather than at the top of a list.
            if (w.pick) {
                var area = { Todo: 'todo', 'PR cuts': 'cuts', 'Branches Cut': 'branches', 'Virtual machines': 'machines' }[pane];
                if (area) remember.write(area, 'picked', w.pick);
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
                    {!all.length
                        ? <CardSub>Everything that needed a person has had one.</CardSub>
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
                        var tab = VIEWS[w.view] || w.view;
                        var pane = w.pane ? (PANES[w.pane] || w.pane) : null;
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

    //`chrome: true` KEEPS IT OUT OF THE ROW. It is reached from the brand, which
    //is where it is over there and is the right place for it: somewhere you are
    //sent, not somewhere you browse to.
    shell.tab({ name: 'Inbox', order: 0, chrome: true, Component: Inbox });

    await register(null, {});
}
module.exports = plugin;
