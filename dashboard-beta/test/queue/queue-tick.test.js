const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makeTick = require('../../src/app/queue/tick');

//---------------------------------------------------------------------------
//THE TICK.
//
//THE DECISION IS NOT HERE — ./policy.plan makes it, and has its own tests. What
//is checked here is what SURROUNDS it.
//
//THE CLAIM WORTH THE MOST: the machine is claimed SYNCHRONOUSLY, before any
//await. Two ticks that both read a free machine and then both dispatch is two
//workers rolling one machine back underneath each other.
//
//AND THE SECOND: work that throws on the way up has to LAND. It threw before it
//could be marked done, so it stays in `given` for ever — not queued, so nothing
//picks it up; not done, so the board shows it working with no worker anywhere.
//
//AND THE THIRD: a wait is said ONCE. This runs four times a minute, and a task
//waiting overnight writes three and a half thousand identical lines into a
//record that is read from a bookmark.
//---------------------------------------------------------------------------

let said, claimed, ran, tasks, judgements, machines, open, held, watched, updated, throws;

//`baseSnapshot` IS NOT DECORATION. ./policy reports a machine with none as not
//free, because there is nothing to come back to and it cannot be made clean.
const VM = (name, tags) => ({ name, tags: tags || ['worker'], baseSnapshot: 'base', running: false });
const TASK = (over) => Object.assign({ id: 't1', number: 7, state: 'queued', title: 'do it', attempts: [] }, over || {});
const JUDGEMENT = (over) => Object.assign({ id: 'j1', number: 36, state: 'queued', job: 'read-it', attempts: [] }, over || {});

beforeEach(() => {
    said = [];
    claimed = [];
    ran = [];
    updated = [];
    watched = 0;
    throws = {};
    tasks = [TASK()];
    judgements = [];
    machines = [VM('kit-1')];
    open = true;
    held = { worker: { free: 1, paused: [] }, judge: { free: 1, paused: [] } };
});

function tick(over) {
    return makeTick(Object.assign({
        call: async (what, args) => { updated.push({ what, args }); return {}; },
        say: () => ({
            info: (m) => said.push(m), warn: (m) => said.push('WARN ' + m),
            bad: (m) => said.push('BAD ' + m), good: (m) => said.push('GOOD ' + m)
        }),
        workspaceOpen: () => open,
        machinesNow: async () => machines,
        tasksNow: async () => tasks,
        judgementsNow: async () => judgements,
        inFlight: () => ({}),
        signIns: () => held,
        claim: (m, ref) => claimed.push({ m, ref, ran: ran.length }),
        runTask: async (entry, m) => {
            ran.push({ kind: 'task', ref: '#' + entry.number, m });
            if (throws.task) throw throws.task;
        },
        runJudgement: async (entry, m) => {
            ran.push({ kind: 'judgement', ref: entry.ref, m });
            if (throws.judgement) throw throws.judgement;
        },
        judging: { update: (id, patch) => updated.push({ what: 'judging.update', args: { id, patch } }) },
        watch: () => { watched++; },
        stamp: () => '2026-08-22T13:00:00Z'
    }, over || {}));
}

//THE DISPATCH IS FIRED AND LET GO, so a test that wants to see where a failure
//landed has to let the microtask queue drain first.
const settle = () => new Promise((r) => setImmediate(r));

//AND EVERY WAIT IS BOUNDED. Two of the claims below are that something does NOT
//wait on something else — and the failure of those is an unsettled promise,
//which HANGS rather than failing. A hang has no message, no name and no line, so
//it cannot be reported: the suite simply never ends. Bounded, the same break
//comes back as one named test with a sentence on it.
function before(ms, what, p) {
    let timer;
    return Promise.race([
        Promise.resolve(p).finally(() => clearTimeout(timer)),
        new Promise((_, no) => { timer = setTimeout(() => no(new Error(what)), ms); })
    ]);
}

//---- whether a tick should happen at all -----------------------------------

test('nothing is dispatched when there is nowhere to deliver', async () => {
    //"NO WORK" AND "NO WORKSPACE" ARE DIFFERENT SENTENCES, and a queue that
    //cannot tell them apart would happily dispatch the moment a stale file
    //answered.
    open = false;
    const out = await tick().once();

    assert.equal(out.skipped, 'no workspace');
    assert.deepEqual(claimed, []);
    assert.ok(said.some((m) => /no workspace is open — nothing is dispatched until one is/.test(m)));
});

test('and it says so once, not four times a minute', async () => {
    open = false;
    const t = tick();
    await t.once(); await t.once(); await t.once();

    assert.equal(said.filter((m) => /no workspace is open/.test(m)).length, 1,
        'a heartbeat saying nothing is happening is how a log stops being read');
});

test('and says it again after a workspace has been opened and closed', async () => {
    open = false;
    const t = tick();
    await t.once();
    open = true;
    await t.once();
    open = false;
    await t.once();

    assert.equal(said.filter((m) => /no workspace is open/.test(m)).length, 2);
});

test('a tick that is already running does not start a second one', async () => {
    //EVERYTHING READ BEFORE THE CLAIM WOULD BE READ TWICE, and the second read
    //would be of a board the first had already changed.
    let letGo;
    const t = tick({ machinesNow: () => new Promise((r) => { letGo = () => r(machines); }) });

    const first = t.once();
    await settle();
    const second = await before(1000, 'the second tick waited on the first instead of standing down', t.once());

    assert.equal(second.skipped, 'a tick is already running');
    letGo();
    await first;
});

test('and the guard is released however the tick ends', async () => {
    //THE THROW ITSELF IS FINE — ../core/cron catches what a job rejects with and
    //says it. What is not fine is the guard staying set, because then the queue
    //never ticks again and NOTHING says that.
    let broken = true;
    const t = tick({
        machinesNow: async () => {
            if (broken) { broken = false; throw new Error('vmList is down'); }
            return machines;
        }
    });

    await assert.rejects(() => t.once(), /vmList is down/);

    const out = await t.once();
    assert.equal(out.skipped, undefined, 'one failed tick stopped the queue for ever');
    assert.equal(out.dispatched.length, 1);
});

//---- and whether this app owns both ends of the board -----------------------
//
//THE HAZARD: the queue defines `tasks` and, for a while, did not define
//`taskUpdate` — so the tick READ this app's board and every write RELAYED to the
//app being ported from, the one actually running work on real machines.
//Adoption reads a stranded task here and re-queues it over there; a dispatch
//marks `given` on a board it did not read it from.
//
//IT IS ASKED EACH TICK rather than carried as a flag, so it clears itself the
//day the action moves — which it now has. This is what keeps the guard honest if
//anything ever moves back out.

test('nothing is dispatched while it reads here and writes elsewhere', async () => {
    const out = await tick({ ownsTheBoard: () => false }).once();

    assert.equal(out.skipped, 'the board is read here and written elsewhere');
    assert.deepEqual(claimed, [], 'it claimed a machine for work it could not record');
    assert.deepEqual(ran, []);
    assert.ok(said.some((m) => /nothing is dispatched from this host/.test(m)), said.join(' | '));
    assert.ok(said.some((m) => /This clears itself when taskUpdate moves here/.test(m)));
});

test('and it says so once, not four times a minute', async () => {
    const t = tick({ ownsTheBoard: () => false });
    await t.once(); await t.once(); await t.once();

    assert.equal(said.filter((m) => /nothing is dispatched from this host/.test(m)).length, 1);
});

test('and says it again if it becomes true a second time', async () => {
    //A CONDITION THAT CLEARED AND CAME BACK is news, for the same reason the
    //workspace one is.
    let owns = false;
    const t = tick({ ownsTheBoard: () => owns });

    await t.once();
    owns = true;
    await t.once();
    owns = false;
    await t.once();

    assert.equal(said.filter((m) => /nothing is dispatched from this host/.test(m)).length, 2);
});

test('the workspace is asked FIRST, because it is the ordinary reason', async () => {
    //A HOST WITH NO WORKSPACE OPEN and a split board has two true answers, and
    //only one of them is about anything somebody can do something about today.
    open = false;
    const out = await tick({ ownsTheBoard: () => false }).once();

    assert.equal(out.skipped, 'no workspace');
});

//---- what the queue will and will not touch --------------------------------

test('work a person is doing is never picked up', async () => {
    //DISPATCHING ONE ROLLS A MACHINE BACK TO A SNAPSHOT and runs Claude over the
    //top of it, with somebody's editor open on it.
    tasks = [TASK({ worker: 'person' })];
    judgements = [JUDGEMENT({ by: 'person' })];

    const out = await tick().once();
    assert.deepEqual(out.dispatched, []);
    assert.deepEqual(ran, []);
});

test('a judgement with no job never reaches the queue', async () => {
    //WHICH IS WHY ../queue/onejudgement has two endings rather than three.
    tasks = [];
    judgements = [JUDGEMENT({ job: null })];

    const out = await tick().once();
    assert.deepEqual(out.dispatched, []);
});

test('and nothing that is not queued', async () => {
    tasks = [TASK({ state: 'given' }), TASK({ id: 't2', number: 8, state: 'done' })];
    const out = await tick().once();
    assert.deepEqual(out.dispatched, []);
});

//---- the claim -------------------------------------------------------------

test('the machine is claimed before the work is started', async () => {
    await tick().once();

    assert.equal(claimed.length, 1);
    assert.deepEqual(claimed[0], { m: 'kit-1', ref: '#7', ran: 0 },
        'the work was started before its machine was claimed');
});

test('one machine is never given to two pieces of work', async () => {
    tasks = [TASK(), TASK({ id: 't2', number: 8 })];
    machines = [VM('kit-1')];

    const out = await tick().once();

    assert.equal(out.dispatched.length, 1);
    assert.equal(claimed.length, 1);
});

test('two machines take two pieces of work', async () => {
    tasks = [TASK(), TASK({ id: 't2', number: 8 })];
    machines = [VM('kit-1'), VM('kit-2')];

    const out = await tick().once();
    assert.equal(out.dispatched.length, 2);
    assert.deepEqual(claimed.map((c) => c.m).sort(), ['kit-1', 'kit-2']);
});

test('a machine already in flight is not given anything', async () => {
    const out = await tick({ inFlight: () => ({ 'kit-1': '#9' }) }).once();
    assert.deepEqual(out.dispatched, []);
});

//---- a judgement goes down its own path -------------------------------------

test('a judgement is run as a judgement, and a task as a task', async () => {
    tasks = [TASK()];
    judgements = [JUDGEMENT()];
    machines = [VM('kit-1', ['judge']), VM('kit-2', ['worker'])];

    await tick().once();

    assert.deepEqual(ran.map((r) => r.kind).sort(), ['judgement', 'task']);
    assert.equal(ran.filter((r) => r.kind === 'judgement')[0].m, 'kit-1');
    assert.equal(ran.filter((r) => r.kind === 'task')[0].m, 'kit-2');
});

test('and a judgement carries its ref, not its bare number', async () => {
    tasks = [];
    judgements = [JUDGEMENT()];
    machines = [VM('kit-1', ['judge'])];

    const out = await tick().once();
    assert.equal(out.dispatched[0].ref, 'J36');
});

//---- why something waits, said once -----------------------------------------

test('a wait is said once, however many ticks it lasts', async () => {
    machines = [];
    const t = tick();
    await t.once(); await t.once(); await t.once();

    const waits = said.filter((m) => /#7/.test(m));
    assert.equal(waits.length, 1, 'it said the same thing ' + waits.length + ' times');
});

test('but a wait for a DIFFERENT reason says so', async () => {
    //KEYED ON THE REASON, NOT ON THE WORK.
    machines = [];
    const t = tick();
    await t.once();

    machines = [VM('kit-1', [])];   //free, and has not been told what it is for
    await t.once();

    assert.ok(said.length >= 2, 'a task that started waiting for a new reason stayed silent: ' + said.join(' | '));
    assert.ok(said.some((m) => /has not been told what it is for/.test(m)), said.join(' | '));
});

test('and being dispatched makes the next wait news again', async () => {
    machines = [];
    const t = tick();
    await t.once();
    const first = said.length;

    machines = [VM('kit-1')];
    await t.once();

    tasks = [TASK({ id: 't1', number: 7 })];
    machines = [];
    await t.once();

    assert.ok(said.length > first, 'the next wait was silenced by a sentence from a previous one');
});

test('work waiting on a sign-in waits rather than spending a machine', async () => {
    //A TASK DISPATCHED WITH NONE AVAILABLE boots a machine, rolls it forward,
    //fails at the handover and rolls it back. The refusal it produced said
    //"Nothing will spend a machine on these until then" immediately after
    //spending one.
    held = { worker: { free: 0, paused: ['a-worker'] }, judge: { free: 1, paused: [] } };

    const out = await tick().once();

    assert.deepEqual(out.dispatched, []);
    assert.deepEqual(claimed, []);
    assert.ok(said.some((m) => /needs a worker sign-in and every one this host holds is paused/.test(m)),
        said.join(' | '));
});

//---- and anything that arrived from outside ----------------------------------

test('the watch is fired and let go, not awaited into the dispatch path', async () => {
    //A SLOW GITHUB IS NOT A REASON FOR THE QUEUE TO STOP GIVING OUT WORK.
    let released;
    const out = await before(1000, 'a slow watch held up the whole tick', tick({
        watch: () => { watched++; return new Promise((r) => { released = r; }); }
    }).once());

    assert.equal(watched, 1);
    assert.equal(out.dispatched.length, 1, 'a slow watch held up the dispatch');
    if (released) released();
});

test('and it is not fired when there is no workspace', async () => {
    open = false;
    await tick().once();
    assert.equal(watched, 0);
});

//---- and where a failure lands ------------------------------------------------

test('a task that threw on the way up is marked failed, not left in given', async () => {
    //IT STAYED IN `given` FOR EVER: not queued, so nothing would pick it up; not
    //ended, so the board showed it working with no worker anywhere.
    //
    //`failed` RATHER THAN `done`, WHICH IS WHAT THIS SAID. Both are ended, so
    //the rule this test is about is unchanged — what changed is that there is
    //now a word for "it never ran". `done` means the run ENDED, and reading it
    //on something that died on the way up files "we learnt nothing" as the
    //outcome of work that never started. The note in the source beside the
    //identity case below said exactly that and then wrote `done` anyway,
    //because there was nothing else to write.
    throws.task = new Error('the machine would not boot');
    await tick().once();
    await settle();

    const wrote = updated.filter((u) => u.what === 'taskUpdate')[0];
    assert.ok(wrote, 'the task landed nowhere: ' + JSON.stringify(updated));
    assert.equal(wrote.args.task.state, 'failed');
    //AND THE RULE ITSELF, rather than the word for it: whatever it is called, it
    //is not still in flight and it is not waiting to be picked up again.
    assert.ok(!['given', 'queued'].includes(wrote.args.task.state),
        'a dispatch that threw was left somewhere the queue will act on again');
    assert.equal(wrote.args.task.attempts.slice(-1)[0].failed, 'the machine would not boot');
    assert.ok(said.some((m) => /BAD #7 — the machine would not boot/.test(m)), said.join(' | '));
});

test('except when there was no identity to give it, which is not that', async () => {
    //NOTHING WAS READ, NOTHING WAS WRITTEN, AND NO CODE WAS EVEN FETCHED, so
    //`done` would file "we learnt nothing" as the outcome of a task that never
    //started.
    const e = new Error('no sign-in was free');
    e.noIdentity = true;
    throws.task = e;

    await tick().once();
    await settle();

    const wrote = updated.filter((u) => u.what === 'taskUpdate')[0];
    assert.equal(wrote.args.task.state, 'queued');
    assert.equal(wrote.args.task.machine, null);
    assert.equal(wrote.args.task.run, null);
    assert.ok(said.some((m) => /#7 is back in the queue — it was never started, because there was no sign-in/.test(m)),
        said.join(' | '));
});

test('and a landing that itself fails does not take the tick with it', async () => {
    throws.task = new Error('the machine would not boot');
    const t = tick({ call: async () => { throw new Error('the store is gone'); } });

    await t.once();
    await settle();

    //THE LOG ALREADY CARRIES IT. What must not happen is an unhandled rejection
    //killing the process the queue runs in.
    assert.ok(said.some((m) => /BAD #7 — the machine would not boot/.test(m)));
});

test('a judgement that threw on the way up lands in its own store', async () => {
    tasks = [];
    judgements = [JUDGEMENT()];
    machines = [VM('kit-1', ['judge'])];
    throws.judgement = new Error('it reads nothing this workspace has');

    await tick().once();
    await settle();

    const wrote = updated.filter((u) => u.what === 'judging.update')[0];
    assert.ok(wrote, 'the judgement landed nowhere');
    assert.equal(wrote.args.patch.state, 'failed');
    assert.equal(wrote.args.patch.attempts.slice(-1)[0].failed, 'it reads nothing this workspace has');
    assert.ok(said.some((m) => /BAD J36 — it reads nothing this workspace has/.test(m)), said.join(' | '));
});

test('a judgement is never re-queued by the landing, whatever it threw', async () => {
    //THE ATTEMPT HAPPENED AND PRODUCED NOTHING, which is a true and useful thing
    //to see — and re-queueing onto a machine that just failed to boot does that
    //for ever, quietly, with nobody deciding anything.
    tasks = [];
    judgements = [JUDGEMENT()];
    machines = [VM('kit-1', ['judge'])];
    const e = new Error('no sign-in was free');
    e.noIdentity = true;
    throws.judgement = e;

    await tick().once();
    await settle();

    //THE RULE IS "NOT BACK IN THE QUEUE", not "called done". `failed` is ended,
    //so nothing picks it up again and the loop this test guards against cannot
    //start — a person re-queues it once the reason is gone.
    const landed = updated.filter((u) => u.what === 'judging.update')[0].args.patch.state;
    assert.equal(landed, 'failed');
    assert.notEqual(landed, 'queued', 'the landing put it back in the queue, which is the loop this guards');
});

//---- and the tick reports what it did ------------------------------------------

test('it says what went out and what is still waiting', async () => {
    tasks = [TASK(), TASK({ id: 't2', number: 8 })];
    machines = [VM('kit-1')];

    const out = await tick().once();

    assert.deepEqual(out.dispatched, [{ ref: '#7', machine: 'kit-1', kind: 'task' }]);
    assert.deepEqual(out.waiting, ['#8']);
});

test('and an empty board is not an error', async () => {
    tasks = [];
    const out = await tick().once();
    assert.deepEqual(out, { dispatched: [], waiting: [] });
});
