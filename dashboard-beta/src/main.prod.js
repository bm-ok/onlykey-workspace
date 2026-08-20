//the packaged boot.
//
//note there is no `process.env.NODE_ENV = ...` here: webpack replaces that
//expression with the literal "production" in a production build, which would
//turn the assignment into "production" = "production" and fail to parse. webpack bundles this, nwjc compiles the bundle, and
//app.html loads the result — so nothing executable is on disk.
//
//it runs inside a hidden window rather than nw's node context, because
//evalNWBin is a Window method and the node context has no window to call it on.
//that window is local, so it has node; the visible one is remote and does not.

var path = require('path');

var boot = require('./boot');
var pkg = require('../package.json');
var Config = require('./config');

//the same folder scan src/main.js does off disk, done by webpack at build time
var found = require.context('./app', true, /^\.\/[^_.][^/]*\/main\.js$/);
var plugins = found.keys().map(found);

plugins.config = Config();

//where the app's files are. nw sets the working directory to the app's own
//directory, whichever directory the app was launched from — measured both ways.
//
//the obvious alternatives are all wrong here: location.href is a
//chrome-extension:// url rather than a file:// one, so fileURLToPath throws;
//__dirname does not exist in this context at all; process.execPath is the
//runtime, which under `npm start -- --prod` is inside node_modules; and
//nw.App.startPath is wherever the launch happened to happen.
var root = process.cwd();

boot(plugins, {
    isNw: true,
    isPackaged: true,
    root: root,
    argv: nw.App.argv,
    appPackage: {
        title: pkg.title || pkg.name,
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        author: pkg.author,
        license: pkg.license
    }
}).catch(function (e) {
    console.error(e && e.stack || e);
});
