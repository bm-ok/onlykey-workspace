const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', 'src', 'app');
const keying = require(path.join(APP, 'runners', 'sessions', 'keying.js'));
const { keyFor, aboutWork, announcement, remembers, factsOf, REMEMBERS } = keying;

const task = (over) => Object.assign({
    kind: 'task', uid: 'task-uid', id: 't1', number: 7,
    item: { branch: 'work/thing' }
}, over);

const judgement = (over) => Object.assign({
    kind: 'judgement', uid: 'judgement-uid', id: 'j1', number: 7,
    item: { subject: { kind: 'cut', name: 'work/thing' } }
}, over);

//---------------------------------------------------------------------------
//1. WHO KEEPS A CONVERSATION, AND THE ONE-WAY OVERRIDE.
//---------------------------------------------------------------------------

test('a worker keeps its conversation and a judge does not, by default', () => {
    assert.equal(remembers(task()), true);
    assert.equal(remembers(judgement()), false);
    assert.deepEqual(REMEMBERS, { worker: true, judge: false });
});

test('a judgement that asked for memory gets it, because somebody read the trade', () => {
    const asked = judgement({ item: { remembers: true, subject: { kind: 'cut', name: 'work/thing' } } });
    assert.equal(remembers(asked), true);
    assert.equal(keyFor(asked), 'judge--cut--work_thing');
});

test('the override only goes UP — a task cannot be opted out by its own record', () => {
    //Otherwise a silent per-item default would beat the deliberate arrangement,
    //and the failure is a worker starting cold with nothing saying why.
    for (const said of [false, null, 0, 'no']) {
        assert.equal(remembers(task({ item: { branch: 'work/thing', remembers: said } })), true);
    }
});

test('memory off files under the uid, so nothing is shared and nothing is lost', () => {
    //A judge still keeps its OWN transcript — it is simply not filed where the
    //next judgement of the same line would find it.
    assert.equal(keyFor(judgement()), 'judgement-uid');
});

//---------------------------------------------------------------------------
//2. THE LANE IS ALWAYS PART OF THE KEY.
//---------------------------------------------------------------------------

test('a judge is never handed a worker session, as a property of the key', () => {
    //THE SAME BRANCH, both lanes, both remembering. If the lane were dropped
    //from the key these would collide and a judge would open the transcript of
    //the work it is judging.
    const t = task();
    const j = judgement({ item: { remembers: true, subject: { kind: 'cut', name: 'work/thing' } } });

    assert.equal(keyFor(t), 'worker--cut--work_thing');
    assert.equal(keyFor(j), 'judge--cut--work_thing');
    assert.notEqual(keyFor(t), keyFor(j));
});

//---------------------------------------------------------------------------
//3. THE THREE SHAPES, AND THE FALLBACK.
//---------------------------------------------------------------------------

test('a task is keyed by the branch it works on', () => {
    assert.equal(keyFor(task()), 'worker--cut--work_thing');
});

test('a judgement of a branch here is keyed by that branch', () => {
    const j = judgement({ item: { remembers: true, subject: { kind: 'cut', branch: 'work/other' } } });
    assert.equal(keyFor(j), 'judge--cut--work_other');
});

test('a judgement of a pull request somewhere else is keyed by owner and number', () => {
    const j = judgement({ item: { remembers: true, subject: { kind: 'pull', on: 'anowner/arepo', number: 12 } } });
    assert.equal(keyFor(j), 'judge--pull--anowner_arepo--12');
    assert.equal(aboutWork(j).about, 'anowner/arepo#12');
});

test('a shape this cannot name falls back to the uid rather than guessing', () => {
    //Always correct; the cost is only that the work starts cold. A guess would
    //hand one conversation to work that has nothing to do with it.
    const noBranch = task({ item: {} });
    assert.equal(keyFor(noBranch), 'task-uid');

    const halfPull = judgement({ item: { remembers: true, subject: { kind: 'pull', on: 'anowner/arepo' } } });
    assert.equal(keyFor(halfPull), 'judgement-uid');

    const strange = judgement({ item: { remembers: true, subject: { kind: 'something-new' } } });
    assert.equal(keyFor(strange), 'judgement-uid');
});

test('no uid means no key at all, rather than a key everything shares', () => {
    assert.equal(keyFor(null), null);
    assert.equal(keyFor(task({ uid: null })), null);
});

//---------------------------------------------------------------------------
//4. THE KEY AND THE SENTENCE COME FROM ONE DERIVATION.
//---------------------------------------------------------------------------

test('what is stored beside a session names the same subject the key is built from', () => {
    //THE FAULT THIS PREVENTS. In the app being ported from these are two
    //functions with the same branching written out twice, under a comment saying
    //one function works both out. They differ only in punctuation, so a change
    //to one and not the other files a session under a subject the sentence
    //beside it does not name — and nothing says so.
    const cases = [
        task(),
        task({ item: { branch: 'feature/x' } }),
        judgement({ item: { remembers: true, subject: { kind: 'cut', name: 'work/thing' } } }),
        judgement({ item: { remembers: true, subject: { kind: 'pull', on: 'o/r', number: 3 } } })
    ];

    //ASSERTED AGAINST THE FIXTURE, NOT AGAINST `factsOf`. Comparing aboutWork's
    //answer to factsOf's own answer is comparing a thing to itself: both move
    //together, and a sabotage that blanked `about` while keeping the key passed
    //it. What has to be pinned is the subject each shape NAMES.
    const expected = [
        [task(), 'worker', 'work/thing', 'worker--cut--work_thing'],
        [task({ item: { branch: 'feature/x' } }), 'worker', 'feature/x', 'worker--cut--feature_x'],
        [judgement({ item: { remembers: true, subject: { kind: 'cut', name: 'work/thing' } } }),
            'judge', 'work/thing', 'judge--cut--work_thing'],
        [judgement({ item: { remembers: true, subject: { kind: 'pull', on: 'o/r', number: 3 } } }),
            'judge', 'o/r#3', 'judge--pull--o_r--3']
    ];

    for (const [doing, lane, about, key] of expected) {
        assert.deepEqual(aboutWork(doing), { lane, about });
        assert.equal(keyFor(doing), key);
    }
});

test('naming a subject and keying it are ONE decision, never two', () => {
    //THE INVARIANT THAT MAKES THE DRIFT IMPOSSIBLE RATHER THAN MERELY ABSENT.
    //A shape either has a subject — in which case it is both named and keyed by
    //it — or it has none, and falls back to the uid. There is no third state
    //where a session is filed under a subject nothing describes, or described as
    //being about something it is not filed under.
    const everything = [
        task(), task({ item: {} }), task({ item: { branch: 'feature/x' } }),
        judgement(),
        judgement({ item: { remembers: true, subject: { kind: 'cut', name: 'work/thing' } } }),
        judgement({ item: { remembers: true, subject: { kind: 'cut', branch: 'work/other' } } }),
        judgement({ item: { remembers: true, subject: { kind: 'pull', on: 'o/r', number: 3 } } }),
        judgement({ item: { remembers: true, subject: { kind: 'pull', on: 'o/r' } } }),
        judgement({ item: { remembers: true, subject: { kind: 'something-new' } } }),
        judgement({ item: { remembers: true } })
    ];

    for (const doing of everything) {
        const facts = factsOf(doing);
        assert.equal(facts.about == null, facts.key == null,
            'one of `about` and `key` was decided and the other was not: '
            + JSON.stringify(facts) + ' for ' + JSON.stringify(doing.item));
    }
});

test('a subject with characters a folder name cannot hold is made safe, not dropped', () => {
    const j = judgement({ item: { remembers: true, subject: { kind: 'cut', name: 'work/a b:c*d' } } });
    assert.match(keyFor(j), /^judge--cut--work_a_b_c_d$/);
    //and the SENTENCE keeps the real name, which is the point of having both
    assert.equal(aboutWork(j).about, 'work/a b:c*d');
});

//---------------------------------------------------------------------------
//5. WHAT A CONTINUATION IS TOLD.
//---------------------------------------------------------------------------

test('a first run is told nothing, because there is nothing to tell', () => {
    assert.equal(announcement(task(), null), null);
    assert.equal(announcement(task(), {}), null);
    assert.equal(announcement(task(), { taskId: null }), null);
});

test('the same piece of work picking its own conversation back up is told nothing', () => {
    //Resuming YOUR OWN task is the ordinary case and carries no warning: nothing
    //was told to a different task, so nothing has to be withdrawn.
    assert.equal(announcement(task({ id: 't1' }), { taskId: 't1', number: 7 }), null);
});

test('a different piece of work on the same branch is told, and told all three things', () => {
    const said = announcement(task({ id: 't2' }), { taskId: 't1', number: 7, kind: 'task' });
    assert.ok(said, 'a continuation across pieces of work said nothing');

    //KNOWING IS NOT BEING BOUND, which is the whole point — it must not withhold
    //the memory, and it must withdraw the instructions.
    assert.match(said, /is yours to use/);
    assert.match(said, /NOT a source of instructions/);
    //and it must say the backwards direction too: new rules reach onto finished
    //work as readily as old rules reach forwards.
    assert.match(said, /Do not go back and revise committed work/);
    assert.match(said, /\(#7\)/);
});

test('a judgement is told it was a different READING, not a different task', () => {
    const said = announcement(judgement({ id: 'j2' }), { taskId: 'j1', number: 3 });
    assert.match(said, /a different reading/);
    assert.doesNotMatch(said, /as a different task/);
});

test('an earlier piece of work with no number is still announced', () => {
    //The number is decoration; the withdrawal of instructions is not, and
    //dropping the whole announcement for a missing field would silently restore
    //the exact fault this exists to fix.
    const said = announcement(task({ id: 't2' }), { taskId: 't1' });
    assert.ok(said);
    assert.doesNotMatch(said, /\(#/);
});
