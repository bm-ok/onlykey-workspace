var fs = require('fs');
var path = require('path');
var cp = require('child_process');

//---------------------------------------------------------------------------
//OPENING THE WORK IN VS CODE, WHEREVER THE WORK IS.
//
//The step between "the machine is ready" and "I am editing in it". Without it a
//person has to find the machine's address, and type it more than once.
//
//EVERYTHING HERE THAT LOOKS LIKE SUPERSTITION WAS MEASURED ON A REAL
//WORKSTATION, because the obvious version of this file produces a button that
//silently does nothing:
//
//  * `code` IS FREQUENTLY NOT ON PATH AT ALL, and Insiders is a different binary
//    with a different name — `code-insiders`. Looking only for `code` finds
//    nothing on a machine that has an editor installed and working.
//
//  * NODE REFUSES TO SPAWN A `.cmd` DIRECTLY. It throws EINVAL, and throws it
//    SYNCHRONOUSLY — before any callback and before any 'error' event, so error
//    handling written the normal way never runs. That is the CVE-2024-27980
//    mitigation, and it fails before the arguments matter.
//
//  * SPAWNING SUCCESSFULLY IS NOT THE SAME AS OPENING. `cmd.exe` starts
//    perfectly well and only then reports that what it was asked to run does not
//    exist, so resolving on spawn reports success for a button that did nothing.
//
//---- what is not here -----------------------------------------------------
//
//NO `openOn`. The version this comes from had one, taking a machine out of a
//separate "machines reachable over ssh" register — a subsystem with six actions,
//no pane anywhere, and nothing live depending on it. `open` is the half the app
//actually uses, and it takes a folder and an optional far end rather than a
//record only that register knows how to make.
//---------------------------------------------------------------------------

//INSIDERS FIRST. Both are found, so nothing needs configuring either way — but
//where both are installed the preference has to be FIXED rather than incidental:
//a button that quietly changes which editor it opens the day another one is
//installed is worse than one that always picks the same and can be told
//otherwise.
var EDITORS = [
    ['Microsoft VS Code Insiders', 'code-insiders'],
    ['Microsoft VS Code', 'code']
];

var UNIX = ['/usr/bin/code', '/usr/local/bin/code', '/snap/bin/code', '/usr/bin/code-insiders'];

//A GRACE WINDOW RATHER THAN WAITING FOR EXIT. The editor outlives this call by
//design — the dashboard opened a window, it does not own it — so waiting for it
//to close would hang for ever. A launcher either fails within milliseconds or
//has genuinely started.
var GRACE_MS = 1500;

module.exports = function openEditor(deps) {
    var d = deps || {};

    var exec = d.exec || cp.execFile;
    var env = d.env || process.env;
    var platform = d.platform || process.platform;
    //THE GRACE TIMER, INJECTABLE so a test can say when it fires rather than
    //sitting through it — a second and a half per case is a slow suite, and a
    //test that waits is one that hangs when the thing never comes.
    var after = d.after || function (ms, fn) { return setTimeout(fn, ms); };
    var clear = d.clear || clearTimeout;
    var say = d.say || function () {
        var to = { good: function () {}, warn: function () {}, info: function () {}, bad: function () {}, on: function () { return to; } };
        return to;
    };

    var there = d.there || function (p) {
        try { return fs.existsSync(p); } catch (e) { return false; }
    };

    //---- where the editor actually is, and how that was decided ------------
    //
    //THE SECOND HALF MATTERS WHEN THE ANSWER IS WRONG. "Not found" is a
    //different fault from "found somewhere unexpected", and the failure message
    //below repeats it back.
    function discover(configured) {
        if (configured) {
            //A BARE NAME IS A NAME ON PATH, not a path that is missing. Somebody
            //who configured `code-insiders` meant the one on their PATH, and
            //refusing it because there is no file at that relative path would be
            //refusing the thing they asked for.
            if (!there(configured) && !/[\\/]/.test(configured)) {
                return { command: configured, from: 'configured, on PATH' };
            }
            if (!there(configured)) {
                throw new Error('The editor is set to ' + configured + ', and there is nothing there.');
            }
            return { command: configured, from: 'configured' };
        }

        var roots = [
            env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'),
            env.ProgramFiles,
            env['ProgramFiles(x86)']
        ].filter(Boolean);

        for (var i = 0; i < EDITORS.length; i++) {
            for (var r = 0; r < roots.length; r++) {
                //`.cmd` FIRST AND THEN NO EXTENSION, because the Windows install
                //puts a .cmd shim in bin/ and the bare name is what a unix-shaped
                //install leaves.
                for (var e = 0; e < 2; e++) {
                    var ext = e === 0 ? '.cmd' : '';
                    var candidate = path.join(roots[r], EDITORS[i][0], 'bin', EDITORS[i][1] + ext);
                    if (there(candidate)) return { command: candidate, from: 'found where it installs' };
                }
            }
        }

        for (var u = 0; u < UNIX.length; u++) {
            if (there(UNIX[u])) return { command: UNIX[u], from: 'found where it installs' };
        }

        //SOMEBODY MAY STILL HAVE PUT IT ON PATH under either name — and the
        //answer SAYS it is a guess, because that is what the failure message
        //needs in order to be worth reading.
        return {
            command: platform === 'win32' ? 'code.cmd' : 'code',
            from: 'guessed — not found where it installs'
        };
    }

    //---- the far end -------------------------------------------------------
    //
    //`vscode-remote://ssh-remote+<user>@<address><absolute path>`
    //
    //ONE STRING FOR THE FAR END, not a user and a host to be joined here. A
    //machine's is built from what it reported when it dialled in, so joining
    //them in this file would mean a caller producing `user@user@address`, which
    //fails as an unreachable host rather than as anything that names the
    //mistake.
    //
    //user@address RATHER THAN A NAME FROM ~/.ssh/config, because a config entry
    //is a second place the machine's address would live and it goes stale the
    //first time the address moves. This form needs nothing on the host but the
    //key, which first-boot.sh already installed.
    function folderUri(remote, dir) {
        var where = String(dir == null ? '' : dir);
        return 'vscode-remote://ssh-remote+' + encodeURIComponent(String(remote == null ? '' : remote))
            + (where.charAt(0) === '/' ? '' : '/') + where;
    }

    //---- how it is started -------------------------------------------------
    //
    //WINDOWS WILL NOT START A .cmd FROM NODE DIRECTLY; it goes through cmd.exe.
    //
    //`{ shell: true }` IS THE OTHER WAY OUT AND IS NOT USED: the editor installs
    //to a path with spaces in it, and the shell splits on them — so it would
    //need quoting done by hand, which is the thing that keeps going wrong here.
    //Through cmd.exe, node quotes each argument and no shell parses the path at
    //all.
    function launchSpec(command, args) {
        if (platform === 'win32' && /\.(cmd|bat)$/i.test(command)) {
            return { file: env.COMSPEC || 'cmd.exe', argv: ['/c', command].concat(args) };
        }
        return { file: command, argv: args };
    }

    //---- opening it --------------------------------------------------------
    //
    //ONE FOLDER, NOT A GENERATED MULTI-ROOT WORKSPACE. VS Code finds every .git
    //inside a folder and shows each repository's status, so opening the tree
    //that holds them gives all of them with no file to generate — and it means
    //the editor never needs to know what the work spans.
    function open(input) {
        var it = input || {};
        if (!it.dir) throw new Error('There is no folder to open.');

        var found = discover(it.command);
        var exe = found.command;

        var args = it.remote
            ? ['--folder-uri', folderUri(it.remote, it.dir), '--new-window']
            : [it.dir, '--new-window'];

        var spec = launchSpec(exe, args);
        var to = say.apply(null, ['editor'].concat(it.tags || []));

        var attempted = spec.file + ' ' + spec.argv.map(function (a) {
            return /\s/.test(a) ? '"' + a + '"' : a;
        }).join(' ');

        to.info('Opening ' + it.dir + (it.remote ? ' on ' + it.remote : '') + ' in VS Code');

        //AN ERRNO IS NOT SOMETHING A PERSON CAN ACT ON, and this is the button
        //where they meet the system. So a failure says WHAT WAS RUN and what
        //that particular failure usually means.
        function explain(err) {
            var why = '';
            if (err.code === 'EINVAL' && platform === 'win32') {
                why = ' — Windows will not start a .cmd directly; this should have gone through cmd.exe.';
            } else if (err.code === 'ENOENT') {
                why = ' — that was not found. The editor was ' + found.from + '.';
            }
            var said = err.detail ? '\n  it said: ' + err.detail : '';
            return new Error('Could not start the editor.\n  tried: ' + attempted
                + '\n  ' + (err.code || 'failed') + why + said);
        }

        return new Promise(function (resolve, reject) {
            var settled = false;
            function finish(fn, value) {
                if (settled) return;
                settled = true;
                fn(value);
            }

            var done = function () {
                to.good('VS Code was asked to open it.');
                finish(resolve, { opened: it.dir, on: it.remote || null, using: exe, found: found.from });
            };

            var child;
            try {
                child = exec(spec.file, spec.argv, { windowsHide: true }, function (err, stdout, stderr) {
                    if (!err || !err.code) return;
                    var detail = String(stderr || stdout || '').trim().split('\n')[0];
                    to.bad('the editor did not start: ' + (detail || err.code));
                    err.detail = detail;
                    finish(reject, explain(err));
                });
            } catch (err) {
                //THE EINVAL PATH. Thrown SYNCHRONOUSLY, so it reaches neither
                //the callback nor the 'error' event — here is the only place it
                //can become something readable.
                to.bad(err.message);
                return finish(reject, explain(err));
            }

            child.on('error', function (err) { to.bad(err.message); finish(reject, explain(err)); });

            var grace = after(GRACE_MS, done);

            child.on('exit', function (code) {
                if (code !== 0) return;   //a non-zero exit is the callback's, which has the output
                clear(grace);
                done();
            });

            //THE DASHBOARD OPENED A WINDOW, IT DOES NOT OWN IT.
            if (typeof child.unref === 'function') child.unref();
        });
    }

    return {
        open: open,
        discover: discover,
        folderUri: folderUri,
        launchSpec: launchSpec,
        GRACE_MS: GRACE_MS
    };
};

module.exports.GRACE_MS = GRACE_MS;
module.exports.EDITORS = EDITORS;
