var makeChassis = require('../chassis');
var makeIssues = require('./issues');

//Issues: work that ARRIVED, rather than work written here — the one thing in
//this app that comes IN. An issue becomes a task from the button on its card,
//which is the far end of a chain that otherwise starts midway.

plugin.consumes = ['shell', 'theme', 'okc', 'remember'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc, remember } = imports;
    var paneOf = makeChassis(theme, okc, remember);

    shell.pane({
        tab: 'Repositories', name: 'Issues', order: 30,
        Component: paneOf(
            'Work that arrived, rather than work written here — the one thing in this app that comes IN. '
            + 'An issue becomes a task from the button on its card, which is the far end of a chain that otherwise starts midway.',
            makeIssues(theme, okc, remember, shell))
    });

    await register(null, {});
}
module.exports = plugin;
