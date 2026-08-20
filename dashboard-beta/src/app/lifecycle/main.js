var fs = require('fs');
var path = require('path');

//quitting, crashing, and telling the launcher we are here.

plugin.consumes = ['app'];
plugin.provides = ['lifecycle'];
async function plugin(imports, register) {
    var app = imports.app;

    //tools/nw.js reads this to say "already running" instead of starting a
    //second one. nw.js is single instance so the second launch is handed to us,
    //but that happens inside the nw binary where the launcher cannot see it.
    var INSTANCE_FILE = path.join(app.root, '.nw-instance.json');

    var shuttingDown = false;

    var lifecycle = {
        get isShuttingDown() { return shuttingDown; },

        //the window is not the app, so this is the only way out
        shutdown: function (reason) {
            if (shuttingDown) return;//the window closing and a failing server both land here
            shuttingDown = true;

            console.log('shutting down: ' + reason);

            //every plugin's onDestroy, in reverse: the tray comes off, the
            //server closes, this file goes away
            Promise.resolve(app.destroyAll()).catch(function (e) {
                console.error('teardown failed', e && e.stack || e);
            }).then(function () {
                if (app.isNw) {
                    try { nw.App.closeAllWindows(); } catch (e) { /* already gone */ }
                    try { nw.App.quit(); } catch (e) { /* already gone */ }
                }
                //nw.App.quit() on its own can leave this context alive: the
                //server, socket.io and webpack's watchers are open handles
                var t = setTimeout(function () { process.exit(0); }, 300);
                if (t && t.unref) t.unref();
            });
        },

        publish: function (url) {
            //a boot under plain node is not a running app to the launcher, and a
            //package has no launcher reading this at all
            if (!app.isNw || app.isPackaged) return;
            try {
                fs.writeFileSync(INSTANCE_FILE, JSON.stringify({ pid: process.pid, url: url }, null, 2));
            } catch (e) {
                console.error('could not write ' + INSTANCE_FILE + ': ' + (e && e.message));
            }
        }
    };

    //in nw's node context an uncaught throw takes the app down with no window
    //and no message, which is the failure mode hardest to read from outside
    process.on('uncaughtException', function (e) {
        console.error('uncaught exception', e && e.stack || e);
        lifecycle.shutdown('an uncaught exception');
    });
    process.on('unhandledRejection', function (e) {
        //not fatal on its own, but silence here is what hides a broken plugin
        console.error('unhandled rejection', e && e.stack || e);
    });

    await register(null, {
        lifecycle: lifecycle,
        onDestroy: function () {
            try { fs.unlinkSync(INSTANCE_FILE); } catch (e) { /* never written, or already gone */ }
        }
    });
}
module.exports = plugin;
