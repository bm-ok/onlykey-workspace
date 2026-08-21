var makeCut = require('./branch-cut');
var makeLines = require('./branch-lines');
var makeProtected = require('./protected');

//---------------------------------------------------------------------------
//BRANCHES: what work is done on.
//
//    Branches Cut     a CUT is a branch this app made, with a reason and a
//                     starting point, for work that has not left yet
//    Branches Lines   a LINE is the named thing spanning repositories — the idea
//                     the whole app is arranged around
//    Protected        which branches nothing here may write to, including this app
//
//THE FIRST TWO ARE THE SAME NOUN AT TWO SCALES, which is why they are one plugin
//and why their names both begin with the word. A cut is one branch in one
//repository; a line is what several cuts are called together once they are work.
//
//PROTECTED IS HERE BECAUSE IT IS ABOUT BRANCHES, and it is deliberately NOT on
//the repository chassis the way Repos and Issues are: it is about the workspace
//as a whole rather than about a repository somebody picked, and a repository
//list beside it would be a selection that changes nothing.
//---------------------------------------------------------------------------

plugin.consumes = ['shell', 'theme', 'okc', 'remember'];
plugin.provides = [];
async function plugin(imports, register) {
    //THESE PANES' OWN LOOK, which the theme does not promise. One sheet for the
    //plugin, named after its folder — see ./branches.scss and ../../THEME.md.
    require('./branches.scss');
    var { shell, theme, okc, remember } = imports;

    shell.pane({ tab: 'Repositories', name: 'Branches Cut', order: 60, Component: makeCut(theme, okc, remember) });
    shell.pane({ tab: 'Repositories', name: 'Branches Lines', order: 70, Component: makeLines(theme, okc) });
    shell.pane({ tab: 'Repositories', name: 'Protected', order: 90, Component: makeProtected(theme, okc) });

    await register(null, {});
}
module.exports = plugin;
