var serve = require('./serve');

//the handlers. reloaded on every save, so they come off again in onDestroy —
//otherwise each reload would leave another copy listening.

plugin.consumes = ['app'];
plugin.provides = ['io', 'appPackage'];
async function plugin(imports, register) {
    var host = imports.app.host;

    serve(host.io, host.appPackage);

    await register(null, {
        io: host.io,
        appPackage: host.appPackage,
        onDestroy: function () {
            host.io.removeAllListeners('connection');
            //DROPPED SO THEY LAND ON THE NEW HANDLERS — but they do NOT come
            //back by themselves, whatever this line used to claim.
            //socket.io-client treats a disconnect the server ASKED for as final;
            //only a connection that died under it is retried. So the recovery is
            //in ./window.js, which listens for the reason and reconnects.
            //
            //`disconnectSockets(true)` looks like the fix on this side and is not:
            //the client reports "io server disconnect" either way. Measured, both
            //ways, rather than reasoned about.
            host.io.disconnectSockets();
        }
    });
}
module.exports = plugin;
