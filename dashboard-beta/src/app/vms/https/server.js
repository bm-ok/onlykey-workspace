var https = require('https');
var http = require('http');

var makeRegistry = require('./registry');

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
    function whoIsAsking(req) {
        var said = String(req.headers.authorization || '');
        if (said.slice(0, 6).toLowerCase() !== 'basic ') return null;

        var pair = Buffer.from(said.slice(6), 'base64').toString('utf8');
        var at = pair.indexOf(':');
        if (at < 0) return null;

        var name = pair.slice(0, at);
        var token = pair.slice(at + 1);
        if (!name || !token) return null;

        if (!ours.has(name)) return null;
        var vm = ours.get(name);
        var mine = (vm.spec || {}).token;
        if (!mine || !same(String(mine), token)) return null;

        return vm;
    }

    //CONSTANT TIME, because a comparison that returns early tells whoever is
    //asking how much of the token they got right — and a token is the whole of
    //what a machine has. ../channel/session.js compares its own the same way.
    function same(a, b) {
        if (a.length !== b.length) return false;
        var out = 0;
        for (var i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
        return out === 0;
    }

    function refuse(res, why, name) {
        log.warn('refused ' + (name ? '"' + name + '"' : 'a caller') + ': ' + why);
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
        var vm = whoIsAsking(req);
        if (!vm) return refuse(res, 'it did not prove which machine it is', null);
        if (!registry.allowed(hit, vm)) {
            return refuse(res, req.method + ' ' + url.pathname + ' is not something it may ask for', vm.name);
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
        return new Promise(function (done) {
            var server;
            try { server = make(); } catch (e) {
                refused.push({ what: what, port: port, why: e.message });
                return done(null);
            }

            server.on('error', function (e) {
                //THE PORT IS HELD BY THE APP THIS ONE IS REPLACING, which is the
                //expected answer for as long as both are running — said plainly
                //rather than thrown, because a machine-facing port being taken
                //must not stop the window from working.
                refused.push({
                    what: what, port: port,
                    why: e.code === 'EADDRINUSE'
                        ? 'port ' + port + ' is already held — the app being ported from is probably still '
                          + 'running, and a machine dials whichever app holds it'
                        : e.message
                });
                done(null);
            });

            server.listen(port, '0.0.0.0', function () {
                log.good(what + ' is listening on ' + port);
                servers.push(server);
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

    function close() {
        while (undo.length) undo.pop()();
        servers.splice(0).forEach(function (s) { try { s.close(); } catch (e) { /* already gone */ } });
        try { imports.channel.close(); } catch (e) { /* never opened */ }
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
