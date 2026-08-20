
var Config = require("./config");
var rectify = require('@bmatusiak/rectify');
var showError = require('./overlay');

//every src/app/<plugin>/window.js. the window half, and the only code that
//reaches the browser.
var found = require.context('./app', true, /^\.\/[^_.][^/]*\/window\.(js|jsx)$/);
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
