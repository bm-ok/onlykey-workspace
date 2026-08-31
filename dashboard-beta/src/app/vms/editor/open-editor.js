var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var makePlatforms = require('./remote-platform');

//WHAT VS CODE ALREADY HAS OPEN ON THIS MACHINE, and whether it still works.
//See ./stale-windows.js: a window left over from before a rollback holds a dead
//connection for three hours and swallows every later launch aimed at that host.
var makeStale = require('./stale-windows');

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

//HOW LONG A CLOSING WINDOW IS GIVEN before the replacement is launched.
//The new launch is aimed at the host the old window still holds, which is
//the whole thing being avoided -- so it waits for the close to land rather
//than racing it. Short, because it is a window being asked to close and not
//a machine being asked to boot.
var CLOSE_MS = 1200;

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

    //THE SAME `say`, `env`, `platform` AND `there` THIS ALREADY TAKES, handed
    //on — so a test that injects a fake disk here gets one for both halves
    //rather than one half reading the real settings.json.
    var platforms = d.platforms || makePlatforms({
        env: env, platform: platform, there: there, say: say,
        readFile: d.readFile, writeFile: d.writeFile, home: d.home
    });

    //WHAT VS CODE ALREADY HAS OPEN, and whether it still works. Injected the
    //same way everything else here is, so a test can answer for it without a
    //VS Code on the machine and without closing anything.
    var stale = d.stale || makeStale({ exec: exec, platform: platform });

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
    //AND ITS ONLY CALLER PASSES AN ALIAS, WHICH THIS NOTE USED TO ARGUE
    //AGAINST. The argument was that a name from a config file is a second place
    //the machine's address lives and goes stale the first time the address
    //moves — true of a hand-written `~/.ssh/config`, and not true of the one
    //../../core/ssh writes, which is rewritten WHOLE from the register every
    //time a machine dials in or is deleted. It cannot be staler than the
    //register is.
    //
    //AND user@address TURNS OUT TO BE THE BROKEN ONE HERE, for a reason this
    //note missed: ssh matches its configuration on the host argument it is
    //GIVEN. `okc@192.168.51.221` matches no `Host okc-<name>` block, so
    //`IdentityFile` and `IdentitiesOnly` never apply and the connection falls
    //back to whatever identity the operator happens to have — the one key
    //../../core/ssh exists to stop using. It still opens. It opens with the
    //wrong key and nothing on screen differs, which is why the check for it is
    //in ../../../../test/diy/open-editor.test.js rather than left to a reader.
    //
    //Either form still needs nothing on the host but the key, which
    //first-boot.sh already installed.
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
    //`how.window` IS 'new' OR 'focus', and it is decided by `open` below from
    //what VS Code says it already has open. This half only launches.
    function launch(input, how) {
        var it = input || {};
        if (!it.dir) throw new Error('There is no folder to open.');

        var found = discover(it.command);
        var exe = found.command;

        //---- FOCUSING IS THE ABSENCE OF A FLAG, NOT A FLAG ------------------
        //
        //VS Code opens a folder in the window that already has it — focusing
        //that window — unless it is told otherwise, which is exactly the wanted
        //behaviour when the connection is healthy.
        //
        //NOT `--reuse-window`. That forces the LAST ACTIVE window, which is
        //whichever one somebody happened to click on last: it would take a
        //window full of somebody else's work and replace it with this one.
        var where = (how && how.window === 'focus') ? [] : ['--new-window'];

        var args = it.remote
            ? ['--folder-uri', folderUri(it.remote, it.dir)].concat(where)
            : [it.dir].concat(where);

        var spec = launchSpec(exe, args);
        var to = say.apply(null, ['editor'].concat(it.tags || []));

        //---- BEFORE IT STARTS, NOT AFTER --------------------------------
        //
        //REMOTE-SSH READS THIS AT CONNECT TIME. Written afterwards it would be
        //correct for the next press and useless for this one — and this one is
        //the press somebody is watching.
        //
        //ONLY FOR A REMOTE. Opening a folder on this computer has no host to
        //have a platform, and writing an entry for one would put a machine name
        //in somebody's settings that nothing ever reads.
        //
        //AND IT NEVER STOPS THE LAUNCH. `ensure` answers rather than throwing;
        //the worst case is the dialog somebody was already getting, which is
        //not a reason to refuse to open an editor. See ./remote-platform.js.
        var platformSaid = it.remote
            ? platforms.ensure(it.remote, exe)
            : { added: false, why: 'nothing remote to say it about' };

        if (!platformSaid.added && platformSaid.file && platformSaid.why !== 'already there') {
            //SAID ONCE, AND NOT AS A FAILURE. VS Code will ask which platform
            //it is and carry on working the moment that is answered, so this is
            //a convenience that did not happen, not a broken press. It names the
            //file, because the fix is one line somebody can type.
            to.warn('VS Code may ask which platform ' + it.remote + ' is: ' + platformSaid.why);
        }

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

            //THE GUARD IS AT THE TOP, NOT INSIDE `finish`.
            //
            //Two routes reach here — the grace window and a clean exit — and
            //resolving an already-resolved promise is a NO-OP in JS, so a guard
            //that only wraps the resolve protects nothing a caller can see. What
            //it has to protect is the LINE: with the check one call further down,
            //a launch where the grace fired and the process then exited cleanly
            //said "VS Code was asked to open it" TWICE for one press.
            //
            //Carried over from the version this comes from, which has the same
            //shape and the same duplicate. Found by a sabotage that removed the
            //guard and SURVIVED, because the only thing it changed was something
            //no test was reading.
            var done = function () {
                if (settled) return;
                to.good('VS Code was asked to open it.');
                finish(resolve, { opened: it.dir, on: it.remote || null, using: exe, found: found.from,
                //WHICH OF THE THREE IT DID, so a caller can say so rather than
                //reporting every press as the same act — see `open` below.
                window: (how && how.window) || 'new',
                closed: (how && how.closed) || [],
                platform: platformSaid.added ? 'told VS Code it is Linux' : platformSaid.why });
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

    //---- AND WHICH OF THE THREE THIS PRESS IS --------------------------------
    //
    //ASKED OF VS CODE, ONCE, IMMEDIATELY BEFORE LAUNCHING. `--status` names the
    //windows it has open and the connections it could not establish, per host —
    //see ./stale-windows.js for the shape and for what happens without this.
    //
    //  nothing open for this machine   a new window
    //  open and connected              FOCUS it; opening a second window on the
    //                                  same folder is not what the button means
    //  open and the connection dead    CLOSE it and open a new one. It cannot
    //                                  reconnect on its own — it is sitting in
    //                                  "Cannot reconnect. Please reload the
    //                                  window." with three hours of grace — and
    //                                  while it is there every launch aimed at
    //                                  that host does nothing at all.
    //
    //ONLY WHEN THE CONNECTION IS DEAD IS ANYTHING CLOSED. A window somebody is
    //working in is never touched: both a window for this host AND a failure
    //VS Code reports for this host are required.
    //
    //AND ONLY FOR A REMOTE. A local folder has no host to have a window for.
    function open(input) {
        var it = input || {};
        if (!it.dir) throw new Error('There is no folder to open.');
        if (!it.remote) return launch(it, { window: 'new' });

        var exe = discover(it.command).command;
        var to = say.apply(null, ['editor'].concat(it.tags || []));

        return stale.look(exe, it.remote).then(function (seen) {
            if (!seen.windows.length) return launch(it, { window: 'new' });

            if (!seen.dead) {
                to.info('VS Code already has ' + it.remote + ' open and connected — bringing that window forward');
                return launch(it, { window: 'focus' });
            }

            to.warn('the VS Code window on ' + it.remote + ' cannot reconnect — closing it and opening a new one');

            return Promise.all(seen.windows.map(function (w) { return stale.close(w.pid); }))
                .then(function (closed) {
                    var stuck = closed.filter(function (c) { return !c.closed; });
                    if (stuck.length) {
                        //SAID, AND STILL LAUNCHED. A window that would not close
                        //is worth knowing about, and refusing to open an editor
                        //over it would leave somebody with nothing.
                        to.warn('could not close ' + stuck.length + ' of them: '
                            + stuck.map(function (c) { return c.why; }).join('; '));
                    }

                    //A MOMENT FOR IT TO GO. The launch that follows is aimed at
                    //the host the closing window still holds, and that is the
                    //whole thing being avoided.
                    return new Promise(function (r) { after(CLOSE_MS, r); })
                        .then(function () { return launch(it, { window: 'new', closed: closed }); });
                });
        });
    }

    return {
        open: open,
        //HANDED OUT so the DIY press can say whether it wrote the entry, and so
        //somebody can ask without opening an editor to find out.
        platforms: platforms,
        discover: discover,
        folderUri: folderUri,
        launchSpec: launchSpec,
        GRACE_MS: GRACE_MS
    };
};

module.exports.GRACE_MS = GRACE_MS;
module.exports.CLOSE_MS = CLOSE_MS;
module.exports.EDITORS = EDITORS;
