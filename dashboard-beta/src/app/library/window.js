var React = require('react');
var makeLibrary = require('./library');
var { useState } = React;

//---------------------------------------------------------------------------
//Actions: the jobs, prompts and contracts a worker may be given.
//
//THIS IS THE APPROVAL SURFACE, and it is the one the operator's rule is about:
//a person approves prompts, jobs and contracts. Nothing else on this pane
//matters as much as that sentence.
//
//WHAT THE THREE ARE, and they stack:
//
//  contract  the rules a worker is given. What it may and may not do.
//  prompt    what a worker is told. Points at a contract.
//  job       a script that takes a prompt and does something with it.
//
//So withdrawing a contract's approval stops the prompts that name it, and
//withdrawing a prompt's stops the jobs that use it. The chain is the point:
//approving a job is not approving it in isolation, it is approving what it will
//be told and what it will be allowed to do.
//
//WRITTEN AT THE WINDOW IT IS APPROVED BY WHOEVER WROTE IT; WRITTEN OVER THE WIRE
//IT WAITS. That is the actions' own rule, not this pane's, and it is the same
//shape as the guards: being at the window IS the approval, because somebody was
//there and read it. Anything arriving down the pipe queues up to be read.
//
//AND APPROVAL LAPSES WHEN THE THING CHANGES. `hash` is what was read; edit it
//and the approval is `lapsed` — still recorded, no longer standing. An approval
//that survived an edit would be an approval of something nobody read.
//---------------------------------------------------------------------------

plugin.consumes = ['shell', 'theme', 'okc', 'remember'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc, remember } = imports;

    var LibraryFor = makeLibrary(theme, okc, remember);


    shell.tab({ name: 'Actions', order: 50 });
    shell.pane({ tab: 'Actions', name: 'Jobs', order: 10, Component: LibraryFor('job') });
    shell.pane({ tab: 'Actions', name: 'Prompts', order: 20, Component: LibraryFor('prompt') });
    shell.pane({ tab: 'Actions', name: 'Contracts', order: 30, Component: LibraryFor('contract') });

    await register(null, {});
}
module.exports = plugin;
