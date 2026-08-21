
var Config = require("./config");
var rectify = require('@bmatusiak/rectify');
var showError = require('./overlay');

//every src/app/<plugin>/window.js. the window half, and the only code that
//reaches the browser.
//A PLUGIN IS A FOLDER WITH THIS FILE IN IT, one level down or two: src/app/queue,
//or src/app/repositories/changes. The second level is the grouping -- core, ui,
//repositories, runners -- so the tree says what the app's tab row says.
//
//AND IT STOPS AT TWO, which is not a limit but the point. A plugin keeps its own
//things beside it, and ../app/ui/editor/vendor/ace is 900KB of somebody else's
//code; the only thing standing between it and being started as a plugin is that
//nothing three levels down is ever looked at.
//
//DEPTH ONE STAYS VALID, which is what let the folders move a few at a time with
//the app working throughout -- and what lets a tab that is one plugin stay flat.
//
//A PATH THAT STOPS MATCHING IS NOT AN ERROR HERE. It is an absence: the pane is
//gone, the window renders perfectly around the hole, and nothing says a word.
//../test/plugins.test.js holds this pattern and src/main.js's walk to one answer,
//because four implementations of one sentence is three chances to disagree.
var found = require.context('./app', true, /^\.\/[^_./][^/]*(?:\/(?!vendor\/)[^_./][^/]*)?\/window\.(js|jsx)$/);
var plugins = found.keys().map(found);

plugins.config = Config();

//---- A HOT UPDATE CAN ONLY EVER MEAN "RELOAD" HERE -------------------------
//
//THE PLUGIN GRAPH IS BUILT ONCE, at the bottom of this file. Every pane, tab and
//service comes from that one pass — so swapping a module in the registry after
//it has run changes nothing anybody can see: the components already registered
//are the old ones, and the new module is never called.
//
//WHICH IS EXACTLY WHAT HAPPENED, silently, for most of a day. webpack rebuilt,
//the client applied the update, no module accepted it, and the console said
//"[HMR] Nothing hot updated." — a SUCCESS. `reload=true` reloads when an update
//FAILS, and this one did not fail; it did nothing. So the served bundle held the
//change, curl proved it, and the window kept rendering code from hours earlier
//while every tool used to check it agreed with the window.
//
//SERVER-HALF CHANGES WERE FINE THROUGHOUT, which is what made it so hard to see:
//../src/app/core/build/main.js tears the node bundle down and rebuilds it on
//every save, so half the app reloaded properly and half did not.
//
//SO THIS ACCEPTS EVERY UPDATE AND ANSWERS IT WITH A FULL RELOAD. It is not a
//workaround for HMR — it is the honest thing for an app whose window is a graph
//built at startup. There is no hot-swap that could be correct here.
//ON `apply`, WHICH IS THE MOMENT MODULES ARE ACTUALLY SWAPPED. `idle` is also
//the resting state and would fire more often than there are updates; `apply`
//happens once per update, including the one that goes on to report that it
//changed nothing — which is precisely the case this exists for.
//
//AND IT DOES NOT self-accept. Re-running this file would build a SECOND plugin
//graph on top of the first: every pane registered twice, every service replaced
//under the panes already holding the old one. A reload is the only correct
//answer, so it is the only one offered.
if (module.hot) {
  var reloading = false;
  module.hot.addStatusHandler(function (status) {
    if (status !== 'apply' || reloading) return;
    reloading = true;
    location.reload();
  });
}

(async function starter() {
  var app = rectify.build(plugins, { isWindow: true })

  //without a listener rectify's emit throws, and a plugin that died during
  //startup leaves a blank window with no clue which one it was
  app.on('error', function (err) {
    console.error('[rectify] a plugin failed to start', err);
    showError('a plugin failed to start', err);
  });

  app = await app.start();
  app.services.app.emit("start");
})();
