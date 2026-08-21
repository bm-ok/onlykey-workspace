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

plugin.consumes = ['app', 'log', 'tls'];
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
    var sweeper = null;

    //---- a socket ----------------------------------------------------------
    //
    //EVERYTHING INTERESTING ABOUT A CONNECTION HAPPENS AFTER IT IS ACCEPTED,
    //and none of it needs TLS to be checked — so it is ./session.js, and what
    //is left here is the three lines of node that make a server.
    function onConnection(socket) {
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

        //A MACHINE THAT STOPS ANSWERING HAS TO BE NOTICED, because TCP will not
        //do it for us. `unref` so this never holds the process open.
        if (!sweeper) {
            sweeper = setInterval(function () { roster.sweep(); }, 15000);
            if (sweeper.unref) sweeper.unref();
        }

        return new Promise(function (resolve, reject) {
            server = tls.createServer({ key: creds.key, cert: creds.cert }, onConnection);
            server.once('error', reject);
            server.listen(port, host, function () {
                log.on('channel').good('Listening on port ' + port + ' — machines dial in here, over TLS');
                resolve({ port: port });
            });
        });
    }

    function close() {
        roster.dropAll('this host is shutting down');
        if (sweeper) { clearInterval(sweeper); sweeper = null; }
        return new Promise(function (done) {
            if (!server) return done();
            server.close(function () { server = null; done(); });
        });
    }

    await register(null, {
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
