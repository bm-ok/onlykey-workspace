var http = require('http');
var express = require('express');

//one express app, one server. plugins mount on a router rather than on the app
//itself, so the whole set of routes can be thrown away and rebuilt when the
//server half reloads.

plugin.consumes = ['app'];
plugin.provides = ['http'];
async function plugin(imports, register) {

    var expressApp = express();
    var server = http.createServer(expressApp);

    var router = express.Router();
    expressApp.use(function (req, res, next) { router(req, res, next); });

    var url = null;

    await register(null, {
        http: {
            express: express,
            app: expressApp,
            server: server,

            get url() { return url; },
            get router() { return router; },

            //a fresh router, so routes from the previous load do not stack up
            swapRouter: function () {
                router = express.Router();
                return router;
            },

            //THE PORT IS FIXED NOW, AND THAT IS A CORRECTION.
            //
            //It used to be 0 — "whatever is free" — with a comment saying
            //nothing depended on a fixed port. That stopped being true the
            //moment anything was remembered in the window.
            //
            //BROWSER STORAGE IS KEYED BY ORIGIN. A new port is a new origin, so
            //every restart handed the page a brand-new, empty localStorage: the
            //tab you were on, the machine you had selected, the file you were
            //reading, all gone, silently, and with no way to tell that from
            //"nothing was ever saved". The whole point of remembering is to
            //survive a restart, and a restart is exactly what erased it.
            //
            //It is also what makes a browser tab worth having at all. An address
            //that changes every start cannot be bookmarked, cannot be left open,
            //and cannot be the thing you keep in a pinned tab.
            //
            //TAKEN MEANS ANOTHER COPY IS RUNNING, and that is worth failing on
            //rather than sliding past. Two of these side by side was the old
            //behaviour's one advantage; it cost a silent second instance with
            //its own idea of the world, and `npm run stop` already exists for
            //the case where one is in the way. Set PORT to run a second on
            //purpose — knowing it gets its own memory, because it is its own
            //origin.
            listen: function () {
                var host = process.env.HOST || 'localhost';
                var port = process.env.PORT || 7317;

                return new Promise(function (resolve, reject) {
                    server.once('error', function (e) {
                        if (e.code == 'EADDRINUSE') {
                            console.error(
                                'port ' + port + ' is already taken — another copy of this app is probably still running. ' +
                                '`npm run stop` closes it. PORT=... runs a second one on a port of its own, ' +
                                'which gets its own remembered view because browser storage is per origin.'
                            );
                        }
                        reject(e);
                    });
                    server.listen(port, host, function () {
                        url = 'http://' + host + ':' + server.address().port + '/';
                        resolve(url);
                    });
                });
            }
        },
        onDestroy: function () {
            try { server.close(); } catch (e) { /* already gone */ }
        }
    });
}
module.exports = plugin;
