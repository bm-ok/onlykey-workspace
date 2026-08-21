const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const statePlugin = require('../../src/app/core/state/main');
const makeTasks = require('../../src/app/queue/store');

//---------------------------------------------------------------------------
//what was asked, who it went to, and what a human decided.
//
//THE CLAIM THIS FILE IS FOR: a task number is the one identity a person says out
//loud, and it must never be handed out twice.
//
//Counting from the tasks that exist looks right and is not — remove the
//highest-numbered task and the next one written takes its number back. That
//happened: #11 was removed and the next task became #11, which makes a number
//ambiguous in exactly the places numbers get used. A commit message, a note,
//somebody asking what happened to eleven.
//
//AND THE SECOND CLAIM: what is stored is only what nothing else can tell us. A
//run's outcome and a branch's contents are facts elsewhere; a state this store
//accepted for them would be a copy that wins over the truth, because the copy is
//the one on the board.
//---------------------------------------------------------------------------

let store;
let said;

beforeEach(async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-worker-'));
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-worker-ws-'));

    let state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dataDir, ...p) } }, async (_e, s) => { state = s.state; });
    state.follow(async () => work);

    said = [];
    store = makeTasks({
        tasks: () => state.here.doc('tasks'),
        counter: () => state.here.doc('tasks-highest')
    }, {
        good: (t) => said.push(t),
        warn: (t) => said.push(t),
        bad: (t) => said.push(t),
        info: (t) => said.push(t)
    });
});

const aTask = (extra) => Object.assign({
    title: 'fix the thing',
    brief: 'the thing is broken; fix it',
    branch: 'fix/the-thing'
}, extra || {});

//---------------------------------------------------------------------------
//A NUMBER IS NEVER HANDED OUT TWICE.
//---------------------------------------------------------------------------

test('a number survives the task that held it being thrown away', async () => {
    const one = await store.add(aTask({ title: 'first' }));
    const two = await store.add(aTask({ title: 'second' }));
    assert.deepEqual([one.number, two.number], [1, 2]);

    await store.remove(two.id);
    const three = await store.add(aTask({ title: 'third' }));

    //THE HIGH-WATER MARK, NOT THE BOARD. Counting from what exists would make
    //this 2 again — and two pieces of work sharing a number is the one thing a
    //number exists to prevent.
    assert.equal(three.number, 3);
});

test('a deleted counter does not start handing out numbers already in use', async () => {
    await store.add(aTask({ title: 'first' }));
    const two = await store.add(aTask({ title: 'second' }));

    //The counter can be deleted; a board that survived it must not renumber.
    //`highest` is never below what is on the board.
    assert.equal(await store.highest(), two.number);
});

test('the three identities all resolve to the same task, and a number may be typed with a hash', async () => {
    const made = await store.add(aTask({ title: 'the one' }));

    //A person types the number, a script keeps the uid, and the slug is what
    //reads well in a command. Refusing two of them would mean remembering which
    //one this particular call wanted.
    assert.equal((await store.get(made.id)).uid, made.uid);
    assert.equal((await store.get(made.uid)).uid, made.uid);
    assert.equal((await store.get(made.number)).uid, made.uid);
    assert.equal((await store.get('#' + made.number)).uid, made.uid);

    await assert.rejects(() => store.get('nothing-like-it'), /There is no task/);
});

test('the identities cannot be rewritten by an update', async () => {
    const made = await store.add(aTask({ title: 'the one' }));

    //A caller passing a whole task object back would otherwise be able to
    //renumber it, or hand it another task's uid — and the kept logs, which are
    //filed under the uid, would follow.
    const after = await store.update(made.id, {
        id: 'something-else', uid: 'stolen', number: 99, title: 'renamed'
    });

    assert.equal(after.id, made.id);
    assert.equal(after.uid, made.uid);
    assert.equal(after.number, made.number);
    assert.equal(after.title, 'renamed', 'and everything that is not an identity does change');
});

//---------------------------------------------------------------------------
//WHAT IS STORED, AND WHAT IS NOT.
//---------------------------------------------------------------------------

test('working and delivered are not states this store accepts', async () => {
    const made = await store.add(aTask());

    //A run's outcome and a branch's contents are facts elsewhere. A state
    //accepted here would be a copy that wins over the truth, because the copy is
    //the one on the board.
    await assert.rejects(() => store.update(made.id, { state: 'working' }), /not a state a task is put into/);
    await assert.rejects(() => store.update(made.id, { state: 'delivered' }), /read from the run and the branch/);

    for (const ok of ['draft', 'queued', 'given', 'done', 'accepted', 'rejected']) {
        assert.equal((await store.update(made.id, { state: ok })).state, ok);
    }
});

test('a task must say what it is, what the work is, and where it delivers', async () => {
    await assert.rejects(() => store.add(aTask({ title: '  ' })), /Give the task a title/);
    await assert.rejects(() => store.add(aTask({ brief: '' })), /what the worker is actually told/);
    //THE BRANCH IS THE ARTIFACT. A task with nowhere to deliver cannot be
    //judged, which is the whole point of writing one down.
    await assert.rejects(() => store.add(aTask({ branch: '' })), /cannot be judged/);
});

test('a task cannot ask for a supervisor machine', async () => {
    //Those are out of the pool for good — a supervisor decides what work to give
    //and is never given any — so this task would sit queued for ever while the
    //board said it was waiting its turn. Refused where it is WRITTEN rather than
    //left to be discovered as silence.
    await assert.rejects(() => store.add(aTask({ tag: 'Supervisor' })), /waiting for one/);
});

test('a tag is lower-cased on the way in', async () => {
    //A tag that depends on how somebody typed it is a tag that silently matches
    //nothing.
    assert.equal((await store.add(aTask({ tag: '  TEST ' }))).tag, 'test');
    assert.equal((await store.add(aTask({ title: 'b' }))).tag, null, 'and no tag means any machine');
});

test('who does the work is a slot, and `shell` is derived from it rather than kept beside it', async () => {
    assert.equal((await store.add(aTask({ title: 'a', worker: 'person' }))).worker, 'person');
    assert.equal((await store.add(aTask({ title: 'b', worker: 'person' }))).shell, false);

    const script = await store.add(aTask({ title: 'c', worker: 'shell' }));
    assert.equal(script.shell, true, 'derived, so the two cannot disagree');

    //An unknown worker is not accepted as one — it falls back rather than being
    //written down as something nothing dispatches.
    assert.equal((await store.add(aTask({ title: 'd', worker: 'somebody' }))).worker, 'claude');
});

//---------------------------------------------------------------------------
//A RECORD FROM BEFORE IS NOT A BROKEN RECORD.
//---------------------------------------------------------------------------

test('a task written before these fields existed is read, not refused', async () => {
    //Refusing it would throw away the history this store is for. The uid of an
    //older task is its slug, which is exactly right: that is what its kept logs
    //are already filed under, so migrating does not orphan them.
    await store.write([
        { id: 'an-old-one', title: 'from before', brief: 'b', branch: 'x', state: 'done', shell: true }
    ]);

    const [old] = await store.read();
    assert.equal(old.uid, 'an-old-one', 'the slug becomes the uid, so kept logs still resolve');
    assert.equal(old.number, 1);
    assert.equal(old.worker, 'shell', 'derived from the boolean, which is what it meant');
});

test('a board saved as one object rather than a list does not read as an empty board', async () => {
    //Neither should empty the board and make it look as though no work was ever
    //written down.
    await store.write({ id: 'only-one', title: 't', brief: 'b', branch: 'x', number: 4, uid: 'u', worker: 'claude' });
    const rows = await store.read();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].number, 4);
});

//---------------------------------------------------------------------------
//AND WHAT REMOVING ONE DOES NOT DO.
//---------------------------------------------------------------------------

test('removing a task throws away what was asked, not what came back', async () => {
    const made = await store.add(aTask({ title: 'the one', branch: 'fix/it' }));
    const gone = await store.remove(made.id);

    assert.equal(gone.number, made.number);
    //Deleting the branch would destroy the artifact, which is the one thing here
    //nobody can rewrite.
    assert.match(gone.note, /The branch "fix\/it" and the logs kept for it are untouched/);
    assert.deepEqual(await store.read(), []);
});

test('the note a machine is given is four fields and no more', async () => {
    const made = await store.add(aTask({ title: 'the one' }));
    const note = store.noteFor(made);

    //The temptation is to write the task down there so nothing has to be looked
    //up — and that is how a guest ends up holding the brief and the contract
    //text, on the machine the contract is meant to bind.
    assert.deepEqual(Object.keys(note).sort(), ['branch', 'id', 'number', 'uid']);
    //The branch rides along so the note can be CHECKED rather than believed.
    assert.equal(note.branch, made.branch);
});
