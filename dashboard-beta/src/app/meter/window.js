var makeMeter = require('./meter');

//---------------------------------------------------------------------------
//what has been spent, in the window.
//
//A PANE AND NOTHING ELSE. The record is ./ledger.js and the action both readers
//ask is ./server.js's — this half only draws it.
//
//---- it was Runners -> Meter, and it was in the wrong plugin ---------------
//
//THE PANE LIVED IN ../runners/machines while its data lived here. That header
//already named the arrangement without owning it: "the one action both panes
//ask ... The Runners -> Meter pane is that second reader." So this plugin knew
//about a pane it did not have, and `meter/` could not be lifted or deleted in
//one piece, because half of it was two folders away under a subject it is not
//about.
//
//IN SETTINGS BECAUSE IT IS ABOUT THIS HOST rather than about any machine.
//Runners answers "what are the machines doing"; every sentence on this pane
//answers "what has this cost", which is the same kind of question as what is
//guarded, what is scheduled and what is stored -- and those are its neighbours
//now.
//
//NOTHING HERE CAN BE ACTED ON, which is the other half of why it does not
//belong beside the machines: every other pane on Runners has a press on it that
//changes a machine, and a person scanning that tab for something to do had to
//skip this one every time.
plugin.consumes = ['okc', 'shell', 'theme'];
plugin.provides = [];
async function plugin(imports, register) {
    var { okc, shell, theme } = imports;

    shell.pane({
        tab: 'Settings',
        name: 'Meter',
        //AFTER WHAT ARMS THIS APP AND BEFORE WHAT IT DOES ON ITS OWN. General,
        //Trust and Bootstrap are the switches somebody sets; Cron and Kit are
        //how it runs and what it is made of. Spend is neither -- it is the
        //receipt -- so it sits between them rather than among either.
        order: 50,
        Component: makeMeter(theme, okc)
    });

    await register(null, {});
}
module.exports = plugin;
