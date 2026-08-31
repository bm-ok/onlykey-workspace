const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const afterwards = require('../../src/app/vms/provision/afterwards');
const snapshotting = require('../../src/app/runners/machines/snapshotting');

//---------------------------------------------------------------------------
//THE SECOND TURN: WHAT A PROJECT NEEDS, ON A MACHINE THAT HAS ALREADY BOOTED.
//
//A machine is installed, dials in, and is snapshotted as it was BUILT. For a
//project of any size that is not a machine that can do the work — no toolchain,
//no build inputs — so every task given it would install those again.
//
//THIS IS THE TURN THAT FIXES THAT, and the claims worth the most are the three
//that decide whether a machine is usable afterwards:
//
//  * A FAILURE IS NOT SNAPSHOTTED. Half an installed toolchain becoming the
//    point a machine returns to would put every later task on top of it.
//  * WHAT IT LEAVES BECOMES THE STARTING POINT, or the turn bought nothing —
//    the first rollback would discard all of it.
//  * A WORKSPACE THAT SUPPLIES NOTHING GETS TODAY'S BEHAVIOUR. This app does
//    not know the name of a project, and most workspaces have no such script.
//
//NOTHING HERE TOUCHES A MACHINE. vbox, the channel and the register are all
//stand-ins that record, so the ORDER is what is being tested — which is the
//part that cannot be seen by reading it.
//---------------------------------------------------------------------------

let vms, ran, did, said;

const VM = (over) => Object.assign({
    name: 'r1', baseSnapshot: 'base', snapshots: { base: null }, setupOwed: false
}, over || {});

//WHICH STAGES THE WORKSPACE SUPPLIES. `has(vm, stage)` is the real question
//./scripts.js answers, and its whole point is that absence is normal.
let supplies;

function build(over) {
    return afterwards(Object.assign({
        vbox: {
            start: async (n, how) => { did.push('start:' + n + ':' + how); vms[n].running = true; },
            isOff: async (n) => !vms[n].running,
            stop: async (n, force) => { did.push('stop:' + n + (force ? ':force' : '')); vms[n].running = false; },
            waitUntilOff: async () => true,
            waitUntilUnlocked: async () => true,
            takeSnapshot: async (n, title) => {
                did.push('snapshot:' + title);
                vms[n].snapshots = Object.assign({}, vms[n].snapshots, { [title]: null });
            },
            hostAddress: async () => '10.0.0.1'
        },
        ours: {
            has: (n) => !!vms[n],
            get: (n) => vms[n],
            update: (n, patch) => { Object.assign(vms[n], patch); return vms[n]; }
        },
        channel: {
            run: async (n, command, opts) => {
                ran.push({ name: n, command, what: opts && opts.what });
                did.push('ran:' + (/after-snapshot-user/.test(command) ? 'user' : 'root'));
                return { code: exitCode(command) };
            }
        },
        //THE REAL STAGE NAMES, from the real table. A stand-in with its own
        //idea of what `afterSnapshot` is called is one that passes while the
        //app fetches a file that does not exist.
        scripts: {
            has: (vm, stage) => supplies.indexOf(stage) >= 0,
            STAGES: require('../../src/app/vms/provision/scripts').STAGES
        },
        //THE REGISTER'S OWN FUNCTION, not a copy. What a snapshot does to a
        //record is ../../src/app/runners/machines/snapshotting.js's answer, and
        //this turn leaning on a different one is the drift it warns about.
        recordFor: snapshotting.recordFor,
        baseUrl: { PORT: 7383 },
        now: () => Date.parse('2026-09-01T00:00:00.000Z'),
        say: () => ({
            good: (m) => said.push('good ' + m), warn: (m) => said.push('warn ' + m),
            info: (m) => said.push(m), bad: (m) => said.push('bad ' + m)
        })
    }, over || {}));
}

let failing;
const exitCode = (command) => (failing && new RegExp(failing).test(command) ? 1 : 0);

beforeEach(() => {
    vms = { r1: VM() };
    ran = []; did = []; said = [];
    supplies = ['afterSnapshot', 'afterSnapshotUser'];
    failing = null;
});

//---- whether there is anything to do at all ---------------------------------

test('a workspace that supplies nothing gets no turn, and the machine is not touched', () => {
    //THE COMMON CASE. This app does not know the name of a project, and most
    //workspaces have no script for this — so "nothing to do" has to be an
    //ordinary answer rather than something anything has to catch.
    supplies = [];
    return build().beginAfterBase('r1').then((r) => {
        assert.deepEqual(r, { none: true });
        assert.deepEqual(did, [], 'it started a machine for a turn there was nothing to run in');
        assert.equal(vms.r1.setupOwed, false);
    });
});

test('and one that supplies either half gets the machine started, owing a turn', async () => {
    supplies = ['afterSnapshot'];
    const r = await build().beginAfterBase('r1');

    assert.equal(r.started, true);
    assert.deepEqual(did, ['start:r1:gui']);
    //WRITTEN DOWN, NOT REMEMBERED. The turn is finished on the next dial-in,
    //which may be after this host has been restarted.
    assert.equal(vms.r1.setupOwed, true);
});

test('a machine that will not start still owes the turn, and it is said', async () => {
    //THE DEBT IS WRITTEN DOWN BEFORE THE MACHINE IS STARTED, on purpose: a
    //machine that refuses to come up now has a base snapshot and is usable, and
    //what it is missing is the project's half. Somebody starting it by hand
    //later completes the turn on the dial-in, which only works if the record
    //still says it is owed.
    const it = build({
        vbox: {
            start: async () => { throw new Error('VBoxManage said no'); },
            isOff: async () => true, stop: async () => {}, waitUntilOff: async () => true,
            waitUntilUnlocked: async () => true, takeSnapshot: async () => {},
            hostAddress: async () => '10.0.0.1'
        }
    });

    const out = await it.beginAfterBase('r1');

    assert.equal(out.started, false);
    assert.match(out.why, /VBoxManage said no/);
    assert.equal(vms.r1.setupOwed, true, 'the debt was dropped because the machine would not start');
    assert.ok(said.some((l) => /warn .*could not start it/.test(l)), said.join(' | '));
});

//---- and what happens when it comes back ------------------------------------

test('a machine that owes nothing is left alone', async () => {
    //EVERY DIAL-IN COMES THROUGH HERE, including the ordinary ones. A turn that
    //ran on a machine that did not owe one would set up every machine on every
    //boot for ever.
    assert.deepEqual(await build().runFor('r1'), { notOwed: true });
    assert.deepEqual(did, []);
});

test('one that does runs both halves, in order, root first', async () => {
    //ROOT AND USER ARE SEPARATE STAGES, for the reason ./scripts.js gives about
    //the install pair: mixing them is how a home directory ends up owned by root.
    vms.r1.setupOwed = true;

    await build().runFor('r1');

    assert.deepEqual(did.slice(0, 2), ['ran:root', 'ran:user']);
    assert.equal(ran.length, 2);
});

test('the root half goes through sudo -n, and the user half does not', async () => {
    //`-n` RATHER THAN A PROMPT. There is no terminal on the far end of this, so
    //a password prompt would hang until the timeout instead of failing.
    vms.r1.setupOwed = true;

    await build().runFor('r1');

    const root = ran.find((r) => /after-snapshot\.sh/.test(r.command));
    const user = ran.find((r) => /after-snapshot-user\.sh/.test(r.command));

    assert.match(root.command, /sudo -n bash/);
    assert.ok(!/sudo/.test(user.command), 'the user half was run as root: ' + user.command);
});

test('and it FETCHES the script rather than carrying a copy of it', async () => {
    //WHAT RUNS IS WHAT THE GUEST API SERVES — the same rendered file, from the
    //same search path, an install would have fetched. A copy pasted into the
    //command would be a second reading of a file that is already served.
    vms.r1.setupOwed = true;

    await build().runFor('r1');

    assert.match(ran[0].command, /curl -fsS --cacert/);
    assert.match(ran[0].command, /https:\/\/10\.0\.0\.1:7383\/provision\/after-snapshot\.sh/);
    //AND AS THE MACHINE, with the credentials it already has.
    assert.match(ran[0].command, /\$\{OKC_VM\}:\$\{OKC_TOKEN\}/);
});

test('a host with no address leaves the turn owed rather than guessing one', async () => {
    vms.r1.setupOwed = true;
    const it = build({
        vbox: {
            start: async () => {}, isOff: async () => true, stop: async () => {},
            waitUntilOff: async () => true, waitUntilUnlocked: async () => true,
            takeSnapshot: async () => { did.push('snapshot'); },
            hostAddress: async () => null
        }
    });

    const r = await it.runFor('r1');

    assert.equal(r.failed, 'no address');
    assert.equal(vms.r1.setupOwed, true);
    assert.equal(did.indexOf('snapshot'), -1, 'it snapshotted a machine it never set up');
});

//---- the snapshot, which is the point of the whole turn ---------------------

test('what it leaves becomes the point the machine returns to', async () => {
    //WITHOUT THIS THE TURN BUYS NOTHING. The machine would still roll back to
    //the bare install, and everything just installed would be discarded by the
    //first task that finished on it.
    vms.r1.setupOwed = true;

    const r = await build().runFor('r1');

    assert.equal(r.baseSnapshot, 'set-up');
    assert.equal(vms.r1.baseSnapshot, 'set-up');
    assert.equal(vms.r1.setupOwed, false, 'it still owes a turn it just finished');
});

test('and the machine as it was built is kept, so bare is still reachable', async () => {
    //MOVING WHAT "BACK" MEANS IS NOT THE SAME AS LOSING WHERE IT POINTED. A
    //setup that turns out wrong needs somewhere to go.
    vms.r1.setupOwed = true;

    await build().runFor('r1');

    assert.ok(Object.prototype.hasOwnProperty.call(vms.r1.snapshots, 'base'),
        'the bare snapshot was lost: ' + JSON.stringify(vms.r1.snapshots));
    assert.ok(Object.prototype.hasOwnProperty.call(vms.r1.snapshots, 'set-up'));
});

test('it is snapshotted AT REST, because VirtualBox will not do it running', async () => {
    vms.r1.setupOwed = true;
    vms.r1.running = true;

    await build().runFor('r1');

    assert.ok(did.indexOf('stop:r1') < did.indexOf('snapshot:set-up'),
        'it snapshotted a running machine: ' + did.join(' -> '));
});

//---- and the one that decides whether a machine is usable afterwards --------

test('a HALF-DONE setup is not snapshotted, and the debt is kept', async () => {
    //THE CLAIM WORTH THE MOST. Half an installed toolchain becoming the point a
    //machine returns to would put every later task on top of it, and nothing
    //downstream could tell that from a machine that was set up properly.
    vms.r1.setupOwed = true;
    failing = 'after-snapshot-user';

    const r = await build().runFor('r1');

    assert.equal(r.failed, 'after-snapshot-user.sh');
    assert.equal(did.indexOf('snapshot:set-up'), -1, 'it snapshotted a failed setup');
    assert.equal(vms.r1.baseSnapshot, 'base', 'it moved the base onto a setup that failed');
    assert.equal(vms.r1.setupOwed, true, 'it forgot a turn that did not finish');
});

test('and the failure says which script, and that the machine is unchanged', async () => {
    vms.r1.setupOwed = true;
    failing = 'after-snapshot\\.sh';

    await build().runFor('r1');

    assert.ok(said.some((l) => /bad .*after-snapshot\.sh failed/.test(l)), said.join(' | '));
    assert.ok(said.some((l) => /still returns to "base"/.test(l)), said.join(' | '));
});

test('a machine that owes a turn nothing supplies any more stops owing it', async () => {
    //THE WORKSPACE CHANGED UNDER IT — a script removed, or a different folder
    //opened. Leaving the debt would restart the machine on every dial-in for
    //ever, which is the shape of a loop nobody would find.
    vms.r1.setupOwed = true;
    supplies = [];

    const r = await build().runFor('r1');

    assert.deepEqual(r, { none: true });
    assert.equal(vms.r1.setupOwed, false);
    assert.equal(did.indexOf('snapshot:set-up'), -1);
});
