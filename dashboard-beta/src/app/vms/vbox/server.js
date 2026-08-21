var fs = require('fs');
var path = require('path');
var child = require('child_process');

var makeGate = require('./gate');
var makeReading = require('./reading');
var makeDoing = require('./doing');
var makeNetwork = require('./network');

//---------------------------------------------------------------------------
//VirtualBox, AND NOTHING ABOUT ANY PROJECT.
//
//THE ONLY THING IN THIS APP THAT RUNS VBoxManage. Same rule as ../../git — "one
//place that runs git, so nothing else has to" — and this is where that rule came
//from: the app being ported from enforces it with a test, because a second
//opinion about a machine's state was the bug it kept producing.
//
//IT IS A VENDOR. The group is ../ — virtual machines — and this is one way of
//having them. Everything above it asks for a machine to be started, not for
//VBoxManage to be run, so a second vendor would sit beside this rather than
//through it.
//
//AND IT KNOWS NOTHING ABOUT WHAT A MACHINE IS FOR. No worker, no judge, no
//task, no branch. A virtual machine is not a project-specific idea; what was
//wrong in the version before the one being ported was VM lifecycle welded into
//the work loop, so the tool could not be used without one.
//
//---- what is here, and what is not, yet -----------------------------------
//
//THE GATE and THE READING. ./gate.js is how anything talks to VirtualBox at all
//— one at a time, identical reads shared, a session lock retried — and
//./reading.js is what it says about a machine and how to wait for it to mean it.
//
//AND THE DOING: starting, stopping, snapshots, deleting. Every one of those
//changes something real, which is why they landed on a gate that was already
//proven rather than beside one that was not.
//
//AND THE NETWORK: the bridges, the host-only interfaces, the DHCP lease and
//this host's own address. Two networks, and the difference decides what can be
//asked — see ./network.js.
//
//AND NOT THE REGISTRY. Which machines this app is ALLOWED to touch is ../ours,
//and it is a separate plugin on purpose: this one knows how to drive VirtualBox,
//that one knows which of them are ours. Merged, the driver can act on a machine
//this app never made.
//---------------------------------------------------------------------------

var BACK = String.fromCharCode(92);

//INSTALLED BUT NOT ON PATH IS THE NORMAL CASE ON WINDOWS, so look where it
//actually is before giving up.
var WHERE = [
    process.env.VBOX_MSI_INSTALL_PATH && path.join(process.env.VBOX_MSI_INSTALL_PATH, 'VBoxManage.exe'),
    process.env.VBOX_INSTALL_PATH && path.join(process.env.VBOX_INSTALL_PATH, 'VBoxManage.exe'),
    'C:' + BACK + 'Program Files' + BACK + 'Oracle' + BACK + 'VirtualBox' + BACK + 'VBoxManage.exe',
    '/usr/bin/VBoxManage',
    '/usr/local/bin/VBoxManage'
].filter(Boolean);

function there(p) {
    try { return fs.existsSync(p); } catch (e) { return false; }
}

plugin.consumes = ['app', 'log', 'cached'];
plugin.provides = ['vbox'];
async function plugin(imports, register) {
    var log = imports.log.on('vm');

    function exe() {
        for (var i = 0; i < WHERE.length; i++) if (there(WHERE[i])) return WHERE[i];
        return 'VBoxManage';
    }

    function available() {
        return WHERE.some(there);
    }

    //---- the one thing that actually starts a process ----------------------
    function spawn(args, how) {
        var h = how || {};
        var quiet = !!h.quiet;
        if (!quiet) log.info('VBoxManage ' + args.join(' '));

        return new Promise(function (resolve, reject) {
            child.execFile(exe(), args, {
                timeout: h.timeout || 120000,
                maxBuffer: 1 << 24
            }, function (err, stdout, stderr) {
                if (err) {
                    var why = String(stderr || stdout || err.message).trim();
                    if (!quiet) log.bad(why.split('\n').slice(-2).join(' '));
                    var e = new Error(why);
                    e.stdout = stdout;
                    e.stderr = stderr;
                    return reject(e);
                }

                if (!quiet && String(stdout).trim()) log.out(stdout);

                //NORMALISED HERE, ONCE. VBoxManage emits CRLF on Windows, and
                //every parser splits on \n and anchors patterns with $ — so a
                //trailing carriage return made `list vms` match NOTHING and
                //every machine look as though it did not exist. Fixing it per
                //parser would mean remembering it per parser.
                resolve(String(stdout).split('\r\n').join('\n'));
            });
        });
    }

    //IDENTICAL READS ARE ONE READ, through ../../core/cached. Its own drawer, so
    //a write here empties what VirtualBox said and nothing else — the app-wide
    //`stale()` would take the ref reads with it.
    //
    //1200ms: long enough to collapse a burst of callers arriving together, short
    //enough that nothing observes a state it could have acted on. The state
    //watchers in ./reading.js poll at two seconds.
    var asked = imports.cached.whileFresh('vbox', 1200);

    var gate = makeGate(spawn, { asked: asked, say: log });
    var read = makeReading(gate.run, { say: log });

    //WHEN EACH SNAPSHOT WAS TAKEN comes out of the machine's own `.vbox` file,
    //which is XML — and reading it per draw is what once put 94% of a window
    //inside `spawn`. Keyed on that file's stamp rather than on a clock: it
    //changes when a snapshot is taken or thrown away, and its size and modified
    //time say so, so there is no window during which the file is new and the
    //answer is old.
    var doIt = makeDoing(gate.run, gate.retrying, read, {
        say: log,
        when: imports.cached.byStamp('vbox-snapshot-times')
    });

    var net = makeNetwork(gate.run, { available: available, there: there });

    await register(null, {
        vbox: {
            //WHETHER THERE IS A VirtualBox HERE AT ALL. Asked rather than
            //assumed: this app is useful without one, and everything above
            //should be able to say so rather than failing per call.
            available: available,
            exe: exe,

            //EVERY CALL GOES THROUGH THIS. See ./gate.js.
            run: gate.run,
            retrying: gate.retrying,
            waiting: gate.waiting,

            listAll: read.listAll,
            runningAll: read.runningAll,
            info: read.info,
            exists: read.exists,
            state: read.state,
            isOff: read.isOff,
            waitForState: read.waitForState,
            waitUntilOff: read.waitUntilOff,
            waitUntilUnlocked: read.waitUntilUnlocked,

            OFF: read.OFF,

            start: doIt.start,
            stop: doIt.stop,
            setLink: doIt.setLink,
            screenshot: doIt.screenshot,
            snapshots: doIt.snapshots,
            takeSnapshot: doIt.takeSnapshot,
            restoreSnapshot: doIt.restoreSnapshot,
            deleteSnapshot: doIt.deleteSnapshot,
            destroy: doIt.destroy,
            machineFolder: doIt.machineFolder,

            isos: net.isos,
            bridges: net.bridges,
            hostOnlyIfs: net.hostOnlyIfs,
            makeHostOnlyIf: net.makeHostOnlyIf,
            leaseFor: net.leaseFor,
            hostAddress: net.hostAddress
        }
    });
}
module.exports = plugin;
