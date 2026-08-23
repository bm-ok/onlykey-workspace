var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');
var child = require('child_process');

//---------------------------------------------------------------------------
//THE CERTIFICATE THIS HOST SERVES WITH, AND THE SMALL AUTHORITY THAT SIGNED IT.
//
//MADE ONCE AND KEPT. Not regenerated per start: every machine is told to trust
//this authority, so a new one each time would mean every machine losing its
//trust every time the dashboard restarts — which happens constantly while
//working on it.
//
//KEPT OUTSIDE THE REPOSITORY, in the per-user data directory. A `state/` folder
//is ignored by git, but ignored is a rule that can be changed or overridden by a
//`-f`; outside the working tree there is nothing for git to decide about.
//
//---- why this is `tls` and not `keys` -------------------------------------
//
//../../keys IS THE KEYS TAB, and it is about credentials — the Claude sign-ins
//this host holds. This is about a certificate. The app being ported from calls
//both of them keys, and its own actions had already started saying `tlsKey` and
//`tlsRegenerate` to tell them apart, which is the name winning on its own.
//
//---- two ways it stops working, and they are unrelated --------------------
//
//IT EXPIRES — a date, known in advance, a month's warning.
//
//OR THE HOST'S ADDRESS MOVES and the certificate no longer names where guests
//are told to go, which has NO date and NO warning at all.
//
//Both end with machines that cannot fetch their scripts or push their work, so
//both are answered here rather than left to be discovered as a machine failing
//for reasons of its own.
//
//AND BOTH ARE READ OFF THE CERTIFICATE, never from what we meant to put in it.
//---------------------------------------------------------------------------

var BACK = String.fromCharCode(92);

//ONE YEAR.
//
//Which means this certificate WILL expire, on a date, and that is the point at
//which every machine stops being able to fetch or push. A date nobody remembers
//choosing is the worst way for that to arrive.
var DAYS = '365';

//SAID OUT LOUD FROM HERE ON, because a month is enough time to rebuild trust on
//every machine without hurrying.
var WARN_WITHIN = 30;

//SAME PROBLEM AS VirtualBox: installed but not on PATH is normal on Windows. Git
//ships one, and git is already required, so this adds nothing that was not
//already a dependency.
var OPENSSL = [
    'openssl',
    'C:' + BACK + 'Program Files' + BACK + 'Git' + BACK + 'usr' + BACK + 'bin' + BACK + 'openssl.exe',
    'C:' + BACK + 'Program Files' + BACK + 'Git' + BACK + 'mingw64' + BACK + 'bin' + BACK + 'openssl.exe',
    '/usr/bin/openssl'
];

function there(p) {
    try { return fs.statSync(p).isFile(); } catch (e) { return false; }
}

plugin.consumes = ['app', 'log', 'dataDir'];
plugin.provides = ['tls'];
async function plugin(imports, register) {
    var host = imports.app.host;
    var log = imports.log.on('tls');
    var DIR = process.env.OKC_KEYS || imports.dataDir.path;

    function file(name) { return path.join(DIR, name); }
    function caKey() { return file('ca.key'); }
    function caPem() { return file('ca.pem'); }
    function keyFile() { return file('server.key'); }
    function pemFile() { return file('server.pem'); }

    var found = null;
    function openssl(args) {
        if (!found) {
            for (var i = 0; i < OPENSSL.length; i++) {
                try {
                    child.execFileSync(OPENSSL[i], ['version'],
                        { stdio: 'ignore', timeout: 10000, windowsHide: true });
                    found = OPENSSL[i];
                    break;
                } catch (e) { /* try the next */ }
            }
            if (!found) {
                throw new Error('openssl was not found, so a certificate cannot be made. Git ships one; '
                    + 'check that git is installed.');
            }
        }

        //STDERR IS DISCARDED ON PURPOSE. openssl narrates key generation with a
        //wall of dots and `-----` separators, none of which is an error and all
        //of which would arrive in the live log looking like one.
        return child.execFileSync(found, args, {
            encoding: 'utf8', timeout: 60000, windowsHide: true,
            stdio: ['ignore', 'pipe', 'ignore']
        });
    }

    //---- every address a guest might reach this host on --------------------
    //
    //A CERTIFICATE IS CHECKED AGAINST THE NAME THE CLIENT DIALLED, and a guest
    //dials an IP — so the IPs have to be in it.
    //
    //`subjectAltName` SPECIFICALLY, NOT THE COMMON NAME. Clients have ignored CN
    //for this purpose for years, and a CN-only certificate is the usual reason a
    //self-signed setup fails with an error that says nothing about names.
    function addresses() {
        var out = { '127.0.0.1': true, '::1': true };
        var all = os.networkInterfaces();
        Object.keys(all).forEach(function (name) {
            (all[name] || []).forEach(function (e) {
                //169.254 IS WHAT AN INTERFACE HAS WHEN IT HAS NO ADDRESS. Naming
                //one in a certificate says this host is reachable somewhere it
                //is not.
                if (e.family === 'IPv4' && e.address.indexOf('169.254') !== 0) out[e.address] = true;
            });
        });
        return Object.keys(out);
    }

    function have() {
        return there(caKey()) && there(caPem()) && there(keyFile()) && there(pemFile());
    }

    //WHAT THE CERTIFICATE ACTUALLY COVERS, read back from the certificate itself
    //rather than from what we meant to put in it.
    function covers() {
        try {
            var cert = new crypto.X509Certificate(fs.readFileSync(pemFile()));
            return String(cert.subjectAltName || '').split(',')
                .map(function (s) { return s.trim().replace(/^(IP Address|IP|DNS):/, ''); })
                .filter(Boolean);
        } catch (e) { return []; }
    }

    //EVERYTHING THAT DECIDES WHETHER THIS IS STILL ANY USE. See the header for
    //the two unrelated ways it stops working.
    function state(address) {
        if (!have()) return { ok: false, missing: true };

        var cert;
        try { cert = new crypto.X509Certificate(fs.readFileSync(pemFile())); }
        catch (e) { return { ok: false, unreadable: true }; }

        var validTo = new Date(cert.validTo);
        var daysLeft = Math.floor((validTo - Date.now()) / 86400000);
        var named = covers();
        var matches = !address || named.indexOf(address) >= 0;

        return {
            ok: matches && daysLeft > 0,
            covers: named,
            address: address || null,
            matches: matches,
            validTo: validTo.toISOString(),
            daysLeft: daysLeft,
            expired: daysLeft <= 0,
            expiringSoon: daysLeft > 0 && daysLeft <= WARN_WITHIN,

            //SAID IN FULL HERE so every place that reports it says the same
            //thing. The address one comes first because it has no warning.
            why: !matches
                ? 'The certificate does not cover ' + address + '. It names '
                    + (named.join(', ') || 'nothing') + ' — this host\'s address has moved since it was made, '
                    + 'so machines cannot verify it. Make a new one.'
                : daysLeft <= 0
                    ? 'The certificate expired on ' + validTo.toDateString() + '. Machines cannot fetch their '
                        + 'scripts or push their work until a new one is made.'
                    : daysLeft <= WARN_WITHIN
                        ? 'The certificate expires in ' + daysLeft + ' day' + (daysLeft === 1 ? '' : 's')
                            + ', on ' + validTo.toDateString() + '. Making a new one means every machine has to '
                            + 'be set up again, so it is worth doing before it stops.'
                        : null
        };
    }

    function matches(address) { return state(address).matches; }

    function make() {
        fs.mkdirSync(DIR, { recursive: true });
        var names = addresses();

        //THE AUTHORITY. Only ever signs this one certificate, and its private
        //key never leaves this directory — what a machine is given is the
        //certificate, which is public by design.
        openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
            '-keyout', caKey(), '-out', caPem(), '-days', DAYS,
            '-subj', '/CN=okc-dashboard local authority',
            '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
            '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);

        var csr = file('server.csr');
        var ext = file('server.ext');

        openssl(['req', '-newkey', 'rsa:2048', '-nodes',
            '-keyout', keyFile(), '-out', csr, '-subj', '/CN=okc-dashboard']);

        fs.writeFileSync(ext, [
            'basicConstraints=CA:FALSE',
            'keyUsage=critical,digitalSignature,keyEncipherment',
            'extendedKeyUsage=serverAuth',
            'subjectAltName=' + ['DNS:localhost'].concat(names.map(function (n) { return 'IP:' + n; })).join(',')
        ].join('\n') + '\n');

        openssl(['x509', '-req', '-in', csr, '-CA', caPem(), '-CAkey', caKey(),
            '-CAcreateserial', '-out', pemFile(), '-days', DAYS, '-extfile', ext]);

        try { fs.unlinkSync(csr); fs.unlinkSync(ext); } catch (e) { /* tidiness only */ }
        [caKey(), keyFile()].forEach(function (p) {
            try { fs.chmodSync(p, 0o600); } catch (e) { /* best effort on Windows */ }
        });

        log.good('made a certificate covering ' + names.join(', '));
        return names;
    }

    //THE CERTIFICATE AND KEY TO SERVE WITH, making them first if there are none.
    //
    //`force` IS THE WAY OUT of the one thing a long-lived certificate cannot
    //survive: the host's address changing. NOTHING REGENERATES ON ITS OWN,
    //because doing so silently would break every machine's trust without anybody
    //asking for it — it is offered, and reported, and left as a decision.
    function ensure(opts) {
        if ((opts && opts.force) || !have()) make();
        var ca = fs.readFileSync(caPem());

        return {
            dir: DIR,
            key: fs.readFileSync(keyFile()),
            cert: fs.readFileSync(pemFile()),
            ca: ca,
            caFile: caPem(),
            covers: covers(),

            //WHAT A GUEST CHECKS THE AUTHORITY AGAINST BEFORE TRUSTING IT.
            //
            //NOT A SECRET: it is published so that fetching the authority over
            //an unprotected connection is still safe, which is what makes the
            //very first fetch on a brand-new machine possible at all.
            fingerprint: new crypto.X509Certificate(ca).fingerprint256
                .replace(/:/g, '').toLowerCase()
        };
    }

    //---- MAKING A NEW AUTHORITY, WHICH IS NOT A REPAIR ---------------------
    //
    //DEFINED HERE RATHER THAN RELAYED, AND THAT IS THE WHOLE POINT OF PORTING
    //IT NOW. While it fell through to the app being ported from, pressing
    //Regenerate in THIS app's Keys tab replaced the OTHER app's certificate —
    //instantly breaking every machine that app had built, from a button in a
    //window that had no business touching it. The same shape as `vmRemove`
    //reaching the other register, with a wider blast radius.
    //
    //IT IS NOT A FIX FOR ANYTHING. Every machine already built trusts the OLD
    //authority, checked against a fingerprint at the moment it was made, and
    //they will refuse the new one. So this is "start again with the machines",
    //said plainly in the answer rather than discovered by a machine that can no
    //longer fetch.
    var undo = [];
    if (host && host.actions) {
        //---- WHAT THIS HOST'S CERTIFICATE IS -------------------------------
        //
        //THIS RELAYED, AND THAT WAS ACTIVELY DANGEROUS RATHER THAN MERELY
        //INCOMPLETE. The Keys → HTTPS pane published
        //`bd6ab7bc4e56ed…` — the authority of the app being ported from — while
        //every machine THIS app builds checks `04e1f04d…`. A person reading that
        //pane to verify a machine would have been comparing against an authority
        //none of their machines has ever heard of, and the numbers are long
        //enough that nobody notices they are the wrong ones.
        //
        //THE FINGERPRINT IS THE ONE NUMBER SOMEBODY MAY ACTUALLY NEED TO READ
        //OUT. A brand-new machine checks the authority against it before
        //trusting anything, over a connection that is not yet protected — see
        //../../vms/provision/bootstrap.js. Published rather than secret, for
        //exactly that reason, and the private half never leaves this host.
        undo.push(host.actions.define('tlsKey', {
            about: "This host's certificate: what it names, when it expires, and its authority",
            run: async function () {
                //ASKED OF THE MACHINE LAYER, because "which address is this
                //host" is a question about the network this app's guests are
                //on, not about a certificate. No adapter is its own answer.
                var address = null;
                try {
                    var said = await host.actions.call('vmHostAddress', {});
                    address = (said && said.address) || null;
                } catch (e) { /* reported as `matches: true` with nothing to match */ }

                var out = state(address);

                var fingerprint = null;
                try { fingerprint = ensure().fingerprint; } catch (e) { /* missing, said above */ }

                return Object.assign({}, out, {
                    address: address,
                    fingerprint: fingerprint,
                    dir: DIR
                });
            }
        }));

        undo.push(host.actions.define('tlsRegenerate', {
            about: 'Make a new certificate for this host — every machine must then be set up again',
            run: function () {
                var made = ensure({ force: true });
                log.warn('A new certificate was made. Every machine has to be set up again before it '
                    + 'can fetch or push.');
                return {
                    covers: made.covers,
                    fingerprint: made.fingerprint,
                    dir: made.dir,
                    restart: 'restart the dashboard for it to be served'
                };
            }
        }));
    }

    await register(null, {
        onDestroy: function () { while (undo.length) undo.pop()(); },
        tls: {
            ensure: ensure, make: make, have: have,
            covers: covers, matches: matches, state: state,
            addresses: addresses,
            where: { dir: function () { return DIR; }, ca: caPem, cert: pemFile, key: keyFile }
        }
    });
}
module.exports = plugin;
