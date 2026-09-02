var React = require('react');
var makeSessions = require('./sessions');
var { useState } = React;

//the Sessions tab: what the work on a branch line remembers.
//
//THE TAB EXISTS BECAUSE THE THING IT SHOWS USED TO NOT EXIST. A machine is
//rolled back when its work ends, so a worker's memory would have died with it —
//a task given out twice was two strangers rather than one worker having a
//second go. The host copies ~/.claude out when a run ends and unpacks it before
//the next run starts, and this is where you watch that happening. It is also
//the only place a conversation that has gone somewhere you do not want it
//carrying on from can be stopped.
//
//OVER THERE IT IS A SUB-TAB OF RUNNERS, and this port put it next to Machines
//for that reason alone. THAT WAS THE WRONG FACT TO FILE IT UNDER. What is
//shown here is not about a runner: a runner is rolled back between jobs and
//keeps nothing, and ../keying.js will not give a judge a memory at all —
//`REMEMBERS = { worker: true, judge: false }`. So it is the WORKER's, and it
//sits under Worker, after the board of what that worker has done and before the
//chains it is run under.
//
//THE SAME MISFILING THE SIGN-INS HAD before they moved to Keys: a thing was put
//where it is USED rather than where it belongs, and both are true sentences,
//which is what makes the mistake so easy to defend.
//
//ONE CALL, AND DELIBERATELY NO SECOND ONE. `sessions` returns
//{sessions[], bytes, where, note} whole; `inside` is a summary read out of the
//gzip ONCE, when it arrived, so this panel reads a small object instead of
//gunzipping ninety kilobytes on a refresh loop. The singular `session` action
//exists and this tab must not call it — it answers "has this task got a memory
//yet" for a task that has never run, which is a different question.
//
//ALL THE `changed()` BOOKKEEPING FROM THE OLD PANE IS GONE, and that is the
//point of the port rather than an omission. Over there every paint compares a
//signature and returns early, because rewriting text that is IDENTICAL destroys
//a selection somebody is in the middle of making — and this panel is full of
//mono values people copy by hand. Here that is React's job. Select the
//conversation id and leave it selected while the read count ticks.

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc } = imports;

    //FORGETTING A SESSION IS PROPOSED AS A PERSON'S PRESS.
    //
    //A session is the record of what a machine was actually asked and what it
    //actually said — the only account of a run that survives the machine being
    //put back to its snapshot. Forgetting one is not deleting a row; it is
    //deleting the answer to "what happened", and the question always gets asked
    //later than the deletion.
    //
    //SO IT TAKES TWO PRESSES, and the split is which one is the decision. The
    //first arms it and shows what is about to go, which is only reading; "Yes,
    //forget it" is the one that destroys something, and it is drawn as a danger
    //rather than dressed up as an ordinary button.


    shell.pane({ tab: 'Worker', name: 'Claude Sessions', order: 15, Component: makeSessions(theme, okc, shell) });

    await register(null, {});
}
module.exports = plugin;
