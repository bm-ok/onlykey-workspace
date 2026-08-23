//---------------------------------------------------------------------------
//THE KEY THIS APP USES TO GET INTO THE MACHINES IT MADE.
//
//ITS OWN, NOT THE OPERATOR'S. The way in used to be whatever was in
//`~/.ssh/id_ed25519` — the human's personal key, offered by the make-a-machine
//dialog and installed into every guest's `authorized_keys`. That works, and is
//wrong for three reasons, none of which show up until they matter:
//
//  * IT IS THE SAME KEY THAT OPENS EVERYTHING ELSE that person can reach. A
//    runner is a machine that runs unattended code written by a model; putting
//    the key that opens the operator's real accounts inside it is a larger
//    statement than anybody meant to make.
//  * IT IS NOT THE APP'S TO REASON ABOUT. The app cannot say what the key
//    protects, when it was made, or whether it should be rotated, because it
//    belongs to somebody else.
//  * IT DISAPPEARS. A key in a home directory is absent on another account, on
//    a rebuilt workstation, or anywhere this app runs and that profile is not
//    loaded.
//
//SO IT MAKES AND KEEPS ONE OF ITS OWN, beside the TLS material and for the same
//reasons. The two are the same kind of thing: a credential this app needs in
//order to BE ITSELF, which nothing else should have to provide. ../core/tls is
//the other half of that pair, and ../vms asks this plugin for both rather than
//reading either off a disk.
//
//---- kept as a file, unsealed, and that is deliberate ----------------------
//
//`ssh` READS A PRIVATE KEY FROM DISK. Anything encrypted at rest would have to
//be decrypted to a file before use, which is the same exposure with more steps
//and a temporary copy nobody cleans up. It sits in the app's data directory
//under the user's profile — the same protection the TLS private key has.
//Exactly as strong, and worth being honest that this is not more.
//---------------------------------------------------------------------------

var fs = require('fs');
var path = require('path');

//`ssh-keygen` SHIPS WITH GIT, which this app already requires — the same
//reasoning that lets ../core/tls use git's openssl rather than asking anybody to
//install one. The bare name is last, for a host where it is simply on the PATH.
var KEYGEN = [
    'C:\\Program Files\\Git\\usr\\bin\\ssh-keygen.exe',
    'C:\\Windows\\System32\\OpenSSH\\ssh-keygen.exe',
    '/usr/bin/ssh-keygen'
];

module.exports = function sshKey(deps) {
    var d = deps || {};

    var dirOf = d.dirOf;                 //() -> where the key lives
    var run = d.run;                     //(exe, args) -> stdout
    var io = d.fs || fs;

    function isFile(p) {
        try { return io.statSync(p).isFile(); } catch (e) { return false; }
    }

    function keygen() {
        for (var i = 0; i < KEYGEN.length; i++) if (isFile(KEYGEN[i])) return KEYGEN[i];
        return 'ssh-keygen';
    }

    function keyFile() { return path.join(dirOf(), 'id_okc'); }
    function pubFile() { return path.join(dirOf(), 'id_okc.pub'); }

    function have() { return isFile(keyFile()) && isFile(pubFile()); }

    function publicKey() {
        try { return io.readFileSync(pubFile(), 'utf8').trim(); } catch (e) { return null; }
    }

    //ITS FINGERPRINT, for saying "this is the key" without printing a key.
    //
    //`SHA256:xxxx... comment` — the MIDDLE field is the part a person compares,
    //and the only part worth showing.
    function fingerprint() {
        if (!have()) return null;
        try {
            var out = run(keygen(), ['-lf', pubFile()]);
            return String(out).trim().split(/\s+/)[1] || null;
        } catch (e) { return null; }
    }

    //---- MADE ONCE, AND NEVER QUIETLY REMADE -----------------------------
    //
    //A NEW KEY LOCKS OUT EVERY EXISTING MACHINE, because the old public half is
    //what is in their `authorized_keys` and nothing here can reach in to change
    //it. So `force` is a deliberate act with a stated cost, not something that
    //happens because a file was missing at an awkward moment.
    function make(opts) {
        var o = opts || {};
        io.mkdirSync(dirOf(), { recursive: true });
        if (have() && !o.force) return { made: false, path: keyFile() };

        [keyFile(), pubFile()].forEach(function (f) {
            try { io.unlinkSync(f); } catch (e) { /* was not there */ }
        });

        //ed25519: short, fast, and the default any modern sshd accepts. NO
        //PASSPHRASE, because this is used unattended — a passphrase this app
        //would have to store beside the key protects nothing.
        run(keygen(), ['-t', 'ed25519', '-N', '', '-C', 'okc-dashboard', '-f', keyFile()]);

        //Windows ignores this; on anything else it is the whole protection, and
        //ssh refuses a private key that others can read.
        try { io.chmodSync(keyFile(), 0o600); } catch (e) { /* as above */ }

        return { made: true, path: keyFile() };
    }

    function ensure(opts) {
        make(opts);
        return { key: keyFile(), pub: pubFile(), publicKey: publicKey() };
    }

    //---- WHAT THE WINDOW SHOWS -------------------------------------------
    //
    //ENOUGH TO RECOGNISE THE KEY, AND NEVER THE KEY ITSELF. The public half is
    //not a secret and is shown in full — it is what goes into a guest's
    //`authorized_keys`, and being able to compare it against what is on a
    //machine is the point. The PRIVATE half is named by path and nothing more.
    function state() {
        if (!have()) {
            return {
                ok: false,
                missing: true,
                fingerprint: null,
                publicKey: null,
                file: keyFile(),
                made: null,
                why: 'This app has no ssh key of its own yet. Machines built before one exists are '
                    + 'reachable only with whatever key was chosen when they were made.'
            };
        }

        //WHEN IT WAS MADE, off the file itself rather than kept beside it — a
        //second record of one fact is a second thing to get wrong. An unreadable
        //date is not worth an error: the key is the answer, the date is
        //decoration.
        var made = null;
        try { made = io.statSync(keyFile()).mtime.toISOString(); } catch (e) { /* decoration */ }

        return {
            ok: true,
            missing: false,
            fingerprint: fingerprint(),
            publicKey: publicKey(),
            //THE PATH, NOT THE CONTENTS. A window that shows a private key is a
            //window that ends up in a screenshot.
            file: keyFile(),
            made: made,
            why: null
        };
    }

    return {
        have: have,
        make: make,
        ensure: ensure,
        publicKey: publicKey,
        fingerprint: fingerprint,
        state: state,
        where: { key: keyFile, pub: pubFile }
    };
};

module.exports.KEYGEN = KEYGEN;
