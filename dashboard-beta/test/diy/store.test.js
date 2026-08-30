const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makeStore = require('../../src/app/diy/store');

//---------------------------------------------------------------------------
//WHAT IS KEPT ABOUT A PIECE OF WORK OF MY OWN, AND THE TWO RULES ON IT.
//
//THE RULES ARE THE POINT OF THIS FILE. The pane already declines to offer a
//taken cut and draws the cut field disabled once it is set — but a rule the
//window enforces alone is a rule the command line does not have, so both are
//refused here and this is what says so.
//
//THE DOCUMENT IS A STAND-IN THAT ANSWERS THE WAY THE REAL ONE DOES: `doc()` is
//ASYNC, because ../core/state resolves which workspace is open on every call,
//and a synchronous fake would let a store pass that could never read anything
//in the app.
//---------------------------------------------------------------------------

let kept, reads, writes;

function doc() {
    //ASYNC, LIKE state.here.doc. And it hands back a NEW object each time, the
    //way the real one does, so nothing can accidentally hold it.
    return Promise.resolve({
        read: function (fallback) { reads++; return kept === null ? fallback : JSON.parse(JSON.stringify(kept)); },
        write: function (v) { writes++; kept = JSON.parse(JSON.stringify(v)); return v; }
    });
}

beforeEach(() => { kept = null; reads = 0; writes = 0; });

//---- starting one ----------------------------------------------------------

test('a piece of work needs a title, and says why', async () => {
    const s = makeStore(doc);
    await assert.rejects(() => s.start({ notes: 'no name on it' }), /title — it is what the list shows/);
    assert.equal(writes, 0, 'nothing should have been kept');
});

test('it keeps what it was given, and starts open with no machine', async () => {
    const s = makeStore(doc);
    const it = await s.start({ title: 'flat workspace layout', notes: 'build from siblings', cut: 'diy/flat' });

    assert.equal(it.title, 'flat workspace layout');
    assert.equal(it.notes, 'build from siblings');
    assert.equal(it.cut, 'diy/flat');
    assert.equal(it.state, 'open');
    assert.equal(it.machine, null);
    assert.ok(it.madeAt);

    assert.deepEqual((await s.all()).map((x) => x.title), ['flat workspace layout']);
});

test('a cut is optional — writing it down comes before knowing where it goes', async () => {
    const s = makeStore(doc);
    const it = await s.start({ title: 'try the new key path' });
    assert.equal(it.cut, null);
});

test('two started in a row do not share an id', async () => {
    const s = makeStore(doc);
    const a = await s.start({ title: 'one' });
    const b = await s.start({ title: 'two' });

    //A CLOCK WOULD PASS THIS ONLY BY BEING SLOW. What a shared id breaks is not
    //the second one, it is every later edit — which would change both.
    assert.notEqual(a.id, b.id);
    assert.equal((await s.all()).length, 2);
});

//---- one piece of work per cut ---------------------------------------------

test('a cut that belongs to something else is refused, and it is named', async () => {
    const s = makeStore(doc);
    await s.start({ title: 'flat workspace layout', cut: 'diy/flat' });

    await assert.rejects(
        () => s.start({ title: 'something else', cut: 'diy/flat' }),
        (e) => {
            assert.match(e.message, /already belongs to "flat workspace layout"/);
            //THE REFUSAL SAYS WHAT IT IS PROTECTING. "One per cut" alone reads
            //as tidiness; the reason it is a rule is that the second one can
            //destroy the first one's work by giving its machine back.
            assert.match(e.message, /roll away/);
            return true;
        }
    );

    assert.equal((await s.all()).length, 1);
});

test('two pieces of work on two cuts are fine', async () => {
    const s = makeStore(doc);
    await s.start({ title: 'one', cut: 'diy/a' });
    await s.start({ title: 'two', cut: 'diy/b' });
    assert.equal((await s.all()).length, 2);
});

//---- changing one ----------------------------------------------------------

test('the title and the notes can be rewritten', async () => {
    const s = makeStore(doc);
    const it = await s.start({ title: 'frist go', notes: 'typo above' });

    const now = await s.change(it.id, { title: 'first go', notes: 'fixed' });
    assert.equal(now.title, 'first go');
    assert.equal(now.notes, 'fixed');
    assert.ok(now.changedAt);
});

test('what is not mentioned is left alone', async () => {
    const s = makeStore(doc);
    const it = await s.start({ title: 'a', notes: 'worth keeping', cut: 'diy/a' });

    const now = await s.change(it.id, { title: 'b' });

    //THE SHAPE THIS KIND OF FUNCTION USUALLY FAILS IN. `a.notes || ''` blanks a
    //description for a caller that only sent a title, and nothing complains.
    assert.equal(now.notes, 'worth keeping');
    assert.equal(now.cut, 'diy/a');
});

test('a title cannot be rewritten to nothing', async () => {
    const s = makeStore(doc);
    const it = await s.start({ title: 'a' });
    await assert.rejects(() => s.change(it.id, { title: '   ' }), /title/);
    assert.equal((await s.get(it.id)).title, 'a');
});

//---- the cut is fixed once it is set ---------------------------------------

test('a cut that is set cannot be changed, and the refusal says what it would orphan', async () => {
    const s = makeStore(doc);
    const it = await s.start({ title: 'flat workspace layout', cut: 'diy/flat' });

    await assert.rejects(
        () => s.change(it.id, { cut: 'diy/somewhere-else' }),
        (e) => {
            assert.match(e.message, /cannot be changed once it is set/);
            assert.match(e.message, /leave that behind/);
            return true;
        }
    );

    assert.equal((await s.get(it.id)).cut, 'diy/flat');
});

test('sending the cut it already has is not a change', async () => {
    const s = makeStore(doc);
    const it = await s.start({ title: 'a', cut: 'diy/a' });

    //THE EDIT DIALOG SUBMITS THE DISABLED FIELD, so the value comes back
    //unchanged on every save. Treating that as an attempt to change it would
    //make the Edit button refuse every time it was pressed.
    const now = await s.change(it.id, { title: 'a2', cut: 'diy/a' });
    assert.equal(now.title, 'a2');
    assert.equal(now.cut, 'diy/a');
});

test('one that never had a cut can be given one', async () => {
    const s = makeStore(doc);
    const it = await s.start({ title: 'try the new key path' });

    const now = await s.change(it.id, { cut: 'diy/app-key-path' });
    assert.equal(now.cut, 'diy/app-key-path');
});

test('and it still cannot take one that belongs to something else', async () => {
    const s = makeStore(doc);
    await s.start({ title: 'first', cut: 'diy/flat' });
    const it = await s.start({ title: 'second' });

    await assert.rejects(() => s.change(it.id, { cut: 'diy/flat' }), /already belongs to "first"/);
    assert.equal((await s.get(it.id)).cut, null);
});

//---- done, and the machine -------------------------------------------------

test('it is open or done and nothing else', async () => {
    const s = makeStore(doc);
    const it = await s.start({ title: 'a' });

    assert.equal((await s.change(it.id, { state: 'done' })).state, 'done');
    assert.equal((await s.change(it.id, { state: 'open' })).state, 'open');
    await assert.rejects(() => s.change(it.id, { state: 'finished' }), /"open" or "done"/);
});

test('a machine can be taken on and given back', async () => {
    const s = makeStore(doc);
    const it = await s.start({ title: 'a' });

    assert.equal((await s.change(it.id, { machine: 'beta-diy1' })).machine, 'beta-diy1');

    //GIVING ONE BACK HAS TO BE SAYABLE, which is why null is a value here and
    //not the same as leaving it out.
    assert.equal((await s.change(it.id, { machine: null })).machine, null);
});

test('changing something that is not there is refused by name', async () => {
    const s = makeStore(doc);
    await assert.rejects(() => s.change('diy-99', { title: 'a' }), /no piece of work called "diy-99"/);
});

//---- what the pickers need -------------------------------------------------

test('it says which cuts are spoken for, and by what', async () => {
    const s = makeStore(doc);
    await s.start({ title: 'flat workspace layout', cut: 'diy/flat' });
    await s.start({ title: 'no cut on this one' });

    const held = await s.cutsTaken();
    assert.deepEqual(Object.keys(held), ['diy/flat']);
    assert.equal(held['diy/flat'].title, 'flat workspace layout');
});

test('forgetting one takes it out, and forgetting nothing says so', async () => {
    const s = makeStore(doc);
    const it = await s.start({ title: 'a' });

    assert.equal(await s.forget(it.id), true);
    assert.equal((await s.all()).length, 0);
    assert.equal(await s.forget(it.id), false);
});

test('an empty drawer reads as no pieces of work rather than throwing', async () => {
    const s = makeStore(doc);
    assert.deepEqual(await s.all(), []);
    assert.equal(await s.get('diy-1'), null);
    assert.deepEqual(await s.cutsTaken(), {});
});
