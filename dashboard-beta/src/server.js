
var Config = require("./config");
var rectify = require('@bmatusiak/rectify');

//every src/app/<plugin>/server.js. webpack turns this into a context, so the
//node bundle carries the server halves and nothing else.
var found = require.context('./app', true, /^\.\/[^_.][^/]*\/server\.js$/);
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
