process.env.NODE_ENV = process.env.NODE_ENV || 'development';

//the development boot. nw.js runs this in its node context, `main` in
//package.json by way of the shim at the root.
//
//a plugin is a folder in src/app, and the files in it say where it runs:
//
//  main.js     here, the process around the app. off disk, never bundled
//  server.js   the app's node half, bundled and reloaded on every save
//  window.js   the window
//
//so this is every src/app/<plugin>/main.js there is, read off disk. the
//packaged build cannot do that — there is no src/ in it — so src/main.prod.js
//gets the same list from the bundle instead.

//webpack replaces this in the packaged bundle; here it just has to exist
global.BUILD_PROD = false;

var fs = require('fs');
var path = require('path');

var boot = require('./boot');
var pkg = require('../package.json');
var Config = require('./config');

var PLUGINS = path.join(__dirname, 'app');

var plugins = fs.readdirSync(PLUGINS)
    .filter(function (name) { return name[0] != '_' && name[0] != '.'; })
    .map(function (name) { return path.join(PLUGINS, name, 'main.js'); })
    .filter(function (file) { return fs.existsSync(file); })
    .map(function (file) { return require(file); });

plugins.config = Config();

boot(plugins, {
    isNw: typeof nw != 'undefined',
    isPackaged: false,
    root: path.dirname(__dirname),
    argv: typeof nw != 'undefined' ? nw.App.argv : process.argv.slice(2),
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
    process.exit(1);
});
