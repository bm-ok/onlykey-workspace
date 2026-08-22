var fs = require('fs');
var path = require('path');

//---------------------------------------------------------------------------
//STARTING, STOPPING, SNAPSHOTTING AND DELETING A MACHINE.
//
//EVERY ONE OF THESE CHANGES SOMETHING REAL, which is why they land on a gate
//that is already proven rather than beside one that is not. `run` and `retrying`
//arrive as arguments — see ./gate.js — so the sequencing here can be exercised
//against what VirtualBox would have printed.
//
//WHAT THE SEQUENCING IS FOR: several of these are not one command but an order
//that has to hold. Deleting a machine asks where it lives BEFORE unregistering
//it, because afterwards there is nothing left to ask; and it waits for the
//session, not the state, because ./reading.js's note about powered-off-is-not-
//ready is exactly the window a delete would be raced in.
//---------------------------------------------------------------------------

//WHAT VirtualBox GENERATED FOR THIS MACHINE, and nothing else.
//
//DELIBERATELY NARROW. Anything unrecognised is left alone and NAMED — deleting a
//directory is not a thing to be approximately right about, and somebody may have
//put a file in there.
var GENERATED = /^(Unattended-.*|.*\.vbox(-prev)?|.*\.viso)$/i;

//WHAT A SNAPSHOT TREE LOOKS LIKE IN `--machinereadable`. Keys carry their place
//in the tree as a suffix — `SnapshotName`, `SnapshotName-1`, `SnapshotName-1-2`
//— so the key IS the path and a parent is the key with its last segment gone.
function treeOf(out, times) {
    var byKey = {};

    function field(line, prefix) {
        var m = new RegExp('^' + prefix + '((?:-\\d+)*)="(.*)"$').exec(line);
        return m ? { key: 'SnapshotName' + m[1], at: m[1], value: m[2] } : null;
    }

    String(out || '').split('\n').forEach(function (raw) {
        var line = raw.trim();
        [['SnapshotName', 'name'], ['SnapshotUUID', 'uuid'], ['SnapshotDescription', 'description']]
            .forEach(function (pair) {
                var f = field(line, pair[0]);
                if (!f) return;
                if (!byKey[f.key]) byKey[f.key] = { key: f.key, at: f.at };
                byKey[f.key][pair[1]] = f.value;
            });
    });

    var currentNode = (String(out || '').match(/^CurrentSnapshotNode="(.*)"$/m) || [])[1] || null;
    var current = (String(out || '').match(/^CurrentSnapshotName="(.*)"$/m) || [])[1] || null;

    var list = Object.keys(byKey).map(function (k) {
        var s = byKey[k];
        var parts = s.at ? s.at.slice(1).split('-') : [];
        return {
            name: s.name,
            uuid: s.uuid || null,
            taken: (s.uuid && times && times[s.uuid]) || null,
            description: s.description || '',
            key: s.key,
            parent: parts.length
                ? 'SnapshotName' + (parts.length > 1 ? '-' + parts.slice(0, -1).join('-') : '')
                : null,
            depth: parts.length,
            current: !!currentNode && s.key === currentNode
        };
    });

    //DEPTH FIRST, so a list rendered in order already reads as the tree it is.
    var order = [];
    (function walk(parent) {
        list.filter(function (x) { return x.parent === parent; }).forEach(function (s) {
            order.push(s);
            walk(s.key);
        });
    })(null);

    //ANYTHING THE WALK DID NOT REACH would be a key whose parent is not there.
    //It should not happen, and dropping it silently would be worse than showing
    //it flat.
    list.forEach(function (s) { if (order.indexOf(s) < 0) order.push(s); });

    return {
        snapshots: order,
        current: current,
        currentNode: currentNode,
        deepest: order.reduce(function (n, s) { return Math.max(n, s.depth); }, 0)
    };
}

//    run, retrying   from ./gate.js
//    read            from ./reading.js
//    when            a `byStamp` drawer from ../../core/cached, for snapshot times
module.exports = function doing(run, retrying, read, opts) {
    var o = opts || {};
    var say = o.say || { info: function () {}, warn: function () {}, good: function () {}, bad: function () {} };
    var when = o.when;

    //---- keeping the previous boot ----------------------------------------
    //
    //A machine's serial output goes to one file, and starting it again writes
    //over what the last boot said — which is exactly the boot somebody wants to
    //read when a machine will not come up.
    //
    //NEVER STOPS A START. This is a convenience for reading afterwards, and a
    //machine that would not boot because a log could not be renamed would be a
    //debugging aid causing the fault it exists to explain.
    async function keepThePreviousBoot(name) {
        try {
            var uart = (await read.info(name)).uartmode1 || '';
            //"file,<path>" WHEN IT IS BEING CAPTURED. "disconnected", a pipe or a
            //socket otherwise, and none of those is a file to roll.
            var at = /^file,(.+)$/i.exec(uart);
            if (!at) return null;

            var file = at[1].trim();
            //AN EMPTY FILE IS NOT A BOOT, and rolling one would push a real
            //record out of the only slot there is.
            if (!fs.existsSync(file) || fs.statSync(file).size === 0) return null;

            var previous = file.replace(/\.log$/i, '') + '.previous.log';
            fs.rmSync(previous, { force: true });
            fs.renameSync(file, previous);
            return previous;
        } catch (e) { return null; }
    }

    async function start(name, type) {
        await keepThePreviousBoot(name);
        return await retrying(
            function () { return run(['startvm', name, '--type', type || 'gui']); },
            { what: 'starting the machine' });
    }

    //THE BUTTON, NOT THE PLUG. A guest mid-write should be allowed to finish;
    //pulling power is a separate, explicit choice.
    function stop(name, force) {
        return run(['controlvm', name, force ? 'poweroff' : 'acpipowerbutton']);
    }

    //---- pull the machine's network cable, or plug it back in --------------
    //
    //EXISTS FOR ONE REASON: to find out what this app does when a machine it is
    //watching goes away and comes back. That is not a hypothetical failure — a
    //laptop sleeps, a switch reboots, wifi drops — and everything here REASONS
    //about it rather than having seen it: the run is detached so it "should"
    //survive, the agent "should" redial, the queue "should" keep waiting.
    //
    //THE CABLE RATHER THAN THE GUEST'S OWN NETWORKING, deliberately. Turning an
    //interface off from inside is a different experiment: the machine knows it
    //did it and can undo it. Unplugging it from out here is what the machine
    //cannot tell from the rest of the world disappearing.
    function setLink(name, on) {
        return run(['controlvm', name, 'setlinkstate1', on ? 'on' : 'off']);
    }

    //---- the console, written to a file this host can read ----------------
    //
    //A WIRE OUT OF THE GUEST THAT NEEDS NOTHING RUNNING INSIDE IT. The kernel
    //writes to ttyS0 from its first line — before the network, before systemd,
    //before there is any agent to dial home — and VirtualBox copies every byte
    //to a file here. It is the only way to watch a boot that never finishes,
    //which is the failure it was built for.
    //
    //0x3F8 / IRQ 4 IS COM1, which is what `console=ttyS0` means in the guest.
    //
    //A RAW FILE RATHER THAN A PIPE OR A SOCKET, and that is the point rather
    //than the easy choice: a file survives the machine going away, and the whole
    //reason to have this is reading it AFTER a boot that did not finish. A pipe
    //with nobody on the end of it is a boot nobody can look at afterwards.
    //
    //AND IT CAN ONLY BE SET WHILE THE MACHINE IS OFF, which is why it is done as
    //a machine is built rather than when somebody wants it: the one boot worth
    //watching is the one it would be too late to ask about.
    async function setSerial(name, file) {
        if (!file) {
            await run(['modifyvm', name, '--uart1', 'off'], { tags: [name] });
            return { name: name, on: false, file: null };
        }

        //THE FOLDER FIRST. VirtualBox will not create it, and a machine that
        //will not start because its console had nowhere to go would be a
        //debugging aid causing the fault it exists to explain.
        try { fs.mkdirSync(path.dirname(file), { recursive: true }); }
        catch (e) { /* it is there, or the write below says so */ }

        await run(['modifyvm', name, '--uart1', '0x3F8', '4', '--uartmode1', 'file', file],
            { tags: [name] });
        return { name: name, on: true, file: file };
    }

    //---- what the machine has on screen, right now ------------------------
    //
    //THE ONE THING THAT ANSWERS A QUESTION NOTHING ELSE HERE CAN. An install
    //says nothing for twenty-five minutes, and until it finishes there is no
    //agent, no log line and no way to tell "working" from "stuck on a prompt
    //nobody is watching". Before this the only way to look was to open
    //VirtualBox by hand, which is exactly the reaching-around this app exists to
    //remove.
    async function screenshot(name, file) {
        //ONLY WHILE IT IS RUNNING: there is no screen otherwise, and VirtualBox
        //says so in its own words, which are worse than these.
        if (await read.isOff(name)) {
            throw new Error('"' + name + '" is not running, so it has nothing on screen.');
        }
        await run(['controlvm', name, 'screenshotpng', file], { quiet: true });
        return file;
    }

    //---- when each snapshot was taken -------------------------------------
    //
    //NOT SOMETHING VBoxManage WILL SAY. The times are in the machine's own
    //`.vbox` file, which is XML, and reading it per draw is what once put 94% of
    //a window inside `spawn`.
    //
    //KEYED ON THAT FILE'S STAMP, through ../../core/cached — the file changes
    //when a snapshot is taken or thrown away, and its size and modified time say
    //so. Not a clock: there is no window during which the file is new and the
    //answer is old.
    async function snapshotTimes(name) {
        var cfg;
        try { cfg = (await read.info(name)).CfgFile; } catch (e) { return {}; }
        if (!cfg) return {};

        var stamp;
        try {
            var st = fs.statSync(cfg);
            stamp = st.mtimeMs + ':' + st.size;
        } catch (e) { return {}; }

        function parse() {
            var out = {};
            try {
                var xml = fs.readFileSync(cfg, 'utf8');
                var re = /<Snapshot\s+uuid="\{([^}]+)\}"[^>]*?timeStamp="([^"]+)"/g;
                var m;
                while ((m = re.exec(xml))) out[m[1]] = m[2];
            } catch (e) { /* unreadable is no times, which is an answer */ }
            return out;
        }

        if (!when) return parse();
        return await when.get(cfg + '|' + stamp, parse);
    }

    async function snapshots(name) {
        try {
            var out = await run(['snapshot', name, 'list', '--machinereadable'], { quiet: true });
            return treeOf(out, await snapshotTimes(name));
        } catch (e) {
            //NO SNAPSHOTS AT ALL IS AN ERROR FROM VBoxManage, not a problem here.
            return { snapshots: [], current: null, currentNode: null, deepest: 0 };
        }
    }

    function takeSnapshot(name, snapshot, description) {
        return run(['snapshot', name, 'take', snapshot]
            .concat(description ? ['--description', description] : []), { timeout: 300000 });
    }

    function restoreSnapshot(name, snapshot) {
        return run(['snapshot', name, 'restore', snapshot], { timeout: 300000 });
    }

    //REMOVE A SNAPSHOT, MERGING ITS DISK BACK INTO THE ONE BEFORE IT.
    //
    //LONG ENOUGH TO NEED ITS OWN TIMEOUT: the merge is proportional to how much
    //changed while that snapshot was the current one, and the default would give
    //up PART WAY THROUGH A MERGE — which is the one moment a disk should not be
    //left alone.
    function deleteSnapshot(name, title) {
        return retrying(
            function () { return run(['snapshot', name, 'delete', title], { timeout: 900000 }); },
            { what: 'deleting a snapshot' });
    }

    //---- removing ----------------------------------------------------------

    async function machineFolder(name) {
        try { return path.dirname((await read.info(name)).CfgFile || '') || null; }
        catch (e) { return null; }
    }

    //EVERYTHING THE VM OWNS, GONE, MEDIA INCLUDED — otherwise practising
    //provisioning leaves a trail of orphaned disks.
    async function destroy(name) {
        if (!(await read.exists(name))) {
            say.info(name + ' does not exist in VirtualBox; nothing to delete');
            return { existed: false };
        }

        //ASKED BEFORE IT IS UNREGISTERED, because afterwards there is nothing
        //left to ask.
        var folder = await machineFolder(name);

        var s = await read.state(name);
        if (read.OFF.indexOf(s) < 0) {
            say.warn('powering ' + name + ' off (was "' + s + '")');
            try { await stop(name, true); } catch (e) { /* it may already be going */ }
            await read.waitUntilOff(name, { timeout: 120000 });
        }

        //AND THE SESSION, NOT ONLY THE STATE. See ./reading.js.
        await read.waitUntilUnlocked(name);

        await retrying(
            function () { return run(['unregistervm', name, '--delete'], { timeout: 180000 }); },
            { what: 'unregistervm' });

        var left = folder ? sweepUp(folder) : [];
        say.good(name + ' and its disks are gone.');
        return { existed: true, folder: folder, left: left };
    }

    //WHAT VirtualBox LEAVES BEHIND, and only that.
    //
    //The bootstrap command is the one place anything can be handed to a machine
    //that has nothing yet, so whatever is put there outlives the machine unless
    //something removes it. ANYTHING UNRECOGNISED IS LEFT ALONE AND NAMED.
    function sweepUp(folder) {
        var names;
        try { names = fs.readdirSync(folder); } catch (e) { return []; }

        names.forEach(function (entry) {
            var full = path.join(folder, entry);
            try {
                if (entry === 'Logs' && fs.statSync(full).isDirectory()) {
                    fs.rmSync(full, { recursive: true, force: true });
                    return;
                }
                if (GENERATED.test(entry) && fs.statSync(full).isFile()) fs.unlinkSync(full);
            } catch (e) { /* named below if it is still there */ }
        });

        var left = [];
        try { left = fs.readdirSync(folder); } catch (e) { return []; }

        if (!left.length) {
            try { fs.rmdirSync(folder); return []; } catch (e) { /* said below */ }
        }
        if (left.length) {
            say.warn(folder + ' still holds ' + left.join(', ')
                + ' — not this app\'s to delete, so it was left');
        }
        return left;
    }

    return {
        start: start, stop: stop, setLink: setLink, setSerial: setSerial, screenshot: screenshot,
        snapshots: snapshots, snapshotTimes: snapshotTimes,
        takeSnapshot: takeSnapshot, restoreSnapshot: restoreSnapshot, deleteSnapshot: deleteSnapshot,
        destroy: destroy, machineFolder: machineFolder, sweepUp: sweepUp,
        keepThePreviousBoot: keepThePreviousBoot
    };
};

module.exports.treeOf = treeOf;
module.exports.GENERATED = GENERATED;
