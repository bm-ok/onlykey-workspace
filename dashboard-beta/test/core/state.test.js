const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const plugin = require('../../src/app/core/state/main');
const handover = require('../../src/app/core/state/server');

//the small things this app keeps between restarts.
//
//It exists because seven files were each doing it separately, and each got to
//decide on its own what a missing file means, what a half-written one means, and
//whether a failed write is worth mentioning. Four answered differently.

function aStore() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-state-'));
    let state = null;
    plugin({ dataDir: { at: (...p) => path.join(dir, ...p) } }, async (_e, s) => { state = s.state; });
    return { state, dir };
}

test('what is written comes back, and survives being read by another process', () => {
    const { state, dir } = aStore();
    state.app.doc('workspace').write({ dir: 'C:/somewhere', at: 'now' });

    //a second one over the same folder, which is what a restart is
    let again = null;
    plugin({ dataDir: { at: (...p) => path.join(dir, ...p) } }, async (_e, s) => { again = s.state; });

    assert.deepEqual(again.app.doc('workspace').read(null), { dir: 'C:/somewhere', at: 'now' });
});

test('nothing kept, and something unreadable, both answer what you said instead', () => {
    const { state } = aStore();
    assert.deepEqual(state.app.doc('never-written').read({ mine: true }), { mine: true });

    const doc = state.app.doc('broken');
    doc.write({ real: 1 });
    fs.writeFileSync(doc.path, '{ this is not json');
    assert.deepEqual(doc.read({ mine: true }), { mine: true },
        'a half-written document threw instead of answering the fallback');
});

//A BYTE-ORDER MARK IN FRONT OF THE BRACE is what anything on Windows picks up
//from having been opened in an editor, and JSON.parse refuses it — which reads
//as a corrupt file rather than as one somebody looked at.
test('a document somebody opened in an editor still reads', () => {
    const { state } = aStore();
    const doc = state.app.doc('looked-at');
    doc.write({ kept: true });
    fs.writeFileSync(doc.path, '\ufeff' + JSON.stringify({ kept: true }));
    assert.deepEqual(doc.read(null), { kept: true });
});

//A NAME, NOT A PATH — the same rule ../workspace keeps about repositories, for a
//sharper reason: this one WRITES.
test('a name is not a path', () => {
    const { state } = aStore();
    for (const bad of ['../escape', 'a/b', 'C:\\Windows\\x', '..', '', '  ', 'has space', 'dot.dot']) {
        assert.throws(() => state.app.doc(bad), /named in letters, digits and dashes/,
            'a path was accepted where a name belongs: ' + JSON.stringify(bad));
    }
    assert.doesNotThrow(() => state.app.doc('with-dashes-9'));
});

//WRITTEN BESIDE AND MOVED INTO PLACE. A writeFileSync straight over the real file
//is a window in which the file is half a document — and the reader that opens it
//then does not get an error, it gets the fallback, which every call site treats
//as "nothing kept yet". Losing the workspace to a flicker mid-write is a silent,
//total loss that reads as a fresh install.
test('a write leaves the old document or the new one, never half of either', () => {
    const { state, dir } = aStore();
    const doc = state.app.doc('workspace');
    doc.write({ dir: 'first' });

    const kept = path.join(dir, 'state');
    const before = fs.readdirSync(kept);
    doc.write({ dir: 'second' });

    assert.deepEqual(fs.readdirSync(kept).sort(), before.sort(),
        'a temporary file was left behind, so the next read may find one');
    assert.deepEqual(doc.read(null), { dir: 'second' });

    //the file the reader opens is complete JSON at every moment there is one
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(doc.path, 'utf8')));
});

test('forgetting is different from writing nothing', () => {
    const { state } = aStore();
    const doc = state.app.doc('workspace');
    doc.write({ dir: 'somewhere' });

    assert.equal(doc.forget(), true);
    assert.equal(doc.read(null), null, 'it came back as an empty document rather than as none');
    assert.equal(doc.forget(), false, 'forgetting what is not there claimed to have done something');
});

//THE SERVER HALF WITHOUT A MAIN BEHIND IT. Unlike the log, which hands back one
//that drops every line, a store that quietly forgot everything would be worse
//than none: a caller would write the workspace, read back nothing, and conclude
//it had been cleared.
test('with nowhere to keep it, reading answers and writing refuses', async () => {
    let state = null;
    await handover({ app: { host: {} } }, async (_e, s) => { state = s.state; });

    const doc = state.app.doc('workspace');
    assert.deepEqual(doc.read({ mine: true }), { mine: true });
    assert.throws(() => doc.write({ dir: 'x' }), /nothing is keeping state/);
    assert.throws(() => doc.forget(), /nothing is keeping state/);
});

//---------------------------------------------------------------------------
//TWO DRAWERS, WHICH IS THE WHOLE POINT.
//
//Fold them together and pointing the app at a second workspace leaves the first
//one's tasks there, answering, about repositories that are not in front of you.
//The app being ported from names this in its own code: "the contamination this
//whole file exists to prevent, arriving on the first switch".
//---------------------------------------------------------------------------

test('the workspace drawer is not the app drawer', async () => {
    const { state, dir } = aStore();
    state.follow(async () => path.join(dir, 'ws-one'));

    state.app.doc('tasks').write({ whose: 'the host' });
    (await state.here.doc('tasks')).write({ whose: 'ws-one' });

    assert.deepEqual(state.app.doc('tasks').read(null), { whose: 'the host' },
        'the workspace wrote over the host drawer');
    assert.deepEqual((await state.here.doc('tasks')).read(null), { whose: 'ws-one' });
});

test('changing workspace changes the drawer, with nothing told to reload', async () => {
    const { state, dir } = aStore();
    let open = path.join(dir, 'ws-one');
    state.follow(async () => open);

    (await state.here.doc('tasks')).write({ whose: 'ws-one' });

    //the only thing that happens on a switch
    open = path.join(dir, 'ws-two');
    assert.equal((await state.here.doc('tasks')).read(null), null,
        'the second workspace was answered with the first one tasks');

    (await state.here.doc('tasks')).write({ whose: 'ws-two' });

    open = path.join(dir, 'ws-one');
    assert.deepEqual((await state.here.doc('tasks')).read(null), { whose: 'ws-one' },
        'coming back did not find what was left here');
});

//TWO FOLDERS OF THE SAME NAME IN DIFFERENT PLACES is the most likely form of the
//contamination, so the slug carries the whole path and not only the name.
test('two workspaces called the same thing do not share a drawer', () => {
    const { state } = aStore();
    const a = state.slugFor('/somewhere/workspace');
    const b = state.slugFor('/elsewhere/workspace');

    assert.notEqual(a, b, 'two different folders share one drawer');
    assert.match(a, /^workspace-/, 'the drawer is not named after the folder, so nobody can tell whose it is');
    assert.equal(a, state.slugFor('/somewhere/workspace'), 'the same folder got two different drawers');
});

//NOTHING OPEN IS NOT A DEFAULT DRAWER. A window about nowhere must not be
//answered with the tasks of the last place, and a write with nowhere to go is
//refused rather than dropped: "saved" and "there was nowhere to save it" are
//different answers.
test('with no workspace open, the workspace drawer refuses rather than falling back', async () => {
    const { state } = aStore();

    assert.equal(await state.here.open(), false);
    assert.equal(await state.here.where(), null);
    await assert.rejects(() => state.here.doc('tasks'), /No workspace is open/);
    await assert.rejects(() => state.here.doc('tasks'), /state.app for what is not/);

    //and one that cannot answer is not one that is open
    state.follow(async () => { throw new Error('the relay is down'); });
    await assert.rejects(() => state.here.doc('tasks'), /No workspace is open/);
});

//WORKSPACE STATE LIVES INSIDE THE WORKSPACE, at `<the folder>/.okc/`, AND THIS
//TEST USED TO ASSERT THE OPPOSITE.
//
//It held the drawer under the app directory, for a good reason that is written
//out in ../../src/app/core/state/main.js: a workspace folder can be deleted or
//`git clean -xdf`'d, and state in there goes with it. That cost is now accepted
//in exchange for a workspace having ONE name — the folder — with no slug to
//recompute and nothing left in appdata when the folder goes.
//
//THE FAILURE IT WAS TRADED AGAINST is the one that actually happened: the drawer
//was keyed by a hash of the path, the machine register was not in it at all, and
//every workspace showed every other workspace's machines.
test('a workspace keeps its state inside itself, in .okc', async () => {
    const { state, dir } = aStore();
    const ws = path.join(dir, 'a-workspace');
    fs.mkdirSync(ws, { recursive: true });
    state.follow(async () => ws);

    const doc = await state.here.doc('tasks');
    doc.write({ kept: true });

    assert.equal(doc.path, path.join(ws, '.okc', 'tasks.json'));
    assert.deepEqual(fs.readdirSync(ws), ['.okc']);
    assert.deepEqual(fs.readdirSync(path.join(ws, '.okc')), ['.gitignore', 'tasks.json']);

    //AND THE HOST'S DRAWER IS STILL THE HOST'S. Only what is ABOUT a folder
    //moved; the guards, the settings and the approval library have no folder to
    //live in and did not.
    const mine = state.app.doc('settings');
    assert.ok(mine.path.startsWith(path.join(dir, 'state')),
        'the host drawer moved and should not have: ' + mine.path);

    //---- AND THE HOST'S DRAWER DOES NOT GET THE GUARD ---------------------
    //
    //It is under appdata, where a .gitignore protects nothing and puzzles
    //whoever finds it. `ready` makes both drawers and tells them apart by the
    //folder's name — see ../../src/app/core/state/main.js.
    assert.ok(!fs.existsSync(path.join(dir, 'state', '.gitignore')),
        'the host drawer was given a .gitignore, which guards nothing there');
});

//---------------------------------------------------------------------------
//AND THE DRAWER CANNOT BE COMMITTED IF IT EVER LANDS INSIDE A REPOSITORY.
//
//A drawer sits BESIDE the repositories, not within them — but that is a layout,
//and one `git init` at the wrong level makes it wrong. `machines.json` carries
//every machine's dial-in token and the password its user boots as, so the cost
//of being wrong once is real. See ../../src/app/core/state/ignore.js.
//---------------------------------------------------------------------------

test('a drawer hides the host\'s half and keeps the workspace\'s', async () => {
    const { state, dir } = aStore();
    const ws = path.join(dir, 'guarded');
    fs.mkdirSync(ws, { recursive: true });
    state.follow(async () => ws);

    (await state.here.doc('tasks')).write({ kept: true });

    const at = path.join(ws, '.okc', '.gitignore');
    assert.ok(fs.existsSync(at), 'a drawer was made with no .gitignore in it');

    const rules = fs.readFileSync(at, 'utf8').split('\n')
        .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

    //THE ONE THAT MUST BE THERE. `machines.json` is every machine's dial-in
    //token and the password its user boots as; the rest of this list is tidiness
    //and this line is the reason the file exists.
    assert.ok(rules.includes('machines.json'),
        'the drawer does not hide machines.json, which holds the machine tokens');

    //A PATTERN, BECAUSE THE NAMES ARE BUILT. ../core/cached/server.js writes
    //`cached-<whatever>`, so naming today's two would miss tomorrow's.
    assert.ok(rules.includes('cached-*.json'),
        'caches are named one by one, so a new one would be committed: ' + rules.join(' | '));

    //AND NOT A BLANKET IGNORE. Most of a drawer is what somebody wants to keep —
    //see ../../src/app/core/state/ignore.js. `*` here would hide the jobs, the
    //prompts, the contracts and the record of what is being done, silently.
    assert.ok(!rules.includes('*'),
        'the drawer ignores everything, which hides the set a workspace is built from');

    //WHAT A WORKER REMEMBERED, which is the biggest thing that lands here and
    //the one nothing else would catch. `sessions/` is a tar of a machine's
    //`~/.claude` per branch cut -- every turn it was told, megabytes a task,
    //made by a machine THIS host lent a credential to. It appears the first
    //time a worker runs in a workspace, which is exactly when nobody is looking
    //at the drawer.
    assert.ok(rules.includes('sessions/'),
        'the drawer does not hide sessions/, so the first worker run puts a tar of everything '
        + 'it was told in front of `git add`: ' + rules.join(' | '));

    //AND WHAT A RUN HANDED BACK, which is the same omission one folder along and
    //was found by looking for it after `sessions/`. `artifacts/` is whatever
    //work PRODUCED -- a built binary, a screenshot, a log carrying command
    //output -- up to 64 MB a file.
    //
    //WORSE THAN A SESSION IN ONE RESPECT. A session is a transcript this host
    //made; an artifact is a file this host did not choose, written by a worker
    //deciding for itself what was worth handing over.
    //
    //THE FOLDER AND NOT ITS LANES. `artifacts/worker/`, `artifacts/judge/` and
    //`artifacts/job/` are all under it, and naming three would be three chances
    //to add a fourth lane and forget.
    assert.ok(rules.includes('artifacts/'),
        'the drawer does not hide artifacts/, so the first file a run hands back is staged for '
        + 'commit -- and what is in one was chosen by a worker: ' + rules.join(' | '));

    //THE GUARD ITSELF IS TRACKED, or a clone arrives with no guard at all and
    //the first `add -A` there commits the tokens.
    assert.ok(!rules.includes('.gitignore'),
        'the guard ignores itself, so a clone of this would have no guard');
});

test('what a workspace is set up from is left trackable', async () => {
    const { state, dir } = aStore();
    const ws = path.join(dir, 'shared');
    fs.mkdirSync(ws, { recursive: true });
    state.follow(async () => ws);

    (await state.here.doc('lines')).write({ kept: true });

    const rules = fs.readFileSync(path.join(ws, '.okc', '.gitignore'), 'utf8').split('\n')
        .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

    //NAMED ONE BY ONE, because each is a decision somebody made rather than
    //something a sweep rebuilds. `repositories.json` is the argued one: it
    //carries this host's probe results AND `target` — where work goes — and
    //losing the second to hide the first is the wrong trade.
    ['library.json', 'lines.json', 'cuts.json', 'landings.json',
        'pr-template.json', 'repositories.json', 'tasks.json'].forEach((f) => {
        assert.ok(!rules.includes(f), f + ' is hidden, and it is the workspace\'s own');
    });
});

test('a drawer that already has one is left exactly as it is', async () => {
    const { state, dir } = aStore();
    const ws = path.join(dir, 'already');
    fs.mkdirSync(path.join(ws, '.okc'), { recursive: true });

    //SOMEBODY ELSE'S DECISION ABOUT THEIR OWN REPOSITORY. This is a guard rail,
    //not a policy, so what is here already wins — overwriting it would be the
    //app taking an argument it was not asked to have.
    const mine = '# mine\n!keep-this\n';
    fs.writeFileSync(path.join(ws, '.okc', '.gitignore'), mine);

    state.follow(async () => ws);
    (await state.here.doc('tasks')).write({ kept: true });

    assert.equal(fs.readFileSync(path.join(ws, '.okc', '.gitignore'), 'utf8'), mine,
        'it wrote over a .gitignore somebody had already put there');
});
