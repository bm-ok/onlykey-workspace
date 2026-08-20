var React = require('react');
var { useState } = React;
var useAsk = require('../okc/ask');
var makeBoard = require('./board');
var makeAdd = require('./add');

//the Tasks tab: what has been written, what is running, and what came back.
//
//`reads` IS THE FIELD TO TRUST, not `state`. The board computes it from the
//branch rather than from what somebody last wrote down, and where the two
//disagree the branch wins — a task can be marked done and have delivered
//nothing, which is exactly what a worker refused by the push hook looks like.
//
//AND "done, nothing arrived" IS ITS OWN ANSWER, added the day a run's push was
//refused and the board called it delivered anyway. The row underneath it read
//"1 commit(s)" — true of the BRANCH, which carried a commit from the task
//before it, and wrong about the run that had just lost its work. So this shows
//what the dashboard now computes and does not try to be clever about it.

plugin.consumes = ['shell', 'theme', 'okc', 'remember'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc, remember } = imports;
    var { Pane, Panel, Badge, Empty, Note, Mono, Skeleton} = theme;

    //the words the board itself uses, and the colour each one deserves
    var LOOK = {
        'delivered': 'ok',
        'done, nothing arrived': 'warn',
        'done, nothing delivered': 'warn',
        'working': 'run',
        'queued': '',
        'draft': '',
        'accepted': 'ok',
        'rejected': 'bad'
    };

    function Task({ t }) {
        var word = t.reads || t.state;
        return (
            <div className="card">
                <div className="card-title">
                    <Mono>{'#' + t.number}</Mono>{' '}
                    <Badge kind={LOOK[word] === undefined ? '' : LOOK[word]}>{word}</Badge>{' '}
                    {t.title}
                </div>
                <div className="card-sub">
                    {t.branch ? <Mono>{t.branch}</Mono> : <span className="muted">no branch</span>}
                    {t.machine ? <span>{' · '}<Mono>{t.machine}</Mono></span> : null}
                    {t.jobName ? <span>{' · ' + t.jobName}</span> : null}
                </div>
                {/* WHY THIS WORK IS REAL. A task written over the wire is
                    refused unless it names the judgement that established the
                    claim — so when there is one, it is the most useful thing on
                    the row: it says somebody read the code before anybody wrote
                    any. */}
                {t.becauseOf ? <div className="card-sub">{'because of ' + t.becauseOf}</div> : null}
                {t.artifact ? <div className="note muted">{t.artifact}</div> : null}
            </div>
        );
    }

    function Tasks() {
        var { state, error, reads } = useAsk(okc, 'tasks', {}, 5000);

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Skeleton rows={4} /></Pane>;

        var rows = (state.tasks || []).slice().sort(function (a, b) { return (b.number || 0) - (a.number || 0); });
        var live = rows.filter(function (t) { return t.state == 'given' || t.state == 'queued'; });
        var rest = rows.filter(function (t) { return live.indexOf(t) < 0; });

        return (
            <Pane>
                {error ? <Note kind="bad">{error}</Note> : null}

                <Panel>
                    <div className="card-title">Now</div>
                    {live.length
                        ? live.map(function (t) { return <Task key={t.id} t={t} />; })
                        : <Empty>nothing is queued or running</Empty>}
                </Panel>

                <Panel>
                    <div className="card-title">{'Before (' + rest.length + ')'}</div>
                    {rest.length
                        ? rest.slice(0, 15).map(function (t) { return <Task key={t.id} t={t} />; })
                        : <Empty>nothing has been written yet</Empty>}
                    {rest.length > 15
                        ? <Note>{'showing the newest 15 of ' + rest.length}</Note>
                        : null}
                </Panel>

                <Note>{'read ' + reads + ' time(s), every 5s'}</Note>
            </Pane>
        );
    }

    //TWO PANES, AS OVER THERE. The board is the list-and-detail the tab has
    //always been about; what was here before is kept as "Recent" — it is the
    //same data read a different way, short and reverse-chronological, and it
    //carries the note about `reads` that the board is built on.
    //NO "Recent" PANE UNDER EITHER TAB, and its removal is the point rather
    //than a tidy-up.
    //
    //The old window has Tasks: Board, Add task — and Judge: Judgement, Judges.
    //There is no Recent in either, and there never was. It was scaffolding from
    //early in this port, written before Board and Judgement existed, and it
    //outlived them: two panes showing the same list as the pane next door, with
    //fewer facts and different rules about which rows count as live.
    //
    //THAT IS THE FAULT THIS PORT KEEPS FINDING, not a spare tab. Two places
    //knowing one thing is two places to disagree, and the one somebody happens
    //to open decides what they believe. The Repositories/Supervisor Graph split
    //was the same shape from the other direction.

    shell.tab({ name: 'Tasks', order: 20 });
    shell.pane({ tab: 'Tasks', name: 'Board', order: 10, Component: makeBoard(theme, okc, remember, useState) });
    shell.pane({ tab: 'Tasks', name: 'Add task', order: 20, Component: makeAdd(theme, okc, remember) });

    await register(null, {});
}
module.exports = plugin;
