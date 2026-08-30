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
        created: 'when', baseSnapshot: null, reported: null, branch: null,
        //WHICH WORKSPACE MADE IT. `null` is a real state and not a default: it
        //is what every machine written down before this field existed carries,
        //and guessing a workspace for those is the mistake the field exists to
        //stop. The register itself is per workspace now — see
        //../../src/app/vms/ours/server.js — so this is the record saying so
        //about itself rather than the only thing that decides.
        workspace: null,

        //AND WHETHER ITS DISK IS STILL THE ONE IT WAS BUILT WITH. `null` is the
        //honest answer for a machine nothing has been done to yet, and it is
        //also what every record written before this field carries — which is why
        //`dirty` reads no stamps as CLEAN rather than as unknown.
        dirtySince: null
    });
    assert.ok('branch' in vm && 'baseSnapshot' in vm && 'reported' in vm && 'workspace' in vm);
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

//---- whether its disk is still the one it was built with --------------------
//
//`cleanSince` WAS ALREADY STAMPED AND NOTHING READ IT. ../../src/app/runners/
//machines/restoring.js writes it on a rollback and snapshotting.js writes it
//when a snapshot is taken — the two moments a disk becomes a snapshot again —
//and no line anywhere asked. Half a fact, kept honestly, for nobody.
//
//TWO STAMPS COMPARED, RATHER THAN A FLAG. A boolean has to be set right by every
//path that changes a disk and cleared right by every path that restores one, and
//the first place either is missed it lies quietly and for ever. Two timestamps
//cannot get out of order: whichever happened last is the answer.
//
//WHY THE APP NEEDS THE WORD AT ALL. The queue always rolls a machine back when
//it finishes, so a worker is never left in this state and nothing had to name
//it. A person's seat is different — they stop for the night with an afternoon's
//work on the disk — and "asleep with my work on it" against "back at base" is
//the difference between waking a machine and starting again.

const { dirty } = require('../../src/app/vms/ours/records');

test('a machine nothing has been done to is clean', () => {
    assert.equal(dirty({ name: 'r1' }), false);
    assert.equal(dirty({ name: 'r1', dirtySince: null, cleanSince: null }), false);
});

test('and a record from before either stamp existed is clean, not unknown', () => {
    //THE ALTERNATIVE IS EVERY MACHINE THIS HOST HAS EVER MADE suddenly reading
    //dirty and offering somebody a rollback they did not ask for.
    assert.equal(dirty({ name: 'r1', spec: {}, branch: 'some/branch' }), false);
});

test('changing its disk makes it dirty', () => {
    assert.equal(dirty({ dirtySince: '2026-08-30T15:39:41Z' }), true);
});

test('and a rollback since then makes it clean again', () => {
    assert.equal(dirty({ dirtySince: '2026-08-30T15:39:41Z', cleanSince: '2026-08-30T17:10:00Z' }), false);
});

test('but a rollback BEFORE it was dirtied does not', () => {
    //THE ORDERING IS THE WHOLE MECHANISM. A machine rolled back this morning and
    //worked on this afternoon is dirty, and a flag that was only ever cleared by
    //the rollback would say otherwise.
    assert.equal(dirty({ cleanSince: '2026-08-30T09:00:00Z', dirtySince: '2026-08-30T15:39:41Z' }), true);
});

test('dirtied with no clean point at all is dirty', () => {
    //A MACHINE THAT HAS NEVER HAD A SNAPSHOT TAKEN. There is nowhere to go back
    //to, and saying "clean" about it would be saying the disk matches something
    //that does not exist.
    assert.equal(dirty({ dirtySince: '2026-08-30T15:39:41Z', cleanSince: null }), true);
});

test('a machine being built is not dirty, it is being built', () => {
    //ITS DISK IS NOT SUPPOSED TO MATCH A SNAPSHOT YET, and there is no snapshot
    //to go back to — so offering to clean it is offering to throw away an
    //install that is still running. ../../src/app/vms/ours/records.js `stageOf`
    //makes the same distinction and had a guard go dead for missing it.
    assert.equal(dirty({ installing: true, dirtySince: '2026-08-30T15:39:41Z' }), false);
});

test('and nothing here needs a machine, a disk, or VirtualBox to answer', () => {
    //INERTNESS: it is two fields and a comparison. That is what lets every case
    //above be asked without a guest.
    assert.equal(dirty(null), false);
    assert.equal(dirty(undefined), false);
});
