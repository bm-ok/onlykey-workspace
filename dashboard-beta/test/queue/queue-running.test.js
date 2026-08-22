const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makeRunning = require('../../src/app/queue/running');
const { outOfTouchTooLong, HOW_LONG_OUT_OF_TOUCH } = require('../../src/app/queue/running');

//---------------------------------------------------------------------------
//WAITING FOR THE WORK ITSELF.
//
//THE CLAIM WORTH THE MOST: a machine that cannot be ASKED is not a machine that
//has FINISHED. This waited by polling, and a failed poll threw — out of here,
//out of the task, and into the finally that puts a machine away. A fifteen
//second network blip powered a machine off and rolled it back mid-run, while
//the work was perfectly fine: detached, still going, and about to be destroyed
//by the thing supervising it.
//
//AND THE SECOND: unreachable and OFF are different. Patience is for a machine
//that lost its network while carrying on working; a powered-off machine is not
//working, and waiting ten minutes to admit that holds it out of the pool for no
//reason. VirtualBox answers that without the guest's help.
//---------------------------------------------------------------------------

let clock, said, to, runs, vm, breaks;

function newClock() {
    let at = 0;
    return { now: () => at, jump: (ms) => { at += ms; }, sleep: async (ms) => { at += ms; } };
}

beforeEach(() => {
    clock = newClock();
    said = [];
    breaks = 0;
    runs = [{ id: 'run-1', state: 'running' }];
    vm = { name: 'kit-1', running: true };
    to = {
        info: (m) => said.push(m), warn: (m) => said.push('WARN ' + m),
        bad: (m) => said.push('BAD ' + m), good: (m) => said.push('GOOD ' + m)
    };
});

function running(over) {
    return makeRunning(Object.assign({
        now: clock.now,
        sleep: clock.sleep,
        call: async (what) => {
            if (what === 'vmRuns') {
                if (breaks > 0) { breaks--; throw new Error('the channel is down'); }
                return { runs };
            }
            if (what === 'vmList') return { vms: vm ? [vm] : [] };
            return {};
        },
        //THE HEARTBEAT IS ./waiting.js's — here it only has to exist and be
        //stopped, which the last test checks.
        ticking: () => ({ done: () => { said.push('heartbeat stopped'); return 0; } })
    }, over || {}));
}

//---- the rule, asked without waiting it out ---------------------------------------

test('ten minutes is the bound, and it can be asked about instantly', () => {
    //A DRILL FOR A TEN-MINUTE BOUND is ten minutes of a machine deliberately
    //kept off the network, per run — which is a drill nobody runs, which is how
    //the property stays unchecked.
    assert.equal(HOW_LONG_OUT_OF_TOUCH, 10 * 60000);

    //NOT LOST IS `null`, NOT ZERO. A timestamp is a number and 0 is a number,
    //so treating falsy as "never lost" reads "lost at the epoch" as fine and
    //waits for ever. Nothing reaches that where Date.now() is real; everything
    //reaches it the moment a test brings its own clock.
    assert.equal(outOfTouchTooLong(null, 999999999), false, 'never lost is not out of touch');
    assert.equal(outOfTouchTooLong(undefined, 999999999), false);
    assert.equal(outOfTouchTooLong(0, HOW_LONG_OUT_OF_TOUCH + 1), true,
        'a machine lost at time zero has still been lost');

    assert.equal(outOfTouchTooLong(1000, 1000 + HOW_LONG_OUT_OF_TOUCH), false, 'exactly the bound is not over it');
    assert.equal(outOfTouchTooLong(1000, 1000 + HOW_LONG_OUT_OF_TOUCH + 1), true);
});

//---- a blip is not the end of the work ----------------------------------------------

test('a poll that fails does not end the run', async () => {
    breaks = 2;
    runs = [{ id: 'run-1', state: 'finished', exit: 0 }];

    const out = await running().waitForRun(to, 'kit-1', 'run-1');

    //THE RUN IS DETACHED AND CARRIES ON REGARDLESS. Being unable to see it is a
    //reason to look again, not a reason to end it.
    assert.equal(out.state, 'finished');
    assert.ok(said.some((m) => /cannot reach kit-1 .* the run is detached/.test(m)), said.join(' | '));
});

test('and it says so once, not once per poll', async () => {
    breaks = 5;
    runs = [{ id: 'run-1', state: 'finished' }];

    await running().waitForRun(to, 'kit-1', 'run-1');

    const complaints = said.filter((m) => /cannot reach kit-1/.test(m));
    assert.equal(complaints.length, 1, 'it complained ' + complaints.length + ' times');
});

test('coming back is said, and says the run was never in doubt', async () => {
    breaks = 3;
    runs = [{ id: 'run-1', state: 'finished' }];

    await running().waitForRun(to, 'kit-1', 'run-1');
    assert.ok(said.some((m) => /GOOD kit-1 is answering again after .* the run was never in doubt, only our view of it/.test(m)),
        said.join(' | '));
});

test('out of touch too long gives up, and says how long', async () => {
    breaks = 1000;   //never answers again

    const out = await running().waitForRun(to, 'kit-1', 'run-1');

    assert.equal(out.state, 'unreachable');
    assert.ok(said.some((m) => /BAD kit-1 has been unreachable for 10 minutes; giving up on run-1/.test(m)),
        said.join(' | '));
});

//---- but off is not unreachable -------------------------------------------------------

test('a machine that is powered off ends the wait at once', async () => {
    //WAITING TEN MINUTES TO ADMIT A MACHINE IS OFF holds it out of the pool for
    //no reason, and VirtualBox can answer it without the guest.
    breaks = 1000;
    vm.running = false;

    const out = await running().waitForRun(to, 'kit-1', 'run-1');

    assert.equal(out.state, 'gone');
    assert.ok(said.some((m) => /not running any more, so run-1 is over however it ended/.test(m)), said.join(' | '));
    //AND IT DID NOT SIT OUT THE TEN MINUTES.
    assert.ok(clock.now() < HOW_LONG_OUT_OF_TOUCH, 'it waited ' + clock.now() + 'ms to notice a machine was off');
});

test('a machine that has vanished entirely is not read as off', async () => {
    //`!still.running` IS TRUE OF undefined, and a machine the list cannot see is
    //a view problem like any other — this is the patient path, not the quick one.
    breaks = 1000;
    vm = null;

    const out = await running().waitForRun(to, 'kit-1', 'run-1');
    assert.equal(out.state, 'unreachable', 'a machine it could not see was reported as powered off');
});

//---- and how a run ends -----------------------------------------------------------------

test('a run that finished comes back with what it finished as', async () => {
    runs = [{ id: 'run-1', state: 'finished', exit: 0 }];
    const out = await running().waitForRun(to, 'kit-1', 'run-1');
    assert.deepEqual(out, { id: 'run-1', state: 'finished', exit: 0 });
});

test('a run that is lost counts as over', async () => {
    //A RUN WHOSE PROCESS IS GONE is not going to produce a result, and waiting
    //for one would hold a machine out of service for the whole afternoon.
    runs = [{ id: 'run-1', state: 'lost' }];
    const out = await running().waitForRun(to, 'kit-1', 'run-1');
    assert.equal(out.state, 'lost');
});

test('a run no longer listed is over, because the machine answered', async () => {
    runs = [{ id: 'something-else', state: 'running' }];
    const out = await running().waitForRun(to, 'kit-1', 'run-1');
    assert.equal(out.state, 'gone');
});

test('a run that goes on too long is abandoned, and the machine put away', async () => {
    const out = await running().waitForRun(to, 'kit-1', 'run-1', 6);

    assert.equal(out.state, 'abandoned');
    assert.ok(clock.now() >= 6 * 3600000, 'it gave up early');
    assert.ok(said.some((m) => /giving up on run-1 after 6 hours/.test(m)), said.join(' | '));
});

//---- and the heartbeat --------------------------------------------------------------------

test('the heartbeat is stopped however the wait ends', async () => {
    runs = [{ id: 'run-1', state: 'finished' }];
    await running().waitForRun(to, 'kit-1', 'run-1');
    assert.ok(said.includes('heartbeat stopped'));

    said.length = 0;
    breaks = 1000;
    await running().waitForRun(to, 'kit-1', 'run-1');
    assert.ok(said.includes('heartbeat stopped'), 'a wait that gave up left its heartbeat running');
});
