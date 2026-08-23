const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const statePlugin = require('../../src/app/core/state/main');
const makeStore = require('../../src/app/queue/store');
const makeDoors = require('../../src/app/queue/doors');

//---------------------------------------------------------------------------
//RECORDING A PERSON'S DECISION ABOUT WORK.
//
//THE CLAIM THIS FILE IS FOR: a verdict is only worth having if it cannot be
//given about nothing.
//
//Accepting lands nothing — merging is a separate act with its own rules, and a
//verdict that quietly merged would make reading the work and publishing it the
//same button. So what a verdict IS, is a record that somebody read something.
//
//AND AFTERWARDS THE TWO ARE INDISTINGUISHABLE. A verdict on an empty branch says
//"accepted" in exactly the same words as a verdict on real work, and the fact
//that there was nothing there is not in the record anywhere. That is why it is
//refused at the moment of deciding rather than warned about.
//---------------------------------------------------------------------------

let store;
let doors;
let delivered;

async function setUp(art) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-judge-'));
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-judge-ws-'));

    let state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dataDir, ...p) } }, async (_e, s) => { state = s.state; });
    state.follow(async () => work);

    store = makeStore({
        tasks: () => state.here.doc('tasks'),
        counter: () => state.here.doc('tasks-highest')
    }, null);

    delivered = [];
    doors = makeDoors(store, {
        branchNameIsOk: async () => null,
        branchExists: async () => true,
        judgement: async () => null,
        contract: async () => null,
        contractFileExists: async () => true,
        job: async () => null,
        machines: async () => [{ name: 'runner-1', tags: ['worker'] }],
        //HANDED BACK EXACTLY AS GIVEN, with no default folded in here. It had
        //one, keyed on `undefined` — which is one of the values a test below
        //needs to pass IN, so that case silently got the healthy default and
        //asserted nothing. A sentinel that collides with the thing under test is
        //not a sentinel.
        delivered: async (branch) => {
            delivered.push(branch);
            return art;
        }
    }, null);
}

const DELIVERED = { delivered: true, summary: '3 commits in one repository' };

beforeEach(() => setUp(DELIVERED));

const aTask = () => ({
    title: 'fix the thing',
    brief: 'the thing is broken; fix it',
    branch: 'fix/the-thing'
});

//---------------------------------------------------------------------------
//1. THE VERDICT ITSELF.
//---------------------------------------------------------------------------

test('accepting records that somebody read it, and what was there', async () => {
    const made = await doors.create(aTask());
    const decided = await doors.judge(made.id, 'accept');

    assert.equal(decided.state, 'accepted');
    assert.equal(decided.verdict.call, 'accept');
    assert.equal(decided.verdict.on, '3 commits in one repository');
    assert.ok(decided.verdict.at, 'nothing says when it was decided');
});

test('rejecting is recorded with its reason', async () => {
    const made = await doors.create(aTask());
    const decided = await doors.judge(made.id, 'reject', 'it does not build');

    assert.equal(decided.state, 'rejected');
    assert.equal(decided.verdict.call, 'reject');
    assert.equal(decided.verdict.note, 'it does not build');
});

test('accepting lands nothing — the state changes and nothing else is touched', async () => {
    //NOT A MERGE AND NOT A GATE. A verdict that quietly merged would make reading
    //the work and publishing it the same button.
    const made = await doors.create(aTask());
    const decided = await doors.judge(made.id, 'accept');
    assert.equal(decided.branch, made.branch, 'the branch was changed by a verdict');
});

test('only accept and reject are verdicts', async () => {
    const made = await doors.create(aTask());
    for (const said of ['maybe', '', null, undefined, 'ACCEPTED', 'yes']) {
        await assert.rejects(() => doors.judge(made.id, said), /The verdict is "accept" or "reject"\./);
    }
});

test('a verdict is taken however it was capitalised or spaced', async () => {
    const made = await doors.create(aTask());
    const decided = await doors.judge(made.id, '  ACCEPT  ');
    assert.equal(decided.verdict.call, 'accept');
});

//---------------------------------------------------------------------------
//2. NOTHING DELIVERED IS NOTHING TO JUDGE.
//---------------------------------------------------------------------------

test('a verdict on a branch nothing reached is refused, not warned about', async () => {
    //A worker that finished without pushing has delivered nothing, and
    //afterwards an "accepted" about nothing reads exactly like an "accepted"
    //about something.
    await setUp({ delivered: false, summary: 'nothing' });
    const made = await doors.create(aTask());

    await assert.rejects(() => doors.judge(made.id, 'accept'),
        /Nothing has arrived on "fix\/the-thing".*finished without pushing has delivered nothing/s);
});

test('and a REJECTION of nothing is refused too, not let through as harmless', async () => {
    //It looks like the safe direction and is not: it records that work was read
    //and found wanting, when there was no work.
    await setUp({ delivered: false, summary: 'nothing' });
    const made = await doors.create(aTask());
    await assert.rejects(() => doors.judge(made.id, 'reject', 'nothing there'), /Nothing has arrived/);
});

test('the branch is read at the moment of deciding, every time', async () => {
    //FRESH, because the gap between "the run ended" and "somebody is deciding"
    //is exactly where a branch stops being empty — or where a stale answer would
    //let a verdict through on one that still is.
    const made = await doors.create(aTask());
    await doors.judge(made.id, 'accept');
    assert.deepEqual(delivered, ['fix/the-thing']);
});

test('nothing at all coming back is treated as nothing delivered', async () => {
    //A reader that could not answer must not read as "yes there is work here".
    for (const nothing of [null, undefined, {}]) {
        await setUp(nothing);
        const made = await doors.create(aTask());
        await assert.rejects(() => doors.judge(made.id, 'accept'), /Nothing has arrived/);
    }
});

//---------------------------------------------------------------------------
//3. A REJECTION SAYS WHY.
//---------------------------------------------------------------------------

test('a rejection with no reason is refused', async () => {
    //It is sent back to a worker that cannot ask what was wrong, so a rejection
    //that says nothing is an instruction to guess.
    const made = await doors.create(aTask());
    for (const said of [undefined, null, '', '   ']) {
        await assert.rejects(() => doors.judge(made.id, 'reject', said),
            /Say why it was rejected/);
    }
});

test('an acceptance needs no words, because the work is the answer', async () => {
    const made = await doors.create(aTask());
    const decided = await doors.judge(made.id, 'accept');
    assert.equal(decided.verdict.note, null);
});

//---------------------------------------------------------------------------
//4. AND A DECIDED TASK STAYS DECIDED.
//---------------------------------------------------------------------------

test('a judged task cannot be put back in the queue', async () => {
    //The door that already reads `verdict` — write a new task rather than
    //reopening a decided one.
    const made = await doors.create(aTask());
    await doors.judge(made.id, 'accept');
    await assert.rejects(() => doors.queue(made.id, async () => ({ ok: true })),
        /has already been judged/);
});
