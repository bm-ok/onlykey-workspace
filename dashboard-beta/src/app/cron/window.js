var makeCron = require('./cron');

//---------------------------------------------------------------------------
//the clock, in the window.
//
//A PANE AND NOTHING ELSE. What is scheduled belongs to ../core/cron, which
//outlives both this bundle and the node one — see the header there. This half
//only shows it and offers the switch.
//
//IN SETTINGS BECAUSE IT IS ABOUT THIS HOST rather than about any work. "What
//does this app do while I am not watching" is the same kind of question as what
//is guarded and what is stored, and those are its neighbours.
//
//---- and OUT of core, which is the point of the folder --------------------
//
//IT LIVED IN ../core/cron UNTIL A RULE WENT LOOKING. A pane consumes `shell` and
//`theme` — app services, both — so a core plugin that shipped one had two
//strands running out of core into the app, and `core/cron` could not have been
//lifted into another project without dragging a Settings pane that assumes this
//app's tab row.
//
//THE SERVICE STAYED AND THE PANE MOVED, which is the split rather than a tidy-up:
//`core/cron` is a clock anything can use, and what a person should SEE about it
//is this app's opinion. ../core/log and ../live are the same pair, and were
//already arranged this way.
//
//NOTHING WAS REWIRED TO DO IT. This half never consumed `cron` — it asks through
//`okc`, by action name — so the move cost one folder and no edges.
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
