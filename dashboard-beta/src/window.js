
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
