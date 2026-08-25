const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const child = require('node:child_process');

const gitPlugin = require('../../src/app/git/server');
const wsPlugin = require('../../src/app/workspace/server');
const cachedPlugin = require('../../src/app/core/cached/server');
const refsPlugin = require('../../src/app/repositories/refs/server');

//---------------------------------------------------------------------------
//the one thing in ../src/app/repositories that reads refs.
//
//AGAINST REAL REPOSITORIES, because what is being claimed is about git
//processes: how many run, and when an answer stops being believed. A fake git
//would answer both questions about the fake.
//
//THE CLAIMS:
//
//  * one read answers `of`, `branches` and `hasBranch` — the point of the
//    plugin, since `tracked` already walks every ref and the other two were
//    separate processes for facts it had in hand
//  * a write through ../src/app/git drops the answer AT ONCE, so a board drawn
//    straight after a button does not show what was true before it
//  * a write by somebody ELSE — a terminal — is noticed too. That one is the
//    case the app being ported from had no answer to beyond a one-second window
//  * and the negative that must not be derived: `hasBranch` is not `git.has`,
//    because a TAG is a real ref and is not in a list of branches
//---------------------------------------------------------------------------

let work, one, two, it;

const git = (args, cwd) => child.execFileSync('git', [
    '-c', 'user.email=drill@example.invalid',
    '-c', 'user.name=drill',
    '-c', 'commit.gpgsign=false'
].concat(args), { cwd: cwd, stdio: 'pipe' }).toString();

function repoAt(where, branch) {
    fs.mkdirSync(where);
    git(['init', '-q', '-b', 'master'], where);
    fs.writeFileSync(path.join(where, 'readme.md'), 'one\n');
    git(['add', '.'], where);
    git(['commit', '-q', '-m', 'first'], where);
    //THE BRANCH CARRIES SOMETHING. Cutting it at master's commit leaves the two
    //pointing at the same place, and "what does this branch still carry" is then
    //answerable as zero without asking git anything -- which is correct, and
    //makes a fixture that cannot exercise the answer at all.
    if (branch) {
        git(['checkout', '-q', '-b', branch], where);
        fs.writeFileSync(path.join(where, 'work.txt'), 'work\n');
        git(['add', '.'], where);
        git(['commit', '-q', '-m', 'work on the branch'], where);
        git(['checkout', '-q', 'master'], where);
    }
    return where;
}

before(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-refs-'));
    one = repoAt(path.join(work, 'repo-one'), 'work/thing');
    two = repoAt(path.join(work, 'repo-two'), null);
});

//ONE STACK FOR THE WHOLE FILE. Building it per test meant eleven workspaces,
//eleven git plugins and eleven sets of watches for a file whose claims are all
//about how many git processes ONE stack runs. `reset` below is what a fresh
//build was really being used for.
before(async () => { it = await build(); });

after(() => {
    try { it.destroy(); } catch { /* already gone */ }
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* windows may hold a handle */ }
});

//NOTHING IS BELIEVED FROM THE LAST TEST, and the counters start at nothing —
//which is the whole of what rebuilding was for.
beforeEach(() => { it.refs.forget(); it.reset(); });

async function build() {
    let workspace = null;
    await wsPlugin({
        app: { host: {} },
        okc: { call: async () => ({ workspace: { dir: work } }) },
        //THE PLUGIN DECLARES `log`, so a stand-in has to supply one. It says out
        //loud when it is borrowing a workspace from the other app rather than
        //using one chosen here, and a check that builds it by hand is exactly
        //the caller that would otherwise crash on the line that says so.
        log: { on: () => ({ good() {}, warn() {}, bad() {}, info() {} }) },
        state: {
            app: { doc: () => { let held = null; return {
                read: (f) => (held === null ? f : held),
                write: (v) => { held = v; return v; },
                forget: () => { held = null; return true; }
            }; } },
            follow: () => () => {}
        }
    }, async (_e, s) => { workspace = s.workspace; });

    const quiet = { on: () => ({ info() {}, good() {}, warn() {}, bad() {}, out() {} }) };

    let realGit = null;
    await gitPlugin({ app: { host: {} }, log: quiet, workspace },
        async (_e, s) => { realGit = s.git; });

    //NOWHERE TO WRITE, ON PURPOSE. Everything this plugin keeps is clock-keyed
    //and ../src/app/core/cached never writes that kind down anyway; a state with
    //no workspace behind it proves the whole path works with no disk at all.
    let cached = null;
    await cachedPlugin({
        app: {}, log: quiet,
        state: { here: { where: async () => null, doc: async () => { throw new Error('nowhere'); } } }
    }, async (_e, s) => { cached = s.cached; });

    //COUNTED, so a claim about how many git processes run is measured rather
    //than reasoned about. Everything else is the real plugin.
    const ran = { tracked: 0, branches: 0, head: 0, origin: 0, unlanded: 0, wouldConflict: 0 };
    const counting = Object.assign({}, realGit, {
        tracked: (r) => { ran.tracked++; return realGit.tracked(r); },
        branches: (r) => { ran.branches++; return realGit.branches(r); },
        head: (r) => { ran.head++; return realGit.head(r); },
        origin: (r) => { ran.origin++; return realGit.origin(r); },
        unlanded: (r, b, br) => { ran.unlanded++; return realGit.unlanded(r, b, br); },
        wouldConflict: (r, a, b) => { ran.wouldConflict++; return realGit.wouldConflict(r, a, b); }
    });

    const app = { on: () => {} };
    let refs = null, destroy = null;
    await refsPlugin({ app, log: quiet, git: counting, workspace, cached },
        async (_e, s) => { refs = s.refs; destroy = s.onDestroy; });

    return {
        refs, git: realGit, workspace, ran, destroy, cached,
        reset: () => { Object.keys(ran).forEach((k) => { ran[k] = 0; }); }
    };
}

//WAITING ON THE FREE SIGNAL, NOT ON THE EXPENSIVE ANSWER.
//
//THIS POLLED `hasBranch` AND IT WAS A CPU SPIKE. Once the watcher drops the
//drawer, every ask spawns git — so a 50ms loop waiting four seconds is up to
//eighty git processes, racing the very watcher it is waiting for. Which is
//exactly the fault ../tools/walk.js already had and already has a note about:
//asking harder makes the thing you are waiting for slower.
//
//THE DRAWER'S OWN COUNT SAYS THE SAME THING FOR NOTHING. `held` falls to zero
//the moment the watch fires, in memory, with no process anywhere — so this
//waits on that and asks git exactly once, afterwards.
//THE DRAWER ITSELF, not a total. ../src/app/core/cached hands back the same
//drawer for the same name, so this is the one the plugin is using.
//
//WAITING ON THE TOTAL WAS WRONG AND PASSED FOR A BUG IN THE CODE. `forget(repo)`
//drops ONE repository — correctly, that is the point of the test two below —
//so with two repositories warmed the total never reaches zero and the wait
//always timed out. The signal has to be the key that should have gone.
function peek(cached, drawer, key) {
    return cached.whileFresh(drawer, 1).peek(key);
}

async function dropped(cached, drawer, key, why, ms) {
    const stop = Date.now() + (ms || 4000);
    while (peek(cached, drawer, key) !== undefined) {
        if (Date.now() > stop) throw new Error('waited ' + (ms || 4000) + 'ms and ' + why);
        await new Promise(r => setTimeout(r, 100));
    }
    return true;
}

test('one read answers every question that is really about the same read', async () => {

    const rows = await it.refs.of('repo-one');
    const names = await it.refs.branches('repo-one');
    const has = await it.refs.hasBranch('repo-one', 'work/thing');
    const nope = await it.refs.hasBranch('repo-one', 'not-a-branch');

    assert.deepEqual(names, ['master', 'work/thing']);
    assert.equal(has, true);
    assert.equal(nope, false);
    assert.ok(rows['master'].local);

    assert.equal(it.ran.tracked, 1, 'four questions, one read');
    assert.equal(it.ran.branches, 0, '`git branch` is a second process for a list already in hand');

});

test('a repository is read once per window however many panes ask', async () => {

    //THREE PANES, EACH ASKING THE SAME BOARD, which is what unsynchronised
    //pollers do.
    await Promise.all([
        it.refs.of('repo-one'), it.refs.of('repo-one'), it.refs.of('repo-one')
    ]);
    await it.refs.of('repo-one');

    assert.equal(it.ran.tracked, 1);

    //ACROSS BOTH REF DRAWERS, because which one a repository's answers go in
    //depends on whether its `fs.watch` started: a watched repository is believed
    //for minutes, an unwatched one for one draw. Naming `refs` alone asked about
    //a drawer this fixture does not fill — it starts no watch — and the question
    //here is not about the window at all. It is that three panes asking at once
    //cost one read.
    const shared = it.cached.about()
        .filter(d => d.name === 'refs' || d.name === 'refs-unwatched')
        .reduce((n, d) => n + d.shared, 0);
    assert.equal(shared, 2,
        'the two that arrived mid-read must wait on the first, not start their own');

});

test('a write through git drops the answer at once rather than after the window', async () => {

    await it.refs.of('repo-two');
    assert.equal(await it.refs.hasBranch('repo-two', 'cut-by-the-app'), false);
    assert.equal(it.ran.tracked, 1);

    //THROUGH THE APP'S OWN WRITE DOOR, which is what a button does.
    const made = await it.git.makeBranch('repo-two', 'cut-by-the-app', 'master');
    assert.equal(made.made, true, made.why || '');

    //NO WAITING. The window is two seconds; if this needed it, a board drawn
    //straight after the button would show what was true before it.
    assert.equal(await it.refs.hasBranch('repo-two', 'cut-by-the-app'), true);
    assert.equal(it.ran.tracked, 2, 'exactly one re-read, not none and not per question');

});

test('a write in a terminal is noticed too', async () => {
    await it.refs.warm();

    const before = it.ran.tracked;
    assert.equal(await it.refs.hasBranch('repo-one', 'cut-by-hand'), false);
    assert.notEqual(peek(it.cached, 'refs', 'repo-one'), undefined,
        'the answer must be in the drawer to begin with');

    //NOTHING IN THIS APP DID THIS, which is the ordinary way a branch appears.
    const t0 = Date.now();
    git(['branch', 'cut-by-hand'], one);

    //AND IT HAS TO BE THE WATCHER THAT NOTICED, not the window running out.
    //
    //THE WINDOW IS TWO SECONDS AND IT HIDES THIS TEST COMPLETELY. With the
    //filter broken so that no ref write was ever noticed, this still passed:
    //the entry went stale on its own and the poll below saw it go. A backstop
    //that silently stands in for the mechanism it backs up is worse than no
    //backstop, because the suite goes green either way.
    //
    //THE WATCHER SETTLES IN 150ms. Anything past a second is the clock.
    await dropped(it.cached, 'refs', 'repo-one',
        'the branch cut in a terminal was never noticed', 1200);

    const took = Date.now() - t0;
    assert.ok(took < 1200, 'it took ' + took + 'ms — that is the window expiring, not the watch firing');

    //AND ONLY NOW IS GIT ASKED, once.
    assert.equal(await it.refs.hasBranch('repo-one', 'cut-by-hand'), true);
    assert.equal(it.ran.tracked, before + 1, 'exactly one re-read after the watch fired');

});

test('one repository changing does not throw away what is known about the others', async () => {
    await it.refs.warm();

    const after = it.ran.tracked;
    await it.git.makeBranch('repo-two', 'only-in-two', 'master');

    //repo-one WAS NOT TOUCHED, so asking about it must still be free.
    await it.refs.of('repo-one');
    assert.equal(it.ran.tracked, after, 'a write in one repository re-read another');

    await it.refs.of('repo-two');
    assert.equal(it.ran.tracked, after + 1);

});

test('hasBranch is not git.has, because a tag is a real ref', async () => {

    git(['tag', 'v1.0'], one);
    it.refs.forget('repo-one');

    //THE NEGATIVE IS THE DANGEROUS HALF. `git.has` resolves any ref and says
    //yes; a cheaper `has` derived from a list of BRANCHES would say no, and a
    //caller would refuse something that is really there.
    assert.equal(await it.git.has('repo-one', 'v1.0'), true);
    assert.equal(await it.refs.hasBranch('repo-one', 'v1.0'), false,
        'hasBranch answers about branches — anything meaning "resolve this ref" must keep asking git');

});

test('hasRemote takes either spelling of the same question', async () => {

    //NO ORIGIN HERE, so both spellings are false and neither throws — which is
    //what "only here" means for every branch this app cuts.
    assert.equal(await it.refs.hasRemote('repo-one', 'master'), false);
    assert.equal(await it.refs.hasRemote('repo-one', 'refs/remotes/origin/master'), false);

});

test('heads gives every branch in every repository as a lookup', async () => {

    const at = await it.refs.heads();

    assert.ok(at['repo-one'] && at['repo-one']['master'], 'repo-one master should have a commit');
    assert.ok(at['repo-two'] && at['repo-two']['master']);
    assert.equal(it.ran.tracked, 2, 'one read per repository, not one per branch');

});

test('warm reads everything once, so the first board is not the slowest', async () => {

    const found = await it.refs.warm();
    assert.equal(found, 2);

    const after = { ...it.ran };
    await it.refs.of('repo-one');
    await it.refs.head('repo-one');
    await it.refs.origin('repo-one');

    assert.deepEqual(it.ran, after, 'everything asked after a warm must come from the drawer');

});

test('a repository with no origin says so rather than throwing', async () => {
    assert.equal(await it.refs.origin('repo-one'), null);
});

test('asking where a repository came from does not throw away its refs', async () => {
    await it.refs.of('repo-one');
    const after = it.ran.tracked;

    //`git remote get-url` HAS A SUBCOMMAND THAT IS NOT IN ../src/app/git's
    //READS, on purpose — one word there would open `remote set-url`. So the
    //"anything not a read has written" rule announced this as a write, and
    //everything listening dropped the repository it had just read.
    //
    //NOTHING LOOKED WRONG. The drawer filled, the counters were healthy, and
    //the cache held nothing at all.
    await it.refs.origin('repo-one');
    await it.refs.of('repo-one');

    assert.equal(it.ran.tracked, after,
        'a read announced itself as a write and emptied the drawer it had just filled');
});

//---------------------------------------------------------------------------
//THE TWO EXPENSIVE ANSWERS, AND THE CLAIM THAT MATTERS ABOUT THEM.
//
//It is NOT that they are cached — they were, in ../../src/app/git, on exactly
//the right key. It is that the key is FREE here. Over there it cost two
//rev-parse processes to build, run on a hit as well as a miss, so the heavy
//call really was skipped and the timing never moved.
//---------------------------------------------------------------------------

test('what a branch still carries is worked out once per pair of commits', async () => {
    const first = await it.refs.unlanded('repo-one', 'master', 'work/thing');
    const again = await it.refs.unlanded('repo-one', 'master', 'work/thing');

    assert.equal(first, again);
    assert.equal(it.ran.unlanded, 1, 'the second ask must not run git cherry again');
});

test('and asking again spawns nothing at all, which is the whole point', async () => {
    await it.refs.of('repo-one');
    await it.refs.unlanded('repo-one', 'master', 'work/thing');

    const after = { ...it.ran };
    await it.refs.unlanded('repo-one', 'master', 'work/thing');
    await it.refs.unlanded('repo-one', 'master', 'work/thing');

    //NOT ONE PROCESS. Not `unlanded`, and not a rev-parse to build its key —
    //the shas came out of the ref read this plugin had already done.
    assert.deepEqual(it.ran, after,
        'building the key cost a git process, which is the fault this move was for');
});

test('a moved branch is a different pair of commits, so it is worked out again', async () => {
    await it.refs.unlanded('repo-one', 'master', 'work/thing');
    const before = it.ran.unlanded;

    git(['checkout', '-q', 'work/thing'], one);
    git(['commit', '-q', '--allow-empty', '-m', 'more work'], one);
    git(['checkout', '-q', 'master'], one);
    it.refs.forget('repo-one');

    await it.refs.unlanded('repo-one', 'master', 'work/thing');
    assert.equal(it.ran.unlanded, before + 1, 'a moved branch must not be answered from the old key');
});

test('whether two branches would conflict is worked out once, then costs nothing', async () => {
    const said = await it.refs.wouldConflict('repo-one', 'master', 'work/thing');
    assert.ok(said && 'clean' in said);

    await it.refs.of('repo-one');
    const after = { ...it.ran };
    await it.refs.wouldConflict('repo-one', 'master', 'work/thing');

    assert.deepEqual(it.ran, after, 'merge-tree ran again for the same two commits');
});

test('a ref this cannot key is handed back to git rather than guessed at', async () => {
    //TWO DIFFERENT TAGS, AND THAT IS THE POINT OF THE TEST.
    //
    //Asking about ONE proves nothing: a `shaIn` that invented a sha for
    //anything it did not recognise would still cause exactly one git call, and
    //the check would pass. The damage only shows with a second unkeyable ref —
    //it would share the invented key and be answered with the first one's
    //result, which is a wrong answer rather than a slow one.
    git(['tag', 'v9.9', 'master'], one);
    git(['tag', 'v8.8', 'work/thing'], one);
    it.refs.forget('repo-one');

    //A TAG IS NOT IN A LIST OF BRANCHES, so there is no sha here to key on —
    //and answering "cannot tell" would be worse than asking. It asks.
    const a = await it.refs.wouldConflict('repo-one', 'master', 'v9.9');
    const b = await it.refs.wouldConflict('repo-one', 'master', 'v8.8');

    assert.ok(a && 'clean' in a);
    assert.ok(b && 'clean' in b);
    assert.equal(it.ran.wouldConflict, 2,
        'two different refs were pooled under one key and the second got the first one’s answer');
});
