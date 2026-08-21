var makeBoard = require('./board');
var makeAdd = require('./add');

//the Tasks tab: what has been written, what is running, and what came back.
//
//---- the folder is `worker` and the tab is `Tasks`, and both are right ------
//
//A TASK IS A RECORD; A WORKER IS THE THING THAT RUNS IT. The supervisor skill
//uses both words and means different things by them — "write a task and queue
//it", "watch a worker's Claude session" — and this half of the app is the second
//one: the harness, the session, the contract, and what a worker is doing NOW.
//The tab shows the records, so the tab is still Tasks.
//
//AND THE ACTIONS KEEP THEIR NAMES. `taskCreate`, `taskProgress`, `tasks` are
//typed every day, are written into the supervisor skill, and half the drills
//match on them. A folder name is organisational and costs nothing to change; an
//action name is the surface the whole operation is driven through.
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
    shell.pane({ tab: 'Tasks', name: 'Board', order: 10, Component: makeBoard(theme, okc, remember) });
    shell.pane({ tab: 'Tasks', name: 'Add task', order: 20, Component: makeAdd(theme, okc, remember) });

    await register(null, {});
}
module.exports = plugin;
