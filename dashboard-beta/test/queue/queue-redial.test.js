const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makeRedial = require('../../src/app/queue/redial');
const { noteIn } = require('../../src/app/queue/redial');

//---------------------------------------------------------------------------
//A MACHINE DIALS IN AND SAYS WHAT IT IS STILL DOING.
//
//THE CLAIM WORTH THE MOST: the note is CHECKED, not believed. It comes from a
//guest, so it is a claim — and every check below is one thing a lying guest must
//not be able to do. It may not take work from another machine, may not revive a
//task somebody finished, and may not invent one. The worst it can achieve is
//being given a task that was going to be given to a machine anyway.
//
//AND THE SECOND: the LAST line. A guest shell prints things nobody asked for —
//a profile that greets you, a warning from something in the path — and all of it
//arrives here as output. Taking the whole reply would read a chatty machine as a
//corrupt note.
//---------------------------------------------------------------------------

let said, wrote, replied, task, vm, busy;

const NOTE = (over) => JSON.stringify(Object.assign({ uid: 'u7', number: 7, branch: 'a-branch' }, over || {}));
const TASK = (over) => Object.assign({ id: 't1', number: 7, uid: 'u7', branch: 'a-branch', state: 'queued' }, over || {});

beforeEach(() => {
    said = [];
    wrote = [];
    task = TASK();
    vm = { name: 'kit-1', branch: 'a-branch' };
    busy = { machines: [], work: [] };
    replied = NOTE();
});

function redial(over) {
    return makeRedial(Object.assign({
        call: async (what, args) => { wrote.push({ what, args }); return {}; },
        say: () => ({
            info: (m) => said.push(m), warn: (m) => said.push('WARN ' + m),
            bad: (m) => said.push('BAD ' + m), good: (m) => said.push('GOOD ' + m)
        }),
        ask: async () => ({ output: replied }),
        taskByUid: (uid) => (task && task.uid === uid ? task : null),
        machineNamed: () => vm,
        busyWith: () => busy
    }, over || {}));
}

//---- what the machine actually said ----------------------------------------

test('the last line is the note, whatever the shell said first', () => {
    const chatty = ['Welcome to Ubuntu 24.04', 'bash: something not found', NOTE()].join('\n');
    assert.deepEqual(noteIn(chatty).note.uid, 'u7');
});

test('nothing at all is nothing, not an error', () => {
    assert.equal(noteIn('').empty, true);
    assert.equal(noteIn(null).empty, true);
    assert.equal(noteIn('   \n  ').empty, true);
});

test('a note with no uid is nothing, because uid is what it is answered by', () => {
    assert.equal(noteIn(JSON.stringify({ number: 7, branch: 'a' })).empty, true);
});

test('and something unreadable is said, not swallowed', () => {
    //A MACHINE ANSWERING THIS WITH SOMETHING UNREADABLE has a note written by a
    //version of this that no longer agrees with this one.
    assert.equal(noteIn('{not json').unreadable, true);
});

//---- what a good note does --------------------------------------------------

test('a machine still holding a queued task is put back on it', async () => {
    //THE OTHER HALF OF RE-QUEUEING. What must not happen is a machine standing
    //there set up on a branch, holding work nobody is claiming, while the queue
    //offers the same work to a second machine.
    const out = await redial().dialledIn('kit-1');

    assert.equal(out.id, 't1');
    const w = wrote.filter((x) => x.what === 'taskUpdate')[0];
    assert.equal(w.args.task.state, 'given');
    assert.equal(w.args.task.machine, 'kit-1');
    assert.ok(said.some((m) => /GOOD it dialled back in still holding #7 on a-branch — put back on it/.test(m)),
        said.join(' | '));
});

test('and it is marked a person\'s, so recovery does not take it straight back off', async () => {
    //THE QUEUE'S OWN RECOVERY re-queues tasks that were being set up and never
    //started. A machine that just said it has one is exactly that shape.
    await redial().dialledIn('kit-1');
    assert.equal(wrote.filter((x) => x.what === 'taskUpdate')[0].args.task.worker, 'person');
});

test('but a task with a job keeps whoever it was for', async () => {
    //A JOB IS SOMETHING TO RUN, so this is not a machine somebody is sitting in.
    task = TASK({ job: 'a-job', worker: 'a-worker' });
    await redial().dialledIn('kit-1');
    assert.equal(wrote.filter((x) => x.what === 'taskUpdate')[0].args.task.worker, 'a-worker');
});

//---- and everything a lying guest must not be able to do ---------------------

test('it cannot invent a task', async () => {
    task = null;
    replied = NOTE({ uid: 'made-up' });

    assert.equal(await redial().dialledIn('kit-1'), null);
    assert.deepEqual(wrote, []);
    assert.ok(said.some((m) => /there is no such task here any more — left alone/.test(m)), said.join(' | '));
});

test('it cannot claim a task by a number that was reissued', async () => {
    //NAMED BY UID AND ANSWERED BY UID. A note carries the number only so this
    //can be said out loud — looking one up by NUMBER would follow a number
    //reissued after the task holding it was deleted.
    task = TASK({ uid: 'a-different-one' });
    assert.equal(await redial().dialledIn('kit-1'), null);
    assert.deepEqual(wrote, []);
});

test('and a lookup that answers with the wrong task is not believed either', async () => {
    //THE GUARD BEHIND THE GUARD. Asking by uid should only ever be able to
    //answer with that uid — so this is unreachable through a store that keys on
    //one, and reachable the moment something resolves loosely. A sweep called it
    //untested because the fixture could not get there; a lookup that answers
    //with something else is exactly what it is for.
    task = TASK({ uid: 'a-different-one' });
    const o = redial({ taskByUid: () => task });

    assert.equal(await o.dialledIn('kit-1'), null, 'it took a task the lookup answered with by mistake');
    assert.deepEqual(wrote, []);
});

test('it cannot follow a task that has been re-pointed', async () => {
    replied = NOTE({ branch: 'an-old-branch' });

    assert.equal(await redial().dialledIn('kit-1'), null);
    assert.ok(said.some((m) => /that task is about a-branch now and its note says an-old-branch — left alone/.test(m)),
        said.join(' | '));
});

test('it cannot claim work it is not actually set up for', async () => {
    //ASKED OF THIS HOST'S OWN REGISTRY rather than taken from the note, because
    //that is the half a guest cannot write.
    vm = { name: 'kit-1', branch: 'something-else' };

    assert.equal(await redial().dialledIn('kit-1'), null);
    assert.ok(said.some((m) => /it is not set up on a-branch — left alone/.test(m)), said.join(' | '));
});

test('nor when this host has no record of the machine at all', async () => {
    vm = null;
    assert.equal(await redial().dialledIn('kit-1'), null);
    assert.deepEqual(wrote, []);
});

test('it cannot revive a task somebody finished', async () => {
    task = TASK({ state: 'done' });
    assert.equal(await redial().dialledIn('kit-1'), null);
    assert.deepEqual(wrote, []);
});

test('it cannot take work away from another machine', async () => {
    task = TASK({ state: 'given', machine: 'kit-2' });

    assert.equal(await redial().dialledIn('kit-1'), null);
    assert.deepEqual(wrote, []);
    assert.ok(said.some((m) => /that has since been given to kit-2 — left alone/.test(m)), said.join(' | '));
});

test('a task already given to this same machine is simply right, and says nothing', async () => {
    //WHAT HAPPENS WHEN NOTHING RESTARTED. Not a problem and not even news.
    task = TASK({ state: 'given', machine: 'kit-1' });

    assert.equal(await redial().dialledIn('kit-1'), null);
    assert.deepEqual(wrote, []);
    assert.deepEqual(said, [], 'it said something about a machine that was simply correct');
});

//---- and what the queue is already doing ---------------------------------------

test('a machine the queue is mid-dispatch on stays the queue\'s', async () => {
    //A RACE OF SECONDS — a machine reconnecting while a tick is running — and
    //the tick is the one holding the machine.
    busy = { machines: ['kit-1'], work: [] };
    assert.equal(await redial().dialledIn('kit-1'), null);
    assert.deepEqual(wrote, []);
});

test('and a task the queue is mid-dispatch on stays the queue\'s, on whatever machine', async () => {
    busy = { machines: ['kit-9'], work: ['t1'] };
    assert.equal(await redial().dialledIn('kit-1'), null);
    assert.deepEqual(wrote, []);
});

//---- and a machine with nothing to say -----------------------------------------

test('a machine holding nothing answers nothing, and nothing happens', async () => {
    //THE NOTE GOES AWAY WHEN THE MACHINE IS ROLLED BACK, so the note exists
    //exactly as long as the setup it describes does.
    replied = '';
    assert.equal(await redial().dialledIn('kit-1'), null);
    assert.deepEqual(wrote, []);
    assert.deepEqual(said, []);
});

test('and one whose note cannot be read is left alone, loudly', async () => {
    replied = 'not a note at all {';
    assert.equal(await redial().dialledIn('kit-1'), null);
    assert.ok(said.some((m) => /WARN it answered with something that is not a task note — left alone/.test(m)),
        said.join(' | '));
});

test('it asks the machine for the file and nothing else', async () => {
    let asked = null;
    await redial({ ask: async (m, cmd, opts) => { asked = { m, cmd, opts }; return { output: replied }; } })
        .dialledIn('kit-1');

    assert.equal(asked.m, 'kit-1');
    assert.match(asked.cmd, /cat "\$HOME\/\.okc-task"/);
    //AND IT IS BOUNDED. A machine that has stopped answering must not hold this
    //open — reconnecting is what triggers it, so a hang here is a hang on every
    //machine that comes back.
    assert.ok(asked.opts.timeout > 0, 'it asked a machine a question with no bound on the answer');
});
