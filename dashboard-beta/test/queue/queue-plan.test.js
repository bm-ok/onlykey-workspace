const { test } = require('node:test');
const assert = require('node:assert');

const policy = require('../../src/app/queue/policy');

//---------------------------------------------------------------------------
//what would go where, and what was stranded — the deciding, without the acting.
//
//THE CLAIM THIS FILE IS FOR: the whole dispatch decision can be asked a
//question. While it lived inside the tick the only way to find out what it would
//do was to let it do it — and both halves of it have been wrong in ways that
//cost real machines and real money.
//
//`stranded` re-queued a task somebody was working on by hand, handing it to a
//second machine while the person had an editor open on the first. Proving that
//rule meant restarting the app and arranging for the restart to land inside a
//twenty-second window; it was found by accident.
//
//`plan`'s waiting reasons all lied at once on a host where the machines had had
//their roles taken off: it named a busy judge machine that did not exist, and a
//missing tag that was already there. A wait that names the wrong cause is worse
//than silence, because somebody acts on it.
//---------------------------------------------------------------------------

const vm = (name, extra) => Object.assign({
    name,
    tags: ['worker'],
    baseSnapshot: 'base',
    forTasks: true,
    branch: null,
    stage: 'ready'
}, extra || {});

const task = (number, extra) => Object.assign({ kind: 'task', number, ref: '#' + number }, extra || {});
const judgement = (number, extra) => Object.assign({ kind: 'judgement', number, ref: 'J' + number }, extra || {});

const PLENTY = { worker: { free: 2, paused: [] }, judge: { free: 2, paused: [] } };

//---------------------------------------------------------------------------
//WHAT WAS STRANDED.
//---------------------------------------------------------------------------

test('work set up and never started goes back in the queue', () => {
    const rows = [
        { id: 'a', state: 'given', run: null, worker: 'claude' },
        { id: 'b', state: 'given', run: 'run-7', worker: 'claude' },
        { id: 'c', state: 'queued', run: null, worker: 'claude' },
        { id: 'd', state: 'done', run: 'run-8', worker: 'claude' }
    ];

    //`given` with no run means it was being SET UP when this stopped. Nothing
    //was dispatched, so nothing happened and there is nothing to judge.
    assert.deepEqual(policy.stranded(rows, (x) => x.worker).map((x) => x.id), ['a']);
});

test("a person's work is never re-queued, whichever kind of work it is", () => {
    //THE EXCEPTION THAT COST TWO MACHINES ON ONE BRANCH. A task somebody took by
    //hand sits in `given` with no run for as long as they are working in it —
    //there is no run because there is no worker process.
    const tasks = [
        { id: 'mine', state: 'given', run: null, worker: 'person' },
        { id: 'theirs', state: 'given', run: null, worker: 'claude' }
    ];
    assert.deepEqual(policy.stranded(tasks, (x) => x.worker).map((x) => x.id), ['theirs']);

    //AND THE SAME FOR A JUDGEMENT, which the rule did not cover — everything
    //here was written when tasks were the only work there was, and judging
    //arrived later through the door that left open. A judgement says whose it is
    //in a DIFFERENT FIELD, which is why the rule takes a function.
    const judgements = [
        { id: 'reading', state: 'given', run: null, by: 'person' },
        { id: 'j41', state: 'given', run: null, by: 'claude' }
    ];
    assert.deepEqual(policy.stranded(judgements, (x) => x.by).map((x) => x.id), ['j41']);
});

//---------------------------------------------------------------------------
//WHAT WOULD GO WHERE.
//---------------------------------------------------------------------------

test('judgements go out before tasks, and each takes one machine', () => {
    const machines = [vm('runner-1'), vm('runner-2', { tags: ['worker', 'judge'] })];
    const said = policy.plan([task(4), judgement(9)], machines, { signIns: PLENTY });

    assert.deepEqual(said.dispatch.map((d) => d.ref), ['J9', '#4']);
    //One machine is never planned for two pieces of work.
    assert.equal(new Set(said.dispatch.map((d) => d.machine)).size, 2);
    assert.deepEqual(said.waiting, []);
    assert.deepEqual(said.free, []);
});

test('a tagged entry that cannot be placed does not hold up the ones behind it', () => {
    const machines = [vm('runner-1')];
    const said = policy.plan([task(1, { tag: 'big' }), task(2)], machines, { signIns: PLENTY });

    //TAKEN BY MATCH RATHER THAN BY POSITION. #1 wants a machine this host does
    //not have; #2 takes anything and should go.
    assert.deepEqual(said.dispatch.map((d) => d.ref), ['#2']);
    assert.deepEqual(said.waiting.map((w) => w.ref), ['#1']);
    assert.match(said.waiting[0].why, /wants a machine tagged "big"/);
});

test('a task is never planned onto a judge machine', () => {
    const machines = [vm('judge-1', { tags: ['judge'] })];
    const said = policy.plan([task(4)], machines, { signIns: PLENTY });

    assert.deepEqual(said.dispatch, []);
    assert.match(said.waiting[0].why, /waits for one tagged worker/);
});

//---------------------------------------------------------------------------
//AND THE REASON HAS TO BE THE REAL REASON.
//---------------------------------------------------------------------------

test('on a host whose machines have no role, that is what it says — and nothing else', () => {
    //THE THREE-WAY LIE. With the roles taken off, this named a busy judge
    //machine that did not exist and a missing tag that was already there, while
    //two perfectly good machines sat free wanting nothing but a role.
    const machines = [vm('kit-1', { tags: ['test'] }), vm('kit-2', { tags: ['test'] })];
    const said = policy.plan([task(4, { tag: 'test' })], machines, { signIns: PLENTY });

    assert.deepEqual(said.dispatch, []);
    const why = said.waiting[0].why;

    assert.match(why, /kit-1, kit-2 are free and have not been told what they are for/);
    assert.match(why, /vmTags/);
    //The two sentences that were wrong.
    assert.doesNotMatch(why, /busy/);
    assert.doesNotMatch(why, /tagged "test" and none is free/);
});

test('a judgement waiting on a busy judge machine says exactly that, and only when one exists', () => {
    const machines = [vm('runner-1'), vm('judge-1', { tags: ['judge'] })];
    const said = policy.plan([judgement(9)], machines, {
        inFlight: { 'judge-1': 'J8' },
        signIns: PLENTY
    });

    assert.deepEqual(said.dispatch, []);
    assert.match(said.waiting[0].why, /every judge runner is busy/);
    assert.match(said.waiting[0].why, /rather than being read by a worker runner/);
});

test('the roleless sentence names the tag the WORK needs, not a fixed one', () => {
    const machines = [vm('kit-1', { tags: [] })];

    const forTask = policy.plan([task(4)], machines, { signIns: PLENTY }).waiting[0].why;
    const forJudgement = policy.plan([judgement(9)], machines, { signIns: PLENTY }).waiting[0].why;

    assert.match(forTask, /"worker" tag/);
    assert.match(forJudgement, /"judge" tag/);
});

//---------------------------------------------------------------------------
//AND WHETHER THERE IS AN IDENTITY TO GIVE IT.
//---------------------------------------------------------------------------

test('with no sign-in free, no machine is spent — the work waits', () => {
    //A task dispatched with no credential available boots a machine, rolls it
    //forward, fails at the handover and rolls it back. The refusal it produced
    //said "Nothing will spend a machine on these until then" immediately after
    //spending one.
    const machines = [vm('runner-1')];
    const said = policy.plan([task(4)], machines, {
        signIns: { worker: { free: 0, paused: [] }, judge: { free: 2, paused: [] } }
    });

    assert.deepEqual(said.dispatch, []);
    assert.match(said.waiting[0].why, /needs a worker sign-in and none is free/);
    assert.deepEqual(said.free, ['runner-1'], 'the machine is left free rather than held');
});

test('a paused sign-in says so, and says where to fix it', () => {
    const machines = [vm('runner-1')];
    const said = policy.plan([task(4)], machines, {
        signIns: { worker: { free: 0, paused: ['work-1', 'work-2'] }, judge: { free: 0, paused: [] } }
    });

    //It is not a failure and must not be filed as one — a paused sign-in is
    //fixed by a person at a login page, and the work should be there waiting
    //when they have done it.
    assert.match(said.waiting[0].why, /every one this host holds is paused \("work-1", "work-2"\)/);
    assert.match(said.waiting[0].why, /Sign in again on the Runners tab/);
});

test('which sign-in is asked of the WORK, so a dual machine does not read as needing none', () => {
    const machines = [vm('both-1', { tags: ['worker', 'judge'] })];

    //Asked of the machine, this answered null for one tagged worker AND judge.
    const forJudgement = policy.plan([judgement(9)], machines, { signIns: PLENTY });
    const forTask = policy.plan([task(4)], machines, { signIns: PLENTY });

    assert.equal(forJudgement.dispatch[0].needs, 'judge');
    assert.equal(forTask.dispatch[0].needs, 'worker');
});

//---------------------------------------------------------------------------
//AND IT NEVER PLANS A MACHINE THAT IS NOT FREE.
//---------------------------------------------------------------------------

test('a machine already in flight is not planned for anything', () => {
    const machines = [vm('runner-1')];
    const said = policy.plan([task(4)], machines, { inFlight: { 'runner-1': '#3' }, signIns: PLENTY });

    assert.deepEqual(said.dispatch, []);
    assert.deepEqual(said.free, []);
});

test('more work than machines leaves the rest waiting, in order', () => {
    const machines = [vm('runner-1')];
    const said = policy.plan([task(1), task(2), task(3)], machines, { signIns: PLENTY });

    assert.deepEqual(said.dispatch.map((d) => d.ref), ['#1']);
    assert.deepEqual(said.waiting.map((w) => w.ref), ['#2', '#3']);
    assert.match(said.waiting[0].why, /no machine is free/);
});
