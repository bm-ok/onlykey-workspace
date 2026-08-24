var makeBoard = require('./board');

//the Worker tab: the library a worker is run under, and what it has done.
//
//---- the folder and the tab agree now, and they did not before -------------
//
//A TASK IS A RECORD; A WORKER IS THE THING THAT RUNS IT. The supervisor skill
//uses both words and means different things by them — "write a task and queue
//it", "watch a worker's Claude session" — and this half of the app is the second
//one: the harness, the session, the contract, and what a worker is doing NOW.
//
//THIS TAB WAS CALLED "Tasks" AND THE ARGUMENT FOR IT WAS THAT IT SHOWED THE
//RECORDS. That was true while a task was the only kind of work there was, and
//while one folder held both the work and the library describing it. Judging
//broke both halves: a judgement is work too, and it needs its own jobs, prompts
//and contracts — so ../judge is the same shape as this, and the tasks they both
//ask for are ../queue's.
//
//SO THE TAB NAMES WHAT IT IS A LIBRARY FOR. `Add task` went with the door that
//writes one; the board of what this worker has done stays here, because it is
//about the worker rather than about what is waiting.
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

plugin.consumes = ['shell', 'theme', 'okc', 'remember', 'library'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc, remember, library } = imports;

    //NO "Recent" PANE UNDER EITHER TAB, and its removal is the point rather
    //than a tidy-up.
    //
    //The old window has Tasks: Board, Add task — and Judge: Judgement, Judges.
    //(Those are its names; here the board is under Worker and Add task under Queue.)
    //There is no Recent in either, and there never was. It was scaffolding from
    //early in this port, written before Board and Judgement existed, and it
    //outlived them: two panes showing the same list as the pane next door, with
    //fewer facts and different rules about which rows count as live.
    //
    //THAT IS THE FAULT THIS PORT KEEPS FINDING, not a spare tab. Two places
    //knowing one thing is two places to disagree, and the one somebody happens
    //to open decides what they believe. The Repositories/Supervisor Graph split
    //was the same shape from the other direction.

    //THE TAB IS THE PLUGIN'S NAME NOW — see the header for why it was not.
    shell.tab({ name: 'Worker', order: 20 });
    shell.pane({ tab: 'Worker', name: 'Board', order: 10, Component: makeBoard(theme, okc, remember) });

    //---- AND THE SET OF THINGS A WORKER MAY BE GIVEN ---------------------
    //
    //THIS IS WHAT A WORKER IS. Not the harness and not the machine — those are
    //the queue's, because a work item's whole life is task management. A worker
    //is a set of jobs, prompts and contracts, and it uses them to ASK for a
    //task.
    //
    //THE JUDGE HAS ITS OWN SET, under its own tab, painted by the same code —
    //see ../library. Kept apart because a worker's contract governs WRITING and
    //a judge's governs READING, and the account that says whether work holds
    //must not be the account that wrote it.
    //---- WHAT THOSE THREE ASSEMBLE INTO ----------------------------------
    //
    //THE ONE QUESTION THE THREE PANES BELOW CANNOT ANSWER: how many of these
    //could actually run. A worker is the whole chain — this job, giving these
    //words, under these rules — and a job approved by a person is not enough on
    //its own, because the prompt it names may have been withdrawn an hour ago.
    //
    //THE JUDGE TAB HAS HAD THIS ALL ALONG and this one did not, so the same
    //question took one glance over there and three panes and a memory over here.
    //Same painter, both tabs — ../library/chains.js.
    shell.pane({ tab: 'Worker', name: 'Workers', order: 20, Component: library.chains('task') });

    shell.pane({ tab: 'Worker', name: 'Jobs', order: 30, Component: library('job', 'task') });
    shell.pane({ tab: 'Worker', name: 'Prompts', order: 40, Component: library('prompt', 'task') });
    shell.pane({ tab: 'Worker', name: 'Contracts', order: 50, Component: library('contract', 'task') });

    await register(null, {});
}
module.exports = plugin;
