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

            listen: function () {
                var host = process.env.HOST || 'localhost';
                //0 means "whatever is free". nothing depends on a fixed port, so
                //two of these can run side by side. set PORT to pin it.
                var port = process.env.PORT || 0;

                return new Promise(function (resolve, reject) {
                    server.once('error', function (e) {
                        if (e.code == 'EADDRINUSE')
                            console.error('port ' + port + ' is already taken. another copy is probably still running.');
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
