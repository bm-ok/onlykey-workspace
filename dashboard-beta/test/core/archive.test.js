const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const statePlugin = require('../../src/app/core/state/main');
const archivePlugin = require('../../src/app/core/archive/server');
const nanotar = require('../../src/app/core/archive/vendor/nanotar/nanotar.js');

//---------------------------------------------------------------------------
//where files are kept when a machine hands them back, and how they are read.
//
//THREE THINGS IN THIS APP HAND BYTES TO A HOST AND WANT THEM AGAIN: a run's
//output, a task's artefacts, and a worker's session. They are three stores with
//three lifetimes; the machinery under them is one thing, and this is it.
//
//THE CLAIMS:
//
//  * kept in the WORKSPACE's drawer, so a second workspace does not show the
//    first one's artefacts — the contamination core/state exists to prevent,
//    which applies to what a run produced as much as to the note about it
//  * a second file of the same name is a second DELIVERY, never an overwrite.
//    Two runs of one task both produce firmware.bin
//  * a name never becomes a path. A guest sends a name; this decides where it
//    goes, and there is nothing to traverse out of because nothing arrives
//  * a binary is refused on read rather than rendered as replacement characters
//  * nowhere to keep it is REFUSED, not dropped — "saved" and "there was
//    nowhere to save it" are different answers
//  * and looking inside an archive never throws, whatever came off the machine
//---------------------------------------------------------------------------

let archive, state, work, dataDir;

beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-arch-'));
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-arch-ws-'));

    state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dataDir, ...p) } }, async (_e, s) => { state = s.state; });
    let at = work;
    state.follow(async () => at);
    state.moveTo = (p) => { at = p; };

    archive = null;
    await archivePlugin({ state }, async (_e, s) => { archive = s.archive; });
});

const bytes = (s) => Buffer.from(s, 'utf8');

//---------------------------------------------------------------------------
//WHERE IT GOES.
//---------------------------------------------------------------------------

test('a file is kept in the workspace’s drawer, under its own kind', async () => {
    const files = archive.store('artifacts');
    const kept = await files.keep('task-uid-1', 'firmware.bin', bytes('not really a binary'), { run: 'r1' });

    const here = await state.here.where();
    assert.ok(kept.path.startsWith(path.join(here, 'artifacts', 'task-uid-1')),
        'kept at ' + kept.path + ', expected under ' + here);

    //INSIDE THE WORKSPACE, IN `.okc`, AND THIS ASSERTED THE OPPOSITE. The old
    //line held artifacts out of the folder because it is one `git clean -xdf`
    //from gone. That is still true and is now an accepted cost — see
    //../../src/app/core/state/main.js for the trade. What is asserted instead is
    //that they land in the drawer rather than loose among the repositories,
    //which is the part that would otherwise be a mess in somebody's project.
    assert.ok(kept.path.startsWith(path.join(work, '.okc')),
        'kept outside the workspace drawer: ' + kept.path);
});

test('a store name may be a path, so one ignore rule covers every lane under it', async () => {
    //`artifacts/worker` IS A DRAWER INSIDE A DRAWER. What a run hands back is
    //filed by lane — worker, judge, or a bare job — and `.gitignore` carries the
    //single rule `artifacts/` to cover all of them, including a lane added later
    //by somebody who never reads core/archive.
    const files = archive.store('artifacts/worker');
    const kept = await files.keep('task-uid-1', 'NOTES.md', bytes('hello'), { run: 'r1' });

    const here = await state.here.where();
    assert.ok(kept.path.startsWith(path.join(here, 'artifacts', 'worker', 'task-uid-1')),
        'a lane is not nested under its drawer, so one ignore rule cannot cover it: ' + kept.path);
});

test('and a `..` segment is dropped, so a nested name cannot write upwards', async () => {
    //THIS FAILED WHEN IT WAS FIRST WRITTEN, and the hole was in the change it
    //was written for. `safe()` permits dots — a file is called `firmware.bin` —
    //so `safe('..')` returns `..` unchanged. Harmless while the whole store name
    //was ONE segment, where this flattened to the silly folder
    //`artifacts_.._.._escape`. Splitting on `/` turned it into a real climb and
    //this landed OUTSIDE the drawer, in the workspace beside the repositories.
    const files = archive.store('artifacts/../../escape');
    const kept = await files.keep('u', 'a.txt', bytes('x'), {});

    const here = await state.here.where();

    //EXACTLY WHERE IT SHOULD BE, not merely "somewhere under the drawer". The
    //`..` segments are removed and what is left still nests, so this is
    //`artifacts/escape` — a folder nobody wanted, inside the drawer, which is
    //the correct outcome for a name nobody should have written.
    assert.equal(path.dirname(kept.path), path.join(here, 'artifacts', 'escape', 'u'),
        'a store name reached somewhere it was not given: ' + kept.path);
});

test('a backslash is a separator too, and cannot smuggle a climb past the split', async () => {
    //ON THIS PLATFORM `\` IS WHAT A PATH IS MADE OF, so a name split only on `/`
    //would hand the rest to `safe()` in one piece and lose the same argument
    //from the other side.
    const files = archive.store('artifacts\\..\\..\\escape');
    const kept = await files.keep('u', 'a.txt', bytes('x'), {});

    const here = await state.here.where();
    assert.equal(path.dirname(kept.path), path.join(here, 'artifacts', 'escape', 'u'),
        'a backslash in a store name was not treated as a separator: ' + kept.path);
});

test('a uid with a slash in it still flattens rather than nesting', async () => {
    //THE OTHER HALF, AND IT MUST NOT FOLLOW THE NAME. A store name is written in
    //this app's own source; a uid comes from work and, at the guest door, from
    //something a machine said. Letting one nest would be a machine choosing
    //where on this host its file lands.
    const files = archive.store('artifacts');
    const kept = await files.keep('../../../etc/passwd', 'a.txt', bytes('x'), {});

    const here = await state.here.where();
    assert.ok(kept.path.startsWith(path.join(here, 'artifacts')),
        'a uid with separators escaped its drawer: ' + kept.path);
});

test('a second workspace does not see the first one’s files', async () => {
    const files = archive.store('artifacts');
    await files.keep('task-uid-1', 'firmware.bin', bytes('one'), {});
    assert.equal((await files.list('task-uid-1')).length, 1);

    state.moveTo(fs.mkdtempSync(path.join(os.tmpdir(), 'okc-arch-ws2-')));
    assert.deepEqual(await files.list('task-uid-1'), [],
        'the second workspace was shown the first one’s artefacts');
    assert.deepEqual(await files.everything(), []);
});

test('two kinds of thing are two drawers and never see each other', async () => {
    const files = archive.store('artifacts');
    const logs = archive.store('task-logs');

    await files.keep('uid', 'firmware.bin', bytes('a build'), {});
    await logs.keep('uid', 'out.log', bytes('some output'), {});

    assert.deepEqual((await files.list('uid')).map(f => f.name), ['firmware.bin']);
    assert.deepEqual((await logs.list('uid')).map(f => f.name), ['out.log']);
});

//---------------------------------------------------------------------------
//NEVER SILENTLY REPLACED.
//---------------------------------------------------------------------------

test('two runs handing back the same name are two deliveries', async () => {
    const files = archive.store('artifacts');
    await files.keep('uid', 'firmware.bin', bytes('from run one'), { run: 'r1' });
    await files.keep('uid', 'firmware.bin', bytes('from run two'), { run: 'r2' });

    const all = await files.list('uid');
    assert.equal(all.length, 2, 'one overwrote the other');
    //THE RUN IT CAME FROM IS IN THE NAME, so which is which is answerable
    //without cross-referencing anything.
    assert.deepEqual(all.map(f => f.file).sort(), ['r1--firmware.bin', 'r2--firmware.bin']);
});

test('the same run handing back the same name twice keeps both', async () => {
    const files = archive.store('artifacts');
    await files.keep('uid', 'out.txt', bytes('first'), { run: 'r1' });
    await files.keep('uid', 'out.txt', bytes('second'), { run: 'r1' });

    //SUFFIXED RATHER THAN REFUSED: the delivery already happened, and losing it
    //to a name collision helps nobody.
    assert.deepEqual((await files.list('uid')).map(f => f.file).sort(),
        ['r1--out.txt', 'r1-2--out.txt']);
});

test('a delivery with no run still keeps two apart', async () => {
    const files = archive.store('artifacts');
    await files.keep('uid', 'out.txt', bytes('first'), {});
    await files.keep('uid', 'out.txt', bytes('second'), {});
    assert.equal((await files.list('uid')).length, 2);
});

//---------------------------------------------------------------------------
//A NAME NEVER BECOMES A PATH.
//---------------------------------------------------------------------------

test('anything with a directory in it is not a name', async () => {
    const files = archive.store('artifacts');

    for (const bad of ['../escape', 'a/b', '..', '/etc/passwd', 'C:\\thing', '.hidden', '']) {
        await assert.rejects(() => files.keep('uid', bad, bytes('x'), {}),
            /needs a name|may contain letters/, 'accepted ' + JSON.stringify(bad));
    }

    //AND NOTHING WAS WRITTEN by any of them.
    assert.deepEqual(await files.list('uid'), []);
});

test('the rule is offered as a sentence, because a guest has to be told why', () => {
    assert.equal(archive.nameIsOk('firmware.bin'), null);
    assert.match(archive.nameIsOk('../x'), /no directories, and no path of any kind/);
    assert.match(archive.nameIsOk(''), /needs a name/);
    assert.match(archive.nameIsOk('x'.repeat(200)), /too long/);
});

test('a uid with a path in it cannot climb out either', async () => {
    const files = archive.store('artifacts');
    const kept = await files.keep('../../escape', 'ok.txt', bytes('x'), {});

    const here = await state.here.where();
    assert.ok(kept.path.startsWith(path.join(here, 'artifacts')),
        'a uid escaped the drawer: ' + kept.path);
});

//---------------------------------------------------------------------------
//SIZE, AND WHAT IS NOT TEXT.
//---------------------------------------------------------------------------

test('too big is refused, and the refusal says the size', async () => {
    const files = archive.store('artifacts', { most: 1024 });
    await assert.rejects(() => files.keep('uid', 'big.bin', Buffer.alloc(2048), {}),
        /the most this takes is/);
});

test('nothing in it is refused', async () => {
    const files = archive.store('artifacts');
    await assert.rejects(() => files.keep('uid', 'empty.txt', Buffer.alloc(0), {}),
        /there was nothing in it/);
});

test('a binary is refused on read rather than rendered as rubbish', async () => {
    const files = archive.store('artifacts');
    await files.keep('uid', 'firmware.bin', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]), {});

    const one = (await files.list('uid'))[0];
    await assert.rejects(() => files.read('uid', one.file),
        /is not text — it has bytes no editor would show/);
});

test('too big to read is refused with its size rather than loaded into a panel', async () => {
    const files = archive.store('artifacts', { readable: 16 });
    await files.keep('uid', 'long.txt', bytes('x'.repeat(100)), {});

    const one = (await files.list('uid'))[0];
    await assert.rejects(() => files.read('uid', one.file), /Open it from the folder/);
});

test('text comes back, and the last lines of it when asked', async () => {
    const files = archive.store('artifacts');
    await files.keep('uid', 'out.txt', bytes('one\ntwo\nthree\nfour'), {});

    const one = (await files.list('uid'))[0];
    assert.equal((await files.read('uid', one.file)).text, 'one\ntwo\nthree\nfour');

    const tail = await files.read('uid', one.file, { lines: 2 });
    assert.equal(tail.text, 'three\nfour');
    assert.equal(tail.of, 4);
});

test('a store can be given something to run over what it reads back', async () => {
    //THE RUN-LOG STORE IS THE CALLER FOR THIS: command output carries tokens,
    //and core/secret is what knows what one looks like.
    const logs = archive.store('task-logs', { clean: (t) => t.replace(/ghp_\w+/g, '[redacted]') });
    await logs.keep('uid', 'out.log', bytes('signed in with ghp_realtokenhere ok'), {});

    const one = (await logs.list('uid'))[0];
    assert.match((await logs.read('uid', one.file)).text, /\[redacted\]/);
});

//---------------------------------------------------------------------------
//NOWHERE TO KEEP IT.
//---------------------------------------------------------------------------

test('no workspace open refuses a keep rather than dropping it', async () => {
    state.moveTo(null);
    const files = archive.store('artifacts');

    //THIS IS A RECORD OF SOMETHING THAT HAPPENED ON A MACHINE ABOUT TO BE
    //ROLLED BACK. "Saved" and "there was nowhere to save it" are different
    //answers, and only one of them is true.
    await assert.rejects(() => files.keep('uid', 'firmware.bin', bytes('x'), {}),
        /no workspace is open, so there is nowhere to keep/);
});

test('and answers an empty list rather than throwing', async () => {
    state.moveTo(null);
    const files = archive.store('artifacts');

    assert.deepEqual(await files.list('uid'), []);
    assert.deepEqual(await files.everything(), []);
    assert.equal(await files.has('uid', 'anything'), false);
});

//---------------------------------------------------------------------------
//WHAT IS THERE, AND THROWING ONE AWAY.
//---------------------------------------------------------------------------

test('what was produced outlives the note about it', async () => {
    const files = archive.store('artifacts');
    await files.keep('a-uid-nothing-points-at', 'firmware.bin', bytes('x'), {});

    //READ FROM THE DIRECTORY rather than from a record, so a file whose task
    //was thrown away is still findable.
    const all = await files.everything();
    assert.equal(all.length, 1);
    assert.equal(all[0].uid, 'a-uid-nothing-points-at');
    assert.equal(all[0].files, 1);
});

test('forgetting one takes what described it too', async () => {
    const files = archive.store('artifacts');
    await files.keep('uid', 'firmware.bin', bytes('x'), {});
    const one = (await files.list('uid'))[0];

    assert.equal(await files.has('uid', one.file), true);
    const gone = await files.forget('uid', one.file);
    assert.equal(gone.name, 'firmware.bin');

    assert.deepEqual(await files.list('uid'), []);
    //A RECORD OF A DELIVERY WHOSE DELIVERY IS GONE is a row that reads as a
    //file and is not one.
    assert.ok(!fs.existsSync(one.path + '.about.json'));
});

test('one that is not there is refused rather than reported as done', async () => {
    const files = archive.store('artifacts');
    await assert.rejects(() => files.forget('uid', 'nothing.txt'), /There is no file called/);
    await assert.rejects(() => files.read('uid', 'nothing.txt'), /There is no file called/);
});

test('a folder named by a uid says what it belonged to', async () => {
    const files = archive.store('artifacts');
    await files.keep('uid', 'firmware.bin', bytes('x'), { run: 'r1', number: 7, title: 'build it' });

    const one = (await files.list('uid'))[0];
    const said = JSON.parse(fs.readFileSync(one.path + '.about.json', 'utf8'));

    assert.equal(said.number, 7);
    assert.equal(said.title, 'build it');
    assert.equal(said.run, 'r1');
    assert.equal(said.uid, 'uid');
    assert.ok(said.kept);
});

//---------------------------------------------------------------------------
//LOOKING INSIDE ONE.
//---------------------------------------------------------------------------

const aTar = (files) => Buffer.from(nanotar.createTar(files));

test('a tar can be looked inside', async () => {
    const said = archive.inside(aTar([
        { name: 'projects/one.jsonl', data: '{"turn":1}' },
        { name: 'settings.json', data: '{}' }
    ]));

    assert.equal(said.unreadable, null);
    assert.equal(said.files, 2);
    assert.equal(said.gzip, false);
    assert.deepEqual(said.entries.map(e => e.name).sort(), ['projects/one.jsonl', 'settings.json']);
});

test('a gzipped one is unpacked first, decided from the bytes not the name', async () => {
    const said = archive.inside(zlib.gzipSync(aTar([{ name: 'a.txt', data: 'hello' }])));

    assert.equal(said.gzip, true);
    assert.equal(said.unreadable, null);
    assert.equal(archive.text(archive.find(said.entries, 'a.txt')), 'hello');
});

test('one entry is found by name or by a test', async () => {
    const said = archive.inside(aTar([
        { name: 'projects/small.jsonl', data: 'a' },
        { name: 'projects/big.jsonl', data: 'aaaaaaaaaa' }
    ]));

    assert.equal(archive.find(said.entries, 'projects/small.jsonl').name, 'projects/small.jsonl');
    assert.equal(archive.find(said.entries, (e) => /big/.test(e.name)).name, 'projects/big.jsonl');
    assert.equal(archive.find(said.entries, 'nothing-like-it'), null);
});

test('a Buffer is not handed to the tar reader as it stands', async () => {
    //THE READER DOES `data.buffer` AND IGNORES `byteOffset`. A node Buffer is a
    //view into a shared pool, so its `.buffer` is the whole pool — and the
    //reader then parses from offset 0 of that, which is whatever else the
    //process put there. It does not fail; it returns entries read out of
    //unrelated memory.
    //
    //THE FIRST TIME THIS WAS HIT, an archive came back holding one entry named
    //"bytes: 10240" — a line of console output sitting in the pool nearby.
    //
    //A POOLED BUFFER IS WHAT ANY ORDINARY CALLER HAS, which is why this is
    //checked with one rather than with a tidy Uint8Array.
    const tar = aTar([{ name: 'a.txt', data: 'hello' }, { name: 'b.txt', data: 'there' }]);

    const pooled = Buffer.allocUnsafe(tar.length);
    tar.copy(pooled);
    assert.ok(pooled.byteOffset > 0 || pooled.buffer.byteLength > pooled.length,
        'this node did not give a pooled buffer, so the check proves nothing');

    const said = archive.inside(pooled);
    assert.equal(said.unreadable, null);
    assert.deepEqual(said.entries.map(e => e.name).sort(), ['a.txt', 'b.txt']);
});

test('rubbish is an answer, never a throw', async () => {
    //THESE BYTES CAME OFF A MACHINE RUNNING A SCRIPT SOMEBODY WROTE. Losing a
    //transcript because reading it failed would be the tail wagging the dog.
    //
    //AND NEVER A FABRICATED ENTRY EITHER. The reader given rubbish reads the
    //first hundred bytes as a NAME and hands back a file — off a machine, that
    //is an attacker-chosen filename presented as the contents of an archive.
    const nonsense = archive.inside(Buffer.from('not a tar at all, not even close'));
    assert.match(nonsense.unreadable || '', /is not a tar|there was nothing in it/);
    assert.deepEqual(nonsense.entries, [], 'it invented an entry out of rubbish');

    const longEnough = Buffer.alloc(4096, 0x41);
    const lies = archive.inside(longEnough);
    assert.match(lies.unreadable || '', /no header where one should be/);
    assert.deepEqual(lies.entries, []);

    const lying = Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.from('rubbish')]);
    assert.match(archive.inside(lying).unreadable, /says it is gzipped and does not unpack/);

    assert.match(archive.inside(Buffer.alloc(0)).unreadable, /there was nothing in it/);
    assert.match(archive.inside(null).unreadable, /there was nothing in it/);
});

test('text of an entry that is not there is empty rather than a throw', () => {
    assert.equal(archive.text(null), '');
    assert.equal(archive.text({ name: 'x' }), '');
});
