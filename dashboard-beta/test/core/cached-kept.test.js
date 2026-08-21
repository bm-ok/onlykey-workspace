const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const statePlugin = require('../../src/app/core/state/main');
const cachedPlugin = require('../../src/app/core/cached/server');

//---------------------------------------------------------------------------
//the half of `cached` that touches disk, against the real ../src/app/core/state.
//
//THE CLAIMS:
//
//  * a content-keyed answer survives a restart, and is USED rather than
//    merely present — the distinction the load being awaited exists for
//  * a clock- or stamp-keyed drawer writes nothing, ever. Not "is not written
//    by these tests" — leaves no file. That one is the credential rule from
//    ./cached.test.js, checked where it could actually happen.
//  * no workspace open means no cache, and no throw. `state.here` refuses,
//    correctly, and a cache is the one caller for which "nowhere to keep this"
//    is not an error.
//  * a workspace switch reloads rather than writing one workspace's answers
//    into another's file.
//---------------------------------------------------------------------------

function quiet() {
    const said = [];
    const line = () => ({
        info: (m) => said.push(m), good: (m) => said.push(m),
        warn: (m) => said.push(m), bad: (m) => said.push(m), out: () => {}
    });
    return { log: { on: line }, said };
}

async function build(work, reuse) {
    const dataDir = reuse || fs.mkdtempSync(path.join(os.tmpdir(), 'okc-cached-'));

    let state = null;
    await statePlugin(
        { dataDir: { at: (...p) => path.join(dataDir, ...p) } },
        async (_e, s) => { state = s.state; });

    let at = work;
    state.follow(async () => at);

    const noise = quiet();
    let cached = null, destroy = null;
    await cachedPlugin({ app: {}, log: noise.log, state },
        async (_e, s) => { cached = s.cached; destroy = s.onDestroy; });

    return {
        cached, state, dataDir, said: noise.said, destroy,
        moveTo: (p) => { at = p; },
        //A SECOND PROCESS ON THE SAME DATA DIRECTORY, which is what a restart is.
        again: async () => {
            let s2 = null;
            await statePlugin(
                { dataDir: { at: (...p) => path.join(dataDir, ...p) } },
                async (_e, s) => { s2 = s.state; });
            s2.follow(async () => at);
            let c2 = null;
            await cachedPlugin({ app: {}, log: quiet().log, state: s2 },
                async (_e, s) => { c2 = s.cached; });
            return c2;
        }
    };
}

function workspace() { return fs.mkdtempSync(path.join(os.tmpdir(), 'okc-ws-')); }

test('a content-keyed answer survives a restart and is used', async () => {
    const work = workspace();
    const one = await build(work);

    let runs = 0;
    const make = () => { runs++; return { clean: false, files: ['a.txt'] }; };

    await one.cached.byContent('merges').get('repo|aaa|bbb', make);
    await one.cached.settle();
    assert.equal(runs, 1);

    const two = await one.again();
    const said = await two.byContent('merges').get('repo|aaa|bbb', make);

    assert.deepEqual(said, { clean: false, files: ['a.txt'] });
    assert.equal(runs, 1, 'the restart must not work it out again');
});

test('the load is awaited, so the first ask after a restart cannot race it', async () => {
    const work = workspace();
    const one = await build(work);

    await one.cached.byContent('merges').get('k', () => 'from-before');
    await one.cached.settle();

    //NOT AWAITED BETWEEN OPENING THE DRAWER AND ASKING IT — which is exactly
    //what a pane does. If the read were fired off rather than waited on, this
    //recomputes and nothing anywhere says so.
    const two = await one.again();
    let runs = 0;
    const said = await two.byContent('merges').get('k', () => { runs++; return 'recomputed'; });

    assert.equal(said, 'from-before');
    assert.equal(runs, 0);
});

test('a clock-keyed and a stamp-keyed drawer leave no file behind', async () => {
    const work = workspace();
    const one = await build(work);

    await one.cached.whileFresh('refs', 60000).get('repo', () => ['main', 'dev']);
    await one.cached.byStamp('credentials').get('cred|1:2', () => ({ oauth: 'a-token' }));
    await one.cached.byContent('merges').get('repo|1|2', () => 'clean');
    await one.cached.settle();

    const here = await one.state.here.where();
    const files = fs.readdirSync(here);

    assert.ok(files.includes('cached-merges.json'), 'the content-keyed one is kept: ' + files.join(', '));
    assert.ok(!files.includes('cached-refs.json'), 'a clock-keyed drawer must never reach disk');
    assert.ok(!files.includes('cached-credentials.json'), 'a stamp-keyed drawer must never reach disk');

    //AND NOT MERELY UNDER ANOTHER NAME. What that drawer holds in the app being
    //ported from is what a sealed credential unsealed to, so the check is that
    //the VALUE is nowhere in the folder, not that one filename is absent.
    const everything = files.map(f => fs.readFileSync(path.join(here, f), 'utf8')).join('\n');
    assert.equal(everything.indexOf('a-token'), -1, 'a token reached disk through a cache');
});

test('no workspace open is not an error, it is no cache', async () => {
    const one = await build(null);

    let runs = 0;
    const make = () => { runs++; return 'worked out'; };

    assert.equal(await one.cached.byContent('merges').get('k', make), 'worked out');
    await one.cached.settle();

    //IN MEMORY IT STILL WORKS, because that half needs nowhere to keep it.
    assert.equal(await one.cached.byContent('merges').get('k', make), 'worked out');
    assert.equal(runs, 1);

    //AND NOTHING WAS THROWN ANYWHERE. `state.here` refuses a write with nowhere
    //to go — right for a record, and merely "nothing kept" for a cache.
    assert.ok(!one.said.some(m => /ENOENT|undefined/.test(m)), one.said.join(' | '));
});

test('a switch does not drop what was worked out after it', async () => {
    const a = workspace();
    const b = workspace();
    const one = await build(a);

    await one.cached.byContent('merges').get('repo|aaa|bbb', () => 'from-a');
    await one.cached.settle();

    one.moveTo(b);
    await one.cached.byContent('merges').get('repo|ccc|ddd', () => 'from-b');
    await one.cached.settle();

    //THE DRAWER IS UNDER THE APP'S DATA DIRECTORY, not inside the workspace —
    //see ../src/app/core/state/main.js on why. Reading the workspace folder
    //itself finds nothing and passes on nothing, which this test did.
    const whereB = await one.state.here.where();
    assert.ok(whereB, 'the second workspace must have a drawer');
    const bFile = fs.existsSync(path.join(whereB, 'cached-merges.json'))
        ? JSON.parse(fs.readFileSync(path.join(whereB, 'cached-merges.json'), 'utf8')) : {};

    assert.ok('repo|ccc|ddd' in bFile,
        'an answer worked out after the switch must not be dropped by the switch');

    //AND WHAT IS *NOT* CLAIMED HERE, on purpose. The first workspace's answer
    //DOES migrate into this file, and ../src/app/core/cached/server.js says why
    //it is allowed to: there is nowhere to write the old workspace's file once
    //we have moved away from it, and a content key is a correct answer wherever
    //it is read. Asserting the tidy version would be asserting something the
    //code does not do.
    assert.ok('repo|aaa|bbb' in bFile, 'the documented behaviour is that it migrates');
});

test('a switch picks up what the workspace being moved TO already had', async () => {
    const a = workspace();
    const b = workspace();

    //b IS USED FIRST AND WRITTEN, so there is something of its own to find.
    const first = await build(b);
    await first.cached.byContent('merges').get('repo|bbb|bbb', () => 'b-knew-this');
    await first.cached.settle();
    const whereB = await first.state.here.where();

    //A SECOND PROCESS ON THE SAME DATA DIRECTORY, opened on a, then moved to b.
    const two = await build(a, first.dataDir);
    await two.cached.byContent('merges').get('repo|aaa|aaa', () => 'from-a');
    await two.cached.settle();

    two.moveTo(b);
    let runs = 0;
    await two.cached.byContent('merges').get('repo|new|new', () => 'anything');
    await two.cached.settle();

    const said = await two.cached.byContent('merges')
        .get('repo|bbb|bbb', () => { runs++; return 'recomputed'; });

    assert.equal(said, 'b-knew-this', 'moving to a workspace must pick up what it already knew');
    assert.equal(runs, 0);
    assert.ok(whereB);
});

test('a drawer is named in letters, digits and dashes, so it can always become a document', async () => {
    const one = await build(workspace());
    assert.throws(() => one.cached.byContent('../escape'), /named in letters/);
    assert.throws(() => one.cached.byContent('a/b'), /named in letters/);
    assert.throws(() => one.cached.byContent(''), /named in letters/);
});

test('changes pile up and go down together rather than a write per entry', async () => {
    const work = workspace();
    const one = await build(work);
    const d = one.cached.byContent('merges');

    for (let i = 0; i < 20; i++) await d.get('repo|x|' + i, () => i);

    //NOTHING IS ON DISK YET. ../state writes a whole document and renames it
    //into place, so a write per entry would rewrite the file twenty times for
    //one board draw.
    //LONG ENOUGH FOR A TIMER TO HAVE FIRED. Without this the check cannot tell
    //a two-second settle from no settle at all: every `await` above is a
    //microtask, so a `setTimeout(0)` would still be pending when the assertion
    //runs and the test would pass on a mechanism that writes per entry.
    await new Promise(r => setTimeout(r, 25));

    const here = await one.state.here.where();
    const before = fs.readdirSync(here);
    assert.ok(!before.includes('cached-merges.json'), 'a cache must not rewrite the file per entry');

    await one.cached.settle();
    const after = JSON.parse(fs.readFileSync(path.join(here, 'cached-merges.json'), 'utf8'));
    assert.equal(Object.keys(after).length, 20);
});

test('what a write drops, and what it does not, holds through the disk half too', async () => {
    const one = await build(workspace());
    const refs = one.cached.whileFresh('refs', 60000);
    const merges = one.cached.byContent('merges');

    let r = 0, m = 0;
    await refs.get('repo', () => { r++; return ['main']; });
    await merges.get('repo|1|2', () => { m++; return 'clean'; });

    one.cached.stale();

    await refs.get('repo', () => { r++; return ['main']; });
    await merges.get('repo|1|2', () => { m++; return 'clean'; });

    assert.equal(r, 2, 'the clock-keyed drawer is re-read after a write');
    assert.equal(m, 1, 'a moved ref gives a content key a different key — nothing in it can be wrong');
});
