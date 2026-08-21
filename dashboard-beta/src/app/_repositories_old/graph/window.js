var React = require('react');
var makeGraph = require('./graph');
var { useState } = React;

//the Graph tab: one renderer, two pictures.
//
//BOTH TABS ARE THE SAME PICTURE — a row of cards laid left to right in the
//order things happened, with wires between them. Repositories -> Graph asks
//"what has actually happened to the branches in this workspace"; Supervisor ->
//What it did asks "in its last turn, what did it reach for, and what was it
//told no about". The shapes are identical because the answer is: nodes with a
//column, a row and up to four lines, and explicit {from,to} links.
//
//THE PORT DROPS LITEGRAPH. Everything the old ui/graph.js fought for comes free
//with DOM cards: no zero-width canvas inside a hidden pane, no
//startRendering/stopRendering bookkeeping, no wheel handler patched onto a
//prototype before any canvas exists, no gutting of an editor's right-click
//menu, no 34-character title slice, and a rebuild no longer throws away your
//pan. It is also why a title is not truncated here — a card wraps.
//
//IT IS READ-ONLY, AND THAT IS A DECISION RATHER THAN AN OMISSION. Over there
//the editor affordances — add, remove, clone, rewire, the play button — were
//all deliberately switched off so this could not become a second place work
//starts, beside the queue, with its own idea of the rules. Nothing here may
//grow a button that starts or changes anything. The only interaction is "take
//me to it".
//
//AND IT COMPUTES NO FACTS OF ITS OWN. Everything drawn is in the answer:
//nodes, links, a note, a why. See actions/graphs.js — the join of five tables
//is the whole value, and a second version of it here would go stale on its own.

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    //THIS PANE'S OWN LOOK, which the theme does not promise. See ./graph.scss.
    require('./graph.scss');
    var { shell, theme, okc } = imports;

    var GraphFor = makeGraph(theme, okc, shell);


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
    shell.pane({ tab: 'Repositories', name: 'Graph', order: 120, Component: GraphFor('work') });
    shell.pane({ tab: 'Supervisor', name: 'Graph', order: 50, Component: GraphFor('turn') });

    await register(null, {});
}
module.exports = plugin;
