var makeChassis = require('../chassis');
var makeRepos = require('./repos');

//Repos: what this workspace is made of, and whether the far end of each one can
//still be reached.
//
//ON THE CHASSIS SHARED WITH Issues AND Pull requests — the same repository list,
//the same heading, the same remembered selection. It lives at ../chassis.js,
//owned by the group root, because three separate plugins share it and it must
//not belong to any one of them.

plugin.consumes = ['shell', 'theme', 'okc', 'remember'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc, remember } = imports;
    var paneOf = makeChassis(theme, okc, remember);

    shell.pane({
        tab: 'Repositories', name: 'Repos', order: 20,
        Component: paneOf(
            'What this workspace is made of, and whether the far end of each one can still be reached. '
            + 'Everything above is local and instant; anything about GitHub was asked for on purpose and carries when it was asked.',
            makeRepos(theme, okc))
    });

    await register(null, {});
}
module.exports = plugin;
