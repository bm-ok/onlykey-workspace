var fs = require('fs');
var net = require('net');
var os = require('os');
var path = require('path');

//the action table, for something on this machine that is not the window.
//
//A LOCAL SOCKET RATHER THAN A PORT, and this is carried over from the app being
//ported with its reasoning intact. There is already an http server here and it
//already answers on localhost — so the obvious thing would be to put the actions
//on it. The reason not to: "localhost only" is a CHECK, a line of code comparing
//an address, which is right until somebody edits it, and which stands between a
//stranger on the network and actions that delete disks. A local socket is not
//reachable from another machine at all. There is no address to get wrong, no
//interface to bind to by accident, and no rule to keep enforcing. The strongest
//version of a check is not needing one.
//
//SO THERE ARE TWO WAYS IN AND THEY ARE NOT THE SAME. socket.io over http is for
//the window, which is a page and can only speak http. This is for the terminal.
//Both reach the same table; only one of them has an address.
//
//A unix domain socket where there is one, a named pipe on windows — node takes
//both as `path`, so this is one implementation rather than two behind a flag.
//Newline-delimited JSON: no dependency, and re-implementable in a shell script
//in an afternoon.
//
//IT LIVES IN MAIN BECAUSE IT MUST OUTLIVE A SAVE. The server half is rebuilt and
//re-run whenever a file changes; a socket held there would drop every connected
//terminal on each edit. Here it is opened once. The TABLE it serves is the one
//in ../actions, which is also in main for the same reason, and the actions
//themselves reload freely underneath both.

var ADDRESS = process.platform == 'win32'
    ? '\\\\.\\pipe\\okc-dashboard-beta'
    : path.join(os.tmpdir(), 'okc-dashboard-beta.sock');

plugin.consumes = ['actions'];
plugin.provides = ['ipc'];
async function plugin(imports, register) {
    var actions = imports.actions;

    //A UNIX SOCKET IS A FILE and outlives the process that made it, so a crash
    //leaves one behind that nothing is listening on — and binding then fails
    //with EADDRINUSE for a server that is not running. Windows pipes disappear
    //with their last handle and need none of this.
    if (process.platform != 'win32') {
        try { if (fs.existsSync(ADDRESS)) fs.unlinkSync(ADDRESS); } catch (e) { /* listen will report it */ }
    }

    function say(socket, obj) {
        try { socket.write(JSON.stringify(obj) + '\n'); } catch (e) { /* gone */ }
    }

    async function answer(line, socket) {
        var req;
        try { req = JSON.parse(line); }
        catch (e) { return say(socket, { id: null, ok: false, error: 'that was not valid JSON' }); }

        try {
            //MARKED AS HAVING COME DOWN THE PIPE. The window calls the same
            //table and this is absent there, which is the only difference
            //between the two callers — and it is the difference an action needs
            //when what it does should be a person's press rather than a step
            //inside something automated.
            var args = Object.assign({}, req.args || {}, { _overTheWire: true });
            var result = await actions.call(req.action, args);
            say(socket, { id: req.id == null ? null : req.id, ok: true, result: result });
        } catch (e) {
            //THE MESSAGE AND NOTHING ELSE. A stack trace here is this app's
            //internals arriving where somebody asked a question about their
            //machines.
            say(socket, { id: req.id == null ? null : req.id, ok: false, error: e && e.message || String(e) });
        }
    }

    var server = net.createServer(function (socket) {
        var buf = '';
        socket.on('error', function () { /* a client that leaves mid-call is not an event */ });
        socket.on('data', function (chunk) {
            buf += chunk;
            var cut;
            while ((cut = buf.indexOf('\n')) >= 0) {
                var line = buf.slice(0, cut);
                buf = buf.slice(cut + 1);
                if (line.trim()) answer(line, socket);
            }
        });
    });

    await new Promise(function (resolve, reject) {
        server.once('error', reject);
        server.listen(ADDRESS, function () {
            //ON UNIX THE SOCKET IS A FILE, and its permissions are the whole of
            //who may drive this. Left at the default umask, another account on
            //the same machine could reach these actions. Windows pipes carry an
            //ACL granting the creating user, so there is nothing to set.
            if (process.platform != 'win32') {
                try { fs.chmodSync(ADDRESS, 0o600); } catch (e) { /* better to serve than to refuse over this */ }
            }
            console.log('the actions are on ' + ADDRESS + ' for the terminal');
            resolve();
        });
    });

    await register(null, {
        ipc: { address: ADDRESS },
        onDestroy: function () {
            try { server.close(); } catch (e) { /* already closed */ }
        }
    });
}
module.exports = plugin;
