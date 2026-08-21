const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const Drawers = require('../../src/app/core/cached/drawers');
const makeGate = require('../../src/app/vms/vbox/gate');

//---------------------------------------------------------------------------
//how this app talks to VirtualBox at all.
//
//NO VirtualBox IN HERE. Every rule below is about ORDER and REPETITION — how
//many processes start, in what sequence, and which callers share an answer — so
//the thing that runs them is a stand-in that records what it was asked and when.
//A real VBoxManage could not answer these questions and would take minutes
//trying.
//
//THE CLAIMS, and all of them were paid for:
//
//  * ONE AT A TIME. VBoxSVC is a single service with a session model, and
//    asking it several things at once locked it up completely: `list vms`
//    stopped answering, `startvm` failed, and it took closing every VirtualBox
//    process and restarting the service to recover. What got it there was
//    ordinary use — the window polling while the command line asked.
//  * IDENTICAL READS ARE ONE READ, including two that arrive while the first is
//    still running. Without that a serial queue converts "four at once" into
//    "four in a row", which is the same work spread thinner.
//  * A WRITE MAKES EVERY REMEMBERED ANSWER STALE, and only VirtualBox's.
//  * A SESSION LOCK IS RETRIED AND NOTHING ELSE IS. VirtualBox loses races
//    against its own session handling; every other failure is a real answer.
//  * AND IT SAYS WHEN IT IS SLOW, because a serial queue turns "VirtualBox is
//    unwell" into "the window has gone quiet".
//---------------------------------------------------------------------------

let ran, gate, said, clock, drawer, release;

//A TURN OF THE MICROTASK QUEUE. Nothing spawns synchronously — the queue hands
//each call to `chain.then`, so right after `run()` returns no process has
//started yet and there is nothing to release.
const tick = () => new Promise((r) => setImmediate(r));

function spawnStub(args) {
    ran.push({ args: args.join(' '), at: clock });
    //HELD OPEN UNTIL RELEASED, so a test can put two callers in flight at once —
    //which is the case the whole memo exists for.
    if (release) return new Promise((r) => { release.push(() => r('out:' + args.join(' '))); });
    return Promise.resolve('out:' + args.join(' '));
}

beforeEach(() => {
    ran = [];
    said = [];
    clock = 1000;
    release = null;

    drawer = Drawers({ now: () => clock }).whileFresh('vbox', 1200);
    gate = makeGate(spawnStub, {
        asked: drawer,
        say: { warn: (t) => said.push(t), info: (t) => said.push(t) },
        now: () => clock,
        sleep: async () => {}
    });
});

//---------------------------------------------------------------------------
//ONE AT A TIME.
//---------------------------------------------------------------------------

test('two different calls run one after the other, never together', async () => {
    release = [];

    const a = gate.run(['startvm', 'one']);
    const b = gate.run(['startvm', 'two']);
    await tick();

    //THE SECOND HAS NOT STARTED. Asking VBoxSVC two things at once is how it
    //stops answering at all.
    assert.equal(ran.length, 1, 'both started at once: ' + ran.map((r) => r.args).join(' | '));

    release[0]();
    await a;
    await tick();

    assert.equal(ran.length, 2);
    release[1]();
    await b;
});

test('a failure does not stop the queue', async () => {
    const boom = makeGate(
        (args) => { ran.push({ args: args.join(' ') }); return args[1] === 'bad' ? Promise.reject(new Error('no')) : Promise.resolve('ok'); },
        { asked: drawer, say: { warn: () => {}, info: () => {} }, now: () => clock, sleep: async () => {} });

    await assert.rejects(() => boom.run(['startvm', 'bad']));
    //RUN WHATEVER THE ONE BEFORE DID. A queue that stops on the first failure is
    //a queue that stops.
    assert.equal(await boom.run(['startvm', 'good']), 'ok');
});

//---------------------------------------------------------------------------
//IDENTICAL READS ARE ONE READ.
//---------------------------------------------------------------------------

test('the same question asked twice runs one process', async () => {
    await gate.run(['list', 'vms']);
    await gate.run(['list', 'vms']);

    assert.equal(ran.length, 1, 'it asked twice');
});

test('and two that arrive while the first is still running share its answer', async () => {
    release = [];

    //THE EXACT CASE: the window and the command line asking within the same
    //second, before either has answered. A memo that only remembers COMPLETED
    //answers would start a second process here.
    const a = gate.run(['list', 'vms']);
    const b = gate.run(['list', 'vms']);
    await tick();

    assert.equal(ran.length, 1, 'the second caller started its own process');

    release[0]();
    assert.equal(await a, 'out:list vms');
    assert.equal(await b, 'out:list vms');
});

test('a different question is a different question', async () => {
    await gate.run(['list', 'vms']);
    await gate.run(['list', 'runningvms']);
    assert.equal(ran.length, 2);
});

test('past the window it is asked again, because a state could have moved', async () => {
    await gate.run(['list', 'vms']);
    clock += 1500;
    await gate.run(['list', 'vms']);

    //SHORT ENOUGH THAT NOTHING OBSERVES A STATE IT COULD HAVE ACTED ON. The
    //state watchers poll at two seconds, so none of them sees an answer older
    //than its own interval.
    assert.equal(ran.length, 2);
});

test('a failed read is not remembered', async () => {
    let n = 0;
    const flaky = makeGate(
        () => { n++; return n === 1 ? Promise.reject(new Error('busy')) : Promise.resolve('ok'); },
        { asked: drawer, say: { warn: () => {}, info: () => {} }, now: () => clock, sleep: async () => {} });

    await assert.rejects(() => flaky.run(['list', 'vms']));
    //THE NEXT CALLER ASKS AGAIN rather than being handed a remembered error for
    //the next second and a bit.
    assert.equal(await flaky.run(['list', 'vms']), 'ok');
});

//---------------------------------------------------------------------------
//WHAT COUNTS AS A READ.
//---------------------------------------------------------------------------

test('the reads are the ones that only ask', () => {
    assert.equal(gate.asks(['list', 'vms']), true);
    assert.equal(gate.asks(['showvminfo', 'one']), true);
    assert.equal(gate.asks(['getextradata', 'one', 'k']), true);
    assert.equal(gate.asks(['guestproperty', 'get', 'one', 'k']), true);
    assert.equal(gate.asks(['snapshot', 'one', 'list']), true);
});

test('and everything else is assumed to change something', () => {
    //THE SAFE DIRECTION: a new read left off the list is merely slower, while a
    //write mistaken for a read leaves every panel remembering what used to be
    //true.
    assert.equal(gate.asks(['startvm', 'one']), false);
    assert.equal(gate.asks(['controlvm', 'one', 'poweroff']), false);
    assert.equal(gate.asks(['snapshot', 'one', 'take', 'base']), false);
    assert.equal(gate.asks(['unregistervm', 'one', '--delete']), false);
});

test('a write makes every remembered answer stale', async () => {
    await gate.run(['list', 'vms']);
    assert.equal(ran.length, 1);

    await gate.run(['startvm', 'one']);
    await gate.run(['list', 'vms']);

    //CHANGING SOMETHING MAKES EVERY REMEMBERED ANSWER A GUESS.
    assert.equal(ran.length, 3, 'the list was answered from before the machine started');
});

test('and only VirtualBox’s answers, not everything the app remembers', async () => {
    const other = Drawers({ now: () => clock }).whileFresh('refs', 60000);
    let reads = 0;
    await other.get('repo-one', () => { reads++; return 'aaa'; });

    await gate.run(['startvm', 'one']);
    await other.get('repo-one', () => { reads++; return 'aaa'; });

    //THE APP-WIDE `stale()` WOULD TAKE THE REF READS WITH IT, and they have
    //nothing to do with VirtualBox.
    assert.equal(reads, 1, 'starting a machine threw away what git had said');
});

//---------------------------------------------------------------------------
//A SESSION LOCK IS RETRIED AND NOTHING ELSE IS.
//---------------------------------------------------------------------------

const locked = () => Object.assign(new Error('VBOX_E_INVALID_OBJECT_STATE'), { stderr: 'the object is not locked' });

test('a session lock is retried, because one attempt is not a real attempt', async () => {
    let n = 0;
    const out = await gate.retrying(() => { n++; if (n < 3) throw locked(); return 'done'; }, { what: 'starting' });

    assert.equal(out, 'done');
    assert.equal(n, 3);
    assert.match(said.join(' | '), /starting attempt 1 hit a session lock/);
});

test('anything else is a real answer and is not retried', async () => {
    let n = 0;
    await assert.rejects(() => gate.retrying(() => { n++; throw new Error('there is no such machine'); }));

    //RETRYING A REAL FAILURE SIX TIMES just takes longer to say so.
    assert.equal(n, 1);
});

test('a lock that never clears gives up and says the last thing it was told', async () => {
    let n = 0;
    await assert.rejects(
        () => gate.retrying(() => { n++; throw locked(); }, { attempts: 3 }),
        /INVALID_OBJECT_STATE/);
    assert.equal(n, 3);
});

//---------------------------------------------------------------------------
//IT SAYS WHEN IT IS SLOW.
//---------------------------------------------------------------------------

test('a call held up behind others says so, once', async () => {
    release = [];
    const first = gate.run(['startvm', 'one']);
    const second = gate.run(['startvm', 'two']);
    const third = gate.run(['startvm', 'three']);
    await tick();

    //TIME PASSES WHILE THEY WAIT.
    clock += 30000;
    release[0]();
    await first;
    await tick();
    release[1]();
    await second;
    await tick();
    release[2]();
    await third;

    const slow = said.filter((t) => /answering slowly/.test(t));
    //AT MOST ONE LINE A MINUTE. A stall produces hundreds of waits and one of
    //them is the whole message.
    assert.equal(slow.length, 1, 'said it ' + slow.length + ' times: ' + slow.join(' | '));
    assert.match(slow[0], /waited 30s behind/);
});

test('a call that was not held up says nothing', async () => {
    await gate.run(['startvm', 'one']);
    assert.deepEqual(said.filter((t) => /answering slowly/.test(t)), []);
});

test('how many are waiting is answerable, so a board can say why it is stale', async () => {
    release = [];
    assert.equal(gate.waiting(), 0);

    const a = gate.run(['startvm', 'one']);
    gate.run(['startvm', 'two']);
    await tick();
    assert.equal(gate.waiting(), 2);

    release[0]();
    await a;
    await tick();
    assert.equal(gate.waiting(), 1);
    release[1]();
});
