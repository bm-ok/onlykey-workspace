var React = require('react');
var makeChassis = require('./chassis');
var makeRepos = require('./repos');
var makeIssues = require('./issues');
var makePulls = require('./pulls');
var makeProtected = require('./protected');
var makeOverview = require('./overview');

//the Repositories tab.
//
//THE TAB IS A CONTAINER AND OWNS ALMOST NOTHING. It registers itself so there is
//something for panes to land in, and registers the one pane that belongs to it.
//Every other pane — branches, changes, PR cuts, GitHub — is its own folder
//naming this tab, and this file does not list them or know they exist. That is
//what lets the five biggest files left be ported one at a time, in any order,
//by anyone.
//

plugin.consumes = ['shell', 'theme', 'okc', 'remember'];
plugin.provides = [];
async function plugin(imports, register) {
    //THIS PANE'S OWN LOOK, which the theme does not promise. See ./repos.scss.
    require('./repos.scss');
    var { shell, theme, okc, remember } = imports;


    //---- where this lives, and it is not a choice -------------------------
    //
    //THE TAB NAMES ARE THE STRUCTURE. This port had been inventing its own —
    //top-level tabs for Machines, Sessions, Sign-ins and Graph, none of which
    //exist in the app being ported from, and renamed panes elsewhere. An
    //information architecture that drifts is one that has to be re-learned by
    //anybody who knows the old window, which is everybody who would use this.
    //
    //The real map is in ui/index.html over there: twelve panes under
    //Repositories, six under Runners, and the tab names as written.
    shell.tab({ name: 'Repositories', order: 10 });
    shell.pane({ tab: 'Repositories', name: 'Overview', order: 10, Component: makeOverview(theme, okc) });
    //THE THREE THAT SHARE A CHASSIS. Same repository list, same heading, same
    //remembered selection; a different sentence and a different right-hand half.
    //See ./chassis.js for why that is one file rather than three.
    var paneOf = makeChassis(theme, okc, remember);

    shell.pane({
        tab: 'Repositories', name: 'Repos', order: 20,
        Component: paneOf(
            'What this workspace is made of, and whether the far end of each one can still be reached. '
            + 'Everything above is local and instant; anything about GitHub was asked for on purpose and carries when it was asked.',
            makeRepos(theme, okc))
    });
    shell.pane({
        tab: 'Repositories', name: 'Issues', order: 30,
        Component: paneOf(
            'Work that arrived, rather than work written here — the one thing in this app that comes IN. '
            + 'An issue becomes a task from the button on its card, which is the far end of a chain that otherwise starts midway.',
            makeIssues(theme, okc, remember, shell))
    });
    //NOT ON THE CHASSIS, and that is right rather than an oversight: this one
    //is about the workspace as a whole, not about a repository somebody picked.
    //A repository list beside it would be a selection that changes nothing.
    shell.pane({
        tab: 'Repositories', name: 'Protected', order: 90,
        Component: makeProtected(theme, okc)
    });
    shell.pane({
        tab: 'Repositories', name: 'Pull requests', order: 40,
        Component: paneOf(
            'What is waiting to go in, per repository. The Changes tab holds the same pull requests as one landing, '
            + 'because "what is open against this repository" and "is my change in" are different questions.',
            makePulls(theme))
    });

    await register(null, {});
}
module.exports = plugin;
