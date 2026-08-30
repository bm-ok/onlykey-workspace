var makeEditor = require('./open-editor');

//---------------------------------------------------------------------------
//OPENING THE WORK IN VS CODE, WHEREVER THE WORK IS — see ./open-editor.js.
//
//THIS ONE RUNS ON THE HOST, which makes it the odd plugin in ../. Everything
//else under vms/ builds shell for a machine and hands it to the channel; this
//starts a process on the operator's own computer, because that is where the
//editor is and where the window has to appear.
//
//AND IT IS STILL A MACHINE OPERATION. What it opens is a folder on a runner,
//over VS Code's own remote, using the key first-boot.sh installed — so it
//belongs beside the things that made that machine rather than beside ../../ui,
//which is about drawing.
//
//THE DOOR IS `openEditor`, IN ../../diy. It was NO ACTION YET for long enough
//to be worth saying why: `branchWorkOn --open` is what calls this in the app
//being ported from, and that action lives with the branch machinery rather than
//here — so nothing on this side consumed it, and a whole engine sat unreachable
//while somebody was told to open Remote-SSH by hand.
//
//IT STAYS HERE AND THE ACTION DOES NOT. ../../../CLAUDE.md: a service goes where
//it is owned, an action goes where the pane is. What this opens is a folder on a
//runner over the key first-boot.sh installed, so it belongs beside the things
//that made that machine; the press belongs to the tab that has the button.
//---------------------------------------------------------------------------

plugin.consumes = ['app', 'log'];
plugin.provides = ['editor'];
async function plugin(imports, register) {
    await register(null, { editor: makeEditor({ say: imports.log.on }) });
}
module.exports = plugin;
