//how the app's two other halves get in front of you.
//
//  development   webpack builds them here, serves the window half from memory
//                and reloads the node half in place on every save
//  packaged      both were built before packaging. the window half rides along
//                inside this bundle as a string, and the node half is simply
//                required — there is nothing to watch and nothing to reload
//
//BUILD_PROD is a constant webpack replaces, so only one of these branches is
//in the packaged bundle. it gates the requires directly rather than sitting
//inside a function, because webpack collects a dependency wherever it can
//reach it — a `require('webpack')` in an unreachable function is still bundled,
//and dragging webpack into a packaged app is exactly what this avoids.

plugin.consumes = ['app', 'http', 'io', 'window', 'tray', 'lifecycle', 'actions', 'log', 'dataDir', 'state', 'secret', 'cron', 'handover'];
plugin.provides = ['build'];
async function plugin(imports, register) {
    var { app, http, io, window: win, tray, lifecycle, actions, log, dataDir, state, secret, cron, handover } = imports;

    //what the node half is handed. the window and the tray are passed as
    //controllers rather than objects, because they outlive the bundle.
    var host = {
        express: http.express,
        router: http.router,
        httpServer: http.server,
        io: io,
        appPackage: app.appPackage,

        //THE ACTION TABLE, HANDED OVER LIKE THE WINDOW AND THE TRAY. It lives
        //in main so the socket serving it survives a save, and the halves that
        //reload register into it from here. Passed as the object itself rather
        //than copied, so a define() from the new bundle lands in the same table
        //the old one was removing itself from.
        actions: actions,

        //THE LOG, FOR THE SAME REASON AND WITH ONE MORE. It lives in main so the
        //lines survive a save; it is passed as the object itself so a line
        //written by the old bundle and a line written by the new one land in the
        //same stream, in order, and the record of a reload is not a gap.
        log: log,

        //EVERY TIMER IN THE APP, for the same reason. A clock rebuilt on every
        //save never reaches an interval measured in hours, and the record of
        //what has run resets while somebody is reading it. What to DO on a tick
        //is in the bundle and is replaced; the clock is not.
        //
        //It is also the only place this app says out loud what it does on its
        //own, unwatched — see Settings → Cron.
        cron: cron,

        //AND EVERYTHING AN APP PLUGIN HANDS TO ITS OWN OTHER HALF.
        //
        //ASKED FOR BY NAME, AND THIS FILE KNOWS NONE OF THEM. Every line above
        //is a CORE service, which core naming is core-to-core and fine; an app
        //service named here would be a strand from core to something core does
        //not need — and the plugin on the other end of it could no longer be
        //lifted out for another project without bringing core's opinion of it.
        //
        //See ../handover/main.js. The same shape as `actions` above: this file
        //carries the container and never reads what is in it.
        of: handover.get,

        //SEALING, AND WHAT A SECRET LOOKS LIKE. Handed over rather than required
        //again on the other side so there is ONE answer to both — a second copy
        //of the redaction list is the exact fault ../secret/looks-like.js was
        //written to end, and a second sealing implementation would be worse.
        secret: secret,

        //WHERE ANYTHING KEPT IS KEPT. A server half that stores something needs
        //a path before it needs anything else, and it must be THIS one — derived
        //from the name in package.json — rather than one worked out again beside
        //the thing being stored. Two answers to "where does it live" is how a
        //list ends up written in one place and read from another.
        dataDir: dataDir,

        //WHAT SURVIVES A RESTART, for the halves that reload. Passed as the
        //object rather than copied, so a document written by the old bundle and
        //read by the new one is the same document.
        state: state,

        window: !win ? undefined : {
            get url() { return http.url; },
            get isOpen() { return win.isOpen; },
            open: function () { win.show(); },
            show: function () { win.show(); },
            hide: function () { win.hide(); },
            openInBrowser: function () { if (http.url) nw.Shell.openExternal(http.url); },
            quit: function (reason) { lifecycle.shutdown(reason || 'asked to quit'); }
        },

        tray: !tray ? undefined : {
            add: function (options) { return tray.add(options); },
            labels: function () { return tray.labels(); }
        }
    };

    var ready;

    if (BUILD_PROD) {

        //---- packaged ---------------------------------------------------

        //the window half, built before packaging and carried here as strings
        var assets = require('../../../../dist/assets.json');

        http.app.get('/', function (req, res) {
            res.type('html').send(assets['index.html']);
        });

        Object.keys(assets).forEach(function (name) {
            if (name == 'index.html') return;
            http.app.get('/' + name, function (req, res) {
                res.type(name.split('.').pop()).send(assets[name]);
            });
        });

        //no separate bundle to load, and no reason to reload it.
        //
        //LOADED WHEN `ready()` IS ASKED FOR, NOT HERE. This used to run during
        //this plugin's own setup, which meant the server half was built while
        //the MAIN graph was still being resolved — so anything it asked
        //`host.of` for depended on whether that plugin's main half happened to
        //have been set up yet. rectify orders by dependency and has no reason to
        //order two plugins that merely share one, so the answer would have been
        //stable only by luck.
        //
        //src/boot.js resolves the whole graph and THEN awaits ready(), so by
        //here every main half has put what it hands over. It also makes the two
        //branches agree on WHEN the server half loads, which is the kind of
        //dev-and-packaged divergence this file exists to prevent rather than
        //introduce.
        var load = function () { return require('../../../server.js')(host); };
        ready = null;

    } else {

        //---- development ------------------------------------------------

        var path = require('path');
        var webpack = require('webpack');
        var devMiddleware = require('webpack-dev-middleware');
        var hotMiddleware = require('webpack-hot-middleware');
        var configs = require('../../../../webpack.config.js');

        var built = configs({}, { mode: process.env.NODE_ENV });
        var windowConfig = built.find(function (c) { return c.name == 'window'; });
        var serverConfig = built.find(function (c) { return c.name == 'server'; });

        var compiler = webpack(windowConfig);
        http.app.use(devMiddleware(compiler, { publicPath: windowConfig.output.publicPath }));
        http.app.use(hotMiddleware(compiler));

        var bundlePath = path.join(serverConfig.output.path, serverConfig.output.filename);
        var loaded = null;

        var load = async function () {
            if (loaded) {
                await loaded.destroy();//rectify runs each plugin's onDestroy, backwards
                loaded = null;
            }

            host.router = http.swapRouter();

            delete require.cache[require.resolve(bundlePath)];
            loaded = await require(bundlePath)(host);
        };

        //one reload at a time. watch() fires again while a load is still
        //awaiting, and two overlapping loads are the double registration all of
        //this exists to prevent.
        //
        //NAMED `reloads` AND NOT `queue`, which it was until the queue plugin
        //arrived. `var` hoists to the whole function, so a local called `queue`
        //shadowed the SERVICE of that name for every line above it — including
        //the one handing it to the node half, which would have been handed
        //undefined. It never was the app's queue; it is a lock on the reload.
        var reloads = Promise.resolve();

        //null while the server half is up; the failure while it is not. Read by
        //the connection hook below, cleared by the next reload that works.
        var down = null;

        var first = null;
        ready = new Promise(function (resolve, reject) { first = { resolve, reject }; });

        //---- AND IT IS SAID AGAIN TO WHOEVER ASKS NEXT -----------------------
        //
        //THE EMIT BELOW RACES THE DISCONNECT AND LOSES ABOUT HALF THE TIME, and
        //losing looks exactly like nothing being wrong.
        //
        //A failed reload has already torn the old half down, and ../io/server.js
        //asks every page to disconnect on the way out. So the sequence is: half
        //dies → sockets are dropped → `server:error` is emitted into a room that
        //has just been emptied → the page reconnects a moment later and asks
        //nothing. The window is then rendered, responsive and orphaned, and the
        //only record is a line in nw.log nobody is tailing.
        //
        //Measured on `ReferenceError: makeFreeing is not defined`, twice: the
        //first time the overlay appeared and was photographed, the second time
        //the same fault produced a clean-looking window and `windowControls`
        //answering `failed: null`. Same bug, opposite verdicts, decided by which
        //side of the disconnect the emit landed on.
        //
        //SO IT IS STATE, NOT AN EVENT. This half is main — it does not reload —
        //so it can hold "the server half is currently down" and tell every page
        //that connects, however late it arrives and however many times.
        io.on('connection', function (socket) {
            if (down) socket.emit('server:error', down);
        });

        webpack(serverConfig).watch({}, function (err, stats) {
            if (err) return first ? first.reject(err) : console.error(err);
            if (stats.hasErrors()) {
                var e = new Error(stats.toString({ all: false, errors: true }));
                return first ? first.reject(e) : console.error(String(e.message));
            }
            console.log('server bundle built in ' + (stats.endTime - stats.startTime) + 'ms');

            reloads = reloads.then(function () {
                return load().then(function () {
                    //SAID EVEN WHEN NOTHING WAS WRONG, because the page cannot
                    //tell "no failure since I connected" from "a failure I never
                    //heard about". Clearing an overlay that is not there costs
                    //nothing; leaving one up that should be gone costs the whole
                    //check — see ../../../overlay.js.
                    down = null;
                    io.emit('server:ok');
                    if (first) { first.resolve(); first = null; }
                    else console.log('server half reloaded');
                }, function (e) {
                    if (first) { first.reject(e); first = null; return; }
                    //the old half is already torn down, so the app is serving
                    //the window and nothing else. say so on screen, not just here.
                    console.error('server half failed to reload', e && e.stack || e);
                    down = { message: String(e && e.stack || e), when: Date.now() };
                    io.emit('server:error', down);
                });
            }, function () { /* the previous reload already reported itself */ });
        });
    }

    await register(null, {
        build: {
            //src/boot.js waits on this before it listens, so the handlers are
            //up before anything can connect.
            //
            //ONE PATH FOR BOTH BRANCHES. In development `ready` is already the
            //promise the watcher resolves on its first build; packaged, it is
            //null until this is asked, and asking is what loads the server half
            //— once, memoised, after the main graph is complete.
            ready: function () {
                if (!ready) ready = load();
                return ready;
            }
        }
    });
}
module.exports = plugin;
