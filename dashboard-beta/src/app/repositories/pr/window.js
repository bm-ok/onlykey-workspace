var makeChassis = require('../chassis');
var makePulls = require('./pull-requests');
var makeCuts = require('./pr-cut');
var makeWriter = require('./new-pr-cut');

//---------------------------------------------------------------------------
//PULL REQUESTS: the same change seen from both ends.
//
//THREE PANES, ONE SUBJECT, AND THAT IS WHY THEY ARE ONE PLUGIN. "What is open
//against this repository" and "is my change in" are different questions about
//the same pull requests, and the third is the act of making them.
//
//    Pull requests   what is waiting to go in, PER REPOSITORY
//    PR cuts         the same pull requests as ONE LANDING — one act, one pull
//                    request per repository, held together and edited as one,
//                    because GitHub has no idea the three are one change
//    New PR Cut      making one
//
//Pull requests rides the chassis shared with Repos and Issues; the other two do
//not, because a landing is not about a repository somebody picked.
//---------------------------------------------------------------------------

plugin.consumes = ['shell', 'theme', 'okc', 'remember'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc, remember } = imports;
    var paneOf = makeChassis(theme, okc, remember);

    shell.pane({
        tab: 'Repositories', name: 'Pull requests', order: 40,
        Component: paneOf(
            'What is waiting to go in, per repository. The Changes tab holds the same pull requests as one landing, '
            + 'because "what is open against this repository" and "is my change in" are different questions.',
            makePulls(theme))
    });

    shell.pane({ tab: 'Repositories', name: 'PR cuts', order: 100, Component: makeCuts(theme, okc, remember, shell) });
    shell.pane({ tab: 'Repositories', name: 'New PR Cut', order: 110, Component: makeWriter(theme, okc, remember) });

    await register(null, {});
}
module.exports = plugin;
