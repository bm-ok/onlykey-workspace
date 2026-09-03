var Watching = require('./watching');
var scrub = require('./scrub').scrub;

//the node half of the okc plugin: the window's transport, and the registry of
//what each open window is watching.
//
//IT USED TO BE A RELAY AS WELL, and that was the whole reason it existed. A
//second socket ran from here to the dashboard being ported FROM, and any action
//this app had not taken over was answered by that app instead. It was the right
//shape for a spike: the old app was in daily use, two processes both driving
//VBoxManage would have been the one thing it is arranged to prevent, and the
//port could be done a pane at a time.
//
//IT IS GONE, AND THE PORT IS WHY. Every action this app uses is answered here,
//and the old app was stopped for a long while before this without anything
//noticing. What the pipe was doing by the end was making the REMAINING gaps
//invisible: a capability that lives only in the app nothing in this repository
//may write to is not a capability this app has, and an open pipe made it look
//like one.

//`actions` COMES OFF THE HOST, NOT OUT OF IMPORTS. The table is a main-side
//service and this is the server graph, which is a different plugin list — the
//two meet only through the host object build/main.js hands over. Consuming it
//by name here would simply never resolve.
plugin.consumes = ['app', 'log'];
plugin.provides = [];
async function plugin(imports, register) {
    var host = imports.app.host;
    var io = host.io;
    var actions = host.actions;

    var log = imports.log.on('okc');

    //THE SAME SURFACE A PANE REACHES THROUGH `okc:call`, and deliberately the
    //same one: a watch must answer exactly what asking would have answered, or a
    //pane is being kept up to date with a different question than the one it
    //drew.
    function reachFor(w) {
        return actions.call(w.action, w.args);
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
        var reach = function (n, a) { return actions.call(n, a); };

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

    //STARTED HERE AND STOPPED IN `onDestroy`. This half
    //is rebuilt on every save, and an interval left behind by the old copy would
    //go on polling actions on behalf of watches that live in a registry nothing
    //can reach any more.
    beat = setInterval(sweep, BEAT);
    //SO A WATCH NEVER HOLDS THE PROCESS OPEN.
    if (beat.unref) beat.unref();


    await register(null, {
        //THIS HALF RELOADS ON EVERY SAVE, so everything it started has to come
        //off with it. Without this each reload would leave another interval
        //running and another set of handlers listening, which is what the whole
        //onDestroy contract is for.
        onDestroy: function () {
            if (beat) { clearInterval(beat); beat = null; }
            watchers.clear();
            unwatching();
            io.off('connection', onConnection);
        }
    });
}
module.exports = plugin;
