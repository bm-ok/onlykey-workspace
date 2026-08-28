var tls = require('tls');
var crypto = require('crypto');

var makeRoster = require('./roster');
var makeJobs = require('./jobs');
var makeSession = require('./session');

//---------------------------------------------------------------------------
//THE DIAL-IN CHANNEL. THIS SIDE LISTENS; THE MACHINE DIALS IN.
//
//THE INVERSION IS THE WHOLE POINT. The ephemeral side is the wrong one to own
//the socket: a machine rebooting is then an ordinary client reconnecting, and
//this side keeps the log and the live view across it. The other way round,
//every reboot is an error to handle.
//
//NEWLINE-DELIMITED JSON OVER TLS. No dependency beyond what every language
//already has, trivial to re-implement in a guest, and it survives a socket
//dying mid-line because the framing is the newline.
//
//ENCRYPTED BECAUSE THE FIRST THING A MACHINE SAYS HERE IS ITS TOKEN. This was a
//plain socket, so the secret that decides what a machine may push crossed the
//network in clear on every reconnect — and a reboot is an ordinary reconnect.
//Protecting the scripts and not this would have looked finished while moving
//the exposure rather than removing it.
//
//---- what is here ---------------------------------------------------------
//
//./framing.js — a chunk is not a message. TCP gives you bytes.
//./roster.js  — who is dialled in, and what it took to get in.
//./jobs.js    — running something and waiting for it, including `quiet`.
//./session.js — one socket, from the first byte to whatever ended it.
//
//---- and the direction, which is the thing to get right --------------------
//
//NOTHING HERE KNOWS ABOUT THE REGISTRY. `tokenFor` and `onHello` arrive as
//arguments to listen(), from whoever is wiring the two together — so ../ours
//can consume THIS for `connected` without the two plugins depending on each
//other. The old app had the same rule pointing the other way and said so; this
//is the same rule, and it is what keeps either of them checkable alone.
//---------------------------------------------------------------------------

//WHAT A MACHINE IS GIVEN TO PROVE IT IS ITSELF. 24 bytes, which is more than
//enough and short enough to paste into an install script.
function newToken() { return crypto.randomBytes(24).toString('hex'); }

plugin.consumes = ['app', 'log', 'tls', 'cron'];
plugin.provides = ['channel'];
async function plugin(imports, register) {
    var log = imports.log;

    //WHO SUPPLIES THE TOKENS ARRIVES AT listen(), NOT HERE, and the roster is
    //built once — so it asks through these rather than being handed the
    //functions. Written down because getting it wrong is silent in the worst
    //direction: a roster built with no `tokenFor` refuses every machine on the
    //host, and the message it gives is the one for a wrong token.
    var tokenFor = function () { return null; };
    var onHello = null;

    var roster = makeRoster({
        say: log.on,
        tokenFor: function (vm) { return tokenFor(vm); },
        onHello: function (vm, seen) { if (onHello) return onHello(vm, seen); },
        //TOLD BEFORE ANYTHING ELSE CAN ASK. A job waiting on a machine that has
        //gone gets an answer instead of a timeout.
        onGone: function (vm, why) { jobs.abandon(vm, why); }
    });

    var jobs = makeJobs({
        say: log.on,
        //THE ROSTER IS THE ONE PLACE THAT KNOWS WHO IS DIALLED IN. Handed in, so
        //jobs holds no sockets and the two can be checked apart.
        agentFor: function (name) { return roster.get(name); }
    });

    var server = null;

    //---- noticing a machine that stopped answering -------------------------
    //
    //TCP WILL NOT DO IT FOR US: one killed mid-sentence leaves a socket on this
    //side that looks perfectly healthy, forever. So somebody has to look.
    //
    //A CRON JOB RATHER THAN A TIMER OF ITS OWN — see ../../core/cron. It used to
    //be a `setInterval` started inside listen(), which worked and could not be
    //asked a single question: not whether it was running, not when it last swept,
    //not what it found. It runs from startup whether or not anything is listening,
    //because sweeping an empty roster is a no-op and "is the sweep running" should
    //not have a different answer before and after the first machine.
    imports.cron.add({
        name: 'channel-silence',
        every: 15000,
        autoStart: true,
        about: 'Notices a machine that has stopped answering, which TCP never will'
    });
    var stopSweeping = imports.cron.does('channel-silence', function () {
        var gone = roster.sweep();
        //WHAT IT FOUND, HANDED BACK, so the board can show a sweep that is doing
        //something rather than only that it ran.
        return gone.length ? { dropped: gone } : null;
    });

    //---- a socket ----------------------------------------------------------
    //
    //EVERYTHING INTERESTING ABOUT A CONNECTION HAPPENS AFTER IT IS ACCEPTED,
    //and none of it needs TLS to be checked — so it is ./session.js, and what
    //is left here is the three lines of node that make a server.
    //EVERY OPEN SOCKET, so close() can end them. `server.close()` only stops
    //ACCEPTING; a connection already up keeps the port bound until it ends,
    //and a guest's channel is deliberately long-lived. So on every save of this
    //half the old listener sat on 7385 with one live socket, the new half got
    //EADDRINUSE, and the events said "nothing is listening for machines". A
    //machine that dropped and dialled again could not get in until the whole
    //app was restarted -- twelve hours of "starting up, not dialled in yet".
    var open = new Set();

    function onConnection(socket) {
        open.add(socket);
        socket.once('close', function () { open.delete(socket); });
        makeSession(socket, { say: log.on, roster: roster, jobs: jobs });
    }

    //---- listening ---------------------------------------------------------

    function listen(opts) {
        var o = opts || {};
        var port = Number(o.port || process.env.OKC_CHANNEL_PORT || 7374);

        //EVERY INTERFACE, for the same reason the rest is: a machine reaches
        //this host by its network address. A guest can say nothing until it
        //proves it holds the token for the machine it claims to be.
        var host = o.host || '0.0.0.0';

        //WHO MAY DIAL IN, AND WHAT HAPPENS WHEN ONE DOES. Set before the socket
        //is open, because a machine can arrive on the first tick after it is.
        if (o.tokenFor) tokenFor = o.tokenFor;
        if (o.onHello) onHello = o.onHello;

        //THE SAME CERTIFICATE THE API SERVES WITH, and the machine checks it
        //against the authority it was given when it was built.
        var creds = imports.tls.ensure();

        return new Promise(function (resolve, reject) {
            server = tls.createServer({ key: creds.key, cert: creds.cert }, onConnection);
            server.once('error', reject);
            server.listen(port, host, function () {
                log.on('channel').good('Listening on port ' + port + ' — machines dial in here, over TLS');
                resolve({ port: port });
            });
        });
    }

    //A REASON, BECAUSE THERE ARE NOW TWO OF THEM. This is called on shutdown and
    //on every reload of this half, and a machine told "this host is shutting
    //down" by a save is being told something untrue — in the one log a person
    //reads to find out why a machine went quiet.
    function close(why) {
        roster.dropAll(why || 'this host is shutting down');
        //ENDED, NOT ONLY NO LONGER ACCEPTED. The guest reconnects on its own;
        //what it must not do is keep the old half's port from the new half.
        open.forEach(function (socket) { try { socket.destroy(); } catch (e) { /* already gone */ } });
        open.clear();
        return new Promise(function (done) {
            if (!server) return done();
            var settled = false;
            function finish() { if (settled) return; settled = true; server = null; done(); }
            server.close(finish);
            //AND NOT FOR EVER. A close that never calls back is a reload that
            //never finishes; two seconds is longer than any socket takes to go.
            var giveUp = setTimeout(finish, 2000);
            if (giveUp.unref) giveUp.unref();
        });
    }

    await register(null, {
        //---- AND THE LISTENER GOES WITH THE RELOAD --------------------------
        //
        //THIS TOOK OFF THE SWEEPER AND NOTHING ELSE. The TLS server, the
        //`connection` handler bound into it, and every agent in the roster were
        //all left behind by each reload of this half — so after N saves a
        //machine's line was being read by N parsers and every command written to
        //it N times.
        //
        //IT IS INVISIBLE UNTIL IT IS NOT, which is what makes it worth the
        //words. Nothing fails: the machine does the work, twice, and the second
        //copy collides with the first somewhere deep enough that the error names
        //something else entirely. It surfaced as one press of "Open the sign-in
        //page" starting two sign-ins, opening two browser windows, and the
        //second one failing its auth against a desk the first was already
        //holding — none of which points here.
        //
        //AND IT IS A FRESH APP'S BUG TOO, in the sense that matters: a restart
        //hides it completely, so every measurement taken early in a session is
        //right and every one taken late is quietly doubled. That is worse than a
        //bug that is always there.
        //
        //THE CONTRACT IS ALREADY WRITTEN DOWN TWICE. See ../../core/io/server.js,
        //which takes off its own `connection` handler and says why it may not use
        //`removeAllListeners`, and ../../core/okc/server.js: "each reload would
        //leave another one open and another set of handlers listening, which is
        //what the whole onDestroy contract is for". This half was the one
        //subsystem not honouring it.
        //
        //`close()` IS WHAT SHUTDOWN ALREADY CALLS, so this is not a second way to
        //stop: it drops the roster with a reason and closes the server. A reload
        //and a shutdown want exactly the same thing here.
        onDestroy: function () {
            stopSweeping();
            //THE REASON IS SAID, because a machine that goes quiet with nothing
            //explaining it is the state the sweeper above exists to notice — and
            //this one is ordinary, not a fault.
            return close('the server half is reloading');
        },
        channel: {
            listen: listen,
            close: close,

            connected: roster.connected,
            list: roster.list,
            get: roster.get,
            drop: roster.drop,

            run: jobs.run,
            waiting: jobs.waiting,

            newToken: newToken
        }
    });
}
module.exports = plugin;
module.exports.newToken = newToken;
