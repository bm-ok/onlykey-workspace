var React = require('react');
var makeLines = require('./lines');

//the Lines pane: every named line, and why it exists.
//
//WHAT A LINE IS, because it is the idea the whole app is arranged around and it
//has no equivalent on GitHub. A change here is not a branch — it is ONE branch
//per repository, named once and moved as a unit. GitHub cannot hold that: each
//repository only ever sees its own half, so "has this landed" is a question no
//single repository can answer and every one of them will answer confidently.
//
//WHY EACH ONE EXISTS IS THE USEFUL COLUMN. A list of names is a list of names.
//`why` carries the judgement that established the work was real — which is the
//difference between a change somebody can act on six weeks later and one nobody
//dares touch because nobody remembers what it was for.
//
//AND THE REPOSITORIES IT REACHES ARE NOT ALWAYS ALL OF THEM. A line that spans
//two of three is an ordinary state, not a broken one: the third simply carries
//nothing. Showing the count makes the half-landed case — the one this whole
//idea exists to prevent — visible before it is a problem rather than after.

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    //THIS PANE'S OWN LOOK, which the theme does not promise. See ./lines.scss.
    require('./lines.scss');
    var { shell, theme, okc } = imports;


    shell.pane({ tab: 'Repositories', name: 'Branches Lines', order: 70, Component: makeLines(theme, okc) });

    await register(null, {});
}
module.exports = plugin;
