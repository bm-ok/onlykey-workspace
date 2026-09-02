const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const child = require('node:child_process');

const actionsPlugin = require('../../src/app/core/actions/main');
const statePlugin = require('../../src/app/core/state/main');
const gitPlugin = require('../../src/app/git/server');
const linesPlugin = require('../../src/app/repositories/branches/server');
const { refsFor } = require('../../tools/test-parts');
const artifactPlugin = require('../../src/app/artifact/server');

//---------------------------------------------------------------------------
//what came back, read the way a pull request is read.
//
//THE CLAIM THIS FILE IS FOR: a branch is measured against WHAT IT WAS CUT FROM,
//and not against whatever the default happens to be today.
//
//That is the whole reason the cut note exists. Once a branch has been merged
//into, git cannot tell it apart from one cut somewhere else — so if the base is
//not written down at the moment of cutting, it is not recoverable. And the way
//getting it wrong fails is the dangerous way: it does not throw, it returns a
//NUMBER. A branch cut from a line reads as carrying the line's whole history,
//which is the reviewer being handed somebody else's work as though the worker
//had written it.
//
//SO THE FIXTURE IS BUILT SO THE TWO ANSWERS DIFFER. `version2` sits three
//commits off `master`, and the branch is cut from `version2` and adds one. Read
//correctly it carries 1; read against the default it carries 4. A drill where
//both answers agree proves only that something returned.
//
//REAL REPOSITORIES, because this is a reading of git and a fake git would be
//asserting that the fake behaves as written.
//---------------------------------------------------------------------------

let work;

const git = (args, cwd) => child.execFileSync('git', [
    '-c', 'user.email=drill@example.invalid',
    '-c', 'user.name=drill',
    '-c', 'commit.gpgsign=false'
].concat(args), { cwd: cwd, stdio: 'pipe' }).toString();

function write(at, file, text) {
    fs.mkdirSync(path.dirname(path.join(at, file)), { recursive: true });
    fs.writeFileSync(path.join(at, file), text);
}

function commit(at, message) {
    git(['add', '-A'], at);
    git(['commit', '-q', '-m', message], at);
}

//A repository with `master`, a `version2` three commits along it, and — when
//asked — a branch cut from version2 carrying one commit of its own.
function aRepo(name, { line = false, branch = null } = {}) {
    const at = path.join(work, name);
    fs.mkdirSync(at, { recursive: true });
    git(['init', '-q', '-b', 'master'], at);
    write(at, 'readme.md', 'one\n');
    commit(at, 'first');

    if (line) {
        git(['checkout', '-q', '-b', 'version2'], at);
        for (const n of ['two', 'three', 'four']) {
            write(at, n + '.txt', n + '\n');
            commit(at, 'version2: ' + n);
        }
        git(['checkout', '-q', 'master'], at);
    }

    if (branch) {
        git(['checkout', '-q', '-b', branch, line ? 'version2' : 'master'], at);
        write(at, 'src/parse.js', 'the change\n');
        write(at, 'notes.md', 'why\n');
        commit(at, 'the one commit this branch adds');
        git(['checkout', '-q', 'master'], at);
    }
    return at;
}

let holder;
before(() => { holder = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-artifact-')); });
beforeEach(() => { work = fs.mkdtempSync(path.join(holder, 'w-')); });
after(() => {
    try { fs.rmSync(holder, { recursive: true, force: true }); } catch { /* windows may hold a handle */ }
});


//A CLEAN DRAWER PER TEST, WHICH USED TO COME FOR FREE. The workspace folder is
//made once for this whole file, and a workspace keeps its state INSIDE itself
//now -- so what one test writes is what the next one reads unless it is cleared.
//It used to be a fresh dataDir per fixture, and the drawer lived under that.
function freshDrawer(at) {
    try { fs.rmSync(path.join(at, '.okc'), { recursive: true, force: true }); }
    catch (e) { /* nothing kept there yet */ }
}

async function anApp({ cuts = null, lines: stored = null } = {}) {
    freshDrawer(work);
    let actions = null;
    await actionsPlugin({}, async (_e, s) => { actions = s.actions; });

    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-artifact-data-'));
    let state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dataDir, ...p) } }, async (_e, s) => { state = s.state; });

    state.follow(async () => work);
    if (cuts) (await state.here.doc('cuts')).write(cuts);
    if (stored) (await state.here.doc('lines')).write(stored);

    const logger = { good: () => {}, warn: () => {}, bad: () => {}, info: () => {} };
    const workspace = {
        dir: async () => work,
        folderOf: async (name) => {
            const at = path.join(work, name);
            if (!fs.existsSync(path.join(at, '.git'))) throw new Error('there is no repository called "' + name + '"');
            return at;
        },
        repos: async () => fs.readdirSync(work)
            .filter((n) => fs.existsSync(path.join(work, n, '.git')))
            .map((n) => ({ name: n }))
    };

    let git_ = null;
    await gitPlugin({ app: { host: {} }, log: { on: () => logger }, workspace }, async (_e, s) => { git_ = s.git; });

    const { refs } = await refsFor({ git: git_, workspace, log: { on: () => logger } });

    let lines = null;
    await linesPlugin({
        app: { host: { actions } }, log: { on: () => logger },
        git: git_, workspace, state, refs
    }, async (_e, s) => { lines = s.lines; });

    let artifact = null;
    await artifactPlugin({
        app: { host: { actions } }, log: { on: () => logger },
        git: git_, workspace, lines,
        //THE DRAWER HALF, WHICH THIS FILE DOES NOT EXERCISE. `artifact` answers
        //two questions now -- what a branch carries, which is everything below,
        //and what a run handed back, which is covered in ../core/archive and by
        //the callers that read it.
        //
        //STUBBED AS `store(name)` RATHER THAN AS THE ANSWER, because the plugin
        //opens three drawers at build -- one per lane -- and a stand-in that
        //returned nothing would make the constructor throw rather than the test
        //fail for a reason anybody could read.
        archive: { store: () => ({
            list: async () => [], read: async () => null, has: async () => false,
            keep: async () => ({}), forget: async () => ({}),
            everything: async () => [], dirFor: async () => null, root: async () => null
        }) }
    }, async (_e, s) => { artifact = s.artifact; });

    return { actions, artifact, lines };
}

//The note a cut writes: this branch, in this repository, came from version2.
const CUT = {
    'fix/the-thing': {
        why: 'a drill',
        made: '2026-08-01T00:00:00.000Z',
        from: { one: 'version2', two: 'version2' }
    }
};

//---------------------------------------------------------------------------
//THE RULE.
//---------------------------------------------------------------------------

test('a branch is measured against what it was cut from, not the default', async () => {
    aRepo('one', { line: true, branch: 'fix/the-thing' });
    const { artifact } = await anApp({ cuts: CUT });

    const said = await artifact.read('fix/the-thing');
    const one = said.repos.find((r) => r.repo === 'one');

    assert.equal(one.base, 'version2', 'the base is the branch it was cut from');

    //THE NUMBER IS THE POINT. Against `master` this branch carries four commits
    //— three of them somebody else's — and nothing about the shape of the answer
    //would look wrong.
    assert.equal(one.ahead, 1);
    assert.equal(said.commits, 1);
    assert.equal(said.delivered, true);
    assert.match(said.summary, /1 commit\(s\) in one/);

    const files = one.files.map((f) => f.file).sort();
    assert.deepEqual(files, ['notes.md', 'src/parse.js']);
});

test('a branch that was never pushed here is missing, not empty', async () => {
    aRepo('one', { line: true, branch: 'fix/the-thing' });
    aRepo('two', { line: true });
    const { artifact } = await anApp({ cuts: CUT });

    const said = await artifact.read('fix/the-thing');
    const two = said.repos.find((r) => r.repo === 'two');

    //MISSING AND EMPTY MEAN DIFFERENT THINGS ABOUT THE WORK: nothing was ever
    //pushed here, versus the branch exists and carries nothing. Reporting either
    //as "no changes" loses which one it was, and they call for different
    //questions.
    assert.equal(two.missing, true);
    assert.equal(two.ahead, 0);

    //And one repository carrying nothing does not make the branch undelivered.
    assert.equal(said.delivered, true);
});

test('a branch that exists and adds nothing is empty, and not delivered', async () => {
    aRepo('one', { line: true });
    const at = path.join(work, 'one');
    git(['branch', 'fix/the-thing', 'version2'], at);

    const { artifact } = await anApp({ cuts: CUT });
    const said = await artifact.read('fix/the-thing');
    const one = said.repos.find((r) => r.repo === 'one');

    assert.equal(one.missing, false);
    assert.equal(one.empty, true);
    assert.equal(said.delivered, false, 'a worker that pushed nothing has produced nothing to judge');
    assert.match(said.summary, /nothing has arrived/);
});

test('a base that is not there is said, and is not reported as an empty branch', async () => {
    //`version2` never existed in this repository, but the note says the branch
    //came from it. "Nothing to land" and "there is nowhere to land it" are
    //different answers and the second one has a name.
    aRepo('one', { line: false, branch: 'fix/the-thing' });
    const { artifact } = await anApp({ cuts: CUT });

    const said = await artifact.read('fix/the-thing');
    const one = said.repos.find((r) => r.repo === 'one');

    assert.equal(one.noBase, true);
    assert.equal(one.base, 'version2');
    assert.equal(one.missing, false, 'the branch is here; it is the base that is not');
});

test('a branch is read only in the repositories its line names', async () => {
    aRepo('one', { line: true, branch: 'fix/the-thing' });
    aRepo('two', { line: true, branch: 'fix/the-thing' });
    aRepo('three', { line: true, branch: 'fix/the-thing' });

    const { artifact } = await anApp({
        cuts: {
            'fix/the-thing': {
                why: 'scoped to two of the three',
                made: '2026-08-01T00:00:00.000Z',
                group: 'the-line',
                from: { one: 'version2', two: 'version2' }
            }
        },
        lines: {
            'the-line': {
                why: 'two of three',
                made: '2026-08-01T00:00:00.000Z',
                on: { one: 'version2', two: 'version2' }
            }
        }
    });

    const said = await artifact.read('fix/the-thing');
    const named = said.repos.map((r) => r.repo).sort();

    //A branch scoped to two of three reported with a third row is true and reads
    //as a gap in the work rather than as the shape somebody chose. A reviewer
    //counting three rows and finding two is looking for a problem that is not
    //there — and `three` genuinely carries the branch here, so a scope that was
    //ignored would show it.
    assert.deepEqual(named, ['one', 'two']);
    assert.equal(said.group, 'the-line');
    assert.equal(said.commits, 2);
});

test('the two sides of a file come from where the branch started, not from where the base is now', async () => {
    aRepo('one', { line: true, branch: 'fix/the-thing' });

    //The base moves on AFTER the branch was cut, and rewrites the same file. Read
    //against the base's tip, the left-hand column would show this as though the
    //worker had reverted it.
    const at = path.join(work, 'one');
    git(['checkout', '-q', 'version2'], at);
    write(at, 'src/parse.js', 'somebody else, later\n');
    commit(at, 'version2 moved on');
    git(['checkout', '-q', 'master'], at);

    const { artifact } = await anApp({ cuts: CUT });
    const both = await artifact.sides('one', 'fix/the-thing', 'src/parse.js');

    assert.equal(both.now, 'the change\n');
    assert.equal(both.was, null, 'the file did not exist where this branch started');
    assert.notEqual(both.from, 'version2');
});

test('branchArtifacts says plainly that no session is kept', async () => {
    aRepo('one', { line: true, branch: 'fix/the-thing' });
    const { actions } = await anApp({ cuts: CUT });

    const said = await actions.call('branchArtifacts', { branch: 'fix/the-thing' });

    assert.equal(said.branch, 'fix/the-thing');
    assert.equal(said.git.commits, 1);
    //An empty panel would read as "this branch has no session". This says the
    //tool does not keep them, which is a different sentence.
    assert.equal(said.session.kept, false);
    assert.match(said.session.why, /Nothing captures a worker session yet/);

    await assert.rejects(() => actions.call('branchArtifacts', {}), /Which branch/);
});
