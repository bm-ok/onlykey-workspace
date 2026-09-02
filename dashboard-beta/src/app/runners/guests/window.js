var React = require('react');
var makeGuests = require('./guests');
var { useState } = React;

//---------------------------------------------------------------------------
//the Claude sign-ins this host holds.
//
//NOTHING HERE EVER SHOWS A TOKEN. The actions do not hand one back and this
//draws a name, a role, a date, a fingerprint and a holder. That is the rule the
//Keys tab is built to, and it is what makes this pane safe to photograph — which
//matters more here than anywhere else in the app, because this is the pane
//somebody screenshots when they are asking for help.
//
//A SIGN-IN IS LENT, NOT COPIED. One goes to a machine while it works and comes
//back after, so two machines never share one. That is the whole reason this is a
//list of things with holders rather than a setting.
//
//THREE ROLES, AND THE DIFFERENCE IS WHAT MAY BE DONE WITH THEM:
//
//  worker      lent to a machine to do the work
//  judge       lent to a machine to read somebody else's work. Never the same
//              sign-in as the worker whose output it is reading, which is the
//              point of them being separate identities at all.
//  supervisor  never lent anywhere. It is the sign-in this host decides with.
//
//"IT IS THERE" AND "IT WORKS" ARE DIFFERENT QUESTIONS, and this pane exists
//largely to keep them apart. A sign-in sits here looking perfectly healthy long
//after its session has expired; the only thing that knows is the last machine
//that tried to use it, and what it said is on the card.
//---------------------------------------------------------------------------

plugin.consumes = ['shell', 'theme', 'okc', 'remember'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc, remember } = imports;

    var GuestsFor = makeGuests(theme, okc, remember);


    //---- UNDER KEYS, AND THEY USED TO BE UNDER RUNNERS ---------------------
    //
    //A SIGN-IN IS A CREDENTIAL BEFORE IT IS ANYTHING TO DO WITH A MACHINE. It is
    //kept here whether or not a machine exists, it outlives every machine it is
    //ever lent to, and the questions asked of it — whose account, when was the
    //secret last refreshed, does it still sign in, who has it now — are the same
    //questions asked of the GitHub token in the next pane along. A machine is
    //where one goes; it is not what one IS.
    //
    //Under Runners they sat beside the machines, which put "the thing lent" in
    //the tab named after "the thing lent to", and left the Keys tab holding one
    //credential and a copy of this list.
    //
    //THE FOLDER STAYS `runners/guests` ON PURPOSE, for now. rectify resolves
    //plugins from `provides`/`consumes` and never from the path, so the folder
    //is a statement to a reader rather than to the loader — and moving it is a
    //separate change with its own diff. Same shape as ../../ui/kit, which lives
    //under `ui` and registers a Settings pane.
    shell.pane({ tab: 'Keys', name: 'Claude Worker', order: 10, Component: GuestsFor('worker') });
    shell.pane({ tab: 'Keys', name: 'Claude Judge', order: 20, Component: GuestsFor('judge') });
    //THE PERSON'S OWN, BESIDE THE OTHER TWO RUNNER SIGN-INS AND BEFORE THE
    //SUPERVISOR — worker, judge and diy are all lent to a runner and are the
    //same kind of thing; the supervisor's is the one that is never lent at all.
    //
    //IT IS A ROLE AND NOT A SECOND WORKER SIGN-IN. A person holding a worker
    //credential for an afternoon is an afternoon the queue cannot run, and their
    //work arrives billed to the identity the queue's output is attributed to.
    //See ../../vms/ours/roles.js, which keeps `diy` out of `takesQueuedWork` for
    //the matching reason on the machine side.
    shell.pane({ tab: 'Keys', name: 'Claude DIY', order: 25, Component: GuestsFor('diy') });
    shell.pane({ tab: 'Keys', name: 'Claude supervisor', order: 30, Component: GuestsFor('supervisor') });

    await register(null, {});
}
module.exports = plugin;
