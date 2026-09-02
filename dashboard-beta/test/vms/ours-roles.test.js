const { test } = require('node:test');
const assert = require('node:assert');

const roles = require('../../src/app/vms/ours/roles');
const policy = require('../../src/app/queue/policy');

//---------------------------------------------------------------------------
//what a machine is for.
//
//THE CLAIM WORTH THE MOST: silence is not an answer. An untagged machine gets
//no role, because the thing that answer decides is WHICH CREDENTIAL TO HAND
//THE MACHINE, and "probably an ordinary runner" is a guess about a sign-in.
//---------------------------------------------------------------------------

const tagged = (...tags) => ({ name: 'one', tags });

test('an unlabelled machine is nothing, rather than a runner by default', () => {
    assert.deepEqual(roles.kindsOf(tagged()), []);
    assert.equal(roles.kindOf(tagged()), null);
    assert.equal(roles.takesQueuedWork(tagged()), false);
    //AND IT SAYS SO IN WORDS, so a card does not read as though it were fine.
    assert.equal(roles.kindSaid(tagged()), 'no role yet');
});

test('a record with no tags field at all is the same answer', () => {
    assert.deepEqual(roles.kindsOf({ name: 'one' }), []);
    assert.deepEqual(roles.kindsOf(null), []);
    assert.deepEqual(roles.kindsOf(undefined), []);
});

test('each of the three is recognised, whatever case it was typed in', () => {
    assert.deepEqual(roles.kindsOf(tagged('Worker')), ['worker']);
    assert.deepEqual(roles.kindsOf(tagged('JUDGE')), ['judge']);
    assert.deepEqual(roles.kindsOf(tagged('Supervisor')), ['supervisor']);
});

test('a machine may be both a worker and a judge, one at a time', () => {
    const both = tagged('judge', 'worker');

    //MEMBERSHIP RATHER THAN EQUALITY: asking "is its kind judge" answered no for
    //a machine that judges perfectly well.
    assert.equal(roles.canBe(both, 'judge'), true);
    assert.equal(roles.canBe(both, 'worker'), true);
    assert.equal(roles.takesQueuedWork(both), true);

    //AND THERE IS NO SINGLE ANSWER, so nothing is offered one to compare against.
    assert.equal(roles.kindOf(both), null);
    assert.equal(roles.kindSaid(both), 'worker+judge');
});

test('a supervisor is only ever a supervisor, even carrying the other tags', () => {
    const confused = tagged('worker', 'judge', 'supervisor');

    //OF THE TWO WRONG ANSWERS, "this is the machine that decides" is the one
    //that refuses more, and when a record is confused the safe reading wins.
    assert.deepEqual(roles.kindsOf(confused), ['supervisor']);
    assert.equal(roles.canBe(confused, 'worker'), false);
});

test('a judge is in the pool, and a worker is, and a supervisor is not', () => {
    //A JUDGEMENT IS QUEUED, DISPATCHED AND PUT AWAY EXACTLY AS A TASK IS, so a
    //judge is not out of the pool — it is a DIFFERENT pool. Asked one machine at
    //a time, because a machine tagged both would answer yes on either clause and
    //hide the loss of the other.
    assert.equal(roles.takesQueuedWork(tagged('judge')), true);
    assert.equal(roles.takesQueuedWork(tagged('worker')), true);

    //NOT A PREFERENCE. It decides what work to give; a machine that decides what
    //work to give should not also be given some.
    assert.equal(roles.takesQueuedWork(tagged('supervisor')), false);
});

test('an unrelated tag is free text and means nothing here', () => {
    //`test` IS THE DRILL POOL and composes with the rest — nothing here has to
    //know that combination exists.
    assert.deepEqual(roles.kindsOf(tagged('test')), []);
    assert.deepEqual(roles.kindsOf(tagged('test', 'judge')), ['judge']);
});

//---------------------------------------------------------------------------
//AND THE COPY THE QUEUE IS STILL CARRYING.
//
//`queue/policy.js` has its own kindsOf/canBe/kindSaid, ported with the queue
//before the machines came across. The queue is a READER of this fact and this
//registry is where the fact is written down, so the copy in the queue is on its
//way out — it goes when the queue's tick is wired to dispatch.
//
//UNTIL THEN THE TWO MUST AGREE, and this is what makes the duplication
//impossible to drift silently. Every combination, both modules, one table.
//---------------------------------------------------------------------------

test('the queue answers exactly what this registry answers, for every combination', () => {
    const ALL = ['worker', 'judge', 'supervisor', 'test'];
    const cases = [];

    //Every subset of the four, so nothing is left to a hand-picked example.
    for (let bits = 0; bits < 16; bits++) {
        cases.push(ALL.filter((_, i) => bits & (1 << i)));
    }

    for (const tags of cases) {
        const vm = { name: 'x', tags };
        const said = JSON.stringify(tags);

        assert.deepEqual(policy.kindsOf(vm), roles.kindsOf(vm), 'kindsOf ' + said);
        assert.equal(policy.kindSaid(vm), roles.kindSaid(vm), 'kindSaid ' + said);
        for (const role of ['worker', 'judge', 'supervisor']) {
            assert.equal(policy.canBe(vm, role), roles.canBe(vm, role),
                'canBe ' + role + ' ' + said);
        }
    }

    //INERTNESS: sixteen combinations, and the loop above ran all of them.
    assert.equal(cases.length, 16);
});

test('and the two agree on the tag strings themselves', () => {
    assert.equal(policy.SUPERVISOR, roles.SUPERVISOR);
    assert.equal(policy.JUDGE, roles.JUDGE);
    assert.equal(policy.WORKER, roles.WORKER);
});

//---------------------------------------------------------------------------
//AND WHAT THE RUNNERS PANE DRAWS OFF IT.
//
//"Kept back" is a control for the queue, and the queue takes worker or judge
//and nothing else. On anything else the badge warned about something that was
//never going to happen and the button offered to undo it — an offer that could
//not be kept, which the dialog underneath already had to apologise for in a
//second sentence. One sat on a DIY machine for two days.
//
//THE TWO CONDITIONS ARE NOT THE SAME ONE, and the difference is the whole
//reason this is worth a test: the BADGE is about whether the flag means
//anything, and the BUTTON is also about whether a flag that means nothing can
//still be cleared. Hiding the button on exactly the records carrying a stale
//flag is how a flag becomes permanent — this pane was the only way to clear
//the one that sat on ok-diy1.
//---------------------------------------------------------------------------

const shows = (v) => ({
    badge: v.forTasks === false && roles.takesQueuedWork(v),
    button: roles.takesQueuedWork(v) || v.forTasks === false
});

test('the queue control is drawn for machines the queue could take', () => {
    assert.deepEqual(shows({ tags: ['worker', 'judge'] }), { badge: false, button: true });
    assert.deepEqual(shows({ tags: ['worker'], forTasks: false }), { badge: true, button: true });
    assert.deepEqual(shows({ tags: ['judge'], forTasks: false }), { badge: true, button: true });

    //A MACHINE CAN BE BOTH, and then the keep-back is the only thing stopping
    //the queue rolling it back under somebody sitting in it.
    assert.deepEqual(shows({ tags: ['worker', 'diy'], forTasks: false }), { badge: true, button: true });
});

test('and not for machines it would leave alone anyway', () => {
    assert.deepEqual(shows({ tags: ['diy'] }), { badge: false, button: false });
    assert.deepEqual(shows({ tags: ['diy'], forTasks: true }), { badge: false, button: false });
    assert.deepEqual(shows({ tags: [] }), { badge: false, button: false });

    //A SUPERVISOR IS NOT IN THE POOL AT ALL: it decides what work to give, and
    //a machine that decides what work to give should not also be given some.
    assert.deepEqual(shows({ tags: ['supervisor'] }), { badge: false, button: false });
});

test('a stale flag can always be let go, whatever the machine is tagged', () => {
    //ok-diy1 CARRIED ONE FOR TWO DAYS. It is not reachable by the DIY lane
    //either: the give-back is guarded by a flag on the seat, and the seat was
    //gone. This button was the only way out, so it must not vanish precisely
    //when it is needed.
    assert.deepEqual(shows({ tags: ['diy'], forTasks: false }), { badge: false, button: true });
    assert.deepEqual(shows({ tags: [], forTasks: false }), { badge: false, button: true });
    assert.deepEqual(shows({ tags: ['supervisor'], forTasks: false }), { badge: false, button: true });
});
