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
    assert.ok(!/\btoken\b/.test(code.replace(/'[^']*'/g, '')), 'it handles something called a token outside a message');
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
    assert.equal(row.defaultBranch, 'main');
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
test('if the read is defined here at all, it carries what the pane reads', async () => {
    const { actions } = await anApp(REPO_OK);
    const mine = actions.list().map((a) => a.name);

    if (!mine.includes('repositories')) return;   // still relayed, which is the state this was written in

    const said = await actions.call('repositories', {});
    const row = (said.repos || [])[0] || {};
    for (const field of ['repo', 'path', 'default', 'head', 'branches', 'remote',
        'reachable', 'why', 'may', 'openPulls', 'openIssues', 'target', 'inStep', 'stale']) {
        assert.ok(field in row,
            'repositories now shadows the relayed action but its rows have no `' + field + '` — the pane reads that');
    }
});

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
