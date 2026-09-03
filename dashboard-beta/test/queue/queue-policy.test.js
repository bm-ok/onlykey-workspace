const { test } = require('node:test');
const assert = require('node:assert');

const policy = require('../../src/app/queue/policy');

//---------------------------------------------------------------------------
//who is free, and what goes next.
//
//THE CLAIM THIS FILE IS FOR: the identity that says whether work holds must not
//be the identity that wrote it.
//
//A judge machine is lent a JUDGE's sign-in and a runner a worker's, so where a
//piece of work lands decides which account signs it. That property can be lost
//from either side — a task landing on a judge machine, or a judgement landing on
//a runner — and the two sides are deliberately NOT the same rule, which is the
//part worth holding down: one is absolute and the other switches itself on when
//the machine to do it with exists.
//
//AND THE SECOND CLAIM: a machine that cannot be given work says WHY. "Nothing is
//queued" and "everything is queued and no machine can take it" look identical
//from outside and want opposite responses.
//
//No machines here and no hypervisor: this half of the queue is rows in, an
//answer out, which is exactly why it was written first.
//---------------------------------------------------------------------------

const vm = (name, extra) => Object.assign({
    name,
    tags: ['worker'],
    baseSnapshot: 'base',
    forTasks: true,
    branch: null,
    stage: 'ready'
}, extra || {});

const free = (vms, inFlight) => policy.availability(vms, inFlight).filter((m) => m.free);
const why = (vms, name, inFlight) => policy.availability(vms, inFlight).find((m) => m.name === name).why;

//---------------------------------------------------------------------------
//WHERE WORK MAY LAND.
//---------------------------------------------------------------------------

test('a task never goes to a judge machine, even when nothing else is free', () => {
    const all = [vm('judge-1', { tags: ['judge'] })];
    const said = policy.ofItsOwnKind({ kind: 'task' }, free(all), all);

    //ABSOLUTE. There is no host on which this bends: a task on a judge machine
    //would be lent a worker's identity there, and the account that says whether
    //work holds becomes the account that wrote it.
    assert.deepEqual(said.machines, []);
});

test('a machine tagged both may take a task — the test is what it MAY do, not what it is', () => {
    const all = [vm('both-1', { tags: ['worker', 'judge'] })];
    const said = policy.ofItsOwnKind({ kind: 'task' }, free(all), all);

    //Excluding it for carrying a judge tag would take a perfectly good runner
    //out of the pool for a reason that has nothing to do with this task. It is
    //handed a worker's sign-in for this and a judge's for a judgement, and gives
    //each back before the next.
    assert.deepEqual(said.machines.map((m) => m.name), ['both-1']);
});

test('a judgement goes to the judge machine when this host has one', () => {
    const all = [vm('runner-1'), vm('judge-1', { tags: ['judge'] })];
    const said = policy.ofItsOwnKind({ kind: 'judgement' }, free(all), all);

    assert.deepEqual(said.machines.map((m) => m.name), ['judge-1']);
    assert.equal(said.fellBack, false);
});

test('a judgement waits for a busy judge machine rather than taking a runner', () => {
    const all = [vm('runner-1'), vm('judge-1', { tags: ['judge'] })];
    const said = policy.ofItsOwnKind({ kind: 'judgement' }, free(all, { 'judge-1': 'judgement j4' }), all);

    //THE SEPARATION IS WORTH A WAIT. A runner is free and is not offered — this
    //host has said which machine judges, so a judgement signed by a worker is
    //not an acceptable way to be quicker.
    assert.deepEqual(said.machines, []);
    assert.match(said.why, /busy/);
});

test('with no judge machine at all, judging carries on and says so', () => {
    const all = [vm('runner-1')];
    const said = policy.ofItsOwnKind({ kind: 'judgement' }, free(all), all);

    //A RULE THAT BREAKS A WORKING APP THE MOMENT IT IS ADDED IS A RULE THAT GETS
    //REVERTED RATHER THAN ADOPTED. So it switches itself on when the machine to
    //do it with exists, and until then it is said out loud — an arrangement
    //somebody believes is in force and is not is worse than one they know they
    //have not made yet.
    assert.deepEqual(said.machines.map((m) => m.name), ['runner-1']);
    assert.equal(said.fellBack, true);
    assert.match(said.why, /signed by a worker's identity/);
});

test('with no judge and no worker either, the fallback does not promise a runner it does not have', () => {
    //This once promised judging would carry on using ordinary runners — true on
    //a host that HAS runners, and said on one where every machine had had its
    //role taken off. It described a graceful degradation that was not happening
    //while the work sat still.
    const all = [vm('nameless-1', { tags: [] })];
    const said = policy.ofItsOwnKind({ kind: 'judgement' }, free(all), all);

    assert.equal(said.fellBack, true);
    assert.match(said.why, /nowhere to go and waits/);
    assert.doesNotMatch(said.why, /judgements go to ordinary runners/);
});

//---------------------------------------------------------------------------
//A TAG WAITS, RATHER THAN FALLING BACK.
//---------------------------------------------------------------------------

test('an untagged entry takes any machine; a tagged one takes only its own', () => {
    assert.equal(policy.takes({}, ['default']), true);
    assert.equal(policy.takes({ tag: 'big' }, ['big', 'default']), true);
    assert.equal(policy.takes({ tag: 'big' }, ['default']), false);
    //A tag that quietly means "prefer" is a tag that sends work to the wrong
    //machine on a busy afternoon — which is the one thing somebody who bothered
    //to tag a machine was trying to prevent.
    assert.equal(policy.takes({ tag: 'BIG' }, ['big']), true, 'case is not a different pool');
    assert.equal(policy.takes({ tag: '  ' }, ['default']), true, 'blank is not a pool');
});

//---------------------------------------------------------------------------
//WHY A MACHINE CANNOT BE GIVEN WORK.
//---------------------------------------------------------------------------

test('a supervisor is never in the pool, and is not reported as merely kept back', () => {
    const all = [vm('sup-1', { tags: ['supervisor'] })];

    //Giving it a task would roll it back to its base snapshot mid-thought and
    //run a worker over the top of the thing that was handing out the work.
    assert.deepEqual(free(all), []);
    //SAID AS THE TAG, because that is what it is. A runner is a virtual machine
    //in the pool and the tag says what it is for — all three kinds are runners,
    //and calling only one of them "a machine" made the other two read as
    //something else.
    assert.match(why(all, 'sup-1'), /tagged supervisor/);
    //Reporting it as "kept back" would suggest a button exists.
    assert.doesNotMatch(why(all, 'sup-1'), /kept back/);
});

test('a machine with no role is not free, and the reason carries the fix', () => {
    const all = [vm('new-1', { tags: [] })];

    //SILENCE IS NOT AN ANSWER. This used to read as "worker" — a guess about
    //which credential to hand a machine.
    assert.deepEqual(free(all), []);
    assert.equal(policy.availability(all)[0].roleless, true);
    assert.match(why(all, 'new-1'), /vmTags/, 'a dead end without the two words that solve it');
});

test('the most specific and most temporary reason wins', () => {
    //A machine can be several kinds of unavailable at once and only one of them
    //is worth acting on. Somebody is INSIDE this one — it is the machine the
    //queue must not roll back, whatever else is true of it.
    const all = [vm('busy-1', {
        borrowed: { why: 'signing a worker in' },
        forTasks: false,
        branch: 'fix/the-thing',
        stage: 'installing'
    })];

    assert.match(why(all, 'busy-1'), /borrowed — signing a worker in/);
});

test('a machine keeps its roles on every answer, busy or not', () => {
    const all = [vm('runner-1', { tags: ['worker'] })];
    const said = policy.availability(all, { 'runner-1': 'task #4' });

    //Added only to the last two returns at first, so a machine that was busy
    //came back with no roles on it and vanished from the panel that lists the
    //pool. A machine does not stop being a worker because it is busy being one.
    assert.deepEqual(said[0].kinds, ['worker']);
    assert.equal(said[0].free, false);
    assert.match(said[0].why, /doing task #4/);
});

test('a machine with no base snapshot cannot be made clean, and says that', () => {
    const all = [vm('runner-1', { baseSnapshot: null })];
    assert.match(why(all, 'runner-1'), /no base snapshot/);
});

test('a machine still claiming a branch is correctly never picked up, and says which', () => {
    //This looks exactly like a queue gone quiet, which is why the branch is
    //named rather than the machine merely being absent from the list.
    const all = [vm('runner-1', { branch: 'fix/the-thing' })];
    assert.match(why(all, 'runner-1'), /still claims fix\/the-thing/);
});

//---------------------------------------------------------------------------
//WHAT GOES NEXT.
//---------------------------------------------------------------------------

test('judgements go before tasks, and it is oldest first within each', () => {
    const said = policy.order([
        { kind: 'task', number: 1 },
        { kind: 'judgement', number: 9 },
        { kind: 'task', number: 2 },
        { kind: 'judgement', number: 4 }
    ]);

    //A judgement reads work that is already waiting to land, and behind it
    //somebody is holding a change; a task makes MORE work to be read. A queue
    //that runs tasks first grows the thing it is behind on.
    assert.deepEqual(said.map((e) => e.kind + e.number), ['judgement4', 'judgement9', 'task1', 'task2']);
});

test('an entry of an unknown kind sorts with the tasks rather than jumping the queue', () => {
    const said = policy.order([{ kind: 'something-new', number: 1 }, { kind: 'judgement', number: 8 }]);
    assert.equal(said[0].kind, 'judgement');
});

test('ordering does not reorder what it was shown', () => {
    //A queue that changes a board by reading it is a queue nobody can trust the
    //board of.
    const mine = [{ kind: 'task', number: 2 }, { kind: 'judgement', number: 1 }];
    policy.order(mine);
    assert.deepEqual(mine.map((e) => e.kind), ['task', 'judgement']);
});

test('the sentence describing the order is beside the rule that implements it', () => {
    //The board draws this and a model reads it. Kept here so it cannot describe
    //an order that is not this one.
    assert.match(policy.ORDER, /Judgements first/);
    assert.match(policy.ORDER, /oldest first/);
});

//---------------------------------------------------------------------------
//WHOSE MACHINE THE QUEUE DOES NOT TALK ABOUT.
//
//`notForTheQueue` IS THE ONE ANSWER, and it exists because the question kept
//being answered again by hand, wrongly, in whatever file needed it.
//
//IT HAS BEEN GOT WRONG TWICE, THE SAME WAY BOTH TIMES: a filter written out as
//`tags.indexOf('supervisor') < 0`, correct about supervisors and silent about
//every other role. The first time, `pools` reported a DIY machine as its own
//pool with nothing free in it and the reason "has not been told what it is for
//— tag it worker or judge": untrue, since it had been told, and dangerous,
//because following it hands a person's seat to the tick.
//
//THE SECOND TIME WAS THE TROUBLE BANNER. A DIY seat was opened and the window
//said, in red, across the top: "ok-diy1 is on and doing nothing. A runner rests
//off — THE QUEUE STARTS ONE WHEN THERE IS WORK. Shut it down." Every clause is
//about the queue, on the one machine the queue must never touch — scolding
//somebody for sitting in their own seat, with a link to Runners to undo it.
//
//SO IT IS TESTED HERE RATHER THAN WHERE IT IS READ. Both callers delegate;
//holding the answer down once is what stops a third hand-rolled copy.
test('the queue leaves a supervisor and a DIY seat alone, and nothing else', () => {
    assert.equal(policy.notForTheQueue(vm('a', { tags: ['supervisor'] })), true);
    assert.equal(policy.notForTheQueue(vm('b', { tags: ['diy'] })), true,
        'a DIY seat read as the queue\'s to manage');

    //BOTH AT ONCE, because a tag list is a list.
    assert.equal(policy.notForTheQueue(vm('c', { tags: ['diy', 'worker'] })), true,
        'a seat that also carries worker is still somebody\'s seat');

    //AND THE ONES IT IS FOR.
    assert.equal(policy.notForTheQueue(vm('d', { tags: ['worker'] })), false);
    assert.equal(policy.notForTheQueue(vm('e', { tags: ['judge'] })), false);
    assert.equal(policy.notForTheQueue(vm('f', { tags: ['worker', 'judge'] })), false);

    //NO TAG IS NOT A KIND, and it is still the queue's to report on — it says
    //"has not been told what it is for" rather than being dropped.
    assert.equal(policy.notForTheQueue(vm('g', { tags: [] })), false);

    //AND IT MUST NOT THROW ON A ROW THAT CARRIES NO TAGS FIELD, which is what a
    //machine record looks like before anything has tagged it.
    assert.doesNotThrow(() => policy.notForTheQueue({ name: 'h' }));
    assert.equal(policy.notForTheQueue({ name: 'h' }), false);
});
