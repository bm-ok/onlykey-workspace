const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const statePlugin = require('../../src/app/core/state/main');
const makeStore = require('../../src/app/queue/store');
const makeDoors = require('../../src/app/queue/doors');

//---------------------------------------------------------------------------
//CHANGING A TASK.
//
//TWO CALLERS THAT LOOK NOTHING ALIKE: a person editing a draft on the board, and
//the queue marking a task given, run, done. They go through ONE door because the
//identity pinning and the library copying have to be true of both.
//
//THE CLAIM WORTH THE MOST: the brief and the branch cannot change once a task
//has been given out. They are what a worker was TOLD and WHERE it delivered, and
//editing either rewrites the question a piece of work was the answer to — a
//verdict then refers to something that was never asked.
//
//AND THE SECOND: the STATE is not among them. If it were, the queue could not
//record what happened to the work it dispatched, which is what this door is for
//half the time.
//
//AND THE THIRD: what the library says is copied in the SAME WAY on both paths.
//The app being ported from wrote that twice, and the second copy was added after
//a run proved it was missing — changing which contract a task ran under changed
//the NAME and left the WORDS, so the board said one contract and the worker was
//held to another.
//---------------------------------------------------------------------------

let store, doors, asked;

function ask(over) {
    return Object.assign({
        branchNameIsOk: async () => null,
        branchExists: async () => true,
        judgement: async () => null,
        contract: async () => null,
        contractFileExists: async () => true,
        job: async () => null,
        prompt: async () => null,
        machines: async () => [{ name: 'runner-1', tags: ['worker'] }]
    }, over || {});
}

async function setUp(over) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-edit-'));
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-edit-ws-'));

    let state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dataDir, ...p) } }, async (_e, s) => { state = s.state; });
    state.follow(async () => work);

    store = makeStore({
        tasks: () => state.here.doc('tasks'),
        counter: () => state.here.doc('tasks-highest')
    }, null);

    asked = ask(over);
    doors = makeDoors(store, asked, null);
}

beforeEach(() => setUp());

const aTask = (extra) => Object.assign({
    title: 'fix the thing',
    brief: 'the thing is broken; fix it',
    branch: 'fix/the-thing'
}, extra || {});

//---- the ordinary edit -----------------------------------------------------

test('an edit changes what it says', async () => {
    const made = await doors.create(aTask());
    const now = await doors.edit(made.id, { title: 'fix the other thing', hours: 3 });

    assert.equal(now.title, 'fix the other thing');
    assert.equal(now.hours, 3);
    assert.equal(now.uid, made.uid, 'an edit renumbered the task');
    assert.equal(now.number, made.number);
});

test('a branch nobody has cut is refused here too', async () => {
    //WITHOUT IT THE ORDER HOLDS AT THE DOOR AND NOT AT THE WINDOW BESIDE IT:
    //write the task correctly, then edit the branch to one nobody has cut.
    const made = await doors.create(aTask());
    asked.branchExists = async () => false;

    await assert.rejects(() => doors.edit(made.id, { branch: 'fix/never-cut' }),
        /There is no branch called "fix\/never-cut"/);
});

//---- what cannot change once it has been given out ---------------------------

test('not the brief, the branch or the contract file', async () => {
    const made = await doors.create(aTask());
    await doors.edit(made.id, { state: 'given', machine: 'kit-1' });

    await assert.rejects(() => doors.edit(made.id, { brief: 'something else' }),
        /has already been given to kit-1/);
    await assert.rejects(() => doors.edit(made.id, { branch: 'fix/somewhere-else' }),
        /rewrite the question its work answers/);
    await assert.rejects(() => doors.edit(made.id, { contract: '/some/file' }),
        /has already been given to kit-1/);
});

test('and the refusal says what to do instead', async () => {
    const made = await doors.create(aTask());
    await doors.edit(made.id, { state: 'given', machine: 'kit-1' });

    await assert.rejects(() => doors.edit(made.id, { brief: 'x' }),
        /Write a new task, or take the verdict on this one first/);
});

test('but the STATE is not among them, or the queue could record nothing', async () => {
    //THE HALF OF THIS DOOR THAT IS NOT A PERSON. Every line of the tick writes
    //through here — given, then the run, then done.
    const made = await doors.create(aTask());

    await doors.edit(made.id, { state: 'given', machine: 'kit-1', run: 'run-1' });
    const done = await doors.edit(made.id, { state: 'done', attempts: [{ run: 'run-1' }], arrived: true });

    assert.equal(done.state, 'done');
    assert.equal(done.attempts.length, 1);
    assert.equal(done.arrived, true);
});

test('nor is putting it back in the queue, which is what adoption does', async () => {
    const made = await doors.create(aTask());
    await doors.edit(made.id, { state: 'given', machine: 'kit-1' });

    const back = await doors.edit(made.id, { state: 'queued', machine: null });

    assert.equal(back.state, 'queued');
    assert.strictEqual(back.machine, null);
});

//---- what the library says, copied the same way both ways ----------------------

test('changing the contract changes the WORDS, not only the name', async () => {
    //THE FAILURE THIS EXISTS FOR.
    await setUp({
        contract: async (id) => (id === 'c2'
            ? { id: 'c2', name: 'the stricter rules', text: 'do not touch the firmware', approved: true }
            : { id: 'c1', name: 'the usual rules', text: 'do not push to master', approved: true })
    });

    const made = await doors.create(aTask({ contractId: 'c1' }));
    assert.equal(made.rules, 'do not push to master');

    const now = await doors.edit(made.id, { contractId: 'c2' });

    assert.equal(now.contractName, 'the stricter rules');
    assert.equal(now.rules, 'do not touch the firmware', 'the name moved and the rules did not');
});

test('and taking it off takes the words with it', async () => {
    //LEAVING THE WORDS BEHIND would read as "no contract" everywhere the id is
    //checked and "these rules" everywhere the text is, which is worse than
    //either.
    await setUp({
        contract: async () => ({ id: 'c1', name: 'the usual rules', text: 'do not push to master', approved: true })
    });

    const made = await doors.create(aTask({ contractId: 'c1' }));
    const now = await doors.edit(made.id, { contractId: '' });

    assert.strictEqual(now.contractId, null);
    assert.strictEqual(now.rules, null);
    assert.strictEqual(now.contractName, null);
});

test('a key that is not there is not a change, so the queue does not strip a task bare', async () => {
    //MOST CALLERS ON THIS PATH are the queue and the panel sending a two-field
    //patch. Treating a MISSING key as "set it to none" would take the rules off
    //every task the queue touched.
    await setUp({
        contract: async () => ({ id: 'c1', name: 'the usual rules', text: 'do not push to master', approved: true }),
        job: async () => ({ id: 'j1', name: 'build it', kind: 'work' })
    });

    const made = await doors.create(aTask({ contractId: 'c1', job: 'j1' }));
    const now = await doors.edit(made.id, { state: 'given', machine: 'kit-1' });

    assert.equal(now.rules, 'do not push to master');
    assert.equal(now.contractId, 'c1');
    assert.equal(now.job, 'j1');
    assert.equal(now.jobName, 'build it');
});

test('a contract that is not approved is refused on this path too', async () => {
    await setUp({ contract: async () => ({ id: 'c1', name: 'the usual rules', text: 'x', approved: false }) });

    const made = await doors.create(aTask());
    await assert.rejects(() => doors.edit(made.id, { contractId: 'c1' }),
        /is not approved\. What a worker may not do is read before it is sent/);
});

test('and one edited since it was approved says which of the two it is', async () => {
    //"NOT APPROVED" AND "APPROVED, THEN CHANGED" want different things done.
    await setUp({
        contract: async () => ({ id: 'c1', name: 'the usual rules', text: 'x', approved: false, lapsed: true })
    });

    const made = await doors.create(aTask());
    await assert.rejects(() => doors.edit(made.id, { contractId: 'c1' }),
        /has been edited since it was approved\. Read it and approve it again before putting a task under it/);
});

test('a library contract on a task that already carries a file is refused', async () => {
    //ASKED OF WHAT THE TASK CARRIES, not only of the patch — otherwise this
    //leaves both, which is the state the refusal exists to prevent.
    await setUp({
        contract: async () => ({ id: 'c1', name: 'the usual rules', text: 'x', approved: true })
    });

    const made = await doors.create(aTask({ contract: '/some/file' }));
    await assert.rejects(() => doors.edit(made.id, { contractId: 'c1' }),
        /either a contract from the library or a file on this host, not both/);
});

test('and naming both in one patch is the same refusal', async () => {
    await setUp({ contract: async () => ({ id: 'c1', name: 'the usual rules', text: 'x', approved: true }) });

    const made = await doors.create(aTask());
    await assert.rejects(() => doors.edit(made.id, { contractId: 'c1', contract: '/another/file' }),
        /not both/);
});

test('but clearing the file while naming a contract is allowed, because it is one', async () => {
    await setUp({ contract: async () => ({ id: 'c1', name: 'the usual rules', text: 'the rules', approved: true }) });

    const made = await doors.create(aTask({ contract: '/some/file' }));
    const now = await doors.edit(made.id, { contractId: 'c1', contract: null });

    assert.equal(now.rules, 'the rules');
    assert.strictEqual(now.contract, null);
});

//---- the job and the prompt -----------------------------------------------------

test('a job that does not exist is refused, and its name travels with its id', async () => {
    await setUp({ job: async (id) => (id === 'j1' ? { id: 'j1', name: 'build it', kind: 'work' } : null) });

    const made = await doors.create(aTask());
    await assert.rejects(() => doors.edit(made.id, { job: 'nope' }), /There is no job called "nope"/);

    const now = await doors.edit(made.id, { job: 'j1' });
    assert.equal(now.jobName, 'build it');
});

test('and a judge is refused as a task job, in this door as in the other', async () => {
    //A JUDGE READS A CHANGE AND SAYS WHETHER IT HOLDS. A task makes one — and
    //the refusal exists on both doors or it exists on neither.
    await setUp({ job: async () => ({ id: 'j9', name: 'read it', kind: 'judge' }) });

    const made = await doors.create(aTask());
    await assert.rejects(() => doors.edit(made.id, { job: 'j9' }),
        /is a judge — it reads a change and says whether it holds/);
});

test('taking the job off takes its name with it', async () => {
    await setUp({ job: async () => ({ id: 'j1', name: 'build it', kind: 'work' }) });

    const made = await doors.create(aTask({ job: 'j1' }));
    const now = await doors.edit(made.id, { job: '' });

    assert.strictEqual(now.job, null);
    assert.strictEqual(now.jobName, null);
});

test('a prompt name travels with its id, because the library entry may be gone', async () => {
    //THE TASK SHOULD STILL BE ABLE TO SAY WHERE ITS BRIEF CAME FROM.
    await setUp({ prompt: async (id) => (id === 'p1' ? { id: 'p1', name: 'the fixing prompt' } : null) });

    const made = await doors.create(aTask());
    const now = await doors.edit(made.id, { promptId: 'p1' });

    assert.equal(now.promptId, 'p1');
    assert.equal(now.promptName, 'the fixing prompt');

    await assert.rejects(() => doors.edit(made.id, { promptId: 'nope' }), /There is no prompt called "nope"/);
});

//---- and what an edit can never do -----------------------------------------------

test('it cannot renumber a task or take another one\'s uid', async () => {
    //THE KEPT LOGS FOLLOW THE UID. A caller passing a whole task object back
    //would otherwise be able to hand it somebody else's history.
    const one = await doors.create(aTask());
    const two = await doors.create(aTask({ branch: 'fix/another' }));

    const now = await doors.edit(one.id, { uid: two.uid, number: 999, id: two.id });

    assert.equal(now.uid, one.uid);
    assert.equal(now.number, one.number);
    assert.equal(now.id, one.id);
});

test('and it cannot set a state that is read rather than stored', async () => {
    //WORKING AND DELIVERED are read from the run and the branch, not set.
    const made = await doors.create(aTask());
    await assert.rejects(() => doors.edit(made.id, { state: 'delivered' }),
        /is not a state a task is put into/);
});

test('a task that is not there is named, not created', async () => {
    await assert.rejects(() => doors.edit('no-such-task', { title: 'x' }), /no.*task/i);
});

test('and a contract that does not exist is refused, not filed as a name with no words', async () => {
    //A TASK CARRYING A CONTRACT NAME AND NO RULES reads as being under a
    //contract everywhere the name is shown and under none everywhere the words
    //are, which is the worst of the three states it could be in.
    await setUp({ contract: async (id) => (id === 'c1' ? { id: 'c1', name: 'ok', text: 'x', approved: true } : null) });

    const made = await doors.create(aTask());
    await assert.rejects(() => doors.edit(made.id, { contractId: 'nope' }),
        /There is no contract called "nope"/);

    const still = await store.get(made.id);
    assert.equal(still.contractName, undefined, 'the refused contract was filed anyway');
});
