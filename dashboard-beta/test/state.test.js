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
    state.doc('workspace').write({ dir: 'C:/somewhere', at: 'now' });

    //a second one over the same folder, which is what a restart is
    let again = null;
    plugin({ dataDir: { at: (...p) => path.join(dir, ...p) } }, async (_e, s) => { again = s.state; });

    assert.deepEqual(again.doc('workspace').read(null), { dir: 'C:/somewhere', at: 'now' });
});

test('nothing kept, and something unreadable, both answer what you said instead', () => {
    const { state } = aStore();
    assert.deepEqual(state.doc('never-written').read({ mine: true }), { mine: true });

    const doc = state.doc('broken');
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
    const doc = state.doc('looked-at');
    doc.write({ kept: true });
    fs.writeFileSync(doc.path, '\ufeff' + JSON.stringify({ kept: true }));
    assert.deepEqual(doc.read(null), { kept: true });
});

//A NAME, NOT A PATH — the same rule ../workspace keeps about repositories, for a
//sharper reason: this one WRITES.
test('a name is not a path', () => {
    const { state } = aStore();
    for (const bad of ['../escape', 'a/b', 'C:\\Windows\\x', '..', '', '  ', 'has space', 'dot.dot']) {
        assert.throws(() => state.doc(bad), /named in letters, digits and dashes/,
            'a path was accepted where a name belongs: ' + JSON.stringify(bad));
    }
    assert.doesNotThrow(() => state.doc('with-dashes-9'));
});

//WRITTEN BESIDE AND MOVED INTO PLACE. A writeFileSync straight over the real file
//is a window in which the file is half a document — and the reader that opens it
//then does not get an error, it gets the fallback, which every call site treats
//as "nothing kept yet". Losing the workspace to a flicker mid-write is a silent,
//total loss that reads as a fresh install.
test('a write leaves the old document or the new one, never half of either', () => {
    const { state, dir } = aStore();
    const doc = state.doc('workspace');
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
    const doc = state.doc('workspace');
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

    const doc = state.doc('workspace');
    assert.deepEqual(doc.read({ mine: true }), { mine: true });
    assert.throws(() => doc.write({ dir: 'x' }), /nothing is keeping state/);
    assert.throws(() => doc.forget(), /nothing is keeping state/);
});
