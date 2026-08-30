const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const statePlugin = require('../../src/app/core/state/main');
const oursPlugin = require('../../src/app/vms/ours/server');
const makeMachines = require('../../src/app/carryover/machines');

//---------------------------------------------------------------------------
//BRINGING THE MACHINES ACROSS, which is the one-way door of the whole port.
//
//Everything else moved behind a relay that kept the other app answering. This is
//where this app stops shadowing and starts owning — so the rules it must keep
//are the ones about not claiming things it has not earned.
//
//THE CLAIM WORTH THE MOST: it never overwrites. A second run brings across what
//is still missing and touches nothing else, so it is safe to run twice and safe
//to run after this app has started using a machine.
//
//AND THE SECOND: a machine being installed by the OTHER app right now does not
//come across. Carrying the flag would make this app report an install it is not
//running; carrying the machine without it would report a machine as ready that
//is not. Both are the same fault — a claim this app has not earned.
//---------------------------------------------------------------------------

let ours, carry, asked;

//A RECORD SHAPED LIKE THE OTHER APP'S, derived fields and all, because dropping
//those is half of what this is for.
function overThere(over) {
    return Object.assign({
        name: 'kit-1',
        tags: ['test', 'worker'],
        serial: 'C:/old/serial/kit-1.log',
        created: '2026-08-16T16:51:22.464Z',
        baseSnapshot: 'base',
        snapshots: { base: null },
        reported: '2026-08-22T01:55:10.413Z',
        branch: null,
        borrowed: null,
        installing: null,
        //---- worked out on every read over there, and here ------------------
        live: true, running: false, state: 'poweroff', stage: 'ready',
        connected: false, desktop: false, kind: null, kinds: ['worker'],
        kindSaid: 'worker', agent: null, holdsCredential: false,
        lastAddress: '192.168.51.221', lastSeenAt: '2026-08-22T01:55:07.994Z',
        spec: {
            name: 'kit-1', cpus: 3, memoryMB: 4096, diskMB: 40960,
            ostype: 'Ubuntu24_LTS_64', network: 'bridged', user: 'okc',
            token: 'a-real-machine-token', sshKey: 'ssh-ed25519 AAAA', password: 'okc'
        }
    }, over || {});
}

beforeEach(async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-carry-'));
    asked = [];

    //A WORKSPACE, WHICH THIS DID NOT USED TO NEED. The register was the host's,
    //so machines could be carried across with no folder open at all. It belongs
    //to the open workspace now — a machine is made FOR some work — so there has
    //to be one to carry them into.
    //
    //`at()` AS WELL AS `follow()`, which is what ../../src/app/workspace does.
    //`follow` is the async answer and `at` is the synchronous one; the register
    //reads through the synchronous door, and a carry that runs before the async
    //answer has landed would be told the workspace is not worked out yet.
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-carry-ws-'));

    let state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dataDir, ...p) } },
        async (_e, s) => { state = s.state; });
    state.follow(async () => work);
    state.at(work);

    const log = { on: function () { const to = { good() {}, warn() {}, bad() {}, info() {}, on: () => to }; return to; } };
    const vbox = { available: () => true, listAll: async () => [], runningAll: async () => [], state: async () => 'poweroff' };

    await oursPlugin({ app: { host: {} }, log, state, vbox, channel: { connected: () => false, list: () => [] } },
        async (_e, s) => { ours = s.ours; });

    carry = (vms, dry) => makeMachines({
        ours,
        there: async (name, args) => { asked.push(name); return vms === null ? null : { vms }; }
    }).carry(dry);
});

//---- what comes across ---------------------------------------------------------

test('a machine arrives with its spec, its tags and where its console is', async () => {
    const r = await carry([overThere()]);

    assert.deepEqual(r.brought.map((b) => b.name), ['kit-1']);

    const vm = ours.get('kit-1');
    assert.equal(vm.name, 'kit-1');
    assert.equal(vm.spec.cpus, 3);
    assert.deepEqual(vm.tags, ['test', 'worker']);
    //TAGS AND SERIAL LIVE AT THE TOP OF A RECORD and are read out of the spec
    //when one is made — see vms/ours/records.js.
    assert.equal(vm.serial, 'C:/old/serial/kit-1.log');
});

test('and with the token, because the channel cannot check a machine without it', async () => {
    await carry([overThere()]);
    //THERE IS NO VERSION OF THIS THAT LEAVES IT BEHIND. What it means is a
    //second copy at this app's data folder — the header says so, and so does
    //the note the action returns.
    assert.equal(ours.get('kit-1').spec.token, 'a-real-machine-token');
});

test('what it has already been through comes with it', async () => {
    await carry([overThere()]);

    const vm = ours.get('kit-1');
    //A MACHINE WITH NO BASE SNAPSHOT IS ONE THE QUEUE WILL NEVER PICK UP, so
    //losing this on the way across would quietly retire every machine.
    assert.equal(vm.baseSnapshot, 'base');
    assert.deepEqual(vm.snapshots, { base: null });
    assert.equal(vm.created, '2026-08-16T16:51:22.464Z', 'it was re-dated on arrival');
    assert.equal(vm.reported, '2026-08-22T01:55:10.413Z');
});

test('a branch it is holding, and a borrow, come with it', async () => {
    await carry([overThere({ branch: 'a-branch', borrowed: 'a-drill' })]);

    const vm = ours.get('kit-1');
    assert.equal(vm.branch, 'a-branch');
    assert.equal(vm.borrowed, 'a-drill');
});

//---- and what does not ----------------------------------------------------------

test('nothing worked out on read is written down', async () => {
    await carry([overThere()]);

    //vms/ours/store.js WORKS ALL OF THESE OUT ON EVERY READ, from VirtualBox and
    //the channel. Writing them down means this app repeating the OTHER app's
    //view of a machine as its own until the next read replaces it.
    //`read()` IS THE RAW LIST AND `all()` IS THE DERIVED ONE — asking the
    //derived one here would be asking the very code that adds these fields
    //whether they are there.
    const stored = ours.read().find((v) => v.name === 'kit-1');
    assert.ok(stored, 'it did not come across at all');

    for (const derived of ['live', 'running', 'state', 'connected', 'kind', 'kinds',
        'kindSaid', 'agent', 'holdsCredential', 'lastAddress', 'lastSeenAt', 'desktop']) {
        assert.equal(Object.prototype.hasOwnProperty.call(stored, derived), false,
            derived + ' was carried across, and it is worked out on every read');
    }
});

test('a machine the other app is installing right now is refused, and named', async () => {
    const r = await carry([overThere({ name: 'mid', installing: '2026-08-22T12:00:00Z' })]);

    //TWENTY-FIVE MINUTES OF UNATTENDED INSTALLER this app did not start, cannot
    //watch and cannot finish.
    assert.deepEqual(r.brought, []);
    assert.equal(r.couldNot.length, 1);
    assert.equal(r.couldNot[0].name, 'mid');
    assert.match(r.couldNot[0].why, /being installed by the other app/);
    assert.equal(ours.has('mid'), false, 'it was written down anyway');
});

test('and the install flag never comes across on its own', async () => {
    await carry([overThere()]);
    const vm = ours.get('kit-1');
    assert.ok(vm.installing == null, 'it arrived claiming to be installing');
    assert.ok(vm.installTicket == null, 'it arrived holding an install ticket');
});

test('a machine with no spec is refused rather than half-written', async () => {
    const r = await carry([{ name: 'empty', tags: [] }]);
    assert.equal(r.brought.length, 0);
    assert.match(r.couldNot[0].why, /no spec over there/);
    assert.equal(ours.has('empty'), false);
});

//---- running it twice --------------------------------------------------------------

test('anything already here is left exactly as it is', async () => {
    await carry([overThere()]);
    ours.update('kit-1', { branch: 'something-this-app-did' });

    const again = await carry([overThere({ branch: 'what-the-other-app-thinks' })]);

    assert.deepEqual(again.brought, []);
    assert.deepEqual(again.already.map((x) => x.name), ['kit-1']);
    //SAFE TO RUN AFTER THIS APP HAS STARTED USING ONE.
    assert.equal(ours.get('kit-1').branch, 'something-this-app-did');
});

test('a second run brings across only what is still missing', async () => {
    await carry([overThere()]);
    const r = await carry([overThere(), overThere({ name: 'kit-2' })]);

    assert.deepEqual(r.brought.map((b) => b.name), ['kit-2']);
    assert.deepEqual(r.already.map((b) => b.name), ['kit-1']);
});

//---- looking before leaping ----------------------------------------------------------

test('a dry run writes nothing at all and says what would happen', async () => {
    const r = await carry([overThere(), overThere({ name: 'kit-2' })], true);

    assert.equal(r.dry, true);
    assert.deepEqual(r.brought.map((b) => b.name), ['kit-1', 'kit-2']);
    assert.deepEqual(ours.read(), [], 'a dry run wrote a machine down');
    assert.match(r.note, /^Nothing was written\./);
});

test('the other app being off is said, rather than read as having no machines', async () => {
    const r = await carry(null);

    //"IT HAS NO MACHINES" AND "IT DID NOT ANSWER" ARE OPPOSITE REPORTS. Reading
    //silence as an empty list is how a carry-over quietly does nothing and says
    //it succeeded.
    assert.equal(r.unreachable, true);
    assert.deepEqual(r.brought, []);
    assert.match(r.note, /did not answer/);
    assert.match(r.note, /has to be running/);
});

test('it asks the other app for its machines, and nothing else', async () => {
    await carry([overThere()]);
    assert.deepEqual(asked, ['vmList']);
});

test('the note says the tokens are now here too', async () => {
    const r = await carry([overThere()]);
    //WORTH KNOWING BEFORE RUNNING IT RATHER THAN AFTER — and the note is where
    //somebody running it from the command line will see it.
    assert.match(r.note, /tokens are now written here/);
});
