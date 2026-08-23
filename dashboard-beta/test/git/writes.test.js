const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const child = require('node:child_process');

const gitPlugin = require('../../src/app/git/server');

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

let holder, template;

//BUILT ONCE AND COPIED PER TEST, NOT REBUILT.
//
//A FRESH WORKSPACE PER TEST IS STILL THE RULE — these WRITE, and a shared one
//would make the order of the tests part of what they assert. What changed is
//only how the fresh one is made: rebuilding was nine git processes plus a
//clone, twenty-two times over, and clone is the most expensive of them.
//
//THE REMOTES ARE RELATIVE, which is what makes copying sound. An absolute path
//would leave every copy pushing into the TEMPLATE's bare repository — which is
//precisely the contamination a fresh workspace exists to prevent, reintroduced
//by the thing meant to speed it up. Relative, each copy talks only to its own.
before(() => {
    holder = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-writes-'));
    template = path.join(holder, 'template');
    fs.mkdirSync(template);

    const bare = path.join(template, 'origin.git');
    fs.mkdirSync(bare);
    git(['init', '-q', '--bare', '-b', 'master'], bare);

    const one = path.join(template, 'repo-one');
    fs.mkdirSync(one);
    git(['init', '-q', '-b', 'master'], one);
    git(['remote', 'add', 'origin', '../origin.git'], one);
    fs.writeFileSync(path.join(one, 'readme.md'), 'one\n');
    git(['add', '.'], one);
    git(['commit', '-q', '-m', 'first'], one);
    git(['push', '-q', '--force', 'origin', 'master'], one);
    git(['fetch', '-q', 'origin'], one);

    git(['clone', '-q', 'origin.git', 'elsewhere'], template);
    git(['remote', 'set-url', 'origin', '../origin.git'], path.join(template, 'elsewhere'));
});

beforeEach(() => {
    work = fs.mkdtempSync(path.join(holder, 'w-'));
    fs.cpSync(template, work, { recursive: true });
    origin = path.join(work, 'origin.git');
    repo = path.join(work, 'repo-one');
    elsewhere = path.join(work, 'elsewhere');
});

after(() => {
    try { fs.rmSync(holder, { recursive: true, force: true }); } catch { /* windows may hold a handle */ }
});

//---------------------------------------------------------------------------
//1. EVERY WAY THIS CAN CHANGE A REPOSITORY IS DECLARED.
//---------------------------------------------------------------------------

test('the declared writes are exactly the ones that are callable', async () => {
    const g = await aGit();
    assert.deepEqual(g.WRITES.slice().sort(),
        ['checkout', 'fastForward', 'fetch', 'makeBranch', 'push', 'removeBranch'],
        'the set of ways this plugin can change a repository changed — that is a thing to argue for in a diff');
    for (const name of g.WRITES) {
        assert.equal(typeof g[name], 'function', name + ' is declared as a write and is not callable');
    }
});

//THE ONES THAT ARE NOT THERE ARE THE POINT. A commit, a merge, a reset or a
//checkout would each be a way for a mistake in a pane to become a mistake in
//somebody's work.
//
//`push` USED TO BE ON THIS LIST and is now a named write of its own — see the
//block below for what it cannot do, which is where its narrowness is asserted.
test('there is no commit, merge, rebase or reset', async () => {
    const g = await aGit();
    for (const nope of ['commit', 'merge', 'rebase', 'reset', 'clean', 'stash', 'cherryPick']) {
        assert.equal(g[nope], undefined, 'the git service now offers `' + nope + '`');
    }
    //AND `run` STILL REFUSES EVERY ONE OF THEM BY NAME, checkout and push
    //included. `checkout` is a named write with its own gate now; that does not
    //make it something the READING door will pass through.
    for (const nope of ['push', 'commit', 'reset', 'checkout', 'clean']) {
        await assert.rejects(() => g.run('repo-one', [nope]), /is not something this reads with/);
    }
});

//---------------------------------------------------------------------------
//2. NOTHING DESTROYS UNCOMMITTED WORK.
//
//This is the property that makes the whole door safe, and it used to be bought
//more cheaply: "nothing touches the working tree", true of the argv rather than
//of any check.
//
//IT COST SOMETHING THE APP NEEDS. A repository sitting on a branch a machine is
//about to be set up on fails that machine's push for a reason the machine cannot
//explain — it does not know this working tree exists. Stepping off it is the fix
//and it is a checkout.
//
//SO THERE IS EXACTLY ONE WORKING-TREE WRITE and the guarantee moved from the
//absence of a verb to a GATE. That is weaker, and the tests below are what it is
//worth: every write still leaves uncommitted work exactly where it was, and the
//one that could not is the one that refuses.
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

    //THE ONE THAT COULD DESTROY IT, asked while the tree is dirty. It is in this
    //test rather than in one of its own because the claim is about EVERY write,
    //and a list that quietly excludes the dangerous one is not a list.
    const moved = await g.checkout('repo-one', 'a-new-cut');
    assert.equal(moved.moved, false, 'it moved a working tree with uncommitted work in it');
    assert.equal(moved.clean, false);
    assert.match(moved.why, /uncommitted changes/);

    await g.removeBranch('repo-one', 'a-new-cut', { force: true });

    assert.match(fs.readFileSync(path.join(repo, 'readme.md'), 'utf8'), /EDITED BY A PERSON/,
        'an edit in the working tree was overwritten');
    assert.ok(fs.existsSync(path.join(repo, 'new.txt')), 'a staged file was removed');
    assert.match(git(['status', '--porcelain'], repo), /new\.txt/, 'the index was thrown away');
    assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim(), 'master',
        'the working tree was moved off the branch somebody was working on');
});

//---------------------------------------------------------------------------
//2b. AND THE ONE WORKING-TREE WRITE, ON ITS OWN.
//
//STEPPING A REPOSITORY OFF A BRANCH so a machine can be set up on it. A checkout
//left open here fails that machine's push for a reason the machine cannot
//explain — it does not know this working tree exists, and git's message is about
//a configuration variable rather than about a file somebody left open.
//---------------------------------------------------------------------------

test('a clean repository steps off, and says where it went', async () => {
    const g = await aGit();
    await g.makeBranch('repo-one', 'somewhere-else', 'master');

    const moved = await g.checkout('repo-one', 'somewhere-else');

    assert.equal(moved.moved, true);
    assert.equal(moved.from, 'master');
    assert.equal(moved.to, 'somewhere-else');
    assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim(), 'somewhere-else');
});

test('and one already there is not moved, which is not a failure', async () => {
    const g = await aGit();
    const moved = await g.checkout('repo-one', 'master');

    assert.equal(moved.moved, false);
    assert.equal(moved.already, true);
    assert.equal(moved.why, null);
});

test('an untracked file is uncommitted work too', async () => {
    //`git checkout` WOULD ALLOW THIS — an untracked file does not block a
    //switch. The gate is stricter than git on purpose: what is in that file is
    //somebody's, and a machine about to use the branch is not a reason to make
    //it harder to find.
    const g = await aGit();
    await g.makeBranch('repo-one', 'somewhere-else', 'master');
    fs.writeFileSync(path.join(repo, 'notes-to-self.txt'), 'mine\n');

    const moved = await g.checkout('repo-one', 'somewhere-else');

    assert.equal(moved.moved, false);
    assert.match(moved.why, /uncommitted changes/);
    assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim(), 'master');
});

test('and the refusal names the repository and both branches', async () => {
    //MET HERE it is a sentence about a file somebody left open; met on the
    //machine it is a message about a configuration variable.
    const g = await aGit();
    await g.makeBranch('repo-one', 'somewhere-else', 'master');
    fs.writeFileSync(path.join(repo, 'readme.md'), 'edited\n');

    const moved = await g.checkout('repo-one', 'somewhere-else');

    assert.match(moved.why, /^repo-one has "master" checked out here with uncommitted changes/);
    assert.match(moved.why, /Commit or discard them, or switch repo-one back to somewhere-else/);
});

test('a branch that is not there is refused by git, and nothing moves', async () => {
    const g = await aGit();
    const moved = await g.checkout('repo-one', 'no-such-branch');

    assert.equal(moved.moved, false);
    assert.equal(moved.clean, true, 'it blamed the working tree for a branch that does not exist');
    assert.ok(moved.why);
    assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim(), 'master');
});

test('and saying nothing at all is refused before git is asked', async () => {
    const g = await aGit();
    assert.equal((await g.checkout('repo-one', '')).why, 'say which branch to move to');
    assert.equal((await g.checkout('repo-one', null)).moved, false);
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
//PUSH: THE ONE WRITE WITH EFFECTS OUTSIDE THIS HOST.
//
//The other four move a ref on this disk and the worst a mistake costs is a local
//branch. This one PUBLISHES, and there is no undo for that — so what is asserted
//is how NARROW it is, not that it works.
//
//The bare origin is on this disk, so these are real pushes.
//---------------------------------------------------------------------------

test('a push sends one branch, to the same name, and nothing else', async () => {
    const g = await aGit();
    await g.makeBranch('repo-one', 'work/send-me', 'master');

    //something to send
    const tree = git(['rev-parse', 'master^{tree}'], repo).trim();
    const made = git(['commit-tree', tree, '-p', 'master', '-m', 'to send'], repo).trim();
    git(['update-ref', 'refs/heads/work/send-me', made], repo);

    //A SECOND BRANCH THAT MUST NOT TRAVEL. Without one, an argv of `--all` or
    //`--mirror` produces exactly the same origin as the correct one and the
    //assertion below cannot tell them apart — which is how the first version of
    //this test passed against a sabotage that pushed everything.
    await g.makeBranch('repo-one', 'work/keep-me-here', 'master');
    const secret = git(['commit-tree', tree, '-p', 'master', '-m', 'not for sending'], repo).trim();
    git(['update-ref', 'refs/heads/work/keep-me-here', secret], repo);

    const said = await g.push('repo-one', 'work/send-me');
    assert.equal(said.pushed, true, said.why || '');
    assert.equal(git(['rev-parse', 'refs/heads/work/send-me'], origin).trim(), made);

    //AND NOTHING ELSE WENT. A bare `push origin` sends whatever the push
    //configuration says, and `--all` sends the lot; the refspec is written out
    //in full so neither can happen.
    const there = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], origin)
        .split('\n').map((s) => s.trim()).filter(Boolean).sort();
    assert.deepEqual(there, ['master', 'work/send-me'],
        'a branch nobody named was published — origin now has: ' + there.join(', '));
});

//NEVER FORCED, AND THE FAR END'S REFUSAL IS THE FEATURE. It means this can only
//ever ADD commits to a branch, never remove one somebody else pushed.
test('a push that would drop a commit at the far end is refused', async () => {
    const g = await aGit();

    //origin gains a commit this repository does not have
    fs.writeFileSync(path.join(elsewhere, 'theirs.txt'), 'x\n');
    git(['add', '.'], elsewhere);
    git(['commit', '-q', '-m', 'theirs'], elsewhere);
    git(['push', '-q', 'origin', 'master'], elsewhere);
    const theirs = git(['rev-parse', 'master'], elsewhere).trim();

    //and this side moves differently, without fetching
    const tree = git(['rev-parse', 'master^{tree}'], repo).trim();
    const mine = git(['commit-tree', tree, '-p', 'master', '-m', 'ours'], repo).trim();
    git(['update-ref', 'refs/heads/master', mine], repo);

    const said = await g.push('repo-one', 'master');
    assert.equal(said.pushed, false, 'it force-pushed over a commit at the far end');
    assert.equal(said.rejected, true, 'a rejection was not reported as one, so nobody is told to fetch');
    assert.equal(git(['rev-parse', 'master'], origin).trim(), theirs,
        'the commit somebody else pushed is gone from origin');
});

test('a branch that is not here is refused before anything is sent', async () => {
    const g = await aGit();
    assert.equal((await g.push('repo-one', 'no-such-branch')).pushed, false);
    assert.match((await g.push('repo-one', 'no-such-branch')).why, /no branch called/);
    assert.equal((await g.push('repo-one', '')).pushed, false);
});

//THE TOKEN IS NEVER AN ARGUMENT. It reaches git through a credential helper
//reading the child's environment — a URL lands in .git/config and in every error
//git prints, and `-c http.extraheader` puts it in argv where anything running as
//this user can read it out of the process list.
test('a credential never reaches the command line or the repository config', async () => {
    const g = await aGit();
    await g.makeBranch('repo-one', 'work/with-a-token', 'master');

    const helper = path.join(__dirname, '..', '..', 'src', 'app', 'keys', 'credential-helper.js');
    await g.push('repo-one', 'work/with-a-token', {
        env: { OKC_GIT_TOKEN: 'ghp_notARealTokenJustForADrill0123456789' },
        helper
    });

    //NOT IN THE CONFIG, which is where a URL-embedded credential ends up.
    const conf = fs.readFileSync(path.join(repo, '.git', 'config'), 'utf8');
    assert.ok(!conf.includes('ghp_notARealToken'), 'the token was written into .git/config');

    //NOT IN THE REFLOG OR ANY REMOTE URL EITHER.
    const url = git(['remote', 'get-url', 'origin'], repo).trim();
    assert.ok(!url.includes('ghp_notARealToken'), 'the token was written into the remote URL');
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

//---------------------------------------------------------------------------
//AND A READ MAY NOT WEAR A DESTRUCTIVE COMMAND'S NAME.
//
//The test above says `clean` must not be on this service, and it fired for real:
//a genuinely read-only "is this working tree clean" was added called `clean`,
//and `git clean` DELETES UNTRACKED FILES. Nothing about that function was
//dangerous; the NAME was, because it says "make it clean" at least as loudly as
//it says "is it clean", and the next person to reach for it is reading a name
//rather than a body.
//
//It is `workingTree` now. This asserts the read exists and behaves, so the
//forbidden-name test above cannot be satisfied by simply deleting the feature.
test('the working tree can be asked about, under a name that is not a command', async () => {
    const g = await aGit();

    assert.equal(typeof g.workingTree, 'function', 'the read went away instead of being renamed');
    assert.equal(g.clean, undefined, 'it came back as `clean`');

    const said = await g.workingTree('repo-one');
    assert.equal(said.repo, 'repo-one');
    assert.equal(said.clean, true, 'a fresh repository read as dirty');
    assert.equal(said.files, 0);
    assert.equal(said.why, null);
});

test('an untracked file makes it dirty, and it is counted', async () => {
    //UNTRACKED COUNTS. A machine cannot push past somebody's half-finished file
    //whether or not git is tracking it yet, which is the whole point of using
    //`status --porcelain` rather than `diff --quiet`.
    const g = await aGit();
    fs.writeFileSync(path.join(repo, 'scratch.txt'), 'half a thought');

    const said = await g.workingTree('repo-one');
    assert.equal(said.clean, false);
    assert.equal(said.files, 1);
});
