const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const child = require('node:child_process');

const plugin = require('../src/app/git/server');

//---------------------------------------------------------------------------
//the one place that runs git.
//
//Built against a real repository rather than a stand-in: what this plugin does
//IS run git, so a fake git would be testing the fake. The workspace is a temp
//folder with one repository in it, two branches, and one changed file.
//
//THE TEST THAT MATTERS IS THE LAST ONE. Everything else here is behaviour; that
//one is the reason the code is shaped the way it is — `spawn` with an ARRAY and
//never a shell, so a branch name is a branch name however it is spelt.
//---------------------------------------------------------------------------

let work, repo, ran;

//git needs an identity to commit, and this must not read the machine's.
const git = (args, cwd) => child.execFileSync('git', [
    '-c', 'user.email=drill@example.invalid',
    '-c', 'user.name=drill',
    '-c', 'commit.gpgsign=false'
].concat(args), { cwd: cwd || repo, stdio: 'pipe' }).toString();

before(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-git-'));
    repo = path.join(work, 'repo-one');
    fs.mkdirSync(repo);

    git(['init', '-q', '-b', 'master']);
    fs.writeFileSync(path.join(repo, 'readme.md'), 'one\n');
    git(['add', '.']);
    git(['commit', '-q', '-m', 'first']);

    git(['checkout', '-q', '-b', 'work/thing']);
    fs.writeFileSync(path.join(repo, 'readme.md'), 'one\ntwo\n');
    fs.writeFileSync(path.join(repo, 'added.txt'), 'new\n');
    git(['add', '.']);
    git(['commit', '-q', '-m', 'a change to send out']);
    git(['checkout', '-q', 'master']);

    //a folder that is not a repository, to prove it is not offered as one
    fs.mkdirSync(path.join(work, 'not-a-repo'));
});

after(() => {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* windows may hold a handle */ }
});

async function theGit() {
    let git = null;
    await plugin({
        app: { host: {} },
        log: { on: () => ({ info() {}, good() {}, warn() {}, bad() {}, out() {} }) },
        okc: { call: async () => ({ workspace: { dir: work } }) }
    }, async (_e, s) => { git = s.git; });
    return git;
}

test('a repository is a folder with a .git in it, and nothing else is offered', async () => {
    const g = await theGit();
    const names = (await g.repos()).map((r) => r.name);
    assert.deepEqual(names, ['repo-one'], 'a plain folder was offered as a repository');
});

test('a name that is not in the workspace is refused, and the refusal says what is', async () => {
    const g = await theGit();
    await assert.rejects(() => g.branches('nope'), /no repository called "nope"/);
    await assert.rejects(() => g.branches('nope'), /repo-one/);
});

//A REPO IS A NAME, NEVER A PATH. This is the only place a path is produced, so
//it is the only place that has to be right about it — and a path from a caller
//is a path to anywhere on a disk this runs a program against.
test('a path is not a repository name', async () => {
    const g = await theGit();
    for (const bad of ['../repo-one', 'repo-one/.git', '/etc', 'C:\\Windows', '.']) {
        await assert.rejects(() => g.branches(bad), /no repository called/,
            'a path was accepted where a name belongs: ' + bad);
    }
});

test('it reads the branches, and which one is out', async () => {
    const g = await theGit();
    assert.deepEqual((await g.branches('repo-one')).sort(), ['master', 'work/thing']);
    assert.equal(await g.head('repo-one'), 'master');
    assert.equal(await g.has('repo-one', 'work/thing'), true);
    assert.equal(await g.has('repo-one', 'no/such/branch'), false);
});

test('what one branch carries that another does not', async () => {
    const g = await theGit();

    const files = await g.files('repo-one', 'master', 'work/thing');
    assert.deepEqual(files.map((f) => f.file).sort(), ['added.txt', 'readme.md']);
    const readme = files.find((f) => f.file === 'readme.md');
    assert.equal(readme.added, 1);
    assert.equal(readme.removed, 0);
    assert.equal(readme.binary, false);

    const log = await g.commits('repo-one', 'master', 'work/thing');
    assert.equal(log.length, 1, 'the first commit is on both sides and is not part of the change');
    assert.equal(log[0].subject, 'a change to send out');
    assert.equal(log[0].who, 'drill');

    const diff = await g.diff('repo-one', 'master', 'work/thing');
    assert.match(diff, /\+two/);
    assert.match(diff, /added\.txt/);

    //ONE FILE, AND `--` IS WHAT MAKES IT A FILE. Without it a file named like a
    //branch is read as a revision.
    const one = await g.diff('repo-one', 'master', 'work/thing', 'added.txt');
    assert.match(one, /added\.txt/);
    assert.ok(!/readme\.md/.test(one), 'asking for one file gave the whole diff');
});

//WRITING IS A SEPARATE DOOR AND IT IS NOT BUILT. A plugin that could commit by
//the same call that lists branches is one where a mistake in a pane is a mistake
//in a repository.
test('it will not write, and says so as a door rather than a rule', async () => {
    const g = await theGit();
    for (const bad of ['commit', 'push', 'reset', 'checkout', 'clean']) {
        await assert.rejects(() => g.run('repo-one', [bad]), /is not something this reads with/,
            '`git ' + bad + '` was allowed');
    }
    //the sentence has to point at the door rather than sound like a permission
    await assert.rejects(() => g.run('repo-one', ['push']), /door that is not built/);
});

//---------------------------------------------------------------------------
//THE ONE THAT SHAPES THE CODE.
//
//`spawn` with an ARRAY and no shell, so a branch called `x; touch pwned` is a
//branch called `x; touch pwned` — an argument, handed to git, which says there
//is no such ref. The moment anything here builds a command out of a string,
//every branch name in the workspace becomes something a person could type to run
//anything. This app has paid for that lesson twice at the other end already.
//---------------------------------------------------------------------------
test('a branch name cannot run a command', async () => {
    const g = await theGit();
    const sentinel = path.join(work, 'pwned.txt');

    const tries = [
        'master; echo x > ' + sentinel,
        'master && echo x > ' + sentinel,
        'master | echo x > ' + sentinel,
        '$(echo x > ' + sentinel + ')',
        '`echo x > ' + sentinel + '`',
        'master\n echo x > ' + sentinel
    ];

    for (const bad of tries) {
        //it may refuse or answer nothing; what it may NOT do is run anything
        try { await g.diff('repo-one', 'master', bad); } catch { /* expected */ }
        try { await g.files('repo-one', bad, 'master'); } catch { /* expected */ }
        assert.equal(fs.existsSync(sentinel), false, 'a branch name ran a command: ' + bad);
    }
});
