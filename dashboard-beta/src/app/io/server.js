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
            host.io.disconnectSockets();//the clients reconnect onto the new handlers
        }
    });
}
module.exports = plugin;
