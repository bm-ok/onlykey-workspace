var fs = require('fs');
var os = require('os');
var path = require('path');

//---------------------------------------------------------------------------
//SO A MACHINE CAN BE REACHED BY NAME.
//
//VS CODE IS WHY THIS EXISTS. A shell can be told which key to use with `-i`, but
//VS Code Remote runs plain `ssh user@host` and takes everything else from ssh's
//own configuration — so a key that is not in a config file is a key VS Code will
//never offer, and "open it in the editor" falls back to whatever the operator's
//default identity happens to be. Which is the key ./ssh-key.js exists to stop
//using.
//
//SO THE MACHINES GET A CONFIG OF THEIR OWN, and the operator's `~/.ssh/config`
//gets one `Include` line pointing at it. That is the conventional way to add
//hosts without editing somebody's file every time one changes: their config
//keeps whatever is in it, and everything this app manages stays in one file it
//can rewrite wholesale.
//---------------------------------------------------------------------------

//BACKSLASHES ARE ESCAPES IN AN SSH CONFIG VALUE, not separators — on Windows
//too, where ssh reads this same file.
function slashes(p) {
    return String(p).split(String.fromCharCode(92)).join('/');
}

//THE SAME PATH, WRITTEN THE WAY AN MSYS BUILD UNDERSTANDS IT. `C:/Users/x` and
//`/c/Users/x` are the same file and neither program accepts the other's
//spelling.
function msys(p) {
    return slashes(p).replace(/^([A-Za-z]):/, function (_, d) { return '/' + d.toLowerCase(); });
}

//AN ALIAS PER MACHINE, so `ssh okc-runner1` works from anywhere and an editor
//can be pointed at a NAME rather than at a user and an address it would have to
//be told about separately.
function aliasFor(name) {
    return 'okc-' + String(name).replace(/[^A-Za-z0-9._-]/g, '-');
}

module.exports = function sshConfig(deps) {
    var d = deps || {};

    var dirOf = d.dirOf;              //where this app keeps its own files
    var keyFile = d.keyFile;          //() -> the private key's path
    var publicKey = d.publicKey;      //() -> this app's public half, or null
    var homeOf = d.homeOf || function () { return os.homedir(); };
    var io = d.fs || fs;

    function configFile() { return path.join(dirOf(), 'ssh_config'); }
    function knownHosts() { return path.join(dirOf(), 'known_hosts'); }
    function userConfig() { return path.join(homeOf(), '.ssh', 'config'); }

    //---- WHERE A MACHINE IS, AND WHO TO LOG IN AS ------------------------
    //
    //DONE HERE, ONCE, ON WHATEVER THE REGISTER HANDS OVER.
    //
    //This started life in the action that writes the config, and there are TWO
    //callers — the action, and ../vms/provision when a machine dials in. The
    //second passed raw register rows, which have `lastAddress` and not
    //`address`, so every dial-in rewrote the file with NO HOSTS IN IT. The
    //config was correct until the moment a machine arrived, which is the moment
    //it is supposed to become correct.
    //
    //LIVE FIRST, THEN WHAT WAS LAST RECORDED. A connected machine is telling us
    //now; the record is what it said last time, and these addresses come from
    //DHCP and are reused.
    //
    //AND THE MACHINE'S OWN ANSWER FOR THE USER beats the spec, because a
    //provisioning script can make a different user than the one that was asked
    //for, and the config has to match what is actually there.
    function readingOf(vm) {
        var v = vm || {};
        var agent = v.agent || {};
        return {
            name: v.name,
            spec: v.spec,
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

    //---- WHETHER THIS APP'S KEY WOULD EVEN BE ACCEPTED -------------------
    //
    //NAMING IT UNCONDITIONALLY BREAKS EVERY MACHINE BUILT BEFORE IT EXISTED.
    //Those have somebody else's public half in their `authorized_keys`, and
    //`IdentitiesOnly yes` then guarantees that the one identity which CANNOT
    //work is the only one offered.
    //
    //So a machine built with our key gets our key and nothing else; a machine
    //built with another is left to ssh's own defaults, which is what reached it
    //before and still does.
    function isMine(vm) {
        var ours = String(publicKey() || '').trim();
        var theirs = String((vm && vm.spec && vm.spec.sshKey) || '').trim();
        return !!ours && ours === theirs;
    }

    //---- REWRITTEN WHOLE, EVERY TIME, FROM WHAT THE REGISTER KNOWS -------
    //
    //NOT APPENDED TO. A machine's address changes, machines are deleted, and a
    //file that only ever grows accumulates entries pointing at nothing — which
    //fail slowly and confusingly rather than not existing at all.
    function write(machines) {
        io.mkdirSync(dirOf(), { recursive: true });

        var lines = [
            '# Written by the dashboard. Edits here are lost: it is rewritten whenever a',
            '# machine dials in or is deleted. Anything of your own belongs in ~/.ssh/config.',
            ''
        ];

        (machines || []).map(readingOf).forEach(function (m) {
            //NO ADDRESS IS NOT AN ENTRY. A Host block with no HostName resolves
            //to the alias itself and fails with "could not resolve hostname",
            //which reads as the machine being broken rather than as this app
            //never having heard where it is.
            if (!m || !m.address || !m.user) return;

            lines.push('Host ' + aliasFor(m.name));
            lines.push('  HostName ' + m.address);
            lines.push('  User ' + m.user);

            if (isMine(m)) {
                lines.push('  IdentityFile ' + slashes(keyFile()));
                lines.push('  IdentitiesOnly yes');
            }

            //THESE MACHINES ARE MADE AND DESTROYED CONSTANTLY and their
            //addresses are REUSED, so a changed host key is expected rather than
            //alarming. Kept out of the operator's own known_hosts for the same
            //reason: this app's churn is not theirs to inherit.
            lines.push('  StrictHostKeyChecking no');
            lines.push('  UserKnownHostsFile ' + slashes(knownHosts()));
            lines.push('');
        });

        io.writeFileSync(configFile(), lines.join('\n'));
        return configFile();
    }

    //---- TWO SPELLINGS OF ONE PATH ---------------------------------------
    //
    //BECAUSE THERE ARE TWO DIFFERENT `ssh` PROGRAMS ON A WINDOWS MACHINE AND
    //THEY DO NOT READ THE SAME STRING.
    //
    //Windows OpenSSH — the one VS Code Remote runs — wants `C:/Users/...`. The
    //`ssh` that comes with git is an MSYS build, and to it that is a RELATIVE
    //path: it looks for a file called `C:` inside `~/.ssh`, does not find one,
    //and CARRIES ON WITHOUT SAYING ANYTHING, because a missing include is not an
    //error in either program. So the alias simply is not there, and
    //`ssh okc-runner2` answers "could not resolve hostname" as though the
    //machine were the problem.
    //
    //Writing both costs nothing: each program reads the spelling it understands
    //and silently ignores the other — the same silence that caused the bug, used
    //deliberately this time.
    function includeLines() {
        var win = slashes(configFile());
        var nix = msys(configFile());
        return win === nix ? ['Include "' + win + '"'] : ['Include "' + win + '"', 'Include "' + nix + '"'];
    }

    //---- THE OPERATOR'S CONFIG, GIVEN THE LINES IT IS MISSING -------------
    //
    //`Include` HAS TO COME BEFORE ANY `Host` BLOCK to apply to everything, which
    //is why it goes at the top. This is the ONLY edit this app ever makes to a
    //file it does not own, and it is idempotent.
    //
    //EACH LINE IS CHECKED SEPARATELY, so a config written before this knew about
    //the second spelling is repaired rather than left half-working.
    function ensureInclude() {
        var user = userConfig();
        var current = '';
        try { current = io.readFileSync(user, 'utf8'); } catch (e) { /* first time */ }

        var missing = includeLines().filter(function (l) { return current.indexOf(l) < 0; });
        if (!missing.length) return { added: false, file: user, lines: [] };

        io.mkdirSync(path.dirname(user), { recursive: true });
        io.writeFileSync(user,
            '# Added by the dashboard, so its machines can be reached by name.\n'
            + missing.join('\n') + '\n\n' + current);

        return { added: true, file: user, lines: missing };
    }

    //WHAT THE PANE SHOWS. Names and paths, never a key.
    function state(machines) {
        var rows = (machines || []).map(readingOf).filter(function (m) { return m.address && m.user; });
        return {
            file: configFile(),
            include: userConfig(),
            lines: includeLines(),
            hosts: rows.map(function (m) {
                return {
                    name: m.name,
                    alias: aliasFor(m.name),
                    address: m.address,
                    user: m.user,
                    //SAID PER MACHINE, because "why does this one not take the
                    //app's key" is the question this answers.
                    usesOurKey: isMine(m)
                };
            })
        };
    }

    return {
        write: write,
        ensureInclude: ensureInclude,
        includeLines: includeLines,
        state: state,
        isMine: isMine,
        where: { config: configFile, knownHosts: knownHosts, userConfig: userConfig }
    };
};

module.exports.aliasFor = aliasFor;
module.exports.slashes = slashes;
module.exports.msys = msys;
