const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const statePlugin = require('../src/app/core/state/main');
const makeStore = require('../src/app/queue/store');
const makeArchive = require('../src/app/queue/archive');
const makeAttempts = require('../src/app/queue/attempts');

//---------------------------------------------------------------------------
//every attempt at a work item, and how one ends.
//
//THE CLAIM THIS FILE IS FOR: a run's account of itself survives the machine that
//produced it.
//
//The machine is the disposable half of this tool — rolled back, deleted,
//rebuilt, each a normal and correct thing to do, each taking the only record of
//what happened with it. Two rollbacks in one afternoon erased two runs whose
//results had already been reported, leaving a task saying work was done and
//nothing saying how.
//
//AND THE SECOND CLAIM: an attempt with no run never had one, which is not the
//same as its run being gone. Both a hand-over and a failed setup have no run id,
//and both were reported as "the machine no longer has it" — the first while the
//machine was sitting there waiting with the work on it, next to a button
//offering to open it.
//---------------------------------------------------------------------------

let store;
let archive;
let attempts;
let asked;
let logs;
let holder;

function ask(over) {
    return Object.assign({
        connected: async () => true,
        runs: async () => [],
        runOutput: async () => ({ output: 'what the run printed' }),
        sessions: async () => ({ sessions: [] }),
        sessionTail: async () => ({ entries: [] }),
        returnMachine: async (name) => ({ name, note: 'runner-1 is back on its base snapshot.' })
    }, over || {});
}

async function setUp(over) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-att-'));
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-att-ws-'));
    holder = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-att-logs-'));

    let state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dataDir, ...p) } }, async (_e, s) => { state = s.state; });
    state.follow(async () => work);

    store = makeStore({
        tasks: () => state.here.doc('tasks'),
        counter: () => state.here.doc('tasks-highest')
    }, null);

    //REDACTED ON THE WAY IN, and the stand-in here is deliberately crude so the
    //test can prove the boundary is USED rather than proving the real rules.
    archive = makeArchive(() => holder, (t) => String(t).replace(/sk-ant-[A-Za-z0-9-]+/g, '[a credential]'));

    logs = [];
    asked = ask(over);
    attempts = makeAttempts(store, archive, asked, {
        good: (t) => logs.push(t), warn: (t) => logs.push(t), bad: (t) => logs.push(t), info: (t) => logs.push(t)
    });
}

beforeEach(() => setUp());
after(() => { try { fs.rmSync(holder, { recursive: true, force: true }); } catch { /* windows */ } });

async function aTaskOn(machine, extra) {
    const made = await store.add({ title: 'the work', brief: 'do it', branch: 'fix/it' });
    return await store.update(made.id, Object.assign({ state: 'given', machine }, extra || {}));
}

//---------------------------------------------------------------------------
//A RUN'S ACCOUNT SURVIVES ITS MACHINE.
//---------------------------------------------------------------------------

test('a finished run is pulled across the moment somebody looks', async () => {
    const task = await aTaskOn('runner-1', { attempts: [{ run: 'r1', machine: 'runner-1' }] });
    await setUpRuns([{ id: 'r1', state: 'ended', exit: 0 }]);

    const said = await attempts.progress(task.id);

    assert.equal(said.attempts[0].kept, true);
    //HERE RATHER THAN ON A TIMER: this is the moment somebody is looking, and a
    //run nobody has looked at since it ended is exactly the one whose machine
    //has not been touched yet.
    assert.equal(archive.read(task.uid, 'r1').text, 'what the run printed');
    assert.ok(logs.some((l) => /kept the log of r1/.test(l)));
});

test('the archive itself refuses to rewrite a kept run', async () => {
    //ASKED OF THE ARCHIVE DIRECTLY, and it has to be. The test below goes
    //through `progress`, which skips a run it can see is already kept — so it
    //passes with the archive's own guard removed, proving the caller's rule
    //twice and the archive's not at all. A finished run does not change, and
    //re-pulling it would mean the kept copy silently follows whatever the
    //machine says today, including saying nothing after a rollback.
    const first = archive.keep('a-task', 'r1', { output: 'what happened', machine: 'runner-1' });
    assert.equal(first.kept, true);

    const again = archive.keep('a-task', 'r1', { output: 'the machine has been rolled back', machine: 'runner-1' });
    assert.equal(again.kept, false);
    assert.equal(again.why, 'already kept');
    assert.equal(archive.read('a-task', 'r1').text, 'what happened');
});

test('it is kept once and never rewritten', async () => {
    const task = await aTaskOn('runner-1', { attempts: [{ run: 'r1', machine: 'runner-1' }] });
    await setUpRuns([{ id: 'r1', state: 'ended', exit: 0 }]);

    await attempts.progress(task.id);
    //The machine now says something different — after a rollback it would say
    //nothing at all. The FIRST copy taken is the record.
    asked.runOutput = async () => ({ output: 'the machine has been rolled back' });
    await attempts.progress(task.id);

    assert.equal(archive.read(task.uid, 'r1').text, 'what the run printed');
});

test('a credential in a run\'s output is redacted on the way in', async () => {
    //This is the boundary the credential rules name: output crossing from a
    //machine is KEPT here, permanently, so a token that reached a worker's
    //output is not a moment of exposure but a filing.
    await setUp({ runOutput: async () => ({ output: 'signing in with sk-ant-abc123DEF and away we go' }) });
    const task = await aTaskOn('runner-1', { attempts: [{ run: 'r1', machine: 'runner-1' }] });
    asked.runs = async () => [{ id: 'r1', state: 'ended', exit: 0 }];

    await attempts.progress(task.id);

    const kept = archive.read(task.uid, 'r1').text;
    assert.match(kept, /\[a credential\]/);
    assert.doesNotMatch(kept, /sk-ant-abc123DEF/);
});

test('a running attempt is not archived, because it is not finished', async () => {
    const task = await aTaskOn('runner-1', { attempts: [{ run: 'r1', machine: 'runner-1' }] });
    await setUpRuns([{ id: 'r1', state: 'running' }]);

    const said = await attempts.progress(task.id);
    assert.equal(said.attempts[0].state, 'running');
    assert.equal(archive.has(task.uid, 'r1'), false);
});

//---------------------------------------------------------------------------
//AN ATTEMPT WITH NO RUN NEVER HAD ONE.
//---------------------------------------------------------------------------

test('a hand-over is waiting on its machine, not gone from it', async () => {
    //The machine emphatically DOES still have it — it is sitting there waiting,
    //which the panel said the opposite of, next to a button offering to open it.
    const task = await aTaskOn('runner-1', { attempts: [{ machine: 'runner-1', setUp: true }] });
    await setUpRuns([]);

    const said = await attempts.progress(task.id);
    assert.equal(said.attempts[0].state, 'setUp');
    assert.notEqual(said.attempts[0].state, 'gone');
});

test('a failed setup keeps its own reason rather than being told the machine lost it', async () => {
    const task = await aTaskOn('runner-1', {
        attempts: [{ machine: 'runner-1', failed: true, why: 'no sign-in was free' }]
    });
    await setUpRuns([]);

    const said = await attempts.progress(task.id);
    assert.equal(said.attempts[0].state, 'lost');
    assert.equal(said.attempts[0].why, 'no sign-in was free', 'the real explanation is not replaced by a wrong one');
});

test('an attempt that never ran is not asked for the output of undefined', async () => {
    //This asked the machine for the output of `undefined` and warned that it
    //could not keep it — three times a draw, for ever, about a log that never
    //existed.
    let askedFor = [];
    await setUp({ runOutput: async (m, run) => { askedFor.push(run); return { output: '' }; } });
    const task = await aTaskOn('runner-1', { attempts: [{ machine: 'runner-1', setUp: true }] });
    asked.runs = async () => [];

    await attempts.progress(task.id);

    assert.deepEqual(askedFor, []);
    assert.deepEqual(logs.filter((l) => /could not keep/.test(l)), []);
});

test('a run the machine does not know about is gone, and is not archived from nothing', async () => {
    const task = await aTaskOn('runner-1', { attempts: [{ run: 'r-old', machine: 'runner-1' }] });
    await setUpRuns([]);

    const said = await attempts.progress(task.id);
    assert.equal(said.attempts[0].state, 'gone');
    assert.equal(archive.has(task.uid, 'r-old'), false);
});

//---------------------------------------------------------------------------
//AND A MACHINE THAT IS GONE IS THE NORMAL END.
//---------------------------------------------------------------------------

test('with the machine off, the attempts still report their state and their kept logs', async () => {
    const task = await aTaskOn('runner-1', { attempts: [{ run: 'r1', machine: 'runner-1' }] });
    archive.keep(task.uid, 'r1', { output: 'from earlier', machine: 'runner-1', state: 'ended', exit: 0 });

    await setUp();
    const again = await aTaskOn('runner-1', { attempts: [{ run: 'r1', machine: 'runner-1' }] });
    archive.keep(again.uid, 'r1', { output: 'from earlier', machine: 'runner-1', state: 'ended', exit: 0 });
    asked.connected = async () => false;

    const said = await attempts.progress(again.id);

    //The machine being gone is exactly when the kept copy matters, so that is
    //the worst moment to stop reporting it.
    assert.equal(said.attempts[0].state, 'ended');
    assert.equal(said.attempts[0].kept, true);
    assert.match(said.why, /the queue puts a machine away when its work ends/);
});

test('a work item never given out says so, rather than naming a machine', async () => {
    const made = await store.add({ title: 't', brief: 'b', branch: 'x' });
    const said = await attempts.progress(made.id);

    assert.deepEqual(said.attempts, []);
    assert.match(said.why, /it has not been given out yet/);
});

test('a transcript is only pulled while something is running', async () => {
    let pulled = 0;
    await setUp({
        sessions: async () => { pulled += 1; return { sessions: [{ id: 's1', title: 'the work', idle: 2 }] }; },
        sessionTail: async () => ({ entries: [{ text: 'thinking' }] })
    });

    const task = await aTaskOn('runner-1', { attempts: [{ run: 'r1', machine: 'runner-1' }] });

    asked.runs = async () => [{ id: 'r1', state: 'ended', exit: 0 }];
    await attempts.progress(task.id);
    //Doing it for a finished work item every time somebody clicks a card is
    //paying for an answer that cannot change.
    assert.equal(pulled, 0);

    asked.runs = async () => [{ id: 'r1', state: 'running' }];
    const said = await attempts.progress(task.id);
    assert.equal(pulled, 1);
    assert.equal(said.live.session, 's1');
});

//---------------------------------------------------------------------------
//AND HOW ONE ENDS BY HAND.
//---------------------------------------------------------------------------

test('finishing by hand gives the machine back through the same door as everything else', async () => {
    const task = await aTaskOn('runner-1');
    const said = await attempts.finished(task.id);

    //The same refusal applies: anything uncommitted stops this, because putting
    //a machine away ROLLS IT BACK.
    assert.equal(said.machine, 'runner-1');
    assert.equal((await store.get(task.id)).state, 'done');
    //`done` means the run ended — not that it worked, and not that anybody has
    //looked at it.
    assert.match(said.note, /waiting to be judged/);
    assert.match(said.note, /whatever reached "fix\/it"/);
});

test('a refusal from the machine stops the work item being marked done', async () => {
    await setUp({
        returnMachine: async () => { throw new Error('there are uncommitted changes in /workspace'); }
    });
    const task = await aTaskOn('runner-1');

    await assert.rejects(() => attempts.finished(task.id), /uncommitted changes/);
    assert.equal((await store.get(task.id)).state, 'given', 'and it is still on its machine');
});

test('finishing something that is not on a machine is refused', async () => {
    const made = await store.add({ title: 't', brief: 'b', branch: 'x' });
    await assert.rejects(() => attempts.finished(made.id), /is not on a machine/);
});

//helper: rebuild `asked.runs` after setUp
async function setUpRuns(runs) { asked.runs = async () => runs; }
