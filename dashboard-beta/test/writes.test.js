const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const child = require('node:child_process');

const gitPlugin = require('../src/app/git/server');

//---------------------------------------------------------------------------
//THE WRITE DOOR.
//
//The most dangerous code in this app: it is the only thing here that changes a
//repository. So the checks are about what it REFUSES, and about the three
//properties that hold across all four writes:
//
//    1. nothing touches the working tree
//    2. nothing creates or rewrites a commit
//    3. nothing moves a ref in a way that loses commits, unless asked by name
//
//REAL REPOSITORIES AND REAL GIT THROUGHOUT. What is being tested is what git
//actually does with the argv this builds, and a fake git would be testing the
//fake — which for the one piece of code that can destroy work is not a test.
//
//A LOCAL BARE ORIGIN, so `fetch` is real without a network.
//---------------------------------------------------------------------------

let work, repo, origin, elsewhere;

const git = (args, cwd) => child.execFileSync('git', [
    '-c', 'user.email=drill@example.invalid',
    '-c', 'user.name=drill',
    '-c', 'commit.gpgsign=false'
].concat(args), { cwd, stdio: 'pipe' }).toString();

const at = (ref, cwd) => git(['rev-parse', ref], cwd || repo).trim();

async function aGit() {
    const logger = { good() {}, warn() {}, bad() {}, info() {} };
    const workspace = {
        dir: async () => work,
        folderOf: async (name) => {
            const p = path.join(work, name);
            if (!fs.existsSync(path.join(p, '.git'))) throw new Error('there is no repository called "' + name + '"');
            return p;
        },
        repos: async () => [{ name: 'repo-one' }]
    };
    let g = null;
    await gitPlugin({ app: { host: {} }, log: { on: () => logger }, workspace }, async (_e, s) => { g = s.git; });
    return g;
}

before(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-writes-'));
    origin = path.join(work, 'origin.git');
    fs.mkdirSync(origin);
    git(['init', '-q', '--bare', '-b', 'master'], origin);
});

//A FRESH REPOSITORY PER TEST. These change things, and a shared fixture would
//make the order of the tests part of what they assert.
beforeEach(() => {
    repo = path.join(work, 'repo-one');
    fs.rmSync(repo, { recursive: true, force: true });
    fs.mkdirSync(repo);
    git(['init', '-q', '-b', 'master'], repo);
    git(['remote', 'add', 'origin', origin], repo);
    fs.writeFileSync(path.join(repo, 'readme.md'), 'one\n');
    git(['add', '.'], repo);
    git(['commit', '-q', '-m', 'first'], repo);
    git(['push', '-q', '--force', 'origin', 'master'], repo);
    git(['fetch', '-q', 'origin'], repo);

    elsewhere = path.join(work, 'elsewhere');
    fs.rmSync(elsewhere, { recursive: true, force: true });
    git(['clone', '-q', origin, elsewhere], work);
});

after(() => {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* windows may hold a handle */ }
});

//---------------------------------------------------------------------------
//1. EVERY WAY THIS CAN CHANGE A REPOSITORY IS DECLARED.
//---------------------------------------------------------------------------

test('the declared writes are exactly the ones that are callable', async () => {
    const g = await aGit();
    assert.deepEqual(g.WRITES.slice().sort(), ['fastForward', 'fetch', 'makeBranch', 'removeBranch'],
        'the set of ways this plugin can change a repository changed — that is a thing to argue for in a diff');
    for (const name of g.WRITES) {
        assert.equal(typeof g[name], 'function', name + ' is declared as a write and is not callable');
    }
});

//THE ONES THAT ARE NOT THERE ARE THE POINT. A push, a commit, a merge, a reset
//or a checkout would each be a way for a mistake in a pane to become a mistake
//in somebody's work.
test('there is no push, commit, merge, rebase, reset or checkout', async () => {
    const g = await aGit();
    for (const nope of ['push', 'commit', 'merge', 'rebase', 'reset', 'checkout', 'clean', 'stash', 'cherryPick']) {
        assert.equal(g[nope], undefined, 'the git service now offers `' + nope + '`');
    }
    //and `run` still refuses them by name
    for (const nope of ['push', 'commit', 'reset', 'checkout', 'clean']) {
        await assert.rejects(() => g.run('repo-one', [nope]), /is not something this reads with/);
    }
});

//---------------------------------------------------------------------------
//2. NOTHING TOUCHES THE WORKING TREE.
//
//This is the property that makes the whole door safe: no act of this app can
//destroy uncommitted work, on any branch, because every write moves a ref.
//---------------------------------------------------------------------------

test('uncommitted work survives every write', async () => {
    const g = await aGit();

    //something uncommitted, and something staged
    fs.writeFileSync(path.join(repo, 'readme.md'), 'one\nEDITED BY A PERSON\n');
    fs.writeFileSync(path.join(repo, 'new.txt'), 'not committed\n');
    git(['add', 'new.txt'], repo);

    //origin moves on, so the fast-forward has somewhere to go
    fs.writeFileSync(path.join(elsewhere, 'theirs.txt'), 'x\n');
    git(['add', '.'], elsewhere);
    git(['commit', '-q', '-m', 'theirs'], elsewhere);
    git(['push', '-q', 'origin', 'master'], elsewhere);

    await g.fetch('repo-one');
    await g.makeBranch('repo-one', 'a-new-cut', 'master');
    await g.fastForward('repo-one', 'master', 'refs/remotes/origin/master');
    await g.removeBranch('repo-one', 'a-new-cut', { force: true });

    assert.match(fs.readFileSync(path.join(repo, 'readme.md'), 'utf8'), /EDITED BY A PERSON/,
        'an edit in the working tree was overwritten');
    assert.ok(fs.existsSync(path.join(repo, 'new.txt')), 'a staged file was removed');
    assert.match(git(['status', '--porcelain'], repo), /new\.txt/, 'the index was thrown away');
});

//---------------------------------------------------------------------------
//3. A FAST-FORWARD IS ONLY EVER A FAST-FORWARD.
//---------------------------------------------------------------------------

test('a branch that has moved here as well is refused, and nothing is touched', async () => {
    const g = await aGit();

    //both sides move
    fs.writeFileSync(path.join(elsewhere, 'theirs.txt'), 'x\n');
    git(['add', '.'], elsewhere);
    git(['commit', '-q', '-m', 'theirs'], elsewhere);
    git(['push', '-q', 'origin', 'master'], elsewhere);

    fs.writeFileSync(path.join(repo, 'ours.txt'), 'y\n');
    git(['add', '.'], repo);
    git(['commit', '-q', '-m', 'ours'], repo);
    await g.fetch('repo-one');

    const was = at('master');
    const said = await g.fastForward('repo-one', 'master', 'refs/remotes/origin/master');

    assert.equal(said.moved, false);
    assert.match(said.why, /not a fast-forward/);
    assert.match(said.why, /Conflicts/, 'the refusal does not say where to go');
    assert.equal(at('master'), was, 'it moved the branch anyway and the commit here is gone');
});

test('a real fast-forward moves it, and says where from and to', async () => {
    const g = await aGit();
    fs.writeFileSync(path.join(elsewhere, 'theirs.txt'), 'x\n');
    git(['add', '.'], elsewhere);
    git(['commit', '-q', '-m', 'theirs'], elsewhere);
    git(['push', '-q', 'origin', 'master'], elsewhere);
    await g.fetch('repo-one');

    const was = at('master');
    const said = await g.fastForward('repo-one', 'master', 'refs/remotes/origin/master');

    assert.equal(said.moved, true);
    assert.equal(said.was, was);
    assert.equal(at('master'), said.now);
    assert.notEqual(said.now, was);
});

//---------------------------------------------------------------------------
//THE COMPARE-AND-SWAP, WHICH IS THE HALF THAT IS INVISIBLE UNTIL IT MATTERS.
//
//`update-ref <ref> <new> <old>` refuses unless the ref is still at `<old>`. So a
//branch that moves BETWEEN the fast-forward check and the write — a worker
//pushing, somebody committing, a second window — loses the race safely instead
//of being overwritten. Without the third argument this is a force-push with
//extra steps, and every check above still passes.
//
//THE RACE IS MADE DETERMINISTIC by moving the branch from inside `folderOf`,
//which `fastForward` calls once more just before it writes. That is a seam
//rather than a stub: the real git still runs, and what is being tested is
//whether the argv it is handed carries the old value.
//---------------------------------------------------------------------------
test('a branch that moves mid-flight loses the race rather than being overwritten', async () => {
    fs.writeFileSync(path.join(elsewhere, 'theirs.txt'), 'x\n');
    git(['add', '.'], elsewhere);
    git(['commit', '-q', '-m', 'theirs'], elsewhere);
    git(['push', '-q', 'origin', 'master'], elsewhere);
    git(['fetch', '-q', 'origin'], repo);

    //something arrives on master after the check and before the write
    const sneak = (() => {
        const tree = git(['rev-parse', 'master^{tree}'], repo).trim();
        return git(['commit-tree', tree, '-p', 'master', '-m', 'arrived mid-flight'], repo).trim();
    })();

    let calls = 0;
    const logger = { good() {}, warn() {}, bad() {}, info() {} };
    const workspace = {
        dir: async () => work,
        repos: async () => [{ name: 'repo-one' }],
        folderOf: async () => {
            calls++;
            //the last call fastForward makes is the one immediately before
            //update-ref; move the branch out from under it right there
            if (calls === 4) git(['update-ref', 'refs/heads/master', sneak], repo);
            return repo;
        }
    };

    let g = null;
    await gitPlugin({ app: { host: {} }, log: { on: () => logger }, workspace }, async (_e, s) => { g = s.git; });

    const said = await g.fastForward('repo-one', 'master', 'refs/remotes/origin/master');

    assert.equal(at('master'), sneak,
        'the commit that arrived mid-flight was overwritten — this is a force-push with extra steps');
    assert.equal(said.moved, false, 'it reported moving a ref it did not move');
    assert.ok(said.why, 'it lost the race and said nothing');
});

test('a branch already level is left alone and says so, rather than failing', async () => {
    const g = await aGit();
    const said = await g.fastForward('repo-one', 'master', 'refs/remotes/origin/master');
    assert.equal(said.moved, false);
    assert.equal(said.already, true);
    assert.equal(said.why, null, 'being level was reported as a reason it could not move');
});

test('a ref that does not resolve is refused rather than guessed at', async () => {
    const g = await aGit();
    assert.match((await g.fastForward('repo-one', 'nope', 'master')).why, /no branch called "nope"/);
    assert.match((await g.fastForward('repo-one', 'master', 'nowhere')).why, /nothing at "nowhere"/);
});

//---------------------------------------------------------------------------
//4. MAKING AND REMOVING.
//---------------------------------------------------------------------------

test('a branch is cut from a named start, without moving the working tree', async () => {
    const g = await aGit();
    const before = git(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim();

    const said = await g.makeBranch('repo-one', 'work/thing', 'master');
    assert.equal(said.made, true);
    assert.equal(said.at, at('master'));
    assert.equal(at('work/thing'), at('master'));

    //`git branch`, NOT `checkout -b` — the second would move the working tree.
    assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim(), before,
        'making a branch changed which one is checked out');
});

test('a branch that is already there is not an error', async () => {
    const g = await aGit();
    await g.makeBranch('repo-one', 'work/thing', 'master');
    const again = await g.makeBranch('repo-one', 'work/thing', 'master');
    assert.equal(again.made, false);
    assert.equal(again.already, true);
    assert.equal(again.why, null, 'two of three repositories having it read as a failure');
});

//ASKED OF GIT ITSELF rather than guessed at with a regex — the rules are
//intricate and a home-made check is subtly wrong in a way nobody notices.
test('a name git will not accept is refused before anything is made', async () => {
    const g = await aGit();
    for (const bad of ['has space', 'ends.lock', '..', 'back\\slash', '-leading', 'tilde~1', 'caret^', 'colon:here']) {
        const said = await g.makeBranch('repo-one', bad, 'master');
        assert.equal(said.made, false, '"' + bad + '" was accepted as a branch name');
        assert.match(said.why, /not a name git will accept/);
    }
    assert.deepEqual((await g.branches('repo-one')).sort(), ['master'], 'something was created anyway');
});

test('a start point that does not exist is refused', async () => {
    const g = await aGit();
    const said = await g.makeBranch('repo-one', 'work/thing', 'no-such-place');
    assert.equal(said.made, false);
    assert.match(said.why, /nothing at "no-such-place" to cut from/);
});

//`-d` REFUSES A BRANCH THAT IS NOT MERGED, and that refusal is the feature.
test('a branch with unmerged work is refused, and the refusal says why', async () => {
    const g = await aGit();
    await g.makeBranch('repo-one', 'work/thing', 'master');

    //put a commit on it that master has not got, without checking it out
    const tree = git(['rev-parse', 'master^{tree}'], repo).trim();
    const made = git(['commit-tree', tree, '-p', 'master', '-m', 'only here'], repo).trim();
    git(['update-ref', 'refs/heads/work/thing', made], repo);

    const said = await g.removeBranch('repo-one', 'work/thing');
    assert.equal(said.removed, false);
    assert.equal(said.unmerged, true, 'it did not report that the branch carries work');
    assert.ok((await g.branches('repo-one')).includes('work/thing'), 'it was deleted anyway');
});

test('force deletes it, and force is the only way', async () => {
    const g = await aGit();
    await g.makeBranch('repo-one', 'work/thing', 'master');
    const tree = git(['rev-parse', 'master^{tree}'], repo).trim();
    const made = git(['commit-tree', tree, '-p', 'master', '-m', 'only here'], repo).trim();
    git(['update-ref', 'refs/heads/work/thing', made], repo);

    assert.equal((await g.removeBranch('repo-one', 'work/thing')).removed, false);
    assert.equal((await g.removeBranch('repo-one', 'work/thing', { force: true })).removed, true);
    assert.ok(!(await g.branches('repo-one')).includes('work/thing'));
});

test('removing one that is not there is not an error', async () => {
    const g = await aGit();
    const said = await g.removeBranch('repo-one', 'never-existed');
    assert.equal(said.removed, false);
    assert.equal(said.already, true);
});

//---------------------------------------------------------------------------
//5. FETCH WRITES ONLY WHAT ORIGIN SAYS.
//---------------------------------------------------------------------------

test('fetch moves no local branch, and prunes what origin dropped', async () => {
    const g = await aGit();

    git(['push', '-q', 'origin', 'master:gone-later'], repo);
    await g.fetch('repo-one');
    assert.ok((await g.tracked('repo-one'))['gone-later'], 'the fetch did not bring the branch');

    const mine = at('master');
    git(['push', '-q', 'origin', '--delete', 'gone-later'], repo);
    await g.fetch('repo-one');

    assert.ok(!(await g.tracked('repo-one'))['gone-later'],
        'a branch deleted on the far end is still reported — every pane comparing against origin now lies');
    assert.equal(at('master'), mine, 'a fetch moved a local branch');
});

test('a repository with no origin says so rather than throwing', async () => {
    const g = await aGit();
    git(['remote', 'remove', 'origin'], repo);
    const said = await g.fetch('repo-one');
    assert.equal(said.fetched, false);
    assert.ok(said.why, 'it failed silently');
});

//---------------------------------------------------------------------------
//6. AND A BRANCH NAME STILL CANNOT RUN A COMMAND.
//
//The read side has this test already. The write side takes names from the same
//places and hands them to git the same way, and is the half where being wrong
//costs a repository rather than an answer.
//---------------------------------------------------------------------------
test('a branch name cannot run a command, on the write side either', async () => {
    const g = await aGit();
    const sentinel = path.join(work, 'pwned.txt');

    for (const bad of [
        'x; echo pwned > ' + sentinel,
        'x && echo pwned > ' + sentinel,
        '$(echo pwned > ' + sentinel + ')',
        '`echo pwned > ' + sentinel + '`'
    ]) {
        await g.makeBranch('repo-one', bad, 'master');
        await g.removeBranch('repo-one', bad, { force: true });
        await g.fastForward('repo-one', bad, 'master');
        assert.equal(fs.existsSync(sentinel), false, 'a branch name ran a command: ' + bad);
    }
});
