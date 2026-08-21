const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const child = require('node:child_process');

const actionsPlugin = require('../src/app/core/actions/main');
const statePlugin = require('../src/app/core/state/main');
const gitPlugin = require('../src/app/git/server');
const reposPlugin = require('../src/app/repositories/repos/server');

const APP = path.join(__dirname, '..', 'src', 'app');

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
function aGitHub(answers) {
    const asked = [];
    return {
        asked,
        github: {
            call: async (method, at) => {
                asked.push(method + ' ' + at);
                //LONGEST PREFIX WINS, so a test can answer `/repos/o/r` and have
                //`/repos/o/r/branches?per_page=100` still find its own entry.
                const pre = Object.keys(answers)
                    .filter((k) => at.startsWith(k))
                    .sort((a, b) => b.length - a.length)[0];
                if (pre) return answers[pre];
                return { status: 404, body: { message: 'nothing said about ' + at } };
            },
            check: async () => ({ ok: true }),
            apiHost: () => 'api.github.com'
        }
    };
}

async function anApp(answers, open) {
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

    const gh = aGitHub(answers || {});
    await reposPlugin({
        app: { host: { actions } },
        log: { on: () => logger },
        git: git_,
        github: gh.github,
        workspace,
        state
    }, async () => {});

    return { actions, asked: gh.asked, said, git: git_, go: (to) => { where = to; } };
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
    //be perfect — it has to not be fooled by the one construction that is
    //everywhere in this codebase.
    assert.ok(!/\btoken\b/.test(code.replace(/'(?:[^'\\]|\\.)*'/g, '')),
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
        check: async () => ({ ok: false }),
        apiHost: () => 'api.github.com'
    };

    await reposPlugin({ app: { host: { actions } }, log: { on: () => logger }, git: git_, github, workspace, state }, async () => {});

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
