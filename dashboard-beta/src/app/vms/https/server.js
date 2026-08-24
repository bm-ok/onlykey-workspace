var https = require('https');
var http = require('http');

var makeRegistry = require('./registry');
var makeAsking = require('./asking');

//---------------------------------------------------------------------------
//HOW A MACHINE REACHES THIS HOST.
//
//../../core/http is the WINDOW'S server: localhost, no certificate, no
//credential, and it exists to hand a page to the person sitting here. A machine
//needs something with an entirely different trust model, and this is it.
//
//THREE LISTENERS, ONE TRUST MODEL:
//
//  https       everything a machine does. Our certificate, and `vm:token`
//              basic auth resolved against ../ours.
//  the CA port PLAIN HTTP, and only `/ca.pem`. That is not an oversight — see
//              below.
//  the channel the TCP socket a machine dials and holds open. ../channel owns
//              it; this plugin is what starts it, because starting it needs the
//              register and the register cannot depend on the channel.
//
//---- what this plugin knows about, which is nothing ------------------------
//
//IT OWNS THE TRANSPORT AND NOT ONE VERB. The certificate, the ports, and turning
//`vm:token` into a machine record. What a machine may ASK for is registered by
//the plugin that owns the work — see ./registry.js — the same way a pane is
//registered with ../../ui/shell and a job with ../../core/cron.
//
//That is not tidiness. The app being ported from had every rule about who may
//reach what in one long if-chain in a file that belonged to nobody, and adding a
//verb meant editing it.
//
//---- why the CA is served in the clear -------------------------------------
//
//A MACHINE BEING INSTALLED HOLDS NOTHING. No certificate, no authority, nothing
//to check anything against — so it cannot make an https request that means
//anything, and serving the authority over https would be asking it to trust the
//thing it is trying to obtain.
//
//SO THE AUTHORITY GOES OVER PLAIN HTTP AND IS CHECKED BY FINGERPRINT, and the
//fingerprint travels by a route nothing on the network can touch: the installer
//command line. See ../provision/bootstrap.js, which refuses to build a line that
//would fetch anything carrying a secret before that check has passed.
//
//NOTHING ELSE IS ON THAT PORT. Not a health check, not a redirect, not a 404
//that says what else exists.
//---------------------------------------------------------------------------

//---- THE PORTS A MACHINE THIS APP BUILDS WILL DIAL --------------------------
//
//BAKED INTO A MACHINE AT BUILD TIME — see ../provision/header.js — so changing
//one does not move a machine that already exists. It changes what the NEXT one
//is told, and strands every machine built before it.
//
//WHICH IS WHY THEY WERE CHANGED NOW AND MUST NOT BE AGAIN. This app has built no
//machines yet: its register was empty, so there is nothing that believes the old
//numbers. That window closes with the first `vmInstall`.
//
//THE THREE THEY REPLACED WERE EACH WRONG, AND EACH SILENTLY:
//
//  7317  was ALSO ../../core/http's — the window's own server. So `vmDispatch`
//        baked `https://<lan address>:7317` into every guest, pointing at a
//        PLAIN HTTP server, bound to [::1] only, that serves the window. Three
//        ways wrong at once and none of them observable from here, because
//        nothing bound the HTTPS side to fail on.
//  7318  the CA port, unbound, and one off from a number already in use.
//  7374  the CHANNEL port of the app being ported from, which is listening on
//        0.0.0.0 right now. Nothing collided only because this app never called
//        `listen`. The moment it did, either the bind fails or a machine dialling
//        home reaches the OTHER dashboard — and that machine would look, from
//        here, exactly like one that never came up.
//
//7383-7385 ARE CLEAR OF BOTH APPS. The app being ported from holds 7373, 7374
//and 7375; this app's window holds 7317. Checked against what was actually
//listening rather than against what was assumed.
var PORT = 7383;
var CA_PORT = 7384;
var CHANNEL_PORT = 7385;

plugin.consumes = ['app', 'log', 'tls', 'ours', 'channel'];
plugin.provides = ['guestApi'];
async function plugin(imports, register) {
    var host = imports.app.host;
    var log = imports.log.on('https');
    var ours = imports.ours;
    var registry = makeRegistry({ say: imports.log.on });

    var servers = [];

    //---- who is asking -----------------------------------------------------
    //
    //`vm:token` AS BASIC AUTH, resolved against the register. A machine proves it
    //is itself with the secret it was built with, and ../ours is the only thing
    //that knows which secret belongs to which name.
    //
    //THE SAME REFUSAL FOR EVERY REASON. No such machine, wrong token, or a
    //machine that may not reach this verb all answer 401 with the same words:
    //anything more tells whatever reached this port what would have got in.
    var asking = makeAsking({ ours: ours });

    //`quiet` IS FOR THE ONE REFUSAL THAT IS NOT A FAULT.
    //
    //GIT ASKS ONCE WITH NO CREDENTIALS AND EXPECTS TO BE CHALLENGED. That is the
    //handshake, and every ordinary clone does it — so warning about it puts a
    //line that reads as a fault in front of the operator on every single clone,
    //twice, in the middle of the log they are reading to find the real one.
    //
    //ONLY CREDENTIALS THAT WERE OFFERED AND REFUSED ARE WORTH SAYING ANYTHING
    //ABOUT. Somebody presenting a name and token this host does not know is a
    //fact worth having; somebody presenting nothing is git saying hello.
    //
    //THE RESPONSE IS IDENTICAL EITHER WAY. This is about what the log says, not
    //about what the caller is told — the 401 and its `www-authenticate` are what
    //make the handshake work at all.
    function refuse(res, why, name, quiet) {
        if (!quiet) log.warn('refused ' + (name ? '"' + name + '"' : 'a caller') + ': ' + why);
        res.writeHead(401, {
            'content-type': 'application/json',
            //NAMED, so a machine's curl gets a sensible prompt rather than a
            //browser dialog nobody is sitting in front of.
            'www-authenticate': 'Basic realm="okc"'
        });
        res.end(JSON.stringify({ error: 'This host does not answer to that.' }));
    }

    //---- and what it asked for ---------------------------------------------
    async function answer(req, res) {
        var url = new URL(req.url, 'https://this-host');
        var hit = registry.match(req.method, url.pathname);

        //NOT FOUND AND NOT ALLOWED ARE THE SAME ANSWER, on purpose. A machine
        //that can tell them apart can map this host by asking.
        //
        //EITHER PROOF WILL DO — a token, or an install ticket for the machine
        //named in the query. See `guestAsking`: a machine being built has no
        //token yet, because the script it is fetching is where its token comes
        //from.
        var vm = asking.whoIsAsking(req.headers, url.searchParams);
        //SILENT WHEN NOTHING WAS OFFERED — see `refuse`. A request with no
        //`authorization` header at all is git's opening move, not an intruder.
        if (!vm) {
            return refuse(res, 'it did not prove which machine it is', null,
                !req.headers.authorization);
        }
        if (!registry.allowed(hit, vm)) {
            //---- THE SAME 401, AND TWO DIFFERENT LOG LINES ------------------
            //
            //The ANSWER stays identical on purpose — a machine that can tell
            //"there is no such route" from "you may not have this one" can map
            //this host by asking. That rule is about the response and nothing
            //else.
            //
            //THE LOG IS THE OPERATOR'S SIDE and was obeying a rule it was not
            //under. One sentence covered both, so a newly registered API that
            //was not matching looked exactly like one that was refusing — and
            //the file to open is a different file in each case. Cost an hour on
            //the git door: the route was registered, `guestApis` listed it, and
            //the message said "is not something it may ask for", which reads as
            //a decision that something took.
            refuse(res, req.method + ' ' + url.pathname + (hit
                ? ' — ' + hit.api.name + ' does not let this machine in'
                : ' — nothing serves that at all'), vm.name);
            return;
        }

        try {
            var out = await hit.route.run({ vm: vm, url: url, req: req, res: res, name: vm.name });

            //A ROUTE THAT ANSWERED FOR ITSELF is finished — streaming a git
            //response or a script is its own business, and writing a second time
            //here would corrupt it.
            if (res.headersSent || res.writableEnded) return;

            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(out === undefined ? { ok: true } : out));
        } catch (e) {
            log.on(vm.name).bad(req.method + ' ' + url.pathname + ' failed: ' + e.message);
            if (res.headersSent || res.writableEnded) return;
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: String(e.message || e) }));
        }
    }

    //---- starting them -----------------------------------------------------
    //
    //ASKED FOR RATHER THAN DONE AT LOAD. Opening a port a machine dials is an
    //act, and the app being ported from currently holds all three — so this
    //REPORTS that rather than failing to start, which would take the whole
    //server graph down over a port.
    async function listen(opts) {
        var o = opts || {};
        var out = { https: null, ca: null, channel: null, refused: [] };

        var creds = imports.tls.ensure();

        out.https = await open('https', Number(o.port || PORT), function () {
            return https.createServer({ key: creds.key, cert: creds.cert }, function (req, res) {
                answer(req, res);
            });
        }, out.refused);

        //ONLY `/ca.pem`, AND ONLY GET. Everything else on this port is a 404
        //with nothing in it — a machine with no authority is the only thing that
        //should ever be here, and it wants exactly one file.
        out.ca = await open('ca', Number(o.caPort || CA_PORT), function () {
            return http.createServer(function (req, res) {
                if (req.method !== 'GET' || req.url.split('?')[0] !== '/ca.pem') {
                    res.writeHead(404).end();
                    return;
                }
                res.writeHead(200, { 'content-type': 'application/x-pem-file' });
                res.end(creds.ca);
            });
        }, out.refused);

        //AND THE CHANNEL, which ../channel owns and this starts. `tokenFor` and
        //`onHello` come from here because the channel deliberately knows nothing
        //about the register — see its header — and the register cannot depend on
        //the channel without the two becoming a cycle.
        try {
            out.channel = await imports.channel.listen({
                port: Number(o.channelPort || CHANNEL_PORT),
                tokenFor: function (name) {
                    return ours.has(name) ? ((ours.get(name).spec || {}).token || null) : null;
                },
                //WHAT HAPPENS WHEN ONE DIALS IN ARRIVES HERE, from whoever
                //called listen(). This plugin does not consume ../provision to
                //get it, and that is not a style choice: ../provision consumes
                //THIS to register its verbs, so reaching back for it would be a
                //cycle and the graph would not build at all.
                //
                //../channel documents the same rule pointing the same way, and
                //this is the second half of it: the transport knows who is
                //asking, and nothing about what anybody wants done about it.
                onHello: typeof o.onHello === 'function' ? o.onHello : function () {}
            });
        } catch (e) {
            out.refused.push({ what: 'channel', port: Number(o.channelPort || CHANNEL_PORT), why: e.message });
        }

        return out;
    }

    function open(what, port, make, refused) {
        //WHETHER THESE PORTS HAVE EVER BEEN OURS in this process — see the
        //refusal below, which says a different thing depending on the answer.
        var bound = !!(host && host.guestPortsHaveBound);

        return new Promise(function (done) {
            var server;
            try { server = make(); } catch (e) {
                refused.push({ what: what, port: port, why: e.message });
                return done(null);
            }

            server.on('error', function (e) {
                //A PORT THAT IS TAKEN IS SAID PLAINLY RATHER THAN THROWN,
                //because a machine-facing port being held must not stop the
                //window from working.
                //
                //AND IT SAYS WHICH OF THE TWO CAUSES IT IS, because it used to
                //name only one and that one is impossible on a reload. "The app
                //being ported from is probably still running" is a good guess
                //the FIRST time this process binds, and on any later attempt it
                //sends whoever reads it to the wrong process list — which cost
                //an hour: the port was held by THIS app's previous server half,
                //inside this very process, and the message pointed at the other
                //app entirely.
                //
                //`bound` IS SET THE FIRST TIME ANYTHING LISTENS, so this is
                //"have we ever had these ports" rather than "is this a reload",
                //which is the same question from the side that can answer it.
                refused.push({
                    what: what, port: port,
                    why: e.code !== 'EADDRINUSE' ? e.message
                        : bound
                            ? 'port ' + port + ' is still held by this app\'s previous server half — it '
                              + 'did not let go before this one tried to bind, so a machine dialling in '
                              + 'is being served by a graph nothing here can reach. Restart the app; '
                              + 'reloading again will not clear it'
                            : 'port ' + port + ' is already held — the app being ported from is probably '
                              + 'still running, and a machine dials whichever app holds it'
                });
                done(null);
            });

            server.listen(port, '0.0.0.0', function () {
                log.good(what + ' is listening on ' + port);
                servers.push(server);
                //ON THE HOST, NOT IN THIS MODULE. The node bundle is rebuilt on
                //every save, so a flag here would be false again on the reload
                //that most needs it — which is the one where the diagnosis above
                //has to change. The host is the thing that does not reload.
                if (host) host.guestPortsHaveBound = true;
                done(port);
            });
        });
    }

    //---- AND WHAT A MACHINE MAY REACH, VISIBLE FROM OUTSIDE -----------------
    //
    //THE REGISTRY KNEW AND NOTHING ASKED IT. Every plugin's guest verbs were
    //registered, matched and enforced correctly, and there was no way to find
    //out what the set WAS without reading five files — which for the one surface
    //a guest can reach is the wrong thing to have to reconstruct.
    //
    //The app being ported from could not answer this at all: its rules lived in
    //one long if-chain and the answer was "read server.js". The registry exists
    //precisely so the answer is a list, so the list is worth showing.
    //
    //IT NAMES THE ROUTES AND NOT THE RULE. `may` is a function and cannot be
    //printed honestly — see ./registry.js, where the refusal is deliberately
    //uninformative for the same reason a machine is not told what it is not.
    var undo = [];
    if (host && host.actions) {
        undo.push(host.actions.define('guestApis', {
            about: 'What a machine can reach on this host, and which plugin offers it',
            run: function () { return { apis: registry.list() }; }
        }));
    }

    //---- AND IT IS AWAITED, WHICH IT WAS NOT --------------------------------
    //
    //`server.close()` IS ASYNCHRONOUS AND THIS RETURNED NOTHING, so rectify —
    //which does `await destructors.pop()()` — had nothing to wait for and the
    //next load bound while these were still letting go. Usually it won.
    //
    //ONCE IT LOSES, IT LOSES FOR THE LIFE OF THE PROCESS. The port stays held by
    //a server belonging to an incarnation that no longer exists, every later
    //reload fails to bind the same way, and the app carries on looking fine: the
    //DEAD listener still answers, so machines still dial in and are still
    //served — by handlers closed over a graph nobody can reach.
    //
    //WHAT THAT COSTS IS A LIE, NOT AN OUTAGE. The live roster is the new half's,
    //and nothing ever reaches it — so `channel.connected()` is false for a
    //machine that is up and talking, `vmAwait --for connected` times out on one
    //that dialled in thirty seconds ago, and the Supervisor tab says "it is
    //starting up" for ever. It was found by a wake stalling on a machine the log
    //three lines above said had dialled in.
    //
    //AND THE WARNING BLAMED THE WRONG APP. "port 7383 is already held — the app
    //being ported from is probably still running" is what it says when this
    //happens, which sent this hunt to the other app's process list. It is the
    //likelier cause when it is the FIRST bind of a run and cannot be the cause
    //on a reload, so ./asking.js says which of the two this is now.
    function close() {
        while (undo.length) undo.pop()();

        var going = servers.splice(0);
        try { imports.channel.close(); } catch (e) { /* never opened */ }

        return Promise.all(going.map(function (s) {
            return new Promise(function (done) {
                var settled = false;
                function finish() {
                    if (settled) return;
                    settled = true;
                    done();
                }

                try {
                    //A CLOSED SERVER WITH AN OPEN CONNECTION NEVER FINISHES
                    //CLOSING, and a machine's channel is open for as long as the
                    //machine is up. Without this, a reload while anything is
                    //connected waits for the guest to hang up — which it has no
                    //reason to do.
                    if (typeof s.closeAllConnections === 'function') s.closeAllConnections();
                    s.close(finish);
                } catch (e) { finish(); }

                //BOUNDED, BECAUSE A RELOAD THAT NEVER FINISHES IS WORSE THAN A
                //PORT THAT IS SLOW TO COME BACK. If something still holds it
                //after two seconds the next bind fails and SAYS SO, which is a
                //fault somebody can read rather than an app that stopped.
                var giveUp = setTimeout(finish, 2000);
                if (giveUp.unref) giveUp.unref();
            });
        }));
    }

    await register(null, {
        //THE NODE BUNDLE IS REBUILT ON EVERY SAVE, so anything listening has to
        //come down with it or the next load cannot bind.
        onDestroy: close,

        guestApi: {
            api: registry.api,
            listen: listen,
            close: close,
            list: registry.list,
            PORT: PORT, CA_PORT: CA_PORT, CHANNEL_PORT: CHANNEL_PORT
        }
    });
}
module.exports = plugin;
