var { io: connect } = require('socket.io-client');
var serve = require('./serve');
var mockPair = require('./mock');
var showError = require('../../../overlay');

//the window has no node in it, so everything the node side knows arrives over
//this socket.

plugin.consumes = [];
plugin.provides = ['io', 'appPackage'];
async function plugin(imports, register) {

    //?mock runs ./serve.js in the page instead of talking to a socket — the
    //real server code against a fake wire, not a second implementation of it.
    //deliberately opt in: falling back to it on a failed connection silently
    //served made up data whenever the server was merely slow.
    if (new URLSearchParams(location.search).has('mock')) {
        var mock = mockPair();
        serve(mock.io, { title: 'mock', name: 'mock', version: '0.0.0' });
        var mocked = await new Promise(function (resolve) { mock.socket.once('app', resolve); });
        return register(null, { io: mock.socket, appPackage: mocked });
    }

    var socket = connect({ timeout: 4000 });

    //THE NODE HALF RELOADS BY DROPPING EVERYONE, and whether they come back on
    //their own depends on HOW they were dropped. socket.io-client retries a
    //connection that closed under it — transport close, ping timeout — but treats
    //a disconnect the server asked for as final, because the server asking is
    //taken to mean the server meant it. ../io/server.js asks, on every reload.
    //
    //SO WITHOUT THIS THE PAGE IS ORPHANED PERMANENTLY, and it does not look it: it
    //stays rendered and reads as healthy right up until you touch something that
    //needs the socket. It presents as an intermittent fault and is not one — it is
    //every reload, every time. Measured: the reason is "io server disconnect", and
    //`disconnectSockets(true)` on the server side does not change it. The recovery
    //has to be here.
    socket.on('disconnect', function (reason) {
        console.log('socket disconnected: ' + reason);
        if (reason == 'io server disconnect') socket.connect();
    });

    //the node side tells us when its half failed to reload, at which point the
    //page is talking to a server that no longer has any handlers
    socket.on('server:error', function (e) {
        showError('the server half failed to reload', e && e.message);
    });

    var appPackage = await new Promise(function (resolve, reject) {
        socket.once('app', resolve);
        socket.once('connect_error', function (err) {
            reject(new Error('no server answered on ' + location.origin +
                '. add ?mock to run the server half in the page instead. (' + err.message + ')'));
        });
    });

    await register(null, { io: socket, appPackage });
}
module.exports = plugin;
