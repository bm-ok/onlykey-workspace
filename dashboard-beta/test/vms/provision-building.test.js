const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const makeBuilding = require('../../src/app/vms/provision/building');
const makeSpec = require('../../src/app/vms/provision/spec');

//---------------------------------------------------------------------------
//building the thing in VirtualBox, which is not the same as making a machine.
//
//THE CLAIM WORTH THE MOST: the ORDER holds. Several of these are not one
//command but a sequence that has to happen in a particular way — a disk cannot
//be deleted while it is attached, a snapshot is a point on a disk, a serial port
//can only be added while the machine is off. An order is exactly what a stand-in
//can check and what a comment cannot.
//---------------------------------------------------------------------------

let build, asked, answers, isos, bridges, hostOnlyIfs, made, snaps, said, dirs, serialDir;

const spec = makeSpec({ newToken: () => 'a-token', SUPERVISOR: 'supervisor', POOL: 'default' });

beforeEach(() => {
    asked = [];
    answers = {};
    isos = [];
    bridges = [];
    hostOnlyIfs = [{ name: 'VirtualBox Host-Only Ethernet Adapter' }];
    made = [];
    snaps = { snapshots: [] };
    said = [];
    dirs = [];
    serialDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'okc-build-')), 'serial');

    build = makeBuilding({
        serialDir: function () { return serialDir; },
        there: (p) => !!answers['there:' + p],
        makeDir: (p) => dirs.push(p),
        vbox: {
            run: async (args) => { asked.push(args.join(' ')); return answers[args.join(' ')] || ''; },
            isos: async () => isos,
            bridges: async () => bridges,
            hostOnlyIfs: async () => hostOnlyIfs,
            makeHostOnlyIf: async () => { made.push('made one'); return 'adapter-2'; },
            info: async () => answers.info || { CfgFile: 'C:/vms/one/one.vbox' },
            setSerial: async (name, file) => { asked.push('setSerial ' + name + ' ' + file); return { on: true, file }; },
            snapshots: async () => snaps,
            deleteSnapshot: async (name, snap) => { asked.push('deleteSnapshot ' + name + ' ' + snap); }
        }
    });
});

const to = () => ({ info: (m) => said.push(m), warn: (m) => said.push('WARN ' + m) });
//WHERE SOMETHING WAS ASKED FOR, AND A FAILURE IF IT NEVER WAS.
//
//`findIndex` ANSWERS -1 FOR ABSENT, and -1 is less than every real position — so
//`at('createvm') < at('createmedium')` passed with the createvm removed
//entirely. Every ordering check in this file had that hole: each one would go on
//holding while the step it was ordering against quietly stopped happening, which
//is the opposite of what an order is for.
//
//So asking where something is also asserts that it is there.
const at = (fragment) => {
    const i = asked.findIndex((a) => a.includes(fragment));
    assert.ok(i >= 0, '"' + fragment + '" was never asked for at all — ' + asked.join(' | '));
    return i;
};

//---- what it will be installed from ----------------------------------------

test('a path that is there is used as it is', async () => {
    answers['there:C:/isos/mine.iso'] = true;
    assert.equal(await build.resolveISO('C:/isos/mine.iso'), 'C:/isos/mine.iso');
});

test('part of a name matches one VirtualBox already knows', async () => {
    isos = [{ name: 'ubuntu-24.04-live-server-amd64.iso', location: 'C:/isos/ubuntu.iso' }];
    //SOMEBODY WHO HAS INSTALLED ANYTHING BY HAND has the image registered, and
    //making them find the path again is asking them to look up something the
    //hypervisor could be asked.
    assert.equal(await build.resolveISO('24.04'), 'C:/isos/ubuntu.iso');
    assert.equal(await build.resolveISO('SERVER'), 'C:/isos/ubuntu.iso');
});

test('exactly one image is not a choice', async () => {
    isos = [{ name: 'only.iso', location: 'C:/isos/only.iso' }];
    assert.equal(await build.resolveISO(''), 'C:/isos/only.iso');
});

test('and more than one is, with the refusal naming them', async () => {
    isos = [{ name: 'a.iso', location: 'C:/a.iso' }, { name: 'b.iso', location: 'C:/b.iso' }];
    await assert.rejects(() => build.resolveISO(''), /Choose an installer image.*a\.iso, b\.iso/s);
});

test('nothing matching is refused, and says what there is', async () => {
    isos = [{ name: 'ubuntu.iso', location: 'C:/u.iso' }];
    //"no image matching that" LEAVES SOMEBODY GUESSING at a filename they last
    //saw in a downloads folder.
    await assert.rejects(() => build.resolveISO('debian'), /No installer image matching "debian".*ubuntu\.iso/s);
});

//---- which adapter -----------------------------------------------------------

test('a named adapter that is not there is refused, not quietly replaced', async () => {
    bridges = [{ name: 'Realtek', status: 'Up', ip: '192.168.51.63' }];
    //SOMEBODY WHO SAID WHICH ADAPTER MEANT IT. Using another one puts the
    //machine on a network they did not choose.
    await assert.rejects(() => build.pickBridge('Intel'), /There is no network adapter called "Intel"/);
});

test('otherwise the first one that is up with a real address', async () => {
    bridges = [
        { name: 'Down', status: 'Down', ip: '10.0.0.1' },
        { name: 'NoAddress', status: 'Up', ip: '169.254.11.2' },
        { name: 'Realtek', status: 'Up', ip: '192.168.51.63' }
    ];
    //169.254 IS WHAT AN INTERFACE HAS WHEN IT HAS NO ADDRESS. Bridging onto one
    //is bridging onto nothing.
    assert.equal(await build.pickBridge(), 'Realtek');
});

test('and nothing up at all is refused with what to do instead', async () => {
    bridges = [{ name: 'Down', status: 'Down', ip: '10.0.0.1' }];
    await assert.rejects(() => build.pickBridge(), /Use NAT instead, or say which adapter/);
});

//---- the host-only network ---------------------------------------------------

test('the one that is already there is used, rather than making a second', async () => {
    //ONE NETWORK, EVERY MACHINE ON IT, so "which one is runner4 on" is never a
    //question.
    assert.equal(await build.hostOnlyAdapter(), 'VirtualBox Host-Only Ethernet Adapter');
    assert.deepEqual(made, []);
});

test('and one is made on a host that has never had a machine', async () => {
    hostOnlyIfs = [];
    assert.equal(await build.hostOnlyAdapter(), 'adapter-2');
    assert.deepEqual(made, ['made one']);
});

//---- the build ---------------------------------------------------------------

const aSpec = (extra) => spec.fill(Object.assign({ name: 'one', iso: 'ubuntu' }, extra || {}));

const withIso = () => { isos = [{ name: 'ubuntu.iso', location: 'C:/isos/ubuntu.iso' }]; };

test('it is created, sized, given a disk, and told what to boot', async () => {
    withIso();
    bridges = [{ name: 'Realtek', status: 'Up', ip: '192.168.51.63' }];

    const out = await build.buildInVbox(aSpec(), to());

    assert.equal(out.iso, 'C:/isos/ubuntu.iso');
    assert.equal(out.bridge, 'Realtek');
    assert.equal(out.disk, path.join('C:/vms/one', 'one.vdi'));

    //THE ORDER IS FORCED BY VirtualBox: a controller cannot take a disk that has
    //not been made, and a machine cannot take a controller it does not have.
    assert.ok(at('createvm') < at('createmedium'), asked.join('\n'));
    assert.ok(at('createmedium') < at('storagectl'), asked.join('\n'));
    assert.ok(at('storagectl') < at('storageattach'), asked.join('\n'));
});

test('the disk goes on port 0 and the installer on port 1', async () => {
    withIso();
    bridges = [{ name: 'Realtek', status: 'Up', ip: '192.168.51.63' }];

    await build.buildInVbox(aSpec(), to());

    assert.ok(asked.some((a) => /storagectl one --name SATA .*--portcount 2/.test(a)), asked.join('\n'));
    assert.ok(asked.some((a) => /storageattach one .*--port 0 .*--type hdd/.test(a)), asked.join('\n'));
    assert.ok(asked.some((a) => /storageattach one .*--port 1 .*--type dvddrive/.test(a)), asked.join('\n'));
});

test('every machine gets a second foot on the host-only network', async () => {
    withIso();
    bridges = [{ name: 'Realtek', status: 'Up', ip: '192.168.51.63' }];

    await build.buildInVbox(aSpec(), to());

    //THE CASE THAT MATTERS IS A MACHINE THAT NEVER DIALS IN. On the bridged
    //network its lease came from the router and VirtualBox never saw it; on this
    //one VirtualBox IS the DHCP server, so the lease is a fact it can be asked
    //for, with the machine off if need be.
    const modify = asked.find((a) => a.startsWith('modifyvm one --memory'));
    assert.ok(/--nic2 hostonly/.test(modify), modify);
    assert.ok(/--nic1 bridged --bridgeadapter1 Realtek/.test(modify), modify);
});

test('and a host with no host-only network still builds, saying what was lost', async () => {
    withIso();
    bridges = [{ name: 'Realtek', status: 'Up', ip: '192.168.51.63' }];
    hostOnlyIfs = [];
    build = makeBuilding({
        serialDir: function () { return serialDir; },
        there: () => false,
        makeDir: () => {},
        vbox: {
            run: async (args) => { asked.push(args.join(' ')); return ''; },
            isos: async () => isos, bridges: async () => bridges,
            hostOnlyIfs: async () => [],
            makeHostOnlyIf: async () => { throw new Error('needs elevation'); },
            info: async () => ({ CfgFile: 'C:/vms/one/one.vbox' }),
            setSerial: async () => ({ on: true }),
            snapshots: async () => snaps, deleteSnapshot: async () => {}
        }
    });

    await build.buildInVbox(aSpec(), to());

    const modify = asked.find((a) => a.startsWith('modifyvm one --memory'));
    assert.ok(!/--nic2/.test(modify), modify);
    assert.ok(said.some((m) => /no second way in/.test(m)), said.join(' | '));
});

test('the console is captured from the moment it is built', async () => {
    withIso();
    bridges = [{ name: 'Realtek', status: 'Up', ip: '192.168.51.63' }];

    const out = await build.buildInVbox(aSpec(), to());

    //HERE RATHER THAN AT INSTALL, because this is the one place a VirtualBox
    //machine is built — so there is no second path that can be forgotten. It
    //used to be off unless asked for, and what that produced was an instrument
    //only the drills had.
    assert.equal(out.serial, path.join(serialDir, 'one.log'));
    assert.ok(asked.some((a) => a.startsWith('setSerial one ')), asked.join('\n'));
    assert.ok(dirs.includes(serialDir), dirs.join(','));
});

test('and a console that cannot be captured does not stop the build', async () => {
    withIso();
    bridges = [{ name: 'Realtek', status: 'Up', ip: '192.168.51.63' }];
    build = makeBuilding({
        serialDir: function () { return serialDir; },
        there: () => false, makeDir: () => {},
        vbox: {
            run: async (args) => { asked.push(args.join(' ')); return ''; },
            isos: async () => isos, bridges: async () => bridges,
            hostOnlyIfs: async () => hostOnlyIfs, makeHostOnlyIf: async () => 'x',
            info: async () => ({ CfgFile: 'C:/vms/one/one.vbox' }),
            setSerial: async () => { throw new Error('the port is in use'); },
            snapshots: async () => snaps, deleteSnapshot: async () => {}
        }
    });

    const out = await build.buildInVbox(aSpec(), to());

    //A MACHINE THAT WOULD NOT BE MADE because its console had nowhere to go
    //would be a debugging aid causing the fault it exists to explain.
    assert.equal(out.serial, null);
    assert.ok(out.disk, 'the build did not finish');
    assert.ok(said.some((m) => /could not capture its console/.test(m)), said.join(' | '));
});

test('NAT gets a forwarded port, or there is no way in at all', async () => {
    withIso();
    await build.buildInVbox(aSpec({ network: 'nat' }), to());

    assert.ok(asked.some((a) => /--natpf1 ssh,tcp,127\.0\.0\.1,2222,,22/.test(a)), asked.join('\n'));
});

test('usb filters and shares are attached as it is built, not later', async () => {
    withIso();
    bridges = [{ name: 'Realtek', status: 'Up', ip: '192.168.51.63' }];

    await build.buildInVbox(aSpec({
        usb: [{ vendorId: '1d50', productId: '60fc', name: 'OnlyKey' }, { name: 'no ids' }],
        shares: [{ name: 'src', hostPath: 'C:/shared', readOnly: true }]
    }), to());

    //A MACHINE THAT BOOTS ONCE WITHOUT THEM can do the wrong thing before
    //anybody notices they are missing.
    assert.ok(asked.some((a) => /usbfilter add 0 --target one .*--vendorid 1d50 --productid 60fc/.test(a)), asked.join('\n'));
    //ONE WITH NO IDS IS NOT A FILTER, and is skipped rather than added as one
    //that matches everything.
    assert.equal(asked.filter((a) => a.startsWith('usbfilter')).length, 1);

    assert.ok(asked.some((a) => /sharedfolder add one --name src .*--readonly/.test(a)), asked.join('\n'));
    assert.ok(dirs.includes('C:/shared'), dirs.join(','));
});

//---- starting the disk again -------------------------------------------------

test('the snapshots go first, because a snapshot is a point on a disk', async () => {
    snaps = { snapshots: [
        { name: 'base', depth: 0 },
        { name: 'after-setup', depth: 1 },
        { name: 'deepest', depth: 2 }
    ] };
    answers.info = { CfgFile: 'C:/vms/one/one.vbox', 'SATA-0-0': 'C:/vms/one/one.vdi' };

    let forgot = false;
    await build.blankTheDisk('one', { diskMB: 40960 }, to(), () => { forgot = true; });

    //DEEPEST FIRST: a parent cannot go while a child stands on it.
    const removals = asked.filter((a) => a.startsWith('deleteSnapshot'));
    assert.deepEqual(removals, ['deleteSnapshot one deepest', 'deleteSnapshot one after-setup', 'deleteSnapshot one base']);

    //AND BEFORE THE DISK GOES. Blanking underneath one leaves a machine still
    //listing "base" from an operating system that no longer exists, and the
    //queue takes it as a machine with a clean point to come back to.
    assert.ok(at('deleteSnapshot') < at('closemedium'), asked.join('\n'));

    //CLEARED IN THE REGISTER TOO, because the next dial-in takes a fresh base
    //only if this app believes there is none.
    assert.equal(forgot, true);
});

test('the disk is detached, deleted, remade and put back, in that order', async () => {
    answers.info = { CfgFile: 'C:/vms/one/one.vbox', 'SATA-0-0': 'C:/vms/one/one.vdi' };

    await build.blankTheDisk('one', { diskMB: 40960 }, to(), null);

    //THREE STEPS RATHER THAN ONE because VirtualBox will not delete a medium
    //attached to a machine, and will not attach one that does not exist.
    const detach = asked.findIndex((a) => /storageattach.*--medium none/.test(a));
    const close = at('closemedium');
    const create = at('createmedium');
    const attach = asked.findIndex((a) => /storageattach.*--medium C:/.test(a));

    assert.ok(detach >= 0 && detach < close, asked.join('\n'));
    assert.ok(close < create, asked.join('\n'));
    assert.ok(create < attach, asked.join('\n'));

    //`--delete` REMOVES THE FILE as well as the register entry. Without it the
    //next createmedium fails on a path that is still there.
    assert.ok(asked.some((a) => /closemedium disk .* --delete/.test(a)), asked.join('\n'));
});

test('a machine with no disk attached says so rather than failing', async () => {
    answers.info = { CfgFile: 'C:/vms/one/one.vbox' };

    assert.equal(await build.blankTheDisk('one', { diskMB: 40960 }, to(), null), null);
    assert.ok(said.some((m) => /no disk attached to blank/.test(m)), said.join(' | '));
    assert.equal(asked.filter((a) => a.startsWith('closemedium')).length, 0);
});

test('snapshots that cannot be read do not stop the disk being blanked', async () => {
    build = makeBuilding({
        serialDir: function () { return serialDir; }, there: () => false, makeDir: () => {},
        vbox: {
            run: async (args) => { asked.push(args.join(' ')); return ''; },
            isos: async () => [], bridges: async () => [], hostOnlyIfs: async () => [],
            makeHostOnlyIf: async () => 'x',
            info: async () => ({ CfgFile: 'C:/vms/one/one.vbox', 'SATA-0-0': 'C:/vms/one/one.vdi' }),
            setSerial: async () => ({ on: true }),
            snapshots: async () => { throw new Error('VirtualBox is busy'); },
            deleteSnapshot: async () => {}
        }
    });

    await build.blankTheDisk('one', { diskMB: 40960 }, to(), null);

    assert.ok(said.some((m) => /could not read its snapshots/.test(m)), said.join(' | '));
    assert.ok(asked.some((a) => a.startsWith('closemedium')), asked.join('\n'));
});
