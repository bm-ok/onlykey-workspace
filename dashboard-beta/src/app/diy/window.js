var makeMine = require('./mine');
var makeWork = require('./work');

//---------------------------------------------------------------------------
//THE DIY TAB — a worker lane with no queue in it.
//
//A queued worker gets a machine, a branch cut, a workspace, a sign-in, and a
//session somebody can read. This is the same lane with the person in the middle
//of it: take a machine, put a branch on it, open it, send it work, watch it,
//give it back. Nothing here is picked up by the tick, read by the judge, or
//tidied away by the sweep.
//
//BESIDE Worker AND BEFORE Queue, which is the argument in one number. Worker is
//what the queue's workers do; Queue is the thing that hands work out. This sits
//between them because it is the first without the second.
//
//THE TAB NAMES ARE THE STRUCTURE — see ../runners/machines/window.js, which had
//to be told so. Every other tab in this app is named after something in the app
//being ported from; this one is not, because the app being ported from has no
//idea of a lane a person drives. It was named by the person who wanted one.
//---------------------------------------------------------------------------

plugin.consumes = ['shell', 'theme', 'okc', 'remember'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc, remember } = imports;

    shell.tab({ name: 'DIY', order: 25 });
    shell.pane({ tab: 'DIY', name: 'My machine', order: 10, Component: makeMine(theme, okc, remember) });
    shell.pane({ tab: 'DIY', name: 'Work', order: 20, Component: makeWork(theme, okc, remember) });

    await register(null, {});
}
module.exports = plugin;
