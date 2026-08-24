const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', 'src', 'app');
const makeOnMachine = require(path.join(APP, 'runners', 'onmachine', 'onmachine.js'));

const TASK = { id: 't1', uid: 'task-uid-1', number: 4, title: 'do the thing', machine: 'kit-1', state: 'given' };
const JUDGEMENT = {
    id: 'j1', uid: 'judgement-uid-1', number: 4, title: 'judge the thing',
    machine: 'kit-1', state: 'given', subject: { name: 'work/some-branch' }
};

//---- THE STUBS ANSWER THE WAY THE REAL ONES DO, WHICH THEY DID NOT ----------
//
//These returned plain ARRAYS. The two things they stand in for do not: ../../
//src/app/queue's `task.all` and ../../src/app/judge's `all` each read a document
//off disk and are async.
//
//So `whatIsOn` was written synchronous, every test here passed, and in the real
//app every single call threw `(rows || []).filter is not a function` — from the
//first one it ever made. A stub that is EASIER to satisfy than the real thing
//tests the stub.
//
//It hid for a long time because of where it is asked: ../runs catches and
//carries on with a poorer prompt, and ../sessions turns a null into a 204. What
//it cost is the rule in src/app/repositories/gitserve — a judgement may not push
//to the thing it was asked to read — which asks this and could only ever throw.
function on(opts) {
    const o = opts || {};
    return makeOnMachine({
        tasks: async () => o.tasks || [],
        judgements: async () => o.judgements || [],
        refOf: (n) => 'PR#' + n
    }).whatIsOn;
}

test('a machine running nothing answers null, which is an ordinary answer', async () => {
    //THE FIRST RUN OF EVERY TASK GIVES THIS. It is not a fault and callers turn
    //it into a 204, so it must not be an exception.
    assert.equal(await on({})('kit-1'), null);
    assert.equal(await on({ tasks: [TASK] })('some-other-machine'), null);
});

test('no machine named answers null rather than matching a record with no machine', async () => {
    //A row mid-write can have `machine: undefined`, and `String(undefined) ===
    //'undefined'` would not match — but an empty name would match an empty
    //field, which is how a caller with no name at all gets handed somebody
    //else's work.
    const halfWritten = { id: 'x', state: 'given', machine: '' };
    for (const nothing of [undefined, null, '']) {
        assert.equal(await on({ tasks: [halfWritten] })(nothing), null);
    }
});

test('a task being worked on comes back as a task, with what to file under', async () => {
    const doing = await on({ tasks: [TASK] })('kit-1');
    assert.equal(doing.kind, 'task');
    assert.equal(doing.ref, '#4');
    assert.equal(doing.uid, 'task-uid-1');
    assert.equal(doing.title, 'do the thing');
    assert.equal(doing.item, TASK);
});

test('a judgement comes back as one, named the way a pull request is', async () => {
    const doing = await on({ judgements: [JUDGEMENT] })('kit-1');
    assert.equal(doing.kind, 'judgement');
    assert.equal(doing.ref, 'PR#4');
    assert.equal(doing.uid, 'judgement-uid-1');
    assert.equal(doing.reads, 'work/some-branch');
    assert.equal(doing.item, JUDGEMENT);
});

test('only what is GIVEN counts — queued, done and stopped are not being run', async () => {
    for (const state of ['queued', 'done', 'stopped', 'failed', undefined]) {
        const row = Object.assign({}, TASK, { state });
        assert.equal(await on({ tasks: [row] })('kit-1'), null, state + ' read as running');
    }
});

//---------------------------------------------------------------------------
//THE ORDER, WHICH IS THE ONE RULE HERE THAT COSTS SOMETHING.
//---------------------------------------------------------------------------

test('when both answer, the judgement wins — the reading that refuses a push', async () => {
    //A machine runs one thing at a time, so both answering means the record is
    //already confused. Of the two wrong answers available, "this is a judgement"
    //refuses a push and files nothing against the work; "this is a task" would
    //let a judge push to the branch it is judging.
    const doing = await on({ tasks: [TASK], judgements: [JUDGEMENT] })('kit-1');
    assert.equal(doing.kind, 'judgement');
});

test('a task and a judgement numbered the same are never filed together', async () => {
    //BOTH ARE 4 IN THESE FIXTURES, ON PURPOSE. A number is only unique within a
    //kind, so filing by number would hand one's transcript to the other. The uid
    //is what a session and an artifact are filed under, and the two differ.
    const asTask = await on({ tasks: [TASK] })('kit-1');
    const asJudgement = await on({ judgements: [JUDGEMENT] })('kit-1');
    assert.equal(asTask.number, asJudgement.number);
    assert.notEqual(asTask.uid, asJudgement.uid);
    assert.notEqual(asTask.ref, asJudgement.ref);
});

test('the boards are read at ASK time, not held from when this was built', async () => {
    //A machine's work changes while the app runs; a snapshot taken at wiring
    //time would answer about the board as it was at start-up, and the failure
    //would be a machine reported as free while it is working.
    let rows = [];
    const whatIsOn = makeOnMachine({
        tasks: async () => rows,
        judgements: async () => [],
        refOf: (n) => '#' + n
    }).whatIsOn;

    assert.equal(await whatIsOn('kit-1'), null);
    rows = [TASK];
    assert.equal((await whatIsOn('kit-1')).kind, 'task');
});

test('two machines working do not read each other', async () => {
    const other = Object.assign({}, TASK, { id: 't2', uid: 'task-uid-2', number: 5, machine: 'kit-2' });
    const both = on({ tasks: [TASK, other] });
    assert.equal((await both('kit-1')).uid, 'task-uid-1');
    assert.equal((await both('kit-2')).uid, 'task-uid-2');
});
