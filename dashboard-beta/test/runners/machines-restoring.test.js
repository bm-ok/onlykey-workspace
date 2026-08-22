const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makeRestoring = require('../../src/app/runners/machines/restoring');

//---------------------------------------------------------------------------
//GOING BACK TO A SNAPSHOT.
//
//THE CLAIM WORTH THE MOST: what a machine may PUSH goes back with the disk. That
//permission is a standing one recorded on this host, and restoring to a point
//taken before any workspace existed leaves a machine whose registry still names
//a branch it no longer has a copy of. Nothing fails — it can put commits on it.
//
//AND THE SECOND: a snapshot this app did not take is not in the map, and that
//reads as `null` rather than as "leave it alone". Unknown means may-push-nothing,
//which is recoverable in one click; the other way round is not.
//
//AND THE THIRD: the borrow goes back too — unless this restore is what the
//borrow is FOR. A bring-up rolls back to make a machine clean for work that has
//not started, and the borrow is taken BEFORE that so the queue cannot take the
//machine while it boots. Without the exception, this deleted a borrow five
//seconds old.
//---------------------------------------------------------------------------

let said, vm, off, unlocked, dropped, restored, updated, snaps, order;

const VM = (over) => Object.assign({
    name: 'kit-1',
    branch: 'work/the-thing',
    snapshots: { base: null, 'after-setup': 'work/the-thing' }
}, over || {});

beforeEach(() => {
    said = [];
    order = [];
    dropped = [];
    restored = [];
    updated = [];
    off = true;
    unlocked = [];
    snaps = { current: 'base', all: ['base', 'after-setup'] };
    vm = VM();
});

function restoring(over) {
    return makeRestoring(Object.assign({
        ours: {
            get: () => vm,
            update: (n, patch) => updated.push({ n, patch })
        },
        vbox: {
            isOff: async () => off,
            waitUntilUnlocked: async (n) => unlocked.push(n),
            restoreSnapshot: async (n, title) => { order.push('restore'); restored.push({ n, title }); },
            snapshots: async () => snaps
        },
        busy: { during: async (n, what, fn) => { said.push('turn: ' + what); return await fn(); } },
        channel: { drop: (n, why) => { order.push('drop'); dropped.push({ n, why }); } },
        say: () => ({
            info: (t) => said.push(t), warn: (t) => said.push('WARN ' + t),
            bad: (t) => said.push('BAD ' + t), good: (t) => said.push('GOOD ' + t)
        }),
        now: () => '2026-08-22T13:00:00Z'
    }, over || {}));
}

const patched = () => (updated[0] || {}).patch || {};

//---- before anything is touched ----------------------------------------------

test('a running machine is refused, because VirtualBox will not do it', async () => {
    off = false;
    await assert.rejects(() => restoring().toSnapshot('kit-1', 'base'),
        /Shut the machine down first — VirtualBox will not restore a snapshot while it is running/);

    assert.deepEqual(restored, []);
    assert.deepEqual(dropped, [], 'it dropped the channel of a machine it did not touch');
});

test('powered off is not unlocked, and it waits for that too', async () => {
    //A RESTORE ISSUED INTO THAT WINDOW races the session VirtualBox is still
    //holding, and the machine it leaves behind boots to a black screen with
    //nothing logged.
    await restoring().toSnapshot('kit-1', 'base');

    assert.deepEqual(unlocked, ['kit-1']);
    assert.equal(said.indexOf('turn: being restored'), 0, 'it did not take a turn');
});

test('the channel is dropped BEFORE the disk changes, not after', async () => {
    //WHATEVER SESSION IS RECORDED describes something that will not exist in a
    //moment, and a machine whose power was pulled leaves one that looks healthy
    //for over a minute.
    //
    //THE ORDER IS THE CLAIM. Dropped afterwards, this is a race with however
    //long VirtualBox takes — and in that window commands are dispatched into a
    //socket whose disk has already gone. Asserting only that both happened is
    //not asserting anything: a sweep that swapped the two lines survived it.
    await restoring().toSnapshot('kit-1', 'base');

    assert.deepEqual(order, ['drop', 'restore']);
    assert.match(dropped[0].why, /was rolled back to a snapshot/);
});

//---- what a machine may push goes back with the disk ---------------------------

test('restoring to a point before any workspace takes the branch away', async () => {
    //A STANDING PERMISSION TO PUSH work that is no longer on the disk.
    await restoring().toSnapshot('kit-1', 'base');

    assert.strictEqual(patched().branch, null);
    assert.ok(said.some((l) => /is back at "base", which predates any workspace — it may push nothing/.test(l)),
        said.join(' | '));
});

test('and restoring to one taken on a branch puts that branch back', async () => {
    vm = VM({ branch: 'work/something-else' });
    await restoring().toSnapshot('kit-1', 'after-setup');

    assert.equal(patched().branch, 'work/the-thing');
    assert.ok(said.some((l) => /may now push work\/the-thing, not work\/something-else/.test(l)),
        said.join(' | '));
});

test('a snapshot this app did not take means may-push-nothing, not leave-it-alone', async () => {
    //ONE MADE IN VirtualBox DIRECTLY is not in the map. Unknown is recoverable
    //in one click; the other way round is a machine pushing to a branch it has
    //no copy of.
    await restoring().toSnapshot('kit-1', 'made-by-hand');

    assert.strictEqual(patched().branch, null);
});

test('and nothing is said when the branch did not change', async () => {
    //A LINE ABOUT IT EVERY TIME is a line nobody reads.
    vm = VM({ branch: 'work/the-thing' });
    await restoring().toSnapshot('kit-1', 'after-setup');

    assert.equal(said.filter((l) => /may now push|may push nothing/.test(l)).length, 0);
});

//---- the credential, which is derived rather than guessed -----------------------

test('the machine is recorded as holding no credential', async () => {
    //A MACHINE HOLDING ONE CANNOT BE SNAPSHOTTED AT ALL, so every snapshot that
    //exists was taken while it held nothing — restoring any of them lands on a
    //disk with no credential file.
    vm = VM({ holdsCredential: true, guest: 'a-worker' });
    await restoring().toSnapshot('kit-1', 'base');

    assert.equal(patched().holdsCredential, false);
});

test('and saying so is what stops it being refused every future snapshot', async () => {
    //THE REGISTRY WOULD GO ON CLAIMING IT HOLDS ONE FOR EVER — which refuses
    //every future snapshot and keeps it out of the queue as needing tidying when
    //it is already clean.
    vm = VM({ holdsCredential: true });
    await restoring().toSnapshot('kit-1', 'base');

    assert.equal('holdsCredential' in patched(), true, 'the flag was left as it was');
});

//---- and the moment its disk went back ------------------------------------------

test('when it last matched a snapshot is recorded, or it reads as changed for ever', async () => {
    //"HAS THIS MACHINE CHANGED SINCE ITS SNAPSHOT" is answered by asking whether
    //it has dialled in since — right, until a restore, after which the old
    //dial-in is still later than when the snapshot was TAKEN.
    await restoring().toSnapshot('kit-1', 'base');
    assert.equal(patched().cleanSince, '2026-08-22T13:00:00Z');
});

//---- and the borrow ---------------------------------------------------------------

test('a borrow goes back with the disk, because the work it named is behind it', async () => {
    //EVERY OTHER FIELD SAYS THE MACHINE IS FREE, and the borrow alone kept it
    //out of the pool, naming work that is not there.
    vm = VM({ borrowed: { why: 'working on inspection/check1 in a terminal' } });

    await restoring().toSnapshot('kit-1', 'base');

    assert.strictEqual(patched().borrowed, null);
    assert.ok(said.some((l) => /no longer borrowed — it was "working on inspection\/check1 in a terminal", and the disk it was taken for has gone back/.test(l)),
        said.join(' | '));
});

test('unless the restore is what makes the machine ready for the borrow', async () => {
    //THE BORROW IS TAKEN BEFORE THE BRING-UP, deliberately, so the queue cannot
    //take the machine while it boots. Without this the borrow was deleted five
    //seconds after it was made.
    vm = VM({ borrowed: { why: 'a drill proving a machine comes up and goes away' } });

    await restoring().toSnapshot('kit-1', 'base', { keepBorrow: true });

    assert.equal('borrowed' in patched(), false, 'it cleared a borrow it was told to keep');
    assert.equal(said.filter((l) => /no longer borrowed/.test(l)).length, 0);
});

test('and keepBorrow is what somebody typed as well as what somebody meant', async () => {
    //THE COMMAND LINE HANDS STRINGS. Read as false it deletes the borrow the
    //caller is relying on.
    const r = restoring();
    assert.equal(r.serving(true), true);
    assert.equal(r.serving('true'), true);
    assert.equal(r.serving(false), false);
    assert.equal(r.serving('false'), false);
    assert.equal(r.serving(undefined), false);
});

test('a machine that was not borrowed says nothing about borrows either way', async () => {
    await restoring().toSnapshot('kit-1', 'base');
    assert.equal(said.filter((l) => /borrowed/.test(l)).length, 0);
});

//---- and what it answers with -------------------------------------------------------

test('the snapshots as they are now, and what it may push', async () => {
    const out = await restoring().toSnapshot('kit-1', 'after-setup');

    assert.equal(out.current, 'base');
    assert.deepEqual(out.all, ['base', 'after-setup']);
    assert.equal(out.branch, 'work/the-thing');
});

test('a machine this app did not make never reaches the disk', async () => {
    const r = restoring({
        ours: {
            get: () => { throw new Error('"x" is not a virtual machine this app made.'); },
            update: () => {}
        }
    });

    await assert.rejects(() => r.toSnapshot('x', 'base'), /not a virtual machine this app made/);
    assert.deepEqual(restored, []);
    assert.deepEqual(dropped, []);
});
