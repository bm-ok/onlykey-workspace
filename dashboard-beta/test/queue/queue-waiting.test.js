const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makeWaiting = require('../../src/app/queue/waiting');

//---------------------------------------------------------------------------
//WAITING FOR A MACHINE, OUT LOUD.
//
//THE CLAIM WORTH THE MOST: a bound can be checked without waiting it out. A
//six-minute limit verified by waiting six minutes is a check nobody runs, which
//is how a bound stays unverified for a year — so the clock and the looking are
//both arguments, and this whole file runs in milliseconds.
//
//AND THE SECOND: `usual` is what turns a duration into a judgement. "waiting —
//40s" is a queue working; the same line at 6 minutes beside "it usually takes
//about 40s" is a fault, and a reader can tell which without knowing this app.
//---------------------------------------------------------------------------

let clock, said, to, timers;

//A HAND-DRIVEN CLOCK. Nothing here sleeps: `sleep` advances the clock instead,
//which is what makes a ten-minute rule a millisecond test.
function newClock() {
    let at = 0;
    return {
        now: () => at,
        jump: (ms) => { at += ms; },
        sleep: async (ms) => { at += ms; }
    };
}

beforeEach(() => {
    clock = newClock();
    said = [];
    timers = [];
    to = {
        info: (m) => said.push(m),
        warn: (m) => said.push('WARN ' + m),
        bad: (m) => said.push('BAD ' + m),
        good: (m) => said.push(m)
    };
});

function waiting(over) {
    return makeWaiting(Object.assign({
        now: clock.now,
        sleep: clock.sleep,
        every: (ms, fn) => { const t = { ms, fn, live: true, unref() { t.unreffed = true; } }; timers.push(t); return t; },
        stop: (t) => { if (t) t.live = false; }
    }, over || {}));
}

//Fire the heartbeat as many times as the elapsed time would have.
const beat = (n) => { for (let i = 0; i < n; i++) timers.filter((t) => t.live).forEach((t) => t.fn()); };

//---- settling ------------------------------------------------------------------

test('it returns as soon as what it is waiting for is true', async () => {
    let looks = 0;
    const saw = await waiting().settle({
        to, what: 'it to stop', timeout: 60000,
        //RUNNING FOR THE FIRST TWO LOOKS, then not — so this proves it keeps
        //looking rather than answering on whatever it saw first.
        look: async () => { looks++; return { name: 'kit-1', running: looks < 3 }; },
        ok: (vm) => !vm.running
    });

    assert.equal(saw.running, false);
    assert.equal(looks, 3);
});

test('something already true is never reported as having timed out', async () => {
    //CHECKED AFTER LOOKING. A machine that was already off when asked must not
    //be waited on at all, let alone reported as a failure.
    const saw = await waiting().settle({
        to, what: 'it to stop', timeout: 0,
        look: async () => ({ running: false }),
        ok: (vm) => !vm.running
    });
    assert.ok(saw);
});

test('a bound that is passed is a failure naming both times', async () => {
    //"WAITED 6 MINUTES" READS AS A POLICY; "waited 6 minutes, having expected 40
    //seconds" reads as the fault it is.
    await assert.rejects(() => waiting().settle({
        to, what: 'it to dial in', timeout: 6 * 60000, usual: 40000,
        look: async () => ({ connected: false }),
        ok: (vm) => vm.connected
    }), (e) => {
        assert.match(e.message, /Waited 36[0-9]s for it to dial in and it did not happen/);
        assert.match(e.message, /usually takes about 40s/);
        return true;
    });
});

test('and with no usual it says only what it waited', async () => {
    await assert.rejects(() => waiting().settle({
        to, what: 'it to stop', timeout: 1000,
        look: async () => ({ running: true }),
        ok: (vm) => !vm.running
    }), (e) => {
        assert.match(e.message, /Waited \d+s for it to stop/);
        assert.equal(e.message.includes('usually'), false);
        return true;
    });
});

test('nothing to look at is not the same as the thing being ready', async () => {
    //A MACHINE THAT IS GONE would otherwise satisfy `ok` by never being asked —
    //`!vm.running` is true of undefined.
    await assert.rejects(() => waiting().settle({
        to, what: 'it to stop', timeout: 1000,
        look: async () => null,
        ok: (vm) => !vm.running
    }), /did not happen/);
});

//---- saying so while it happens ---------------------------------------------------

test('it says nothing until the first interval, then keeps saying', () => {
    const w = waiting();
    const t = w.ticking(to, 'it to dial in', {});

    //A LINE PER POLL IS A LOG NOBODY READS: the polls are 5s apart and the
    //saying is 30s apart.
    clock.jump(5000); beat(1);
    assert.deepEqual(said, []);

    clock.jump(25000); beat(1);
    assert.deepEqual(said, ['waiting for it to dial in — 30s']);

    clock.jump(30000); beat(1);
    assert.equal(said.length, 2);
    t.done();
});

test('past twice the usual it stops being a progress line and becomes a warning', () => {
    const w = waiting();
    const t = w.ticking(to, 'it to dial in', { usual: 40000 });

    clock.jump(30000); beat(1);
    assert.match(said[0], /^waiting for/);

    clock.jump(60000); beat(1);
    assert.match(said[1], /^WARN still waiting for it to dial in — 90s, and it usually takes about 40s/);
    t.done();
});

test('and finishing late says how many times over it went', () => {
    const w = waiting();
    const t = w.ticking(to, 'it to dial in', { usual: 40000 });

    clock.jump(200000);
    const gone = t.done();

    assert.equal(gone, 200000);
    assert.match(said[said.length - 1], /it to dial in: 200s, about 5x the usual 40s/);
});

test('finishing on time says nothing at all', () => {
    const w = waiting();
    const t = w.ticking(to, 'it to stop', { usual: 40000 });

    clock.jump(10000);
    t.done();
    assert.deepEqual(said, [], 'it commented on a wait that went fine');
});

//---- and the timer never outlives the wait ------------------------------------------

test('the heartbeat is stopped when the wait ends well', async () => {
    const w = waiting();
    await w.settle({
        to, what: 'it to stop', timeout: 1000,
        look: async () => ({ running: false }), ok: (vm) => !vm.running
    });

    assert.deepEqual(timers.filter((t) => t.live), [],
        'a timer is still saying "waiting" about something nothing waits for');
});

test('and when it ends badly, which is when it would be left behind', async () => {
    const w = waiting();
    await assert.rejects(() => w.settle({
        to, what: 'it to stop', timeout: 1000,
        look: async () => ({ running: true }), ok: (vm) => !vm.running
    }));

    assert.deepEqual(timers.filter((t) => t.live), []);
});

test('and when the looking itself throws', async () => {
    const w = waiting();
    await assert.rejects(() => w.settle({
        to, what: 'it to stop', timeout: 1000,
        look: async () => { throw new Error('the pipe is down'); },
        ok: () => true
    }), /the pipe is down/);

    assert.deepEqual(timers.filter((t) => t.live), []);
});

test('the heartbeat cannot hold the process open', () => {
    const w = waiting();
    w.ticking(to, 'it to stop', {});
    //THE THING BEING WAITED FOR IS ON ANOTHER MACHINE; this is only the saying.
    assert.equal(timers[0].unreffed, true);
});
