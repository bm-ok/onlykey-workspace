var makeCron = require('./cron');

//---------------------------------------------------------------------------
//the clock, in the window.
//
//A PANE AND NOTHING ELSE. What is scheduled belongs to ./main.js, which outlives
//both this bundle and the node one — see the header there. This half only shows
//it and offers the switch.
//
//IN SETTINGS BECAUSE IT IS ABOUT THIS HOST rather than about any work. "What
//does this app do while I am not watching" is the same kind of question as what
//is guarded and what is stored, and those are its neighbours.
//---------------------------------------------------------------------------

plugin.consumes = ['okc', 'shell', 'theme'];
plugin.provides = [];
async function plugin(imports, register) {
    var { okc, shell, theme } = imports;

    shell.pane({
        tab: 'Settings',
        name: 'Cron',
        //AFTER Guards AND BEFORE Kit. Guards is what a person must approve;
        //this is what happens without them — the two read as a pair.
        order: 85,
        Component: makeCron(theme, okc)
    });

    await register(null, {});
}
module.exports = plugin;
