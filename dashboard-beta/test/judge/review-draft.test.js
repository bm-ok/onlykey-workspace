const { test } = require('node:test');
const assert = require('node:assert');

const plugin = require('../../src/app/judge/server');

//---------------------------------------------------------------------------
//A JUDGEMENT BECOMES A PULL REQUEST REVIEW, DRAFTED.
//
//The recommendation used to be a field on a record here and a plain comment
//on GitHub. A review is GitHub's object for "a reviewer concluded X at commit
//Y", and it is drafted -- it waits for a person -- unless the window has been
//set to post directly.
//---------------------------------------------------------------------------

const REVIEW = '# What I read\n\nIt does what was asked.\n\nRECOMMENDATION: accept\n';

function aJudge(over) {
    const o = over || {};
    const did = { github: [], called: [] };
    const defined = new Map();
    const docs = {};
    function doc(name) {
        if (!docs[name]) {
            let kept = null;
            docs[name] = { read: (f) => (kept === null ? f : kept), write: (v) => { kept = v; return v; } };
        }
        return docs[name];
    }
    const files = o.files === undefined ? [{ file: 'REVIEW.md' }] : o.files;
    const bodies = o.bodies === undefined ? { 'REVIEW.md': REVIEW } : o.bodies;
    const pull = Object.assign({ user: { login: 'a-stranger' }, head: { sha: 'abcdef1234567890' }, state: 'open' }, o.pull || {});

    return {
        did, defined, doc,
        imports: {
            app: {
                host: {
                    actions: {
                        define: (name, spec) => { defined.set(name, spec); return () => {}; },
                        whoAsked: () => 'a test',
                        call: async (what, args) => {
                            did.called.push(what);
                            if (what === 'githubHeld') return { held: true, login: o.login === undefined ? 'bmatusiak' : o.login };
                            if (what === 'settings') return { settings: { githubReviewDirect: !!o.direct } };
                            if (what === 'reviewDraft') return defined.get('reviewDraft').run(args);
                            if (what === 'repositories') return { repos: [] };
                            return null;
                        }
                    }
                }
            },
            log: { on: () => ({ good() {}, warn() {}, bad() {}, info() {} }) },
            state: { here: { doc: (n) => doc(n) } },
            prcuts: {
                all: async () => (o.landings || {}),
                allowed: { check: () => ({ allowed: true, stale: false }) }
            },
            refs: { origin: async () => null, heads: async () => ({}) },
            archive: {
                store: () => ({
                    list: async () => files,
                    read: async (uid, file) => ({ text: bodies[file] || '' }),
                    keep: async () => ({}), has: async () => false
                })
            },
            github: {
                call: async (method, path, body) => {
                    did.github.push({ method, path, body });
                    if (method === 'GET' && /\/pulls\/\d+$/.test(path)) return { status: 200, body: pull };
                    if (method === 'POST' && /\/reviews$/.test(path)) return o.githubSays || { status: 200, body: { html_url: 'https://github.com/x/y/pull/1#pullrequestreview-1' } };
                    return { status: 404, body: {} };
                }
            }
        }
    };
}

async function withJudgement(over) {
    const w = aJudge(over);
    let service = null;
    await plugin(w.imports, async (_e, s) => { service = s; });
    const subject = (over && over.subject) || { kind: 'pull', on: 'someone/their-repo', number: 42, sha: 'abcdef1234567890', name: 'their-repo#42' };
    const made = await service.judge.add(Object.assign({ subject }, (over && over.judgement) || {}));
    await service.judge.update(made.id, { state: 'done', concluded: (over && over.concluded) || 'accept' });
    w.draft = w.defined.get('reviewDraft');
    w.say = w.defined.get('judgementSay');
    w.service = service;
    w.ref = made.ref || service.judge.refOf(made.number);
    w.drafts = () => w.doc('github-drafts').read({});
    return w;
}

test('a finished judgement of a stranger\'s pull request drafts an APPROVE review and posts nothing', async () => {
    const w = await withJudgement({});
    const said = await w.draft.run({ ref: w.ref });
    assert.equal(said.waiting, true);
    assert.equal(said.posted, false);
    assert.equal(said.event, 'APPROVE');
    const d = w.drafts()['someone/their-repo#42'];
    assert.ok(d, 'no draft was written');
    assert.equal(d.kind, 'review');
    assert.equal(d.sha, 'abcdef1234567890');
    assert.match(d.text, /\*\*Recommend Pulling: YES\*\*/);
    assert.match(d.text, /It does what was asked/);
    assert.deepEqual(w.did.github.filter((c) => c.method === 'POST'), [], 'a draft reached GitHub');
});

test('reject requests changes, and a review with no recommendation comments', async () => {
    const w = await withJudgement({ bodies: { 'REVIEW.md': 'It is wrong.\n\nRECOMMENDATION: reject\n' } });
    assert.equal((await w.draft.run({ ref: w.ref })).event, 'REQUEST_CHANGES');
    const w2 = await withJudgement({ bodies: { 'REVIEW.md': 'It is fine, mostly.\n' }, concluded: null });
    const said = await w2.draft.run({ ref: w2.ref });
    assert.equal(said.event, 'COMMENT');
    assert.equal(said.recommend, 'UNSTATED');
});

test('on this host\'s own pull request the review is forced to a comment, and the draft says why', async () => {
    //GITHUB REFUSES AN APPROVAL FROM THE AUTHOR. A cut this host sent was
    //opened under the same token the judge reviews with.
    const w = await withJudgement({ pull: { user: { login: 'BMatusiak' } } });
    const said = await w.draft.run({ ref: w.ref });
    assert.equal(said.event, 'COMMENT');
    assert.equal(said.forced, true);
    const d = w.drafts()['someone/their-repo#42'];
    assert.match(d.why, /your own pull request/);
    assert.match(d.text, /Recommend Pulling: YES/, 'the recommendation was lost with the event');
});

test('a claim check is never a review', async () => {
    const w = await withJudgement({ judgement: { job: 'check-a-claim' } });
    const said = await w.draft.run({ ref: w.ref });
    assert.equal(said.drafted, false);
    assert.deepEqual(w.drafts(), {});
});

test('a judgement of a cut drafts one review per pull request it landed as', async () => {
    const w = await withJudgement({
        subject: { kind: 'cut', source: 'fix/x', target: 'default', name: 'fix/x -> default' },
        landings: { 'fix/x -> default': { pulls: [
            { repo: 'one', number: 7, into: 'them/one' }, { repo: 'two', number: 9, into: 'them/two' }, { repo: 'three', number: null }
        ] } }
    });
    const said = await w.draft.run({ ref: w.ref });
    assert.equal(said.reviews.length, 2);
    assert.ok(w.drafts()['them/one#7']);
    assert.ok(w.drafts()['them/two#9']);
});

test('a cut with no pull request yet, and a bare branch, are refused with the reason', async () => {
    const w = await withJudgement({ subject: { kind: 'cut', source: 'fix/x', target: 'default', name: 'fix/x -> default' } });
    await assert.rejects(() => w.draft.run({ ref: w.ref }), /has no pull request yet/);
    const w2 = await withJudgement({ subject: { kind: 'branch', branch: 'fix/x', name: 'fix/x' } });
    await assert.rejects(() => w2.draft.run({ ref: w2.ref }), /landing it or not/);
});

test('a second judgement of the same pull request replaces the draft rather than queueing behind it', async () => {
    const w = await withJudgement({});
    await w.draft.run({ ref: w.ref });
    const again = await w.service.judge.add({ subject: { kind: 'pull', on: 'someone/their-repo', number: 42, sha: 'abcdef1234567890', name: 'their-repo#42' } });
    await w.service.judge.update(again.id, { state: 'done', concluded: 'reject' });
    await w.draft.run({ ref: again.ref || w.service.judge.refOf(again.number) });
    const all = w.drafts();
    assert.equal(Object.keys(all).length, 1);
    assert.equal(all['someone/their-repo#42'].judgement, again.ref || w.service.judge.refOf(again.number));
});

test('with direct reviews on it posts, pinned to the head it read, and writes down where', async () => {
    const w = await withJudgement({ direct: true });
    const said = await w.draft.run({ ref: w.ref });
    assert.equal(said.posted, true);
    const post = w.did.github.filter((c) => c.method === 'POST')[0];
    assert.equal(post.path, '/repos/someone/their-repo/pulls/42/reviews');
    assert.equal(post.body.event, 'APPROVE');
    assert.equal(post.body.commit_id, 'abcdef1234567890');
    assert.match(post.body.body, /Recommend Pulling: YES/);
    const after = await w.service.judge.get(w.ref);
    assert.equal(after.reviewed.length, 1);
    assert.equal(after.reviewed[0].event, 'APPROVE');
    assert.deepEqual(w.drafts(), {}, 'a posted review left a draft behind');
});

test('a preview composes exactly what would go and writes nothing', async () => {
    const w = await withJudgement({});
    const said = await w.draft.run({ ref: w.ref, preview: true });
    assert.equal(said.posted, false);
    assert.match(said.body, /Recommend Pulling: YES/);
    assert.deepEqual(w.drafts(), {});
});

test('judgementSay is the same door under its old name, and is not refused to the pipe', async () => {
    //THE OLD REFUSAL CONTRADICTED THE SUPERVISOR'S LIST. Writing a draft is not
    //speech; releasing it is, and that door refuses the pipe.
    const w = await withJudgement({});
    const said = await w.say.run({ ref: w.ref, _overTheWire: true });
    assert.equal(said.waiting, true);
    assert.deepEqual(w.did.github.filter((c) => c.method === 'POST'), []);
});
