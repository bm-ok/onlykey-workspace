var makeDocs = require('./docs');

//THE DOCS TAB. A wiki of markdown files, read and written through the four
//actions in ./server.js, so the command line and this pane are editing the
//same pages. Late in the order, beside Test: it is about the app, not the
//work.
plugin.consumes = ['shell', 'theme', 'okc', 'remember', 'markdown'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc, remember, markdown } = imports;

    shell.tab({ name: 'Docs', order: 115, Component: makeDocs(theme, okc, remember, markdown) });

    await register(null, {});
}
module.exports = plugin;
