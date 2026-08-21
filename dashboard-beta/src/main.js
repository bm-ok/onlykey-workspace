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
//so this is every plugin's main.js there is, read off disk. the packaged build
//cannot do that — there is no src/ in it — so src/main.prod.js gets the same
//list from the bundle instead, and test/plugins.test.js holds the two to the
//same answer.

//webpack replaces this in the packaged bundle; here it just has to exist
global.BUILD_PROD = false;

var fs = require('fs');
var path = require('path');

var boot = require('./boot');
var pkg = require('../package.json');
var Config = require('./config');

var PLUGINS = path.join(__dirname, 'app');

//A PLUGIN IS A FOLDER WITH A main.js IN IT, one level down or two: src/app/api,
//or src/app/core/http. The second level is the grouping, and it stops there --
//../app/ui/editor/vendor/ace is 900KB of somebody else's code, and the only thing
//standing between it and being started as a plugin is that nothing three levels
//down is ever looked at.
//
//THIS HAS TO ACCEPT EXACTLY WHAT THE THREE require.context CALLS ACCEPT --
//src/window.js, src/server.js, src/main.prod.js. A plugin they take and this one
//misses runs in the packaged build and not in development, and neither says a
//word: an unfound plugin is not an error, it is an absence. That is the
//divergence the header above says these two files exist to prevent, and
//test/plugins.test.js is what holds all four to one answer.
var DEPTH = 2;

function scanned(name) {
    return name[0] != '_' && name[0] != '.' && name != 'vendor';
}

function found(dir, left, out) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
        if (!entry.isDirectory() || !scanned(entry.name)) return;
        var here = path.join(dir, entry.name);
        //BOTH, NOT EITHER, AND THAT IS WHAT LETS A FOLDER BE BOTH.
        //A group may also be a plugin — ../app/repositories registers the tab and
        //holds the panes as folders inside it. This takes the folder's own main.js
        //AND descends, which is exactly what the regexes do: they match a path
        //shape, and `./a/main.js` and `./a/b/main.js` are two different paths,
        //each yielded once.
        //
        //THE OLD COMMENT HERE SAID SUCH A FOLDER "would be taken twice there and
        //once here", and test/plugins.test.js banned the shape on that basis.
        //Neither was right — `[^/]*` cannot cross a slash, so the one-level branch
        //cannot reach a file two levels down. Measured against all three regexes
        //before the ban was lifted: two files selected, no duplicates.
        if (fs.existsSync(path.join(here, 'main.js'))) out.push(path.join(here, 'main.js'));
        if (left > 1) found(here, left - 1, out);
    });
    return out;
}

var plugins = found(PLUGINS, DEPTH, []).map(function (file) { return require(file); });

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
