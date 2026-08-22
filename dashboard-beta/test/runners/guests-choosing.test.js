const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makeChoosing = require('../../src/app/runners/guests/choosing');

//---------------------------------------------------------------------------
//WHICH SIGN-IN A MACHINE IS ABOUT TO BE HANDED.
//
//THE CLAIM WORTH THE MOST: the WORK decides the kind, not the box. A machine
//tagged worker AND judge is two things, and "what kind is this machine" then has
//no answer — it resolved to whichever tag was checked first, so a dual machine
//would have been handed a judge's credential for a task.
//
//AND THE SECOND: the thing that CHOOSES has to know the rule the lending
//enforces. This picked any free non-supervisor sign-in, so the first judgement
//dispatched to a judge machine was offered a worker's identity and then refused
//it, minutes in, for a reason that reads like a bug. The refusal was right and
//the selection had never been taught.
//
//AND THE THIRD: "every one is dead", "there is none of that kind" and "they are
//all out" are three different sentences, and only one of them fixes itself.
//---------------------------------------------------------------------------

let held;

const G = (over) => Object.assign({ name: 'w1', role: 'worker', has: true, holder: null }, over || {});
const VM = (over) => Object.assign({ name: 'kit-1', tags: ['worker'] }, over || {});

beforeEach(() => { held = [G()]; });

const choosing = () => makeChoosing({
    all: () => held,
    kindsOf: (vm) => ((vm && vm.tags) || []).map(String)
});

const pick = (vm, role) => choosing().forMachine((vm || VM()).name, vm || VM(), role);

//---- which KIND, and who decides ---------------------------------------------

test('a machine with one role does not have to be told', () => {
    //ONE WITH ONE ROLE IS NOT MADE HARDER TO USE by a feature for machines with
    //two.
    assert.equal(pick(VM({ tags: ['worker'] })).role, 'worker');
});

test('a machine tagged as two is refused by name, not given a coin-flip', () => {
    //"WHAT KIND IS THIS MACHINE" HAS NO ANSWER for a dual machine, and the
    //version this comes from resolved it to whichever tag was checked first.
    assert.throws(() => pick(VM({ tags: ['worker', 'judge'] })),
        /is tagged worker and judge, so which sign-in it should be handed depends on the work/);
    assert.throws(() => pick(VM({ tags: ['worker', 'judge'] })),
        /Say which with --role worker or --role judge/);
});

test('and the work saying so settles it', () => {
    held = [G({ name: 'j1', role: 'judge' })];
    assert.equal(pick(VM({ tags: ['worker', 'judge'] }), 'judge').name, 'j1');
});

test('a role the machine cannot hold is refused, with what would fix it', () => {
    assert.throws(() => pick(VM({ tags: ['worker'] }), 'judge'),
        /cannot hold a judge's sign-in: it is tagged worker/);
    assert.throws(() => pick(VM({ tags: ['worker'] }), 'judge'),
        /Give it the "judge" tag with vmTags, or send this work to a machine that has it/);
});

test('and a machine that has said nothing has no sign-in to be given', () => {
    //NO TAG IS NOT A DEFAULT. Picking one means guessing whose identity to put
    //on a machine.
    assert.throws(() => pick(VM({ tags: [] })),
        /has not been told what it is for, so there is no sign-in to give it/);
    assert.throws(() => pick(VM({ tags: [] }), 'worker'),
        /cannot hold a worker's sign-in: it is not tagged for any role/);
});

test('a role nothing recognises is read as nobody having said', () => {
    assert.equal(pick(VM({ tags: ['worker'] }), 'admin').role, 'worker');
    assert.throws(() => pick(VM({ tags: ['worker', 'judge'] }), 'admin'), /Say which with --role/);
});

//---- and which ONE of that kind ------------------------------------------------

test('a sign-in of the right kind, present and free', () => {
    held = [
        G({ name: 'j1', role: 'judge' }),
        G({ name: 'w1' }),
        G({ name: 'w2' })
    ];
    assert.equal(pick(VM({ tags: ['worker'] })).name, 'w1');
});

test('and never one of the wrong kind, which is what the lending would refuse', () => {
    //REFUSING IS WORTH NOTHING if the thing that CHOOSES does not know the rule.
    held = [G({ name: 'w1', role: 'worker' })];

    assert.throws(() => pick(VM({ tags: ['judge'] })),
        /this host holds no judge sign-in/);
});

test('the one this machine already has comes back to it', () => {
    //RE-PLACING A CREDENTIAL a machine is already signed in with is not a new
    //loan, and refusing it would make a retry impossible.
    held = [G({ name: 'w1', holder: 'kit-9' }), G({ name: 'w2' })];
    assert.equal(pick(VM({ guest: 'w1' })).name, 'w1');
});

test('and it comes back even if it has failed, because a retry is the point', () => {
    held = [G({ name: 'w1', lastCheck: { ready: false, on: 'kit-1' } })];
    assert.equal(pick(VM({ guest: 'w1' })).name, 'w1');
});

test('one already out on another machine is not offered', () => {
    held = [G({ name: 'w1', holder: 'kit-9' }), G({ name: 'w2' })];
    assert.equal(pick(VM()).name, 'w2');
});

test('but one out on THIS machine is', () => {
    held = [G({ name: 'w1', holder: 'kit-1' })];
    assert.equal(pick(VM()).name, 'w1');
});

test('one whose file is gone is not offered', () => {
    held = [G({ name: 'w1', has: false }), G({ name: 'w2' })];
    assert.equal(pick(VM()).name, 'w2');
});

//---- one that has already failed is not offered again ----------------------------

test('a paused sign-in is passed over, so one dead one cannot starve a host', () => {
    //IT IS PICKED FIRST if it happens to be first in the list.
    held = [G({ name: 'w1', lastCheck: { ready: false } }), G({ name: 'w2' })];
    assert.equal(pick(VM()).name, 'w2');
});

//---- and the three sentences, which are three different situations -----------------

test('every one of them dead is said, and is marked so the queue can tell', () => {
    //NOTHING IS OUT, THEY ARE DEAD, and waiting will not help.
    held = [
        G({ name: 'w1', lastCheck: { ready: false, on: 'kit-9', at: '2026-08-22T13:00:00Z' } }),
        G({ name: 'w2', lastCheck: { ready: false, on: 'kit-8' } })
    ];

    let thrown = null;
    try { pick(VM()); } catch (e) { thrown = e; }

    assert.ok(thrown);
    assert.match(thrown.message, /Every worker sign-in this host holds has already failed on a machine/);
    assert.match(thrown.message, /"w1" \(kit-9 could not authenticate with it, 2026-08-22 13:00\)/);
    assert.match(thrown.message, /"w2" \(kit-8 could not authenticate with it\)/);
    assert.match(thrown.message, /paused rather than thrown away/);

    //READ AS A FLAG rather than by matching the sentence, because a sentence is
    //written for a person and gets rewritten for one. ../../src/app/queue/tick
    //puts a task back in the queue on this rather than marking it done.
    assert.equal(thrown.noIdentity, true);
});

test('and none of that kind at all is a different sentence, with a different fix', () => {
    //NOTHING IS OUT, THERE SIMPLY IS NOT ONE, and the thing to do is add one
    //rather than wait.
    held = [G({ name: 'w1' })];

    let thrown = null;
    try { pick(VM({ tags: ['judge'] })); } catch (e) { thrown = e; }

    assert.match(thrown.message, /is a judge machine and this host holds no judge sign-in/);
    assert.match(thrown.message, /reading a change and writing one on separate accounts/);
    assert.match(thrown.message, /Add one on the Runners tab, or change what this machine is for/);

    //AND IT IS NOT THE ONE THE QUEUE RE-QUEUES ON. There is nothing to wait for,
    //so waiting is the wrong thing to do about it.
    assert.notEqual(thrown.noIdentity, true);
});

test('and every one being OUT is the third, which is the one that fixes itself', () => {
    held = [G({ name: 'w1', holder: 'kit-8' }), G({ name: 'w2', holder: 'kit-9' })];

    let thrown = null;
    try { pick(VM()); } catch (e) { thrown = e; }

    assert.match(thrown.message, /Every worker sign-in is out on another machine: w1 on kit-8, w2 on kit-9/);
    assert.match(thrown.message, /rotating the same token underneath each other/);
    assert.notEqual(thrown.noIdentity, true);
});

test('the three do not get confused when a host has one of each', () => {
    //THE ORDER THE CASES ARE ASKED IN. A host with one dead and one out is not a
    //host whose sign-ins have all failed.
    held = [G({ name: 'w1', lastCheck: { ready: false } }), G({ name: 'w2', holder: 'kit-9' })];

    let thrown = null;
    try { pick(VM()); } catch (e) { thrown = e; }

    assert.match(thrown.message, /out on another machine: w2 on kit-9/);
    assert.notEqual(thrown.noIdentity, true, 'a host with a working sign-in out was reported as having none');
});

test('and a supervisor sign-in is never chosen for a runner', () => {
    //ONE IS THE SIGN-IN THIS HOST DECIDES WORK WITH, and a machine holding it
    //would be a worker able to spend the identity that supervises workers.
    held = [G({ name: 'sup', role: 'supervisor' })];
    assert.throws(() => pick(VM({ tags: ['worker'] })), /holds no worker sign-in/);
});
