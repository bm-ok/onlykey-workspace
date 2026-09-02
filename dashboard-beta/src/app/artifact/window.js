var makeHandedBack = require('./handedback');

//---------------------------------------------------------------------------
//the window half: what a run handed back, painted the same for every kind.
//
//A FACTORY RATHER THAN A PANE, the same shape ../permissions and ../library
//take. Worker and Judge are different tabs owned by different plugins, and each
//renders this beside its own work with its own way of asking — so neither has to
//know the other exists.
//
//IT REGISTERS NO PANE AND NO TAB. There is no Artifacts tab: what a run produced
//belongs beside the work it came from, which is the same argument ../runners/
//guests makes for the sign-ins living under Keys.
//
//THE SERVER HALF OWNS THE DRAWER and this owns how it is read on screen. They
//are one plugin because they are one subject — see ./server.js for why the
//drawer stopped being opened in four places.
//---------------------------------------------------------------------------

//`whatItHandedBack` AND NOT `handedBack`, which is taken. ./server.js registers
//`artifact.handedBack(lane)` — the DRAWER — and this is how one is drawn. The two
//never meet, since one is in the node bundle and one in the window's, and that is
//exactly why they must not share a name: a reader moving between the halves has
//nothing to tell them apart by. Named as a phrase, the way ../permissions names
//`whatItMayDo`.
plugin.consumes = ['theme'];
plugin.provides = ['whatItHandedBack'];
async function plugin(imports, register) {
    await register(null, { whatItHandedBack: makeHandedBack(imports.theme) });
}
module.exports = plugin;
