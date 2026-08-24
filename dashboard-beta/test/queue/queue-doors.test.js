const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const statePlugin = require('../../src/app/core/state/main');
const makeStore = require('../../src/app/queue/store');
const makeDoors = require('../../src/app/queue/doors');
const policy = require('../../src/app/queue/policy');

//---------------------------------------------------------------------------
//writing a work item down, queueing it, and throwing it away.
//
//THE CLAIM THIS FILE IS FOR: everything refused here costs a machine if it is
//not.
//
//A task against a branch nobody cut, or asking for a tag nothing carries, or
//naming a job that does not exist, is a task the queue picks up and fails on —
//twenty minutes of a machine booted, rolled back, handed a credential and
//pointed at nothing. The moment it is written is the cheap moment to find out.
//
//AND ONE OF THEM COSTS MORE THAN A MACHINE. A supervisor cannot see the code, so
//everything it believes a judge told it — and a task it writes on any other
//basis is work commissioned from a rumour. That gate is the reason `becauseOf`
//exists, and it is refused down the pipe and ordinary at the window, exactly
//like approving a job.
//---------------------------------------------------------------------------

let store;
let doors;
let asked;

//WHAT THE DOORS ARE GIVEN, rather than what they reach for. A gate that can only
//be exercised by creating real work is a gate nobody tests.
function ask(over) {
    return Object.assign({
        branchNameIsOk: async () => null,
        branchExists: async () => true,
        judgement: async () => null,
        contract: async () => null,
        contractFileExists: async () => true,
        job: async () => null,
        machines: async () => [{ name: 'runner-1', tags: ['worker'] }]
    }, over || {});
}

async function setUp(over) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-doors-'));
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-doors-ws-'));

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

//A stand-in for the rule the tick dispatches by, built from the real policy so
//the door and the tick cannot answer differently.
const planWith = (machines) => async (entry) => {
    const said = policy.plan([entry], machines, {});
    return {
        canTakeIt: said.dispatch.map((d) => d.machine),
        why: said.waiting.map((w) => w.why)
    };
};

//---------------------------------------------------------------------------
//THE JUDGE IS THE GATE BETWEEN A SUPERVISOR AND A TASK.
//---------------------------------------------------------------------------

test('over the wire, a task must name the judgement that established the work is real', async () => {
    await assert.rejects(
        () => doors.create(aTask(), { overTheWire: true }),
        /work commissioned from a rumour/
    );
});

test('and that judgement has to have finished — a queued one has established nothing', async () => {
    await setUp({ judgement: async () => ({ ref: 'J4', id: 'j4', state: 'queued' }) });

    await assert.rejects(
        () => doors.create(aTask(), { overTheWire: true, becauseOf: 'J4' }),
        /has not finished reading yet, so it has established nothing/
    );
});

test('a finished judgement lets it through, and is kept on the task', async () => {
    await setUp({ judgement: async () => ({ ref: 'J4', id: 'j4-uid', state: 'done' }) });

    const made = await doors.create(aTask(), { overTheWire: true, becauseOf: 'J4' });

    //Six weeks later "why was this done" is answerable by reading the judgement
    //it came from rather than by asking whoever was supervising that afternoon.
    assert.equal(made.becauseOf, 'J4');
    assert.equal(made.becauseOfId, 'j4-uid');
});

test('at the window it is ordinary, and nothing is required', async () => {
    //A person writing a task has read the code, or has decided they do not need
    //to, and either is their business — the same boundary as approving a job.
    const made = await doors.create(aTask());
    assert.equal(made.becauseOf, null);
    assert.equal(made.number, 1);
});

test('a judgement that does not exist is named, not silently ignored', async () => {
    await assert.rejects(
        () => doors.create(aTask(), { overTheWire: true, becauseOf: 'J99' }),
        /There is no judgement "J99"/
    );
});

//---------------------------------------------------------------------------
//WHAT IS IMPOSSIBLE, BEFORE WHAT IS MERELY NOT READY YET.
//---------------------------------------------------------------------------

test('the supervisor tag is refused before the branch is even looked at', async () => {
    //The branch checks are about the workspace as it stands: cut the branch and
    //the task is fine. This one is true whatever anybody cuts, so being told
    //about the branch first sends somebody off to fix something that was never
    //the problem.
    await setUp({ branchExists: async () => false });

    await assert.rejects(
        () => doors.create(aTask({ tag: 'supervisor' })),
        /waiting for one/
    );
});

test('a branch nobody has cut is work with nowhere to land', async () => {
    await setUp({ branchExists: async () => false });
    await assert.rejects(() => doors.create(aTask()), /Cut it first/);
});

test('a name git will not take is refused before anything is written', async () => {
    await setUp({ branchNameIsOk: async () => 'Git will not accept "..bad" as a branch name.' });
    await assert.rejects(() => doors.create(aTask({ branch: '..bad' })), /Git will not accept/);
    assert.deepEqual(await store.read(), [], 'and nothing was written down');
});

//---------------------------------------------------------------------------
//THE RULES ARE COPIED IN, THE SAME WAY THE BRIEF IS.
//---------------------------------------------------------------------------

test('a contract from the library is stored as its WORDS, not as its name', async () => {
    await setUp({
        contract: async () => ({ id: 'c1', name: 'the usual rules', text: 'do not push to master', approved: true })
    });

    const made = await doors.create(aTask({ contractId: 'c1' }));

    //A name proves nothing months later about what the worker was actually held
    //to, and the library it named has moved on since.
    assert.equal(made.rules, 'do not push to master');
    assert.equal(made.contractName, 'the usual rules');
});

test('an unapproved contract is refused, and an edited one says which it is', async () => {
    await setUp({ contract: async () => ({ id: 'c1', name: 'the usual rules', text: 'x', approved: false }) });
    //What a worker may NOT do is read before it is sent, the same as what it is
    //told to do.
    await assert.rejects(() => doors.create(aTask({ contractId: 'c1' })), /is not approved/);

    await setUp({
        contract: async () => ({ id: 'c1', name: 'the usual rules', text: 'x', approved: false, lapsed: true })
    });
    await assert.rejects(() => doors.create(aTask({ contractId: 'c1' })), /has been edited since it was approved/);
});

test('a contract from the library AND a file is refused rather than one being preferred', async () => {
    await assert.rejects(
        () => doors.create(aTask({ contractId: 'c1', contract: '/some/file' })),
        /which line of code read it first/
    );
});

//---------------------------------------------------------------------------
//AND A JOB FOR DOING WORK, NOT FOR READING IT.
//---------------------------------------------------------------------------

test('a judge job cannot be given to a task', async () => {
    await setUp({ job: async () => ({ id: 'read-it', name: 'read it', kind: 'judge' }) });

    //The refusal runs in both directions: a judge given to a task would send a
    //machine to READ a change under rules written for reading, on a branch it
    //was told to deliver on.
    await assert.rejects(() => doors.create(aTask({ job: 'read-it' })), /Pick a job from the work library/);
});

test('a job that does not exist is refused where it is cheap to find out', async () => {
    await assert.rejects(() => doors.create(aTask({ job: 'nothing' })), /There is no job called "nothing"/);
});

test("a work job's name travels with its id", async () => {
    await setUp({ job: async () => ({ id: 'build-it', name: 'build the thing', kind: 'work' }) });
    const made = await doors.create(aTask({ job: 'build-it' }));
    assert.equal(made.jobName, 'build the thing');
});

//---------------------------------------------------------------------------
//A TAG NOTHING CARRIES IS SAID, NOT REFUSED.
//---------------------------------------------------------------------------

test('a tag no machine carries is a warning on the task, and the task is still written', async () => {
    await setUp({ machines: async () => [{ name: 'runner-1', tags: ['worker'] }] });
    const made = await doors.create(aTask({ tag: 'gpu' }));

    //A machine can be tagged after the task is written, and that is an ordinary
    //way to work. What is not ordinary is not knowing.
    assert.equal(made.tag, 'gpu');
    assert.match(made.warning, /No machine carries the tag "gpu"/);
    assert.match(made.warning, /What is there: worker/);
});

test('a tag something carries says nothing at all', async () => {
    await setUp({ machines: async () => [{ name: 'runner-1', tags: ['worker', 'GPU'] }] });
    const made = await doors.create(aTask({ tag: 'gpu' }));
    assert.equal(made.warning, undefined, 'and case does not make it a different pool');
});

//---------------------------------------------------------------------------
//PUTTING IT IN THE QUEUE.
//---------------------------------------------------------------------------

test("a person's task is refused at the door rather than skipped in silence", async () => {
    const made = await doors.create(aTask({ worker: 'person' }));

    //A task sitting queued that nothing will ever pick up looks exactly like one
    //that is merely waiting its turn.
    await assert.rejects(
        () => doors.queue(made.id, planWith([])),
        /would roll a machine back and run Claude over the top of it/
    );
    assert.equal((await store.get(made.id)).state, 'draft', 'and it was not queued anyway');
});

test('a task that has been judged is not reopened', async () => {
    const made = await doors.create(aTask());
    await store.update(made.id, { verdict: 'accepted' });

    await assert.rejects(
        () => doors.queue(made.id, planWith([])),
        /Write a new task rather than reopening a decided one/
    );
});

test('queueing says how many machines can take it, by the rule the tick dispatches by', async () => {
    const made = await doors.create(aTask());
    const machines = [
        { name: 'runner-1', tags: ['worker'], baseSnapshot: 'b', forTasks: true, stage: 'ready' },
        { name: 'judge-1', tags: ['judge'], baseSnapshot: 'b', forTasks: true, stage: 'ready' }
    ];

    const said = await doors.queue(made.id, planWith(machines));

    assert.equal(said.state, 'queued');
    //COUNTING FREE MACHINES ALONE answered "2 machine(s) can take it" here — and
    //one of them is a judge machine a task must never go to.
    assert.match(said.note, /^1 machine\(s\) can take it/);
});

test('a tagged task that nothing can take says so when it is queued, not fifteen minutes later', async () => {
    const made = await doors.create(aTask({ tag: 'gpu' }));
    const machines = [{ name: 'runner-1', tags: ['worker'], baseSnapshot: 'b', forTasks: true, stage: 'ready' }];

    const said = await doors.queue(made.id, planWith(machines));

    assert.match(said.note, /Nothing tagged "gpu" is free/);
    assert.match(said.note, /a tagged task waits rather than taking a machine of another kind/);
    assert.ok(said.waitingFor.length, 'and it says why');
});

test('queueing a task whose branch has since been deleted is refused', async () => {
    const made = await doors.create(aTask());
    await setUp({ branchExists: async () => false });
    //Rebuilt store, so put the task back the way it was found.
    const again = await makeDoors(store, ask({ branchExists: async () => true }), null).create(aTask());

    doors = makeDoors(store, ask({ branchExists: async () => false }), null);
    await assert.rejects(() => doors.queue(again.id, planWith([])), /Cut it first/);
    assert.ok(made);
});

//---------------------------------------------------------------------------
//AND THROWING IT AWAY.
//---------------------------------------------------------------------------

test('forgetting a task leaves the branch and the logs alone', async () => {
    const made = await doors.create(aTask({ branch: 'fix/it' }));
    const gone = await doors.remove(made.id);

    assert.equal(gone.number, made.number);
    assert.match(gone.note, /The branch "fix\/it" and the logs kept for it are untouched/);
    assert.deepEqual(await store.read(), []);
});

//---------------------------------------------------------------------------
//AND TAKING ONE BACK OUT.
//
//THE CLAIM: work left queued is a run that has not happened yet. It sits there
//looking inert on a host that cannot dispatch — nothing free, or no sign-in to
//give it — and starts the moment that changes. Without this door the only ways
//out of the queue are to let it run or to throw the task away.
//---------------------------------------------------------------------------

test('a queued task can be taken back out, and is a draft again', async () => {
    const made = await doors.create(aTask());
    const machines = [{ name: 'runner-1', tags: ['worker'], baseSnapshot: 'b', forTasks: true, stage: 'ready' }];
    await doors.queue(made.id, planWith(machines));

    const back = await doors.unqueue(made.id);

    assert.equal(back.state, 'draft');
    assert.equal((await store.get(made.id)).state, 'draft', 'the record still says queued');
    assert.match(back.note, /Nothing will pick it up until it is queued once more/);
});

test('one already given out is not called back by this', async () => {
    //THE MACHINE IS WORKING, and stopping it is a different act on a different
    //thing — said rather than silently doing half of it.
    const made = await doors.create(aTask());
    await store.update(made.id, { state: 'given', machine: 'runner-1' });

    await assert.rejects(
        () => doors.unqueue(made.id),
        /is "given", not queued/
    );
    assert.equal((await store.get(made.id)).state, 'given', 'and it was taken back anyway');
});

test('and neither is a draft that was never queued', async () => {
    //NOT HARMLESS TO ALLOW. "It is a draft now" is the same answer whether this
    //did anything or not, so a caller that named the wrong task would be told it
    //had worked.
    const made = await doors.create(aTask());

    await assert.rejects(
        () => doors.unqueue(made.id),
        /is "draft", not queued/
    );
});
