const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', 'src', 'app');
const makeJobOrder = require(path.join(APP, 'runners', 'runs', 'joborder.js'));
const { runIdFor, approvalOf } = makeJobOrder;

const JOB = { id: 'tidy', name: 'Tidy branches', there: true, approved: true, code: 'console.log(1)' };
const PROMPT = { id: 'p1', name: 'Read the README', approved: true, text: 'read it', contractId: null };
const CONTRACT = { id: 'c1', name: 'House rules', approved: true, text: 'be careful' };

//ASYNC, BECAUSE THE REAL LIBRARY IS. `library.jobs.get` and `.all` both return
//promises — see src/app/library/entries.js. The first version of these fixtures
//was synchronous, so `jobFor` got a PROMISE back, found it truthy, read
//`undefined` off it for every field, and every test here passed while the action
//refused every job with `"undefined" has no script`. A stand-in that does not
//match the thing it stands in for tests the stand-in.
function orderWith(over) {
    const o = over || {};
    return makeJobOrder({
        //There is one job in this library and it is called `tidy`. `o.job`
        //overlays fields on it; `o.job === null` means the library is empty.
        jobs: {
            get: async (id) => {
                if (o.job === null || id !== 'tidy') return null;
                return Object.assign({}, JOB, o.job);
            }
        },
        prompts: { all: async () => o.prompts || [PROMPT] },
        contracts: { all: async () => o.contracts || [CONTRACT] }
    });
}

const messageOf = async (fn) => {
    try { await fn(); return null; }
    catch (e) { return e.message; }
};

//---------------------------------------------------------------------------
//1. NOTHING UNAPPROVED IS SENT.
//---------------------------------------------------------------------------

test('an approved job with a script is accepted', async () => {
    assert.equal((await orderWith({}).jobFor('tidy')).id, 'tidy');
});

test('a job that does not exist is refused by the name that was asked for', async () => {
    //THIS IS THE ONE THAT WAS BROKEN LIVE. `jobs.get` is async, so an un-awaited
    //promise read as a job that existed and every field came back undefined.
    await assert.rejects(() => orderWith({ job: null }).jobFor('nosuch'),
        /There is no job called "nosuch"\./);
});

test('a job whose file is gone is a different problem from an unapproved one', async () => {
    //Different fixes: put the file back, versus read and approve it.
    await assert.rejects(() => orderWith({ job: { there: false } }).jobFor('tidy'),
        /has no script.*missing from the jobs folder/s);
});

test('an unapproved job is refused, whoever is asking', async () => {
    await assert.rejects(() => orderWith({ job: { approved: false } }).jobFor('tidy'),
        /is not approved. Nothing unapproved runs, whoever is asking/);
});

test('"edited since approved" is its own sentence, not the same refusal', async () => {
    //THE TWO HAVE DIFFERENT FIXES — read it again, versus read it for the first
    //time — so collapsing them costs the reader the one thing the message is for.
    const never = await messageOf(() => orderWith({ job: { approved: false } }).jobFor('tidy'));
    const lapsed = await messageOf(() => orderWith({ job: { approved: false, lapsed: true } }).jobFor('tidy'));

    assert.match(lapsed, /edited since it was approved/);
    assert.notEqual(never, lapsed);
});

test('the approval reading is the same for all three kinds, and names which it is', () => {
    assert.equal(approvalOf({ approved: true }, 'job'), null);
    assert.match(approvalOf({ approved: false, name: 'X' }, 'prompt'), /The prompt "X" is not approved/);
    assert.match(approvalOf({ approved: false, lapsed: true, name: 'X' }, 'contract'),
        /The contract "X" has been edited/);
});

//---------------------------------------------------------------------------
//2. WHAT IT IS TOLD, AND FROM WHERE.
//---------------------------------------------------------------------------

const WORK = {
    id: 't1', number: 4, title: 'do the thing', brief: 'please do the thing',
    rules: 'be careful', contractId: 'c1', contractName: 'House rules'
};

test('a job may run with no prompt at all, and that is the caller\'s business', async () => {
    //A job that tidies branches needs no instruction, and refusing one for
    //lacking an input it never reads would be this deciding what a job is for.
    const told = await orderWith({}).whatItIsTold({});
    assert.equal(told.prompt, null);
    assert.equal(told.contract, null);
});

test('run for a task, the words come from the TASK and not from the library', async () => {
    //A task copied the prompt's words when it was written. Going back to the
    //library would run it under whatever those say now — a different text the
    //moment anybody edits one — and the task's is the one somebody wrote,
    //queued and will be judged on. The library is EMPTY in this fixture, on
    //purpose: if it were consulted at all this would throw.
    const told = await orderWith({ prompts: [], contracts: [] }).whatItIsTold({ work: WORK });
    assert.equal(told.prompt.text, 'please do the thing');
    assert.equal(told.prompt.name, '#4 do the thing');
    assert.equal(told.contract.text, 'be careful');
    assert.equal(told.contract.name, 'House rules');
});

test('a judgement carries the same fields, and only its NAME differs', async () => {
    //J1 and #1 are different pieces of work, so the ref is read off the record
    //rather than built from a number.
    const told = await orderWith({}).whatItIsTold({ work: Object.assign({}, WORK, { ref: 'J1' }) });
    assert.match(told.prompt.name, /^J1 /);
});

test('work with no brief is refused, named the way it is called', async () => {
    const order = orderWith({});
    await assert.rejects(() => order.whatItIsTold({ work: Object.assign({}, WORK, { brief: '  ' }) }),
        /#4 has no brief/);
    await assert.rejects(
        () => order.whatItIsTold({ work: Object.assign({}, WORK, { ref: 'J1', brief: null }) }),
        /J1 has no brief/);
});

test('work with no rules runs with none, rather than borrowing the library\'s', async () => {
    const told = await orderWith({}).whatItIsTold({ work: Object.assign({}, WORK, { rules: null }) });
    assert.equal(told.contract, null);
});

test('run from the library, both halves are read before either is sent', async () => {
    const told = await orderWith({
        prompts: [Object.assign({}, PROMPT, { contractId: 'c1' })]
    }).whatItIsTold({ promptId: 'p1' });
    assert.equal(told.prompt.id, 'p1');
    assert.equal(told.contract.id, 'c1');
});

test('a prompt that is not there is refused by the id that was asked for', async () => {
    await assert.rejects(() => orderWith({ prompts: [] }).whatItIsTold({ promptId: 'gone' }),
        /There is no prompt called "gone"\./);
});

test('an unapproved prompt is refused with the reason it is read at all', async () => {
    await assert.rejects(() => orderWith({
        prompts: [Object.assign({}, PROMPT, { approved: false })]
    }).whatItIsTold({ promptId: 'p1' }), /read before it is sent, the same as the script/);
});

test('a prompt naming a contract that is gone will not be sent without it', async () => {
    //THE FAILURE THIS REPLACED: a missing contract silently becoming "no rules".
    //A run with no limits looks exactly like a run with limits from everywhere
    //except the limits.
    await assert.rejects(() => orderWith({
        prompts: [Object.assign({}, PROMPT, { contractId: 'gone' })],
        contracts: []
    }).whatItIsTold({ promptId: 'p1' }), /there is no such contract.*will not be sent/s);
});

test('an unapproved contract stops the prompt too, rather than being dropped', async () => {
    await assert.rejects(() => orderWith({
        prompts: [Object.assign({}, PROMPT, { contractId: 'c1' })],
        contracts: [Object.assign({}, CONTRACT, { approved: false })]
    }).whatItIsTold({ promptId: 'p1' }), /What a worker may not do is read before it is sent/);
});

test('a prompt that names no contract runs with none, and is not refused for it', async () => {
    const told = await orderWith({}).whatItIsTold({ promptId: 'p1' });
    assert.equal(told.prompt.id, 'p1');
    assert.equal(told.contract, null);
});

//---------------------------------------------------------------------------
//3. ONE OF THE THREE, NEVER TWO.
//---------------------------------------------------------------------------

test('a task and a judgement at once is refused — the run belongs to one of them', async () => {
    await assert.rejects(() => orderWith({}).whatItIsTold({ task: 't1', judgement: 'j1' }),
        /not both — they are different pieces of work/);
});

test('a task and a library prompt at once is refused from the other side', async () => {
    await assert.rejects(() => orderWith({}).whatItIsTold({ work: WORK, promptId: 'p1' }),
        /a task already carries the words it was written with/);
});

//---------------------------------------------------------------------------
//4. THE RUN ID.
//---------------------------------------------------------------------------

test('a run id says it is a job, so it is legible in vmRuns', () => {
    //Rather than looking like a task somebody named oddly — both in the run list
    //and in the directory it leaves behind.
    const id = runIdFor('tidy', Date.parse('2026-08-23T02:04:05.678Z'));
    assert.match(id, /^job-tidy-\d{14}$/);
    assert.ok(id.startsWith('job-tidy-20260823020405'));
});

test('two runs of one job at different times do not share an id', () => {
    const a = runIdFor('tidy', Date.parse('2026-08-23T02:04:05Z'));
    const b = runIdFor('tidy', Date.parse('2026-08-23T02:04:06Z'));
    assert.notEqual(a, b);
});
