const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const statePlugin = require('../../src/app/core/state/main');
const oursPlugin = require('../../src/app/vms/ours/server');
const settling = require('../../src/app/vms/provision/settling');

//---------------------------------------------------------------------------
//WHAT HAPPENS AS A MACHINE COMES UP.
//
//THE CLAIM WORTH THE MOST: a machine gets its base snapshot without anybody
//remembering to ask. A machine with none cannot be put away clean, so the queue
//correctly never picks it up — and "the queue is ignoring my new machine" looks
//exactly like "the queue has nothing to do".
//
//AND THE SECOND: the guest's word and this app's word are two different facts.
//../../src/app/vms/ours/store.js DERIVES `stage` on every read, so the guest's
//report has to be kept somewhere else or it is overwritten by the derivation
//that was supposed to be reading it.
//---------------------------------------------------------------------------

let ours, vbox, deal, said, asked, waits, unlocked;

//A HAND-DRIVEN CLOCK. `after` records the callback rather than running it, so a
//test says WHEN the five seconds pass. Sleeping for real would make this file
//slow and — worse — make a failure look like a hang.
let pending;

beforeEach(async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-settle-'));
    said = [];
    asked = [];
    waits = { off: true };
    unlocked = 0;
    pending = null;

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
        isOff: async () => waits.off,
        stop: async (name, hard) => { asked.push('stop ' + name + (hard ? ' hard' : ' asked')); },
        waitUntilOff: async () => { asked.push('waitUntilOff'); return waits.stops !== false; },
        waitUntilUnlocked: async () => { unlocked++; asked.push('waitUntilUnlocked'); },
        takeSnapshot: async (name, title) => { asked.push('takeSnapshot ' + name + ' ' + title); }
    };

    await oursPlugin({ app: { host: {} }, log, state, vbox, channel: { connected: () => false, list: () => [] } },
        async (_e, s) => { ours = s.ours; });

    deal = settling({
        vbox,
        ours,
        say: log.on,
        //RECORDED, NOT RUN. The test fires it.
        after: (ms, fn) => { pending = { ms, fn }; }
    });
});

//ADDED, THEN UPDATED. `add` takes a SPEC and builds a record from it, so
//`installing` and `baseSnapshot` — which are facts about a machine rather than
//things it was asked to be — do not survive being passed in. Writing them the
//way the app writes them is also the only way this test proves anything.
function machine(extra) {
    const vm = ours.add({ name: 'one', tags: [] });
    return extra ? ours.update('one', extra) : vm;
}

//A BOUND ON EVERY WAIT, because an unsettled promise HANGS rather than fails,
//and a hang cannot be reported. The first draft of this file awaited a promise
//that nothing would ever resolve and took the whole runner down with it — the
//suite printed four results and then sat there until it was killed.
function within(what, p) {
    return Promise.race([
        p,
        new Promise((_, no) => setTimeout(
            () => no(new Error(what + ' never settled — something is waiting on what this was meant to drive')),
            5000).unref())
    ]);
}

//---- what the guest says about itself ---------------------------------------

test('a name this app does not know is ignored rather than refused', () => {
    //ANYTHING CAN REACH THE PORT AN INSTALL REPORTS TO. A stranger claiming to
    //be at stage "online" should change nothing here, and should not be an
    //error either — an error invites a retry loop from something we do not know.
    assert.deepEqual(deal.report('a-stranger', 'online'), { ignored: true });
    assert.deepEqual(ours.read(), []);
});

test("the guest's word is kept as its own fact, not as the app's stage", () => {
    machine();
    deal.report('one', 'partitioning');

    //`said` RATHER THAN `stage`. ../../src/app/vms/ours/store.js derives `stage`
    //on every read, so writing the guest's word there would be overwritten by
    //the very thing meant to be reporting it — and the Runners tab showed
    //"installing — installing" because of exactly that.
    const vm = ours.get('one');
    assert.equal(vm.said, 'partitioning');
    assert.equal(vm.stage, undefined, 'the guest must not write the derived stage');
    assert.ok(vm.reported, 'it records when it heard from the machine');
});

test('an install still running is not marked finished by a progress report', () => {
    machine({ installing: true });

    deal.report('one', 'partitioning');
    assert.equal(ours.get('one').installing, true,
        'a stage part-way through an install cleared the flag, so it read as finished');
});

test('and "online" is the one word that ends the install', () => {
    machine({ installing: true });

    deal.report('one', 'online');
    assert.equal(ours.get('one').installing, null);
});

//---- the first clean starting point ------------------------------------------

test('a machine that already has one is left alone — and is still await-able', async () => {
    machine({ baseSnapshot: 'base' });

    //ALWAYS A PROMISE, ON EVERY PATH. The version this comes from returned
    //`undefined` here, a caller wrote `.catch` on it, and the TypeError that
    //threw was swallowed by a handler that says nothing — so for every machine
    //older than its first boot, every line after that call silently never ran.
    const r = deal.firstSnapshotIfItNeedsOne('one');
    assert.ok(r && typeof r.then === 'function', 'it must be await-able on every path');
    assert.deepEqual(await within('the already-has-one path', r), { already: true });

    assert.equal(pending, null, 'nothing was scheduled');
    assert.deepEqual(asked, []);
});

test('a machine still installing is left alone; it will dial in again', async () => {
    machine({ installing: true });

    assert.deepEqual(await within('the still-installing path', deal.firstSnapshotIfItNeedsOne('one')), { installing: true });
    assert.equal(pending, null);
});

test('a machine that has never been put away gets its snapshot without being asked', async () => {
    machine();
    waits.off = true;

    const running = deal.firstSnapshotIfItNeedsOne('one');

    //DETACHED, because snapshotting stops the machine and this runs inside the
    //handler that has just made it reachable.
    assert.ok(pending, 'it did not schedule anything');
    assert.equal(pending.ms, 5000);
    pending.fn();

    assert.deepEqual(await within('the scheduled snapshot', running), { name: 'one', baseSnapshot: 'base' });
    assert.equal(ours.get('one').baseSnapshot, 'base');
    assert.ok(asked.includes('takeSnapshot one base'), asked.join(' | '));
});

test('a snapshot that cannot be taken is said, and does not reject', async () => {
    machine();
    vbox.takeSnapshot = async () => { throw new Error('VirtualBox said no'); };

    const running = deal.firstSnapshotIfItNeedsOne('one');
    pending.fn();

    //IT NEVER REJECTS. The machine is installed either way, and a rejection
    //from a detached call lands nowhere anybody reads.
    const r = await within('the failing snapshot', running);
    assert.match(r.failed, /VirtualBox said no/);

    //AND IT NAMES THE WAY OUT, because a machine with no snapshot is one the
    //queue will silently never pick up.
    assert.ok(said.some((m) => /vmBaseSnapshot/.test(m)), said.join(' | '));
});

//---- taking one by hand ------------------------------------------------------

test('a running machine is asked to stop, waited for, and unlocked before snapshotting', async () => {
    machine();
    waits.off = false;

    await within('base()', deal.base('one'));

    //POWERED OFF IS NOT UNLOCKED. VirtualBox holds the lock for a moment after
    //the machine is down, and snapshotting into it fails.
    const order = ['stop one asked', 'waitUntilOff', 'waitUntilUnlocked', 'takeSnapshot one base'];
    const at = (w) => {
        const i = asked.indexOf(w);
        assert.ok(i >= 0, w + ' never happened: ' + asked.join(' | '));
        return i;
    };
    for (let i = 1; i < order.length; i++) {
        assert.ok(at(order[i - 1]) < at(order[i]),
            order[i - 1] + ' must come before ' + order[i] + ': ' + asked.join(' | '));
    }
});

test('one that will not shut down has its power pulled rather than being skipped', async () => {
    machine();
    waits.off = false;
    waits.stops = false;   //it never goes off when asked

    await within('base()', deal.base('one'));

    assert.ok(asked.includes('stop one hard'), asked.join(' | '));
    //IT STILL GETS ITS SNAPSHOT. A machine that will not stop and is therefore
    //never given a starting point is one the queue ignores forever.
    assert.ok(asked.includes('takeSnapshot one base'), asked.join(' | '));
    assert.ok(said.some((m) => /pulling the power/.test(m)), said.join(' | '));
});

test('a machine that is already off is not stopped again', async () => {
    machine();
    waits.off = true;

    await within('base()', deal.base('one'));

    assert.ok(!asked.some((a) => a.indexOf('stop ') === 0), asked.join(' | '));
    assert.equal(unlocked, 0, 'nothing was locked, so nothing was waited on');
    assert.ok(asked.includes('takeSnapshot one base'));
});

test('the register records the snapshot, so the queue can see it can be put away', async () => {
    machine();
    await within('base()', deal.base('one', 'clean'));

    const vm = ours.get('one');
    assert.equal(vm.baseSnapshot, 'clean');
    assert.deepEqual(vm.snapshots, { clean: null });
});
