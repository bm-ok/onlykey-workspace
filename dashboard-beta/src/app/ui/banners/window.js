var React = require('react');
var makeRunning = require('./running');
var makeTesting = require('./testing');
var makeTrouble = require('./trouble');

//---------------------------------------------------------------------------
//the banners: the things that are true wherever you are standing.
//
//NOT PANES, AND THAT IS THE WHOLE DISTINCTION. A pane is somewhere you go. A
//banner is something that is true whether or not you went there — so it is
//mounted for as long as the window is, above every tab, and it cannot be missed
//by being on the wrong tab. The shell has a slot for exactly this.
//
//THREE ELEMENTS AND NOT ONE LIST, carried over deliberately. The old window
//gives each of these its own element because the shared list is shared: anything
//worth saying joins it, and a state that lets this app write a task and take a
//credential off a machine must not end up as one entry among five that somebody
//skims. An element of its own cannot be taken over, which is the requirement.
//
//AND THE ORDER IS AN ARGUMENT. Running sits above testing: that one says this
//folder MAY be written to, this one says something is writing to it NOW.
//---------------------------------------------------------------------------

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc } = imports;

    shell.banner({ name: 'running', order: 10, Component: makeRunning(theme, okc, shell) });
    shell.banner({ name: 'testing', order: 20, Component: makeTesting(theme, okc, shell) });
    shell.banner({ name: 'trouble', order: 30, Component: makeTrouble(theme, okc, shell) });

    await register(null, {});
}
module.exports = plugin;
