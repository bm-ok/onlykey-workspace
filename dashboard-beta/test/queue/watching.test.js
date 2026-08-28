const { test } = require('node:test');
const assert = require('node:assert');

const makeWatching = require('../../src/app/queue/watching');

//---------------------------------------------------------------------------
//WHETHER TO LOOK AT GITHUB THIS TICK.
//
//The tick asks every fifteen seconds and a sweep is every five minutes; the
//whole of this file is the gap between those two numbers, plus off and
//already-running. Time is a function so a test can move it.
//---------------------------------------------------------------------------

//A TICK, AS THE QUEUE TICKS: the decision, then a turn of the event loop. The
//sweep's own chain finishes a few microtasks after the decision resolves, and
//two ticks are fifteen seconds apart in life -- a test that calls twice inside
//one microtask is testing something the app never does.
async function tick(w) {
    const r = await w.watch();
    await new Promise((res) => setImmediate(res));
    return r;
}

function aWatch(over) {
    const o = Object.assign({ on: true, t: 0, every: 5 * 60 * 1000 }, over || {});
    const swept = [];
    let release = null;
    const watch = makeWatching({
        on: typeof o.on === 'function' ? o.on : () => o.on,
        now: () => o.t,
        every: o.every,
        sweep: () => { swept.push(o.t); return o.hang ? new Promise((r) => { release = r; }) : Promise.resolve(); },
        warn: (t) => (o.warned = o.warned || []).push(t)
    });
    return { watch, swept, o, release: () => release && release() };
}

test('on and never looked: it sweeps, and then not again within five minutes', async () => {
    const w = aWatch({});
    assert.equal(await tick(w), true);
    assert.equal(w.swept.length, 1);
    //TWO TICKS TEN SECONDS APART: one call. The sabotage this file exists for.
    w.o.t = 10 * 1000;
    assert.equal(await tick(w), false);
    w.o.t = 4 * 60 * 1000;
    assert.equal(await tick(w), false);
    assert.equal(w.swept.length, 1, 'it swept again inside the interval');
    w.o.t = 5 * 60 * 1000;
    assert.equal(await tick(w), true);
    assert.equal(w.swept.length, 2);
});

test('off means never, however long it has been', async () => {
    const w = aWatch({ on: false, t: 10 * 60 * 60 * 1000 });
    assert.equal(await tick(w), false);
    assert.equal(w.swept.length, 0);
});

test('the setting is read every time, not once', async () => {
    //TURNING IT OFF HAS TO STOP IT, and turning it on has to start it, without
    //a restart in between.
    let on = false;
    const w = aWatch({ on: () => on });
    assert.equal(await tick(w), false);
    on = true;
    assert.equal(await tick(w), true);
    on = false;
    w.o.t = 10 * 60 * 1000;
    assert.equal(await tick(w), false);
});

test('a setting that answers with a promise is fine, because settings live on disk', async () => {
    const w = aWatch({ on: () => Promise.resolve(true) });
    assert.equal(await tick(w), true);
});

test('not while one is still running', async () => {
    const w = aWatch({ hang: true });
    assert.equal(await tick(w), true);
    w.o.t = 10 * 60 * 1000;
    assert.equal(await tick(w), false, 'a second sweep started while the first was in flight');
    w.release();
    await new Promise((r) => setImmediate(r));
    w.o.t = 20 * 60 * 1000;
    assert.equal(await tick(w), true);
});

test('a sweep that fails is warned about and does not wedge the watch', async () => {
    const o = { on: true, t: 0 };
    const warned = [];
    const watch = makeWatching({
        on: () => true, now: () => o.t, every: 1000,
        sweep: () => Promise.reject(new Error('GitHub said no')),
        warn: (t) => warned.push(t)
    });
    assert.equal(await watch(), true);
    await new Promise((r) => setImmediate(r));
    assert.match(warned[0], /GitHub said no/);
    o.t = 2000;
    assert.equal(await watch(), true, 'a failed sweep left the watch marked as running for ever');
});
