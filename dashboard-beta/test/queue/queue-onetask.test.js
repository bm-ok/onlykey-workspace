const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makeOneTask = require('../../src/app/queue/onetask');

//---------------------------------------------------------------------------
//ONE TASK, ON ONE MACHINE, FROM END TO END.
//
//AN ORDER RATHER THAN A SET OF COMMANDS — almost every line delegates, and what
//is checked here is the SEQUENCE and the three endings.
//
//THE CLAIM WORTH THE MOST: the finally tells the three apart. A task that named
//no job leaves its machine RUNNING for a person, and putting it away would take
//away the thing that was just prepared. A machine that stopped answering is
//KEPT, because rolling it back destroys the only account of what went wrong.
//Everything else goes back to the pool clean. And the machine is released in all
//three, or a queue that has stopped thinking about it holds it for ever.
//---------------------------------------------------------------------------

let asked, said, task, heads, released, held, outcome, metered, arte, fails;

//A BRIEF IS NOT SOMETHING TO RUN. A task naming no job and no shell is handed
//over, which is a whole test below — so the ordinary fixture has to name one, or
//every other test here is quietly testing the handover.
const TASK = () => ({
    id: 't1', number: 7, title: 'do the thing', branch: 'a-branch',
    brief: 'please do it', shell: true, attempts: []
});

beforeEach(() => {
    asked = [];
    said = [];
    released = [];
    held = [];
    fails = {};
    task = TASK();
    heads = [{ repo: 'aaa' }, { repo: 'aaa' }];   //before, after — unchanged by default
    outcome = { state: 'finished', exit: 0 };
    metered = { row: null, failedAuthAs: null };
    arte = { delivered: true, summary: 'one file' };
});

function onetask(over) {
    let looked = 0;
    return makeOneTask(Object.assign({
        call: async (what, args) => {
            asked.push(what);
            if (fails[what]) throw new Error(fails[what]);
            if (what === 'tasks') return { tasks: [task] };
            if (what === 'taskArtifact') return arte;
            if (what === 'jobRun' || what === 'vmDispatch') return { run: 'run-1' };
            if (what === 'taskUpdate') { Object.assign(task, args.task); return {}; }
            return {};
        },
        starting: { bringUp: async () => { asked.push('bringUp'); } },
        running: { waitForRun: async () => { asked.push('waitForRun'); return outcome; } },
        metering: { meterRun: async () => { asked.push('meterRun'); return metered; } },
        putting: {
            putAway: async (m) => { asked.push('putAway:' + m); },
            keepForLooking: async (m, why) => { asked.push('keepForLooking:' + m); said.push('kept: ' + why); }
        },
        hold: (m, borrowed) => held.push({ m, borrowed }),
        release: (m) => released.push(m),
        headsOn: async () => heads[Math.min(looked++, heads.length - 1)],
        papersFor: async () => [],
        wakes: () => false,
        noteFor: () => 'a note',
        now: () => 1000,
        stamp: () => '2026-08-22T13:00:00Z',
        say: () => {
            const to = {
                info: (m) => said.push(m), warn: (m) => said.push('WARN ' + m),
                bad: (m) => said.push('BAD ' + m), good: (m) => said.push('GOOD ' + m)
            };
            return to;
        }
    }, over || {}));
}

const at = (w) => { const i = asked.indexOf(w); assert.ok(i >= 0, w + ' never happened: ' + asked.join(' | ')); return i; };

//---- the order ------------------------------------------------------------------

test('up, credentialed, workspaced, and only then given work', async () => {
    await onetask().run(task, 'kit-1');

    assert.ok(at('bringUp') < at('vmCredentialsPut'));
    assert.ok(at('vmCredentialsPut') < at('vmWorkspace'));
    assert.ok(at('vmWorkspace') < at('vmDispatch'));
    assert.ok(at('vmDispatch') < at('waitForRun'));
});

test('what it cost is read before the machine is put away', async () => {
    //THE TRANSCRIPT LIVES ON THE MACHINE and the rollback takes it, so this is
    //the only window in which the numbers exist.
    await onetask().run(task, 'kit-1');
    assert.ok(at('meterRun') < at('putAway:kit-1'));
});

test('the branch is read before the work and after it', async () => {
    //THE ONLY WAY TO SAY "and nothing new arrived" — which is the difference
    //between a run that worked and one that reported success and pushed nothing.
    heads = [{ repo: 'aaa' }, { repo: 'bbb' }];
    await onetask().run(task, 'kit-1');
    assert.ok(said.some((m) => /GOOD #7 done — finished \(exit 0\)/.test(m)), said.join(' | '));
});

test('a run that pushed nothing is said as such, and names where the branch stands', async () => {
    heads = [{ repo: 'aaa' }, { repo: 'aaa' }];
    await onetask().run(task, 'kit-1');

    assert.ok(said.some((m) => /WARN.*nothing new arrived: a-branch is unchanged \(repo aaa\)/.test(m)),
        said.join(' | '));
});

//---- the three endings ------------------------------------------------------------

test('a task with nothing to run leaves the machine up, for a person', async () => {
    delete task.brief;
    task.job = null;
    task.shell = false;

    await onetask().run(task, 'kit-1');

    //PUTTING IT AWAY WOULD TAKE AWAY THE THING THAT WAS JUST PREPARED.
    assert.equal(asked.includes('putAway:kit-1'), false, 'it put away a machine it had just set up');
    assert.equal(asked.includes('keepForLooking:kit-1'), false);
    assert.equal(asked.includes('vmDispatch'), false, 'it ran something on a task that names no job');

    //BORROWED, WHICH IS NOT A EUPHEMISM: the rest of the app already reads that
    //as "this one is somebody's, do not queue it".
    assert.equal(held.length, 1);
    assert.match(held[0].borrowed.why, /#7 — set up and waiting for you/);
    assert.ok(said.some((m) => /vmReturn --name kit-1/.test(m)), said.join(' | '));
});

test('a machine that stopped answering is kept, not rolled back', async () => {
    outcome = { state: 'unreachable' };
    await onetask().run(task, 'kit-1');

    //ROLLING IT BACK DESTROYS THE ONLY ACCOUNT OF WHAT WENT WRONG.
    assert.ok(asked.includes('keepForLooking:kit-1'), asked.join(' | '));
    assert.equal(asked.includes('putAway:kit-1'), false, 'it rolled back the evidence');
    assert.ok(said.some((m) => /kept: run-1 was still going when this host lost sight of kit-1/.test(m)));
});

test('anything else goes back to the pool clean', async () => {
    await onetask().run(task, 'kit-1');
    assert.ok(asked.includes('putAway:kit-1'));
});

test('the machine is released in all three endings, and when it throws', async () => {
    //A MACHINE HELD BY A QUEUE THAT HAS STOPPED THINKING ABOUT IT is a machine
    //nothing will ever touch again.
    await onetask().run(task, 'kit-1');
    assert.deepEqual(released, ['kit-1']);

    released.length = 0;
    outcome = { state: 'unreachable' };
    await onetask().run(TASK(), 'kit-1');
    assert.deepEqual(released, ['kit-1']);

    released.length = 0;
    fails = { vmWorkspace: 'the guest never answered' };
    await assert.rejects(() => onetask().run(TASK(), 'kit-1'), /the guest never answered/);
    assert.deepEqual(released, ['kit-1'], 'a task that threw held its machine for ever');
    assert.ok(asked.includes('putAway:kit-1'), 'a task that threw left its machine up');
});

//---- a sign-in that could not authenticate ------------------------------------------

test('the task goes back in the queue, because it never ran', async () => {
    metered = { row: null, failedAuthAs: 'a-worker' };
    task.attempts = [{ run: 'run-0', machine: 'kit-1' }];

    await onetask().run(task, 'kit-1');

    assert.equal(task.state, 'queued');
    assert.equal(task.machine, null);
    assert.equal(task.run, null);
    assert.ok(said.some((m) => /WARN #7 is back in the queue — it was never run/.test(m)), said.join(' | '));

    //AND IT IS NOT MARKED DONE.
    assert.equal(asked.includes('taskArtifact'), false, 'it finished a task that never ran');
});

test('but only once, or it spends a machine every time round', async () => {
    metered = { row: null, failedAuthAs: 'a-worker' };
    task.attempts = [{ run: 'run-0', machine: 'kit-1', authFailed: 'someone-else' }];

    await onetask().run(task, 'kit-1');

    assert.notEqual(task.state, 'queued', 'it re-queued a task that had already failed to authenticate once');
    assert.ok(said.some((m) => /BAD.*could not authenticate a second time/.test(m)), said.join(' | '));
    assert.ok(said.some((m) => /replace one on the Runners tab/.test(m)));
});

test('and the attempt is marked with which sign-in failed', async () => {
    metered = { row: null, failedAuthAs: 'a-worker' };
    task.attempts = [{ run: 'run-0', machine: 'kit-1' }];

    await onetask().run(task, 'kit-1');
    assert.equal(task.attempts[task.attempts.length - 1].authFailed, 'a-worker');
});

//---- and the things that must never be fatal -------------------------------------------

test('a judgement report that could not be delivered does not stop the work', async () => {
    task.becauseOfId = 'j1';
    const o = onetask({ papersFor: async () => { throw new Error('the channel is down'); } });

    await o.run(task, 'kit-1');

    assert.ok(said.some((m) => /WARN could not put the judge's report on kit-1/.test(m)), said.join(' | '));
    assert.ok(asked.includes('vmDispatch'), 'it refused to do the work over an undelivered report');
});

test('a judgement that handed nothing back is said, and the work goes on', async () => {
    task.becauseOfId = 'j1';
    await onetask().run(task, 'kit-1');

    assert.ok(said.some((m) => /handed nothing back, so #7 has only its brief to go on/.test(m)), said.join(' | '));
    assert.ok(asked.includes('vmDispatch'));
});

test('a progress log that could not be written does not lose the verdict', async () => {
    //THE LOG IS BEST EFFORT; THE VERDICT IS NOT.
    fails = { taskProgress: 'the machine went away' };
    await onetask().run(task, 'kit-1');

    assert.ok(asked.includes('taskArtifact'), 'it gave up before recording the outcome');
    assert.equal(task.state, 'done');
});

test('a supervisor that will not wake does not fail the task', async () => {
    const o = onetask({
        wakes: () => true,
        call: async (what, args) => {
            asked.push(what);
            if (what === 'supervisorWake') throw new Error('it is not up');
            if (what === 'tasks') return { tasks: [task] };
            if (what === 'taskArtifact') return arte;
            if (what === 'vmDispatch') return { run: 'run-1' };
            if (what === 'taskUpdate') { Object.assign(task, args.task); return {}; }
            return {};
        }
    });

    await o.run(task, 'kit-1');
    assert.equal(task.state, 'done');
});

test('and it is not woken at all unless the setting says so', async () => {
    await onetask().run(task, 'kit-1');
    assert.equal(asked.includes('supervisorWake'), false);
});

//---- where the time went ----------------------------------------------------------------

test('each phase is timed, and recorded against the attempt', async () => {
    //FORTY MINUTES IS A FACT; forty minutes of which thirty-five were bringing a
    //machine up is a different fact, and it is the one that leads anywhere.
    let t = 0;
    const o = onetask({ now: () => (t += 1000) });

    await o.run(task, 'kit-1');

    const last = task.attempts[task.attempts.length - 1];
    assert.ok(last.spent, 'nothing was recorded about where the time went');
    for (const phase of ['bringUp', 'credential', 'workspace', 'work']) {
        assert.ok(last.spent[phase] != null, phase + ' was not timed');
    }
    assert.ok(last.spent.total > 0);
    assert.ok(said.some((m) => /#7 took .* bringUp .*, credential .*, workspace .*, work /.test(m)), said.join(' | '));
});
