
var Config = require("./config");
var rectify = require('@bmatusiak/rectify');

//every src/app/<plugin>/server.js. webpack turns this into a context, so the
//node bundle carries the server halves and nothing else.
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
var found = require.context('./app', true, /^\.\/[^_./][^/]*(?:\/(?!vendor\/)[^_./][^/]*)?\/server\.js$/);
var plugins = found.keys().map(found);

plugins.config = Config();

//the node half of the app. src/main.js builds this bundle, hands it the host,
//and rebuilds it whenever a file under src changes.
//
//the returned destroy() is what makes that reloadable: rectify runs the
//onDestroy each plugin handed to register(), backwards.
module.exports = async function server(host) {
    //the host goes under one key rather than spread across `app`. rectify's own
  //services.app already carries `window` (the dom window, or `global` in node),
  //`services`, `on`, `emit` and the is* flags -- so anything spread in there is
  //one name away from a collision that looks like it works.
  var app = rectify.build(plugins, { isServer: true, host: host });

  var failed = null;
  app.on('error', function (err) {
    failed = err;
    console.error('[rectify] a plugin failed to start', err && err.stack || err);
  });

  app = await app.start();
  if (failed) throw failed;

  app.services.app.emit("start");

  return { app: app, destroy: function () { return app.destroy(); } };
};
