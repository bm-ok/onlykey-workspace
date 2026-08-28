const { test } = require('node:test');
const assert = require('node:assert');

const plugin = require('../../src/app/repositories/pr/server');
const Paged = require('../../src/app/github/paged');

//---------------------------------------------------------------------------
//A CUT'S PULL REQUESTS CARRY GITHUB'S OWN ANSWER TO "IS IT REVIEWED".
//
//Read off the pull request every time, never remembered -- and read only for
//the ones still open, because a merged pull request's reviews are history and
//a request for them is a request for nothing.
//---------------------------------------------------------------------------

function aPr(answers, over) {
    const o = over || {};
    const asked = [];
    const docs = {};
    function doc(name) {
        if (!docs[name]) {
            let kept = null;
            docs[name] = { read: (f) => (kept === null ? f : kept), write: (v) => { kept = v; return v; } };
        }
        return docs[name];
    }
    const call = async (method, at) => {
        asked.push(method + ' ' + at);
        const pre = Object.keys(answers).filter((k) => at.startsWith(k)).sort((a, b) => b.length - a.length)[0];
        if (pre) return typeof answers[pre] === 'function' ? answers[pre](at) : answers[pre];
        return { status: 404, body: { message: 'nothing said about ' + at }, headers: {} };
    };
    return {
        asked, doc,
        imports: {
            app: { host: { actions: { define: () => () => {}, whoAsked: () => 'a test', call: async () => null } } },
            log: { on: () => ({ good() {}, warn() {}, bad() {}, info() {} }) },
            git: { commits: async () => [], push: async () => ({ pushed: true }) },
            github: { call, all: Paged(call, 20) },
            keys: { github: { envForPush: () => ({}), credentialHelper: null, held: () => ({ held: true, login: o.login || 'bmatusiak' }) } },
            workspace: { dir: async () => 'C:/work', repos: async () => [{ name: 'repo-one' }] },
            state: { here: { doc: (n) => doc(n) } },
            settings: { read: () => ({}) },
            refs: { origin: async () => ({ owner: 'me', repo: 'repo-one', kind: 'github' }), heads: async () => ({}) }
        }
    };
}

async function loaded(answers, over) {
    const w = aPr(answers, over);
    let service = null;
    await plugin(w.imports, async (_e, s) => { service = s; });
    w.stateOf = service.prcuts.stateOf;
    return w;
}

const PULL = (n, over) => Object.assign({
    number: n, title: 'the change', html_url: 'u', draft: false, user: { login: 'bmatusiak', id: 1822932 },
    created_at: 'x', base: { ref: 'master', repo: { full_name: 'them/repo' } }, head: { ref: 'fix/it', sha: 'deadbeef' },
    state: 'open', merged_at: null, updated_at: 'y', mergeable: true
}, over || {});

const REVIEW = (by, state, sha) => ({ user: { login: by }, state, submitted_at: '2026-01-01', commit_id: sha || 'deadbeef', html_url: 'r', id: 9 });

test('an open pull request carries its reviews, its head commit, and where it is on', async () => {
    const w = await loaded({
        '/repos/them/repo/pulls/5/reviews': { status: 200, body: [REVIEW('alice', 'APPROVED'), REVIEW('bmatusiak', 'COMMENTED')], headers: {} },
        '/repos/them/repo/pulls/5': { status: 200, body: PULL(5), headers: {} }
    });
    const said = await w.stateOf({ pulls: [{ repo: 'repo-one', number: 5, into: 'them/repo' }] });
    const p = said.pulls[0];
    assert.equal(p.headSha, 'deadbeef');
    assert.equal(p.into, 'them/repo');
    assert.equal(p.byId, 1822932);
    assert.equal(p.reviews.approved, 1);
    assert.equal(p.reviews.latestByThisHost.event, 'COMMENTED', 'this host could not find its own review');
});

test('a merged pull request is not asked about its reviews', async () => {
    //THE SABOTAGE: reading reviews for everything would be one request per
    //pull request that ever landed, every time anybody looked at the board.
    const w = await loaded({
        '/repos/them/repo/pulls/5/reviews': { status: 200, body: [REVIEW('alice', 'APPROVED')], headers: {} },
        '/repos/them/repo/pulls/5': { status: 200, body: PULL(5, { state: 'closed', merged_at: '2026-01-02' }), headers: {} }
    });
    const said = await w.stateOf({ pulls: [{ repo: 'repo-one', number: 5, into: 'them/repo' }] });
    assert.equal(said.pulls[0].state, 'merged');
    assert.equal(said.pulls[0].reviews, undefined);
    assert.ok(!w.asked.some((a) => /\/reviews/.test(a)), 'it asked for the reviews of a merged pull request');
});

test('when GitHub will not say, reviews are null and not "nobody reviewed it"', async () => {
    const w = await loaded({
        '/repos/them/repo/pulls/5/reviews': { status: 403, body: { message: 'no' }, headers: {} },
        '/repos/them/repo/pulls/5': { status: 200, body: PULL(5), headers: {} }
    });
    const said = await w.stateOf({ pulls: [{ repo: 'repo-one', number: 5, into: 'them/repo' }] });
    assert.equal(said.pulls[0].reviews, null);
    assert.equal(said.pulls[0].state, 'open', 'a failed reviews read broke the pull request itself');
});
