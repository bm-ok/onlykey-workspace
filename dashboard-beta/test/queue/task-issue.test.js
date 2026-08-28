const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const statePlugin = require('../../src/app/core/state/main');
const makeStore = require('../../src/app/queue/store');

//---------------------------------------------------------------------------
//WHICH GITHUB ISSUE A TASK IS FOR.
//
//THE CLAIM: `issue` survives the store, which is a whitelist. Every other field
//on a task is named in `add`, and a field not named there is dropped without a
//word -- so the one test that matters is that this one is named, and the second
//is that a malformed one becomes null rather than reaching a pull request body
//as `Closes undefined#NaN`.
//---------------------------------------------------------------------------

let store;

beforeEach(async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-issue-'));
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-issue-ws-'));
    let state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dataDir, ...p) } }, async (_e, s) => { state = s.state; });
    state.follow(async () => work);
    store = makeStore({
        tasks: () => state.here.doc('tasks'),
        counter: () => state.here.doc('tasks-highest')
    }, null);
});

test('a well-formed issue is kept, as a fact and not as prose', async () => {
    const made = await store.add({
        title: 'fix it', brief: 'do it', branch: 'fix/it',
        issue: { on: 'someone/their-repo', number: 17 }
    });
    assert.deepEqual(made.issue, { on: 'someone/their-repo', number: 17 });
    //AND IT IS STILL THERE AFTER A READ, not only on the answer to add.
    assert.deepEqual((await store.get(made.id)).issue, { on: 'someone/their-repo', number: 17 });
});

test('a task from nowhere in particular has null, which is most of them', async () => {
    const made = await store.add({ title: 'x', brief: 'y', branch: 'fix/it' });
    assert.equal(made.issue, null);
});

test('a malformed issue is dropped at the door rather than carried', async () => {
    //EACH OF THESE WOULD OTHERWISE REACH A PULL REQUEST BODY as a "Closes" line
    //that names nothing GitHub can find.
    for (const bad of [
        { on: 'x', number: 1 },            // not owner/name
        { on: 'a/b', number: 0 },          // no such issue
        { on: 'a/b', number: 1.5 },        // not an issue number
        { on: 'a/b' },                     // no number at all
        { on: '/b', number: 1 },           // empty owner
        'a/b#1',                           // a string is not the shape the store takes
        7
    ]) {
        const made = await store.add({ title: 'x', brief: 'y', branch: 'fix/it', issue: bad });
        assert.equal(made.issue, null, 'kept a malformed issue: ' + JSON.stringify(bad));
    }
});

test('the number is a number even when it arrived as a string', async () => {
    //A COMMAND LINE HAS NO TYPES, and "17" is what one hands over.
    const made = await store.add({ title: 'x', brief: 'y', branch: 'fix/it', issue: { on: 'a/b', number: '17' } });
    assert.deepEqual(made.issue, { on: 'a/b', number: 17 });
});

test('an update leaves it alone', async () => {
    const made = await store.add({ title: 'x', brief: 'y', branch: 'fix/it', issue: { on: 'a/b', number: 3 } });
    const after = await store.update(made.id, { state: 'given', machine: 'runner-1' });
    assert.deepEqual(after.issue, { on: 'a/b', number: 3 });
});
