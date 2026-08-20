const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const plugin = require('../src/app/core/state/main');
const handover = require('../src/app/core/state/server');

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

//WORKSPACE STATE LIVES UNDER THE APP, NEVER INSIDE THE WORKSPACE. That folder
//belongs to somebody else and is one `git clean -xdf` from gone, with the
//machines it describes still running.
test('nothing is written inside the workspace itself', async () => {
    const { state, dir } = aStore();
    const ws = path.join(dir, 'a-workspace');
    fs.mkdirSync(ws, { recursive: true });
    state.follow(async () => ws);

    const doc = await state.here.doc('tasks');
    doc.write({ kept: true });

    assert.deepEqual(fs.readdirSync(ws), [], 'it wrote into the workspace folder');
    assert.ok(doc.path.startsWith(path.join(dir, 'state', 'workspaces')),
        'the workspace drawer is not under the app directory: ' + doc.path);
});
