var fs = require('fs');
var path = require('path');

//---------------------------------------------------------------------------
//BUILDING THE THING IN VirtualBox, WHICH IS NOT THE SAME AS MAKING A MACHINE.
//
//A machine here is a SPEC — a name, a size, a key, a token, a place in the
//register. What VirtualBox holds is a BUILD of that spec, and a build is cheap
//and replaceable. Keeping the two apart is what lets an install throw the build
//away and make it again rather than reusing whatever the last one left behind.
//
//NOTHING HERE WRITES TO THE REGISTER. It is handed a spec and returns what the
//build decided; ../ours is what remembers. Two places writing that record is
//how they come to disagree about which machines this app may touch.
//---------------------------------------------------------------------------

module.exports = function building(deps) {
    var d = deps || {};
    var vbox = d.vbox;

    //WHERE CONSOLES ARE KEPT. One folder for the host rather than one per
    //machine, because the question "show me what that machine said" should not
    //need to know where the machine lives.
    var serialDir = d.serialDir;

    var there = d.there || function (p) {
        try { return fs.existsSync(p); } catch (e) { return false; }
    };
    var makeDir = d.makeDir || function (p) { fs.mkdirSync(p, { recursive: true }); };

    //---- what it will be installed from ------------------------------------
    //
    //A PATH, OR PART OF THE NAME OF ONE VirtualBox ALREADY KNOWS, which is
    //usually where they already are. Somebody who has installed anything by hand
    //has the iso registered, and making them find the path again is asking them
    //to look up something the hypervisor could be asked.
    async function resolveISO(wanted) {
        if (wanted && there(wanted)) return wanted;

        var known = await vbox.isos();

        //ONE IS NOT A CHOICE. With exactly one image on the host, asking which
        //is a question with one answer.
        if (!wanted) {
            if (known.length === 1) return known[0].location;
            throw new Error('Choose an installer image. VirtualBox knows about: '
                + (known.map(function (i) { return i.name; }).join(', ') || 'none'));
        }

        var needle = String(wanted).toLowerCase();
        var hit = known.filter(function (i) { return i.name.toLowerCase().indexOf(needle) >= 0; })[0];
        if (hit) return hit.location;

        //THE REFUSAL NAMES WHAT THERE IS, because "no image matching that" leaves
        //somebody guessing at a filename they last saw in a downloads folder.
        throw new Error('No installer image matching "' + wanted + '". VirtualBox knows about: '
            + (known.map(function (i) { return i.name; }).join(', ') || 'none'));
    }

    //---- which adapter it sits on ------------------------------------------
    //
    //BRIDGED, because a guest has to reach this app to fetch its setup, and on
    //NAT it cannot see the host at all without more plumbing.
    async function pickBridge(preferred) {
        var list = await vbox.bridges();

        if (preferred) {
            var hit = list.filter(function (b) { return b.name === preferred; })[0];
            //NAMED AND NOT THERE IS A REFUSAL, not a fallback. Somebody who said
            //which adapter meant it, and quietly using another one puts the
            //machine on a network they did not choose.
            if (!hit) throw new Error('There is no network adapter called "' + preferred + '".');
            return hit.name;
        }

        //169.254 IS WHAT AN INTERFACE HAS WHEN IT HAS NO ADDRESS — see
        //../vbox/network.js. Bridging onto one is bridging onto nothing.
        var up = list.filter(function (b) {
            return b.status === 'Up' && b.ip && b.ip.indexOf('169.254') !== 0;
        });
        if (!up.length) {
            throw new Error('No network adapter is up to bridge onto. Use NAT instead, or say which adapter.');
        }
        return up[0].name;
    }

    //THE HOST-ONLY NETWORK EVERY MACHINE GETS A SECOND FOOT IN, made if there is
    //not one. VirtualBox serves DHCP on it, which is the whole point: a lease it
    //hands out is a lease it can be ASKED about.
    //
    //NOT A PREFERENCE AND NOT PER MACHINE. One network, every machine on it, so
    //"which one is runner4 on" is never a question.
    async function hostOnlyAdapter() {
        var have = await vbox.hostOnlyIfs();
        if (have.length) return have[0].name;
        return await vbox.makeHostOnlyIf();
    }

    //---- the build ----------------------------------------------------------

    async function buildInVbox(spec, say) {
        var to = say || { info: function () {}, warn: function () {} };

        var iso = spec.iso ? await resolveISO(spec.iso) : '';
        var bridge = spec.network === 'bridged' ? await pickBridge(spec.bridgeAdapter) : '';

        to.info('creating ' + spec.name + ': ' + spec.cpus + ' cpu, ' + spec.memoryMB + ' MB, '
            + Math.round(spec.diskMB / 1024) + ' GB disk');
        await vbox.run(['createvm', '--name', spec.name, '--ostype', spec.ostype, '--register'],
            { tags: [spec.name] });

        //A SECOND ADAPTER, ON A NETWORK VirtualBox ITSELF SERVES, AND IT STAYS.
        //
        //The first one is how the machine reaches the world and this host. This
        //one is how this host reaches the MACHINE when the first cannot help —
        //and the case that matters is a machine that never dials in.
        //
        //"What is this machine's address" has no other answer. VirtualBox keeps
        //one, but it is REPORTED BY THE GUEST ADDITIONS, which an installer does
        //not have and a terminal-only runner does not install; and `findlease`
        //knows only about networks VirtualBox serves, while a bridged machine
        //got its lease from the router. So a machine that will not come up is a
        //machine with no address, which is exactly when somebody needs one.
        //
        //KEPT FOR THE LIFE OF THE MACHINE rather than removed after the install:
        //the day it is wanted is a day something has gone wrong, and a diagnostic
        //that has to be added first is not there when it is needed.
        var hostOnly = null;
        try { hostOnly = await hostOnlyAdapter(); }
        catch (e) {
            to.warn('no host-only network, so this machine will have no second way in: ' + e.message);
        }

        var net = spec.network === 'bridged'
            ? ['--nic1', 'bridged', '--bridgeadapter1', bridge, '--nictype1', 'virtio']
            : ['--nic1', 'nat', '--nictype1', 'virtio'];
        if (hostOnly) {
            net = net.concat(['--nic2', 'hostonly', '--hostonlyadapter2', hostOnly, '--nictype2', 'virtio']);
        }

        await vbox.run(['modifyvm', spec.name,
            '--memory', String(spec.memoryMB),
            '--cpus', String(spec.cpus),
            '--vram', String(spec.vramMB),
            '--graphicscontroller', 'vmsvga',
            '--ioapic', 'on',
            '--rtcuseutc', 'on',
            '--audio-driver', 'none',
            '--usbxhci', 'on',
            '--clipboard-mode', 'bidirectional'
        ].concat(net), { tags: [spec.name] });

        //NAT NEEDS A FORWARDED PORT or there is no way to ssh in at all.
        if (spec.network === 'nat') {
            await vbox.run(['modifyvm', spec.name, '--natpf1',
                'ssh,tcp,127.0.0.1,' + spec.sshPort + ',,22'], { tags: [spec.name] });
        }

        //THE CONSOLE, ON EVERY MACHINE, FROM THE MOMENT IT IS BUILT.
        //
        //It used to be off unless asked for, on the reasoning that a file the
        //host writes for the life of a machine is not a default anybody chose.
        //What that produced was an instrument only the drills had: every machine
        //the kit built could be watched and every machine made at the window
        //could not, and an install ran for twelve minutes with the Terminal tab
        //showing nothing.
        //
        //HERE RATHER THAN AT INSTALL, because this is the one place a VirtualBox
        //machine is built — create and the rebuild inside install both come
        //through — so there is no second path that can be forgotten.
        var serial = path.join(serialDir, spec.name + '.log');
        try {
            makeDir(serialDir);
            await vbox.setSerial(spec.name, serial);
        } catch (e) {
            //NEVER STOPS A BUILD. A machine that would not be made because its
            //console had nowhere to go would be a debugging aid causing the
            //fault it exists to explain.
            to.warn('could not capture its console: ' + e.message);
            serial = null;
        }

        var folder = path.dirname((await vbox.info(spec.name)).CfgFile || '.');
        var disk = path.join(folder, spec.name + '.vdi');

        await vbox.run(['createmedium', 'disk', '--filename', disk,
            '--size', String(spec.diskMB), '--format', 'VDI'],
        { timeout: 300000, tags: [spec.name] });

        //PORTCOUNT 2: the disk on port 0 and the installer on port 1.
        await vbox.run(['storagectl', spec.name, '--name', 'SATA', '--add', 'sata',
            '--controller', 'IntelAhci', '--portcount', '2', '--bootable', 'on'], { tags: [spec.name] });
        await vbox.run(['storageattach', spec.name, '--storagectl', 'SATA', '--port', '0', '--device', '0',
            '--type', 'hdd', '--medium', disk], { tags: [spec.name] });
        if (iso) {
            await vbox.run(['storageattach', spec.name, '--storagectl', 'SATA', '--port', '1', '--device', '0',
                '--type', 'dvddrive', '--medium', iso], { tags: [spec.name] });
        }

        //DECLARED AS DATA, AND ATTACHED AT CREATE TIME rather than later: a
        //machine that boots once without them can do the wrong thing before
        //anybody notices they are missing.
        for (var i = 0; i < spec.usb.length; i++) {
            var f = spec.usb[i];
            if (!f.vendorId || !f.productId) continue;
            await vbox.run(['usbfilter', 'add', String(i), '--target', spec.name,
                '--name', f.name || (f.vendorId + ':' + f.productId),
                '--vendorid', f.vendorId, '--productid', f.productId], { tags: [spec.name] });
        }

        for (var j = 0; j < spec.shares.length; j++) {
            var share = spec.shares[j];
            if (!share.name || !share.hostPath) continue;
            makeDir(share.hostPath);
            await vbox.run(['sharedfolder', 'add', spec.name, '--name', share.name,
                '--hostpath', share.hostPath]
                .concat(share.readOnly ? ['--readonly'] : [])
                .concat(['--auto-mount-point', '']), { tags: [spec.name] });
        }

        //WHAT THE BUILD DECIDED, because two of these are facts the register
        //keeps: which image was resolved and which adapter it was bridged onto.
        //Carried out of the one place that made them rather than worked out
        //again somewhere else.
        return { iso: iso, bridge: bridge, disk: disk, serial: serial };
    }

    //---- starting the disk again -------------------------------------------
    //
    //Detach the disk, destroy it, make an empty one the same size, put it back.
    //Three steps rather than one because VirtualBox will not delete a medium
    //attached to a machine, and will not attach one that does not exist. The
    //order is forced by that rather than chosen.
    async function blankTheDisk(name, spec, say, forget) {
        var to = say || { info: function () {}, warn: function () {} };

        //THE SNAPSHOTS GO FIRST, AND THIS IS NOT TIDINESS.
        //
        //A snapshot is a point on a DISK. Blanking the disk under one leaves a
        //machine that still lists "base" — taken an hour ago, from an operating
        //system that no longer exists — and the register still pointing at it.
        //The queue then sees a machine with a clean point to come back to, takes
        //it, and finds out otherwise at the moment it tries to put it away.
        //
        //Found by somebody reading a card and saying "base says over an hour
        //ago", about a machine reinstalled ten minutes earlier. Nothing failed;
        //it was a lie that had not been called yet.
        try {
            var had = await vbox.snapshots(name);
            //DEEPEST FIRST: a parent cannot go while a child stands on it.
            var deepest = (had.snapshots || []).slice().sort(function (a, b) { return b.depth - a.depth; });
            for (var i = 0; i < deepest.length; i++) {
                to.info('removing "' + deepest[i].name + '" — it is a point on a disk that is about to be thrown away');
                try { await vbox.deleteSnapshot(name, deepest[i].name); }
                catch (e) { to.warn('could not remove "' + deepest[i].name + '": ' + e.message); }
            }
        } catch (e) {
            to.warn('could not read its snapshots before blanking the disk: ' + e.message);
        }

        //CLEARED IN THE REGISTER AS WELL AS IN VirtualBox, because the next
        //dial-in takes a fresh base only if this app believes there is none.
        if (forget) forget();

        var info = await vbox.info(name);
        var disk = info['SATA-0-0'] || spec.disk;
        if (!disk || disk === 'none') {
            to.warn('there is no disk attached to blank; installing onto whatever is there');
            return null;
        }

        to.info('blanking ' + path.basename(disk) + ' so the installer starts from nothing');
        await vbox.run(['storageattach', name, '--storagectl', 'SATA', '--port', '0', '--device', '0',
            '--type', 'hdd', '--medium', 'none'], { tags: [name] });

        //`--delete` REMOVES THE FILE as well as the register entry. Without it
        //the next createmedium fails on a path that is still there, and
        //VirtualBox keeps a registry full of media nobody can account for.
        await vbox.run(['closemedium', 'disk', disk, '--delete'], { timeout: 300000, tags: [name] });
        await vbox.run(['createmedium', 'disk', '--filename', disk,
            '--size', String(spec.diskMB), '--format', 'VDI'], { timeout: 300000, tags: [name] });
        await vbox.run(['storageattach', name, '--storagectl', 'SATA', '--port', '0', '--device', '0',
            '--type', 'hdd', '--medium', disk], { tags: [name] });

        return disk;
    }

    return {
        resolveISO: resolveISO,
        pickBridge: pickBridge,
        hostOnlyAdapter: hostOnlyAdapter,
        buildInVbox: buildInVbox,
        blankTheDisk: blankTheDisk
    };
};
