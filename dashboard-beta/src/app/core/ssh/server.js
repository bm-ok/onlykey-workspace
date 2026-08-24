var fs = require('fs');
var os = require('os');
var path = require('path');
var child = require('child_process');

//---------------------------------------------------------------------------
//THE KEY THIS APP USES TO GET INTO THE MACHINES IT MADE.
//
//ITS OWN, NOT THE OPERATOR'S. The obvious way in is whatever is in
//`~/.ssh/id_ed25519` — the person's own key, offered by the make-a-machine
//dialog and installed into every guest's `authorized_keys`. That works and is
//wrong for three reasons, none of which show up until they matter:
//
//  * IT IS THE KEY THAT OPENS EVERYTHING ELSE that person can reach. A runner
//    is a machine running unattended code written by a model; putting the key
//    to their real accounts inside it is a larger statement than anybody meant
//    to make.
//  * IT IS NOT THE APP'S TO REASON ABOUT. This app cannot say what that key
//    protects, when it was made, or whether it should be rotated, because it
//    belongs to somebody else.
//  * IT DISAPPEARS. A key in a home directory is absent on another account, on
//    a rebuilt workstation, or anywhere this app runs and that profile is not
//    loaded.
//
//So this makes and keeps one of its own, beside the TLS material and for the
//same reason: a credential this app needs in order to BE itself, which nothing
//else should have to provide.
//
//KEPT AS A FILE, UNSEALED, and that is deliberate rather than an oversight.
//`ssh` reads a private key from disk; anything sealed at rest would have to be
//written out to a file before use, which is the same exposure with more steps
//and a temporary copy nobody cleans up. It sits in this app's data directory
//under the user's profile — exactly the protection the TLS private key has, and
//worth being honest that it is not more.
//
//---- and why the ssh CONFIG is in here too --------------------------------
//
//VS CODE IS WHY. A command this app runs can be told which key to use with
//`-i`, but VS Code Remote runs plain `ssh user@host` and takes everything else
//from ssh's own configuration — so a key that is not in a config file is a key
//VS Code will never offer, and "open in VS Code" quietly falls back to whatever
//the operator's default identity happens to be. Which is the key this whole file
//exists to stop using.
//
//So the two halves are one plugin: the key, and the file that makes anything
//else able to find it.
//---------------------------------------------------------------------------

//A BACKSLASH, BUILT RATHER THAN TYPED. ../../../CLAUDE.md's own section on this:
//a backslash through a shell heredoc arrives halved, and this file has been
//edited that way before. `ui/kit/kit.js` does the same for control sequences.
var BACK = String.fromCharCode(92);

function slashes(p) { return String(p).split(BACK).join('/'); }

//THE SAME PATH, THE WAY AN MSYS BUILD OF ssh UNDERSTANDS IT. `C:/Users/x` and
//`/c/Users/x` are the same file and neither program accepts the other's
//spelling.
function msys(p) {
    return slashes(p).replace(/^([A-Za-z]):/, function (_, d) { return '/' + d.toLowerCase(); });
}

//ssh-keygen SHIPS WITH GIT, which this app already requires — the same
//reasoning that lets the TLS material use git's openssl. Looked for in the
//places it actually is rather than assumed to be on PATH, because on Windows it
//usually is not.
var KEYGEN = [
    process.env.OKC_SSH_KEYGEN,
    'C:' + BACK + 'Program Files' + BACK + 'Git' + BACK + 'usr' + BACK + 'bin' + BACK + 'ssh-keygen.exe',
    'C:' + BACK + 'Windows' + BACK + 'System32' + BACK + 'OpenSSH' + BACK + 'ssh-keygen.exe',
    '/usr/bin/ssh-keygen',
    'ssh-keygen'
].filter(Boolean);

function there(p) {
    try { return fs.statSync(p).isFile(); } catch (e) { return false; }
}

plugin.consumes = ['app', 'log', 'dataDir'];
plugin.provides = ['ssh'];
async function plugin(imports, register) {
    var log = imports.log.on('ssh');
    var dataDir = imports.dataDir;

    //OVERRIDABLE, because the drills need somewhere of their own to make a key
    //without touching the one real machines are already trusting.
    //ASKED WHEN IT IS NEEDED, NOT WHEN THIS IS BUILT. ../datadir's own header
    //says every caller must resolve lazily, and this line did not: it read
    //`dataDir.path` while the plugin graph was still coming up.
    //
    //IT WAS SILENT BECAUSE THE STAND-IN WAS INCOMPLETE. With no main half
    //behind it, `dataDir.path` was `undefined` rather than a refusal, so this
    //built a plugin whose directory was undefined and whose first write threw
    //a TypeError about an argument — instead of the sentence ../datadir wrote
    //for exactly this moment. Now that the stand-in refuses down all three
    //ways in, reading it here would take the whole graph down at start-up.
    function DIR() { return process.env.OKC_KEYS || dataDir.path; }

    function keyFile() { return path.join(DIR(), 'id_okc'); }
    function pubFile() { return path.join(DIR(), 'id_okc.pub'); }
    function configFile() { return path.join(DIR(), 'ssh_config'); }
    function userConfig() { return path.join(os.homedir(), '.ssh', 'config'); }

    function keygen() {
        for (var i = 0; i < KEYGEN.length; i++) if (there(KEYGEN[i])) return KEYGEN[i];
        return 'ssh-keygen';
    }

    function have() { return there(keyFile()) && there(pubFile()); }

    //THE PUBLIC HALF, AS ONE LINE, exactly as it must appear in authorized_keys.
    function publicKey() {
        try { return fs.readFileSync(pubFile(), 'utf8').trim(); }
        catch (e) { return null; }
    }

    //ITS FINGERPRINT, for saying "this is the key" without printing a key.
    function fingerprint() {
        if (!have()) return null;
        try {
            //SHA256:xxxx… comment — the middle field is the part a person
            //compares.
            var out = child.execFileSync(keygen(), ['-lf', pubFile()],
                { encoding: 'utf8', timeout: 15000, windowsHide: true });
            return out.trim().split(/\s+/)[1] || null;
        } catch (e) { return null; }
    }

    //---- made once, and never quietly remade -------------------------------
    //
    //A NEW KEY LOCKS OUT EVERY EXISTING MACHINE, because the old public half is
    //what is in their `authorized_keys` and nothing here can reach in to change
    //it. So `force` is a deliberate act with a stated cost, never something that
    //happens because a file was missing at an awkward moment.
    function make(opts) {
        var force = !!(opts && opts.force);
        fs.mkdirSync(DIR(), { recursive: true });
        if (have() && !force) return { made: false, path: keyFile() };

        [keyFile(), pubFile()].forEach(function (f) {
            try { fs.unlinkSync(f); } catch (e) { /* was not there */ }
        });

        //ed25519: short, fast, and the default any modern sshd accepts. NO
        //PASSPHRASE, because this is used unattended — one this app would have
        //to store beside the key protects nothing.
        child.execFileSync(keygen(), ['-t', 'ed25519', '-N', '', '-C', 'okc-dashboard', '-f', keyFile()],
            { timeout: 60000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

        //Windows ignores this; on anything else it is the whole protection, and
        //ssh refuses a private key others can read.
        try { fs.chmodSync(keyFile(), 0o600); } catch (e) { /* as above */ }

        log.good(force ? 'made a new ssh key — machines built with the old one can no longer be reached'
            : 'made this app an ssh key of its own');
        return { made: true, path: keyFile() };
    }

    function ensure(opts) {
        make(opts);
        return { key: keyFile(), pub: pubFile(), publicKey: publicKey() };
    }

    //WHAT THE WINDOW SHOWS: enough to recognise the key, and never the key.
    function state() {
        if (!have()) {
            return {
                ok: false, missing: true,
                why: 'This app has no ssh key of its own yet. Machines built before one exists are reachable '
                    + 'only with whatever key was chosen when they were made.'
            };
        }
        var made = null;
        try { made = fs.statSync(keyFile()).mtime.toISOString(); }
        catch (e) { /* an unreadable date is not worth an error */ }

        return {
            ok: true, missing: false,
            fingerprint: fingerprint(),
            publicKey: publicKey(),
            //THE PATH, NOT THE CONTENTS. A window that shows a private key is a
            //window that ends up in a screenshot.
            file: keyFile(),
            made: made,
            why: null
        };
    }

    //---- how anything else finds these machines ----------------------------

    function aliasFor(name) {
        return 'okc-' + String(name).replace(/[^A-Za-z0-9._-]/g, '-');
    }

    //REWRITTEN WHOLE, EVERY TIME, from what the registry knows.
    //
    //NOT APPENDED TO: a machine's address changes, machines are deleted, and a
    //file that only ever grows accumulates entries pointing at nothing — which
    //fail slowly and confusingly rather than not existing.
    //---- WHERE A MACHINE IS, AND WHO TO LOG IN AS -------------------------
    //
    //DONE HERE, ONCE, ON WHATEVER THE REGISTER HANDS OVER.
    //
    //This used to be the CALLER'S job, and the app being ported from gets away
    //with it because exactly one action calls `writeConfig`. Here there are two
    //— the Keys pane, and ../../vms/provision when a machine dials in — and the
    //second passes raw register rows, which carry `lastAddress` and not
    //`address`. So every dial-in rewrote the file with NO HOSTS IN IT: the
    //config was correct right up until the moment a machine arrived, which is
    //the moment it is supposed to become correct.
    //
    //LIVE FIRST, THEN WHAT WAS LAST RECORDED. A connected machine is telling us
    //now; the record is what it said last time, and these addresses come from
    //DHCP and are reused.
    //
    //AND THE MACHINE'S OWN ANSWER FOR THE USER beats the spec, because a
    //provisioning script can make a different user than the one that was asked
    //for and the config has to match what is actually there.
    function readingOf(vm) {
        var v = vm || {};
        var agent = v.agent || {};
        return {
            name: v.name,
            spec: v.spec,
            mine: v.mine,
            address: v.address
                || String(agent.from || '').replace(/^::ffff:/, '').replace(/:\d+$/, '')
                || v.lastAddress
                || null,
            user: v.user
                || (agent.facts && agent.facts.user)
                || v.lastUser
                || (v.spec && v.spec.user)
                || null
        };
    }

    //WHETHER THIS APP'S KEY WOULD EVEN BE ACCEPTED, worked out here rather than
    //asked of the caller — see the `IdentityFile` note below for what naming it
    //on a machine that has never heard of it costs.
    function isMine(m) {
        if (typeof m.mine === 'boolean') return m.mine;
        var ours = String(publicKey() || '').trim();
        var theirs = String((m.spec && m.spec.sshKey) || '').trim();
        return !!ours && ours === theirs;
    }

    function writeConfig(machines) {
        fs.mkdirSync(DIR(), { recursive: true });

        var lines = [
            '# Written by the dashboard. Edits here are lost: it is rewritten whenever a',
            '# machine dials in or is deleted. Anything of your own belongs in ~/.ssh/config.',
            ''
        ];

        (machines || []).map(readingOf).forEach(function (m) {
            if (!m.address || !m.user) return;

            lines.push('Host ' + aliasFor(m.name));
            lines.push('  HostName ' + m.address);
            lines.push('  User ' + m.user);

            //THIS KEY ONLY IF THE MACHINE WOULD ACCEPT IT.
            //
            //Naming it unconditionally broke every machine built before the key
            //existed: they have somebody else's public half in their
            //authorized_keys, and `IdentitiesOnly` then guarantees the one
            //identity that cannot work is the only one offered. A machine built
            //with the operator's key is left to ssh's own defaults, which is
            //what reached it before and still does.
            //
            //FORWARD SLASHES: ssh reads this file on Windows too, and a
            //backslash in a config value is an escape character there rather
            //than a separator.
            if (isMine(m)) {
                lines.push('  IdentityFile ' + slashes(keyFile()));
                lines.push('  IdentitiesOnly yes');
            }

            //THESE MACHINES ARE MADE AND DESTROYED CONSTANTLY and their
            //addresses are reused, so a changed host key is expected rather than
            //alarming. Not written to the operator's known_hosts, for the same
            //reason.
            lines.push('  StrictHostKeyChecking no');
            lines.push('  UserKnownHostsFile ' + slashes(path.join(DIR(), 'known_hosts')));
            lines.push('');
        });

        fs.writeFileSync(configFile(), lines.join('\n'));
        return configFile();
    }

    //---- TWO SPELLINGS OF ONE PATH ----------------------------------------
    //
    //There are two different `ssh` programs on a Windows machine and they do not
    //read the same string.
    //
    //Windows OpenSSH — the one VS Code Remote runs — wants `C:/Users/…`. The
    //`ssh` that comes with git is an MSYS build, and to IT that is a RELATIVE
    //path: it looks for a file called `C:` inside `~/.ssh`, does not find one,
    //and CARRIES ON WITHOUT SAYING ANYTHING, because a missing include is not an
    //error in either program. So the alias simply is not there, and
    //`ssh okc-runner2` — which is what this app tells a person to type — answers
    //"could not resolve hostname" as though the machine were the problem.
    //
    //WRITING BOTH COSTS NOTHING: each program reads the spelling it understands
    //and silently ignores the other, which is the same silence that caused the
    //bug, used deliberately this time.
    function includeLines() {
        var win = slashes(configFile());
        var nix = msys(configFile());
        return win === nix ? ['Include "' + win + '"'] : ['Include "' + win + '"', 'Include "' + nix + '"'];
    }

    //THE OPERATOR'S CONFIG, GIVEN THE LINES IT IS MISSING.
    //
    //`Include` has to come before any `Host` block to apply to everything, which
    //is why it goes at the top. Adding it is the ONLY edit this app ever makes to
    //a file it does not own, and it is idempotent.
    //
    //EACH LINE IS CHECKED SEPARATELY, so a config written before the second
    //spelling was known about gets repaired rather than left half-working.
    function ensureInclude() {
        var user = userConfig();
        var current = '';
        try { current = fs.readFileSync(user, 'utf8'); } catch (e) { /* first time */ }

        var missing = includeLines().filter(function (l) { return current.indexOf(l) < 0; });
        if (!missing.length) return { added: false, file: user, lines: [] };

        fs.mkdirSync(path.dirname(user), { recursive: true });
        fs.writeFileSync(user, '# Added by the dashboard, so its machines can be reached by name.\n'
            + missing.join('\n') + '\n\n' + current);

        log.good('added ' + missing.length + ' Include line(s) to ' + user);
        return { added: true, file: user, lines: missing };
    }

    await register(null, {
        ssh: {
            ensure: ensure, make: make, have: have, state: state,
            publicKey: publicKey, fingerprint: fingerprint,
            writeConfig: writeConfig, ensureInclude: ensureInclude,
            includeLines: includeLines, aliasFor: aliasFor,
            //THE SAME READING THE FILE IS WRITTEN FROM, handed out so a pane can
            //say where a machine is without working it out a second time. Two
            //readings of one register is how a pane says a machine is reachable
            //while the file it is describing says nothing about it.
            readingOf: function (vm) {
                var m = readingOf(vm);
                m.alias = aliasFor(m.name);
                m.usesOurKey = isMine(m);
                return m;
            },
            //PATHS, HANDED OUT SO NOTHING GUESSES AT THEM. Never the contents.
            where: { key: keyFile, pub: pubFile, config: configFile, user: userConfig, dir: function () { return DIR(); } }
        }
    });
}
module.exports = plugin;
