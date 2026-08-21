var React = require('react');
var makeQueue = require('./queue');
var makeAdd = require('./add');

//the Queue tab: what is running, what is waiting, and which machines are free.
//
//FIRST OF THE TABS BECAUSE IT IS THE HARDEST TO GET RIGHT, not the easiest. It
//is a live board on a short refresh, and the old window is full of discipline
//about redrawing that exists for one reason: rewriting text that is IDENTICAL
//destroys the selection somebody is in the middle of making. Over there every
//paint compares a signature and returns early. Here that is React's job.
//
//So select the ordering sentence at the bottom and leave it selected while the
//read count ticks. If it survives, a large part of the old ui/ is deleted
//rather than ported.

plugin.consumes = ['shell', 'theme', 'okc', 'remember'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc, remember } = imports;

    //---- PANES RATHER THAN ONE COMPONENT ------------------------------------
    //
    //This was a whole-tab component, which is what every tab looked like before
    //there were two things to say about one subject. ../ui/shell draws the pane
    //row only when a tab has more than one, so registering the board as a pane
    //costs nothing while it is alone and is what makes room for the next.
    shell.tab({ name: 'Queue', order: 30 });
    shell.pane({ tab: 'Queue', name: 'Board', order: 10, Component: makeQueue(theme, okc) });

    //---- AND WRITING A TASK DOWN IS THE QUEUE'S -----------------------------
    //
    //It was under Tasks, beside the board that lists them, which was right while
    //`tasks` was one folder holding both the work and the library that describes
    //it. It is not right now: ../worker is a set of jobs, prompts and contracts,
    //and what it does with them is ASK for a task. The door that writes one is
    //`taskCreate`, which is this plugin's — see ./server.js — so the form that
    //drives it belongs on this tab.
    //
    //MOVED RATHER THAN REQUIRED ACROSS. A pane reaching into a sibling plugin's
    //folder for a component is the shape this app is arranged against: the file
    //lives with the action it calls.
    shell.pane({ tab: 'Queue', name: 'Add task', order: 20, Component: makeAdd(theme, okc, remember) });

    await register(null, {});
}
module.exports = plugin;
