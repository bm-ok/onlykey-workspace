var React = require('react');
var makeLibrary = require('./library');
var makeChains = require('./chains');
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

//---- ONE PAINTER, TWO LIBRARIES, AND NO TAB OF ITS OWN ---------------------
//
//This registered an "Actions" tab holding all three lists with a chip to filter
//by who they were for. The chip is what made it wrong: a worker's contract
//governs WRITING and a judge's governs READING, and the reason those are kept
//apart is that the account which says whether work holds must not be the account
//that wrote it. One list with a chip pressed is one library, and a chip is a
//thing somebody forgets is set.
//
//So the panes live under the two tabs that own them — see ../worker/window.js
//and ../judge/window.js — and this hands out the painter. Two placements, one
//implementation: the alternative is two copies that drift, which is the fault
//this port keeps finding from the other direction.
plugin.consumes = ['theme', 'okc', 'remember'];
plugin.provides = ['library'];
async function plugin(imports, register) {
    var { theme, okc, remember } = imports;
    //---- AND THE WHOLE-CHAIN VIEW, WHICH IS THE SAME ARGUMENT ------------
    //
    //`library('job', 'task')` paints one library. `library.chains('task')`
    //paints what those three assemble INTO — the answer to "how many of these
    //could actually run", which none of the three panes can give on its own.
    //
    //IT HUNG OFF THE JUDGE TAB and the Worker tab had no counterpart, so the
    //same question took one glance on one tab and three panes on the other. See
    //./chains.js: it is handed out here for the reason written above about the
    //other three, and it keeps both vocabularies so neither tab invents one.
    var library = makeLibrary(theme, okc, remember);
    library.chains = function (kind) { return makeChains(theme, okc, kind); };

    await register(null, { library: library });
}
module.exports = plugin;
