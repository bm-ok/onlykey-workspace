var { Server } = require('socket.io');

//socket.io lives on the http server. this half only creates it — the handlers
//are in ./server.js, which reloads, and the connection is in ./window.js.

plugin.consumes = ['http'];
plugin.provides = ['io'];
async function plugin(imports, register) {
    var io = new Server(imports.http.server);

    await register(null, {
        io: io,
        onDestroy: function () {
            try { io.close(); } catch (e) { /* already gone */ }
        }
    });
}
module.exports = plugin;
