const { test } = require('node:test');
const assert = require('node:assert');

const gate = require('../../src/app/judge/gate');
const { subjectFrom } = require('../../src/app/judge/store');

//---------------------------------------------------------------------------
//what may be asked of a judge, and what may not.
//
//THESE ARE THE RULES BETWEEN A STRANGER'S CODE AND A MACHINE ON THIS HOST
//HOLDING A CREDENTIAL, so they are worth being able to exercise without
//arranging a real pull request. A rule that can only be tried by hand is a rule
//that gets tried once and then trusted.
//
//NOTHING HERE FETCHES ANYTHING. Every fact — the allowance, what GitHub says,
//which cuts exist, what the library holds — is passed in, which is the whole
//reason ../../src/app/judge/gate.js is a module and not part of an action.
//---------------------------------------------------------------------------

const aPull = (sha) => subjectFrom({ kind: 'pull', on: 'someone/theirs', number: 7, sha: sha || 'abcdef1234' });
const allowedAt = (sha) => ({ allowed: true, stale: false, said: { sha } });
const liveAt = (sha) => ({ number: 7, headSha: sha });

//---------------------------------------------------------------------------
//SOMEBODY ELSE'S CODE IS NOT READ UNTIL A PERSON HAS SAID SO, AT THIS COMMIT.
//---------------------------------------------------------------------------

test('a pull request nobody has allowed is refused, and the refusal says where to allow it', () => {
    const why = gate.whyNotRead(aPull(), {
        allowance: { allowed: false, stale: false, said: null },
        live: liveAt('abcdef1234')
    });

    assert.match(why, /Nobody has allowed someone\/theirs#7/);
    assert.match(why, /once a person has looked at it and said so/);
    assert.match(why, /Repositories → Overview/);
});

test('an allowance for an earlier commit is refused as STALE, which is not the same refusal', () => {
    const why = gate.whyNotRead(aPull('bbbbbbbbbb'), {
        allowance: { allowed: false, stale: true, said: { sha: 'aaaaaaaaaa' } },
        live: liveAt('bbbbbbbbbb')
    });

    //STALE IS NOT "NO". A person HAS looked and formed a view; the thing they
    //looked at is gone. The action it asks for is different, so the sentence is.
    assert.match(why, /was allowed at aaaaaaa and is now at bbbbbbb/);
    assert.match(why, /the author has pushed since/);
    assert.doesNotMatch(why, /Nobody has allowed/);
});

test('an allowance that matches, with GitHub agreeing, is let through', () => {
    assert.equal(gate.whyNotRead(aPull('abcdef1234'), {
        allowance: allowedAt('abcdef1234'),
        live: liveAt('abcdef1234')
    }), null);
});

//---------------------------------------------------------------------------
//THE ALLOWANCE IS THIS HOST'S RECORD; GITHUB IS THE FACT.
//---------------------------------------------------------------------------

test('an author who pushed between the allowance and the request is caught by GitHub, not by the record', () => {
    //THE ALLOWANCE ITSELF PASSES — this host recorded it against the commit
    //being asked for. GitHub is what disagrees.
    const why = gate.whyNotRead(aPull('aaaaaaaaaa'), {
        allowance: allowedAt('aaaaaaaaaa'),
        live: liveAt('bbbbbbbbbb')
    });

    assert.match(why, /is at bbbbbbb on GitHub and this judgement names aaaaaaa/);
    assert.match(why, /pushed while this was being arranged/);
});

test('two commits sharing a short prefix are shown long enough to differ', () => {
    const a = '6ee55a3111111111';
    const b = '6ee55a3222222222';
    const why = gate.whyNotRead(aPull(a), { allowance: allowedAt(a), live: liveAt(b) });

    //TRUNCATING BOTH ONCE PRODUCED "is at 6ee55a3 and names 6ee55a3" about two
    //commits that are genuinely different — a refusal that reads as a bug in
    //itself, at exactly the moment it has to be readable.
    assert.match(why, new RegExp(b));
    assert.match(why, new RegExp(a));
});

test('not being able to ask GitHub is a refusal, not a pass', () => {
    const why = gate.whyNotRead(aPull(), { allowance: allowedAt('abcdef1234'), live: null });

    //"COULD NOT ASK" AND "AGREES" ARE OPPOSITE ANSWERS. Treating an unanswered
    //question as agreement is how a stale allowance gets through.
    assert.match(why, /could not find out what someone\/theirs#7 is at on GitHub/);
});

//---------------------------------------------------------------------------
//THE TWO KINDS THIS APP DOES OWN.
//---------------------------------------------------------------------------

test('a PR cut has to be one that was sent out', () => {
    const subject = subjectFrom({ kind: 'cut', source: 'the-change', target: 'main' });

    assert.equal(gate.whyNotRead(subject, { cuts: [{ source: 'the-change', target: 'main' }] }), null);
    assert.match(gate.whyNotRead(subject, { cuts: [{ source: 'other', target: 'main' }] }),
        /There is no PR cut "the-change -> main"/);
    assert.match(gate.whyNotRead(subject, { cuts: [] }), /a verdict nobody will find/);
});

test('a cut to a different target is a different cut', () => {
    const subject = subjectFrom({ kind: 'cut', source: 'the-change', target: 'main' });
    assert.match(gate.whyNotRead(subject, { cuts: [{ source: 'the-change', target: 'develop' }] }),
        /There is no PR cut/);
});

test('a branch cut has to be here', () => {
    const subject = subjectFrom({ kind: 'branch', branch: 'fix/the-thing' });

    assert.equal(gate.whyNotRead(subject, { branches: [{ name: 'fix/the-thing' }] }), null);
    assert.match(gate.whyNotRead(subject, { branches: [{ name: 'something-else' }] }),
        /There is no branch cut "fix\/the-thing"/);
    assert.match(gate.whyNotRead(subject, { branches: [] }), /send a machine to read nothing/);
});

//---------------------------------------------------------------------------
//A MACHINE DOES NOT MARK A PERSON'S HOMEWORK.
//---------------------------------------------------------------------------

const settled = (extra) => Object.assign({
    ref: 'J1', state: 'done', by: 'person', verdict: 'accepted',
    subject: { name: 'fix/the-thing' }
}, extra || {});

const branch = subjectFrom({ kind: 'branch', branch: 'fix/the-thing' });

test('over the wire, a second reading of what a person settled is refused', () => {
    const why = gate.whyNotCommission(branch, [settled()], () => false, true);

    assert.match(why, /J1 is a person's own reading of fix\/the-thing/);
    assert.match(why, /they recorded "accepted"/);
    assert.match(why, /not yours to commission/);
});

test('at the window a person may always ask for another, including one that disagrees', () => {
    //THE RECORD IS A SEQUENCE OF OPINIONS, and two that disagree is the most
    //useful thing in it. This is about who may commission the second one.
    assert.equal(gate.whyNotCommission(branch, [settled()], () => false, false), null);
});

test('once the code has moved, judging again is judging something else', () => {
    assert.equal(gate.whyNotCommission(branch, [settled()], () => true, true), null,
        'a stale reading must not block a fresh one');
});

test('a worker’s own reading is not a person’s homework', () => {
    assert.equal(gate.whyNotCommission(branch, [settled({ by: 'worker' })], () => false, true), null);
});

test('an unfinished or undecided reading blocks nothing', () => {
    assert.equal(gate.whyNotCommission(branch, [settled({ state: 'given' })], () => false, true), null);
    assert.equal(gate.whyNotCommission(branch, [settled({ verdict: null })], () => false, true), null);
});

test('a reading of a different subject blocks nothing', () => {
    assert.equal(gate.whyNotCommission(branch,
        [settled({ subject: { name: 'some/other-branch' } })], () => false, true), null);
});

test('the most recent current reading is the one named', () => {
    const why = gate.whyNotCommission(branch, [
        settled({ ref: 'J1', verdict: 'rejected' }),
        settled({ ref: 'J4', verdict: 'accepted' })
    ], () => false, true);

    assert.match(why, /J4/);
    assert.match(why, /"accepted"/);
});

//---------------------------------------------------------------------------
//A JUDGE IS NOT A WORKER, AND AN UNAPPROVED CHAIN DOES NOT RUN.
//---------------------------------------------------------------------------

const aJudgeJob = (extra) => Object.assign({ id: 'read-it', kind: 'judge', promptId: 'p1' }, extra || {});
const aPrompt = (extra) => Object.assign({ id: 'p1', name: 'the reading prompt', text: 'read it', contractId: 'c1' }, extra || {});
const aContract = () => ({ id: 'c1', name: 'read only', text: 'do not push' });

test('a working job run as a judge is refused', () => {
    assert.throws(() => gate.chainFor(aJudgeJob({ kind: 'task' }), { runnable: true }, aPrompt(), aContract()),
        /a job for doing work, not for judging it/);
});

test('a chain that is not approved is refused, and says what the library said', () => {
    assert.throws(
        () => gate.chainFor(aJudgeJob(), { runnable: false, whyNot: 'the prompt is not approved' }, aPrompt(), aContract()),
        /cannot run: the prompt is not approved/);
});

test('a judge with no prompt is refused at the door rather than on a machine', () => {
    //IT COST A REAL RUN: a machine rolled back, booted, took a credential and
    //cloned three repositories before the job refused. Every panel said "can
    //judge" throughout, because a job with no prompt is not broken — it is a job
    //with no prompt. It is only a JUDGE that is broken.
    assert.throws(() => gate.chainFor(aJudgeJob({ promptId: null }), { runnable: true }, null, null),
        /has no prompt, so there would be nothing to tell the worker to look for/);
});

test('a prompt that has gone from the library is refused', () => {
    assert.throws(() => gate.chainFor(aJudgeJob(), { runnable: true }, null, null),
        /there is no such prompt/);
});

test('a contract that has gone is refused rather than copied without its rules', () => {
    assert.throws(() => gate.chainFor(aJudgeJob(), { runnable: true }, aPrompt(), null),
        /will not be copied without the rules it was approved with/);
});

test('the words and the rules are copied, never named', () => {
    const chain = gate.chainFor(aJudgeJob(), { runnable: true }, aPrompt(), aContract());

    assert.deepEqual(chain, {
        job: 'read-it',
        brief: 'read it',
        promptId: 'p1',
        promptName: 'the reading prompt',
        rules: 'do not push',
        contractId: 'c1',
        contractName: 'read only'
    });
});

test('a prompt under no contract is allowed, and copies nothing it does not have', () => {
    const chain = gate.chainFor(aJudgeJob(), { runnable: true }, aPrompt({ contractId: null }), null);
    assert.equal(chain.rules, null);
    assert.equal(chain.contractId, null);
});

test('no job at all is an empty chain rather than a refusal', () => {
    assert.deepEqual(gate.chainFor(null, null, null, null), {});
});

//---------------------------------------------------------------------------
//THE PARTICULAR THING BEING ASKED, ON TOP OF THE APPROVED WORDS.
//---------------------------------------------------------------------------

test('a question is added under a heading, and the approved text is untouched', () => {
    const out = gate.withQuestion('the approved words', 'is the token ever logged?');

    assert.match(out, /^the approved words/);
    assert.match(out, /What you are being asked about, specifically/);
    assert.match(out, /is the token ever logged\?$/);
});

test('no question leaves the brief exactly as approved', () => {
    assert.equal(gate.withQuestion('the approved words', ''), 'the approved words');
    assert.equal(gate.withQuestion('the approved words', null), 'the approved words');
    assert.equal(gate.withQuestion('the approved words', '   '), 'the approved words');
});

test('a question with no judge to ask it names the judges that can run', () => {
    const why = gate.askedWithNoJudge([{ id: 'read-it' }, { id: 'check-a-claim' }]);

    //"GIVE THIS A JOB AS WELL" WAS NOT ENOUGH. A supervisor met that four times
    //in a row: each refusal was correct and each was useless, because it said
    //what was missing and not what would fix it.
    assert.match(why, /read-it, check-a-claim/);
    assert.match(why, /For example job: "read-it"/);
});

test('and says so plainly when nothing is approved to run', () => {
    const why = gate.askedWithNoJudge([]);
    assert.match(why, /No judging chain is approved yet/);
    assert.doesNotMatch(why, /For example/);
});
