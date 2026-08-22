const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const actionsPlugin = require('../../src/app/core/actions/main');
const queuePlugin = require('../../src/app/queue/server');

//---------------------------------------------------------------------------
//THE WIRING ITSELF.
//
//Every rule the tick applies is tested in the file that holds it. What is
//checked HERE is the thing none of those can see: that the plugin actually
//assembles against the services it declares, and that what the clock was given
//is the tick.
//
//THE FAILURE THIS EXISTS FOR is a wiring mistake that every unit test passes
//through — a service member that is not called what this file thinks, a reader
//that is async where the caller is not. Those cost nothing until the moment a
//machine is being spent, and they are invisible to a test that hands each piece
//a stand-in shaped the way the piece wants.
//
//AND IT CANNOT DISPATCH. The tick is fired with nothing queued and no machine
//free, so it runs its guards and stops — which is the only end-to-end check
//available from a test, because starting the queue for real is a person's act
//and the gate refuses it here exactly as it refuses it on the wire.
//---------------------------------------------------------------------------

let home, said, jobs, called, machines, tasks, judgements, workspaceDir;

beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-armed-'));
    said = [];
    jobs = {};
    called = [];
    machines = [];
    tasks = [];
    judgements = [];
    workspaceDir = path.join(home, 'workspace');
});

afterEach(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch (e) { /* gone */ } });

//A DOC THAT LIVES IN MEMORY, which is what core/state hands out.
function doc() {
    let kept = null;
    return { read: (fallback) => (kept === null ? fallback : kept), write: (v) => { kept = v; return v; } };
}

async function aQueue(over) {
    let actions = null;
    await actionsPlugin({}, async (_e, s) => { actions = s.actions; });

    //THE ACTIONS THE TICK REACHES FOR THAT THIS PLUGIN DOES NOT OWN.
    //
    //`tasks` AND `taskUpdate` ARE NOT AMONG THEM, and that is worth saying: the
    //queue defines both itself, and `actions.call` tries this app's table first
    //— so a stand-in here would be shadowed and the test would be watching a
    //fixture nobody reads. It was, and it passed nothing.
    //
    //SO THE BOARD IS SEEDED WHERE THE QUEUE ACTUALLY READS IT: its own state
    //doc. Which is also the honest shape of the armed tick on a real host — it
    //ticks over THIS app's board, empty until something is written here, and
    //that is what stops a half-ported queue touching the work the other app is
    //still running.
    actions.define('vmList', { run: () => ({ vms: machines }) });

    const docs = {};
    const state = {
        here: { doc: (name) => (docs[name] = docs[name] || doc()) },
        host: { doc: (name) => (docs[name] = docs[name] || doc()) }
    };
    //SEEDED BEFORE THE PLUGIN READS IT.
    state.here.doc('tasks').write(tasks);

    const logger = ['info', 'warn', 'good', 'bad'].reduce((n, k) => {
        n[k] = (t) => said.push(k + ': ' + t);
        return n;
    }, {});

    let queue = null;
    await queuePlugin(Object.assign({
        app: { host: { actions } },
        log: { on: () => logger },
        state,
        dataDir: { at: (...p) => path.join(home, ...p) },
        secret: { redact: (t) => t },
        //THE SHAPE ../artifact ACTUALLY ANSWERS WITH. A stand-in that answered
        //null found a real hole in the board's reader — the guard around it
        //caught a throw and not an answer — which is now fixed and is not what
        //this file is for.
        artifact: { read: async () => ({ delivered: false, summary: null, commits: [], repos: [] }) },
        archive: {
            store: () => ({
                list: async () => [], read: async () => null,
                has: async () => false, keep: async () => ({})
            })
        },
        cron: {
            add: (j) => { jobs[j.name] = Object.assign({}, j, { run: null }); },
            does: (name, fn) => { jobs[name].run = fn; return () => { jobs[name].run = null; }; },
            get: (name) => jobs[name],
            start: () => true,
            stop: () => true
        },
        busy: { all: () => [], claim: () => {}, release: () => {}, what: () => null, comingUp: (n, fn) => fn() },
        guests: {
            forQueue: () => ({ worker: { free: 1, paused: [] }, judge: { free: 1, paused: [] } }),
            holderOf: () => null, pause: () => {}, all: () => [], freeFor: () => [], pausedFor: () => []
        },
        judge: {
            all: () => judgements, get: () => null, update: () => {},
            refOf: (n) => 'J' + n
        },
        ours: { update: () => {}, get: () => null, read: () => [] },
        refs: { heads: async () => ({}) },
        channel: { run: async () => ({ output: '' }) },
        workspace: { dir: async () => workspaceDir, repos: async () => [] },
        settings: { read: () => ({}) },
        repositories: { read: async () => ({ repos: [] }) }
    }, over || {}), async (_e, s) => { queue = s.queue; });

    //THE BOARD AS THE QUEUE'S OWN STORE HOLDS IT, which is what adoption writes
    //to and what a stand-in action would have hidden.
    return {
        queue, actions,
        board: () => state.here.doc('tasks').read([]),
        writeBoard: (rows) => state.here.doc('tasks').write(rows)
    };
}

//---- it assembles at all ----------------------------------------------------

test('the plugin builds against the services it declares', async () => {
    //THE CHECK THAT COSTS NOTHING AND CATCHES THE MOST. A service member that is
    //not called what this file thinks throws right here, at build, rather than
    //at the moment a machine is being spent.
    const { queue } = await aQueue();

    assert.ok(queue, 'the queue registered nothing');
    assert.equal(typeof queue.adopt, 'function');
    assert.equal(typeof queue.dialledIn, 'function');
    assert.equal(typeof queue.spent.total, 'function');
});

test('and the clock is given the tick, rather than being left unarmed', async () => {
    await aQueue();

    assert.ok(jobs.queue, 'no queue job was registered');
    assert.equal(typeof jobs.queue.run, 'function',
        'the job is registered and unarmed — the board would draw a switch that does nothing');
});

test('it comes up STOPPED, with no setting that can change it', async () => {
    //THIS IS THE PIECE THAT GIVES REAL MACHINES REAL WORK. A thing that does
    //that is started by somebody, every time, rather than found already running.
    await aQueue();

    assert.equal(jobs.queue.autoStart, undefined, 'the queue asked to start itself');
    assert.ok(jobs.queue.humanOnly, 'the queue can be started by something that is not a person');
    assert.match(jobs.queue.humanOnly, /a model may not decide that this host should begin doing that/);
});

//---- and it owns both ends of the board ---------------------------------------
//
//THE HAZARD THIS WAS ARMED AGAINST. Before `taskUpdate` was defined here, the
//tick READ this app's board and every write RELAYED to the app being ported from
//— the one actually running work on real machines. Adoption reads a stranded
//task here and re-queues it over there; a dispatch marks `given` on a board it
//did not read from.
//
//../../src/app/queue/tick refuses to dispatch while that is true, and asks the
//action table each time rather than carrying a flag — so defining the action is
//what cleared it, with nothing turned on. The refusal itself is tested in
//./queue-tick.test.js, where it can be asked about directly.

test('both ends of the board are answered by this app', async () => {
    const { actions } = await aQueue();

    assert.equal(actions.has('tasks'), true);
    assert.equal(actions.has('taskUpdate'), true,
        'the tick would read this board and write to the app being ported from');
});

test('so the tick is not held back', async () => {
    const { actions } = await aQueue();
    const out = await jobs.queue.run();

    assert.equal(out.skipped, undefined, 'it refused to dispatch on a host that owns both ends');
    assert.ok(said.every((l) => !/nothing is dispatched from this host/.test(l)), said.join(' | '));
});

//---- and the tick runs, without touching anything ----------------------------

test('a tick with nothing queued does its guards and stops', async () => {
    await aQueue();

    const out = await jobs.queue.run();

    assert.deepEqual(out.dispatched, []);
    assert.deepEqual(out.waiting, []);
});

test('and one with no workspace open does not even look', async () => {
    //"NO WORK" AND "NO WORKSPACE" ARE DIFFERENT SENTENCES, and this is where the
    //async shape of that question is actually exercised: workspace.dir() throws
    //when nothing is open, which is the right answer for a caller that needs the
    //folder and the wrong one for a caller asking whether there is one.
    await aQueue({
        workspace: { dir: async () => { throw new Error('no workspace is open'); }, repos: async () => [] }
    });

    const out = await jobs.queue.run();

    assert.equal(out.skipped, 'no workspace');
    assert.ok(said.some((l) => /no workspace is open — nothing is dispatched until one is/.test(l)),
        said.join(' | '));
});

test('adoption happens once, before the first dispatch and never again', async () => {
    //A RESTART CAN LEAVE a task in `given` with no run, and handing out new work
    //before picking those up is how one machine gets a second task on top of a
    //worker still writing. Running it every tick would re-adopt what the tick
    //had just dispatched.
    tasks = [{ id: 't1', uid: 'u7', number: 7, state: 'given', machine: 'kit-1', attempts: [] }];

    //THE PLUGIN'S OWN `taskUpdate` DOES THE WRITING, which is the point of the
    //guard above: adoption's write lands on the board it read the task from.
    const { board } = await aQueue();

    await jobs.queue.run();

    //BACK IN THE QUEUE, AND LET GO OF THE MACHINE IT NAMED.
    assert.equal(board()[0].state, 'queued', 'the stranded task was not picked up');
    assert.equal(board()[0].machine, null);
    assert.ok(said.some((l) => /#7 was being set up when this stopped/.test(l)), said.join(' | '));

    //AND NOW IT IS QUEUED, so a second adoption would find nothing anyway — the
    //claim is that adoption does not RUN again, which is what stops it
    //re-adopting work the tick has just dispatched.
    const after = said.length;
    await jobs.queue.run();
    await jobs.queue.run();

    assert.equal(said.filter((l) => /was being set up when this stopped/.test(l)).length, 1,
        'adoption ran again on a later tick');
    assert.ok(said.length >= after);
});

test('and an adoption that throws does not stop this host dispatching for ever', async () => {
    //A RESTART THAT COULD NOT BE TIDIED UP is a reason to say so, not a reason
    //to give up.
    await aQueue({
        judge: {
            all: () => { throw new Error('the judging store is gone'); },
            get: () => null, update: () => {}, refOf: (n) => 'J' + n
        }
    });

    //THE SAME THROW REACHES THE TICK A MOMENT LATER, where ../core/cron catches
    //it and records the failure on the job. What is checked here is that
    //ADOPTION's failure was caught and said, rather than taking the process with
    //it before the tick was ever reached.
    await assert.rejects(() => jobs.queue.run(), /the judging store is gone/);

    assert.ok(said.some((l) => /what the restart left could not all be picked up/.test(l)), said.join(' | '));
});

//---- and what the board reads -------------------------------------------------

test('whether this host is dispatching is the clock\'s own answer', async () => {
    //IT WAS A STANDING `false` while nothing was wired. A consumer asking "is
    //this host dispatching" has to get the real answer once there is one.
    const { queue } = await aQueue();
    assert.equal(queue.running(), false);

    jobs.queue.running = true;
    assert.equal(queue.running(), true, 'the board would say stopped while the tick was running');
});

test('what this host has spent is answerable, and starts empty', async () => {
    const { queue } = await aQueue();

    assert.deepEqual(queue.spent.all(), []);
    assert.equal(queue.spent.total().runs, 0);
    assert.match(queue.spent.where(), /meter\.json$/);
});
