const { test } = require('node:test');
const assert = require('node:assert');

const Many = require('../../src/app/github/many');

//---------------------------------------------------------------------------
//asking for a lot of things at once, with a bound.
//
//WHY THIS IS TESTED AT ALL, given how small it is: every claim it makes is one
//a plain `for` loop also satisfies. Order is kept — a loop keeps order. The
//first error is raised — a loop raises the first error. Results come back — a
//loop returns results. So a version of this that quietly stopped being
//concurrent would pass every test anybody would think to write about its
//OUTPUT, and the only thing that would change is the twenty seconds this exists
//to remove.
//
//SO THE CONCURRENCY ITSELF IS MEASURED, by counting how many are in flight at
//the same moment. That is the one check a sequential implementation cannot pass,
//and it is the reason this file is not just the other three.
//---------------------------------------------------------------------------

//A JOB THAT RECORDS HOW MANY OF ITS KIND ARE RUNNING WHILE IT RUNS.
function watched() {
    let now = 0;
    let peak = 0;
    const order = [];
    return {
        peak: () => peak,
        order,
        job: (delay) => async (item) => {
            now++;
            if (now > peak) peak = now;
            await new Promise((r) => setTimeout(r, delay == null ? 5 : delay));
            order.push(item);
            now--;
            return item * 2;
        }
    };
}

test('it needs to be told how many at once', () => {
    assert.throws(() => Many(0), /how many at once/);
    assert.throws(() => Many(), /how many at once/);
    assert.throws(() => Many('lots'), /how many at once/);
});

test('nothing to do is an empty answer rather than a stall', async () => {
    const many = Many(4);
    assert.deepEqual(await many([], async () => 1), []);
    assert.deepEqual(await many(null, async () => 1), []);
});

//---------------------------------------------------------------------------
//THE CHECK A SEQUENTIAL VERSION FAILS.
//---------------------------------------------------------------------------
test('it really does run them at the same time', async () => {
    const w = watched();
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

    await Many(4)(items, w.job());

    assert.equal(w.peak(), 4,
        'at most ' + w.peak() + ' were ever in flight together — this is a loop with extra steps');
});

test('and never more at once than it was told', async () => {
    const w = watched();
    await Many(3)([1, 2, 3, 4, 5, 6, 7, 8, 9], w.job());
    assert.equal(w.peak(), 3, 'it ran ' + w.peak() + ' at once, which is more than the bound it was given');
});

test('a list shorter than the bound does not start workers with nothing to do', async () => {
    const w = watched();
    const out = await Many(8)([1, 2], w.job());
    assert.equal(w.peak(), 2);
    assert.deepEqual(out, [2, 4]);
});

//---------------------------------------------------------------------------
//ORDER, WHICH IS ABOUT WHAT SOMEBODY READS.
//
//The answers are rows on a board. Sorted by whichever request came back first,
//the board reshuffles itself between draws and nobody can follow it.
//---------------------------------------------------------------------------
test('answers come back in the order they were asked for, not the order they finished', async () => {
    const many = Many(4);
    //THE FIRST ONE IS THE SLOWEST, so a pool that pushed results as they landed
    //would put it last.
    const out = await many([1, 2, 3, 4], async (n) => {
        await new Promise((r) => setTimeout(r, n === 1 ? 40 : 1));
        return 'item-' + n;
    });
    assert.deepEqual(out, ['item-1', 'item-2', 'item-3', 'item-4']);
});

test('every item is done exactly once', async () => {
    const seen = [];
    await Many(4)([1, 2, 3, 4, 5, 6, 7], async (n) => { seen.push(n); return n; });
    assert.deepEqual(seen.slice().sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(seen.length, 7, 'something was done twice, or not at all');
});

test('the index is handed over with the item', async () => {
    const out = await Many(2)(['a', 'b', 'c'], async (item, i) => item + i);
    assert.deepEqual(out, ['a0', 'b1', 'c2']);
});

//---------------------------------------------------------------------------
//FAILING THE WAY THE LOOP FAILED.
//---------------------------------------------------------------------------
test('the first failure is raised, and it is first by position rather than by clock', async () => {
    //ITEM 3 FAILS QUICKLY AND ITEM 1 FAILS SLOWLY. In a loop the caller saw item
    //1's error, because item 1 came first. Raising whichever landed first would
    //make the error a caller sees depend on the network.
    const boom = async (n) => {
        if (n === 3) throw new Error('three');
        if (n === 1) { await new Promise((r) => setTimeout(r, 30)); throw new Error('one'); }
        return n;
    };
    await assert.rejects(() => Many(4)([1, 2, 3, 4], boom), /^Error: one$/);
});

test('a failure does not stop the others being done', async () => {
    const done = [];
    await assert.rejects(() => Many(4)([1, 2, 3, 4, 5, 6], async (n) => {
        if (n === 2) throw new Error('no');
        done.push(n);
        return n;
    }));
    assert.deepEqual(done.sort((a, b) => a - b), [1, 3, 4, 5, 6],
        'one failure abandoned work that had nothing to do with it');
});

//---------------------------------------------------------------------------
//AND NOTHING IS LEFT AS A REJECTION NOBODY IS WAITING ON.
//
//This is the one way turning a `for` loop into a pool changes behaviour without
//anybody asking for it: throw at the moment of failure and the requests still in
//flight reject into nowhere. Under node's default that is a warning today and a
//dead process tomorrow.
//---------------------------------------------------------------------------
test('a later failure is not left unhandled after the first one is raised', async () => {
    const loose = [];
    const catcher = (e) => loose.push(e);
    process.on('unhandledRejection', catcher);

    try {
        await assert.rejects(() => Many(4)([1, 2, 3, 4], async (n) => {
            if (n === 1) throw new Error('early');
            //THE OTHERS FAIL AFTERWARDS, which is exactly when a pool that threw
            //on the first one would have stopped listening to them.
            await new Promise((r) => setTimeout(r, 10));
            throw new Error('late ' + n);
        }));

        //LONG ENOUGH FOR ONE TO SURFACE IF IT WAS GOING TO.
        await new Promise((r) => setTimeout(r, 60));
        assert.deepEqual(loose, [], loose.length + ' rejection(s) were left with nobody waiting on them');
    } finally {
        process.removeListener('unhandledRejection', catcher);
    }
});

test('a job that throws synchronously is a failure like any other', async () => {
    await assert.rejects(() => Many(2)([1, 2], () => { throw new Error('right away'); }), /right away/);
});
