const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const child = require('node:child_process');

const actionsPlugin = require('../src/app/core/actions/main');
const gitPlugin = require('../src/app/git/server');
const conflictsPlugin = require('../src/app/repositories/conflicts/server');

//---------------------------------------------------------------------------
//which branches have moved on both sides, and which would actually conflict.
//
//REAL REPOSITORIES, REAL GIT, REAL CONFLICTS. What this plugin does is ask git a
//question most of the app never asks — `merge-tree --write-tree` — and a fake
//git would be testing the fake. So the fixture builds three branches by hand:
//one that diverged and conflicts, one that diverged and does not, and one that
//is merely ahead.
//
//THE `origin` HERE IS A LOCAL CLONE, which is what makes it possible to make a
//branch move on "both sides" without a network.
//---------------------------------------------------------------------------

let work, repo, origin;

const git = (args, cwd) => child.execFileSync('git', [
    '-c', 'user.email=drill@example.invalid',
    '-c', 'user.name=drill',
    '-c', 'commit.gpgsign=false'
].concat(args), { cwd: cwd || repo, stdio: 'pipe' }).toString();

const put = (name, text, cwd) => fs.writeFileSync(path.join(cwd || repo, name), text);

before(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-conf-'));

    //the far end, as a bare repository on this disk
    origin = path.join(work, 'origin.git');
    fs.mkdirSync(origin);
    git(['init', '-q', '--bare', '-b', 'master'], origin);

    repo = path.join(work, 'repo-one');
    fs.mkdirSync(repo);
    git(['init', '-q', '-b', 'master']);
    git(['remote', 'add', 'origin', origin]);
    put('shared.txt', 'one\n');
    put('mine.txt', 'a\n');
    put('theirs.txt', 'x\n');
    git(['add', '.']);
    git(['commit', '-q', '-m', 'first']);
    git(['push', '-q', 'origin', 'master']);

    //---- a branch that diverges AND conflicts -------------------------------
    git(['checkout', '-q', '-b', 'clash']);
    git(['push', '-q', 'origin', 'clash']);
    put('shared.txt', 'one\nours\n');
    git(['commit', '-q', '-am', 'ours']);

    //the far end moves the same file, from a second checkout
    const theirs = path.join(work, 'theirs');
    git(['clone', '-q', origin, theirs], work);
    git(['checkout', '-q', 'clash'], theirs);
    put('shared.txt', 'one\ntheirs\n', theirs);
    git(['commit', '-q', '-am', 'theirs'], theirs);
    git(['push', '-q', 'origin', 'clash'], theirs);

    //---- a branch that diverges and does NOT conflict -----------------------
    git(['checkout', '-q', '-b', 'apart', 'master']);
    git(['push', '-q', 'origin', 'apart']);
    put('mine.txt', 'a\nb\n');
    git(['commit', '-q', '-am', 'mine moved']);

    //THE CLONE PREDATES THIS BRANCH, so it has to be told about it first.
    git(['fetch', '-q', 'origin'], theirs);
    git(['checkout', '-q', 'apart'], theirs);
    put('theirs.txt', 'x\ny\n', theirs);
    git(['commit', '-q', '-am', 'theirs moved'], theirs);
    git(['push', '-q', 'origin', 'apart'], theirs);

    //---- and one that is merely ahead --------------------------------------
    git(['checkout', '-q', '-b', 'ahead', 'master']);
    git(['push', '-q', 'origin', 'ahead']);
    put('mine.txt', 'a\nahead\n');
    git(['commit', '-q', '-am', 'only here']);

    //bring the far end's news home, so both sides are visible locally
    git(['fetch', '-q', 'origin']);
    git(['checkout', '-q', 'master']);

    //the checkout used to move the far end is not a repository in the workspace
    fs.rmSync(theirs, { recursive: true, force: true });
});

after(() => {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* windows may hold a handle */ }
});

async function anApp(lines) {
    let actions = null;
    await actionsPlugin({}, async (_e, s) => { actions = s.actions; });

    //`lines` IS STILL RELAYED IN THE REAL APP, and this stands in for the relay.
    if (lines) actions.define('lines', { about: 'stand-in', run: () => ({ lines }) });

    const logger = { good() {}, warn() {}, bad() {}, info() {} };
    const workspace = {
        dir: async () => work,
        folderOf: async (name) => {
            const at = path.join(work, name);
            if (!fs.existsSync(path.join(at, '.git'))) throw new Error('there is no repository called "' + name + '"');
            return at;
        },
        repos: async () => [{ name: 'repo-one' }]
    };

    let git_ = null;
    await gitPlugin({ app: { host: {} }, log: { on: () => logger }, workspace }, async (_e, s) => { git_ = s.git; });
    await conflictsPlugin({ app: { host: { actions } }, log: { on: () => logger }, git: git_, workspace }, async () => {});

    return { actions, git: git_ };
}

//---------------------------------------------------------------------------
//THE POINT OF THE PANE.
//
//"Diverged" is cheap and almost useless: most diverged branches merge perfectly
//because the two sides touched different files. A list that reports every one as
//a problem is a list somebody stops reading — and then misses the one that is.
//---------------------------------------------------------------------------

test('a branch that diverged without conflicting is not reported as a conflict', async () => {
    const { actions } = await anApp();
    const said = await actions.call('conflicts', {});

    const names = said.diverged.map((c) => c.branch).sort();
    assert.deepEqual(names, ['apart', 'clash'], 'the wrong set of branches counted as diverged');

    const bad = said.conflicts.map((c) => c.branch);
    assert.deepEqual(bad, ['clash'], 'a branch that merges cleanly was reported as a conflict');
});

test('the conflicting files are named, not counted', async () => {
    const { actions } = await anApp();
    const one = (await actions.call('conflicts', {})).conflicts[0];

    assert.equal(one.repo, 'repo-one');
    assert.equal(one.clean, false);
    assert.deepEqual(one.files, ['shared.txt'], 'it did not say which file');
    assert.ok(one.ahead >= 1 && one.behind >= 1, 'ahead and behind are not both set on a diverged branch');
});

//A BRANCH THAT IS MERELY AHEAD IS NOT A CONFLICT, and the Repos pane already has
//a button for it.
test('a branch that is only ahead is left out entirely', async () => {
    const { actions } = await anApp();
    const said = await actions.call('conflicts', {});
    assert.ok(!said.diverged.some((c) => c.branch === 'ahead'), 'a fast-forwardable branch was listed');
});

//---------------------------------------------------------------------------
//COULD NOT TELL MUST NOT READ AS CLEAN.
//
//An unrelated history, a missing object, a ref that will not resolve. A pane
//that paints "no conflicts" over an unanswerable question is worse than one
//that says it does not know — and `clean` is three-valued for exactly this.
//---------------------------------------------------------------------------
test('an unanswerable comparison is its own answer, not a clean one', async () => {
    const { git: g } = await anApp();

    const said = await g.wouldConflict('repo-one', 'clash', 'refs/heads/no-such-branch');
    assert.equal(said.clean, null, 'a ref that does not resolve came back as CLEAN');
    assert.deepEqual(said.files, []);
    assert.match(said.why, /could not be read/);
});

test('a clean pair says so, and a conflicting one names the file', async () => {
    const { git: g } = await anApp();

    const fine = await g.wouldConflict('repo-one', 'apart', 'refs/remotes/origin/apart');
    assert.equal(fine.clean, true, 'two sides that touched different files read as conflicting');
    assert.deepEqual(fine.files, []);

    const bad = await g.wouldConflict('repo-one', 'clash', 'refs/remotes/origin/clash');
    assert.equal(bad.clean, false);
    assert.deepEqual(bad.files, ['shared.txt']);
});

//---------------------------------------------------------------------------
//WHAT `tracked` HAS TO GET RIGHT.
//---------------------------------------------------------------------------

test('every branch is placed, and origin/HEAD is not one of them', async () => {
    const { git: g } = await anApp();
    const rows = await g.tracked('repo-one');

    assert.equal(rows.clash.state, 'diverged');
    assert.equal(rows.apart.state, 'diverged');
    assert.equal(rows.ahead.state, 'ahead');
    assert.equal(rows.master.state, 'same');

    //`%(refname:short)` TURNS refs/remotes/origin/HEAD INTO "origin", which put a
    //phantom branch called `origin` in the panel sitting on the default's commit.
    assert.ok(!('origin' in rows), 'origin/HEAD was read as a branch called "origin"');
    assert.ok(!('HEAD' in rows), 'HEAD was listed as a branch');
});

//AHEAD AND BEHIND ARE COUNTED WHEN GIT WILL NOT SAY. `%(upstream:track)` is empty
//for a branch with no upstream configured — which is every branch this app makes
//— so a genuinely diverged branch fell through to "different", the panel painted
//it amber, and amber means "the button will move it".
test('a diverged branch with no upstream configured is still diverged', async () => {
    const { git: g } = await anApp();
    const rows = await g.tracked('repo-one');

    assert.equal(rows.clash.upstream, null, 'the fixture configured an upstream, so this proves nothing');
    assert.equal(rows.clash.state, 'diverged', 'it fell through to "different" and the pane would offer to move it');
    assert.ok(rows.clash.ahead > 0);
    assert.ok(rows.clash.behind > 0);
});

//---------------------------------------------------------------------------
//A CONFLICT IS REPORTED AGAINST A REPOSITORY, AND WHAT SOMEBODY IS MOVING IS A
//LINE.
//---------------------------------------------------------------------------

test('the lines that name a branch are carried onto the row', async () => {
    const { actions } = await anApp([
        { name: 'the-big-one', on: [{ repo: 'repo-one', branch: 'clash' }] },
        { name: 'somewhere-else', on: [{ repo: 'other', branch: 'clash' }] }
    ]);

    const one = (await actions.call('conflicts', {})).conflicts[0];
    assert.deepEqual(one.lines, ['the-big-one'], 'it matched on the branch name alone, ignoring the repository');
});

//`lines` HAS NOT BEEN PORTED, so it is asked for by name rather than consumed.
//That has to work when nothing answers.
test('with nothing able to answer about lines, the rows are simply un-annotated', async () => {
    const { actions } = await anApp();
    const one = (await actions.call('conflicts', {})).conflicts[0];
    assert.deepEqual(one.lines, [], 'a missing `lines` action broke the whole pane');
});
