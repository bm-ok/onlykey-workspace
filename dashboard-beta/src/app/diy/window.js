var makeTasks = require('./tasks');

//---------------------------------------------------------------------------
//THE DIY TAB — a worker's seat with a person in it.
//
//A worker is a seat: a machine out of the pool, a branch cut laid on it, a
//credential lent to it, a session run, and the work pushed back to the cut.
//This is the same seat with the person doing the work, running their own
//session by hand — and nothing downstream taking what comes out of it.
//
//BESIDE Worker AND BEFORE Queue, which is the argument in one number. Worker is
//what the queue's workers do; Queue is the thing that hands work out. This sits
//between them because it is the first without the second.
//
//ONE PANE. The look was agreed against seats written into ./tasks.js before any
//of it was wired, which is why the shape is not a first draft -- see that file's
//header. It reads `diy` now, and the store behind that is ./store.js.
//---------------------------------------------------------------------------

plugin.consumes = ['shell', 'theme', 'okc', 'remember'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc, remember } = imports;

    shell.tab({ name: 'DIY', order: 25 });
    shell.pane({ tab: 'DIY', name: 'My work', order: 10, Component: makeTasks(theme, okc, remember) });

    await register(null, {});
}
module.exports = plugin;
