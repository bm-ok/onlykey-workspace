var { io: connect } = require('socket.io-client');
var serve = require('./serve');
var mockPair = require('./mock');
var showError = require('../../overlay');

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
