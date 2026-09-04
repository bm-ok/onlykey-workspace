var makeNotes = require('./notes');

//---------------------------------------------------------------------------
//WORKSTRAP, IN THE WINDOW.
//
//A TAB OF ITS OWN RATHER THAN A PANE UNDER SETTINGS, and the reason is who it
//is about. Settings is this HOST — what is switched on, what is scheduled, what
//has been spent. Every sentence on this tab is about the WORKSPACE: what the
//project is, how it is built, how it is tested, how it is run. Those are
//different subjects with different lifetimes, and the workspace's outlives any
//host that opens it.
//
//IT IS ALSO WHERE THE REST OF THIS IS GOING. What exists today is the document
//and a save; what comes next is a machine PROPOSING a change to it and a person
//reading that proposal against what is served — the same shape as
//../supervisor's Skill pane. That wants somewhere to live, and bolting a
//review queue onto a Settings pane would be the moment it should have had a tab.
//---------------------------------------------------------------------------

plugin.consumes = ['okc', 'shell', 'theme'];
plugin.provides = [];
async function plugin(imports, register) {
    var { okc, shell, theme } = imports;

    //---- THE TAB IS ITS OWN REGISTRATION, AND A PANE DOES NOT MAKE ONE ----
    //
    //A pane NAMES the tab it belongs in; it does not create it. Without this
    //line the pane is registered against a tab that does not exist, and it
    //simply never appears — no error, no warning, and `show --tab Workstrap`
    //answers with the list of tabs that do exist. Every other plugin that owns
    //a tab declares it the same way.
    //
    //BETWEEN Repositories AND Worker, which is the order the questions come in:
    //what the code IS, then how to build, test and run it, then who is working
    //on it.
    shell.tab({ name: 'Workstrap', order: 15 });

    shell.pane({
        tab: 'Workstrap',
        //NAMED FOR WHAT IT ANSWERS, not for the file it happens to be kept in.
        //`workspace_claude.md` on the host and `CLAUDE.md` on a machine are two
        //names for one document, and a pane titled after either would be
        //answering a question about storage rather than about the project.
        name: 'Notes',
        order: 10,
        Component: makeNotes(theme, okc)
    });

    await register(null, {});
}

module.exports = plugin;
