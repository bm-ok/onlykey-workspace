var net = require('net');
var os = require('os');
var path = require('path');

//the node half of the okc plugin: one socket to the running dashboard, relayed
//to the window over socket.io.
//
//WHY A RELAY AND NOT THE ACTIONS THEMSELVES. This is a spike. The dashboard is
//working and in daily use, and two processes both driving VBoxManage and both
//writing the same state files is the one thing it is arranged to prevent — its
//own CLI refuses to start a second copy for exactly that reason. So this talks
//to the one that is already running, over the socket it already serves, and
//nothing here can break it.
//
//The address and the wire are the dashboard's, unchanged: newline-delimited
//JSON, {id, action, args} out and {id, ok, result|error} back. A local socket
//rather than a port, which is its decision and a good one — there is no address
//to get wrong and nothing on the network to reach it.
var ADDRESS = process.platform == 'win32'
    ? '\\\\.\\pipe\\okc-dashboard'
    : path.join(os.tmpdir(), 'okc-dashboard.sock');

//`actions` COMES OFF THE HOST, NOT OUT OF IMPORTS. The table is a main-side
//service and this is the server graph, which is a different plugin list — the
//two meet only through the host object build/main.js hands over. Consuming it
//by name here would simply never resolve.
plugin.consumes = ['app'];
plugin.provides = ['okc'];
async function plugin(imports, register) {
    var host = imports.app.host;
    var io = host.io;
    var actions = host.actions;

    var sock = null;
    var buf = '';
    var next = 1;
    var pending = new Map();
    var closing = false;

    //EVERY CALL IS REJECTED WHEN THE PIPE GOES, rather than left hanging. The
    //dashboard is restarted often — a dozen times in an afternoon while its own
    //code is being worked on — and a window whose requests never settle looks
    //identical to one whose server is merely slow.
    function drop(why) {
        var waiting = [...pending.values()];
        pending.clear();
        waiting.forEach(function (p) { p.reject(new Error(why)); });
    }

    function connect() {
        if (closing || sock) return;
        var s = net.connect(ADDRESS);
        sock = s;

        s.on('connect', function () { io.emit('okc:up', true); });

        s.on('data', function (chunk) {
            buf += chunk;
            var cut;
            while ((cut = buf.indexOf('\n')) >= 0) {
                var line = buf.slice(0, cut);
                buf = buf.slice(cut + 1);
                if (!line.trim()) continue;
                var msg;
                try { msg = JSON.parse(line); } catch (e) { continue; }
                var p = pending.get(msg.id);
                if (!p) continue;
                pending.delete(msg.id);
                if (msg.ok) p.resolve(msg.result);
                else p.reject(new Error(msg.error || 'the dashboard refused it and said nothing'));
            }
        });

        //A DASHBOARD THAT IS NOT RUNNING IS AN ORDINARY STATE, not an error to
        //shout about: it is restarted constantly, and this reconnects quietly.
        function gone() {
            if (sock != s) return;
            sock = null;
            buf = '';
            drop('the dashboard is not listening — it may be restarting');
            io.emit('okc:up', false);
            if (!closing) setTimeout(connect, 1000);
        }
        s.on('error', gone);
        s.on('close', gone);
    }

    function call(action, args) {
        return new Promise(function (resolve, reject) {
            if (!sock) return reject(new Error('the dashboard is not listening — start it with npm start in dashboard/'));
            var id = next++;
            pending.set(id, { resolve: resolve, reject: reject });
            sock.write(JSON.stringify({ id: id, action: action, args: args || {} }) + '\n');
        });
    }

    io.on('connection', function (client) {
        client.emit('okc:up', !!sock);

        //AND IT CAN BE ASKED, not only told. The emit above is the only
        //announcement a client gets, and the window attaches its listener a
        //moment after the socket is up — so the one page that most needs the
        //answer is the one that can miss it. The result was a dot saying "not
        //connected" above a panel full of live data: two answers to one
        //question, on the same screen.
        client.on('okc:up?', function (_args, reply) {
            if (typeof reply == 'function') reply(!!sock);
        });

        //ONE HANDLER, NOT ONE PER ACTION. The dashboard's whole surface is a
        //table of named actions, and the window asks for them by name — the same
        //way its own window, its CLI and its drills all do. A per-action handler
        //here would be a second list to keep in step with that one.
        client.on('okc:call', function (msg, reply) {
            if (typeof reply != 'function') return;
            call(msg && msg.action, msg && msg.args).then(
                function (result) { reply({ ok: true, result: result }); },
                function (e) { reply({ ok: false, error: e.message }); }
            );
        });
    });

    connect();

    //---- AND THE ACTIONS THIS APP DOES NOT OWN YET -------------------------
    //
    //A PORT IN PROGRESS HAS TO BE BOTH THINGS AT ONCE. Most of what the tabs
    //ask for still lives in the app being ported from; a few actions are
    //answered here. Registered as a FALL-THROUGH rather than by copying every
    //name across: the table tries its own first, and anything it does not know
    //comes here and goes down the pipe.
    //
    //So nothing above has to know which half owns what, and the day an action
    //moves in, it simply stops falling through — no list to update, and no
    //moment where both answer.
    //`actions` MAY NOT BE THERE, and that is a real configuration rather than a
    //broken one: the test suite builds this half against its own host — express,
    //socket.io, a package name — with no action table, because what it is
    //testing is the graph and the socket. Assuming the table exists turned a
    //passing suite into one that hung, which is a worse failure than the missing
    //feature would have been.
    var unfallback = actions ? actions.fallback(function (name, args) {
        if (!sock) return undefined;//not mine to answer while the pipe is down
        return call(name, args);
    }) : function () {};

    await register(null, {
        okc: { call: call, get connected() { return !!sock; } },

        //THIS HALF RELOADS ON EVERY SAVE, so the socket has to come off with it.
        //Without this each reload would leave another one open and another set
        //of handlers listening, which is what the whole onDestroy contract is
        //for.
        onDestroy: function () {
            closing = true;
            unfallback();
            drop('the server half is reloading');
            io.removeAllListeners('connection');
            if (sock) { try { sock.destroy(); } catch (e) { /* already gone */ } }
            sock = null;
        }
    });
}
module.exports = plugin;
