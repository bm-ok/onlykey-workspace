const { test } = require('node:test');
const assert = require('node:assert');

const { asRecorded, newRecord, stageOf, STAGES } = require('../../src/app/vms/ours/records');

//---------------------------------------------------------------------------
//what a record is, and where the machine it describes has got to.
//
//THE CLAIM WORTH THE MOST: a tag is read from ONE place. A machine made with
//tags once had them written into its spec, where nothing looked — so it came
//back carrying none, and the supervisor built with the box ticked was offered
//to the queue like any other runner.
//---------------------------------------------------------------------------

test('a new record carries the tags it was asked for, at the top', () => {
    const vm = newRecord({ name: 'sup1', tags: ['supervisor'], serial: 5001 }, 'when');

    //LIFTED OUT OF THE SPEC. Provisioning puts them there because that is where
    //what somebody asked for at creation goes; everything that reads one reads
    //the top.
    assert.deepEqual(vm.tags, ['supervisor']);
    assert.equal(vm.serial, 5001);
    //AND THE SPEC IS KEPT, because it is what the machine was built from.
    assert.deepEqual(vm.spec.tags, ['supervisor']);
});

test('and names every other field, rather than letting one appear later', () => {
    const vm = newRecord({ name: 'r1' }, 'when');

    //A MACHINE THAT HAS NEVER BEEN SET UP READS AS "not allowed yet" instead of
    //as a field somebody forgot. null branch means it may push nothing.
    //STRICT, because the field this matters most for is `branch` — and a loose
    //compare reads an absent field as the null that means "may push nothing".
    assert.deepStrictEqual(vm, {
        name: 'r1', spec: { name: 'r1' }, tags: [], serial: null,
        created: 'when', baseSnapshot: null, reported: null, branch: null
    });
    assert.ok('branch' in vm && 'baseSnapshot' in vm && 'reported' in vm);
});

//---- what an older record never wrote down ---------------------------------

test('an old record gets its tags filled in from the spec it was built from', () => {
    const old = { name: 'r1', spec: { name: 'r1', tags: ['judge'], serial: 5002 } };

    assert.deepEqual(asRecorded(old).tags, ['judge']);
    assert.equal(asRecorded(old).serial, 5002);
});

test('but a record that already has them is left exactly as it is', () => {
    const vm = { name: 'r1', tags: ['worker'], serial: 9, spec: { tags: ['judge'], serial: 1 } };

    //IDEMPOTENT, so nothing has to be migrated and the top always wins.
    assert.deepEqual(asRecorded(vm).tags, ['worker']);
    assert.equal(asRecorded(vm).serial, 9);
});

test('an empty tag list set on purpose is not a missing one', () => {
    const vm = { name: 'r1', tags: [], spec: { tags: ['supervisor'] } };

    //THE FIELD'S PRESENCE, NOT ITS TRUTH. Somebody took the tags off; putting
    //them back from the spec would make that impossible to do.
    assert.deepEqual(asRecorded(vm).tags, []);
});

test('and a serial deliberately set to null is not a missing one either', () => {
    assert.equal(asRecorded({ name: 'r1', serial: null, spec: { serial: 5001 } }).serial, null);
});

test('a record with neither is a record with nothing, not a failure', () => {
    const vm = asRecorded({ name: 'r1' });
    assert.deepEqual(vm.tags, []);
    assert.equal(vm.serial, null);
});

test('filling in does not change the record it was given', () => {
    const old = { name: 'r1', spec: { tags: ['judge'] } };
    asRecorded(old);

    //READ-TIME. Nothing on disk is rewritten by having been looked at.
    assert.equal(old.tags, undefined);
});

//---- where a machine has got to --------------------------------------------

test('a machine VirtualBox has never heard of is only defined', () => {
    //WE WROTE IT DOWN AND NOTHING ELSE IS TRUE OF IT. Reported as a stage
    //because "it is not working" has several very different causes.
    assert.equal(stageOf({ baseSnapshot: 'base', reported: 'yes' }, { live: false }), 'defined');
});

test('each stage in turn, and the later fact wins', () => {
    const at = (vm, seen) => stageOf(vm, Object.assign({ live: true }, seen));

    assert.equal(at({}), 'created');
    assert.equal(at({ installing: true }), 'installing');

    //---- EXCEPT `installing`, WHICH IS NOT AN EARLIER FACT ----------------
    //
    //This asserted `online`, on the reading that reporting happens after an
    //install begins. But `installing` is not a record of something that
    //happened — it is a flag CLEARED when the install ends, so while it is set
    //the install is happening NOW. And a machine reports throughout one: that
    //is what fills the live log. So the first line it said flipped this to
    //`online` and the install was never mentioned again.
    //
    //IT MADE A CORRECT GUARD UNREACHABLE. ../../src/app/ui/banners/trouble.js
    //filters idle machines with `v.stage !== 'installing'` and a comment saying
    //"it is being built" — so it told somebody to shut down a machine in the
    //middle of a twenty-five minute install.
    assert.equal(at({ installing: true, reported: 'x' }), 'installing');

    assert.equal(at({ reported: 'x', baseSnapshot: 'base' }), 'ready');
    assert.equal(at({ baseSnapshot: 'base' }, { connected: true }), 'connected');
});

test('a machine being built can be told from one that has finished', () => {
    //THE RULE THE BANNER DEPENDS ON, asserted as the banner asks it rather than
    //as a list of stages: whatever it is called, the two must not be the same
    //word. They were, for the whole of an install.
    const mid = stageOf({ installing: true, reported: 'x' }, { live: true, connected: false });
    const done = stageOf({ reported: 'x', baseSnapshot: 'base' }, { live: true, connected: false });

    assert.notEqual(mid, done, 'a machine mid-install reads the same as one that finished');
    assert.equal(mid, 'installing');
});

test('and an agent that is talking is past installing, whatever the flag says', () => {
    //THE ONE CASE WHERE THE NEWER FACT SHOULD WIN. A flag left set by an install
    //that ended badly must not make a machine that is up and answering look like
    //it is still being built.
    assert.equal(stageOf({ installing: true }, { live: true, connected: true }), 'connected');
});

test('connected beats everything, because it is the agent talking right now', () => {
    assert.equal(stageOf({}, { live: true, connected: true }), 'connected');
});

test('but a machine that is not there is not connected either', () => {
    //THE ORDER MATTERS: a stale channel entry for a machine VirtualBox no longer
    //has must not read as the healthiest stage there is.
    assert.equal(stageOf({}, { live: false, connected: true }), 'defined');
});

test('every stage it can answer is one of the ones it lists', () => {
    const seen = new Set();
    for (const live of [false, true]) {
        for (const connected of [false, true]) {
            for (const vm of [{}, { installing: true }, { reported: 'x' }, { baseSnapshot: 'b' }]) {
                seen.add(stageOf(vm, { live, connected }));
            }
        }
    }

    for (const stage of seen) assert.ok(STAGES.includes(stage), stage + ' is not in STAGES');
    //INERTNESS: the sweep above reached more than one of them.
    assert.ok(seen.size >= 5, [...seen].join(','));
});
