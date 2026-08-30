const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const makeLayout = require('../../src/app/library/layout');
const bundle = require('../../src/app/bootstrap/bundle');

//---------------------------------------------------------------------------
//THE LIBRARY, KEPT THE WAY A BUNDLE IS LAID OUT.
//
//A workspace's drawer IS a bundle: `library.json` beside `contracts/`,
//`prompts/`, `jobs/`. The claim worth testing is that the two really are one
//shape — an exported tar unpacked into a drawer has to BE that library, with no
//import step in between — and everything below is a way of asking that.
//
//THREE LIBRARIES SHARE ONE MANIFEST, which is the part that breaks quietly:
//saving a contract must not drop the prompts, and a read-modify-write that only
//knew its own kind would do exactly that on every save.
//---------------------------------------------------------------------------

let at;

beforeEach(() => { at = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-layout-')); });

const store = (kind) => makeLayout(async () => at, kind);
const box = async (kind) => await store(kind).at();

const manifest = () => JSON.parse(fs.readFileSync(path.join(at, 'library.json'), 'utf8'));

//---- it is the bundle's layout, not one of its own --------------------------

test('the folders and suffixes are the ones the bundle writer uses', () => {
    //ASKED FOR RATHER THAN REPEATED. Two copies of "a contract goes in
    //contracts/ and ends .md" stay equal until somebody changes one, and the
    //whole value of this layout is that the tar and the drawer agree exactly.
    assert.equal(makeLayout.FOLDER, bundle.FOLDER);
    assert.equal(makeLayout.SUFFIX, bundle.SUFFIX);
});

test('a bundle unpacked into a folder reads as the library', async () => {
    //WRITTEN BY THE BUNDLE WRITER ITSELF, so this cannot pass by agreeing with
    //my own idea of the layout — it is the real thing, in the real shape.
    bundle.write(at, {
        contract: [{ id: 'delivery-rules', name: 'how work is delivered', about: 'commit it', kind: 'task' }],
        prompt: [{ id: 'take-stock', name: 'take stock', kind: 'task', contractId: 'delivery-rules' }]
    }, (kind, e) => (kind === 'contract' ? '# rules\n' : 'look around and report'), []);

    const kept = (await box('contract')).read([]);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].id, 'delivery-rules');
    assert.equal(kept[0].name, 'how work is delivered');
    //THE BODY IS PUT BACK ON THE WAY OUT, so everything above this goes on
    //seeing one record with its text in it.
    assert.equal(kept[0].text, '# rules\n');

    const told = (await box('prompt')).read([]);
    assert.equal(told[0].text, 'look around and report');
    assert.equal(told[0].contractId, 'delivery-rules');
});

test('nothing kept yet reads as the fallback, not as a failure', async () => {
    assert.deepEqual((await box('contract')).read([]), []);
});

//---- writing ---------------------------------------------------------------

test('the text goes to a file and is not left in the manifest', async () => {
    const b = await box('contract');
    b.write([{ id: 'rules', name: 'the rules', kind: 'task', text: '# do not force-push\n' }]);

    assert.equal(fs.readFileSync(path.join(at, 'contracts', 'rules.md'), 'utf8'), '# do not force-push\n');

    //A CONTRACT IS PROSE SOMEBODY WRITES AND A WORKER IS HELD TO. Keeping it
    //escaped inside an array as well would be two copies, and the file is the
    //one a person can open.
    const m = manifest();
    assert.equal(m.kinds.contract[0].text, undefined);
    assert.equal(m.kinds.contract[0].name, 'the rules');
});

test('what was written comes back, text and all', async () => {
    (await box('contract')).write([{ id: 'rules', name: 'the rules', kind: 'task', text: 'one\n' }]);
    const back = (await box('contract')).read([]);
    assert.equal(back[0].text, 'one\n');
});

test('the whole record survives, including the approval', async () => {
    //THE DRAWER IS THE WORKING STORE AND A BUNDLE IS A THING BEING SENT. The
    //bundle carries four fields; this has to carry everything, or approving
    //something would not survive the next save.
    const approval = { at: 'when', by: 'the window', hash: 'abc' };
    (await box('contract')).write([
        { id: 'rules', name: 'the rules', kind: 'task', text: 'x', approval, written: 'then', edited: 'later' }
    ]);

    const back = (await box('contract')).read([])[0];
    assert.deepEqual(back.approval, approval);
    assert.equal(back.written, 'then');
    assert.equal(back.edited, 'later');
});

//---- the one that breaks quietly -------------------------------------------

test('saving one kind does not lose the others', async () => {
    (await box('contract')).write([{ id: 'rules', name: 'rules', kind: 'task', text: 'a' }]);
    (await box('prompt')).write([{ id: 'ask', name: 'ask', kind: 'task', text: 'b' }]);
    (await box('job')).write([{ id: 'run-it', name: 'run it', kind: 'task', promptId: 'ask' }]);

    //THREE LIBRARIES, ONE FILE. A read-modify-write that only knew about its own
    //kind would drop the other two every time anything was saved — and the loss
    //would look like "nothing kept yet", which nobody questions.
    (await box('contract')).write([{ id: 'rules', name: 'renamed', kind: 'task', text: 'a' }]);

    const m = manifest();
    assert.deepEqual(m.kinds.contract.map((e) => e.name), ['renamed']);
    assert.deepEqual(m.kinds.prompt.map((e) => e.id), ['ask']);
    assert.deepEqual(m.kinds.job.map((e) => e.id), ['run-it']);
});

test('the skills a bundle brought are left alone by a save', async () => {
    bundle.write(at, {}, () => '', [{ which: 'worker', title: 'the worker', text: '# be careful' }]);

    (await box('contract')).write([{ id: 'rules', name: 'rules', kind: 'task', text: 'a' }]);

    assert.deepEqual(manifest().skills.map((s) => s.which), ['worker']);
    assert.ok(fs.existsSync(path.join(at, 'skills', 'worker.md')));
});

//---- taking one away -------------------------------------------------------

test('an entry taken out has its file taken away too', async () => {
    const b = await box('contract');
    b.write([
        { id: 'one', name: 'one', kind: 'task', text: 'a' },
        { id: 'two', name: 'two', kind: 'task', text: 'b' }
    ]);
    assert.ok(fs.existsSync(path.join(at, 'contracts', 'two.md')));

    (await box('contract')).write([{ id: 'one', name: 'one', kind: 'task', text: 'a' }]);

    //A FILE LEFT BEHIND IS INVISIBLE, because the manifest is what says what is
    //in a bundle — so an orphan would sit in the folder unlisted until somebody
    //looked, and then look like something that failed to import.
    assert.equal(fs.existsSync(path.join(at, 'contracts', 'two.md')), false);
    assert.ok(fs.existsSync(path.join(at, 'contracts', 'one.md')));
});

//---- a job's body is not this file's ---------------------------------------

test('a job is listed here and its code is left where it lives', async () => {
    fs.mkdirSync(path.join(at, 'jobs'), { recursive: true });
    fs.writeFileSync(path.join(at, 'jobs', 'run-it.js'), 'module.exports = 1;\n');

    (await box('job')).write([{ id: 'run-it', name: 'run it', kind: 'task', promptId: 'ask' }]);

    //THE CODE IS WRITTEN AND READ BY ../library/server.js, which had it on disk
    //before this existed. Writing it here as well would be two owners of one
    //file, and the second one wins whichever way round that goes wrong.
    assert.equal(fs.readFileSync(path.join(at, 'jobs', 'run-it.js'), 'utf8'), 'module.exports = 1;\n');
    assert.equal((await box('job')).read([])[0].text, undefined);
    assert.equal(manifest().kinds.job[0].promptId, 'ask');
});

//---- what it refuses to guess ----------------------------------------------

test('a missing body reads as empty rather than throwing', async () => {
    (await box('contract')).write([{ id: 'rules', name: 'rules', kind: 'task', text: 'a' }]);
    fs.unlinkSync(path.join(at, 'contracts', 'rules.md'));

    //THE MANIFEST IS WHAT SAYS A THING EXISTS. A contract whose file somebody
    //deleted is a contract with no rules in it — which the approval check then
    //refuses on, rather than this failing the whole read and emptying the pane.
    const back = (await box('contract')).read([]);
    assert.equal(back.length, 1);
    assert.equal(back[0].text, '');
});

test('a manifest that is not JSON is refused, not read as empty', async () => {
    fs.writeFileSync(path.join(at, 'library.json'), '{ this is not json');

    //UNREADABLE IS NOT EMPTY. Answering "no contracts" for a file somebody broke
    //by hand would let the app carry on and write a fresh one over the top of
    //it — and this file is MEANT to be opened in an editor, so that is likelier
    //here than anywhere else in the app.
    await assert.rejects(async () => (await box('contract')).read([]), /could not be read as JSON/);
});

test('a byte-order mark in front of the brace is not corruption', async () => {
    fs.writeFileSync(path.join(at, 'library.json'),
        '﻿' + JSON.stringify({ made: 'okc', kinds: { contract: [{ id: 'r', name: 'r', kind: 'task' }] } }));

    assert.equal((await box('contract')).read([])[0].id, 'r');
});

test('with no workspace open there is no library, and it says so', async () => {
    const nowhere = makeLayout(async () => null, 'contract');
    await assert.rejects(() => nowhere.at(), /No workspace is open/);
});
