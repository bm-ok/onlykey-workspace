const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makePutting = require('../../src/app/queue/putting');

//---------------------------------------------------------------------------
//THE TWO WAYS A MACHINE LEAVES THE QUEUE'S HANDS.
//
//THE CLAIM WORTH THE MOST: putAway never throws. It runs in a `finally`, and a
//failure to tidy up must not replace the error that caused it — losing the real
//reason is how a machine ends up left on and nobody knowing why.
//
//AND THE SECOND: it rolls the machine back at rest, which is what makes the pool
//work at all. A machine that finished a task still CLAIMS that task's branch,
//and a claimed branch means "not free" — so without the rollback the queue
//deadlocks after exactly one task per machine, and nothing says why.
//---------------------------------------------------------------------------

let asked, said, kept, vms, fails;

beforeEach(() => {
    asked = [];
    said = [];
    kept = [];
    fails = {};
    vms = [{ name: 'kit-1', running: true, connected: true, baseSnapshot: 'base' }];
});

function putting(over) {
    return makePutting(Object.assign({
        call: async (what, args) => {
            asked.push(what + (args && args.force ? ' force' : ''));
            if (fails[what]) throw new Error(fails[what]);
            if (what === 'vmList') return { vms: vms };
            if (what === 'vmScreenshot') return { file: 'C:/shots/kit-1.png' };
            return {};
        },
        //ANSWERS AT ONCE and records nothing about clocks — what settle does
        //with time is test/queue/queue-waiting.test.js's job.
        settle: async (spec) => {
            asked.push('settle:' + spec.what);
            const vm = vms.filter((v) => v.name === 'kit-1')[0];
            if (!spec.ok(vm || {})) throw new Error('did not happen');
            return vm;
        },
        keep: (machine, borrowed) => kept.push({ machine, borrowed }),
        now: () => '2026-08-22T13:00:00Z',
        say: () => {
            const to = {
                info: (m) => said.push(m), warn: (m) => said.push('WARN ' + m),
                bad: (m) => said.push('BAD ' + m), good: (m) => said.push(m), on: () => to
            };
            return to;
        }
    }, over || {}));
}

const off = () => { vms[0].running = false; };

//---- putting one away ------------------------------------------------------------

test('the credential is taken back while the machine can still be spoken to', async () => {
    off();
    await putting().putAway('kit-1');

    //THE ROLLBACK WOULD REMOVE THE FILE ANYWAY, but a machine that fails to shut
    //down would then sit there holding a LIVE credential. The point is that it
    //stops existing on that disk, not that the register stops saying so.
    assert.equal(asked[0], 'vmCredentialsForget', asked.join(' | '));
    assert.ok(asked.indexOf('vmCredentialsForget') < asked.indexOf('vmStop'));
});

test('the button first, then the plug', async () => {
    off();
    await putting().putAway('kit-1');

    //`vmStop` PRESSES THE ACPI POWER BUTTON, which is useless on a machine that
    //never got far enough to have anything listening for it.
    assert.ok(asked.includes('vmStop'), asked.join(' | '));
    assert.equal(asked.includes('vmStop force'), false, 'it went straight for the plug');
});

test('and the plug when the button is not answered', async () => {
    //A MACHINE THAT FAILED TO BOOT sat "running" for the whole timeout and was
    //then rolled back while still running, which fails too — and the machine
    //stayed out of the pool.
    let stopped = 0;
    const p = putting({
        call: async (what, args) => {
            asked.push(what + (args && args.force ? ' force' : ''));
            if (what === 'vmStop') { stopped++; if (args && args.force) off(); }
            if (what === 'vmList') return { vms: vms };
            return {};
        }
    });

    await p.putAway('kit-1');

    assert.ok(asked.includes('vmStop force'), asked.join(' | '));
    assert.ok(said.some((m) => /pulling the plug/.test(m)), said.join(' | '));
    assert.ok(asked.includes('vmSnapshotRestore'), 'it never got to the rollback');
});

test('it is rolled back at rest, which is what makes the pool work', async () => {
    off();
    await putting().putAway('kit-1');

    //WITHOUT THIS the queue deadlocks after exactly one task per machine:
    //everything it has ever used is permanently ineligible.
    assert.ok(asked.includes('vmSnapshotRestore'), asked.join(' | '));
    assert.ok(said.some((m) => /rolled back to "base", free for the next task/.test(m)), said.join(' | '));
});

test('a machine still running is not rolled back, and it says so', async () => {
    //ROLLING BACK A RUNNING MACHINE FAILS, and doing it anyway is how one stayed
    //out of the pool with nothing saying why.
    const p = putting({
        call: async (what, args) => {
            asked.push(what + (args && args.force ? ' force' : ''));
            if (what === 'vmList') return { vms: vms };   //still running throughout
            return {};
        },
        settle: async () => { throw new Error('did not happen'); },
        say: () => { const to = { info: (m) => said.push(m), warn: (m) => said.push('WARN ' + m), bad() {}, good() {}, on: () => to }; return to; },
        keep: () => {}
    });

    await p.putAway('kit-1');

    assert.equal(asked.includes('vmSnapshotRestore'), false, 'it rolled back a running machine');
    assert.ok(said.some((m) => /stays out of the pool until somebody does/.test(m)), said.join(' | '));
});

test('a machine with no base snapshot is left alone and said', async () => {
    off();
    vms[0].baseSnapshot = null;
    await putting().putAway('kit-1');

    assert.equal(asked.includes('vmSnapshotRestore'), false);
    assert.ok(said.some((m) => /stays out of the pool/.test(m)));
});

//---- and it never throws -----------------------------------------------------------

test('every step can fail and it still returns', async () => {
    //IT RUNS IN A `finally`. A failure to tidy up must not replace the error
    //that caused it.
    fails = {
        vmCredentialsForget: 'the guest never answered',
        vmStop: 'VirtualBox said no',
        vmList: 'the pipe is down',
        vmSnapshotRestore: 'no such snapshot'
    };

    await assert.doesNotReject(() => putting().putAway('kit-1'));
});

test('and each failure is said rather than swallowed', async () => {
    fails = { vmCredentialsForget: 'the guest never answered', vmList: 'the pipe is down' };
    await putting().putAway('kit-1');

    assert.ok(said.some((m) => /credential was already gone: the guest never answered/.test(m)), said.join(' | '));
    assert.ok(said.some((m) => /could not roll it back: the pipe is down/.test(m)), said.join(' | '));
});

//---- or kept for looking at ----------------------------------------------------------

test('it is not stopped, not rolled back, and not asked for its credential', async () => {
    await putting().keepForLooking('kit-1', 'it stopped answering');

    //MEMORY HOLDS WHAT THE DISK DOES NOT, and taking the credential back needs
    //the guest to answer — which is the thing that is not happening.
    for (const no of ['vmStop', 'vmSnapshotRestore', 'vmCredentialsForget']) {
        assert.equal(asked.includes(no), false, 'it did ' + no + ' to a machine being kept');
    }
});

test('it is marked as held, with the reason and who held it', async () => {
    const out = await putting().keepForLooking('kit-1', 'it stopped answering');

    assert.equal(kept.length, 1);
    assert.equal(kept[0].machine, 'kit-1');
    assert.match(kept[0].borrowed.why, /kept for looking at — it stopped answering/);
    assert.equal(kept[0].borrowed.keptBy, 'the queue');
    assert.equal(out.kept, true);
});

test('the screen is photographed while what is on it is still on it', async () => {
    const out = await putting().keepForLooking('kit-1', 'it stopped answering');
    assert.equal(out.shot, 'C:/shots/kit-1.png');
    assert.ok(said.some((m) => /photographed at C:\/shots\/kit-1\.png/.test(m)), said.join(' | '));
});

test('a screen that could not be photographed does not stop it being kept', async () => {
    fails = { vmScreenshot: 'it has no display' };
    const out = await putting().keepForLooking('kit-1', 'it stopped answering');

    assert.equal(out.shot, null);
    assert.equal(kept.length, 1, 'it gave up on keeping the machine');
});

//---- is it this machine, or is it the room? --------------------------------------------

test('one machine quiet while another answers points at that machine', async () => {
    vms.push({ name: 'kit-2', running: true, connected: true });
    const out = await putting().keepForLooking('kit-1', 'it stopped answering');

    assert.equal(out.alone, false);
    assert.deepEqual(out.answering, ['kit-2']);
    assert.ok(said.some((m) => /kit-2 still answers, so it is that machine rather than the network here/.test(m)),
        said.join(' | '));
});

test('every machine quiet at once points at the room', async () => {
    //IF THE THING HANDING OUT ADDRESSES DIES, every guest loses its footing at
    //once through no fault of its own — and sending somebody into a guest to
    //find a fault that is in the room is a wasted afternoon.
    vms.push({ name: 'kit-2', running: true, connected: false });
    const out = await putting().keepForLooking('kit-1', 'it stopped answering');

    assert.equal(out.alone, true);
    assert.ok(said.some((m) => /look at the network on this host before looking inside that guest/.test(m)),
        said.join(' | '));
});

test('nothing else running is said as nothing to compare against', async () => {
    const out = await putting().keepForLooking('kit-1', 'it stopped answering');
    assert.equal(out.alone, false);
    assert.ok(said.some((m) => /nothing to compare it against/.test(m)), said.join(' | '));
});

test('and if even that cannot be asked, it says less rather than guessing', async () => {
    fails = { vmList: 'the pipe is down' };
    const out = await putting().keepForLooking('kit-1', 'it stopped answering');

    assert.equal(out.alone, false);
    assert.deepEqual(out.answering, []);
    assert.equal(kept.length, 1, 'it gave up on keeping the machine');
});

test('it says what to actually do with the machine afterwards', async () => {
    //A MACHINE HELD WITH NO IDEA HOW TO READ IT is worse than one rolled back:
    //it costs a machine AND answers nothing.
    await putting().keepForLooking('kit-1', 'it stopped answering');

    const all = said.join(' | ');
    assert.match(all, /vmReturn --name kit-1/);
    assert.match(all, /still RUNNING, so its window can be opened in VirtualBox/);
    assert.match(all, /nothing else will touch it until you do/);
});
