var makeOverview = require('./overview');

//Overview: everything open across the workspace — issues, pull requests, and PR
//cuts as one row each. The first pane on the tab, and the one somebody lands on.

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc } = imports;
    shell.pane({ tab: 'Repositories', name: 'Overview', order: 10, Component: makeOverview(theme, okc) });
    await register(null, {});
}
module.exports = plugin;
