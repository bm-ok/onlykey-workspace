const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const child = require('node:child_process');

const actionsPlugin = require('../src/app/core/actions/main');
const statePlugin = require('../src/app/core/state/main');
const gitPlugin = require('../src/app/git/server');
const linesPlugin = require('../src/app/repositories/branches/server');

//---------------------------------------------------------------------------
//a line: one branch per repository, named, so it can be talked about as one
//thing.
//
//THE CLAIM THIS FILE IS FOR: a line's state is the WORST of its parts and never
//an average. "Two of three are in step" is the one answer a line must not give,
//because the entire point of naming one is that the three move together — and
//one part being behind is not visible from any single repository.
//
//THREE REAL REPOSITORIES against a local bare origin, so a part can genuinely be
//behind, ahead or diverged without a network.
//---------------------------------------------------------------------------

let work;

const git = (args, cwd) => child.execFileSync('git', [
    '-c', 'user.email=drill@example.invalid',
    '-c', 'user.name=drill',
    '-c', 'commit.gpgsign=false'
].concat(args), { cwd: cwd, stdio: 'pipe' }).toString();

//a repository with an origin on this disk, one commit, and a branch `work`
function aRepo(name) {
    const bare = path.join(work, name + '.git');
    fs.mkdirSync(bare);
    git(['init', '-q', '--bare', '-b', 'master'], bare);

    const at = path.join(work, name);
    fs.mkdirSync(at);
    git(['init', '-q', '-b', 'master'], at);
    git(['remote', 'add', 'origin', bare], at);
    fs.writeFileSync(path.join(at, 'readme.md'), 'one\n');
    git(['add', '.'], at);
    git(['commit', '-q', '-m', 'first'], at);
    git(['push', '-q', 'origin', 'master'], at);

    git(['checkout', '-q', '-b', 'work'], at);
    git(['push', '-q', 'origin', 'work'], at);
    git(['fetch', '-q', 'origin'], at);
    return at;
}

before(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-lines-'));
    aRepo('one');
    aRepo('two');
    aRepo('three');
});

after(() => {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* windows may hold a handle */ }
});

async function anApp(stored) {
    let actions = null;
    await actionsPlugin({}, async (_e, s) => { actions = s.actions; });

    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-lines-data-'));
    let state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dataDir, ...p) } }, async (_e, s) => { state = s.state; });

    let where = work;
    state.follow(async () => where);
    if (stored) (await state.here.doc('lines')).write(stored);

    const said = [];
    const logger = { good: (t) => said.push(t), warn: (t) => said.push(t), bad: () => {}, info: () => {} };
    const workspace = {
        dir: async () => where,
        folderOf: async (name) => {
            const at = path.join(where, name);
            if (!fs.existsSync(path.join(at, '.git'))) throw new Error('there is no repository called "' + name + '"');
            return at;
        },
        repos: async () => (where ? fs.readdirSync(where)
            .filter((n) => !n.endsWith('.git') && fs.existsSync(path.join(where, n, '.git')))
            .map((n) => ({ name: n })) : [])
    };

    let git_ = null;
    await gitPlugin({ app: { host: {} }, log: { on: () => logger }, workspace }, async (_e, s) => { git_ = s.git; });

    let lines = null;
    await linesPlugin({
        app: { host: { actions } }, log: { on: () => logger },
        git: git_, workspace, state
    }, async (_e, s) => { lines = s.lines; });

    return { actions, lines, said, state, go: (to) => { where = to; } };
}

const THREE = {
    'the-change': {
        why: 'one change across three repositories',
        made: '2026-08-01T00:00:00.000Z',
        on: { one: 'work', two: 'work', three: 'work' }
    }
};

//---------------------------------------------------------------------------
//THE RULE.
//---------------------------------------------------------------------------

test('a line with every part in step is ok', async () => {
    const { actions } = await anApp(THREE);
    const g = (await actions.call('lines', {})).lines[0];

    assert.equal(g.name, 'the-change');
    assert.equal(g.on.length, 3);
    assert.equal(g.sync, 'ok');
    assert.deepEqual(g.behind, []);
    assert.deepEqual(g.broken, []);
});

//ONE PART BEHIND IS THE WHOLE LINE BEHIND. This is not visible from any single
//repository, and averaging it is the answer a line must never give.
test('one part behind makes the whole line behind, not two-thirds fine', async () => {
    const { actions } = await anApp(THREE);

    //move origin's copy of `work` in ONE repository only
    const two = path.join(work, 'two');
    const other = path.join(work, 'two-elsewhere');
    git(['clone', '-q', path.join(work, 'two.git'), other], work);
    git(['checkout', '-q', 'work'], other);
    fs.writeFileSync(path.join(other, 'more.txt'), 'moved on\n');
    git(['add', '.'], other);
    git(['commit', '-q', '-m', 'origin moved'], other);
    git(['push', '-q', 'origin', 'work'], other);
    git(['fetch', '-q', 'origin'], two);

    const g = (await actions.call('lines', {})).lines[0];
    assert.equal(g.sync, 'behind', 'a line with a part behind did not read as behind');
    assert.deepEqual(g.behind.map((p) => p.repo), ['two'], 'it did not name which part');
    assert.equal(g.on.filter((p) => p.state === 'same').length, 2, 'the other two are not in step');

    fs.rmSync(other, { recursive: true, force: true });
});

//A PART THAT MOVED ON BOTH SIDES IS A CONFLICT, and a fast-forward cannot help.
//That has to beat `behind` rather than being averaged with it.
test('one diverged part makes the line a conflict, outranking behind', async () => {
    const { actions } = await anApp(THREE);

    const three = path.join(work, 'three');
    const other = path.join(work, 'three-elsewhere');
    git(['clone', '-q', path.join(work, 'three.git'), other], work);
    git(['checkout', '-q', 'work'], other);
    fs.writeFileSync(path.join(other, 'theirs.txt'), 'them\n');
    git(['add', '.'], other);
    git(['commit', '-q', '-m', 'theirs'], other);
    git(['push', '-q', 'origin', 'work'], other);

    //and this side moves too
    fs.writeFileSync(path.join(three, 'ours.txt'), 'us\n');
    git(['add', '.'], three);
    git(['commit', '-q', '-m', 'ours'], three);
    git(['fetch', '-q', 'origin'], three);

    const g = (await actions.call('lines', {})).lines[0];
    assert.equal(g.sync, 'conflict', 'a diverged part did not outrank the rest');
    assert.ok(g.behind.some((p) => p.repo === 'three'));

    fs.rmSync(other, { recursive: true, force: true });
});

//---------------------------------------------------------------------------
//WHAT IS STORED AND WHAT IS WORKED OUT.
//---------------------------------------------------------------------------

test('where each branch actually is is worked out, not stored', async () => {
    const { actions, state } = await anApp(THREE);
    const g = (await actions.call('lines', {})).lines[0];

    for (const p of g.on) {
        assert.match(p.at, /^[0-9a-f]{7,}$/, p.repo + ' has no commit recorded');
        assert.equal(p.there, true);
        assert.equal(p.stillHere, true);
    }

    //NOTHING ABOUT A REPOSITORY IS IN THE DOCUMENT. Storing a sha would be
    //storing a claim that changes underneath it.
    const raw = (await state.here.doc('lines')).read({});
    assert.deepEqual(Object.keys(raw['the-change']).sort(), ['made', 'on', 'why']);
    assert.deepEqual(raw['the-change'].on, { one: 'work', two: 'work', three: 'work' });
});

//A BRANCH THAT IS GONE IS THE ONE CASE WITH NO HONEST ANSWER, and it reads
//differently from a branch that is there and has never moved.
test('a branch deleted out from under a line makes it broken, by name', async () => {
    const { actions } = await anApp(THREE);
    const one = path.join(work, 'one');
    git(['checkout', '-q', 'master'], one);
    git(['branch', '-D', 'work'], one);
    git(['push', '-q', 'origin', '--delete', 'work'], one);
    git(['fetch', '-q', '--prune', 'origin'], one);

    const g = (await actions.call('lines', {})).lines[0];
    assert.deepEqual(g.broken, ['work is gone from one'], 'a missing branch was not reported by name');
    assert.equal(g.on.find((p) => p.repo === 'one').there, false);
    assert.equal(g.on.find((p) => p.repo === 'one').at, null, 'a gone branch was given a commit');

    //put it back for whatever runs next
    git(['checkout', '-q', '-b', 'work'], one);
    git(['push', '-q', 'origin', 'work'], one);
    git(['fetch', '-q', 'origin'], one);
});

//MISSING REPOSITORIES ARE NOT A FAULT: a line made when there were three still
//describes those three when a fourth arrives.
test('a repository the line does not name is listed as missing, not broken', async () => {
    const { actions } = await anApp({
        'partial': { why: null, made: null, on: { one: 'work' } }
    });

    const g = (await actions.call('lines', {})).lines[0];
    assert.deepEqual(g.missing.sort(), ['three', 'two']);
    assert.deepEqual(g.broken, [], 'a repository that was never named read as broken');
});

//---------------------------------------------------------------------------
//WITHDRAWING A PROPOSAL.
//---------------------------------------------------------------------------

test('withdrawing clears the proposal and says the branches stay protected', async () => {
    const { actions, said } = await anApp({
        'the-change': {
            on: { one: 'work' },
            marked: { at: '2026-08-01T00:00:00.000Z', by: 'the window', why: 'ready' }
        }
    });

    assert.ok((await actions.call('lines', {})).lines[0].marked, 'the fixture is not proposed, so this proves nothing');

    const said2 = await actions.call('lineWithdraw', { name: 'the-change' });
    assert.equal(said2.marked, null);
    //THE SENTENCE IS THE POINT: withdrawing a proposal is not un-protecting the
    //work, and somebody who wanted the second thing must be told they have not
    //got it.
    assert.match(said2.note, /stay protected/);
    assert.match(said2.note, /forget the line/);

    assert.equal((await actions.call('lines', {})).lines[0].marked, null);
    assert.ok(said.some((l) => /no longer proposed/.test(l)), 'nothing was recorded');
});

test('withdrawing a line that is not there is refused, and says what is', async () => {
    const { actions } = await anApp(THREE);
    await assert.rejects(() => actions.call('lineWithdraw', { name: 'nope' }), /no line called "nope"/);
    await assert.rejects(() => actions.call('lineWithdraw', { name: 'nope' }), /the-change/);
    await assert.rejects(() => actions.call('lineWithdraw', {}), /Say which line/);
});

//---------------------------------------------------------------------------
//AND IT IS READ SEVERAL TIMES PER DRAW.
//
//The app being ported from asked git for a repository's branches inside the
//per-part loop: three lines across three repositories was nine processes for
//three answers, and a trace found 39% of the window's samples inside `spawn`
//with the window idle.
//---------------------------------------------------------------------------
test('each repository is asked once, however many lines name it', async () => {
    let actions = null;
    await actionsPlugin({}, async (_e, s) => { actions = s.actions; });

    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-lines-count-'));
    let state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dataDir, ...p) } }, async (_e, s) => { state = s.state; });
    state.follow(async () => work);

    //THREE LINES, EACH NAMING ALL THREE REPOSITORIES. Asked per part, that is
    //nine calls for three answers.
    (await state.here.doc('lines')).write({
        a: { on: { one: 'work', two: 'work', three: 'work' } },
        b: { on: { one: 'work', two: 'work', three: 'work' } },
        c: { on: { one: 'work', two: 'work', three: 'work' } }
    });

    const logger = { good() {}, warn() {}, bad() {}, info() {} };
    const workspace = {
        dir: async () => work,
        folderOf: async (n) => path.join(work, n),
        repos: async () => [{ name: 'one' }, { name: 'two' }, { name: 'three' }]
    };

    let real = null;
    await gitPlugin({ app: { host: {} }, log: { on: () => logger }, workspace }, async (_e, s) => { real = s.git; });

    //THE REAL GIT, COUNTED. Wrapping rather than faking, so what is measured is
    //how often the plugin reaches for it and not how well a stand-in behaves.
    const asked = [];
    const counting = Object.assign({}, real, {
        tracked: (repo) => { asked.push(repo); return real.tracked(repo); }
    });

    await linesPlugin({
        app: { host: { actions } }, log: { on: () => logger },
        git: counting, workspace, state
    }, async () => {});

    const said = await actions.call('lines', {});
    assert.equal(said.lines.length, 3, 'the fixture did not make three lines');

    assert.equal(asked.length, 3,
        'asked ' + asked.length + ' times for three repositories — it is asking per part, which is what cost 39% of the window in the app being ported from');
    assert.deepEqual(asked.slice().sort(), ['one', 'three', 'two']);
});

test('with no workspace open there are no lines, and it does not throw', async () => {
    const { actions, go } = await anApp(THREE);
    go(null);
    const said = await actions.call('lines', {});
    assert.deepEqual(said.lines, []);
    assert.match(said.note, /No workspace is open/);
});
