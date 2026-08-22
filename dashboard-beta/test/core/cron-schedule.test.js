const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makeSchedule = require('../../src/app/core/cron/schedule');

//---------------------------------------------------------------------------
//what is due, what is running, and what happened last time.
//
//THE CLAIM WORTH THE MOST: re-adding a job keeps its history and its switch. The
//plugin that owns a job lives in the bundle that reloads, so it re-registers
//every few minutes while somebody is working — and a save that reset "running"
//would silently switch the queue off, or on.
//
//AND THE SECOND: a run that threw does not stop the clock. A job that switches
//itself off on one bad minute is one somebody finds stopped hours later with no
//idea when.
//---------------------------------------------------------------------------

let cron, said, clock;

beforeEach(() => {
    said = [];
    clock = 1000;

    cron = makeSchedule({
        now: () => clock,
        at: () => 'a-time',
        say: (...where) => {
            const put = (kind) => (m) => said.push([kind, where.join('/'), m]);
            return { good: put('good'), warn: put('warn'), bad: put('bad'), info: put('info') };
        }
    });
});

const named = (name) => cron.list(clock).find((j) => j.name === name);

//---- registering ------------------------------------------------------------

test('a job needs a name and an interval', () => {
    assert.throws(() => cron.add({ every: 1000 }), /needs a name/);
    assert.throws(() => cron.add({ name: 'x' }), /needs an interval/);
    assert.throws(() => cron.add({ name: 'x', every: 0 }), /needs an interval/);
    assert.throws(() => cron.add({ name: 'x', every: -5 }), /needs an interval/);
});

test('a job that only reads something may come up running', () => {
    cron.add({ name: 'github', every: 60000, autoStart: true, about: 'what changed' });

    assert.equal(named('github').running, true);
    assert.equal(named('github').since.by, 'the app');
});

test('and one that reaches a real machine comes up stopped', () => {
    //THE PIECE THAT ROLLS A MACHINE BACK, hands it a credential and runs
    //somebody's instructions on it unattended. A thing that does that is STARTED
    //by a person, every time.
    cron.add({ name: 'queue', every: 15000 });

    assert.equal(named('queue').running, false);
    assert.equal(named('queue').autoStart, false);
    assert.equal(named('queue').since, null);
});

//---- what a save does -------------------------------------------------------

test('re-adding a job keeps whether it is running', () => {
    cron.add({ name: 'queue', every: 15000 });
    cron.start('queue', 'bmatusiak');

    //THE BUNDLE RELOADS AND THE PLUGIN REGISTERS AGAIN.
    cron.add({ name: 'queue', every: 15000 });

    assert.equal(named('queue').running, true);
    assert.equal(named('queue').since.by, 'bmatusiak');
});

test('and re-adding an auto-start job does not restart one somebody stopped', () => {
    cron.add({ name: 'github', every: 60000, autoStart: true });
    cron.stop('github', 'it was noisy');

    cron.add({ name: 'github', every: 60000, autoStart: true });

    //A SAVE MUST NOT UNDO A DECISION SOMEBODY MADE.
    assert.equal(named('github').running, false);
});

test('re-adding keeps the history, and takes the new interval', () => {
    cron.add({ name: 'github', every: 60000, about: 'old words' });
    cron.does('github', async () => {});
    cron.start('github');
    clock = 1000 + 60000;
    return cron.beat(clock).then(() => {
        assert.equal(named('github').runs, 1);

        cron.add({ name: 'github', every: 30000, about: 'new words' });

        //WHAT HAPPENED IS KEPT; what the code SAYS about the job is replaced.
        assert.equal(named('github').runs, 1);
        assert.equal(named('github').every, 30000);
        assert.equal(named('github').about, 'new words');
    });
});

//---- who may work the switch ------------------------------------------------

test('a job can declare that only a person may start it, and say why', () => {
    //WITHOUT THIS, cron IS A WAY ROUND A REFUSAL THAT ALREADY EXISTS. The
    //queue's own `queueStart` refuses over the wire because starting it gives
    //real machines real work; a generic "cronStart queue" that did not ask would
    //be the same act under a name nobody had thought to guard.
    cron.add({ name: 'queue', every: 15000, humanOnly: 'a person, in the window' });

    assert.equal(named('queue').humanOnly, 'a person, in the window');
    //THE REASON RATHER THAN A FLAG, because whoever is refused should be told
    //what this particular job is.
    assert.equal(typeof named('queue').humanOnly, 'string');
});

test('and a job that needs no gate says nothing', () => {
    cron.add({ name: 'github', every: 60000, autoStart: true });
    assert.equal(named('github').humanOnly, null);
});

test('a save cannot drop the gate', () => {
    cron.add({ name: 'queue', every: 15000, humanOnly: 'a person, in the window' });

    //THE NEW BUNDLE FORGOT TO SAY IT — a rename, a bad merge, a line deleted by
    //accident. The gate is the thing that must survive that, not the thing that
    //quietly goes with it.
    cron.add({ name: 'queue', every: 15000 });

    assert.equal(named('queue').humanOnly, 'a person, in the window');
});

//---- the slot ---------------------------------------------------------------

test('the work is put in, and taken out again', () => {
    cron.add({ name: 'github', every: 1000 });
    assert.equal(named('github').armed, false);

    const off = cron.does('github', async () => {});
    assert.equal(named('github').armed, true);

    off();
    assert.equal(named('github').armed, false);
});

test('taking it out only removes your own', () => {
    cron.add({ name: 'github', every: 1000 });
    const mine = async () => {};
    const off = cron.does('github', mine);

    //A SAVE PUTS THE NEW BUNDLE'S WORK IN, then the old bundle is destroyed and
    //removes its own. If that removal were unconditional it would take the new
    //one with it, and the job would go quiet with nobody able to say why.
    cron.does('github', async () => {});
    off();

    assert.equal(named('github').armed, true);
});

test('a job with nothing behind it says so once, not every interval', async () => {
    cron.add({ name: 'github', every: 1000 });
    cron.start('github');

    for (let n = 1; n <= 5; n++) {
        clock = 1000 + n * 1000;
        await cron.beat(clock);
    }

    const warnings = said.filter(([, , m]) => /nothing is registered to do it/.test(m));
    //THE ALTERNATIVE IS A LINE EVERY INTERVAL, and the alternative to that is
    //silence about a job that has quietly stopped doing anything.
    assert.equal(warnings.length, 1, JSON.stringify(said));
});

test('and says it again after work came back and went away', async () => {
    cron.add({ name: 'github', every: 1000 });
    cron.start('github');
    clock = 2000; await cron.beat(clock);

    const off = cron.does('github', async () => {});
    clock = 3000; await cron.beat(clock);
    off();
    clock = 4000; await cron.beat(clock);

    assert.equal(said.filter(([, , m]) => /nothing is registered/.test(m)).length, 2);
});

//---- what is due ------------------------------------------------------------

test('a stopped job is never due', () => {
    cron.add({ name: 'queue', every: 1000 });
    clock = 999999;
    assert.deepEqual(cron.due(clock), []);
});

test('a started job is due a whole interval after the press', () => {
    cron.add({ name: 'queue', every: 15000 });
    cron.start('queue', 'bmatusiak');

    //A TICK ON THE SAME TURN AS THE PRESS gives nobody a chance to press stop
    //again, and starting the queue is the one act here that reaches a machine.
    assert.deepEqual(cron.due(1000), []);
    assert.deepEqual(cron.due(1000 + 14999), []);
    assert.deepEqual(cron.due(1000 + 15000), ['queue']);
});

test('unless it asked to run immediately', () => {
    cron.add({ name: 'github', every: 60000, firstRun: 'now' });
    cron.start('github');

    assert.deepEqual(cron.due(1000), ['github']);
});

test('the interval is counted from when a run STARTED, not when it finished', async () => {
    cron.add({ name: 'slow', every: 15000 });
    cron.does('slow', async () => { clock += 11000; });
    cron.start('slow');

    clock = 1000 + 15000;
    await cron.beat(clock);          //starts at 16000, ends at 27000

    //A JOB THAT TAKES ELEVEN SECONDS ON A FIFTEEN-SECOND INTERVAL should still
    //run every fifteen, not every twenty-six.
    assert.deepEqual(cron.due(16000 + 14999), []);
    assert.deepEqual(cron.due(16000 + 15000), ['slow']);
});

test('several due at once all run', async () => {
    const ran = [];
    for (const name of ['a', 'b', 'c']) {
        cron.add({ name, every: 1000 });
        cron.does(name, async () => ran.push(name));
        cron.start(name);
    }

    clock = 2000;
    await cron.beat(clock);
    assert.deepEqual(ran.sort(), ['a', 'b', 'c']);
});

//---- one at a time ----------------------------------------------------------

test('a run that is still going is not started again', async () => {
    let running = 0;
    let most = 0;
    let release;
    const held = new Promise((r) => { release = r; });

    cron.add({ name: 'slow', every: 1000 });
    cron.does('slow', async () => {
        running++;
        most = Math.max(most, running);
        await held;
        running--;
    });
    cron.start('slow');

    clock = 2000;
    const first = cron.beat(clock);

    //THE CLOCK KEEPS TURNING while the run is in flight.
    clock = 3000; await cron.beat(clock);
    clock = 4000; await cron.beat(clock);

    //TWO OVERLAPPING RUNS WOULD BOTH SEE THE SAME WORLD AND BOTH ACT ON IT.
    assert.equal(most, 1);
    assert.equal(named('slow').inFlight, true);

    release();
    await first;
    assert.equal(named('slow').inFlight, false);
});

//---- a failure --------------------------------------------------------------

test('a run that threw does not stop the clock', async () => {
    let n = 0;
    cron.add({ name: 'flaky', every: 1000 });
    cron.does('flaky', async () => { n++; if (n === 1) throw new Error('unreachable'); });
    cron.start('flaky');

    clock = 2000; await cron.beat(clock);
    clock = 3000; await cron.beat(clock);

    //THE NEXT ONE MAY WELL WORK — a machine that was unreachable comes back.
    assert.equal(n, 2);
    assert.equal(named('flaky').running, true);
    assert.equal(named('flaky').failures, 1);
    assert.equal(named('flaky').runs, 2);
});

test('and what it said is kept, so somebody can see WHY', async () => {
    cron.add({ name: 'flaky', every: 1000 });
    cron.does('flaky', async () => { throw new Error('VirtualBox is not installed'); });
    cron.start('flaky');

    clock = 2000; await cron.beat(clock);

    assert.equal(named('flaky').last.ok, false);
    assert.equal(named('flaky').last.said, 'VirtualBox is not installed');
    assert.ok(said.some(([kind, , m]) => kind === 'bad' && /VirtualBox is not installed/.test(m)));
});

test('a job that throws something that is not an Error still says something', async () => {
    cron.add({ name: 'odd', every: 1000 });
    cron.does('odd', async () => { throw 'just a string'; });
    cron.start('odd');

    clock = 2000; await cron.beat(clock);
    assert.equal(named('odd').last.said, 'just a string');
});

//---- the switch -------------------------------------------------------------

test('starting one that is already running changes nothing', () => {
    cron.add({ name: 'github', every: 1000 });
    assert.equal(cron.start('github', 'first'), true);
    assert.equal(cron.start('github', 'second'), false);
    assert.equal(named('github').since.by, 'first');
});

test('stopping does not interrupt a run already in flight', async () => {
    let release;
    const held = new Promise((r) => { release = r; });
    let finished = false;

    cron.add({ name: 'slow', every: 1000 });
    cron.does('slow', async () => { await held; finished = true; });
    cron.start('slow');

    clock = 2000;
    const going = cron.beat(clock);

    cron.stop('slow', 'somebody pressed it');
    assert.equal(named('slow').running, false);

    //IT STOPS THE NEXT ONE BEING PICKED UP; a run already given out carries on.
    release();
    await going;
    assert.equal(finished, true);
});

test('and it says a run is still going, rather than implying everything stopped', async () => {
    let release;
    const held = new Promise((r) => { release = r; });
    cron.add({ name: 'slow', every: 1000 });
    cron.does('slow', async () => { await held; });
    cron.start('slow');

    clock = 2000;
    const going = cron.beat(clock);
    cron.stop('slow');

    assert.ok(said.some(([, , m]) => /still in flight and is not interrupted/.test(m)), JSON.stringify(said));
    release();
    await going;
});

test('stopping one that is not running changes nothing', () => {
    cron.add({ name: 'github', every: 1000 });
    assert.equal(cron.stop('github'), false);
});

//---- what somebody looks at -------------------------------------------------

test('running and armed are different questions', () => {
    cron.add({ name: 'queue', every: 1000 });
    cron.does('queue', async () => {});

    //ARMED AND OFF is what every start of this app looks like.
    assert.deepEqual([named('queue').running, named('queue').armed], [false, true]);

    cron.start('queue');
    const off = cron.does('queue', null);
    off;

    //RUNNING WITH NOTHING BEHIND IT is what a save looks like for a moment.
    assert.deepEqual([named('queue').running, named('queue').armed], [true, false]);
});

test('how long until the next one, for somebody watching', () => {
    cron.add({ name: 'queue', every: 15000 });
    cron.start('queue');

    assert.equal(cron.list(1000)[0].dueIn, 15000);
    assert.equal(cron.list(1000 + 5000)[0].dueIn, 10000);
    //NEVER NEGATIVE: overdue is nought, not a countdown that has gone through
    //zero and reads like a very long wait.
    assert.equal(cron.list(1000 + 99000)[0].dueIn, 0);
    cron.stop('queue');
    assert.equal(cron.list(1000)[0].dueIn, null);
});

test('the last few runs are kept, and no more than a few', async () => {
    cron.add({ name: 'busy', every: 1000 });
    cron.does('busy', async () => {});
    cron.start('busy');

    for (let n = 1; n <= cron.KEEP + 5; n++) {
        clock = 1000 + n * 1000;
        await cron.beat(clock);
    }

    //ENOUGH TO SEE A PATTERN — a job that fails every third time is the
    //interesting case and one entry cannot show it — and BOUNDED, because this
    //is in memory for as long as the app runs.
    assert.equal(named('busy').history.length, cron.KEEP);
    assert.equal(named('busy').runs, cron.KEEP + 5);
});

test('the newest run is first', async () => {
    cron.add({ name: 'busy', every: 1000 });
    let n = 0;
    //EACH RUN DISTINGUISHABLE, AND THE FIRST AND LAST DIFFERENT. Written with
    //only the middle one failing, which reads fine and cannot tell the newest
    //from the oldest: reversing the list left history[1] in the middle either
    //way and `last` pointing at a run that also succeeded.
    cron.does('busy', async () => {
        n++;
        if (n !== 2) throw new Error('run ' + n + ' failed');
    });
    cron.start('busy');

    clock = 2000; await cron.beat(clock);
    clock = 3000; await cron.beat(clock);
    clock = 4000; await cron.beat(clock);

    const h = named('busy').history;
    assert.equal(h.length, 3);
    assert.deepEqual(h.map((e) => e.said), ['run 3 failed', null, 'run 1 failed']);

    //AND `last` IS THE ONE THAT JUST HAPPENED, which is the whole reason the
    //pane leads with it.
    assert.equal(named('busy').last.said, 'run 3 failed');
});

test('the list carries no functions, because it is drawn and photographed', () => {
    cron.add({ name: 'queue', every: 1000 });
    cron.does('queue', async () => { /* a closure over the whole bundle */ });

    const [one] = cron.list(clock);
    for (const [key, value] of Object.entries(one)) {
        assert.notEqual(typeof value, 'function', key + ' is a function');
    }
    assert.equal(JSON.stringify(one).includes('function'), false);
});

test('putting work in for a job that does not exist is a mistake, not a silence', () => {
    assert.throws(() => cron.does('never-registered', async () => {}),
        /There is no scheduled job called "never-registered"/);
});
