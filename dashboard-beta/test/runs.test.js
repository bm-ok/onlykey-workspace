const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const statePlugin = require('../src/app/core/state/main');
const makeRuns = require('../src/app/tests/runs');

//---------------------------------------------------------------------------
//what the drills remember.
//
//THE REAL ../core/state, WITH A WORKSPACE THAT MOVES. The claim this store is
//being ported for is that a result belongs to the folder it was made against —
//and that used to be a `workspace` field, a `claim()` and a `forWorkspace()`
//written inside a file kept in the app drawer. It is the drawer's job now, so
//the only way to test it is to move the workspace underneath a live store.
//
//A fake state would pass every one of these with the drawer ignored entirely.
//---------------------------------------------------------------------------

function aStore() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-runs-'));
    let open = 'C:\\work\\alpha';

    let state = null;
    statePlugin({ dataDir: { at: (...p) => path.join(dir, ...p) } }, async (_e, s) => { state = s.state; });
    state.follow(async () => open);

    return { runs: makeRuns(state), state, dir, go: (to) => { open = to; }, where: () => open };
}

const passed = (extra) => Object.assign({ state: 'passed', ms: 12 }, extra || {});

test('nothing kept reads as an empty board', async () => {
    const { runs } = aStore();
    assert.deepEqual((await runs.all()).checks, {});
    assert.equal(await runs.lastRun(), null);
    assert.equal(await runs.recall('s', 't', 'c'), null);
});

test('a check is remembered and read back', async () => {
    const { runs } = aStore();
    await runs.remember('machines', 'goes away clean', 'the snapshot is restored', passed({ why: null }));

    const back = await runs.recall('machines', 'goes away clean', 'the snapshot is restored');
    assert.equal(back.state, 'passed');
    assert.equal(back.ms, 12);
    assert.ok(back.at, 'it did not record when');
});

//A FILE'S TITLE IS ONLY UNIQUE INSIDE ITS FOLDER, so a key made of two parts
//would quietly merge two different checks that happen to share a name — and the
//one that would win is whichever ran second.
test('the same check name in two suites is two checks', async () => {
    const { runs } = aStore();
    await runs.remember('machines', 'a series', 'it is refused', passed());
    await runs.remember('tasks', 'a series', 'it is refused', { state: 'failed', why: 'nope' });

    assert.equal((await runs.recall('machines', 'a series', 'it is refused')).state, 'passed',
        'a check in another suite overwrote this one');
    assert.equal((await runs.recall('tasks', 'a series', 'it is refused')).state, 'failed');
});

//---------------------------------------------------------------------------
//A RESULT CANNOT OUTLIVE THE CODE IT IS ABOUT.
//
//The whole argument for keeping results across a restart was answered by storing
//what the check WAS when it produced one. An edited check does not report as
//green and does not report as failed — both would be claims about code nothing
//has run. It says the check changed, which is the honest third answer.
//---------------------------------------------------------------------------
test('a result whose check has been edited is not a result', async () => {
    const { runs } = aStore();
    await runs.remember('machines', 'a series', 'a step', passed({ fingerprint: 'aaa' }));

    assert.equal((await runs.recall('machines', 'a series', 'a step', 'aaa')).state, 'passed',
        'the same check read as changed');

    const stale = await runs.recall('machines', 'a series', 'a step', 'bbb');
    assert.equal(stale.state, 'changed', 'an edited check went on reporting its old verdict');
    assert.equal(stale.stale, true);
    assert.match(stale.why, /edited since/);
});

//---------------------------------------------------------------------------
//THE ONE THIS WAS MOVED FOR.
//
//A result is about the folder of repositories it was made against. Over there
//that is a field inside the file and a filter every reader has to remember; here
//it is which drawer the document is in, so a reader that forgets to filter
//cannot be written.
//
//AND SWITCHING BACK BRINGS IT BACK, which is the behaviour change. `claim()`
//CLEARED the board when the folder changed — so looking at another workspace and
//returning left nothing, and half an hour of evidence about building a machine
//from an ISO was gone because somebody glanced elsewhere.
//---------------------------------------------------------------------------
test('the board follows the workspace, and nothing is destroyed by switching', async () => {
    const { runs, go } = aStore();
    await runs.remember('machines', 'from an ISO', 'it comes up', passed({ ms: 1800000 }));
    assert.equal((await runs.recall('machines', 'from an ISO', 'it comes up')).state, 'passed');

    go('C:\\work\\beta');
    assert.equal(await runs.recall('machines', 'from an ISO', 'it comes up'), null,
        "another folder was shown alpha's evidence");
    await runs.remember('machines', 'from an ISO', 'it comes up', { state: 'failed', why: 'not here' });

    go('C:\\work\\alpha');
    const back = await runs.recall('machines', 'from an ISO', 'it comes up');
    assert.equal(back.state, 'passed', 'coming back found beta\'s result, or none at all');
    assert.equal(back.ms, 1800000, 'the half hour of evidence did not survive a glance elsewhere');
});

test('with no workspace open there is nowhere to keep a result, and it says so', async () => {
    const { runs, go } = aStore();
    go(null);
    await assert.rejects(() => runs.remember('s', 't', 'c', passed()), /No workspace is open/);
});

//---------------------------------------------------------------------------
//THE RUN THAT WAS INTERRUPTED, and how it is told apart from one still going.
//---------------------------------------------------------------------------

//THE RECORD NAMING THIS PROCESS IS A PID THAT HAS BEEN REUSED. `tookOver` runs
//at startup, so a run marked running and stamped with our own pid cannot be a
//run we are in the middle of — we have only just begun.
test('a run whose process is gone is taken over and its checks say why', async () => {
    const { runs } = aStore();
    await runs.began('everything');
    await runs.remember('machines', 'a series', 'a step', { state: 'running' });
    await runs.remember('machines', 'a series', 'done already', passed());

    assert.equal(await runs.tookOver(), true, 'the interrupted run was left marked running');

    const after = await runs.all();
    assert.equal(after.run.interrupted, true);
    assert.equal(after.run.running, false);
    assert.equal(after.checks['machines / a series / a step'].state, 'interrupted');
    assert.match(after.checks['machines / a series / a step'].why, /restarted while this was running/);
    //ONLY WHAT WAS IN FLIGHT. A check that had already finished is evidence, and
    //a restart says nothing about it.
    assert.equal(after.checks['machines / a series / done already'].state, 'passed',
        'a finished check was rewritten as interrupted');
});

test('nothing to take over when no run was going', async () => {
    const { runs } = aStore();
    assert.equal(await runs.tookOver(), false);
    await runs.began('everything');
    await runs.ended({ passed: 1 });
    assert.equal(await runs.tookOver(), false, 'a finished run was taken over');
});

//---------------------------------------------------------------------------
//A LIVE RUN MARKED INTERRUPTED CORRUPTS THE BOARD IT IS WRITING, which is worse
//than a stale record left saying running — that one the next run reports plainly.
//So a pid that is alive and is NOT this process is somebody else's run.
//
//The parent process stands in: alive, by definition, and not us.
//---------------------------------------------------------------------------
test('a run somebody else is in the middle of is left alone', async () => {
    const { runs } = aStore();
    await runs.began('everything');

    const file = await runs.where();
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.run.pid = process.ppid;
    fs.writeFileSync(file, JSON.stringify(raw));

    assert.equal(runs.stillThere(process.ppid), true, 'the fixture picked a dead pid');
    assert.equal(runs.stillThere(0x7ffffffe), false, 'stillThere says yes to everything');

    assert.equal(await runs.tookOver(), false, "somebody else's live run was marked interrupted");
    assert.equal((await runs.all()).run.running, true);
});

//---------------------------------------------------------------------------
//A SUITE THAT PASSES IS A CLAIM ABOUT THE SUITE.
//---------------------------------------------------------------------------

test('running one test inside a suite does not leave the suite green', async () => {
    const { runs } = aStore();
    await runs.ranWhole('machines');
    assert.equal((await runs.wholeState('machines')).dirty, false);

    await runs.dirty('machines');
    assert.equal((await runs.wholeState('machines')).dirty, true);
    assert.ok((await runs.wholeState('machines')).at, 'when it last ran whole was thrown away');
});

//DISPROVED IS STRONGER THAN STALE, and only a clean whole run withdraws it. This
//wrote a fresh record at first, which dropped `disprovedBy` — so a suite shown
//to be false went quietly back to merely wanting a re-run the next time anything
//dirtied it, which on a busy board is minutes.
test('a contradiction survives being dirtied and is withdrawn only by a whole run', async () => {
    const { runs } = aStore();
    await runs.ranWhole('machines');
    await runs.disprove('machines', { suite: 'tasks', check: 'it went back to base', why: 'it did not' });

    await runs.dirty('machines');
    const still = await runs.wholeState('machines');
    assert.ok(still.disprovedBy, 'the contradiction was downgraded to stale');
    assert.equal(still.disprovedBy.suite, 'tasks');
    assert.match(still.disprovedBy.why, /did not/, 'a red mark that cannot name its cause');

    await runs.ranWhole('machines');
    assert.equal((await runs.wholeState('machines')).disprovedBy, undefined,
        'running the suite did not withdraw the contradiction');
});

//---------------------------------------------------------------------------
//PROGRESS IS COUNTED OFF THIS RUN, not off the board.
//---------------------------------------------------------------------------
test('yesterday\'s passes do not report as progress', async () => {
    const { runs } = aStore();
    await runs.remember('machines', 'old', 'a step', { state: 'passed', at: '2020-01-01T00:00:00.000Z' });

    assert.equal(await runs.progress(), null, 'it reported progress with no run going');

    await runs.began('everything');
    assert.equal((await runs.progress()).done, 0, 'a board full of old passes counted as progress');

    await runs.remember('machines', 'now', 'a step', passed());
    await runs.remember('machines', 'now', 'another', { state: 'failed' });
    const p = await runs.progress();
    assert.equal(p.passed, 1);
    assert.equal(p.failed, 1);
    assert.equal(p.done, 2);

    await runs.ended({ passed: 1 });
    assert.equal(await runs.progress(), null, 'a finished run still reported as going');
});

//WHAT IT WAS DOING A MOMENT AGO, for the gap between checks. Sampled during a
//suite of sub-second refusals the answer was "nothing" more often than not, and
//the banner read "starting" after ten checks had already passed.
test('between two checks it names the one that just finished', async () => {
    const { runs } = aStore();
    await runs.began('everything');
    await runs.remember('machines', 'a series', 'first', passed());
    assert.equal((await runs.progress()).doing, 'machines / a series / first');

    await runs.remember('machines', 'a series', 'second', { state: 'running' });
    assert.equal((await runs.progress()).doing, 'machines / a series / second',
        'a check that is actually running lost to the one before it');
});

//---- a drill's own note ----------------------------------------------------

test('a drill may leave itself a note across a restart, and only what survives JSON', async () => {
    const { runs } = aStore();
    await runs.saveState('tasks', 'the queue picks up', { got: 'as far as dispatch', when: 3 });
    assert.deepEqual(await runs.loadState('tasks', 'the queue picks up'), { got: 'as far as dispatch', when: 3 });

    await runs.forgetState('tasks', 'the queue picks up');
    assert.equal(await runs.loadState('tasks', 'the queue picks up'), null);

    //a machine handle would be gone after the restart it is testing, and the
    //failure would look like the app's rather than the drill's
    await runs.saveState('tasks', 'x', { fn: function () {}, ok: 1 });
    assert.deepEqual(await runs.loadState('tasks', 'x'), { ok: 1 });
});

//---- forgetting ------------------------------------------------------------

test('forgetting a test inside a suite leaves the suite no longer whole', async () => {
    const { runs } = aStore();
    await runs.ranWhole('machines');
    await runs.remember('machines', 'a series', 'a step', passed());

    const gone = await runs.forget({ group: 'machines', test: 'a series' });
    assert.ok(gone >= 1, 'nothing was forgotten');
    assert.equal(await runs.recall('machines', 'a series', 'a step'), null);
    assert.equal((await runs.wholeState('machines')).dirty, true,
        'a suite-level pass was left covering a result that is now gone');
});

test('forgetting everything leaves nothing behind, including the run', async () => {
    const { runs } = aStore();
    await runs.began('everything');
    await runs.remember('machines', 'a series', 'a step', passed());
    await runs.ranWhole('machines');
    await runs.saveState('machines', 'a series', { half: 'way' });

    await runs.forget();
    const after = await runs.all();
    assert.deepEqual(after.checks, {});
    assert.deepEqual(after.wholes, {});
    assert.deepEqual(after.states, {}, 'a drill still thinks it is half way through something');
    assert.equal(after.run, null);
});

//AND FORGETTING IS PER WORKSPACE TOO, because the drawer is. Clearing the board
//before a demonstration must not reach into the evidence about another folder.
test('a clean board here leaves the other workspace alone', async () => {
    const { runs, go } = aStore();
    await runs.remember('machines', 'a series', 'a step', passed());

    go('C:\\work\\beta');
    await runs.remember('machines', 'a series', 'a step', { state: 'failed' });
    await runs.forget();

    go('C:\\work\\alpha');
    assert.equal((await runs.recall('machines', 'a series', 'a step')).state, 'passed',
        'clearing one workspace\'s board reached into another\'s');
});
