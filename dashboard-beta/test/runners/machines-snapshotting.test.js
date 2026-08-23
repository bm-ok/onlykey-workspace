const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', 'src', 'app');
const makeSnapshotting = require(path.join(APP, 'runners', 'machines', 'snapshotting.js'));
const { everyName, recordFor } = makeSnapshotting;

//---------------------------------------------------------------------------
//WHETHER A SNAPSHOT MAY BE TAKEN.
//
//THE CLAIM WORTH THE MOST: a snapshot of a machine holding a worker credential
//keeps an unsealed copy of that credential for as long as the snapshot exists —
//and a snapshot is the thing this app keeps deliberately, rolls back to, and
//copies when it clones. Handing a credential to a machine and taking it back is
//the whole arrangement; a snapshot taken in between makes the taking-back a lie.
//---------------------------------------------------------------------------

function snapshottingWith(opts) {
    const o = opts || {};
    const asked = { snapshots: 0, off: 0 };
    return {
        asked,
        it: makeSnapshotting({
            ours: { read: () => o.register || [{ name: 'kit-1' }] },
            snapshotsOf: async () => { asked.snapshots++; return { snapshots: o.tree || [] }; },
            isOff: async () => { asked.off++; return o.off !== false; }
        })
    };
}

//---------------------------------------------------------------------------
//1. A TITLE THAT MEANS SOMETHING.
//---------------------------------------------------------------------------

test('a snapshot with no title is refused', () => {
    const { it } = snapshottingWith({});
    for (const nothing of [undefined, null, '', '   ']) {
        assert.throws(() => it.titleFor(nothing), /Give the snapshot a title/);
    }
});

test('a title is trimmed, so two that look the same are the same', () => {
    const { it } = snapshottingWith({});
    assert.equal(it.titleFor('  before the change  '), 'before the change');
});

//---------------------------------------------------------------------------
//2. A NAME ALREADY TAKEN, ANYWHERE IN THE TREE.
//---------------------------------------------------------------------------

test('a snapshot tree is walked all the way down, not just its top level', () => {
    //VirtualBox NESTS snapshots under the one they were taken from. A name three
    //levels down is just as taken as one at the top — so a check that reads only
    //the first level passes on exactly the collision it was written for.
    const tree = [
        { name: 'base', children: [
            { name: 'after provisioning', children: [
                { name: 'deep one' }
            ] }
        ] }
    ];
    assert.deepEqual(everyName(tree).sort(), ['after provisioning', 'base', 'deep one']);
});

test('a name already in the tree is refused, and says what to do instead', () => {
    //VirtualBox WOULD allow a second, and then restoring by that name is a coin
    //toss between them.
    const { it } = snapshottingWith({ tree: [{ name: 'base', children: [{ name: 'deep one' }] }] });

    return Promise.all([
        assert.rejects(() => it.refuseIfTaken('kit-1', 'base'), /already has a snapshot called "base"/),
        assert.rejects(() => it.refuseIfTaken('kit-1', 'deep one'), /coin toss between them/)
    ]);
});

test('the comparison ignores case and spacing, because VirtualBox does not', () => {
    //Two snapshots called `Base` and `base ` are two snapshots, and restoring by
    //name then picks one of them without saying which.
    const { it } = snapshottingWith({ tree: [{ name: 'Base' }] });
    return assert.rejects(() => it.refuseIfTaken('kit-1', '  base  '), /already has a snapshot/);
});

test('a free name passes, and an empty tree is not a collision', async () => {
    const { it } = snapshottingWith({ tree: [{ name: 'base' }] });
    await assert.doesNotReject(() => it.refuseIfTaken('kit-1', 'something else'));

    const { it: bare } = snapshottingWith({ tree: [] });
    await assert.doesNotReject(() => bare.refuseIfTaken('kit-1', 'anything'));
});

test('a tree with rubbish in it does not throw', () => {
    //It came from VirtualBox, which is not this app's to assume the shape of.
    assert.deepEqual(everyName(null), []);
    assert.deepEqual(everyName([null, undefined, {}]), ['']);
});

//---------------------------------------------------------------------------
//3. NOT WHILE IT IS RUNNING.
//---------------------------------------------------------------------------

test('a running machine is refused, because the snapshot would store its memory', () => {
    const { it } = snapshottingWith({ off: false });
    return assert.rejects(() => it.refuseIfRunning('kit-1'),
        /Shut the machine down first.*stores its memory too/s);
});

test('and the refusal names the button that does it for you', () => {
    const { it } = snapshottingWith({ off: false });
    return assert.rejects(() => it.refuseIfRunning('kit-1'), /Make a clean starting point/);
});

//---------------------------------------------------------------------------
//4. NOT WHILE IT HOLDS A SIGN-IN. THE ONE THAT MATTERS.
//---------------------------------------------------------------------------

test('a machine holding a credential is refused, and told how to give it back', () => {
    const { it } = snapshottingWith({ register: [{ name: 'kit-1', holdsCredential: true }] });
    assert.throws(() => it.refuseIfItHoldsASignIn('kit-1'),
        /holding a worker credential.*as long as the snapshot exists.*vmCredentialsForget --name kit-1/s);
});

test('a machine not holding one passes', () => {
    const { it } = snapshottingWith({ register: [{ name: 'kit-1', holdsCredential: false }] });
    assert.doesNotThrow(() => it.refuseIfItHoldsASignIn('kit-1'));
});

test('another machine holding one does not stop this one', () => {
    const { it } = snapshottingWith({
        register: [{ name: 'kit-2', holdsCredential: true }, { name: 'kit-1' }]
    });
    assert.doesNotThrow(() => it.refuseIfItHoldsASignIn('kit-1'));
});

//---------------------------------------------------------------------------
//5. THE ORDER, WHICH IS ABOUT WHAT IT COSTS TO BE TOLD.
//---------------------------------------------------------------------------

test('the credential refusal comes before anything is asked of VirtualBox', async () => {
    //It is the refusal with a real consequence, and it is free to check.
    const { it, asked } = snapshottingWith({ register: [{ name: 'kit-1', holdsCredential: true }] });
    await assert.rejects(() => it.mayTake('kit-1', 'a title'), /holding a worker credential/);
    assert.equal(asked.snapshots, 0);
    assert.equal(asked.off, 0);
});

test('a missing title is answered before the machine is asked anything at all', async () => {
    //Otherwise somebody is told "shut it down first", shuts it down, and is then
    //told they forgot a title.
    const { it, asked } = snapshottingWith({ off: false });
    await assert.rejects(() => it.mayTake('kit-1', ''), /Give the snapshot a title/);
    assert.equal(asked.off, 0);
});

test('everything allowed hands back the trimmed title', async () => {
    const { it } = snapshottingWith({ tree: [{ name: 'base' }] });
    assert.equal(await it.mayTake('kit-1', '  after the fix  '), 'after the fix');
});

//---------------------------------------------------------------------------
//6. WHAT THE REGISTER LEARNS.
//---------------------------------------------------------------------------

const WHEN = Date.parse('2026-08-23T04:05:06Z');

test('the first snapshot becomes where the machine goes back to', () => {
    const out = recordFor({ name: 'kit-1' }, 'base', WHEN);
    assert.equal(out.baseSnapshot, 'base');
});

test('and a later one does NOT move it', () => {
    //A base is where a machine goes back to; a later snapshot is a point along
    //the way. Moving it makes "roll it back" mean somewhere else with nothing
    //saying so.
    const out = recordFor({ name: 'kit-1', baseSnapshot: 'base' }, 'after the fix', WHEN);
    assert.equal(out.baseSnapshot, 'base');
});

test('a snapshot remembers which branch the machine was on when it was taken', () => {
    const out = recordFor({ baseSnapshot: 'base', branch: 'fix/the-thing' }, 'after the fix', WHEN);
    assert.equal(out.snapshots['after the fix'], 'fix/the-thing');
});

test('and one taken on no branch records that, rather than nothing', () => {
    const out = recordFor({ baseSnapshot: 'base' }, 'idle', WHEN);
    assert.ok('idle' in out.snapshots, 'the snapshot was not recorded at all');
    assert.equal(out.snapshots.idle, null);
});

test('what was already recorded survives a new one', () => {
    const out = recordFor({ baseSnapshot: 'base', snapshots: { base: 'main' } }, 'second', WHEN);
    assert.equal(out.snapshots.base, 'main');
    assert.equal(out.snapshots.second, null);
});

test('the disk is stamped clean, because taking one is the other way that becomes true', () => {
    //The machine did not move; the snapshot came to it, and there is now nothing
    //beyond the newest one. vmSnapshotRestore reads this.
    const out = recordFor({ baseSnapshot: 'base' }, 'second', WHEN);
    assert.equal(out.cleanSince, '2026-08-23T04:05:06.000Z');
});
