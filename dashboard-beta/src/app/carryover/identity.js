var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

//---------------------------------------------------------------------------
//BRINGING THIS HOST'S IDENTITY ACROSS.
//
//A machine does not trust an APP, it trusts a CERTIFICATE AUTHORITY and an ssh
//key. Both were made by the app being ported from, and every machine on this
//host was built against them:
//
//  /etc/okc/ca.pem        the authority, pinned at install and checked by
//                         fingerprint before anything carrying a token is
//                         fetched — see ../vms/provision/bootstrap.js
//  authorized_keys        this host's ssh public key, put there by first-boot.sh
//
//SO AN APP WITH A FRESH CA IS A STRANGER TO EVERY EXISTING MACHINE. The channel
//handshake fails, ssh fails, terminals and VS Code fail — and the only fix on
//the machine's side is a reinstall. Carrying the identity is what makes this app
//the SAME HOST rather than a second one.
//
//---- what this actually copies, said plainly ------------------------------
//
//`ca.key` AND `id_okc` ARE PRIVATE KEYS. This writes a second copy of each into
//this app's data folder. That is a real act and it is why this is a separate
//`--what`, run on purpose, rather than something the machine carry-over does
//quietly on its way past.
//
//The alternative is `OKC_KEYS` pointing at the other app's folder, which makes
//no second copy and ties this app to that folder existing. Both were on the
//table; this is the one that lets the other app be deleted afterwards.
//
//---- and it will not overwrite --------------------------------------------
//
//IF THIS APP ALREADY HAS AN AUTHORITY, IT IS LEFT ALONE. An authority that has
//issued anything is one that machines may already have pinned — replacing it
//would strand exactly the machines this is meant to keep. Refused, and named, so
//somebody decides rather than discovers.
//---------------------------------------------------------------------------

//THE WHOLE IDENTITY, AND ALL OF IT MATTERS TOGETHER. A cert without its key is
//unusable; a key without its serial makes the next issued cert collide. So this
//is one act rather than six.
var FILES = [
    //THE AUTHORITY. `ca.srl` is the serial counter — without it openssl starts
    //again at 01 and the next certificate collides with one already issued.
    { name: 'ca.key', what: 'the certificate authority\'s private key', secret: true },
    { name: 'ca.pem', what: 'the certificate authority, which every machine has pinned' },
    { name: 'ca.srl', what: 'the serial counter, so the next certificate does not collide', optional: true },

    //WHAT THE HTTPS AND CHANNEL SURFACES SERVE WITH, signed by the above.
    { name: 'server.key', what: 'the private key this host serves with', secret: true },
    { name: 'server.pem', what: 'the certificate this host serves with' },

    //AND THE SSH IDENTITY, which is how a terminal and VS Code reach a machine.
    { name: 'id_okc', what: 'this host\'s ssh private key', secret: true },
    { name: 'id_okc.pub', what: 'the public half, which is in every machine\'s authorized_keys' },
    { name: 'known_hosts', what: 'the machines this host has already recognised', optional: true }
];

//WHAT MUST NOT BE THERE ALREADY. Not the whole list: a `known_hosts` this app
//has written on its own is nothing, and refusing over it would make this
//impossible to run for no reason. The authority is the one that cannot be
//replaced under a machine.
var GUARDED = ['ca.key', 'ca.pem'];

module.exports = function identity(deps) {
    var d = deps || {};
    var here = d.here;                       //this app's key directory
    var there = d.there;                     //the other app's
    var read = d.read || function (p) { return fs.readFileSync(p); };
    var write = d.write || function (p, b) { fs.writeFileSync(p, b); };
    var exists = d.exists || function (p) { try { return fs.existsSync(p); } catch (e) { return false; } };
    var makeDir = d.makeDir || function (p) { fs.mkdirSync(p, { recursive: true }); };

    function fingerprint(pem) {
        try {
            return new crypto.X509Certificate(pem).fingerprint256.replace(/:/g, '').toLowerCase();
        } catch (e) { return null; }
    }

    function carry(dry) {
        var out = { brought: [], already: [], couldNot: [], dry: !!dry, from: there, to: here };

        if (!exists(there)) {
            out.couldNot.push({ name: '(all)', why: 'there is no folder at ' + there + ' to bring anything from' });
            out.note = 'Nothing was found to bring across. Pass --from if the other app keeps its keys elsewhere.';
            return out;
        }

        //THE ONE REFUSAL. An authority this app has already got may have issued
        //certificates that machines have pinned, and replacing it strands them.
        for (var g = 0; g < GUARDED.length; g++) {
            if (exists(path.join(here, GUARDED[g]))) {
                out.couldNot.push({
                    name: GUARDED[g],
                    why: 'this app already has one. Replacing an authority strands every machine that '
                        + 'pinned it — delete it deliberately first if that is really what you want.'
                });
                out.note = 'Nothing was written: this app already has a certificate authority.';
                return out;
            }
        }

        if (!dry) makeDir(here);

        FILES.forEach(function (f) {
            var from = path.join(there, f.name);
            if (!exists(from)) {
                if (!f.optional) out.couldNot.push({ name: f.name, why: 'it is not in ' + there });
                return;
            }
            if (dry) { out.brought.push({ name: f.name, what: f.what, would: true }); return; }

            var bytes = read(from);
            write(path.join(here, f.name), bytes);
            out.brought.push({ name: f.name, what: f.what, bytes: bytes.length });
        });

        //AND IT IS THE SAME AUTHORITY AFTERWARDS, checked rather than assumed. A
        //copy that silently truncated would leave this app serving a certificate
        //no machine recognises, which is the exact failure this exists to
        //prevent — and it would not show until a machine tried to dial in.
        if (!dry && out.brought.some(function (b) { return b.name === 'ca.pem'; })) {
            var was = fingerprint(read(path.join(there, 'ca.pem')));
            var now = fingerprint(read(path.join(here, 'ca.pem')));
            if (!was || was !== now) {
                out.couldNot.push({
                    name: 'ca.pem',
                    why: 'it did not arrive intact — the copy here is not the authority it came from'
                });
            } else {
                out.fingerprint = now;
            }
        }

        out.note = (dry ? 'Nothing was written. ' : '')
            + out.brought.length + ' ' + (dry ? 'would come across' : 'came across')
            + (out.couldNot.length ? ', ' + out.couldNot.length + ' could not' : '')
            + '.'
            + (out.brought.length && !dry
                ? ' This app is now the same host as far as every machine is concerned. '
                  + 'Two of those files are PRIVATE KEYS and there is a second copy of each here now — '
                  + 'see the header of src/app/carryover/identity.js.'
                : '');

        return out;
    }

    return { carry: carry, FILES: FILES, GUARDED: GUARDED };
};

module.exports.FILES = FILES;
module.exports.GUARDED = GUARDED;
