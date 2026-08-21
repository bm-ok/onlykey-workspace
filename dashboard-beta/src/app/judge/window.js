var makeJudgements = require('./judgements');
var makeJudges = require('./judges');

//the Judge tab: what has been read, what is being read, and what it concluded.
//
//TWO FIELDS THAT ARE NOT THE SAME QUESTION, and the port inherits the
//distinction rather than flattening it:
//
//  concluded   what the JUDGE recommends. Parsed from the line its own prompt
//              asks it to end on — accept/reject for a change this host made,
//              true/false/unclear for a claim somebody made about the code,
//              yes/no for a pull request that arrived.
//
//  verdict     accepted or rejected. Whether the change is fit to go out.
//
//They came apart badly once: a check-a-claim confirmed a reviewer's request —
//CLAIM: true, meaning "yes, that is worth doing" — and it was filed as
//`rejected`, which then read to the cut gate as a failed review of the branch.
//A confirmed, worth-doing improvement registering as a reason the change could
//not go out. So a check-a-claim writes no verdict now, and this shows both
//columns rather than picking one and hoping.
//
//AND "DONE" DOES NOT MEAN IT SAID ANYTHING. A judgement that ran and concluded
//nothing is a real and useful state — it is the difference between "nobody has
//looked" and "somebody looked and would not say" — and half of the ones on this
//host that said nothing said nothing because they CRASHED.

plugin.consumes = ['shell', 'theme', 'okc', 'remember', 'library'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc, remember, library } = imports;

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

    shell.tab({ name: 'Judge', order: 40 });
    shell.pane({ tab: 'Judge', name: 'Judgement', order: 10, Component: makeJudgements(theme, okc, remember) });
    shell.pane({ tab: 'Judge', name: 'Judges', order: 20, Component: makeJudges(theme, okc) });

    //---- AND THE SET OF THINGS A JUDGE MAY BE GIVEN ----------------------
    //
    //The same three lists the worker has, filtered to what is for READING — and
    //the separation is the whole point rather than tidiness. A judge is lent a
    //JUDGE's sign-in and a runner a worker's, so which account signs a piece of
    //work depends on where it ran; keeping the rules it runs under in a
    //different library is the same property one layer up. A judge job handed to
    //a task is already refused by the door that writes one.
    shell.pane({ tab: 'Judge', name: 'Jobs', order: 30, Component: library('job', 'judge') });
    shell.pane({ tab: 'Judge', name: 'Prompts', order: 40, Component: library('prompt', 'judge') });
    shell.pane({ tab: 'Judge', name: 'Contracts', order: 50, Component: library('contract', 'judge') });

    await register(null, {});
}
module.exports = plugin;
