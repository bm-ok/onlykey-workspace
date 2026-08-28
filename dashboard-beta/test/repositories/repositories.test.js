const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const child = require('node:child_process');

const actionsPlugin = require('../../src/app/core/actions/main');
const statePlugin = require('../../src/app/core/state/main');
const Paged = require('../../src/app/github/paged');
const Many = require('../../src/app/github/many');
const gitPlugin = require('../../src/app/git/server');
const reposPlugin = require('../../src/app/repositories/repos/server');
const { refsFor } = require('../../tools/test-parts');

const APP = path.join(__dirname, '..', '..', 'src', 'app');

//---------------------------------------------------------------------------
//the third layer.
//
//THE CLAIM THIS FILE EXISTS FOR: a pane can get GitHub data without knowing a
//credential exists. Not "does not currently read one" — cannot. It does not
//consume keys, there is no path from here to a sealed file, and the only way it
//reaches GitHub is by asking `github` a question.
//
//THE GITHUB HALF IS A STAND-IN AND THE GIT HALF IS REAL. That split is the whole
//design of the test: what is being checked is how this plugin BEHAVES against
//answers from GitHub, and a real GitHub would make the test a network test with
//somebody's rate limit in it. The repositories and their remotes are real,
//because turning a remote URL into owner/repo is exactly what would rot.
//---------------------------------------------------------------------------

let work, repo;

const git = (args, cwd) => child.execFileSync('git', [
    '-c', 'user.email=drill@example.invalid',
    '-c', 'user.name=drill',
    '-c', 'commit.gpgsign=false'
].concat(args), { cwd: cwd || repo, stdio: 'pipe' }).toString();

before(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-repos-'));
    repo = path.join(work, 'repo-one');
    fs.mkdirSync(repo);
    git(['init', '-q', '-b', 'master']);
    fs.writeFileSync(path.join(repo, 'readme.md'), 'one\n');
    git(['add', '.']);
    git(['commit', '-q', '-m', 'first']);
    git(['remote', 'add', 'origin', 'https://github.com/anowner/arepo.git']);

    //a second one that is not on GitHub at all
    const other = path.join(work, 'repo-two');
    fs.mkdirSync(other);
    git(['init', '-q', '-b', 'master'], other);
    git(['remote', 'add', 'origin', 'git@gitlab.com:someone/thing.git'], other);

    //and one with no remote
    const bare = path.join(work, 'repo-three');
    fs.mkdirSync(bare);
    git(['init', '-q', '-b', 'master'], bare);
});

after(() => {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* windows may hold a handle */ }
});

//WHAT GITHUB SAID, AND WHAT WAS ASKED. The stand-in records every path so a test
//can assert the PROBE happened rather than trusting that it did.
function aGitHub(answers, budget) {
    const asked = [];
    //THE HOURLY BUDGET, WHICH A TEST HAS TO BE ABLE TO RUN DOWN. Every response
    //from GitHub carries it, so this is what the real one reads too -- and the
    //behaviour under a nearly-spent hour is the whole reason it is read.
    //THE CALLER'S OBJECT BY REFERENCE, not a copy of it. A budget that cannot
    //move during a sweep is not a budget: what is being tested is what happens
    //when reading one thing is what spends the room to read the next.
    const money = budget || { limit: 5000, left: 5000, resets: null, keepBack: 500 };
    if (money.keepBack == null) money.keepBack = 500;

    const call = async (method, at) => {
        asked.push(method + ' ' + at);
        //LONGEST PREFIX WINS, so a test can answer `/repos/o/r` and have
        //`/repos/o/r/branches?per_page=100` still find its own entry.
        const pre = Object.keys(answers)
            .filter((k) => at.startsWith(k))
            .sort((a, b) => b.length - a.length)[0];
        //AN ANSWER MAY BE A FUNCTION, so a test can answer differently per page.
        //Needed because a fixed answer carrying a `link` header would point at
        //itself and page for ever, which tests the cap rather than the paging.
        if (pre) return typeof answers[pre] === 'function' ? answers[pre](at) : answers[pre];
        return { status: 404, body: { message: 'nothing said about ' + at } };
    };

    return {
        asked,
        github: {
            call,
            //THE REAL PAGING, NOT A STAND-IN FOR IT. Same reason ./prcuts.test.js
            //uses the real `many`: a version that reads one page passes every
            //check a paging one does, so a stub here would go on passing on the
            //day the app stopped following `link` — which is the exact defect it
            //was written for.
            all: Paged(call, 20),
            //THE REAL POOL, for the reason ./prcuts.test.js already uses it: a
            //sequential stand-in passes every check a pooled one does, so the
            //tests would go on passing on the day this stopped being concurrent.
            many: Many(8),
            budget: () => money,
            spare: () => money.left == null || money.left > money.keepBack,
            check: async () => ({ ok: true }),
            apiHost: () => 'api.github.com'
        }
    };
}

async function anApp(answers, open, budget, extra) {
    let actions = null;
    await actionsPlugin({}, async (_e, s) => { actions = s.actions; });

    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-repos-data-'));
    let state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dataDir, ...p) } }, async (_e, s) => { state = s.state; });

    let where = open === undefined ? work : open;
    state.follow(async () => where);

    const said = [];
    const logger = { good: (t) => said.push(t), warn: (t) => said.push(t), bad: (t) => said.push(t), info: (t) => said.push(t) };

    const workspace = {
        dir: async () => where,
        folderOf: async (name) => {
            if (!where) throw new Error('no workspace is open');
            const at = path.join(where, name);
            if (!fs.existsSync(path.join(at, '.git'))) throw new Error('there is no repository called "' + name + '"');
            return at;
        },
        repos: async () => (where ? fs.readdirSync(where)
            .filter((n) => fs.existsSync(path.join(where, n, '.git')))
            .map((n) => ({ name: n })) : [])
    };

    let git_ = null;
    await gitPlugin({ app: { host: {} }, log: { on: () => logger }, workspace }, async (_e, s) => { git_ = s.git; });

    const gh = aGitHub(answers || {}, budget);

    //THE REAL ../../src/app/repositories/repositories/refs. This pane reads
    //through it now, so a stand-in would check the stand-in.
    const { refs, stop } = await refsFor({ git: git_, workspace, log: { on: () => logger } });

    //THE INBOX, KEPT RATHER THAN LEFT OUT. `source()` hands the `waiting`
    //function back so a test can ask what it WOULD raise — the pane that shows
    //it is in the other half and nothing here can see it otherwise.
    const sources = [];

    await reposPlugin({
        app: { host: { actions } },
        log: { on: () => logger },
        git: git_,
        github: gh.github,
        workspace,
        state,
        refs,
        inbox: {
            source: (spec) => { sources.push(spec); return () => {}; },
            item: (kind, which, why, where2, more) => Object.assign({ kind, which, why, where: where2 }, more || {}),
            at: (tab, pane, pick) => ({ tab, pane, pick })
        },
        //SETTINGS, WHEN A TEST NEEDS THEM. Absent, the plugin fails shut -- nobody
        //trusted, no marker, no wakes -- which is what every older test relies on.
        settings: (extra && extra.settings) || { read: async () => ({}) }
    }, async () => {});

    return { actions, asked: gh.asked, said, git: git_, refs, stop, sources, state, go: (to) => { where = to; } };
}

const REPO_OK = {
    '/repos/anowner/arepo': { status: 200, body: { default_branch: 'main', fork: false } },
    '/repos/anowner/arepo/branches': { status: 200, body: [{ name: 'main' }] },
    '/repos/anowner/arepo/pulls': { status: 200, body: [{ number: 1 }, { number: 2 }] }
};

//---------------------------------------------------------------------------
//1. THE LAYERING, AS A FACT ABOUT THE SOURCE.
//---------------------------------------------------------------------------

test('repositories does not consume keys, and cannot reach a credential', () => {
    const src = fs.readFileSync(path.join(APP, 'repositories', 'repos', 'server.js'), 'utf8');
    const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

    const consumes = code.match(/plugin\.consumes\s*=\s*\[([^\]]*)\]/)[1];
    assert.ok(!/['"]keys['"]/.test(consumes), 'repositories consumes keys — it should ask github instead');
    assert.ok(/['"]github['"]/.test(consumes), 'it does not consume github, so it is reaching GitHub some other way');

    assert.ok(!/\bsecret\b/.test(code), 'it names the sealing module');
    assert.ok(!/['"]credentials['"]/.test(code), 'it names the credentials folder');
    //THE STRING-STRIPPER HAS TO KNOW ABOUT ESCAPES, and it did not. `'One
    //repository\'s branches'` ended the match at the escaped apostrophe, so the
    //strip ran past the end of the string, swallowed the next line, and left a
    //mangled fragment that happened to contain the word this looks for. The test
    //went red about a sentence in an `about:` field.
    //
    //A regex cannot really parse a string literal, and this one does not have to
    //be perfect — it has to not be fooled by the constructions that are
    //everywhere in this codebase.
    //
    //DOUBLE QUOTES ARE ONE OF THEM, and leaving them out was the same trap one
    //layer along. A string is written "like this" here precisely WHEN it contains
    //an apostrophe — `"Pull each fork's default branch up"` — so stripping only
    //single-quoted strings left that apostrophe looking like the start of one.
    //The strip ran from it to the next quote several lines away, swallowed the
    //code in between, and the mangled fragment contained the word this looks for.
    //Red about an `about:` field again, one quote character different.
    //ONE PASS, EITHER KIND, LEFT TO RIGHT — not two passes.
    //
    //Stripping single quotes first and double quotes second does not work and is
    //the obvious way to write it. The first pass reaches the apostrophe inside
    //`"Pull each fork's default branch up"`, treats it as the START of a string,
    //and runs to the next quote several lines away — so the second pass is
    //handed text that has already been mangled.
    //
    //An alternation scans once: at that point in the text the `"` comes first,
    //so the whole double-quoted string matches and the apostrophe inside it is
    //consumed with it.
    const noStrings = code.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, '');

    assert.ok(!/\btoken\b/.test(noStrings),
        'it handles something called a token outside a message');
});

//---------------------------------------------------------------------------
//2. WHAT THE TOKEN MAY DO IS PROBED, NOT READ OFF THE REPOSITORY.
//
//The failure this prevents is silent and expensive: `permissions` on a GitHub
//repository object describes the ACCOUNT, so a fine-grained token reports
//`push: true, admin: true` and is refused the moment it asks for anything.
//---------------------------------------------------------------------------

test('capability comes from asking for the thing, not from `permissions`', async () => {
    const { actions, asked } = await anApp({
        '/repos/anowner/arepo': {
            status: 200,
            //EVERYTHING GRANTED, ACCORDING TO THE REPOSITORY OBJECT.
            body: { default_branch: 'main', fork: false, permissions: { push: true, admin: true, pull: true } }
        },
        //AND REFUSED THE MOMENT IT ASKS.
        '/repos/anowner/arepo/branches': { status: 403, body: { message: 'Resource not accessible by personal access token' } },
        '/repos/anowner/arepo/pulls': { status: 403, body: { message: 'Resource not accessible by personal access token' } }
    });

    const said = await actions.call('repositoriesCheck', { repo: 'repo-one' });
    const row = said.repos[0];

    assert.equal(row.reachable, true, 'the repository itself was reachable');
    assert.equal(row.may.code, false, 'it believed `permissions` — this is the failure that costs an hour of work');
    assert.equal(row.may.pulls, false);
    assert.match(row.why, /Contents/, 'it did not name the missing permission the way GitHub names it');
    assert.match(row.why, /Pull requests/);

    //THE PROBES ACTUALLY HAPPENED. Without this the test above passes on a
    //plugin that hard-codes `may: false`.
    //BY PREFIX, because the real call carries `?per_page=100` — asserting the
    //exact string would be asserting the paging, which is not what this is about.
    assert.ok(asked.some((a) => a.startsWith('GET /repos/anowner/arepo/branches')), 'it never asked for the branches');
    assert.ok(asked.some((a) => a.startsWith('GET /repos/anowner/arepo/pulls')), 'it never asked for the pull requests');
});

test('a repository the token may use reads as usable, with what is open', async () => {
    const { actions } = await anApp(REPO_OK);

    const said = await actions.call('repositoriesCheck', { repo: 'repo-one' });
    const row = said.repos[0];

    assert.equal(row.reachable, true);
    assert.deepEqual(row.may, { code: true, pulls: true });
    assert.equal(row.openPulls, 2);
    //NAMED `upstreamDefault` RATHER THAN `defaultBranch`, because the row also
    //carries the LOCAL default and they are different questions — the branch
    //this checkout is on, and the one GitHub calls default. Conflating them is
    //how "behind by 3" gets measured against the wrong thing.
    assert.equal(row.upstreamDefault, 'main');
    assert.equal(row.why, null);
    assert.match(said.note, /reachable/);
});

//---------------------------------------------------------------------------
//3. THE REMOTE IS PARSED IN ONE PLACE, AND WHAT IS NOT GITHUB IS SAID.
//---------------------------------------------------------------------------

test('a remote that is not github is named rather than guessed at', async () => {
    const { actions, asked } = await anApp(REPO_OK);
    const said = await actions.call('repositoriesCheck', { repo: 'repo-two' });

    assert.equal(said.repos[0].reachable, null, 'it decided about a host it cannot ask');
    assert.match(said.repos[0].why, /gitlab\.com/, 'it did not say which host it actually is');
    assert.ok(!asked.some((a) => a.includes('someone/thing')),
        'it built a GitHub API path out of a GitLab remote, which gets a 404 that means nothing');
});

test('a repository with no origin says so, and asks nothing', async () => {
    const { actions, asked } = await anApp(REPO_OK);
    const said = await actions.call('repositoriesCheck', { repo: 'repo-three' });

    assert.equal(said.repos[0].reachable, false);
    assert.match(said.repos[0].why, /no remote called origin/);
    assert.equal(asked.length, 0, 'it asked GitHub about a repository with nowhere to ask about');
});

test('the four spellings of a remote all come out as owner and repo', async () => {
    const { git } = await anApp(REPO_OK);
    const forms = [
        'https://github.com/anowner/arepo.git',
        'https://github.com/anowner/arepo',
        'git@github.com:anowner/arepo.git',
        'ssh://git@github.com/anowner/arepo.git'
    ];
    for (const url of forms) {
        git_setRemote(url);
        const o = await git.origin('repo-one');
        assert.equal(o.owner, 'anowner', url + ' did not parse');
        assert.equal(o.repo, 'arepo', url + ' did not parse');
        assert.equal(o.kind, 'github', url + ' was not recognised as github');
    }
    git_setRemote('https://github.com/anowner/arepo.git');
});

function git_setRemote(url) {
    child.execFileSync('git', ['remote', 'set-url', 'origin', url], { cwd: repo, stdio: 'pipe' });
}

//A URL CAN CARRY A CREDENTIAL — `https://user:token@github.com/o/r` is an
//ordinary remote — so the URL itself is never handed back.
test('a credential in a remote URL does not come back out of git.origin', async () => {
    const { git } = await anApp(REPO_OK);
    git_setRemote('https://someone:ghp_notARealToken0123456789@github.com/anowner/arepo.git');

    const o = await git.origin('repo-one');
    assert.ok(!JSON.stringify(o).includes('ghp_notARealToken0123456789'),
        'the remote URL was handed back with a credential in it');
    assert.equal(o.owner, 'anowner', 'it stopped parsing when there was a credential in the way');
    assert.equal(o.repo, 'arepo');

    git_setRemote('https://github.com/anowner/arepo.git');
});

//---------------------------------------------------------------------------
//4. THE REFUSAL FROM keys ARRIVES HERE AS AN ANSWER, NOT A CRASH.
//---------------------------------------------------------------------------

test('no token held is reported per repository rather than thrown', async () => {
    let actions = null;
    await actionsPlugin({}, async (_e, s) => { actions = s.actions; });

    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-repos-data-'));
    let state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dataDir, ...p) } }, async (_e, s) => { state = s.state; });
    state.follow(async () => work);

    const logger = { good() {}, warn() {}, bad() {}, info() {} };
    const workspace = {
        dir: async () => work,
        folderOf: async (n) => path.join(work, n),
        repos: async () => [{ name: 'repo-one' }]
    };
    let git_ = null;
    await gitPlugin({ app: { host: {} }, log: { on: () => logger }, workspace }, async (_e, s) => { git_ = s.git; });

    //WHAT ../../keys ACTUALLY SAYS when there is nothing held.
    const github = {
        call: async () => { throw new Error('This host holds no GitHub token. Add one on the Keys tab; nothing here can reach GitHub until it has one.'); },
        //THE REAL POOL, as everywhere else in this file: the sweep asks its
        //repositories side by side, and a stand-in without it is not a GitHub.
        many: Many(8),
        check: async () => ({ ok: false }),
        apiHost: () => 'api.github.com'
    };

    const { refs } = await refsFor({ git: git_, workspace, log: { on: () => logger } });
    await reposPlugin({ app: { host: { actions } }, log: { on: () => logger }, git: git_, github, workspace, state, refs }, async () => {});

    const said = await actions.call('repositoriesCheck', {});
    assert.equal(said.repos[0].reachable, false);
    assert.match(said.repos[0].why, /Keys tab/, 'the reason did not survive as far as the person reading it');
    assert.match(said.note, /need attention/);
});

//---------------------------------------------------------------------------
//5. WHAT IS KEPT IS PER WORKSPACE, AND READING ASKS NOTHING.
//---------------------------------------------------------------------------







test('a name that is not in the workspace is refused, and the refusal says what is', async () => {
    const { actions } = await anApp(REPO_OK);
    await assert.rejects(() => actions.call('repositoriesCheck', { repo: 'nope' }), /no repository called "nope"/);
    await assert.rejects(() => actions.call('repositoriesCheck', { repo: 'nope' }), /repo-one/);
});

//---------------------------------------------------------------------------
//THE READ IS STILL RELAYED, AND THAT IS ASSERTED RATHER THAN ASSUMED.
//
//A thin `repositories` defined here would shadow the relayed one and the pane
//would lose two thirds of every row — as `undefined`, which renders as nothing
//rather than as an error. This is the check that stops somebody adding it back
//without the rest of the shape: if it IS defined here, its rows must carry what
//the pane reads off them.
//---------------------------------------------------------------------------


//WHAT IS KEPT IS PER WORKSPACE, which is what state.here is for.
test('what a check learns is kept, and kept per workspace', async () => {
    const { actions, go } = await anApp(REPO_OK);
    await actions.call('repositoriesCheck', { repo: 'repo-one' });

    //the same plugin, pointed somewhere else: nothing carries over
    go(null);
    await assert.rejects(() => actions.call('repositoriesCheck', {}),
        /no repositories|No workspace|nowhere/i,
        'with no workspace open it went and asked about repositories nobody had opened');
});

//---------------------------------------------------------------------------
//5. THE READ, WHICH IS WHAT THE PANE DRAWS.
//
//IT SHADOWS THE RELAYED ACTION NOW, so every field the pane reads off a row has
//to be here. A thinner one would blank two thirds of the pane with `undefined`,
//which renders as nothing rather than as an error — the worst available failure
//for a port, because it looks like it worked.
//---------------------------------------------------------------------------

const PANE_READS = [
    'repo', 'path', 'default', 'head', 'branches', 'remote',
    'checked', 'gathered', 'about', 'knownFor', 'stale',
    'reachable', 'why', 'may', 'accountMay',
    'parent', 'source', 'chained', 'intoParent', 'intoSource',
    'branchesThere', 'privateRepo', 'fork', 'upstreamDefault', 'upstreamHead',
    'openPulls', 'pulls', 'issues', 'openIssues', 'issuesOn', 'target', 'inStep'
];

test('every field the pane reads off a row is on the row', async () => {
    const { actions } = await anApp(REPO_OK);
    const said = await actions.call('repositories', {});
    const row = said.repos.find((r) => r.repo === 'repo-one');

    assert.ok(row, 'the workspace repository is not in the list at all');
    for (const field of PANE_READS) {
        assert.ok(field in row, 'the row has no `' + field + '`, and the pane reads it');
    }
});

test('the local half is there before anybody has asked GitHub anything', async () => {
    const { actions, asked } = await anApp(REPO_OK);
    const said = await actions.call('repositories', {});
    const row = said.repos.find((r) => r.repo === 'repo-one');

    assert.ok(row.path, 'no path');
    assert.equal(row.default, 'master', 'the local default branch is wrong');
    assert.match(row.head, /^[0-9a-f]{7,}$/, 'the local head is not a sha');
    assert.equal(row.branches, 1);
    assert.equal(row.remote.owner, 'anowner');

    //AND NOTHING WAS ASKED. This is drawn on a timer.
    assert.equal(asked.length, 0, 'reading the list spent a round trip');
    assert.equal(row.checked, null, 'it claimed to have asked when it had not');
});

test('reading the list asks GitHub nothing, even after a check', async () => {
    const { actions, asked } = await anApp(REPO_OK);
    await actions.call('repositoriesCheck', { repo: 'repo-one' });
    const before = asked.length;
    assert.ok(before > 0, 'the check asked nothing, so this proves nothing');

    await actions.call('repositories', {});
    await actions.call('repositories', {});
    assert.equal(asked.length, before, 'reading the list spent a round trip');
});

//---------------------------------------------------------------------------
//A NOTE FULL OF CONFIDENT FACTS ABOUT A REPOSITORY THIS ONE NO LONGER IS.
//
//The dangerous shape is not an empty panel, it is a FULL one describing
//somewhere else. `about` is recorded on the way out so `stale` can compare it
//against wherever origin points now.
//---------------------------------------------------------------------------
test('moving origin makes what was learnt read as stale, not as current', async () => {
    const { actions } = await anApp(REPO_OK);
    await actions.call('repositoriesCheck', { repo: 'repo-one' });

    let row = (await actions.call('repositories', {})).repos.find((r) => r.repo === 'repo-one');
    assert.equal(row.stale, false);
    assert.equal(row.knownFor, 'this remote');

    git_setRemote('https://github.com/somebody/else.git');
    row = (await actions.call('repositories', {})).repos.find((r) => r.repo === 'repo-one');
    assert.equal(row.stale, true, 'facts about the old remote are being shown as current');
    assert.equal(row.knownFor, 'anowner/arepo', 'it does not say what the facts are actually about');

    git_setRemote('https://github.com/anowner/arepo.git');
});

//---------------------------------------------------------------------------
//WHERE WORK GOES, WHICH IS A DECISION AND NOT A FACT.
//---------------------------------------------------------------------------

test('unset means your own remote, and it says which it is showing', async () => {
    const { actions } = await anApp(REPO_OK);
    const row = (await actions.call('repositories', {})).repos.find((r) => r.repo === 'repo-one');

    assert.equal(row.target.on, 'anowner/arepo');
    assert.equal(row.target.chosen, false, 'it claimed somebody picked this');
    assert.equal(row.target.upstream, false);
    assert.equal(row.issuesOn, 'anowner/arepo');
});

test('a chosen target is kept, said with who and why, and can be cleared', async () => {
    const { actions } = await anApp(REPO_OK);

    const set = await actions.call('repoTargetSet', { repo: 'repo-one', on: 'upstream/theirs', why: 'we send work up the chain' });
    assert.equal(set.target.on, 'upstream/theirs');
    assert.equal(set.target.chosen, true);
    assert.equal(set.target.upstream, true);
    assert.equal(set.target.by, 'the window');
    assert.match(set.target.why, /up the chain/);

    let row = (await actions.call('repositories', {})).repos.find((r) => r.repo === 'repo-one');
    assert.equal(row.issuesOn, 'upstream/theirs', 'issues are still read from the fork');

    //A CHECK MUST NOT RESET IT. It is a person's choice, not something GitHub
    //answered, and rewriting the note wholesale would quietly undo it.
    await actions.call('repositoriesCheck', { repo: 'repo-one' });
    row = (await actions.call('repositories', {})).repos.find((r) => r.repo === 'repo-one');
    assert.equal(row.target.on, 'upstream/theirs', 'a check threw away where work goes');

    const cleared = await actions.call('repoTargetSet', { repo: 'repo-one', on: '' });
    assert.equal(cleared.target.chosen, false);
    assert.equal(cleared.target.on, 'anowner/arepo', 'clearing left it pointed at nowhere');
});

test('a target that is not owner and repository is refused', async () => {
    const { actions } = await anApp(REPO_OK);
    await assert.rejects(() => actions.call('repoTargetSet', { repo: 'repo-one', on: 'nonsense' }), /owner/);
    await assert.rejects(() => actions.call('repoTargetSet', { on: 'a/b' }), /Which repository/);
});

//---------------------------------------------------------------------------
//6. AM I DONE WITH THIS BRANCH — measured by CONTENT, not by sha.
//
//The single most confusing thing about working through pull requests. GitHub
//squashes a merge: the branch's commits become one new commit with a new sha on
//the target, and the originals still sit on the branch. Every `rev-list --count`
//then truthfully reports unmerged work about work that landed a week ago — so a
//board says "1 commit no default branch has" and deleting the branch demands
//`force` as though something were about to be lost.
//---------------------------------------------------------------------------

test('a branch whose work was squashed onto the default reads as landed, not live', async () => {
    const { actions } = await anApp(REPO_OK);

    //a branch with real work on it
    git(['checkout', '-q', '-b', 'feature']);
    fs.writeFileSync(path.join(repo, 'feature.txt'), 'work\n');
    git(['add', '.']);
    git(['commit', '-q', '-m', 'the work']);

    //SQUASHED ONTO master, exactly as GitHub would: same change, new sha, and
    //the branch is left untouched.
    git(['checkout', '-q', 'master']);
    git(['merge', '-q', '--squash', 'feature']);
    git(['commit', '-q', '-m', 'the work, squashed']);

    const said = await actions.call('repoBranches', { repo: 'repo-one' });
    const row = said.branches.find((b) => b.branch === 'feature');

    assert.equal(row.against.base, 'master');
    assert.equal(row.against.unlanded, 0, 'it counted by sha, so squashed work reads as unmerged');
    assert.equal(row.against.state, 'landed',
        'the branch reads as live, and deleting it would demand force over work that is already in');

    git(['checkout', '-q', 'master']);
    git(['branch', '-D', 'feature']);
    git(['reset', '-q', '--hard', 'HEAD~1']);
});

test('a branch with work that is genuinely not in the default reads as live', async () => {
    const { actions } = await anApp(REPO_OK);

    git(['checkout', '-q', '-b', 'unmerged']);
    fs.writeFileSync(path.join(repo, 'new.txt'), 'not in master\n');
    git(['add', '.']);
    git(['commit', '-q', '-m', 'genuinely new']);
    git(['checkout', '-q', 'master']);

    const row = (await actions.call('repoBranches', { repo: 'repo-one' }))
        .branches.find((b) => b.branch === 'unmerged');

    assert.equal(row.against.unlanded, 1);
    assert.equal(row.against.state, 'live');

    git(['branch', '-D', 'unmerged']);
});

//OUT OF STEP MEANS BOTH SIDES HAVE IT AND THEY DISAGREE. Counting every branch
//that is not identical to origin made this read "3 out of step" where one branch
//differed and two had never been pushed — which is work that has not gone
//anywhere, not a problem to be fixed.
test('a branch that exists only here is counted separately, not as out of step', async () => {
    const { actions } = await anApp(REPO_OK);

    git(['checkout', '-q', '-b', 'never-pushed']);
    git(['checkout', '-q', 'master']);

    const said = await actions.call('repoBranches', { repo: 'repo-one' });
    assert.ok(said.onlyHere >= 1, 'a branch that has never been pushed was not counted as only-here');
    assert.equal(said.outOfStep, 0, 'a branch that has never been pushed was reported as out of step');
    assert.match(said.note, /exist only here/);
    assert.match(said.note, /as of the last fetch/, 'the note does not say how old the remote column is');

    git(['branch', '-D', 'never-pushed']);
});

test('the default branch itself has nothing to say about itself', async () => {
    const { actions } = await anApp(REPO_OK);
    const row = (await actions.call('repoBranches', { repo: 'repo-one' }))
        .branches.find((b) => b.branch === 'master');
    assert.equal(row.against, null, 'it compared the default branch against itself');
});

//---------------------------------------------------------------------------
//7. THE FORK CHAIN.
//---------------------------------------------------------------------------

const CHAIN = {
    '/repos/anowner/arepo': {
        status: 200,
        body: { fork: true, default_branch: 'main', parent: { full_name: 'middle/arepo' }, permissions: { push: true } }
    },
    '/repos/middle/arepo': {
        status: 200,
        body: { fork: true, default_branch: 'main', parent: { full_name: 'root/arepo' }, permissions: { push: true } }
    },
    //THE ROOT CLAIMS PUSH AND REFUSES IT, which is the whole trap. A fixture
    //where `permissions` and the probe agree cannot tell the two apart, so a
    //plugin that read the wrong one would pass — which is what happened the
    //first time this was written.
    '/repos/root/arepo': { status: 200, body: { fork: false, default_branch: 'main', permissions: { push: true } } }
};

test('a fork of a fork is walked to the root, one link at a time', async () => {
    const { actions } = await anApp(Object.assign({}, CHAIN, {
        '/repos/anowner/arepo/pulls': { status: 200, body: [] },
        '/repos/middle/arepo/pulls': { status: 200, body: [] },
        //THE ROOT REFUSES, which is the ordinary case in a chain.
        '/repos/root/arepo/pulls': { status: 403, body: { message: 'Resource not accessible by personal access token' } }
    }));

    const said = await actions.call('repoChain', { repo: 'repo-one' });
    assert.deepEqual(said.links.map((l) => l.on), ['anowner/arepo', 'middle/arepo', 'root/arepo']);
    assert.equal(said.deep, 3);
    assert.equal(said.stopped, null);

    //ONLY THE IMMEDIATE PARENT SYNCS WITH ONE CALL.
    assert.deepEqual(said.links.map((l) => l.immediate), [false, true, false]);
    assert.equal(said.links[0].self, true, 'it did not mark which link is this repository');
});

//PROBED, NOT READ OFF `permissions` — the same trap the check is written for.
test('whether a pull request may be opened in a link is asked, not assumed', async () => {
    const { actions } = await anApp(Object.assign({}, CHAIN, {
        '/repos/anowner/arepo/pulls': { status: 200, body: [] },
        '/repos/middle/arepo/pulls': { status: 200, body: [] },
        '/repos/root/arepo/pulls': { status: 403, body: { message: 'Resource not accessible by personal access token' } }
    }));

    const said = await actions.call('repoChain', { repo: 'repo-one' });
    const root = said.links.find((l) => l.on === 'root/arepo');
    const mid = said.links.find((l) => l.on === 'middle/arepo');

    assert.equal(mid.mayOpen, true);
    assert.equal(root.mayOpen, false, 'a link that refuses was reported as usable');

    //AND THE ACCOUNT'S CLAIM IS KEPT SEPARATELY, so the two can be SEEN to
    //differ rather than one silently standing in for the other. The root claims
    //push and refuses it — read `permissions` here and somebody picks a target
    //that fails at the last possible moment.
    assert.equal(root.accountMayPush, true, 'the fixture no longer sets up the disagreement');
    assert.notEqual(root.mayOpen, root.accountMayPush,
        'the probed answer equals the account claim, so this test cannot tell which one was read');
});

//A CYCLE UP THERE WOULD BE SOMEBODY ELSE'S MISTAKE BECOMING AN INFINITE LOOP IN
//HERE.
test('a chain that loops stops and says so', async () => {
    const { actions } = await anApp({
        '/repos/anowner/arepo': { status: 200, body: { fork: true, parent: { full_name: 'middle/arepo' } } },
        '/repos/middle/arepo': { status: 200, body: { fork: true, parent: { full_name: 'anowner/arepo' } } }
    });

    const said = await actions.call('repoChain', { repo: 'repo-one' });
    assert.match(said.stopped, /appears twice/);
    assert.ok(said.links.length <= 3, 'it went round more than once before stopping');
});

test('a link that cannot be read stops the walk and says what is unknown', async () => {
    const { actions } = await anApp({
        '/repos/anowner/arepo': { status: 200, body: { fork: true, parent: { full_name: 'private/arepo' } } },
        '/repos/anowner/arepo/pulls': { status: 200, body: [] },
        '/repos/private/arepo': { status: 404, body: { message: 'Not Found' } }
    });

    const said = await actions.call('repoChain', { repo: 'repo-one' });
    assert.equal(said.deep, 1);
    assert.match(said.stopped, /could not be read \(404\)/);
    assert.match(said.stopped, /anything above it is unknown/);
});

test('a repository with no GitHub remote has no chain, and says so', async () => {
    const { actions } = await anApp(REPO_OK);
    await assert.rejects(() => actions.call('repoChain', { repo: 'repo-two' }), /no GitHub remote/);
    await assert.rejects(() => actions.call('repoChain', {}), /Say which repository/);
});

//GITHUB RETURNS PULL REQUESTS FROM THE ISSUES ENDPOINT, so a list drawn from it
//without filtering shows every pull request twice — once as itself, once as an
//issue.
test('a pull request is not counted as an issue', async () => {
    const { actions } = await anApp(Object.assign({}, REPO_OK, {
        '/repos/anowner/arepo/issues': {
            status: 200,
            body: [
                { number: 7, title: 'a real issue', user: { login: 'someone' } },
                { number: 8, title: 'actually a pull request', pull_request: { url: 'x' }, user: { login: 'someone' } }
            ]
        }
    }));

    await actions.call('repositoriesCheck', { repo: 'repo-one' });
    const row = (await actions.call('repositories', {})).repos.find((r) => r.repo === 'repo-one');

    assert.equal(row.openIssues, 1, 'a pull request was counted as an issue');
    assert.equal(row.issues[0].number, 7);
});

//---------------------------------------------------------------------------
//A TRACKER LONGER THAN ONE PAGE.
//
//THE DEFECT THIS COVERS WAS SILENT AND IT WAS ABOUT COMPLETENESS, not cost.
//Every read was `per_page=100` and nothing anywhere in the app followed the
//`link` header, so a repository with five hundred open issues answered with a
//hundred and this reported a hundred — no error, no warning, and no way to tell
//from inside one request that a full page is not a last page.
//
//WHICH MATTERS BECAUSE OF WHAT PEOPLE DO WITH THE LIST. Somebody points at an
//issue, it is not on the list, and the answer they get is that it does not
//exist.
//---------------------------------------------------------------------------

test('all the issues arrive, not the first page of them', async () => {
    //A HUNDRED AND FIFTY, WHICH IS TWO PAGES. The stand-in hands back a `link`
    //header exactly as GitHub does, and the second page only exists if
    //something followed it.
    const page1 = Array.from({ length: 100 }, (_, i) => ({ number: i + 1, title: 'issue ' + (i + 1), user: { login: 'someone' } }));
    const page2 = Array.from({ length: 50 }, (_, i) => ({ number: i + 101, title: 'issue ' + (i + 101), user: { login: 'someone' } }));

    const { actions } = await anApp(Object.assign({}, REPO_OK, {
        '/repos/anowner/arepo/issues': (at) => (/page=2/.test(at)
            ? { status: 200, body: page2, headers: {} }
            : {
                status: 200, body: page1,
                headers: { link: '<https://api.github.com/repos/anowner/arepo/issues?per_page=100&page=2>; rel="next"' }
            })
    }));

    await actions.call('repositoriesCheck', { repo: 'repo-one' });
    const row = (await actions.call('repositories', {})).repos.find((r) => r.repo === 'repo-one');

    assert.equal(row.issues.length, 150, 'the tail of the tracker was dropped');
    //THE LAST ONE BY NUMBER, not just the count: a length alone would pass if
    //the first page had been counted twice.
    assert.ok(row.issues.some((i) => i.number === 150), 'the second page was never read');

    //AND THE PLACE DOES NOT CLAIM TO BE SHORT OF ANYTHING. `more` is what says
    //a list is incomplete, and saying it when it is not would make the warning
    //worthless the first time somebody saw it.
    const said = row.issuesFrom.find((x) => x.on === 'anowner/arepo');
    assert.equal(said.count, 150);
    assert.equal(said.more, false);
});

test('and when there are more than it will read, it says so rather than truncating quietly', async () => {
    //A `link` HEADER THAT NEVER ENDS, which is what a very large tracker looks
    //like from here. The cap stops it; the point of the assertion is that the
    //stopping is REPORTED.
    const page = Array.from({ length: 100 }, (_, i) => ({ number: i + 1, title: 'x', user: { login: 'someone' } }));

    const { actions } = await anApp(Object.assign({}, REPO_OK, {
        '/repos/anowner/arepo/issues': () => ({
            status: 200, body: page,
            headers: { link: '<https://api.github.com/repos/anowner/arepo/issues?per_page=100&page=99>; rel="next"' }
        })
    }));

    await actions.call('repositoriesCheck', { repo: 'repo-one' });
    const row = (await actions.call('repositories', {})).repos.find((r) => r.repo === 'repo-one');

    const said = row.issuesFrom.find((x) => x.on === 'anowner/arepo');
    assert.equal(said.more, true, 'a truncated list reported itself as complete');
    assert.match(said.why, /not all of them/);
});

//---------------------------------------------------------------------------
//AND WHEN THE HOUR IS NEARLY SPENT.
//
//THE BUDGET IS PER TOKEN AND SHARED BY EVERYTHING. A sweep runs unattended and
//a person pressing a button does not, so the sweep is the one that has to leave
//room -- otherwise the first interactive action after a big sweep is the one
//that gets refused, and that reads as the app being broken rather than as the
//crawler having eaten the hour.
//---------------------------------------------------------------------------

test('a sweep stops with room left rather than spending the last of the hour', async () => {
    const { actions, asked } = await anApp(Object.assign({}, REPO_OK, {
        '/repos/anowner/arepo/issues': {
            status: 200,
            body: [{ number: 7, title: 'a real issue', user: { login: 'someone' }, comments: 3 }]
        }
    }), undefined, { left: 12, limit: 5000, keepBack: 500, resets: '2026-08-28T09:00:00.000Z' });

    await actions.call('repositoriesCheck', { repo: 'repo-one' });
    const row = (await actions.call('repositories', {})).repos.find((r) => r.repo === 'repo-one');

    //NOT ASKED, and the row says which place and why. A count of zero would be
    //a lie of exactly the kind the paging fix was about.
    const said = row.issuesFrom.find((x) => x.on === 'anowner/arepo');
    assert.equal(said.asked, false, 'the place was read with the hour nearly gone');
    assert.equal(said.count, null, 'not reading something was reported as finding nothing');
    assert.match(said.why, /12 GitHub requests/);
    assert.match(said.why, /so pressing something still works/);

    //AND NOTHING WAS ACTUALLY ASKED OF GITHUB FOR IT. The sentence is worth
    //nothing if the requests went out anyway.
    assert.ok(!asked.some((a) => /\/issues/.test(a)), 'it said it was stopping and asked anyway');
});

test('and reading the issues but not the replies is a usable answer that says so', async () => {
    //THE FLOOR IS CHECKED TWICE ON PURPOSE. The list is one request per place;
    //the threads are one per issue, and on a busy tracker that is where an hour
    //actually goes. Stopping between them leaves every issue with its own words
    //and only the replies missing.
    const money = { left: 501, limit: 5000, keepBack: 500 };

    const { actions, asked } = await anApp(Object.assign({}, REPO_OK, {
        //READING THE LIST IS WHAT SPENDS THE ROOM TO READ THE REPLIES, which is
        //how this happens in life: there was margin to start and not to finish.
        '/repos/anowner/arepo/issues': () => {
            money.left = 3;
            return { status: 200, body: [{ number: 7, title: 'a real issue', user: { login: 'someone' }, comments: 3 }] };
        }
    }), undefined, money);

    await actions.call('repositoriesCheck', { repo: 'repo-one' });
    const row = (await actions.call('repositories', {})).repos.find((r) => r.repo === 'repo-one');

    //THE ISSUES SURVIVED and the replies did not, which is the whole claim.
    assert.equal(row.issues.length, 1, 'the issues were thrown away along with the replies');
    assert.equal(row.issues[0].title, 'a real issue');
    assert.equal(row.issues[0].said, null, 'the replies were read with the hour nearly gone');
    assert.match(row.issues[0].saidWhy, /not read this time/);

    //AND THE EXPENSIVE HALF NEVER WENT OUT. The sentence is worth nothing if
    //the requests were made anyway.
    assert.ok(!asked.some((a) => /\/comments/.test(a)), 'it said it was stopping and asked for the replies anyway');
});

//---------------------------------------------------------------------------
//ISSUES CAN BE SWITCHED OFF PER REPOSITORY, AND SEVERAL OF THESE FORKS ARE.
//
//GitHub answers 410 Gone for the issues of a repository whose owner turned them
//off. Read as a failure that is a permissions message pointing at a token, and
//the setting it is really about is a checkbox on somebody else's repository —
//so somebody goes looking for a scope that was never the problem.
//
//AND IT COSTS A REQUEST EVERY CHECK, forever, to be told the same thing. The
//repository itself says `has_issues`, and GitHub embeds the whole parent and
//source objects in it, so this is known before anything is asked.
//---------------------------------------------------------------------------

test('a repository with issues switched off is not asked, and the row says why', async () => {
    const { actions, asked } = await anApp(Object.assign({}, REPO_OK, {
        '/repos/anowner/arepo': { status: 200, body: { default_branch: 'main', fork: false, has_issues: false } }
    }));

    await actions.call('repositoriesCheck', { repo: 'repo-one' });
    const row = (await actions.call('repositories', {})).repos.find((r) => r.repo === 'repo-one');

    assert.deepEqual(row.noIssuesAt, ['anowner/arepo'], 'the switched-off repository was not noticed');

    //NOT ASKED, WHICH IS THE POINT OF NOTICING. A cheap answer that still spends
    //the request is the same cost with better wording.
    assert.ok(!asked.some((a) => a.indexOf('/repos/anowner/arepo/issues') >= 0),
        'it asked for issues from a repository that has none: ' + asked.join(', '));

    const said = (row.issuesFrom || [])[0];
    assert.equal(said.on, 'anowner/arepo');
    assert.equal(said.off, true);
    assert.equal(said.asked, false, '`asked` is what separates "no issues tab" from "asked, and none"');
    assert.match(said.why, /switched off/);
});

//A COUNT CANNOT SAY WHY IT IS ZERO, and three different things arrive as zero.
test('what each place in a read set answered is carried beside the list', async () => {
    const { actions } = await anApp(Object.assign({}, REPO_OK, {
        '/repos/anowner/arepo': {
            status: 200,
            body: { default_branch: 'main', fork: true, has_issues: true, parent: { full_name: 'up/arepo', has_issues: true } }
        },
        '/repos/anowner/arepo/issues': { status: 200, body: [{ number: 3, title: 'mine', user: { login: 'me' } }] },
        '/repos/up/arepo': { status: 200, body: { default_branch: 'main', has_issues: true } },
        '/repos/up/arepo/pulls': { status: 200, body: [] },
        '/repos/up/arepo/issues': { status: 403, body: { message: 'Forbidden' } }
    }));

    //WALKED FIRST, because a read set may only name links the app has actually
    //seen — see the refusal in `repoReadsSet`.
    await actions.call('repoChain', { repo: 'repo-one' });
    await actions.call('repoReadsSet', { repo: 'repo-one', issues: ['anowner/arepo', 'up/arepo'] });
    await actions.call('repositoriesCheck', { repo: 'repo-one' });
    const row = (await actions.call('repositories', {})).repos.find((r) => r.repo === 'repo-one');

    const from = row.issuesFrom || [];
    assert.equal(from.length, 2, 'a place in the set contributed no answer at all');

    const ours = from.find((x) => x.on === 'anowner/arepo');
    assert.equal(ours.count, 1);
    assert.equal(ours.why, null);

    //THE ONE THAT WOULD OTHERWISE VANISH. It contributed no issues and no row to
    //say so in, so without this the list is short and confident.
    const theirs = from.find((x) => x.on === 'up/arepo');
    assert.equal(theirs.count, null, 'a place that could not be read was recorded as having none');
    assert.match(theirs.why, /Forbidden/);

    //AND EVERY ISSUE KNOWS WHICH REPOSITORY IT IS ON. Two places read at once
    //both have a #1, so a number on its own names two different things.
    assert.equal(row.issues.length, 1);
    assert.equal(row.issues[0].on, 'anowner/arepo');
});

//PULL REQUESTS ARE READ FROM A SET TOO, and for a fork that matters more than
//for issues: a change SOMEBODY ELSE opened arrives in the repository they opened
//it on, which is never this fork.
test('pull requests are read from every place in the set, each row saying where', async () => {
    const { actions } = await anApp(Object.assign({}, REPO_OK, {
        '/repos/anowner/arepo': {
            status: 200,
            body: { default_branch: 'main', fork: true, has_issues: true, parent: { full_name: 'up/arepo' } }
        },
        '/repos/anowner/arepo/pulls': { status: 200, body: [] },
        '/repos/up/arepo': { status: 200, body: { default_branch: 'main', has_issues: true } },
        '/repos/up/arepo/pulls': {
            status: 200,
            body: [{
                number: 8, title: 'from somebody else', state: 'open',
                head: { ref: 'fix', repo: { full_name: 'anowner/arepo' }, sha: 'abc' },
                base: { ref: 'main' }, user: { login: 'someone' }, author_association: 'MEMBER'
            }]
        }
    }));

    await actions.call('repoChain', { repo: 'repo-one' });
    await actions.call('repoReadsSet', { repo: 'repo-one', pulls: ['anowner/arepo', 'up/arepo'] });
    await actions.call('repositoriesCheck', { repo: 'repo-one' });
    const row = (await actions.call('repositories', {})).repos.find((r) => r.repo === 'repo-one');

    assert.equal(row.openPulls, 1, 'the pull request upstream was never read');
    assert.equal(row.pulls[0].on, 'up/arepo', 'the row does not say which repository it is open on');
    assert.equal(row.pulls[0].headRepo, 'anowner/arepo', 'whose fork the branch is on was dropped');
    assert.equal(row.pulls[0].base, 'main');
});

//A DISABLED CHECKBOX IS NOT A RULE. The command line never sees one.
test('choosing to read issues from a repository that has none is refused', async () => {
    const { actions } = await anApp(Object.assign({}, REPO_OK, {
        '/repos/anowner/arepo': {
            status: 200,
            body: { default_branch: 'main', fork: true, has_issues: true, parent: { full_name: 'up/arepo', has_issues: false } }
        },
        '/repos/up/arepo': { status: 200, body: { default_branch: 'main', has_issues: false } },
        '/repos/up/arepo/pulls': { status: 200, body: [] }
    }));

    await actions.call('repoChain', { repo: 'repo-one' });
    await actions.call('repositoriesCheck', { repo: 'repo-one' });
    await assert.rejects(
        () => actions.call('repoReadsSet', { repo: 'repo-one', issues: ['anowner/arepo', 'up/arepo'] }),
        /switched off/);

    //AND PULL REQUESTS FROM THERE ARE STILL FINE. They are a different tab on
    //GitHub and a different setting; refusing both would be one rule doing two
    //jobs and getting one of them wrong.
    await actions.call('repoReadsSet', { repo: 'repo-one', pulls: ['anowner/arepo', 'up/arepo'] });
    const row = (await actions.call('repositories', {})).repos.find((r) => r.repo === 'repo-one');
    assert.deepEqual(row.reads.pulls, ['anowner/arepo', 'up/arepo']);
});

//---------------------------------------------------------------------------
//WHERE WORK GOES IS THE ONLY SETTING IN THIS APP WITH SOMEBODY ELSE'S NAME ON IT.
//
//Everything else decides what happens on this host. This decides whose
//repository a pull request is opened against — and losing it does not fail, it
//quietly sends the next change somewhere else, because unset means "your own
//remote", which looks exactly like working.
//
//THE NOTE HOLDS TWO KINDS OF THING: what GitHub answered, and what a person
//CHOSE. `repositoriesCheck` files an answer with `notes[repo] = row`, a
//whole-object replacement, so every field the answer does not mention is gone.
//The success path carries the choice through by hand; `unasked` — which is what
//every failure branch returns — does not mention it at all.
//
//So a 403, an expired token, a laptop shut mid-sweep, or a remote that is not
//GitHub took "send work to the fork you are working with" and made it "send it
//to yourself".
//
//AND THE INVITATION MAKES IT WORSE: the inbox offers "ask GitHub about this one",
//and doing exactly what it asks is what loses the choice.
//
//ASKED AS A PROBE RATHER THAN BY READING. Every individual line looks reasonable;
//the fault is in which fields each branch does not mention, which is the part a
//reader cannot hold in their head and the part that breaks when a sixth branch
//is added. So each branch is driven, and the question is the same for all of
//them.
//---------------------------------------------------------------------------

test('a choice about where work goes survives asking GitHub, on every branch', async () => {
    //MUTABLE ON PURPOSE. The stand-in reads this object when it is called, so a
    //test can change what GitHub says between one call and the next — which is
    //the only way to reach a failure branch on demand. Waiting for a real 403
    //means a check that passes for months and cannot be trusted the one time it
    //matters.
    const answers = Object.assign({}, REPO_OK);
    const { actions } = await anApp(answers);

    await actions.call('repoTargetSet', {
        repo: 'repo-one', on: 'someone/their-fork', why: 'the fork this work is for'
    });

    const chose = (await actions.call('repositories')).repos.find((r) => r.repo === 'repo-one');
    assert.equal(chose.target.on, 'someone/their-fork', 'the choice did not take, so losing it proves nothing');
    assert.equal(chose.target.chosen, true);

    //EVERY WAY ASKING CAN GO WRONG, one at a time, against the same choice.
    const goesWrong = [
        ['a rate limit', { status: 403, body: { message: 'API rate limit exceeded' } }],
        ['an expired token', { status: 401, body: { message: 'Bad credentials' } }],
        ['a repository the token was not granted', { status: 404, body: { message: 'Not Found' } }],
        ['GitHub having a bad day', { status: 500, body: { message: 'Server Error' } }]
    ];

    for (const [what, answer] of goesWrong) {
        answers['/repos/anowner/arepo'] = answer;
        await actions.call('repositoriesCheck', { repo: 'repo-one' });

        const now = (await actions.call('repositories')).repos.find((r) => r.repo === 'repo-one');
        assert.equal(now.target.on, 'someone/their-fork',
            `${what} took where work goes with it — it now says ${now.target.on}, and unset means "your own remote", which looks exactly like working`);
        assert.equal(now.target.chosen, true,
            `${what} left the target reading as a default rather than as a choice somebody made`);
    }

    //AND THE SUCCESS PATH TOO, which is the one the inbox invites people to run.
    answers['/repos/anowner/arepo'] = REPO_OK['/repos/anowner/arepo'];
    await actions.call('repositoriesCheck', { repo: 'repo-one' });

    const after = (await actions.call('repositories')).repos.find((r) => r.repo === 'repo-one');
    assert.equal(after.target.on, 'someone/their-fork', 'asking GitHub successfully lost where work goes');
    assert.equal(after.target.chosen, true);
});

test('and asking about a repository GitHub cannot be asked about does not either', async () => {
    //THE TWO BRANCHES THAT NEVER REACH GITHUB AT ALL: a remote that is not
    //GitHub, and no remote. Both return through the same `unasked`, so both file
    //an answer over the note.
    const { actions } = await anApp(REPO_OK);

    await actions.call('repoTargetSet', { repo: 'repo-two', on: 'someone/their-fork' });
    await actions.call('repositoriesCheck', { repo: 'repo-two' });

    const now = (await actions.call('repositories')).repos.find((r) => r.repo === 'repo-two');
    assert.equal(now.target.on, 'someone/their-fork',
        'a repository whose remote is not GitHub lost where work goes by being asked about');
});


//---------------------------------------------------------------------------
//A FORK WITH NOWHERE TO SEND WORK.
//
//THE ERRAND THAT WOULD HAVE SAVED AN AFTERNOON. Every repository in the real
//workspace is a fork, every one has a chain above it, and not one had ever had
//a target picked — so `target.on` was the repository ITSELF, and nothing said
//so anywhere.
//
//WHAT THAT COSTS IS NOT ABSTRACT. Pull requests are opened on the target, so a
//change sent out opened three of them against OUR OWN FORK rather than the
//parent, and "forks of a fork — into what?" had to be answered by hand
//afterwards.
//---------------------------------------------------------------------------

const A_FORK = {
    'GET /repos/anowner/arepo/branches': { status: 200, body: [{ name: 'main', commit: { sha: 'aaa' } }] },
    'GET /repos/anowner/arepo/pulls': { status: 200, body: [] },
    '/repos/anowner/arepo': {
        status: 200,
        body: { default_branch: 'main', fork: true, permissions: { push: true, admin: true, pull: true } }
    }
};

const forkErrand = (app) => app.sources.find((s) => /nowhere to send work/.test(s.name));

test('a fork nobody has picked a target for is waiting on somebody', async () => {
    const app = await anApp(A_FORK);
    const source = forkErrand(app);
    assert.ok(source, 'this plugin raises no fork errand at all, so nothing ever says where work goes');

    //NOTHING IS KNOWN UNTIL GITHUB HAS BEEN ASKED. `fork` is null before that,
    //and null is not false — raising an errand off an unknown would nag about
    //repositories nobody has established anything about.
    assert.deepEqual(await source.waiting(), [],
        'it raised an errand about a repository nothing has been asked about yet');

    await app.actions.call('repositoriesCheck', { repo: 'repo-one' });

    const waiting = await source.waiting();
    assert.equal(waiting.length, 1, 'a fork with no target picked raised ' + waiting.length + ' errand(s)');
    assert.equal(waiting[0].kind, 'where work goes');
    assert.equal(waiting[0].which, 'repo-one');
    assert.match(waiting[0].why, /stay on anowner\/arepo/);
    assert.match(waiting[0].why, /Walk the fork chain/);

    //IT LANDS ON THE REPOSITORY, with it already picked — an errand that drops
    //somebody on a list to find the thing themselves is one they put off.
    assert.deepEqual(waiting[0].where, { tab: 'Repositories', pane: 'Repos', pick: 'repo-one' });
});

test('and picking one takes it off the list', async () => {
    const app = await anApp(A_FORK);
    await app.actions.call('repositoriesCheck', { repo: 'repo-one' });
    assert.equal((await forkErrand(app).waiting()).length, 1, 'nothing was waiting to begin with');

    await app.actions.call('repoTargetSet', { repo: 'repo-one', on: 'upstream/theirs', why: 'work goes up the chain' });
    assert.deepEqual(await forkErrand(app).waiting(), [],
        'the target was picked and it is still being nagged about');
});

test('and a repository that is nobody\'s fork is never on it', async () => {
    //A REPOSITORY THAT IS NOBODY'S FORK IS THE PROJECT, and keeping to itself is
    //the whole of the right answer. Nagging about that is nagging about nothing,
    //which is how a list stops being read.
    const app = await anApp(REPO_OK);
    await app.actions.call('repositoriesCheck', { repo: 'repo-one' });
    assert.deepEqual(await forkErrand(app).waiting(), [],
        'it asked somebody to pick where work goes for a repository that is not a fork');
});

test('and settling on your own remote answers the errand without pointing anywhere', async () => {
    //NOTHING PICKED AND KEEPING TO ITSELF ARE THE SAME PLACE AND NOT THE SAME
    //ANSWER. Unpicked means nobody decided; chosen-on-your-own means somebody
    //walked the chain and said the work belongs here.
    //
    //WITHOUT THIS THE ERRAND CANNOT BE ANSWERED. A fork that IS where its work
    //lives would be asked to point somewhere for ever — and an errand that
    //cannot be settled teaches people to ignore the list, which is the failure a
    //list of what is waiting exists to avoid. The app being ported from has the
    //same hole: it raises the errand and hides the button on the row that is
    //already the target, which the self row is whenever nothing is picked.
    const app = await anApp(A_FORK);
    await app.actions.call('repositoriesCheck', { repo: 'repo-one' });
    assert.equal((await forkErrand(app).waiting()).length, 1, 'nothing was waiting to begin with');

    const set = await app.actions.call('repoTargetSet', {
        repo: 'repo-one', on: 'anowner/arepo', why: 'this fork is where the work lives'
    });

    assert.equal(set.target.chosen, true, 'settling on your own remote did not record a decision');
    //AND IT POINTS NOWHERE NEW. `upstream` is what turns on watching a parent,
    //and this act must not: it says "here is right", not "follow somebody".
    assert.equal(set.target.upstream, false, 'it started watching an upstream that was never picked');

    assert.deepEqual(await forkErrand(app).waiting(), [],
        'the decision was recorded and it is still asking to be pointed somewhere');
});

//---------------------------------------------------------------------------
//WHAT ARRIVED, AND WHO IS WOKEN FOR IT.
//
//The sweep diffs its own two lists and keeps a bookmark; a tag is the one
//arrival worth waking for. Read from GitHub's lists both times -- nothing here
//is a fact of this app's own.
//---------------------------------------------------------------------------

const ISSUE_ROW = (n, over) => Object.assign({ number: n, title: 'issue ' + n, user: { login: 'someone', type: 'User' }, comments: 0 }, over || {});
const WAKING = { settings: { read: async () => ({ githubMarker: 'okc', githubTrusted: ['bmatusiak'], supervisorWakes: true }) } };

test('a tag that appears between two sweeps is an arrival, and wakes the supervisor once', async () => {
    const answers = Object.assign({}, REPO_OK, { '/repos/anowner/arepo/issues': { status: 200, body: [ISSUE_ROW(7)] } });
    const woke = [];
    const { actions, state } = await anApp(answers, undefined, undefined, WAKING);
    actions.define('supervisorWake', { about: 'a stand-in', run: async (a) => { woke.push(a.why); return { woke: true }; } });

    //FIRST SWEEP: nothing arrives, however much is open. Then the same again:
    //still nothing, because nothing changed.
    await actions.call('repositoriesCheck', { repo: 'repo-one' });
    await actions.call('repositoriesCheck', { repo: 'repo-one' });
    let box = (await state.here.doc('github-arrived')).read({});
    assert.deepEqual(box.issues, [], 'the first sweep reported every open issue as arriving');
    assert.deepEqual(woke, []);

    //THEN SOMEBODY TRUSTED TAGS IT.
    answers['/repos/anowner/arepo/issues'] = {
        status: 200, body: [ISSUE_ROW(7, { body: 'okc: please look', user: { login: 'bmatusiak', type: 'User' } })]
    };
    await actions.call('repositoriesCheck', { repo: 'repo-one' });
    box = (await state.here.doc('github-arrived')).read({});
    assert.deepEqual(box.issues.map((i) => [i.number, i.kind]), [[7, 'asked']]);
    assert.equal(woke.length, 1, 'the supervisor was not woken for a tag, or was woken more than once');
    assert.match(woke[0], /anowner\/arepo#7 was tagged by bmatusiak/);

    //AND NOT AGAIN NEXT SWEEP: a tag that was already there is not news.
    await actions.call('repositoriesCheck', { repo: 'repo-one' });
    assert.equal(woke.length, 1, 'an old tag woke the supervisor again');
    assert.equal((await state.here.doc('github-arrived')).read({}).issues.length, 1);
});

test('a marked comment under a pull request is an ask, and wakes the supervisor', async () => {
    //THE CONVERSATION MOVED TO THE CODE. The person sent the reply, the
    //supervisor cut the pull request, and the maintainer answered UNDER THE
    //PULL REQUEST with the marker -- and only the reviews were being read.
    const OPEN = { number: 5, title: 'a change', state: 'open', user: { login: 'beta-super1', type: 'User' }, head: { sha: 'abc' }, body: 'the change' };
    const answers = Object.assign({}, REPO_OK, {
        '/repos/anowner/arepo/pulls': { status: 200, body: [OPEN] },
        '/repos/anowner/arepo/pulls/5/reviews': { status: 200, body: [] },
        '/repos/anowner/arepo/issues/5/comments': { status: 200, body: [] }
    });
    const woke = [];
    const { actions, state, asked } = await anApp(answers, undefined, undefined, WAKING);
    actions.define('supervisorWake', { about: 'a stand-in', run: async (a) => { woke.push(a.why); return { woke: true }; } });

    await actions.call('repositoriesCheck', { repo: 'repo-one' });
    await actions.call('repositoriesCheck', { repo: 'repo-one' });
    assert.ok(asked.some((a) => /\/issues\/5\/comments/.test(a)), 'the conversation under the pull request was never read: ' + asked.join(' | '));
    assert.deepEqual(woke, []);
    const row = (await actions.call('repositories', {})).repos.find((r) => r.repo === 'repo-one');
    assert.equal(row.pulls[0].asked, null);

    answers['/repos/anowner/arepo/issues/5/comments'] = {
        status: 200, body: [{ body: 'okc: change the hex to #fafafa', user: { login: 'bmatusiak', type: 'User' }, created_at: '2026-08-28T20:41:00Z', html_url: 'c' }]
    };
    await actions.call('repositoriesCheck', { repo: 'repo-one' });
    const box = (await state.here.doc('github-arrived')).read({});
    assert.deepEqual(box.pulls.map((p) => [p.number, p.kind]), [[5, 'asked']]);
    assert.equal(woke.length, 1, 'the supervisor was not woken for a comment under a pull request');
    assert.match(woke[0], /anowner\/arepo#5 \(a pull request\) was tagged by bmatusiak/);

    const after = (await actions.call('repositories', {})).repos.find((r) => r.repo === 'repo-one');
    assert.equal(after.pulls[0].asked.where, 'a reply');
    assert.equal(after.pulls[0].asked.act, 'the pull request');

    //AND NOT AGAIN NEXT SWEEP.
    await actions.call('repositoriesCheck', { repo: 'repo-one' });
    assert.equal(woke.length, 1);
});

test('an open pull request is on the issues list, marked, so its draft has somewhere to be released', async () => {
    const OPEN = { number: 5, title: 'a change', state: 'open', user: { login: 'beta-super1', type: 'User' }, head: { ref: 'fix/x', sha: 'abc' }, base: { ref: 'master' }, body: 'the change', html_url: 'p' };
    const answers = Object.assign({}, REPO_OK, {
        '/repos/anowner/arepo/pulls': { status: 200, body: [OPEN, Object.assign({}, OPEN, { number: 6, state: 'closed' })] },
        '/repos/anowner/arepo/pulls/5/reviews': { status: 200, body: [] },
        '/repos/anowner/arepo/pulls/6/reviews': { status: 200, body: [] },
        '/repos/anowner/arepo/issues/5/comments': { status: 200, body: [{ body: 'okc: change the hex', user: { login: 'bmatusiak', type: 'User' }, created_at: '2026-08-28T20:41:00Z', html_url: 'c' }] },
        '/repos/anowner/arepo/issues': { status: 200, body: [ISSUE_ROW(7)] }
    });
    const { actions } = await anApp(answers, undefined, undefined, WAKING);
    await actions.call('repositoriesCheck', { repo: 'repo-one' });
    const said = await actions.call('issues', {});
    const kinds = said.issues.map((r) => [r.number, r.kind]).sort();
    assert.deepEqual(kinds, [[5, 'pull'], [7, 'issue']], 'the open pull request is missing, or the closed one is there');
    const pull = said.issues.find((r) => r.number === 5);
    assert.equal(pull.asked.where, 'a reply');
    assert.equal(pull.head, 'fix/x');
    assert.equal(pull.url, 'p');
    //AND ONLY THE ASKED-ABOUT ONES, WHEN THAT IS WHAT WAS ASKED.
    const only = await actions.call('issues', { asked: true });
    assert.deepEqual(only.issues.map((r) => r.number), [5]);
});

test('a pull request reads whole through issueRead, and says it is one', async () => {
    const answers = Object.assign({}, REPO_OK, {
        '/repos/anowner/arepo/issues/5': {
            status: 200,
            body: { number: 5, title: 'a change', body: 'the change', state: 'open', html_url: 'u', labels: [],
                user: { login: 'beta-super1', type: 'User' }, created_at: '2026-08-28T20:24:00Z',
                pull_request: { html_url: 'https://github.com/anowner/arepo/pull/5' } }
        },
        '/repos/anowner/arepo/issues/5/comments': {
            status: 200, body: [{ body: 'okc: change the hex', user: { login: 'bmatusiak', type: 'User' }, created_at: '2026-08-28T20:41:00Z', html_url: 'c' }]
        }
    });
    const { actions, asked } = await anApp(answers, undefined, undefined, WAKING);
    const got = await actions.call('issueRead', { on: 'anowner/arepo', number: 5 });
    assert.equal(got.kind, 'pull');
    assert.equal(got.pull.url, 'https://github.com/anowner/arepo/pull/5');
    assert.equal(got.asked.act, 'the pull request');
    assert.equal(got.asked.where, 'a reply');
    assert.match(got.conversation, /okc-pull-5/);
    assert.match(got.conversation, /the pull request as it was opened/);
    assert.ok(!asked.some((a) => /sub_issues/.test(a)), 'it went looking for sub-issues under a pull request');
});

test('what arrived is recorded before the note is filed, so a sweep cut short between them is not lost', async () => {
    //IT WAS LOST ONCE. The note went first, with the tag in it; the server
    //half reloaded before the arrival was worked out; every later sweep saw
    //the tag on both sides and the maintainer's comment went unheard.
    const answers = Object.assign({}, REPO_OK, { '/repos/anowner/arepo/issues': { status: 200, body: [ISSUE_ROW(7)] } });
    const woke = [];
    const { actions, state } = await anApp(answers, undefined, undefined, WAKING);
    actions.define('supervisorWake', { about: 'a stand-in', run: async (a) => { woke.push(a.why); return { woke: true }; } });
    await actions.call('repositoriesCheck', { repo: 'repo-one' });

    answers['/repos/anowner/arepo/issues'] = {
        status: 200, body: [ISSUE_ROW(7, { body: 'okc: please look', user: { login: 'bmatusiak', type: 'User' } })]
    };
    //THE SWEEP IS CUT SHORT AT THE NOTE: the arrival must already be in the box.
    //`doc()` HANDS OUT A WRAPPER EACH TIME, so the sweep's own is the one to
    //cut: answer the note's name with one whose write dies.
    const docOf = state.here.doc;
    state.here.doc = async function (name) {
        const d = await docOf.call(state.here, name);
        if (name !== 'repositories') return d;
        return Object.assign(Object.create(d), { write: () => { throw new Error('the host is shutting down'); } });
    };
    await assert.rejects(() => actions.call('repositoriesCheck', { repo: 'repo-one' }), /shutting down/);
    state.here.doc = docOf;
    let box = (await state.here.doc('github-arrived')).read({});
    assert.deepEqual(box.issues.map((i) => [i.number, i.kind]), [[7, 'asked']], 'the arrival was lost with the sweep');
    assert.equal(woke.length, 1);

    //THE NEXT SWEEP SEES THE TAG AS NEW AGAIN -- the note never said it -- and
    //the box refuses the duplicate, so nothing is woken twice.
    await actions.call('repositoriesCheck', { repo: 'repo-one' });
    box = (await state.here.doc('github-arrived')).read({});
    assert.deepEqual(box.issues.map((i) => [i.number, i.kind]), [[7, 'asked']], 'the same arrival was recorded twice');
    assert.equal(woke.length, 1, 'the supervisor was woken twice for one tag');
});

test('a new issue is noted but does not wake anybody', async () => {
    const answers = Object.assign({}, REPO_OK, { '/repos/anowner/arepo/issues': { status: 200, body: [ISSUE_ROW(7)] } });
    const woke = [];
    const { actions, state } = await anApp(answers, undefined, undefined, WAKING);
    actions.define('supervisorWake', { about: 'a stand-in', run: async (a) => { woke.push(a.why); return { woke: true }; } });
    await actions.call('repositoriesCheck', { repo: 'repo-one' });
    answers['/repos/anowner/arepo/issues'] = { status: 200, body: [ISSUE_ROW(7), ISSUE_ROW(8)] };
    await actions.call('repositoriesCheck', { repo: 'repo-one' });
    const box = (await state.here.doc('github-arrived')).read({});
    assert.deepEqual(box.issues.map((i) => [i.number, i.kind]), [[8, 'new']]);
    assert.deepEqual(woke, [], 'a supervisor woken for every arrival is one nobody leaves on');
});

test('with supervisorWakes off a tag is noted and nobody is woken', async () => {
    const answers = Object.assign({}, REPO_OK, { '/repos/anowner/arepo/issues': { status: 200, body: [ISSUE_ROW(7)] } });
    const woke = [];
    const { actions, state } = await anApp(answers, undefined, undefined, {
        settings: { read: async () => ({ githubMarker: 'okc', githubTrusted: ['bmatusiak'], supervisorWakes: false }) }
    });
    actions.define('supervisorWake', { about: 'a stand-in', run: async (a) => { woke.push(a.why); return { woke: true }; } });
    await actions.call('repositoriesCheck', { repo: 'repo-one' });
    answers['/repos/anowner/arepo/issues'] = {
        status: 200, body: [ISSUE_ROW(7, { body: 'okc: please look', user: { login: 'bmatusiak', type: 'User' } })]
    };
    await actions.call('repositoriesCheck', { repo: 'repo-one' });
    assert.equal((await state.here.doc('github-arrived')).read({}).issues.length, 1, 'the arrival was not noted');
    assert.deepEqual(woke, []);
});

test("handing an issue over is a person's press, and it puts the whole conversation in the chat", async () => {
    const answers = Object.assign({}, REPO_OK, {
        '/repos/anowner/arepo/issues/7/comments': { status: 200, body: [] },
        '/repos/anowner/arepo/issues/7': { status: 200, body: ISSUE_ROW(7, { body: 'the header wraps', html_url: 'u', state: 'open', labels: [] }) },
        '/repos/anowner/arepo/issues': { status: 200, body: [ISSUE_ROW(7)] }
    });
    const chat = [];
    const woke = [];
    const { actions } = await anApp(answers, undefined, undefined, { settings: { read: async () => ({}) } });
    actions.define('chatSay', { about: 'a stand-in', run: async (a) => { chat.push(a.text); return {}; } });
    actions.define('supervisorWake', { about: 'a stand-in', run: async (a) => { woke.push(a.why); return { woke: true }; } });

    //NOT FROM THE PIPE, NOT FROM A DRIVEN PRESS. Something that can hand itself
    //work is deciding what it works on.
    await assert.rejects(() => actions.call('issueHand', { on: 'anowner/arepo', number: 7, _overTheWire: true }), /by a person at the window/);
    await assert.rejects(() => actions.call('issueHand', { on: 'anowner/arepo', number: 7, _driven: true }), /by a person at the window/);
    assert.deepEqual(chat, []);

    const said = await actions.call('issueHand', { on: 'anowner/arepo', number: 7 });
    assert.equal(said.handed, true);
    assert.equal(chat.length, 1);
    assert.match(chat[0], /Look at anowner\/arepo#7/);
    assert.match(chat[0], /okc-issue-7/, 'the conversation was not the fenced whole');
    assert.match(chat[0], /the header wraps/);
    //NOBODY TAGGED IT, AND THE HAND-OVER SAYS SO rather than letting the
    //supervisor infer a request that was never made.
    assert.match(chat[0], /handing it to you myself/);
    assert.equal(woke.length, 1);
});

//---------------------------------------------------------------------------
//RELEASING A REVIEW DRAFT: pinned to the commit the judge read.
//---------------------------------------------------------------------------

const PULL_ROW = (over) => Object.assign({
    number: 42, user: { login: 'a-stranger' }, head: { sha: 'abcdef1234567890' }, state: 'open'
}, over || {});

async function withReviewDraft(pullOver, login) {
    const answers = Object.assign({}, REPO_OK, {
        '/repos/anowner/arepo/pulls/42/reviews': { status: 200, body: { html_url: 'https://github.com/anowner/arepo/pull/42#pullrequestreview-9' }, headers: {} },
        '/repos/anowner/arepo/pulls/42': { status: 200, body: PULL_ROW(pullOver), headers: {} }
    });
    const { actions, state, asked } = await anApp(answers, undefined, undefined, { settings: { read: async () => ({}) } });
    actions.define('githubHeld', { about: 'a stand-in', run: async () => ({ held: true, login: login === undefined ? 'bmatusiak' : login }) });
    const box = await state.here.doc('github-drafts');
    box.write({
        'anowner/arepo#42': {
            kind: 'review', on: 'anowner/arepo', number: 42, sha: 'abcdef1234567890', event: 'APPROVE',
            text: '**Recommend Pulling: YES**\n\nfine', at: 'x', by: 'J3', judgement: 'J3'
        }
    });
    return { actions, state, asked, box };
}

test('releasing a review posts it as a review, at the commit it read', async () => {
    const { actions, asked, box } = await withReviewDraft();
    const said = await actions.call('issueApprove', { on: 'anowner/arepo', number: 42 });
    assert.equal(said.review, true);
    assert.equal(said.event, 'APPROVE');
    assert.ok(asked.some((a) => a === 'POST /repos/anowner/arepo/pulls/42/reviews'), 'it did not post a review');
    assert.ok(!asked.some((a) => /\/issues\/42\/comments/.test(a)), 'it posted a comment instead of a review');
    assert.deepEqual(box.read({}), {}, 'the released draft was left waiting');
});

test('a head that moved since the judge read it is refused, and the draft stays', async () => {
    //A REVIEW PINNED TO AN OLDER COMMIT READS AS APPROVAL OF CODE NOBODY READ.
    const { actions, asked, box } = await withReviewDraft({ head: { sha: 'fedcba0987654321' } });
    await assert.rejects(() => actions.call('issueApprove', { on: 'anowner/arepo', number: 42 }), /moved since J3 read it/);
    assert.ok(!asked.some((a) => /\/reviews$/.test(a) && /^POST/.test(a)), 'it posted anyway');
    assert.ok(box.read({})['anowner/arepo#42'], 'the refused draft was thrown away');
});

test('on this host\'s own pull request the event is forced to a comment at release too', async () => {
    //THE TOKEN MAY HAVE CHANGED SINCE THE DRAFT WAS WRITTEN; GitHub is asked
    //who the author is at the moment of posting.
    const { actions } = await withReviewDraft({ user: { login: 'bmatusiak' } });
    const said = await actions.call('issueApprove', { on: 'anowner/arepo', number: 42 });
    assert.equal(said.event, 'COMMENT');
});

test('a review is released by a person and nobody else', async () => {
    const { actions } = await withReviewDraft();
    for (const mark of ['_overTheWire', '_driven', '_fromTest']) {
        const a = { on: 'anowner/arepo', number: 42 }; a[mark] = true;
        await assert.rejects(() => actions.call('issueApprove', a), /released by a person at the window/);
    }
});

//---------------------------------------------------------------------------
//WHAT IS WRITTEN AND NOT SENT IS IN THE INBOX.
//
//A draft is stopped until a person reads it; the inbox is where a person is
//told what is stopped on them. The first version of this source read the doc
//through a helper declared in another scope, threw, and caught its own throw
//into "nothing waiting" -- which is why this asserts the item, not the absence
//of an error.
//---------------------------------------------------------------------------

test('a reply, a close and a review waiting to go out are each an inbox errand', async () => {
    const { state, sources } = await anApp(REPO_OK, undefined, undefined, { settings: { read: async () => ({}) } });
    const src = sources.filter((s) => /written and not sent/.test(s.name))[0];
    assert.ok(src, 'the drafts source is not registered');

    assert.deepEqual(await src.waiting(), [], 'an empty drafts doc reported something waiting');

    (await state.here.doc('github-drafts')).write({
        'them/repo#3': { kind: 'reply', on: 'them/repo', number: 3, text: 'Looking now.', at: 'x', by: 'J1' },
        'them/repo#4': { kind: 'close', on: 'them/repo', number: 4, text: null, at: 'y', by: 'the supervisor' },
        'them/repo#5': { kind: 'review', on: 'them/repo', number: 5, text: '**Recommend Pulling: YES**', at: 'z', by: 'J9', judgement: 'J9', event: 'APPROVE' }
    });
    const items = await src.waiting();
    assert.equal(items.length, 3);
    const byKind = {};
    items.forEach((i) => { byKind[i.kind] = i; });
    assert.ok(byKind['a reply is waiting to be sent'], 'the reply is not an errand');
    assert.ok(byKind['a close is waiting to be released'], 'the close is not an errand');
    assert.ok(byKind['a review is waiting to be posted'], 'the review is not an errand');
    //A REVIEW GOES TO THE JUDGEMENT IT CAME FROM; a reply goes to its issue.
    //PANE AND PICK, not the whole address: the stand-in `inbox.at` spells the
    //tab as `tab` where the real one says `view`, and that spelling is the
    //inbox's business.
    assert.equal(byKind['a review is waiting to be posted'].where.pane, 'Judgement');
    assert.equal(byKind['a review is waiting to be posted'].where.pick, 'J9');
    assert.equal(byKind['a reply is waiting to be sent'].where.pane, 'Issues');
    assert.equal(byKind['a reply is waiting to be sent'].where.pick, 'them/repo#3');
    assert.match(byKind['a review is waiting to be posted'].why, /APPROVE review/);
});
