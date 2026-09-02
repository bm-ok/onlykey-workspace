var makeMayDo = require('./may-do');

//---------------------------------------------------------------------------
//the window half: one pane, painted per kind of run.
//
//A FACTORY RATHER THAN A PANE, the same shape ../library takes. Worker and
//Judge are different tabs owned by different plugins, and each registers this
//under its own tab with its own kind — so neither has to know the other exists,
//and a third kind of run would register a third without touching either.
//
//IT REGISTERS NO PANE OF ITS OWN. There is no Permissions tab: what a run may
//do belongs beside the work it is about, which is the argument ../runners/
//guests makes for putting the sign-ins under Keys rather than under Runners.
//---------------------------------------------------------------------------

plugin.consumes = ['theme', 'okc'];
plugin.provides = ['whatItMayDo'];
async function plugin(imports, register) {
    var { theme, okc } = imports;
    await register(null, { whatItMayDo: makeMayDo(theme, okc) });
}
module.exports = plugin;
