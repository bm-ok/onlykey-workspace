const { test } = require('node:test');
const assert = require('node:assert');

const recordPlugin = require('../../src/app/queue/main');

//---------------------------------------------------------------------------
//what is in flight.
//
//THE CLAIM THIS FILE IS FOR: a machine is given one piece of work at a time, and
//the record of that survives everything except the process itself.
//
//The node bundle is rebuilt on every save and this app is developed by saving
//files constantly. A queue that forgot in-flight on a save would hand a machine
//a second task on top of a worker still running in a repository it is still
//writing to — so the record lives in main.js, and what to DO with it lives in
//the half that reloads.
//
//THE CLOCK USED TO BE HERE TOO. It is a job in ../core/cron now, and the checks
//that were in this file went with it — the switch, the tick slot, one-at-a-time,
//and a tick that throws are all rules about REPEATING WORK rather than about the
//queue. See test/core/cron-schedule.test.js.
//
//What stayed is the line worth being able to state: a clock is about time, and
//"which machine is busy" is a fact about the queue. The two needed the same
//lifetime, which is not the same as being the same thing.
//---------------------------------------------------------------------------

async function aRecord() {
    let queue = null;
    await recordPlugin({ log: { on: () => ({ good() {}, warn() {}, bad() {}, info() {} }) } },
        async (_e, s) => { queue = s.queue; });
    return queue;
}

test('it holds nothing to begin with', async () => {
    const queue = await aRecord();

    assert.deepEqual(queue.inFlight(), []);
    assert.deepEqual(queue.doing(), {});
    assert.equal(queue.busy(), 0);
    assert.equal(queue.held('runner1'), null);
});

test('a machine already holding something cannot be claimed again', async () => {
    const queue = await aRecord();

    assert.equal(queue.claim('runner1', 'task #4'), true);

    //THE ONE PLACE THAT DECIDES A MACHINE IS TAKEN, so the one place that can
    //say no. A caller that checked "is it free" and then claimed would have a
    //gap between the two, and the whole point is that there is no gap.
    assert.equal(queue.claim('runner1', 'task #9'), false);
    assert.equal(queue.held('runner1'), 'task #4');
    assert.equal(queue.busy(), 1);
});

test('a second machine is a second claim, not a refusal', async () => {
    const queue = await aRecord();

    assert.equal(queue.claim('runner1', 'task #4'), true);
    assert.equal(queue.claim('runner2', 'judgement #2'), true);

    assert.deepEqual(queue.doing(), { runner1: 'task #4', runner2: 'judgement #2' });
    assert.equal(queue.busy(), 2);
});

test('releasing frees it, and releasing what was never held is not an error', async () => {
    const queue = await aRecord();
    queue.claim('runner1', 'task #4');

    assert.equal(queue.release('runner1'), true);
    assert.equal(queue.held('runner1'), null);
    assert.equal(queue.claim('runner1', 'task #9'), true);

    //A RELEASE OF SOMETHING NOT HELD is what a retry looks like, and it is not a
    //fault: the answer is "it is not held", which is the state the caller wanted.
    assert.equal(queue.release('never-claimed'), false);
});

test('the two readings of the record agree', async () => {
    const queue = await aRecord();
    queue.claim('runner1', 'task #4');
    queue.claim('runner2', 'judgement #2');

    //A LIST FOR DRAWING and A LOOKUP FOR ASKING PER ROW. Two shapes of one fact,
    //and a board built from one while the policy reads the other is how they
    //come to disagree about which machine is free.
    const list = queue.inFlight().sort(function (a, b) { return a.machine < b.machine ? -1 : 1; });
    const lookup = queue.doing();

    assert.deepEqual(list, [
        { machine: 'runner1', doing: 'task #4' },
        { machine: 'runner2', doing: 'judgement #2' }
    ]);
    list.forEach(function (row) { assert.equal(lookup[row.machine], row.doing); });
    assert.equal(queue.busy(), list.length);
});

test('the cadence is stated once, so a board cannot describe a different one', async () => {
    const queue = await aRecord();

    //FIFTEEN SECONDS IS A JUDGEMENT RATHER THAN A KNOB: a machine takes minutes
    //to bring up and hours to work, and anything finer is a process spawned to
    //learn nothing. The queue's cron job is registered with THIS number.
    assert.equal(queue.TICK, 15000);
});

test('the record carries no clock, because the clock is not the queue’s any more', async () => {
    const queue = await aRecord();

    //IF ONE OF THESE COMES BACK there are two answers to "is this host handing
    //out work" — the one here and the one in cron — and they will differ the
    //first time somebody presses a button.
    for (const gone of ['start', 'stop', 'running', 'since', 'does', 'armed']) {
        assert.equal(queue[gone], undefined, gone + ' is still on the record');
    }
});
