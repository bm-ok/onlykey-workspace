const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makeJobs = require('../../src/app/vms/channel/jobs');

//---------------------------------------------------------------------------
//running something on a dialled-in machine, and waiting for it.
//
//THE CLAIM WORTH THE MOST: `quiet` withholds output from the LOG and never from
//the CALLER. There is one reason to want it — reading a credential back off a
//machine — and the log is drawn in the window, photographed by `capture`, and
//handed to anyone at the command line by `logSince`.
//
//AND THE SECOND: a machine that goes takes its jobs with it, answered. Without
//that, asking a destroyed machine to do something appeared to hang.
//---------------------------------------------------------------------------

let jobs, said, sent, timers, connectedTo;

beforeEach(() => {
    said = [];
    sent = [];
    timers = [];
    connectedTo = { runner1: true, runner2: true };

    jobs = makeJobs({
        say: (...where) => {
            const put = (kind) => (m) => said.push([kind, where.join('/'), m]);
            return { info: put('info'), out: put('out'), good: put('good'), bad: put('bad') };
        },
        agentFor: (name) => (connectedTo[name]
            ? { write: (msg) => sent.push([name, msg]) }
            : null),
        after: (ms, fn) => { const t = { ms, fn, live: true }; timers.push(t); return t; },
        cancel: (t) => { t.live = false; }
    });
});

//The job id the machine was told to use, so a test answers as the guest does.
const jobIdSentTo = (name) => sent.filter(([to]) => to === name).pop()[1].job;
const fire = (t) => { if (t.live) { t.live = false; t.fn(); } };

//A PROMISE THAT NEVER SETTLES IS THE FAILURE THIS FILE IS ABOUT, so no check in
//it may WAIT for one. Everything here settles in the same turn; a quarter of a
//second is a hang.
//
//Written after a sabotage — `return` before the timeout's body — turned every
//`await assert.rejects` into a test run that hung instead of failing. A hang and
//a failure are not the same answer, and only one of them can be reported.
const settled = async (p) => {
    const waiting = Symbol('never settled');
    const out = await Promise.race([
        p.then((value) => ({ value }), (error) => ({ error })),
        new Promise((r) => setTimeout(() => r(waiting), 250))
    ]);
    if (out === waiting) throw new Error('it never settled — nothing resolved it and nothing rejected it');
    return out;
};

const rejects = async (p, like) => {
    const { error } = await settled(p);
    assert.ok(error, 'it resolved where it should have failed');
    assert.match(error.message, like);
};

//---- asking ----------------------------------------------------------------

test('a command is sent to the machine, with a job to answer against', async () => {
    const running = jobs.run('runner1', 'uname -a', { what: 'kernel version' });

    assert.equal(sent.length, 1);
    const [to, msg] = sent[0];
    assert.equal(to, 'runner1');
    assert.equal(msg.type, 'run');
    assert.equal(msg.command, 'uname -a');
    assert.equal(msg.what, 'kernel version');
    assert.ok(msg.job);

    jobs.done('runner1', { job: msg.job, code: 0 });
    assert.deepEqual((await settled(running)).value, { code: 0, output: '' });
});

test('a machine that is not dialled in is refused, and told what to do about it', () => {
    //"not connected" IS A TRUE SENTENCE that leaves somebody looking at a
    //machine wondering whose fault it is.
    assert.throws(() => jobs.run('runner3', 'uname -a'),
        /is not dialled in.*Start it and wait for it to connect/s);
    assert.deepEqual(sent, []);
});

test('output comes back in order, as one answer', async () => {
    const running = jobs.run('runner1', 'ls');
    const job = jobIdSentTo('runner1');

    //LINES THAT DO NOT SORT INTO THE ORDER THEY ARRIVED IN, deliberately. With
    //"first" and "second" the two orders are the same, so the check held whether
    //or not anything preserved the order — and output whose lines are shuffled
    //is a build log nobody can read.
    jobs.out('runner1', { job, text: 'starting the build' });
    jobs.out('runner1', { job, text: 'compiled 4 files' });
    jobs.out('runner1', { job, text: 'done' });
    jobs.done('runner1', { job, code: 0 });

    assert.deepEqual((await settled(running)).value,
        { code: 0, output: 'starting the build\ncompiled 4 files\ndone' });
});

test('a non-zero code is an answer, not a failure of the channel', async () => {
    const running = jobs.run('runner1', 'false');
    const job = jobIdSentTo('runner1');

    jobs.out('runner1', { job, text: 'no such file' });
    jobs.done('runner1', { job, code: 2 });

    //THE COMMAND RAN AND SAID NO. The caller decides what that means.
    assert.deepEqual((await settled(running)).value, { code: 2, output: 'no such file' });
});

test('two jobs on two machines do not read each other’s output', async () => {
    const a = jobs.run('runner1', 'ls');
    const jobA = jobIdSentTo('runner1');
    const b = jobs.run('runner2', 'ls');
    const jobB = jobIdSentTo('runner2');

    assert.notEqual(jobA, jobB);

    jobs.out('runner1', { job: jobA, text: 'from one' });
    jobs.out('runner2', { job: jobB, text: 'from two' });
    jobs.done('runner1', { job: jobA, code: 0 });
    jobs.done('runner2', { job: jobB, code: 0 });

    assert.equal((await settled(a)).value.output, 'from one');
    assert.equal((await settled(b)).value.output, 'from two');
});

//---- the credential case ---------------------------------------------------

test('quiet keeps every line for the caller and puts none of them in the log', async () => {
    const running = jobs.run('runner1', 'cat ~/.claude/.credentials.json',
        { what: 'read the sign-in back', quiet: true });
    const job = jobIdSentTo('runner1');

    jobs.out('runner1', { job, text: '{"accessToken":"sk-ant-oat01-SECRET"}' });
    jobs.done('runner1', { job, code: 0 });

    //THE CALLER STILL GETS EVERY BYTE.
    assert.match((await settled(running)).value.output, /sk-ant-oat01-SECRET/);

    //AND THE LOG HAS NONE OF THEM. It is drawn in the window, photographed by
    //`capture`, and handed out by `logSince`.
    assert.equal(said.some(([, , m]) => String(m).includes('SECRET')), false,
        JSON.stringify(said));
});

test('but the line saying the command ran is still logged', async () => {
    const running = jobs.run('runner1', 'cat ~/.claude/.credentials.json',
        { what: 'read the sign-in back', quiet: true });
    jobs.done('runner1', { job: jobIdSentTo('runner1'), code: 0 });
    await settled(running);

    //"this host read the credential off kit-1" is exactly the kind of act that
    //should be visible. It is the VALUE that must not be.
    assert.ok(said.some(([, , m]) => /running on runner1: read the sign-in back/.test(m)),
        JSON.stringify(said));
});

test('an ordinary command is logged in full, because that is what the log is for', async () => {
    const running = jobs.run('runner1', 'ls');
    const job = jobIdSentTo('runner1');
    jobs.out('runner1', { job, text: 'ordinary output' });
    jobs.done('runner1', { job, code: 0 });
    await settled(running);

    assert.ok(said.some(([kind, , m]) => kind === 'out' && m === 'ordinary output'),
        JSON.stringify(said));
});

test('output for a job nobody is waiting on is still logged', () => {
    //A STRAY LINE IS EVIDENCE. The job it belonged to timed out or its machine
    //was replaced, and dropping it would make the reason unreadable.
    assert.equal(jobs.out('runner1', { job: 'no-such-job', text: 'late output' }), false);
    assert.ok(said.some(([kind, , m]) => kind === 'out' && m === 'late output'), JSON.stringify(said));
});

//---- when it does not come back --------------------------------------------

test('a command that never finishes is given up on, and says how long it waited', async () => {
    const running = jobs.run('runner1', 'sleep forever', { what: 'a long thing', timeout: 60000 });

    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, 60000);
    fire(timers[0]);

    await rejects(running, /"a long thing" on runner1 did not finish within 1 minutes/);
});

test('and a job that finished does not go off later', async () => {
    const running = jobs.run('runner1', 'ls');
    jobs.done('runner1', { job: jobIdSentTo('runner1'), code: 0 });
    await settled(running);

    //A TIMER LEFT RUNNING holds the process open and rejects a promise nobody
    //is listening to any more.
    assert.equal(timers[0].live, false);
});

test('a machine that goes takes its jobs with it, answered', async () => {
    const running = jobs.run('runner1', 'a long provision');

    assert.deepEqual(jobs.abandon('runner1', 'hung up — the machine closed it').length, 1);

    //WITHOUT THIS IT SAT UNTIL ITS TIMEOUT, so asking a destroyed machine to do
    //something appeared to HANG rather than to fail.
    await rejects(running, /"runner1" hung up — the machine closed it, so the command was not finished/);
});

test('and only that machine’s jobs', async () => {
    const a = jobs.run('runner1', 'ls');
    const b = jobs.run('runner2', 'ls');

    jobs.abandon('runner1', 'was replaced by a new connection');

    await rejects(a, /was replaced/);
    assert.deepEqual(jobs.waiting(), [{ job: jobIdSentTo('runner2'), vm: 'runner2' }]);

    jobs.done('runner2', { job: jobIdSentTo('runner2'), code: 0 });
    assert.equal((await settled(b)).value.code, 0);
});

test('abandoning also stops the timer, so nothing settles twice', async () => {
    const running = jobs.run('runner1', 'ls');
    jobs.abandon('runner1', 'hung up');
    await rejects(running, /hung up/);

    assert.equal(timers[0].live, false);
    //AND FIRING IT ANYWAY CHANGES NOTHING, which is what "settled" means.
    fire(timers[0]);
    assert.deepEqual(jobs.waiting(), []);
});

test('a machine with nothing out is abandoned without complaint', () => {
    assert.deepEqual(jobs.abandon('runner1', 'hung up'), []);
});
