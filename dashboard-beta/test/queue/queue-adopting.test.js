const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makeAdopting = require('../../src/app/queue/adopting');
const { recommendationIn } = require('../../src/app/queue/adopting');

//---------------------------------------------------------------------------
//WHAT A RESTART LEFT BEHIND.
//
//THE CLAIM WORTH THE MOST: four situations, told apart. Work that never started
//goes back in the queue; work that WAS running is waited on, filed, and its
//machine put away. Getting the two the wrong way round either loses a completed
//reading or re-runs one that is still going on a second machine.
//
//AND THE SECOND: a person's is left alone in all four. Work somebody took by
//hand sits in `given` with no run for as long as they are working in it, and
//re-queueing one hands their branch to a second machine while they are still in
//the first.
//
//AND THE THIRD: the machine comes back. The `finally` that puts it away died
//with the process that was watching, so a complete reading left a machine up
//holding a judge's credential, out of the pool, for twenty minutes.
//---------------------------------------------------------------------------

let said, tasks, judgements, machines, open, claimed, released, wrote, awaited, put, archived, art, output;

const TASK = (over) => Object.assign({ id: 't1', number: 7, uid: 'u7', state: 'given', attempts: [] }, over || {});
const J = (over) => Object.assign({ id: 'j1', number: 36, uid: 'u36', state: 'given', attempts: [] }, over || {});

beforeEach(() => {
    said = [];
    claimed = [];
    released = [];
    wrote = [];
    awaited = [];
    put = [];
    archived = [];
    tasks = [];
    judgements = [];
    machines = [{ name: 'kit-1', connected: true }];
    open = true;
    art = { delivered: true, summary: 'one file' };
    output = 'okc-result {"recommendation":"accept"}';
});

function adopting(over) {
    return makeAdopting(Object.assign({
        call: async (what, args) => {
            wrote.push({ what, args });
            if (what === 'taskArtifact') return art;
            if (what === 'vmRunOutput') return { output };
            return {};
        },
        say: () => ({
            info: (m) => said.push(m), warn: (m) => said.push('WARN ' + m),
            bad: (m) => said.push('BAD ' + m), good: (m) => said.push('GOOD ' + m)
        }),
        workspaceOpen: () => open,
        machinesNow: async () => machines,
        tasksNow: async () => tasks,
        judgementsNow: async () => judgements,
        judging: {
            get: (id) => judgements.filter((j) => j.id === id)[0],
            update: (id, patch) => {
                wrote.push({ what: 'judging.update', args: { id, patch } });
                Object.assign(judgements.filter((j) => j.id === id)[0] || {}, patch);
            }
        },
        held: () => false,
        claim: (m, ref) => claimed.push({ m, ref }),
        release: (m) => released.push(m),
        running: { waitForRun: async (to, m, run) => { awaited.push({ m, run }); return { state: 'finished', exit: 0 }; } },
        putting: { putAway: async (m) => { put.push(m); } },
        kept: () => false,
        keep: (uid, run, what) => archived.push({ uid, run, what }),
        stamp: () => '2026-08-22T13:00:00Z'
    }, over || {}));
}

const settle = () => new Promise((r) => setImmediate(r));

//---- what the okc-result line says -----------------------------------------

test('the recommendation is read off the run\'s own output', () => {
    //THE ONLY PLACE IT EXISTS for a reading this app was not watching.
    assert.equal(recommendationIn('okc-result {"recommendation":"accept"}'), 'accept');
});

test('the last one, because a shell prints things nobody asked for', () => {
    const text = [
        'welcome to the machine',
        'okc-result {"recommendation":"reject"}',
        'okc-result {"recommendation":"accept"}'
    ].join('\n');
    assert.equal(recommendationIn(text), 'accept');
});

test('a line the tail cut in half does not count, and is not guessed at', () => {
    const text = ['okc-result {"recomm', 'okc-result {"recommendation":"reject"}'].join('\n');
    assert.equal(recommendationIn(text), 'reject');
});

test('and no such line is null', () => {
    assert.equal(recommendationIn('it read the change and said nothing'), null);
    assert.equal(recommendationIn(''), null);
    assert.equal(recommendationIn(null), null);
    assert.equal(recommendationIn('okc-result {"other":"thing"}'), null);
});

//---- adoption does not run over an empty board ------------------------------

test('nothing is recovered in a workspace nobody is serving', async () => {
    //ASKING WOULD READ AN EMPTY BOARD AND "RECOVER" IT, which is adoption doing
    //the one thing it exists to prevent.
    open = false;
    tasks = [TASK()];

    const out = await adopting().adopt();
    assert.equal(out.skipped, 'no workspace');
    assert.deepEqual(wrote, []);
});

//---- work that never started ------------------------------------------------

test('a task that was being set up goes back in the queue', async () => {
    //IT SAT IN `given` WITH NO RUN, invisible to everything: the queue only
    //looks at `queued`, and the board showed it working with no worker anywhere.
    tasks = [TASK({ machine: 'kit-1' })];

    const out = await adopting().adopt();

    assert.deepEqual(out.requeued, ['#7']);
    const w = wrote.filter((x) => x.what === 'taskUpdate')[0];
    assert.deepEqual(w.args.task, { state: 'queued', machine: null });
    assert.ok(said.some((m) => /#7 was being set up when this stopped.*If kit-1 still has it, it will say so when it dials in/.test(m)),
        said.join(' | '));
});

test('and a judgement that was, which adoption never learned about', async () => {
    //THE DOOR LEFT OPEN WHEN THE SECOND KIND OF WORK WAS ADDED. A restart during
    //the twenty seconds between "the workspace is set up" and "the run has
    //started" left it invisible to both passes.
    judgements = [J({ machine: 'kit-1' })];

    const out = await adopting().adopt();

    assert.deepEqual(out.requeued, ['J36']);
    const w = wrote.filter((x) => x.what === 'judging.update')[0];
    assert.deepEqual(w.args.patch, { state: 'queued', machine: null });
    assert.ok(said.some((m) => /J36 was being set up.*kit-1 was rolled back with nothing on it/.test(m)),
        said.join(' | '));
});

test('a person\'s work is left exactly where it is', async () => {
    //THERE IS NO RUN BECAUSE THERE IS NO WORKER PROCESS. Re-queueing one hands
    //their branch to a second machine while they are still in the first.
    tasks = [TASK({ worker: 'person', machine: 'kit-1' })];
    judgements = [J({ by: 'person', machine: 'kit-1' })];

    const out = await adopting().adopt();

    assert.deepEqual(out.requeued, []);
    assert.deepEqual(wrote, []);
});

test('and a re-queue that could not be written does not stop the rest', async () => {
    tasks = [TASK({ machine: 'kit-1' }), TASK({ id: 't2', number: 8, uid: 'u8' })];
    let first = true;
    const a = adopting({
        call: async (what, args) => {
            wrote.push({ what, args });
            if (first) { first = false; throw new Error('the store is gone'); }
            return {};
        }
    });

    const out = await a.adopt();
    assert.deepEqual(out.requeued, ['#7', '#8']);
    assert.equal(wrote.filter((w) => w.what === 'taskUpdate').length, 2);
});

//---- work that WAS running ---------------------------------------------------

test('a task in flight is waited on, filed, and its machine put away', async () => {
    tasks = [TASK({ machine: 'kit-1', run: 'run-1' })];

    const out = await adopting().adopt();
    await settle();

    assert.deepEqual(out.picked, ['#7']);
    assert.deepEqual(claimed, [{ m: 'kit-1', ref: '#7' }]);
    assert.deepEqual(awaited, [{ m: 'kit-1', run: 'run-1' }]);
    assert.equal(wrote.filter((w) => w.what === 'taskUpdate')[0].args.task.state, 'done');
    assert.deepEqual(put, ['kit-1']);
    assert.deepEqual(released, ['kit-1']);
});

test('and it is not re-queued, because it started', async () => {
    tasks = [TASK({ machine: 'kit-1', run: 'run-1' })];
    const out = await adopting().adopt();
    assert.deepEqual(out.requeued, []);
});

test('a machine that is not answering is not waited on, but is still put away', async () => {
    //THE RUN CANNOT BE ASKED ABOUT. What must still happen is the machine coming
    //back — otherwise it is out of the pool with nobody watching it.
    machines = [{ name: 'kit-1', connected: false }];
    tasks = [TASK({ machine: 'kit-1', run: 'run-1' })];

    await adopting().adopt();
    await settle();

    assert.deepEqual(awaited, []);
    assert.deepEqual(put, ['kit-1']);
    assert.deepEqual(released, ['kit-1']);
});

test('a task that throws while being picked up still gives its machine back', async () => {
    tasks = [TASK({ machine: 'kit-1', run: 'run-1' })];
    const a = adopting({
        call: async (what) => {
            if (what === 'taskArtifact') throw new Error('the artifact store is gone');
            return {};
        }
    });

    await a.adopt();
    await settle();

    assert.deepEqual(put, ['kit-1'], 'a machine was left up because adopting it threw');
    assert.deepEqual(released, ['kit-1']);
    assert.ok(said.some((m) => /BAD the artifact store is gone/.test(m)), said.join(' | '));
});

test('a machine the queue already holds is left to the queue', async () => {
    tasks = [TASK({ machine: 'kit-1', run: 'run-1' })];
    const out = await adopting({ held: () => true }).adopt();

    assert.deepEqual(out.picked, []);
    assert.deepEqual(claimed, []);
});

//---- and a judgement that was already running ---------------------------------

test('a reading that finished while nothing was watching is filed, not lost', async () => {
    //IT RAN, READ THE CHANGE, RECOMMENDED ACCEPT and handed back a report — all
    //of which arrived here — and then sat in `given` for twenty minutes.
    judgements = [J({ machine: 'kit-1', run: 'run-1', attempts: [{ run: 'run-1', machine: 'kit-1' }] })];

    const out = await adopting().adopt();
    await settle();

    assert.deepEqual(out.picked, ['J36']);
    const w = wrote.filter((x) => x.what === 'judging.update')[0];
    assert.equal(w.args.patch.state, 'done');
    assert.equal(w.args.patch.concluded, 'accept');
    assert.equal(w.args.patch.read, '2026-08-22T13:00:00Z');
    assert.ok(said.some((m) => /GOOD J36 done — it finished while this app was not watching, and it recommends: accept/.test(m)),
        said.join(' | '));
});

test('and its machine comes back, which is what the dead finally could not do', async () => {
    //IT STAYED UP HOLDING A JUDGE'S CREDENTIAL, OUT OF THE POOL.
    judgements = [J({ machine: 'kit-1', run: 'run-1' })];

    await adopting().adopt();
    await settle();

    assert.deepEqual(put, ['kit-1']);
    assert.deepEqual(released, ['kit-1']);
});

test('the log is kept, which this path threw away', async () => {
    //A JUDGEMENT ADOPTED AFTER A RESTART came out with its findings and no
    //account of the run that produced them — and the log reader explained the
    //absence as "read before this app started keeping their logs". For one made
    //four minutes earlier.
    judgements = [J({ machine: 'kit-1', run: 'run-1' })];

    await adopting().adopt();
    await settle();

    assert.equal(archived.length, 1);
    assert.equal(archived[0].uid, 'u36');
    assert.equal(archived[0].run, 'run-1');
    assert.equal(archived[0].what.exit, 0);
    assert.equal(archived[0].what.state, 'finished');
    assert.ok(said.some((m) => /kept the log of run-1.*picked up after a restart/.test(m)), said.join(' | '));
});

test('and one already kept is not written twice', async () => {
    judgements = [J({ machine: 'kit-1', run: 'run-1' })];
    await adopting({ kept: () => true }).adopt();
    await settle();
    assert.deepEqual(archived, []);
});

test('how the run ended is marked on the attempt, which an adopted run left blank', async () => {
    //THE ATTEMPT IS WHERE "IT CRASHED" AND "IT FINISHED AND SAID NOTHING" are
    //told apart, and the machine is rolled back a moment later.
    judgements = [J({
        machine: 'kit-1', run: 'run-1',
        attempts: [{ run: 'run-0' }, { run: 'run-1', machine: 'kit-1' }]
    })];

    await adopting({
        running: { waitForRun: async () => ({ state: 'finished', exit: 1 }) }
    }).adopt();
    await settle();

    const marked = wrote.filter((x) => x.what === 'judging.update')[0].args.patch.attempts;
    assert.equal(marked[0].run, 'run-0');
    assert.equal(marked[0].adopted, undefined, 'it marked an attempt that was not this run');
    assert.equal(marked[1].exit, 1);
    assert.equal(marked[1].outcome, 'finished');
    assert.equal(marked[1].adopted, true);
});

test('a reading whose machine is gone is still recorded, with what was already known', async () => {
    machines = [];
    judgements = [J({ machine: 'kit-1', run: 'run-1', concluded: 'reject' })];

    await adopting().adopt();
    await settle();

    const w = wrote.filter((x) => x.what === 'judging.update')[0];
    assert.equal(w.args.patch.state, 'done');
    assert.equal(w.args.patch.concluded, 'reject', 'a conclusion already recorded was overwritten with nothing');
    assert.deepEqual(put, ['kit-1']);
});

test('a reading somebody is doing themselves is not picked up', async () => {
    judgements = [J({ by: 'person', machine: 'kit-1', run: 'run-1' })];
    const out = await adopting().adopt();
    assert.deepEqual(out.picked, []);
    assert.deepEqual(claimed, []);
});

test('output that cannot be read loses neither the reading nor the machine', async () => {
    judgements = [J({ machine: 'kit-1', run: 'run-1' })];
    const a = adopting({
        call: async (what, args) => {
            wrote.push({ what, args });
            if (what === 'vmRunOutput') throw new Error('the channel is down');
            return {};
        }
    });

    await a.adopt();
    await settle();

    assert.equal(wrote.filter((x) => x.what === 'judging.update')[0].args.patch.state, 'done');
    assert.deepEqual(put, ['kit-1']);
});

//---- and both kinds at once ---------------------------------------------------

test('all four situations in one pass, and each one gets its own answer', async () => {
    tasks = [
        TASK({ id: 'a', number: 1, uid: 'ua', machine: 'kit-1' }),                    //never started
        TASK({ id: 'b', number: 2, uid: 'ub', machine: 'kit-2', run: 'run-b' })       //was running
    ];
    judgements = [
        J({ id: 'c', number: 3, uid: 'uc', machine: 'kit-3' }),                       //never started
        J({ id: 'd', number: 4, uid: 'ud', machine: 'kit-4', run: 'run-d' })          //was running
    ];
    machines = ['kit-1', 'kit-2', 'kit-3', 'kit-4'].map((name) => ({ name, connected: true }));

    const out = await adopting().adopt();
    await settle();

    assert.deepEqual(out.requeued, ['#1', 'J3']);
    assert.deepEqual(out.picked, ['#2', 'J4']);
    //ONLY THE TWO THAT WERE RUNNING HAVE MACHINES TO GIVE BACK.
    assert.deepEqual(put.sort(), ['kit-2', 'kit-4']);
});
