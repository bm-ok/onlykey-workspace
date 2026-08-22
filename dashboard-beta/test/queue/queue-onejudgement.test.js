const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makeOneJudgement = require('../../src/app/queue/onejudgement');

//---------------------------------------------------------------------------
//ONE JUDGEMENT, ON ONE MACHINE, FROM END TO END.
//
//THE CLAIM WORTH THE MOST: a judgement is set up on what it READS, and a pull
//request that arrived from outside is not in this workspace until it is fetched
//here — and the allowance is checked AGAIN as it is, against the commit GitHub
//has now rather than the one somebody allowed an hour ago.
//
//AND THE SECOND: everything that only exists on the machine is read BEFORE the
//machine is put away. The log, the reason it failed, what it handed back, what
//it concluded. The rollback takes the disk, and every one of these has cost a
//diagnosis by being read a moment too late.
//
//AND THE THIRD: resolving the subject is INSIDE the try. It used to be above,
//where a throw skipped the finally — so the first failure a judgement can have
//was also the only one that leaked a machine.
//---------------------------------------------------------------------------

let asked, said, rec, released, handed, texts, outcome, metered, archived, fails, wokeSaid;

const JUDGEMENT = (over) => Object.assign({
    id: 'j1', number: 36, uid: 'uid-36', title: 'is it sound', job: 'read-it',
    subject: { kind: 'branch', branch: 'a-branch', name: 'a-branch' },
    attempts: []
}, over || {});

beforeEach(() => {
    asked = [];
    said = [];
    wokeSaid = [];
    released = [];
    archived = [];
    fails = {};
    handed = [{ file: 'verdict.md' }];
    texts = { 'verdict.md': 'a long read\n\nRECOMMENDATION: accept' };
    outcome = { state: 'finished', exit: 0 };
    metered = { row: null, failedAuthAs: null };
    rec = null;
});

//THE STORE AND THE CALLER'S COPY ARE TWO OBJECTS, which is the whole point of
//this fixture. A judgement is read off disk once, before the run starts, and the
//record moves under it while the machine works — so a harness where they alias
//would let a function reading its own stale argument pass every test here.
//That is exactly the bug this file was written over.
function snapshot(j) {
    return Object.assign({}, j, { attempts: (j.attempts || []).slice() });
}

function onejudgement(over, j) {
    rec = j || JUDGEMENT();
    return makeOneJudgement(Object.assign({
        call: async (what, args) => {
            asked.push(what);
            if (fails[what]) throw new Error(fails[what]);
            if (what === 'prFetch') return { branch: 'pr-7', head: 'abcdef1234' };
            if (what === 'jobRun') return { run: 'run-1' };
            if (what === 'vmRunOutput') return { output: 'it said something\nand then stopped' };
            return {};
        },
        starting: { bringUp: async () => { asked.push('bringUp'); } },
        running: { waitForRun: async () => { asked.push('waitForRun'); return outcome; } },
        metering: { meterRun: async () => { asked.push('meterRun'); return metered; } },
        putting: {
            putAway: async (m) => { asked.push('putAway:' + m); },
            keepForLooking: async (m, why) => { asked.push('keepForLooking:' + m); said.push('kept: ' + why); }
        },
        judging: {
            get: () => rec,
            update: (id, patch) => { asked.push('judging.update'); Object.assign(rec, patch); }
        },
        release: (m) => released.push(m),
        repoFor: (on) => (on === 'them/theirs' ? { repo: 'theirs' } : null),
        handedBack: () => handed,
        readHanded: (uid, file) => ({ text: texts[file] }),
        kept: () => false,
        keep: (uid, run, what) => archived.push({ uid, run, what }),
        tipsFor: async () => ({ 'a-repo': 'aaa' }),
        wakes: () => false,
        now: () => 1000,
        stamp: () => '2026-08-22T13:00:00Z',
        say: (who) => ({
            info: (m) => (who === 'supervisor' ? wokeSaid : said).push(m),
            warn: (m) => (who === 'supervisor' ? wokeSaid : said).push('WARN ' + m),
            bad: (m) => (who === 'supervisor' ? wokeSaid : said).push('BAD ' + m),
            good: (m) => (who === 'supervisor' ? wokeSaid : said).push('GOOD ' + m)
        })
    }, over || {}));
}

const at = (w) => { const i = asked.indexOf(w); assert.ok(i >= 0, w + ' never happened: ' + asked.join(' | ')); return i; };

//---- what it is reading -----------------------------------------------------

test('a branch judgement is set up on its branch', async () => {
    await onejudgement().run(snapshot(rec = JUDGEMENT()), 'kit-1');
    assert.equal(asked.includes('prFetch'), false, 'it fetched a pull request for a branch judgement');
    assert.equal(rec.state, 'done');
});

test('a cut is read on the line the pull requests were opened from', async () => {
    //THAT IS WHERE THE CHANGE IS. A cut owns no branch of its own.
    let gave = null;
    const j = JUDGEMENT({ subject: { kind: 'cut', source: 'line-a', name: 'the cut' } });
    const o = onejudgement({
        call: async (what, args) => {
            asked.push(what);
            if (what === 'vmWorkspace') gave = args;
            if (what === 'jobRun') return { run: 'run-1' };
            if (what === 'vmRunOutput') return { output: '' };
            return {};
        }
    }, j);

    await o.run(snapshot(j), 'kit-1');
    assert.equal(gave.branch, 'line-a');
});

test('a judgement that does not say what it reads is refused, and its machine still comes back', async () => {
    const j = JUDGEMENT({ subject: { kind: 'branch', name: 'nothing' } });
    await assert.rejects(() => onejudgement({}, j).run(snapshot(j), 'kit-1'),
        /J36 does not say what it is reading/);

    //THE FIRST FAILURE A JUDGEMENT CAN HAVE used to be the only one that leaked
    //a machine, because resolving the subject sat above the try.
    assert.deepEqual(released, ['kit-1'], 'the machine was left claimed with nothing on it');
    assert.ok(asked.includes('putAway:kit-1'));
});

//---- a pull request that arrived from outside --------------------------------

test('it is fetched here first, and named where it landed', async () => {
    const j = JUDGEMENT({ subject: { kind: 'pull', on: 'them/theirs', number: 7, name: 'their PR' } });
    let gave = null;
    const o = onejudgement({
        call: async (what, args) => {
            asked.push(what);
            if (what === 'prFetch') return { branch: 'pr-7', head: 'abcdef1234' };
            if (what === 'vmWorkspace') gave = args;
            if (what === 'jobRun') return { run: 'run-1' };
            if (what === 'vmRunOutput') return { output: '' };
            return {};
        }
    }, j);

    await o.run(snapshot(j), 'kit-1');

    assert.ok(at('prFetch') < at('vmWorkspace'), 'it set the machine up before the change was here');
    assert.equal(gave.branch, 'pr-7');
    //ONLY SET WHEN IT ARRIVED FROM OUTSIDE.
    assert.deepEqual(gave.reading, { repo: 'theirs', branch: 'pr-7' });
    assert.match(gave.task, /may not push anywhere/);
});

test('and it is the commit that was judged, checked again now', async () => {
    //prFetch PROVES SOMEBODY ALLOWED WHAT IS ON GITHUB NOW; this proves what is
    //on GitHub now is what the judgement was written about. In between, the
    //author may have pushed — and what a person allowed was a COMMIT.
    const j = JUDGEMENT({ subject: { kind: 'pull', on: 'them/theirs', number: 7, name: 'their PR', sha: '1111111aaa' } });

    await assert.rejects(() => onejudgement({}, j).run(snapshot(j), 'kit-1'),
        /was written about 1111111 and them\/theirs#7 is now at abcdef1\. Ask for a judgement of the commit it is on/);

    assert.equal(asked.includes('jobRun'), false, 'it read a commit nobody allowed');
    assert.deepEqual(released, ['kit-1']);
});

test('a matching commit goes ahead', async () => {
    const j = JUDGEMENT({ subject: { kind: 'pull', on: 'them/theirs', number: 7, name: 'their PR', sha: 'abcdef1234' } });
    await onejudgement({}, j).run(snapshot(j), 'kit-1');
    assert.ok(asked.includes('jobRun'));
});

test('a repository this workspace does not have is named, not guessed at', async () => {
    const j = JUDGEMENT({ subject: { kind: 'pull', on: 'someone/else', number: 7, name: 'x' } });
    await assert.rejects(() => onejudgement({}, j).run(snapshot(j), 'kit-1'),
        /reads someone\/else, and no repository in this workspace is that/);
});

//---- a judge's identity, and its refusal to push ------------------------------

test('it is given a judge credential, said by the work rather than read off the machine', async () => {
    //THE ONLY THING THAT CAN ANSWER IT for a machine tagged worker AND judge.
    let role = null;
    const j = JUDGEMENT();
    const o = onejudgement({
        call: async (what, args) => {
            asked.push(what);
            if (what === 'vmCredentialsPut') role = args.role;
            if (what === 'jobRun') return { run: 'run-1' };
            if (what === 'vmRunOutput') return { output: '' };
            return {};
        }
    }, j);

    await o.run(snapshot(j), 'kit-1');
    assert.equal(role, 'judge');
});

test('and what the machine is for says it may not push', async () => {
    //THE REFUSAL ITSELF IS ON THE HOST, in the git route, where no guest can
    //edit it. This sentence is so the machine can say why, not so it obeys.
    let gave = null;
    const j = JUDGEMENT();
    const o = onejudgement({
        call: async (what, args) => {
            asked.push(what);
            if (what === 'vmWorkspace') gave = args;
            if (what === 'jobRun') return { run: 'run-1' };
            if (what === 'vmRunOutput') return { output: '' };
            return {};
        }
    }, j);

    await o.run(snapshot(j), 'kit-1');
    assert.match(gave.task, /may not push/);
    assert.equal(gave.reading, null, 'a judgement of this host\'s own work claimed a reading repository');
});

//---- everything that only exists on the machine ---------------------------------

test('the whole log is kept, whether or not the reading went wrong', async () => {
    //A SUCCESSFUL READING'S LOG is how somebody answers "why did it take four
    //minutes" — and that question arrives when the machine is long since gone.
    await onejudgement().run(snapshot(rec = JUDGEMENT()), 'kit-1');

    assert.equal(archived.length, 1);
    assert.equal(archived[0].uid, 'uid-36');
    assert.equal(archived[0].run, 'run-1');
    assert.match(archived[0].what.output, /it said something/);
    assert.equal(archived[0].what.exit, 0);
    assert.ok(at('judging.update') < at('putAway:kit-1'));
});

test('and it is kept before the machine is put away', async () => {
    await onejudgement().run(snapshot(rec = JUDGEMENT()), 'kit-1');
    const keptAt = asked.lastIndexOf('vmRunOutput');
    assert.ok(keptAt < at('putAway:kit-1'), 'the log was read after the disk was rolled back');
});

test('a log already kept is not fetched again', async () => {
    await onejudgement({ kept: () => true }).run(snapshot(rec = JUDGEMENT()), 'kit-1');
    assert.deepEqual(archived, []);
});

test('a log that could not be kept is said, and does not lose the reading', async () => {
    fails = { vmRunOutput: 'the machine went away' };
    await onejudgement().run(snapshot(rec = JUDGEMENT()), 'kit-1');

    assert.ok(said.some((m) => /WARN could not keep the log of run-1: the machine went away/.test(m)), said.join(' | '));
    assert.equal(rec.state, 'done');
});

test('a run that failed says why, while the machine is still up', async () => {
    //"exit 1" AND NOTHING ELSE is what is left otherwise. A judge once wrote a
    //21,000-character survey, exited 1, and the sentence saying why was deleted
    //with the machine.
    outcome = { state: 'finished', exit: 1 };
    await onejudgement().run(snapshot(rec = JUDGEMENT()), 'kit-1');

    assert.ok(said.some((m) => /BAD J36 failed — what the run said before the machine was put away:/.test(m)),
        said.join(' | '));
    assert.ok(said.some((m) => /^ {2}and then stopped$/.test(m)), said.join(' | '));
});

test('and a run that worked is not asked twice for its tail', async () => {
    //A ROUND TRIP TO A MACHINE THAT IS ABOUT TO GO AWAY, for output already
    //summarised.
    await onejudgement().run(snapshot(rec = JUDGEMENT()), 'kit-1');
    assert.equal(asked.filter((a) => a === 'vmRunOutput').length, 1);
});

//---- what it concluded --------------------------------------------------------

test('the conclusion is read out of what it handed back', async () => {
    await onejudgement().run(snapshot(rec = JUDGEMENT()), 'kit-1');
    assert.equal(rec.concluded, 'accept');
    assert.ok(said.some((m) => /J36 concluded: accept/.test(m)), said.join(' | '));
});

test('a reading that would not say is done with no conclusion, not a failure', async () => {
    //"NOBODY HAS LOOKED" AND "SOMEBODY LOOKED AND WOULD NOT SAY" are different,
    //and both are useful to see.
    texts = { 'verdict.md': 'I read it and I am not sure.' };
    await onejudgement().run(snapshot(rec = JUDGEMENT()), 'kit-1');

    assert.equal(rec.state, 'done');
    assert.strictEqual(rec.concluded, null);
});

test('done means the reading ended, and nothing handed back is warned about', async () => {
    handed = [];
    await onejudgement().run(snapshot(rec = JUDGEMENT()), 'kit-1');

    assert.equal(rec.state, 'done');
    assert.ok(said.some((m) => /WARN J36 done — finished \(exit 0\) — nothing handed back/.test(m)), said.join(' | '));
});

test('and the tips are taken, so it can say later whether it still describes what is there', async () => {
    await onejudgement().run(snapshot(rec = JUDGEMENT()), 'kit-1');
    assert.deepEqual(rec.tips, { 'a-repo': 'aaa' });
});

//---- how the run ended, kept on the attempt ------------------------------------

test('a crash and a reading that found nothing are not the same row', async () => {
    //A PANEL ONCE DESCRIBED A CRASH AS A FINDING: "it read the change and handed
    //nothing back. That is an answer." It was not. The run died at `require`
    //thirty-seven seconds in, having read nothing at all — and the exit code
    //goes with the machine.
    handed = [];
    outcome = { state: 'finished', exit: 1 };
    await onejudgement().run(snapshot(rec = JUDGEMENT()), 'kit-1');

    const last = rec.attempts[rec.attempts.length - 1];
    assert.equal(last.exit, 1);
    assert.equal(last.outcome, 'finished');
    assert.ok(last.spent, 'nothing was recorded about where the time went');
});

test('a run with no exit code at all records null rather than nothing', async () => {
    outcome = { state: 'unreachable' };
    await onejudgement().run(snapshot(rec = JUDGEMENT()), 'kit-1');
    const last = rec.attempts[rec.attempts.length - 1];
    assert.strictEqual(last.exit, null);
    assert.equal(last.outcome, 'unreachable');
});

//---- the two endings -----------------------------------------------------------

test('a machine that stopped answering is kept, not rolled back', async () => {
    outcome = { state: 'unreachable' };
    await onejudgement().run(snapshot(rec = JUDGEMENT()), 'kit-1');

    assert.ok(asked.includes('keepForLooking:kit-1'), asked.join(' | '));
    assert.equal(asked.includes('putAway:kit-1'), false, 'it rolled back the evidence');
    assert.ok(said.some((m) => /kept: run-1 was still reading when this host lost sight of kit-1/.test(m)));
});

test('anything else goes back to the pool, and the machine is released either way', async () => {
    await onejudgement().run(snapshot(rec = JUDGEMENT()), 'kit-1');
    assert.ok(asked.includes('putAway:kit-1'));
    assert.deepEqual(released, ['kit-1']);

    released.length = 0;
    outcome = { state: 'unreachable' };
    await onejudgement().run(snapshot(rec = JUDGEMENT()), 'kit-1');
    assert.deepEqual(released, ['kit-1']);
});

//---- a sign-in that could not authenticate ---------------------------------------

test('it goes back in the queue, because it was never read', async () => {
    metered = { row: null, failedAuthAs: 'a-judge' };
    await onejudgement().run(snapshot(rec = JUDGEMENT()), 'kit-1');

    assert.equal(rec.state, 'queued');
    assert.equal(rec.machine, null);
    assert.equal(rec.run, null);
    assert.ok(said.some((m) => /WARN J36 is back in the queue — it was never read/.test(m)), said.join(' | '));
    assert.equal(archived.length, 0, 'it kept a log for a reading that never started');
});

test('the attempt that failed is the one marked, not the one before it', async () => {
    //THE VERSION THIS COMES FROM MARKED THE ATTEMPT BEFORE. It used the record
    //the caller was handed, read BEFORE the run started, so the list it wrote
    //back deleted the attempt that had just failed and marked an older one.
    metered = { row: null, failedAuthAs: 'a-judge' };
    const j = JUDGEMENT({ attempts: [{ run: 'run-0', machine: 'kit-9', at: 'earlier' }] });

    await onejudgement({}, j).run(snapshot(j), 'kit-1');

    assert.equal(rec.attempts.length, 2, 'the attempt that failed was deleted from the record');
    assert.equal(rec.attempts[0].run, 'run-0');
    assert.equal(rec.attempts[0].authFailed, undefined, 'it marked the attempt before the one that failed');
    assert.equal(rec.attempts[1].run, 'run-1');
    assert.equal(rec.attempts[1].authFailed, 'a-judge');
});

test('but only once, or it spends a machine every time round', async () => {
    metered = { row: null, failedAuthAs: 'a-judge' };
    const j = JUDGEMENT({ attempts: [{ run: 'run-0', machine: 'kit-9', authFailed: 'someone-else' }] });

    await onejudgement({}, j).run(snapshot(j), 'kit-1');

    assert.notEqual(rec.state, 'queued');
    assert.ok(said.some((m) => /BAD J36 could not authenticate a second time/.test(m)), said.join(' | '));
    assert.ok(said.some((m) => /Replace the judge sign-in on the Runners tab/.test(m)));
});

test('and nothing is fabricated when there is no attempt to mark', async () => {
    //AN EMPTY LIST SLICES TO AN EMPTY LIST, and the old shape turned that into
    //an attempt with no run, no machine and no time on it.
    metered = { row: null, failedAuthAs: 'a-judge' };
    const o = onejudgement({
        judging: {
            get: () => Object.assign({}, rec, { attempts: [] }),
            update: (id, patch) => { asked.push('judging.update'); Object.assign(rec, patch); }
        }
    });

    await o.run(snapshot(rec = JUDGEMENT()), 'kit-1');
    assert.deepEqual(rec.attempts, []);
});

//---- and the supervisor ----------------------------------------------------------

test('a finished judgement wakes it, and says what it concluded', async () => {
    //THE MORE IMPORTANT OF THE TWO WAKES. A task finishing produces work to look
    //at; a judgement finishing produces a DECISION to make.
    let why = null;
    const j = JUDGEMENT();
    const o = onejudgement({
        wakes: () => true,
        call: async (what, args) => {
            asked.push(what);
            if (what === 'supervisorWake') { why = args.why; return {}; }
            if (what === 'jobRun') return { run: 'run-1' };
            if (what === 'vmRunOutput') return { output: '' };
            return {};
        }
    }, j);

    await o.run(snapshot(j), 'kit-1');
    assert.match(why, /J36 finished — it concluded "accept"/);
});

test('and one that would not say still wakes it, saying so', async () => {
    let why = null;
    texts = { 'verdict.md': 'no answer here' };
    const j = JUDGEMENT();
    const o = onejudgement({
        wakes: () => true,
        call: async (what, args) => {
            asked.push(what);
            if (what === 'supervisorWake') { why = args.why; return {}; }
            if (what === 'jobRun') return { run: 'run-1' };
            if (what === 'vmRunOutput') return { output: '' };
            return {};
        }
    }, j);

    await o.run(snapshot(j), 'kit-1');
    assert.match(why, /it reached no conclusion/);
});

test('a supervisor that will not wake does not fail the reading', async () => {
    const j = JUDGEMENT();
    const o = onejudgement({
        wakes: () => true,
        call: async (what) => {
            asked.push(what);
            if (what === 'supervisorWake') throw new Error('it is not up');
            if (what === 'jobRun') return { run: 'run-1' };
            if (what === 'vmRunOutput') return { output: '' };
            return {};
        }
    }, j);

    await o.run(snapshot(j), 'kit-1');
    assert.equal(rec.state, 'done');
    assert.ok(asked.includes('putAway:kit-1'), 'a supervisor held up the machine being put away');
});

test('and it is not woken at all unless the setting says so', async () => {
    await onejudgement().run(snapshot(rec = JUDGEMENT()), 'kit-1');
    assert.equal(asked.includes('supervisorWake'), false);
});

//---- where the time went ------------------------------------------------------------

test('each phase is timed, and said as one line', async () => {
    let t = 0;
    await onejudgement({ now: () => (t += 1000) }).run(snapshot(rec = JUDGEMENT()), 'kit-1');

    const last = rec.attempts[rec.attempts.length - 1];
    for (const phase of ['bringUp', 'credential', 'workspace', 'reading']) {
        assert.ok(last.spent[phase] != null, phase + ' was not timed');
    }
    assert.ok(said.some((m) => /J36 took .* bringUp .*, credential .*, workspace .*, reading /.test(m)), said.join(' | '));
});

test('and fetching a pull request is timed too, because it is where the time goes', async () => {
    let t = 0;
    const j = JUDGEMENT({ subject: { kind: 'pull', on: 'them/theirs', number: 7, name: 'x' } });
    await onejudgement({ now: () => (t += 1000) }, j).run(snapshot(j), 'kit-1');

    assert.ok(rec.attempts[rec.attempts.length - 1].spent.fetching != null);
});
