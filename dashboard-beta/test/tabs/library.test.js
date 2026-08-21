const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const statePlugin = require('../../src/app/core/state/main');
const makeLibrary = require('../../src/app/library/entries');

//---------------------------------------------------------------------------
//the library: what a worker is told, the rules it is held to, and the code that
//does the telling. Three kinds, one set of rules — these.
//
//EVERY CLAIM HERE IS ABOUT AN APPROVAL, which is a person saying they read this
//one. That is the gate between somebody writing an instruction and a machine
//being handed it, so it is worth being able to exercise without a machine.
//
//  * the approval is against a HASH OF THE BODY, so an edit is noticed rather
//    than trusted. A job approved in January must not be handed a rewritten
//    instruction in March with every tick still green
//  * and the CONTRACT is part of what was approved — changing which rules a
//    prompt runs under changes what somebody agreed to more than rewriting a
//    sentence does, because the words look identical afterwards
//  * written at the window is approved by whoever wrote it; written down the
//    pipe it waits, because a model may write one and may not ratify its own
//  * READING IT AND PRESSING SAVE IS THE APPROVAL, even unchanged. The bug this
//    is for cost an hour and made reading-then-approving impossible
//  * setting aside is harmless from anywhere; BRINGING ONE BACK over the wire
//    costs its approval, or the gate has a door beside it
//---------------------------------------------------------------------------

let prompts, jobs, code;

beforeEach(async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-lib-'));

    let state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dataDir, ...p) } }, async (_e, s) => { state = s.state; });

    prompts = makeLibrary('prompt', () => state.app.doc('prompts'), {
        writes: ['text', 'contractId'],
        //THE CONTRACT IS PART OF WHAT WAS APPROVED.
        approvedWith: ['contractId'],
        needsBody: 'Write the prompt. An empty one would be handed to a worker as an empty instruction.'
    });

    //A JOB'S BODY IS ITS CODE, WHICH LIVES ON DISK rather than in the record —
    //so the same rules are exercised against a body the store does not hold.
    code = {};
    jobs = makeLibrary('job', () => state.app.doc('jobs'), {
        writes: ['promptId'],
        bodyOf: (e) => code[e.id] || '',
        approvedWith: ['promptId']
    });
});

const aPrompt = (extra) => Object.assign({
    name: 'read the readme', text: 'read the README against the code'
}, extra || {});

//---------------------------------------------------------------------------
//AN APPROVAL IS AGAINST THE WORDS.
//---------------------------------------------------------------------------

test('writing one at the window approves it, because writing it there is the reading', async () => {
    const made = await prompts.save(aPrompt());

    assert.equal(made.created, true);
    assert.equal(made.id, 'read-the-readme');
    assert.equal(made.approved, true);
    assert.equal(made.approvedBy, 'the window');
    assert.equal(made.lapsed, false);
});

test('writing one down the pipe does not, because a model may not ratify its own', async () => {
    const made = await prompts.save(aPrompt(), 'the command line');

    assert.equal(made.approved, false);
    assert.equal(made.approval, null);
    assert.equal(made.lapsed, false, 'never read is not the same as read and then changed');
});

test('editing the words down the pipe lapses the approval', async () => {
    await prompts.save(aPrompt());
    const now = await prompts.save(aPrompt({ id: 'read-the-readme', text: 'do something else entirely' }), 'the command line');

    assert.equal(now.approved, false);
    //A job read and approved in January must not be handed a rewritten
    //instruction in March with every tick on the screen still green.
    assert.equal(now.text, 'do something else entirely');
});

test('a rewrite down the pipe leaves nothing anybody read', async () => {
    await prompts.save(aPrompt());
    await prompts.save(aPrompt({ id: 'read-the-readme', text: 'changed' }), 'the command line');
    const it = await prompts.get('read-the-readme');

    //THE APPROVAL GOES RATHER THAN LAPSING, and the difference is worth being
    //exact about. `lapsed` means somebody read a version that is still on the
    //record and it has since moved; here the version they read is GONE, replaced
    //by one nobody has seen. Carrying "read at 4pm" beside text written at 5pm
    //by something else would be the more misleading of the two.
    assert.equal(it.approved, false);
    assert.equal(it.lapsed, false);
    assert.equal(it.approval, null);
    assert.equal(it.approvedAt, null);
});

test('LAPSED is for a body that moved underneath the record', async () => {
    //WHICH IS THE JOB CASE, AND THE REAL ONE. A job's body is its code on disk,
    //so it can change with nothing about the record changing at all — and the
    //approval has to notice, because the code is what will run.
    code['build-it'] = 'module.exports = () => 1';
    await jobs.save({ name: 'build it' });
    assert.equal((await jobs.get('build-it')).approved, true);

    code['build-it'] = 'module.exports = () => 999';
    const it = await jobs.get('build-it');

    //Somebody read this and said so, and then it changed. That is a different
    //situation from never having been read, and it asks for a different action.
    assert.equal(it.approved, false);
    assert.equal(it.lapsed, true);
    assert.ok(it.approvedAt, 'it no longer says when it was read');
});

test('changing which contract it runs under lapses it too', async () => {
    await prompts.save(aPrompt({ contractId: 'read-only' }));
    assert.equal((await prompts.get('read-the-readme')).approved, true);

    const now = await prompts.save(aPrompt({ id: 'read-the-readme', contractId: 'anything-goes' }), 'the command line');

    //MORE THAN A REWRITE, not less: the words look identical afterwards.
    assert.equal(now.approved, false);
    assert.equal(now.contractId, 'anything-goes');
});

test('a rename does not count as a change and does not unbind the rules', async () => {
    await prompts.save(aPrompt({ contractId: 'read-only' }));
    const now = await prompts.save({ id: 'read-the-readme', name: 'a better name' }, 'the command line');

    assert.equal(now.name, 'a better name');
    assert.equal(now.approved, true, 'renaming it lapsed the approval');
    assert.equal(now.contractId, 'read-only', 'a save that means rename unbound the rules');
    assert.equal(now.text, 'read the README against the code');
});

//---------------------------------------------------------------------------
//READING IT AND PRESSING SAVE IS THE APPROVAL.
//---------------------------------------------------------------------------

test('a person saving an unapproved one, unchanged, approves it', async () => {
    await prompts.save(aPrompt(), 'the command line');
    assert.equal((await prompts.get('read-the-readme')).approved, false);

    //THE BUG THIS IS FOR COST AN HOUR. Saving only stamped when something had
    //CHANGED — so a person opening an unapproved entry, reading it, and pressing
    //Save left it unapproved for ever, with the window reporting "saved, and
    //waiting to be read" exactly as designed. The only way through was to edit
    //it first, which nobody would guess and which makes reading-then-approving
    //impossible without altering what you read.
    const now = await prompts.save(aPrompt({ id: 'read-the-readme' }));
    assert.equal(now.approved, true);
});

test('and saving it down the pipe twice still does not', async () => {
    await prompts.save(aPrompt(), 'the command line');
    await prompts.save(aPrompt({ id: 'read-the-readme' }), 'the command line');
    assert.equal((await prompts.get('read-the-readme')).approved, false);
});

//---------------------------------------------------------------------------
//SETTING ASIDE, AND THE DIRECTION THAT MATTERS.
//---------------------------------------------------------------------------

test('absent means in use, because everything written before this existed must keep working', async () => {
    await prompts.save(aPrompt());
    assert.equal((await prompts.get('read-the-readme')).setAside, false);

    //The question asked everywhere is "has it been set aside", never "has it
    //been marked usable".
    const raw = (await prompts.read())[0];
    assert.equal(raw.setAside, undefined, 'a fresh entry should carry no flag at all');
});

test('setting aside is harmless from anywhere and keeps the approval', async () => {
    await prompts.save(aPrompt());
    const aside = await prompts.use('read-the-readme', false, { by: 'the command line' });

    assert.equal(aside.setAside, true);
    assert.equal(aside.approved, true, 'taking it out of play cost it its approval');
});

test('bringing one back over the wire costs its approval', async () => {
    await prompts.save(aPrompt());
    await prompts.use('read-the-readme', false, { by: 'the command line' });

    //WITHOUT THIS THE GATE HAS A DOOR BESIDE IT: anything that could set aside
    //and restore could take an approved entry, park it, and bring it back
    //whenever it liked.
    const back = await prompts.use('read-the-readme', true, { by: 'the command line' });
    assert.equal(back.setAside, false);
    assert.equal(back.approved, false, 'it came back approved without anybody reading it');
});

test('and at the window it does not, because a person is the one doing it', async () => {
    await prompts.save(aPrompt());
    await prompts.use('read-the-readme', false, { by: 'the command line' });

    const back = await prompts.use('read-the-readme', true);
    assert.equal(back.approved, true);
});

test('setting aside one already aside is not a restore', async () => {
    await prompts.save(aPrompt());
    await prompts.use('read-the-readme', false);
    const again = await prompts.use('read-the-readme', false, { by: 'the command line' });
    assert.equal(again.approved, true, 'it was never brought back');
});

//---------------------------------------------------------------------------
//TWO LIBRARIES IN ONE STORE.
//---------------------------------------------------------------------------

test('what an entry is FOR is carried, so a judging chain cannot be picked for work', async () => {
    await prompts.save(aPrompt({ name: 'for working', kind: 'task' }));
    await prompts.save(aPrompt({ name: 'for judging', kind: 'judge' }));

    assert.equal((await prompts.get('for-working')).kind, 'task');
    assert.equal((await prompts.get('for-judging')).kind, 'judge');
});

test('anything written before there were two is for work', async () => {
    await prompts.save(aPrompt());
    assert.equal((await prompts.get('read-the-readme')).kind, 'task');

    //An entry that predates the field answers rather than answering undefined.
    const list = await prompts.read();
    delete list[0].kind;
    await prompts.write(list);
    assert.equal((await prompts.get('read-the-readme')).kind, 'task');
});

test('a save that does not mention kind keeps the one it had', async () => {
    await prompts.save(aPrompt({ kind: 'judge' }));
    const now = await prompts.save({ id: 'read-the-readme', name: 'read the readme' }, 'the command line');
    assert.equal(now.kind, 'judge');
});

test('anything that is not judge is task', async () => {
    assert.equal((await prompts.save(aPrompt({ kind: 'something-else' }))).kind, 'task');
});

//---------------------------------------------------------------------------
//THE ID, AND WHAT IS REFUSED.
//---------------------------------------------------------------------------

test('the id never changes once made, because something may be pointing at it', async () => {
    await prompts.save(aPrompt());
    const now = await prompts.save({ id: 'read-the-readme', name: 'a completely different name' });

    assert.equal(now.id, 'read-the-readme');
    assert.equal(now.created, false);
    assert.equal((await prompts.all()).length, 1, 'a rename made a second entry');
});

test('one with no name is refused, because nobody would find it again', async () => {
    await assert.rejects(async () => await prompts.save({ text: 'words' }), /Give it a name/);
    await assert.rejects(async () => await prompts.save({ name: '   ', text: 'words' }), /Give it a name/);
});

test('a name with no letters or numbers in it is refused', async () => {
    await assert.rejects(async () => await prompts.save({ name: '!!!', text: 'words' }), /no letters or numbers/);
});

test('an empty body is refused, because it would be handed over as an empty instruction', async () => {
    await assert.rejects(async () => await prompts.save({ name: 'empty' }), /Write the prompt/);
    await assert.rejects(async () => await prompts.save({ name: 'empty', text: '   ' }), /Write the prompt/);
});

test('one that is not there is refused by name, and the refusal says which kind', async () => {
    await assert.rejects(async () => await prompts.approve('nothing'), /There is no prompt called "nothing"/);
    await assert.rejects(async () => await prompts.forget('nothing'), /There is no prompt called "nothing"/);
    await assert.rejects(async () => await prompts.use('nothing', true), /There is no prompt called "nothing"/);
    await assert.rejects(async () => await prompts.withdraw('nothing'), /There is no prompt called "nothing"/);
    await assert.rejects(async () => await jobs.approve('nothing'), /There is no job called "nothing"/);
});

//---------------------------------------------------------------------------
//APPROVING, WITHDRAWING, FORGETTING.
//---------------------------------------------------------------------------

test('approving is against the body as it is now', async () => {
    await prompts.save(aPrompt(), 'the command line');
    const now = await prompts.approve('read-the-readme', 'I read it');

    assert.equal(now.approved, true);
    assert.equal(now.approval.note, 'I read it');
    assert.equal(now.approval.hash, (await prompts.get('read-the-readme')).hash);
});

test('withdrawing takes the approval and leaves everything else', async () => {
    await prompts.save(aPrompt({ contractId: 'read-only' }));
    const now = await prompts.withdraw('read-the-readme');

    assert.equal(now.approved, false);
    assert.equal(now.lapsed, false, 'withdrawn is not lapsed');
    assert.equal(now.text, 'read the README against the code');
    assert.equal(now.contractId, 'read-only');
});

test('forget deletes, and says what went', async () => {
    await prompts.save(aPrompt());
    const gone = await prompts.forget('read-the-readme');

    assert.deepEqual(gone, { forgotten: 'read-the-readme', name: 'read the readme' });
    assert.deepEqual(await prompts.all(), []);
});

//---------------------------------------------------------------------------
//A BODY THE STORE DOES NOT HOLD.
//---------------------------------------------------------------------------

test('a job is approved against its CODE, which is not in the record', async () => {
    code['build-it'] = 'module.exports = () => 1';
    const made = await jobs.save({ name: 'build it', promptId: 'p1' });
    assert.equal(made.approved, true);

    //The code changes on disk and nothing about the record does — and the
    //approval has to notice, because the code is what will run.
    code['build-it'] = 'module.exports = () => 999';
    const now = await jobs.get('build-it');
    assert.equal(now.approved, false);
    assert.equal(now.lapsed, true);
});

test('the hash is of the body and nothing else', async () => {
    assert.equal(makeLibrary.hash('abc'), makeLibrary.hash('abc'));
    assert.notEqual(makeLibrary.hash('abc'), makeLibrary.hash('abd'));
    //SHORT, STABLE, AND ABOUT THE TEXT rather than about when it was written.
    assert.match(makeLibrary.hash('abc'), /^[0-9a-f]+-3$/);
});

test('an id is made from a name the way a person would write it', async () => {
    assert.equal(makeLibrary.idFor('Read the README!'), 'read-the-readme');
    assert.equal(makeLibrary.idFor('  spaces  everywhere  '), 'spaces-everywhere');
    assert.equal(makeLibrary.idFor('!!!'), '');
});
