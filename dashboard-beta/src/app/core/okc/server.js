var net = require('net');
var Watching = require('./watching');
var scrub = require('./scrub').scrub;
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
plugin.consumes = ['app', 'log'];
plugin.provides = ['okc'];
async function plugin(imports, register) {
    var host = imports.app.host;
    var io = host.io;
    var actions = host.actions;

    //THE FIRST THING IN THIS APP THAT WRITES TO ITS OWN LOG, and it says the
    //one thing the Live tab could not tell you before: whether the half that
    //answers almost every question on screen is reachable at all.
    //
    //ON THE CHANGE ONLY, NEVER ON THE ATTEMPT. `gone` fires once a second for as
    //long as the dashboard is down, and a line each time would fill all two
    //thousand of them with the same sentence in half an hour — evicting the
    //record of whatever went wrong just before it. The comment below already
    //says a dashboard that is not running is an ordinary state; a log that
    //shouts it sixty times a minute disagrees.
    var log = imports.log.on('okc');
    var said = false;

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

        s.on('connect', function () {
            if (!said) { said = true; log.good('connected to the dashboard'); }
            io.emit('okc:up', true);
        });

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
            if (said) { said = false; log.warn('the dashboard stopped answering — reconnecting quietly until it is back'); }
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

    //THE SAME SURFACE A PANE REACHES THROUGH `okc:call`, and deliberately the
    //same one: a watch must answer exactly what asking would have answered, or a
    //pane is being kept up to date with a different question than the one it
    //drew.
    function reachFor(w) {
        return actions ? actions.call(w.action, w.args) : call(w.action, w.args);
    }

    //---- what the windows are watching, and the one timer that checks it ----
    //
    //ONE INTERVAL FOR THE WHOLE APP, rather than one per watch. Forty timers here
    //would be the forty that were just taken out of the page, moved. This wakes
    //on a coarse beat and asks the registry what is due; a watch's cadence is
    //what it MEANS rather than what it owns.
    //
    //THE BEAT IS THE GRANULARITY, NOT THE CADENCE. Everything is rounded up to
    //the next beat, which is why the floor on a watch is a whole second — asking
    //for less would be asking for something this cannot deliver anyway.
    var BEAT = 500;

    var watches = Watching();
    var watchers = new Map();
    var beat = null;

    async function sweep() {
        var ready = watches.due();
        for (var i = 0; i < ready.length; i++) {
            var w = ready[i];
            //MARKED OUT BEFORE IT IS ASKED, so the next beat does not dispatch it
            //again while this one is still in flight. See ./watching.js.
            watches.started(w);
            (function (it) {
                reachFor(it).then(function (result) {
                    it.quiet = false;
                    var said = watches.answered(it, result);
                    if (!said.changed || said.gone) return;
                    var to = watchers.get(it.who);
                    if (to) to.emit('okc:changed', { id: it.id, result: result });
                }, function (e) {
                    watches.failed(it);
                    //NOT LOGGED PER FAILURE. A watch on an action that is failing
                    //fails on every beat, and a line each time would fill the log
                    //with one sentence — the same argument as the relay above.
                    //The pane keeps what it had and hears about the recovery.
                    if (!it.quiet) { it.quiet = true; log.info('watching "' + it.action + '" is failing: ' + e.message); }
                });
            }(w));
        }
    }

    //NAMED SO IT CAN BE TAKEN OFF BY ITSELF — see the note in ../io/serve.js.
    //`io` is made in ../io/main.js and outlives every reload, so unhooking it
    //with `removeAllListeners` takes everybody else's handlers with it.
    function onConnection(client) {
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
        //THE WINDOW REACHES THE SAME SURFACE THE COMMAND LINE DOES, and until
        //now it did not: this handler went straight down the pipe, so the window
        //could ask the app being ported FROM anything at all and could not ask
        //this app for its own actions. `show`, `guards`, `status` — none of them
        //were reachable from the page that is meant to be the app.
        //
        //It went unnoticed because every tab so far wants the dashboard's data
        //and nothing else. The first pane that needed a local action found it
        //immediately, with "No action called guards" on a screen whose own
        //command line could read them fine.
        //
        //`actions.call` tries this app's table and falls through to the pipe on
        //its own — the fall-through registered below — so this is the whole fix,
        //and there is still no list anywhere of which half owns what.
        //
        //AND IT IS NOT OVER THE WIRE, which matters. A call from the window is a
        //person at the window; ipc/main.js stamps `_overTheWire` on what comes
        //down the pipe, and that stamp is what lets a guard be read from
        //anywhere and set only here.
        var reach = actions ? function (n, a) { return actions.call(n, a); } : call;

        //NOTHING LEAVES CARRYING A SECRET. Every answer that crosses this
        //socket -- to the window, to okc.js, into a capture -- is scrubbed by
        //field name first; see ./scrub.js for what that means and why by
        //name. The value stays on the host for the thing that reads it in
        //process; the wire sees `[held]`.
        client.on('okc:call', function (msg, reply) {
            if (typeof reply != 'function') return;
            reach(msg && msg.action, msg && msg.args).then(
                function (result) { reply({ ok: true, result: scrub(result) }); },
                function (e) { reply({ ok: false, error: e.message }); }
            );
        });

        //---- AND ASKING TO BE TOLD RATHER THAN ASKING AGAIN -----------------
        //
        //THE PAGE USED TO OWN FORTY TIMERS. Every pane polled on its own
        //cadence, and with every tab open that was nearly three hundred calls a
        //minute, almost all of them answering that nothing had happened — and
        //each one handed to React, which re-rendered a board identical to the one
        //already on screen.
        //
        //THE TIMER MOVES HERE AND THE WIRE GOES QUIET. A pane says what it wants
        //and how often it would like to know; this asks on that cadence and
        //sends something back only when the answer is not the one the pane
        //already has. A tab open on an unchanging board now costs nothing across
        //the socket at all.
        //
        //THE PANE HANDS OVER THE FINGERPRINT OF WHAT IT ALREADY READ, so the
        //first check is silent. Without that every mount would get one pointless
        //update for an answer it had just fetched itself.
        watchers.set(client.id, client);

        client.on('okc:watch', function (msg, reply) {
            try {
                var w = watches.add(client.id, msg || {});
                if (typeof reply == 'function') reply({ ok: true, everyMs: w.everyMs });
            } catch (e) {
                if (typeof reply == 'function') reply({ ok: false, error: e.message });
            }
        });

        client.on('okc:unwatch', function (msg) {
            watches.drop(client.id, (msg && msg.id));
        });

        //A PAGE THAT GOES AWAY TAKES ITS WATCHES WITH IT. This one reloads on
        //every hot update, so sockets come and go constantly — a registry that
        //leaked them would leave this polling on behalf of pages closed hours
        //ago, with nothing on screen to say so.
        client.on('disconnect', function () {
            watchers.delete(client.id);
            var gone = watches.dropAll(client.id);
            if (gone) log.info('a window went away, and ' + gone + ' watch(es) went with it');
        });
    }

    io.on('connection', onConnection);

    //STARTED HERE AND STOPPED IN `onDestroy`, like the socket below it. This half
    //is rebuilt on every save, and an interval left behind by the old copy would
    //go on polling actions on behalf of watches that live in a registry nothing
    //can reach any more.
    beat = setInterval(sweep, BEAT);
    //SO A WATCH NEVER HOLDS THE PROCESS OPEN.
    if (beat.unref) beat.unref();

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
    //AND WHAT IS DOWN THERE, BY NAME. A fallback answers a name and cannot
    //enumerate; this is the other half of the same relay, so the API pane can
    //say what the app can actually do rather than what this half has got to.
    //Asked at the moment somebody looks, not cached: the far side is restarted
    //constantly while its own code is worked on, and a cached table would
    //describe the version before the last restart.
    //---- AND WHETHER ANY OF THE WATCHING IS ACTUALLY SAVING ANYTHING -------
    //
    //A WATCH THAT SENDS EVERY TIME IS THE POLLING IT REPLACED, with the server
    //now paying for the timer as well — and from the outside it is completely
    //indistinguishable from one working perfectly. Same panes, same data, same
    //feel. The only thing that says which it is doing is the gap between how
    //often it looked and how often it had anything to say.
    //
    //THE SAME ARGUMENT AS THE RATE LIMIT IN ../../github. A claim about work not
    //being done needs a number, or it is a comment.
    //
    //`checks` MUCH LARGER THAN `sent` IS THIS WORKING. `checks` equal to `sent`
    //is a watch on an action whose answer is never the same twice — a timestamp
    //in it, most likely — which is worth finding, because that pane is paying
    //full price and quietly.
    var unwatching = actions ? actions.define('watching', {
        about: 'What the open windows are being kept up to date on, and how often there was anything to say',
        run: async function () {
            var rows = watches.about();
            var checks = rows.reduce(function (n, r) { return n + r.checks; }, 0);
            var sent = rows.reduce(function (n, r) { return n + r.sent; }, 0);
            return {
                watching: rows,
                windows: watchers.size,
                checks: checks,
                sent: sent,
                note: rows.length
                    ? rows.length + ' watch(es) from ' + watchers.size + ' window(s). Looked ' + checks
                        + ' time(s), had something to say ' + sent + ' time(s)'
                        + (checks && sent === checks ? ' — which is every time, so nothing is being saved here.' : '.')
                    : 'No window is watching anything. Either none is open, or every pane on screen asked once and is done.'
            };
        }
    }) : function () {};

    var uncatalogue = actions ? actions.catalogue(async function () {
        if (!sock) throw new Error('the dashboard this relays to is not running, so its actions are not listed');
        var got = await call('actions', {});
        return { where: 'okc-dashboard', list: (got && got.actions) || [] };
    }) : function () {};

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
            //SAID ON THE WAY OUT, SO THE NEXT "connected" IS NOT A MYSTERY.
            //
            //Each reload builds a fresh copy of this half, and `said` starts
            //false in it — so the log fills with "connected to the dashboard"
            //with nothing between the entries, and reads exactly like a dashboard
            //dropping in and out. It was not: this end was rebuilt. Three of them
            //in a row was the first thing the new command-line view showed.
            if (said) log.info('the relay is going down with a reload of this half');
            closing = true;
            if (beat) { clearInterval(beat); beat = null; }
            watchers.clear();
            unfallback();
            uncatalogue();
            unwatching();
            drop('the server half is reloading');
            io.off('connection', onConnection);
            if (sock) { try { sock.destroy(); } catch (e) { /* already gone */ } }
            sock = null;
        }
    });
}
module.exports = plugin;
