const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const statePlugin = require('../../src/app/core/state/main');
const oursPlugin = require('../../src/app/vms/ours/server');
const makeRepairs = require('../../src/app/vms/provision/repairs');

//---------------------------------------------------------------------------
//THE MACHINES THAT ALREADY EXISTED WHEN A RULE ARRIVED.
//
//THE CLAIM WORTH THE MOST: a rule that only applies to machines built from now
//on is a rule with a growing list of exceptions, and the exceptions are
//invisible — the code is right, the new machines are right, and the ones
//somebody actually uses are the old ones.
//
//AND THE SECOND: a machine that is RUNNING is the one that most needs a console
//and the one VirtualBox will not give one to. It has to be said and come back
//round, not skipped silently — which is the whole reason these are jobs rather
//than a step that ran once at startup.
//---------------------------------------------------------------------------

let ours, vbox, deal, said, asked, off;

beforeEach(async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-repair-'));
    said = [];
    asked = [];
    off = {};

    let state = null;

    //A WORKSPACE, WHICH THIS DID NOT USED TO NEED. The machine register was the
    //host's; it belongs to the open workspace now, so there has to be one.
    //`at()` as well as `follow()` because the register reads through the
    //synchronous door -- see ../../src/app/vms/ours/store.js.
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-prov-ws-'));
    await statePlugin({ dataDir: { at: (...p) => path.join(dataDir, ...p) } },
        async (_e, s) => { state = s.state; });
    state.follow(async () => work);
    state.at(work);

    const log = {
        on: function () {
            const to = {
                good: (m) => said.push(m), warn: (m) => said.push('WARN ' + m),
                bad: (m) => said.push('BAD ' + m), info: (m) => said.push(m),
                on: () => to
            };
            return to;
        }
    };

    vbox = {
        available: () => true,
        listAll: async () => [],
        runningAll: async () => [],
        state: async () => 'poweroff',
        isOff: async (name) => {
            if (off[name] === 'unknown') throw new Error('VirtualBox has no such machine');
            return off[name] !== false;
        },
        setSerial: async (name, file) => { asked.push('setSerial ' + name + ' ' + file); }
    };

    await oursPlugin({ app: { host: {} }, log, state, vbox, channel: { connected: () => false, list: () => [] } },
        async (_e, s) => { ours = s.ours; });

    deal = makeRepairs({
        vbox,
        ours,
        say: log.on,
        serialFor: (name) => path.join('C:', 'data', 'serial', name + '.log')
    });
});

function machine(name, extra) {
    ours.add({ name, tags: [] });
    if (extra) ours.update(name, extra);
    return ours.get(name);
}

//---- every machine writes its console somewhere ------------------------------

test('a machine built before the port was attached to every one gets its console', async () => {
    machine('old');

    const r = await deal.consoles();

    assert.deepEqual(r.given, ['old']);
    //THE SAME FILE ./building.js WOULD HAVE CHOSEN, asked for rather than worked
    //out again — two opinions about that is a record naming a file nothing
    //writes to.
    const file = path.join('C:', 'data', 'serial', 'old.log');
    assert.ok(asked.includes('setSerial old ' + file), asked.join(' | '));
    assert.equal(ours.get('old').serial, file);
});

test('a machine that already has one costs no VirtualBox call at all', async () => {
    machine('fine', { serial: 'C:/data/serial/fine.log' });

    assert.equal(await deal.consoles(), null, 'it reported work it did not do');
    assert.deepEqual(asked, [], 'it asked VirtualBox about a machine that needed nothing');
});

test('a running machine is said rather than skipped silently', async () => {
    machine('busy');
    off.busy = false;

    const r = await deal.consoles();

    //VirtualBox WILL NOT ADD A SERIAL PORT TO A RUNNING MACHINE — and that is
    //the machine that most needs one. Being a job rather than a startup step is
    //what turns "next time the app restarts" into "next time it is off".
    assert.deepEqual(r.given, []);
    assert.deepEqual(r.later, ['busy']);
    assert.deepEqual(asked, [], 'it tried to reconfigure a running machine');
    assert.equal(ours.get('busy').serial, null, 'it recorded a console it never attached');
});

test('and it gets one on a later sweep, once it is off', async () => {
    machine('busy');
    off.busy = false;
    await deal.consoles();

    off.busy = true;
    const r = await deal.consoles();
    assert.deepEqual(r.given, ['busy']);
});

test('a machine VirtualBox does not have yet is left to its build', async () => {
    machine('unbuilt');
    off.unbuilt = 'unknown';

    //THE BUILD WILL ATTACH ONE. There is nothing here to fix and nothing to
    //report, and an error would be about a machine that is simply not made yet.
    assert.equal(await deal.consoles(), null);
    assert.deepEqual(asked, []);
});

test('one machine that cannot be given a console does not stop the others', async () => {
    machine('a');
    machine('b');
    vbox.setSerial = async (name) => {
        asked.push('setSerial ' + name);
        if (name === 'a') throw new Error('VirtualBox said no');
    };

    const r = await deal.consoles();

    assert.deepEqual(r.given, ['b'], said.join(' | '));
    assert.ok(said.some((m) => /WARN.*VirtualBox said no/.test(m)), said.join(' | '));
    assert.equal(ours.get('a').serial, null, 'it recorded a console that was refused');
});

test('a host with no VirtualBox has nothing to repair and says nothing', async () => {
    machine('old');
    vbox.available = () => false;

    assert.equal(await deal.consoles(), null);
    assert.deepEqual(asked, []);
    assert.deepEqual(said, []);
});

//---- and every machine is in a pool -------------------------------------------

test('a machine that predates the idea is put in the ordinary pool', () => {
    machine('old');
    ours.update('old', { tags: [] });

    const r = deal.pools();

    assert.deepEqual(r.given, ['old']);
    assert.deepEqual(ours.get('old').tags, [ours.POOL]);
});

test('a supervisor is left alone, by carrying a tag rather than by a clause', () => {
    machine('sup', { tags: [ours.SUPERVISOR] });

    //IT NEEDS NO CLAUSE OF ITS OWN TO STAY OUT: it is not tagless. The version
    //this comes from had one anyway and it was unreachable — it tested for the
    //supervisor tag after returning early for any machine with tags at all.
    assert.equal(deal.pools(), null);
    assert.deepEqual(ours.get('sup').tags, [ours.SUPERVISOR]);
});

test('a machine already in some other pool is not moved into the ordinary one', () => {
    machine('gpu', { tags: ['gpu'] });

    assert.equal(deal.pools(), null);
    assert.deepEqual(ours.get('gpu').tags, ['gpu']);
});

test('nothing to do is reported as nothing, not as a sweep that did something', () => {
    assert.equal(deal.pools(), null);
});
