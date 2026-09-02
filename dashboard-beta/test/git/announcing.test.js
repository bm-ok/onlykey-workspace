const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const child = require('node:child_process');

const gitPlugin = require('../../src/app/git/server');

//---------------------------------------------------------------------------
//SAYING WHAT IT DID.
//
//This plugin knows nothing about caching and announces every write instead —
//`wrote(fn)` subscribes, and ../repositories/refs is the only listener, keeping
//a drawer of branches per repository. The announcement is the ONLY thing that
//empties that drawer.
//
//NOTHING TESTED IT, and that is how `branch` came to be on the READS list.
//`git branch` reads with `--list` and writes with everything else, and this app
//only ever writes with it — `makeBranch` and `removeBranch` are the two call
//sites, and every branch READ goes through `for-each-ref`. So both branch
//writes were classified as reads and announced nothing, and `refs` went on
//saying a deleted branch was still there and a new one was not yet there.
//
//It is the same trap the `remote get-url` note in that file describes: a
//subcommand whose name reads like a read and whose flags write. The list is
//phrased the safe way round for a NEW door, which does nothing about an
//existing entry that is too coarse.
//
//SO THE PROPERTY IS TESTED DIRECTLY: a declared write announces. Adding a
//seventh write means adding a line to the table below, which is the point.
//
//REAL REPOSITORIES AND REAL GIT, as in ./writes.test.js and for the same
//reason: what is being tested is what git does with the argv this builds.
//---------------------------------------------------------------------------

let work, repo, elsewhere;

const git = (args, cwd) => child.execFileSync('git', [
    '-c', 'user.email=drill@example.invalid',
    '-c', 'user.name=drill',
    '-c', 'commit.gpgsign=false'
].concat(args), { cwd, stdio: 'pipe' }).toString();

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

//WHAT WAS ANNOUNCED SINCE THE LAST TIME THIS WAS ASKED.
function recorder(g) {
    const heard = [];
    g.wrote((what) => heard.push(what));
    return {
        since() { const was = heard.slice(); heard.length = 0; return was; }
    };
}

let holder, template;

before(() => {
    holder = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-announce-'));
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
    repo = path.join(work, 'repo-one');
    elsewhere = path.join(work, 'elsewhere');
});

after(() => {
    try { fs.rmSync(holder, { recursive: true, force: true }); } catch { /* windows may hold a handle */ }
});

//HOW TO MAKE EACH DECLARED WRITE ACTUALLY WRITE. A write that returns early
//without spawning git has nothing to announce and is not what this is about, so
//each one is set up to really do its work.
const EXERCISE = {
    makeBranch: async (g) => { await g.makeBranch('repo-one', 'feature', 'master'); },

    removeBranch: async (g, rec) => {
        await g.makeBranch('repo-one', 'doomed', 'master');
        rec.since();
        await g.removeBranch('repo-one', 'doomed');
    },

    fetch: async (g) => { await g.fetch('repo-one'); },

    checkout: async (g, rec) => {
        await g.makeBranch('repo-one', 'over-there', 'master');
        rec.since();
        await g.checkout('repo-one', 'over-there');
    },

    push: async (g) => {
        await g.makeBranch('repo-one', 'to-send', 'master');
        await g.push('repo-one', 'to-send');
    },

    fastForward: async (g, rec) => {
        //ORIGIN HAS TO REALLY BE AHEAD, or this refuses and writes nothing.
        fs.writeFileSync(path.join(elsewhere, 'more.md'), 'more\n');
        git(['add', '.'], elsewhere);
        git(['commit', '-q', '-m', 'second'], elsewhere);
        git(['push', '-q', 'origin', 'master'], elsewhere);
        await g.fetch('repo-one');
        rec.since();
        //`toRef` IS REQUIRED. Without it this returns early with "there is
        //nothing at undefined to move to", writes nothing, and announcing
        //nothing is then correct -- which is how this test first passed itself
        //off as having found a second silent write.
        await g.fastForward('repo-one', 'master', 'refs/remotes/origin/master');
    }
};

test('every declared write announces that it wrote', async () => {
    const g = await aGit();

    //THE TABLE AND THE DECLARATION HAVE TO AGREE, so a write added without a
    //line here fails rather than going untested.
    assert.deepEqual(Object.keys(EXERCISE).slice().sort(), g.WRITES.slice().sort(),
        'a declared write has no line in EXERCISE, so nothing here would notice if it stopped announcing');

    for (const name of g.WRITES) {
        const fresh = await aGit();
        const rec = recorder(fresh);
        await EXERCISE[name](fresh, rec);
        const heard = rec.since();
        assert.ok(heard.length >= 1,
            name + ' wrote and announced nothing — anything caching what it changed keeps a stale answer');
        assert.ok(heard.every((h) => h && h.dir && h.did),
            name + ' announced without saying where or what');
    }
});

test('a read announces nothing', async () => {
    //THE OTHER HALF, and the reason the READS list exists at all: an
    //announcement on every read empties the drawer as fast as it fills, and
    //every part of it goes on reporting perfectly.
    const g = await aGit();
    const rec = recorder(g);

    await g.branches('repo-one');
    await g.head('repo-one');
    await g.commits('repo-one', 'master', 'master');
    await g.has('repo-one', 'master');

    assert.deepEqual(rec.since(), [], 'a read announced a write, so nothing can keep a cache');
});

test('the reads are exactly these, and `branch` is not one of them', async () => {
    //Same shape as the WRITES assertion in ./writes.test.js: the set changing
    //is a thing to argue for in a diff rather than to notice later.
    //
    //`branch` IS THE ENTRY THIS FILE EXISTS FOR. It was here, it reads like a
    //read, and both of this app's uses of it write.
    const g = await aGit();
    assert.deepEqual(g.READS.slice().sort(), [
        'cat-file', 'cherry', 'diff', 'for-each-ref', 'log', 'ls-files',
        'merge-base', 'merge-tree', 'rev-list', 'rev-parse', 'show', 'status'
    ], 'what counts as a read changed — a subcommand that can write must not be on this list');
    assert.ok(g.READS.indexOf('branch') < 0,
        'git branch writes in this app: makeBranch and removeBranch are its only two callers');
});
