var React = require('react');
var makeSkill = require('./skill');
var makeMemory = require('./memorypane');
var makeMay = require('./may');
var makeChat = require('./chat');
var { useState, useEffect, useRef } = React;

//---------------------------------------------------------------------------
//the Supervisor: the conversation with it, and what it is allowed to do.
//
//A SUPERVISOR IS A CLAUDE RUNNING ON ITS OWN MACHINE, signed in as its own
//identity, that watches this workspace and proposes work. It is not a chat
//window with a model behind it — it wakes, reads what changed since its
//bookmark, decides, and goes back to sleep.
//
//WHICH IS WHY THERE IS NOWHERE TO TYPE WHEN IT IS DOWN. Anything said while the
//machine is off would sit unread until one is up, so the pane says so and offers
//to start it instead of taking a message it cannot deliver. A composer that
//accepts text nothing will read is a lie with a send button.
//
//AND WHAT IT MAY DO IS READ ONLY, which is the strongest thing on this tab. The
//permission list is not a setting — it changes in a checkout, in a commit, with
//a message. A permission list that anything reaching this app could edit is not
//a permission list, and a supervisor that could widen its own is not supervised.
//---------------------------------------------------------------------------

//`markdown` BECAUSE A SUPERVISOR ANSWERS IN PROSE AND SOMETIMES IN STRUCTURE.
//A list of three tasks with their branches, or a fenced block of what a job
//would run, is a wall of dashes and backticks as source — and the formatting it
//was written with is the thing that does not happen. ../ui/markdown renders it
//in a frame that can do nothing, which is not a styling convenience: this text
//came from a model, markdown carries raw HTML through by design, and this window
//has node and require() in it.
plugin.consumes = ['shell', 'theme', 'okc', 'remember', 'markdown'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc, remember, markdown } = imports;


    shell.tab({ name: 'Supervisor', order: 70 });
    shell.pane({ tab: 'Supervisor', name: 'Chat', order: 10, Component: makeChat(theme, okc, markdown) });
    shell.pane({ tab: 'Supervisor', name: 'Memory', order: 20, Component: makeMemory(theme, okc, remember) });
    shell.pane({ tab: 'Supervisor', name: 'Skill', order: 30, Component: makeSkill(theme, okc, remember) });
    shell.pane({ tab: 'Supervisor', name: 'What it may do', order: 40, Component: makeMay(theme, okc) });

    await register(null, {});
}
module.exports = plugin;
