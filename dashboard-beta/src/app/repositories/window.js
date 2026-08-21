//---------------------------------------------------------------------------
//the Repositories tab, and the furniture its panes share.
//
//A GROUP THAT IS ALSO A PLUGIN, which is a shape this app refused until now.
//`test/plugins.test.js` banned it on the grounds that such a folder "would be
//matched at both depths and registered twice" — which is not true, and was
//measured before the ban was lifted: `./repositories/window.js` and
//`./repositories/branches/window.js` are two different keys, each yielded once
//by require.context, and the one-level branch of the pattern cannot reach two
//levels down because `[^/]*` cannot cross a slash.
//
//WHY IT HAD TO BE ONE. The panes under this tab are separate plugins on purpose
//— each removable, each portable — and three of them share a chassis: the same
//repository list, the same heading, the same remembered selection, a different
//sentence and a different right-hand half. With no plugin at the group root that
//chassis had nowhere to live but inside one of the panes, which would have made
//Issues and Pull requests depend on Repos being present.
//
//THE TAB IS A CONTAINER AND OWNS ALMOST NOTHING ELSE. It registers itself so
//there is something for panes to land in, and it does not list them. Every pane
//is its own folder naming this tab, and this file does not know they exist —
//which is what lets them be ported, replaced or deleted one at a time, in any
//order, by anyone.
//
//---- where these live, and it is not a choice -----------------------------
//
//THE TAB NAMES ARE THE STRUCTURE. This port had been inventing its own — top
//level tabs for Machines, Sessions, Sign-ins and Graph, none of which exist in
//the app being ported from, and renamed panes elsewhere. An information
//architecture that drifts is one that has to be re-learned by anybody who knows
//the old window, which is everybody who would use this.
//
//The real map is in ui/index.html over there: twelve panes under Repositories,
//six under Runners, and the tab names as written.
//---------------------------------------------------------------------------

plugin.consumes = ['shell'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell } = imports;

    shell.tab({ name: 'Repositories', order: 10 });

    await register(null, {});
}
module.exports = plugin;
