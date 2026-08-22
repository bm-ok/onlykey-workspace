var crypto = require('crypto');
var fs = require('fs');
var wire = require('./wire');
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
//
//---------------------------------------------------------------------------
//AND NOT BEING ON THE NETWORK IS NOT THE SAME AS BEING CLOSED.
//
//Everything above is about who can REACH this, and it is all true: no other
//machine can. It says nothing about who on THIS machine can, and the answer was
//everybody. A named pipe's default ACL on windows grants any account logged into
//the box; /tmp is world-readable, so the only thing standing in front of a unix
//socket is the mode set on it below. Whoever gets through drives the whole table
//— every machine, every credential, every disk.
//
//The socket was never obscure either. Its address is in this file, in tools, and
//printed at startup, which is right: an address people can find is how the thing
//gets used. Obscurity was doing no work and was not asked to.
//
//SO A SHARED SECRET, in a file only this account can read. The connection says it
//before it says anything else, and until it does the table is not reachable
//through it. That is a check, and this comment argues against checks — but the
//thing it argues for, an address that cannot be reached wrongly, is not available
//here: the pipe has to be reachable by this user's own terminal, and there is no
//address that is reachable by one program and not another. When the boundary
//cannot be made structural, it has to be made explicit.
//---------------------------------------------------------------------------

var ADDRESS = process.platform == 'win32'
    ? '\\\\.\\pipe\\okc-dashboard-beta'
    : path.join(os.tmpdir(), 'okc-dashboard-beta.sock');

//BESIDE THE SOCKET, AND DERIVED THE SAME WAY, so both ends agree on where it is
//with nothing passed between them and nothing to configure. On unix that is
//literally beside it; on windows the socket is a pipe and has no directory, so
//"beside" means the same per-user temp folder the unix one lives in.
var TOKEN_FILE = path.join(os.tmpdir(), 'okc-dashboard-beta.token');

//LONG ENOUGH THAT GUESSING IS NOT A STRATEGY. 32 bytes, and it is compared as
//bytes rather than as a string — see `sameSecret` in ./wire.js.
var TOKEN_BYTES = 32;

//A CONNECTION THAT SAYS NOTHING IS STILL A HANDLE. Something that opens the pipe
//and waits costs a file descriptor for as long as the app runs, and enough of
//them is the whole app. This is not a security boundary — anyone who can connect
//can also send a bad greeting — it is housekeeping with a number on it.
var GREETING_MS = 5000;

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

    //NEW EVERY TIME THE APP STARTS. A token that outlived the process would be
    //one a stale terminal could still use, and there is nothing to gain by
    //keeping it: the client reads the file every call.
    var TOKEN = crypto.randomBytes(TOKEN_BYTES).toString('hex');

    //REMOVED FIRST, THEN WRITTEN, AND THEN CHMODDED ANYWAY.
    //
    //`writeFileSync`'s `mode` applies only when it CREATES the file. A leftover
    //from a previous run — or one somebody else created first — keeps whatever
    //permissions it already had, and the new secret is written into it. So the
    //old one goes before the new one is written, and the mode is set explicitly
    //afterwards rather than trusted to the open.
    //
    //ON WINDOWS THIS MODE IS THEATRE and is left in only because it is harmless:
    //chmod there toggles the read-only bit and grants nothing. What protects the
    //file is that %LOCALAPPDATA%\Temp is the user's own, which is the same thing
    //protecting the file this app keeps its other secrets in.
    try { fs.unlinkSync(TOKEN_FILE); } catch (e) { /* it was not there */ }
    fs.writeFileSync(TOKEN_FILE, TOKEN, { mode: 0o600 });
    try { fs.chmodSync(TOKEN_FILE, 0o600); } catch (e) { /* windows, or a filesystem without modes */ }

    //SAID ONCE, THE SAME WAY, WHATEVER WENT WRONG. A greeting that is missing,
    //malformed, wrong, or the right length and still wrong all get this — because
    //telling them apart is telling a caller which half of the guess was right.
    var REFUSED = 'This needs the token, as {"auth":"<token>"}, before anything else. '
        + 'It is in ' + TOKEN_FILE + ', readable by the account running this app and no other.';

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
            //
            //AND IT IS SET HERE RATHER THAN TAKEN FROM THE REQUEST, which is
            //what makes it worth anything: a caller that could send
            //`_overTheWire: false` would be a caller that can call itself a
            //person.
            //
            //TWO HALVES, AND THE SECOND WAS MISSING. Putting ours last stops
            //`_overTheWire` being overridden and does nothing about any OTHER
            //`_` key — and `_fromMachine` is read: ../actions/main.js attributes
            //a call to it, and ../../library/server.js decides from it whether
            //something arrived from a machine and therefore waits rather than
            //being approved. So a caller down this pipe could sign its call as
            //any machine it liked.
            //
            //Every `_` key is dropped before ours are set. What arrives over the
            //wire is data, and data does not get to say where it came from —
            //../../supervisor/guestapi.js does the same thing at the other door,
            //and the app being ported from called this the half that gets
            //forgotten.
            var args = {};
            Object.keys(req.args || {}).forEach(function (k) {
                if (k.charAt(0) !== '_') args[k] = req.args[k];
            });
            args._overTheWire = true;
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
        //A CONNECTION THAT SAYS NOTHING IS STILL A HANDLE. Something that opens
        //the pipe and waits costs a file descriptor for as long as the app runs,
        //and enough of them is the whole app. Not a security boundary — anyone
        //who can connect can also send a bad greeting — housekeeping with a
        //number on it.
        var one = wire.connection(socket, {
            token: TOKEN,
            refused: REFUSED,
            run: function (line) { answer(line, socket); }
        });

        var waiting = setTimeout(function () {
            if (!one.trusted) socket.destroy();
        }, GREETING_MS);
        //so a held connection cannot keep the process alive on its own
        if (waiting.unref) waiting.unref();

        socket.on('error', function () { /* a client that leaves mid-call is not an event */ });
        socket.on('close', function () { clearTimeout(waiting); });
        socket.on('data', function (chunk) {
            one.data(chunk);
            if (one.trusted) clearTimeout(waiting);
        });
    });

    await new Promise(function (resolve, reject) {
        server.once('error', reject);
        server.listen(ADDRESS, function () {
            //ON UNIX THE SOCKET IS A FILE, and its permissions are one half of
            //who may drive this — the token above is the other, and it is the
            //half that also holds on windows, where a pipe's default ACL grants
            //every account on the machine.
            if (process.platform != 'win32') {
                try { fs.chmodSync(ADDRESS, 0o600); } catch (e) { /* better to serve than to refuse over this */ }
            }
            console.log('the actions are on ' + ADDRESS + ' for the terminal');
            resolve();
        });
    });

    await register(null, {
        ipc: { address: ADDRESS, tokenFile: TOKEN_FILE },
        onDestroy: function () {
            try { server.close(); } catch (e) { /* already closed */ }
            //THE SECRET GOES WITH THE THING IT OPENED. A token file left behind
            //names a socket nothing is listening on, which is harmless — right
            //up until the next run, where the client would read a stale one and
            //be refused by an app that is working perfectly.
            try { fs.unlinkSync(TOKEN_FILE); } catch (e) { /* already gone */ }
        }
    });
}
module.exports = plugin;
