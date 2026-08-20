var React = require('react');
var makeTerminal = require('./terminal');

//---------------------------------------------------------------------------
//Terminal: shells that were started from a task, arriving here.
//
//NOT A PLACE WORK STARTS. Nothing on this tab opens a shell — a terminal
//arrives because somebody took a task and chose "in a terminal", which is the
//same act as choosing VS Code and lands the same way: the branch checked out,
//the machine signed in, one machine claimed. A button here that opened a shell
//would be a second way to claim a machine, beside the queue, with its own idea
//of the rules.
//
//THE SAME WAY IN AS EVERYTHING ELSE. Over ssh, with this app's own key — the
//same key `okc.js vmShell` prints and the same one VS Code connects with. So if
//one of the three works they all do, and if one fails it is the key rather than
//this tab.
//
//A MACHINE RUNNING WITH NO CONSOLE CAPTURED SAYS SO HERE, and that is the one
//piece of this pane that has caught a real problem. A console is captured for a
//machine that is running AND has its serial port on; a machine with the port off
//is running INVISIBLY, and showing the ordinary "no terminals are open" for it
//reads as nothing happening rather than as something happening unwatched. It was
//found exactly that way — an install running, and nothing here for it.
//
//THE LIVE HALF IS NOT BUILT, AND THIS PANE SAYS SO RATHER THAN LOOKING BROKEN.
//See the note below.
//---------------------------------------------------------------------------

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc } = imports;


    //ITS PLACE IN THE ROW IS THE OLD WINDOW'S: Live, Terminal, Keys, Test, API.
    shell.tab({ name: 'Terminal', order: 90, Component: makeTerminal(theme, okc, shell) });

    await register(null, {});
}
module.exports = plugin;
