const { test } = require('node:test');
const assert = require('node:assert');

const { whyNotOn, choosable, pausedFor, forQueue, kindsFrom } =
    require('../../src/app/runners/guests/lending');

//---------------------------------------------------------------------------
//WHICH SIGN-IN MAY GO TO WHICH MACHINE.
//
//THE CLAIM WORTH THE MOST: a supervisor sign-in is refused for BEING one, before
//anything about tags is asked. Letting the untagged branch answer first produced
//a refusal that was correct and gave dangerous advice — "give it the worker tag,
//and then this can go to it" — which is the one action that would put the
//identity deciding what workers do inside a worker.
//
//AND THE SECOND: membership, not equality. A machine tagged worker AND judge
//serves both; written as equality it silently resolved to whichever tag the
//reader checked first, and the other did nothing.
//
//AND THE THIRD: every refusal says what would fix it, except the one where
//nothing should.
//---------------------------------------------------------------------------

const G = (over) => Object.assign({ name: 'k1', role: 'worker', has: true, holder: null }, over || {});

//---- what the machine may be ------------------------------------------------

test('a machine can be more than one thing, and a string is still one thing', () => {
    assert.deepEqual(kindsFrom(['worker', 'judge']), ['worker', 'judge']);
    assert.deepEqual(kindsFrom('worker'), ['worker']);
    assert.deepEqual(kindsFrom(null), []);
    assert.deepEqual(kindsFrom([]), []);
    assert.deepEqual(kindsFrom([null, 'judge', undefined]), ['judge']);
});

//---- the ordinary cases ------------------------------------------------------

test('a worker sign-in goes to a runner', () => {
    assert.equal(whyNotOn('worker', 'worker', 'k1', 'kit-1'), null);
});

test('a judge sign-in goes to a judge machine', () => {
    assert.equal(whyNotOn('judge', 'judge', 'k1', 'kit-1'), null);
});

test('a supervisor sign-in goes to the supervisor machine', () => {
    assert.equal(whyNotOn('supervisor', 'supervisor', 'k1', 'sup-1'), null);
});

test('and a machine that is both takes either, one at a time', () => {
    //MEMBERSHIP, NOT EQUALITY. Written as equality a dual machine resolved to
    //whichever tag was checked first, and the other tag did nothing.
    assert.equal(whyNotOn('worker', ['worker', 'judge'], 'k1', 'kit-1'), null);
    assert.equal(whyNotOn('judge', ['worker', 'judge'], 'k1', 'kit-1'), null);
    assert.equal(whyNotOn('judge', ['judge', 'worker'], 'k1', 'kit-1'), null,
        'the answer depended on which tag came first');
});

//---- a supervisor sign-in, refused for being one -----------------------------

test('a supervisor sign-in is refused on a runner tagged worker, and no tag changes that', () => {
    const why = whyNotOn('supervisor', 'worker', 'k1', 'kit-1');

    assert.match(why, /"k1" is a supervisor sign-in and kit-1 is a runner tagged worker/);
    assert.match(why, /the identity that decides what workers do/);
    assert.match(why, /No tag changes this/);
});

test('and on an UNTAGGED machine it is still refused for being one', () => {
    //THE ONE THAT GAVE DANGEROUS ADVICE. Answered by the untagged branch, the
    //refusal invited the exact action that must not fix it.
    const why = whyNotOn('supervisor', null, 'k1', 'kit-1');

    assert.match(why, /No tag changes this/);
    assert.equal(/give it the "worker" tag/.test(why), false,
        'it told somebody to tag a machine so a supervisor sign-in could go to it');
    assert.match(why, /kit-1 is not tagged supervisor/);
});

test('and on a machine that does not exist, which is what caught it', () => {
    //THE SHAPE THAT ISOLATES WHICH REASON A REFUSAL IS FOR.
    const why = whyNotOn('supervisor', [], 'k1', 'no-such-machine');
    assert.match(why, /No tag changes this/);
});

test('a runner tagged judge is not one tagged supervisor either', () => {
    const why = whyNotOn('supervisor', 'judge', 'k1', 'kit-1');
    assert.match(why, /is a runner tagged judge/);
    assert.match(why, /No tag changes this/);
});

//---- a machine that has not said what it is ------------------------------------

test('an untagged machine gets nothing, and is told the words that fix it', () => {
    //NO TAG IS NOT A DEFAULT, it is an unanswered question. "Not allowed" about
    //a machine somebody just built is useless next to the fix.
    //
    //THREE TAGS NOW AND IT WAS TWO. `diy` is the person's own role — a runner
    //sign-in like the other two — so the sentence that lists what a machine can
    //be told it is has to list it, or it sends somebody to tag a machine
    //"worker" for a seat that must never be queued.
    const why = whyNotOn('worker', null, 'k1', 'kit-1');

    assert.match(why, /kit-1 has not been told what it is for/);
    assert.match(why, /give it the "worker", "judge" or "diy" tag with vmTags/);
    assert.match(why, /"k1" can go to it/);
});

test('and the same for a judge sign-in', () => {
    assert.match(whyNotOn('judge', [], 'k1', 'kit-1'), /has not been told what it is for/);
});

//---- and the mismatches that are just mismatches ---------------------------------

test('a worker sign-in is refused on a judge runner, because of what that costs', () => {
    //A RUNNER TAGGED JUDGE SIGNS IN AS ITSELF. This would hold one of the
    //identities the worker runners draw from, and bill that machine's work to a
    //worker.
    const why = whyNotOn('worker', 'judge', 'k1', 'kit-1');

    assert.match(why, /"k1" is a worker sign-in and kit-1 is a runner tagged judge/);
    assert.match(why, /bill that machine's work to a worker/);
});

test('and on one tagged supervisor, for the same reason said about a supervisor', () => {
    assert.match(whyNotOn('worker', 'supervisor', 'k1', 'sup-1'),
        /A runner tagged supervisor signs in as itself/);
});

test('a judge sign-in on a runner collapses the one distinction it exists for', () => {
    const why = whyNotOn('judge', 'worker', 'k1', 'kit-1');

    assert.match(why, /"k1" is a judge sign-in and kit-1 is a runner tagged worker/);
    assert.match(why, /reading a change and writing one are separate accounts/);
});

test('and an unrecognised role is treated as a worker, which is the least it could be', () => {
    //THE SAME DEFAULT ../shape USES, for the same reason: a record with a typo
    //in it must not reach a supervisor machine.
    assert.equal(whyNotOn('guest', 'worker', 'k1', 'kit-1'), null);
    assert.match(whyNotOn('admin', 'judge', 'k1', 'kit-1'), /is a worker sign-in/);
});

//---- which of a list could go out right now -----------------------------------------

test('one of the right role, present, not paused and not out', () => {
    const rows = [
        G({ name: 'a' }),
        G({ name: 'b', role: 'judge' }),
        G({ name: 'c', has: false }),
        G({ name: 'd', lastCheck: { ready: false } }),
        G({ name: 'e', holder: 'kit-9' })
    ];

    assert.deepEqual(choosable(rows, 'worker', null).map((g) => g.name), ['a']);
});

test('a machine already holding one is not refused its own', () => {
    //ASKING "WHAT IS FREE FOR kit-1" while kit-1 holds one should not report
    //that sign-in as taken by somebody else.
    const rows = [G({ name: 'a', holder: 'kit-1' })];

    assert.deepEqual(choosable(rows, 'worker', 'kit-1').map((g) => g.name), ['a']);
    assert.deepEqual(choosable(rows, 'worker', 'kit-2'), []);
    assert.deepEqual(choosable(rows, 'worker', null), []);
});

test('a sign-in whose file is gone is not free, whatever the record says', () => {
    //READ FROM THE FILE RATHER THAN TRUSTED FROM THE RECORD, so one removed by
    //hand says so instead of claiming a token.
    assert.deepEqual(choosable([G({ has: false })], 'worker', null), []);
});

test('and nothing at all is an empty list, not an error', () => {
    assert.deepEqual(choosable(null, 'worker', null), []);
    assert.deepEqual(choosable([], 'worker', null), []);
});

//---- and the ones that would be free but for having failed --------------------------

test('the paused ones are named, so a refusal can say WHICH to replace', () => {
    //"NO WORKER SIGN-IN IS FREE" AND "THE TWO YOU HAVE ARE BOTH PAUSED" want
    //different things done.
    const rows = [
        G({ name: 'a' }),
        G({ name: 'b', lastCheck: { ready: false } }),
        G({ name: 'c', lastCheck: { ready: false }, has: false }),
        G({ name: 'd', role: 'judge', lastCheck: { ready: false } })
    ];

    assert.deepEqual(pausedFor(rows, 'worker').map((g) => g.name), ['b']);
    assert.deepEqual(pausedFor(rows, 'judge').map((g) => g.name), ['d']);
});

test('and a paused one is never also free', () => {
    const rows = [G({ name: 'b', lastCheck: { ready: false } })];
    assert.deepEqual(choosable(rows, 'worker', null), []);
    assert.equal(pausedFor(rows, 'worker').length, 1);
});

//---- what the queue asks -------------------------------------------------------------

test('one answer, in the shape the queue plans with', () => {
    const rows = [
        G({ name: 'a' }),
        G({ name: 'b' }),
        G({ name: 'c', lastCheck: { ready: false } }),
        G({ name: 'd', role: 'judge' }),
        G({ name: 'sup', role: 'supervisor' })
    ];

    assert.deepEqual(forQueue(rows), {
        worker: { free: 2, paused: ['c'] },
        judge: { free: 1, paused: [] }
    });
});

test('and a supervisor sign-in is not in it, because it is never lent to a runner', () => {
    const said = forQueue([G({ name: 'sup', role: 'supervisor' })]);
    assert.deepEqual(Object.keys(said).sort(), ['judge', 'worker']);
    assert.equal(said.worker.free, 0);
});

test('a host holding nothing answers zero rather than nothing', () => {
    //THE QUEUE READS `.free` OFF THIS. An absent key would read as undefined and
    //`!undefined` is true, which is the right answer reached by luck.
    assert.deepEqual(forQueue([]), { worker: { free: 0, paused: [] }, judge: { free: 0, paused: [] } });
    assert.deepEqual(forQueue(null), { worker: { free: 0, paused: [] }, judge: { free: 0, paused: [] } });
});
