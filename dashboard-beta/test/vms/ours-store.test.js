const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const statePlugin = require('../../src/app/core/state/main');
const makeOurs = require('../../src/app/vms/ours/store');

//---------------------------------------------------------------------------
//the virtual machines this app made, and only those.
//
//THE CLAIM THIS FILE IS FOR: membership comes from the file and never from
//VirtualBox. The app can power off, snapshot, restore and DELETE what this
//lists, so a machine somebody else made must be invisible to it — which is a
//stronger guarantee than remembering to be careful at each action.
//
//AND THE SECOND: an unreadable register is not an empty one. The quiet answer
//is a list with nothing in it, and that means every machine on this host has
//silently become untouchable.
//---------------------------------------------------------------------------

let ours, doc, said, vboxCalls, vboxDefined, vboxRunning, vboxUp, talking, agents;

beforeEach(async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-ours-'));

    let state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dataDir, ...p) } }, async (_e, s) => { state = s.state; });
    doc = state.app.doc('machines');

    said = [];
    vboxCalls = [];
    vboxDefined = [];
    vboxRunning = [];
    vboxUp = true;
    talking = {};
    agents = {};

    ours = makeOurs({
        doc,
        say: (...where) => ({
            bad: (m) => said.push(['bad', where.join('/'), m]),
            info: (m) => said.push(['info', where.join('/'), m])
        }),
        vbox: {
            available: () => vboxUp,
            listAll: async () => { vboxCalls.push('listAll'); return vboxDefined.map((name) => ({ name })); },
            runningAll: async () => { vboxCalls.push('runningAll'); return vboxRunning.map((name) => ({ name })); },
            state: async (name) => { vboxCalls.push('state:' + name); return 'running'; }
        },
        connected: (name) => !!talking[name],
        agentFor: (name) => agents[name] || null,
        now: () => 'a-time'
    });
});

//---- membership ------------------------------------------------------------

test('nothing kept yet is no machines, not a failure', () => {
    assert.deepEqual(ours.read(), []);
    assert.equal(said.length, 0);
});

test('a machine is added, read back, and cannot be added twice', () => {
    ours.add({ name: 'runner1', tags: ['worker'] });

    assert.deepEqual(ours.read().map((v) => v.name), ['runner1']);
    assert.throws(() => ours.add({ name: 'runner1' }), /already has a virtual machine called/);
});

test('a machine with no name is refused, because nothing could address it', () => {
    assert.throws(() => ours.add({ tags: ['worker'] }), /needs a name/);
    assert.deepEqual(ours.read(), []);
});

test('a machine this app did not make is not actionable, and not described', () => {
    ours.add({ name: 'runner1' });

    //DELIBERATELY THE SAME ANSWER for a machine that does not exist and one that
    //exists but was made by somebody else. Saying which would be a way to probe
    //what else is on the host.
    assert.throws(() => ours.get('somebody-elses-vm'),
        /is not a virtual machine this app made, so it will not touch it/);
    assert.throws(() => ours.get('never-existed'),
        /is not a virtual machine this app made, so it will not touch it/);

    assert.equal(ours.has('somebody-elses-vm'), false);
    assert.equal(ours.has('runner1'), true);
});

test('forgetting takes it off the list and says it did not delete anything', () => {
    ours.add({ name: 'runner1' });

    assert.deepEqual(ours.forget('runner1'), { forgotten: 'runner1' });
    assert.deepEqual(ours.read(), []);

    //ONE CLICK APART AND ONLY ONE OF THEM CAN BE UNDONE.
    assert.ok(said.some(([, , m]) => /was not deleted/.test(m)), JSON.stringify(said));
});

test('forgetting one this app did not make is refused, not quietly ignored', () => {
    assert.throws(() => ours.forget('somebody-elses-vm'), /is not a virtual machine this app made/);
});

//---- changing one ----------------------------------------------------------

test('a patch is kept, and the name in it is not', () => {
    ours.add({ name: 'runner1' });
    const vm = ours.update('runner1', { baseSnapshot: 'base', name: 'renamed' });

    //RENAMING IN THE REGISTER ALONE would make the machine unreachable and
    //unforgettable at once — every other action addresses it by this, and so
    //does VirtualBox.
    assert.equal(vm.name, 'runner1');
    assert.equal(ours.get('runner1').baseSnapshot, 'base');
    assert.equal(ours.has('renamed'), false);
});

test('patching one that is not ours changes nothing and says so', () => {
    assert.equal(ours.update('somebody-elses-vm', { baseSnapshot: 'base' }), null);
    assert.deepEqual(ours.read(), []);
});

test('what was written survives being read by a second registry', () => {
    ours.add({ name: 'runner1', tags: ['judge'] });

    //A SECOND READER OVER THE SAME FILE, because the one that wrote it holds
    //nothing in memory that would make this pass by itself.
    const again = makeOurs({ doc, say: () => ({ bad() {}, info() {} }) });
    assert.deepEqual(again.read().map((v) => v.name), ['runner1']);
    assert.deepEqual(again.get('runner1').tags, ['judge']);
});

//---- a register that cannot be read ---------------------------------------

test('an unreadable register is said out loud, not answered as an empty one', () => {
    ours.add({ name: 'runner1' });
    fs.writeFileSync(doc.path, '{ this is not json');

    //THE QUIET ANSWER IS AN EMPTY REGISTRY, and an empty registry means every
    //machine on this host has silently become untouchable.
    assert.deepEqual(ours.read(), []);
    assert.ok(said.some(([kind, , m]) => kind === 'bad' && /no machine is listed until then/.test(m)),
        JSON.stringify(said));
});

test('a lone object where a list was expected is one machine, not none', () => {
    fs.writeFileSync(doc.path, JSON.stringify({ name: 'runner1', tags: ['worker'] }));

    //SOMEBODY EDITED THE FILE BY HAND. Reading it as "there are none" is the
    //worst of the available answers.
    assert.deepEqual(ours.read().map((v) => v.name), ['runner1']);
    assert.equal(said.length, 0);
});

test('a byte-order mark in front of the brace is not corruption', () => {
    fs.writeFileSync(doc.path, '﻿' + JSON.stringify([{ name: 'runner1' }]));
    assert.deepEqual(ours.read().map((v) => v.name), ['runner1']);
});

//---- the list somebody looks at -------------------------------------------

test('VirtualBox is asked for live state and never for who is on the list', async () => {
    ours.add({ name: 'runner1' });
    vboxDefined = ['runner1', 'somebody-elses-vm'];
    vboxRunning = ['runner1', 'somebody-elses-vm'];

    const { vms } = await ours.all();

    //THE MACHINE VirtualBox KNOWS ABOUT AND THIS APP DID NOT MAKE IS INVISIBLE.
    assert.deepEqual(vms.map((v) => v.name), ['runner1']);
    assert.ok(!vboxCalls.includes('state:somebody-elses-vm'), vboxCalls.join(','));
});

test('a machine we wrote down that VirtualBox has lost is defined and missing', async () => {
    ours.add({ name: 'runner1' });
    vboxDefined = [];

    const [vm] = (await ours.all()).vms;

    assert.equal(vm.live, false);
    assert.equal(vm.state, 'missing');
    assert.equal(vm.stage, 'defined');
    //AND IT WAS NOT ASKED ABOUT, because there is nothing there to ask.
    assert.ok(!vboxCalls.some((c) => c.startsWith('state:')), vboxCalls.join(','));
});

test('no VirtualBox at all is not no machines', async () => {
    ours.add({ name: 'runner1' });
    vboxUp = false;

    const answer = await ours.all();

    //A HOST WHERE IT HAS BEEN UNINSTALLED should say so rather than appear to
    //have lost what this app made.
    assert.equal(answer.available, false);
    assert.deepEqual(answer.vms.map((v) => v.name), ['runner1']);
    assert.equal(answer.vms[0].stage, 'defined');
    assert.deepEqual(vboxCalls, []);
});

test('and an empty register says whether VirtualBox is there', async () => {
    vboxUp = false;
    assert.deepEqual(await ours.all(), { available: false, vms: [] });
    vboxUp = true;
    assert.deepEqual(await ours.all(), { available: true, vms: [] });
});

test('connected is the agent talking, which is not VirtualBox saying powered on', async () => {
    ours.add({ name: 'runner1' });
    ours.add({ name: 'runner2' });
    vboxDefined = ['runner1', 'runner2'];
    vboxRunning = ['runner1', 'runner2'];
    talking = { runner1: true };

    const { vms } = await ours.all();
    const by = Object.fromEntries(vms.map((v) => [v.name, v]));

    assert.equal(by.runner1.running, true);
    assert.equal(by.runner2.running, true);
    //BOTH ARE POWERED ON. ONE OF THEM IS TALKING TO US.
    assert.equal(by.runner1.connected, true);
    assert.equal(by.runner2.connected, false);
    assert.equal(by.runner1.stage, 'connected');
    assert.notEqual(by.runner2.stage, 'connected');
});

test('a desktop is a third question again, and connected does not answer it', async () => {
    ours.add({ name: 'runner1' });
    vboxDefined = ['runner1'];
    talking = { runner1: true };
    agents = { runner1: { vm: 'runner1', facts: { desktop: false } } };

    const [vm] = (await ours.all()).vms;

    //THE AGENT STARTS A MINUTE OR TWO BEFORE A GRAPHICAL SESSION EXISTS, so a
    //machine reports itself connected while still showing a splash screen.
    assert.equal(vm.connected, true);
    assert.equal(vm.desktop, false);
});

test('whether it was ever meant to have one is answerable with it switched off', async () => {
    ours.add({ name: 'headless', desktop: false });
    ours.add({ name: 'older' });
    vboxDefined = ['headless', 'older'];

    const by = Object.fromEntries((await ours.all()).vms.map((v) => [v.name, v]));

    assert.equal(by.headless.desktopWanted, false);
    //MISSING MEANS YES, DELIBERATELY: every machine made before this existed was
    //installed from a desktop image and has one.
    assert.equal(by.older.desktopWanted, true);
});

test('what a machine is for comes off its tags, and both is not one thing', async () => {
    ours.add({ name: 'sup1', tags: ['supervisor'] });
    ours.add({ name: 'both1', tags: ['worker', 'judge'] });
    ours.add({ name: 'plain1' });
    vboxDefined = ['sup1', 'both1', 'plain1'];

    const by = Object.fromEntries((await ours.all()).vms.map((v) => [v.name, v]));

    assert.equal(by.sup1.supervisor, true);
    assert.equal(by.sup1.kind, 'supervisor');

    assert.equal(by.both1.judge, true);
    assert.equal(by.both1.kind, null);
    assert.deepEqual(by.both1.kinds, ['worker', 'judge']);
    assert.equal(by.both1.kindSaid, 'worker+judge');

    //AND SILENCE IS STILL NOT AN ANSWER, all the way out to the card.
    assert.deepEqual(by.plain1.kinds, []);
    assert.equal(by.plain1.supervisor, false);
});

test('two lists, one round trip each, rather than two questions per machine', async () => {
    ours.add({ name: 'runner1' });
    ours.add({ name: 'runner2' });
    ours.add({ name: 'runner3' });
    vboxDefined = ['runner1', 'runner2', 'runner3'];

    await ours.all();

    assert.equal(vboxCalls.filter((c) => c === 'listAll').length, 1);
    assert.equal(vboxCalls.filter((c) => c === 'runningAll').length, 1);
});
