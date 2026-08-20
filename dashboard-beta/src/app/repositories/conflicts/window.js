var React = require('react');
var makeConflicts = require('./conflicts');

//the Conflicts pane, inside the Repositories tab.
//
//IT DOES NOT IMPORT THE TAB AND THE TAB DOES NOT LIST IT. This folder names
//`Repositories` in one string and appears there; ../repos knows nothing about
//it. Delete this folder and the tab is fine, add another and nothing needs
//editing — which is the whole reason the remaining panes can be ported
//independently.
//
//WHAT A CONFLICT IS HERE. Not a merge that failed — one that WOULD fail, worked
//out before anybody is asked to do it. A change is cut across several
//repositories at once, so "will this land" is a question about all of them
//together, and the answer arriving at merge time in one repository out of three
//is the case this whole idea exists to prevent.
//
//AND "STUCK" IS A DIFFERENT ANSWER FROM "CONFLICTS". One is a comparison that
//came back badly; the other is a comparison that could not be made — a
//repository that could not be read, a branch that is not there. Reporting the
//second as the first would say a change is broken when what is broken is the
//asking.

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc } = imports;


    shell.pane({ tab: 'Repositories', name: 'Conflicts', order: 50, Component: makeConflicts(theme, okc) });

    await register(null, {});
}
module.exports = plugin;
