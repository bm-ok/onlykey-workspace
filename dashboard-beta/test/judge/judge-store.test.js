const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const statePlugin = require('../../src/app/core/state/main');
const makeJudgements = require('../../src/app/judge/store');

//---------------------------------------------------------------------------
//what was asked of a judge, and what came back.
//
//NO MACHINE, NO QUEUE, NO PLUGIN GRAPH. A judgement is a record and every rule
//here is about that record, so this drives the store directly against the real
//../../src/app/core/state and nothing else.
//
//THE CLAIMS:
//
//  * a number is never handed out twice, even after the highest is thrown away
//  * a judgement of a PULL REQUEST carries the commit it read. Without it the
//    verdict is about "whatever that pull request happened to be", which is
//    worth nothing the moment the author pushes — and that is the one subject
//    this app does not own
//  * one OPEN judgement per subject, and re-judging after one is decided is the
//    sequence the record exists for
//  * pending is a verdict. "I looked and I cannot say" is a conclusion, and it
//    must not have to pretend to be one of the other two
//  * a judgement out on a machine is not a record to throw away
//---------------------------------------------------------------------------

let store;
let said;

beforeEach(async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-judge-'));
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-judge-ws-'));

    let state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dataDir, ...p) } }, async (_e, s) => { state = s.state; });
    state.follow(async () => work);

    said = [];
    store = makeJudgements({
        judging: () => state.here.doc('judging'),
        counter: () => state.here.doc('judging-highest')
    }, {
        good: (t) => said.push(t),
        warn: (t) => said.push(t),
        bad: (t) => said.push(t),
        info: (t) => said.push(t)
    });
});

const aBranch = (extra) => Object.assign({ kind: 'branch', branch: 'fix/the-thing' }, extra || {});

//---------------------------------------------------------------------------
//A NUMBER IS NEVER HANDED OUT TWICE.
//---------------------------------------------------------------------------

test('judgements are numbered from one, with their own prefix', async () => {
    const one = await store.add(aBranch());
    const two = await store.add(aBranch({ branch: 'fix/another' }));

    assert.equal(one.number, 1);
    assert.equal(one.ref, 'J1');
    assert.equal(two.number, 2);
    assert.equal(two.ref, 'J2');
});

test('throwing the highest away does not let the next one take its number', async () => {
    await store.add(aBranch());
    const two = await store.add(aBranch({ branch: 'fix/another' }));
    assert.equal(two.number, 2);

    await store.remove(two.ref);
    const next = await store.add(aBranch({ branch: 'fix/a-third' }));

    //COUNTING FROM WHAT EXISTS WOULD SAY 2 HERE, and a number said out loud —
    //in a commit message, in a note, in "what happened to J2" — would then mean
    //two different readings.
    assert.equal(next.number, 3, 'J2 was handed out twice');
});

test('a counter that has been deleted never drops below the board', async () => {
    await store.add(aBranch());
    const two = await store.add(aBranch({ branch: 'fix/another' }));

    //The board survives a counter that does not. It must not start handing out
    //numbers that are already in use.
    assert.equal(await store.highest(), two.number);
});

//---------------------------------------------------------------------------
//WHAT A JUDGEMENT IS ABOUT, AND THE ONE KIND THIS APP DOES NOT OWN.
//---------------------------------------------------------------------------

test('a branch cut is named by the branch', async () => {
    const made = await store.add(aBranch());
    assert.deepEqual(made.subject, { kind: 'branch', branch: 'fix/the-thing', name: 'fix/the-thing' });
    assert.equal(made.title, 'judge fix/the-thing');
});

test('a PR cut is a source and a target, and is named the way the cuts are', async () => {
    const made = await store.add({ kind: 'cut', source: 'the-change', target: 'main' });

    //THE KEY THE VERDICT RECORD ALREADY USES, so a verdict reaching the cut
    //needs no translation and cannot land under a name that is nearly right.
    assert.equal(made.subject.name, 'the-change -> main');
    assert.equal(made.subject.kind, 'cut');
});

test('a PR cut without a target is refused rather than filed under a cut that does not exist', async () => {
    await assert.rejects(() => store.add({ kind: 'cut', source: 'the-change' }),
        /say both/i);
});

test('a pull request carries the commit it was read at', async () => {
    const made = await store.add({ kind: 'pull', on: 'someone/theirs', number: 7, sha: 'abcdef1234' });

    assert.equal(made.subject.kind, 'pull');
    assert.equal(made.subject.sha, 'abcdef1234');
    //IN THE NAME AS WELL AS THE RECORD, because the name is what a board shows
    //and what a verdict is filed under.
    assert.equal(made.subject.name, 'someone/theirs#7@abcdef1');
});

test('a pull request without the commit is refused, and the refusal says why', async () => {
    //A PULL REQUEST IS A MOVING TARGET: its author can push while a judge is
    //reading. A judgement recording only the number is a verdict about whatever
    //that pull request happened to be.
    await assert.rejects(
        () => store.add({ kind: 'pull', on: 'someone/theirs', number: 7 }),
        /worth nothing the moment the author pushes/);
});

test('a pull request without the repository or the number is refused', async () => {
    await assert.rejects(() => store.add({ kind: 'pull', number: 7, sha: 'abc' }), /owner\/name/);
    await assert.rejects(() => store.add({ kind: 'pull', on: 'a/b', sha: 'abc' }), /owner\/name/);
});

test('anything else is refused, and the refusal lists what can be judged', async () => {
    await assert.rejects(() => store.add({ kind: 'vibes', branch: 'x' }),
        /a "branch".*a "cut".*a "pull"/s);
});

//---------------------------------------------------------------------------
//ONE OPEN JUDGEMENT PER SUBJECT.
//---------------------------------------------------------------------------

test('a second judgement of the same subject is refused while the first is open', async () => {
    const one = await store.add(aBranch());

    await assert.rejects(() => store.add(aBranch()),
        /is already reading fix\/the-thing/);
    assert.match(said.join(' | '), /J1 written/);
    assert.equal(one.ref, 'J1');
});

test('and is allowed once the first is decided, which is what the record is for', async () => {
    const one = await store.add(aBranch());
    await store.update(one.ref, { state: 'done', verdict: 'rejected' });

    const again = await store.add(aBranch());
    assert.equal(again.number, 2);
    //BOTH ARE KEPT. The sequence is the point: what was rejected, what changed,
    //and what was said the second time.
    assert.equal((await store.all()).length, 2);
});

test('a different subject is never the same subject', async () => {
    await store.add(aBranch());
    const cut = await store.add({ kind: 'cut', source: 'fix/the-thing', target: 'main' });
    assert.equal(cut.number, 2);
});

//---------------------------------------------------------------------------
//STATES AND VERDICTS.
//---------------------------------------------------------------------------

test('a judgement starts as a draft, read by a worker, having decided nothing', async () => {
    const made = await store.add(aBranch());

    assert.equal(made.state, 'draft');
    assert.equal(made.by, 'worker');
    assert.equal(made.verdict, null);
    assert.equal(made.decided, null);
    assert.equal(made.machine, null);
    assert.deepEqual(made.attempts, []);
});

test('a person reading it is the same record with a different body', async () => {
    const made = await store.add(aBranch({ by: 'person' }));
    assert.equal(made.by, 'person');
});

test('pending is a verdict, and is not the same as having not looked', async () => {
    const made = await store.add(aBranch());
    const now = await store.update(made.ref, { state: 'done', verdict: 'pending', note: 'could not settle it' });

    assert.equal(now.verdict, 'pending');
    assert.equal(now.state, 'done');
});

test('a state or a verdict that is not one is refused, and the refusal lists them', async () => {
    const made = await store.add(aBranch());

    await assert.rejects(() => store.update(made.ref, { state: 'thinking' }),
        /draft, queued, given, done/);
    await assert.rejects(() => store.update(made.ref, { verdict: 'probably' }),
        /accepted or rejected or pending/);
});

//---------------------------------------------------------------------------
//THE CHAIN IS COPIED IN, NEVER REFERENCED.
//---------------------------------------------------------------------------

test('the words and the rules are copied onto the judgement', async () => {
    const made = await store.add(aBranch({
        job: 'read-it', brief: 'read the change and say what is wrong',
        question: 'is the token ever logged?',
        promptId: 'p1', promptName: 'the reading prompt',
        rules: 'do not push', contractId: 'c1', contractName: 'read only',
        tag: 'test', remembers: true
    }));

    assert.equal(made.brief, 'read the change and say what is wrong');
    assert.equal(made.question, 'is the token ever logged?');
    assert.equal(made.rules, 'do not push');
    assert.equal(made.promptName, 'the reading prompt');
    assert.equal(made.contractName, 'read only');
    assert.equal(made.tag, 'test');
    assert.equal(made.remembers, true);
});

test('remembering is off unless it was asked for', async () => {
    assert.equal((await store.add(aBranch())).remembers, false);
    assert.equal((await store.add(aBranch({ branch: 'b', remembers: 'true' }))).remembers, true);
});

//---------------------------------------------------------------------------
//FINDING ONE, AND THROWING ONE AWAY.
//---------------------------------------------------------------------------

test('a judgement is found by number, by ref, by id or by uid', async () => {
    const made = await store.add(aBranch());

    assert.equal((await store.get('J1')).uid, made.uid);
    assert.equal((await store.get('1')).uid, made.uid);
    assert.equal((await store.get(made.id)).uid, made.uid);
    assert.equal((await store.get(made.uid)).uid, made.uid);
});

test('one that is not there is refused, and the refusal says how to look', async () => {
    await assert.rejects(() => store.get('J9'), /There is no judgement "J9"/);
    await assert.rejects(() => store.get('J9'), /a number like J3, a uid or a name all work/);
});

test('one that is out on a machine is not thrown away', async () => {
    const made = await store.add(aBranch());
    await store.update(made.ref, { state: 'given', machine: 'runner2' });

    await assert.rejects(() => store.remove(made.ref),
        /is out on runner2 right now/);
    assert.equal((await store.all()).length, 1, 'it was removed anyway');
});

test('one that is not out is thrown away, and says what it was about', async () => {
    const made = await store.add(aBranch());
    const gone = await store.remove(made.ref);

    assert.deepEqual(gone, { removed: 'J1', of: 'fix/the-thing' });
    assert.deepEqual(await store.all(), []);
});

test('nothing kept yet is an empty board rather than a failure', async () => {
    assert.deepEqual(await store.all(), []);
    assert.equal(await store.highest(), 0);
});
