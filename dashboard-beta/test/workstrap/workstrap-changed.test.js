const { test } = require('node:test');
const assert = require('node:assert');

const changed = require('../../src/app/workstrap/changed');

//---------------------------------------------------------------------------
//A STALE COPY IS NOT AN EDIT.
//
//THE QUESTION THAT PRODUCED THIS FILE, asked before it was built: if a machine
//improves the notes and my DIY seat is still holding the old ones, will it try
//to revert them?
//
//IT WOULD HAVE. The obvious check — does the machine's copy differ from the
//host's — is true both when somebody wrote three paragraphs and when a seat
//booted this morning and touched nothing. One of those is the feature and the
//other is a proposal to undo everything approved since that machine started.
//
//SO EVERY TEST HERE IS ABOUT THE DIFFERENCE BETWEEN THOSE TWO.
//---------------------------------------------------------------------------

const V1 = '# This workspace\n\nrun the tests with make check\n';
const V2 = V1 + '\nand the emulator needs 4G\n';
const V3 = V1 + '\nbuilt with vite, not gulp\n';

test('a seat holding an old copy has changed nothing, however far the host has moved', () => {
    //THE CASE THAT WAS ASKED ABOUT. Booted with V1, touched nothing; a judge
    //improved the notes to V2 in the meantime. The machine and the host now
    //differ — and the honest answer is that this machine did nothing.
    const said = changed.changedOf({ base: V1, host: V2, guest: V1 });

    assert.equal(said.is, 'untouched');
    assert.equal(changed.worthKeeping(said.is), false,
        'a machine holding the copy it booted with was treated as having edited it');
});

test('and an edit on top of what the host still has is a plain change', () => {
    const said = changed.changedOf({ base: V1, host: V1, guest: V2 });

    assert.equal(said.is, 'changed');
    assert.equal(changed.worthKeeping(said.is), true);
});

test('an edit on top of something the host has moved on from is a fork, not a revert', () => {
    //BOTH SIDES MOVED. The machine wrote V3 on top of V1; the host is at V2
    //because something else was approved while that machine was running.
    //
    //APPLYING EITHER ONE DROPS THE OTHER, silently, and neither is wrong — so
    //this is the one answer that must never resolve itself. It is still a real
    //edit and still worth keeping; it just cannot land without somebody looking
    //at both.
    const said = changed.changedOf({ base: V1, host: V2, guest: V3 });

    assert.equal(said.is, 'forked');
    assert.equal(changed.worthKeeping(said.is), true,
        'a fork was thrown away rather than kept for a person');
    assert.match(said.why, /drop the other/);
});

test('with no record of what a machine was given, nothing is proposed', () => {
    //THE CHECK THAT COULD NOT RUN. Without a base, "edited" and "booted with an
    //older copy" are the same observation — so this says so and proposes
    //nothing, which is the direction that costs a press rather than somebody's
    //work.
    const said = changed.changedOf({ base: null, host: V2, guest: V1 });

    assert.equal(said.is, 'no base');
    assert.equal(changed.worthKeeping(said.is), false);
});

test('an empty or missing file is not a deletion', () => {
    //A MACHINE THAT NEVER RECEIVED THE NOTES looks exactly like one that
    //deleted them, and removing a workspace's notes is not something to infer
    //from an absence — particularly on a boot where the fetch simply failed,
    //which the boot script treats as "carry on without them".
    for (const guest of [null, '', '   \n']) {
        const said = changed.changedOf({ base: V1, host: V1, guest: guest });
        assert.equal(said.is, 'nothing', 'an empty file read as ' + said.is);
        assert.equal(changed.worthKeeping(said.is), false);
    }
});

test('the hash is of the content, and nothing else', () => {
    //NOT A LENGTH AND NOT A TIMESTAMP. Two edits of the same size are ordinary
    //— correcting a word, swapping one command for another — and a guest's
    //mtime is whatever that machine's clock says, which is not this host's.
    assert.equal(changed.hashOf('a'), changed.hashOf('a'));
    assert.notEqual(changed.hashOf('a'), changed.hashOf('b'));

    //SAME LENGTH, DIFFERENT CONTENT: the case a size check calls unchanged.
    assert.notEqual(changed.hashOf('make check'), changed.hashOf('make build'));

    assert.equal(changed.hashOf(null), null);
});

test('every answer says which it is, and only two are ever kept', () => {
    //THE LIST IS CLOSED, so a new answer cannot be added without deciding here
    //whether it is something a person should see. Both kept answers are real
    //edits; the difference between them is only whether one could ever land on
    //its own.
    const all = [
        changed.changedOf({ base: V1, host: V1, guest: V1 }).is,
        changed.changedOf({ base: V1, host: V1, guest: V2 }).is,
        changed.changedOf({ base: V1, host: V2, guest: V3 }).is,
        changed.changedOf({ base: null, host: V1, guest: V2 }).is,
        changed.changedOf({ base: V1, host: V1, guest: '' }).is
    ];

    assert.deepEqual(all, ['untouched', 'changed', 'forked', 'no base', 'nothing']);
    assert.deepEqual(all.filter(changed.worthKeeping), ['changed', 'forked']);
});
