const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const actionsPlugin = require('../../src/app/core/actions/main');
const statePlugin = require('../../src/app/core/state/main');
const prPlugin = require('../../src/app/repositories/pr/server');

//---------------------------------------------------------------------------
//a PR cut: one act, one pull request per repository, held together.
//
//WHAT IS ASSERTED HERE IS THE REFUSALS AND THE READING, not that a pull request
//can be opened. Opening one is a POST to somebody's repository; a test that
//proved it worked would have to make one, and the version of this that runs
//against a stand-in GitHub proves only that the stand-in agrees with itself.
//
//So: the gates, the shape of what comes back, and the two places where a wrong
//answer is the OPPOSITE of the truth rather than merely missing.
//---------------------------------------------------------------------------

function aGitHub(answers) {
    const asked = [];
    return {
        asked,
        github: {
            call: async (method, at, body) => {
                asked.push({ method, at, body });
                const pre = Object.keys(answers).filter((k) => (method + ' ' + at).startsWith(k))
                    .sort((a, b) => b.length - a.length)[0];
                if (pre) return answers[pre];
                return { status: 404, body: { message: 'nothing said about ' + method + ' ' + at } };
            },
            check: async () => ({ ok: true }),
            apiHost: () => 'api.github.com'
        }
    };
}

async function anApp(opts) {
    const o = opts || {};
    let actions = null;
    await actionsPlugin({}, async (_e, s) => { actions = s.actions; });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-pr-'));
    let state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dir, ...p) } }, async (_e, s) => { state = s.state; });
    state.follow(async () => (o.open === null ? null : (o.open || 'C:\\work\\alpha')));

    if (o.landings) (await state.here.doc('landings')).write(o.landings);
    if (o.template) (await state.here.doc('pr-template')).write(o.template);

    const said = [];
    const logger = { good: (t) => said.push(t), warn: (t) => said.push(t), bad: () => {}, info: () => {} };
    const gh = aGitHub(o.answers || {});

    //WHAT THE PUSH DOOR WAS ASKED TO DO, recorded rather than done.
    const pushes = [];
    const git = {
        origin: async (repo) => ({ host: 'github.com', owner: 'anowner', repo: repo, kind: 'github' }),
        commits: async () => [{ sha: 'abc1234', subject: 'a change' }],
        has: async () => true,
        push: async (repo, branch, opts2) => { pushes.push({ repo, branch, opts: opts2 }); return { pushed: true }; }
    };

    let prcuts = null;
    await prPlugin({
        app: { host: { actions } },
        log: { on: () => logger },
        git, github: gh.github,
        keys: { github: { envForPush: () => ({ OKC_GIT_TOKEN: 'ghp_notReal' }), credentialHelper: 'C:\\helper.js' } },
        workspace: { dir: async () => 'C:\\work\\alpha', repos: async () => [{ name: 'one' }] },
        state,
        settings: { allowed: async () => o.testing || { allowed: false, why: 'The drills are switched off.' } }
    }, async (_e, s) => { prcuts = s.prcuts; });

    return { actions, prcuts, state, said, asked: gh.asked, pushes };
}

//---------------------------------------------------------------------------
//1. THE GATE ON SENDING A CHANGE OUT.
//
//In the app being ported from, the pipe may send a change only when something
//has READ it — a judgement, not stale, not rejected. The judging half is not
//ported, so staleness cannot be checked, so the pipe is refused ENTIRELY.
//A gate ported at two thirds is worse than none: it reads as the whole one.
//---------------------------------------------------------------------------

test('a change cannot be sent out down the pipe, and the refusal says why not', async () => {
    const { actions, pushes } = await anApp();

    await assert.rejects(
        () => actions.call('prCutMake', { source: 'a', target: 'b', title: 't', _overTheWire: true }),
        /sent out from the window, by a person/);
    await assert.rejects(
        () => actions.call('prCutMake', { source: 'a', target: 'b', title: 't', _overTheWire: true }),
        /judging half has not been ported/);

    assert.deepEqual(pushes, [], 'it pushed before refusing');
});

test('editing every pull request in a cut is refused down the pipe too', async () => {
    const { actions } = await anApp({
        landings: { 'a -> b': { source: 'a', target: 'b', pulls: [{ repo: 'one', number: 1, into: 'anowner/one' }] } }
    });
    await assert.rejects(
        () => actions.call('prCutUpdate', { source: 'a', target: 'b', title: 'x', _overTheWire: true }),
        /by a person/);
});

//LANDING IS GATED ON TESTING MODE, not on a judgement — a person pressing the
//button is landing their own change; anything else is a model merging into
//somebody's repository.
test('landing from the pipe needs testing mode, and says which folder', async () => {
    const { actions } = await anApp({
        landings: { 'a -> b': { source: 'a', target: 'b', pulls: [{ repo: 'one', number: 1, into: 'anowner/one' }] } }
    });
    await assert.rejects(
        () => actions.call('prCutLand', { source: 'a', target: 'b', _overTheWire: true }),
        /only done while testing mode is on/);
    await assert.rejects(
        () => actions.call('prCutLand', { source: 'a', target: 'b', _overTheWire: true }),
        /drills are switched off/);
});

test('a person at the window may land, and merged is reported per repository', async () => {
    const { actions } = await anApp({
        landings: { 'a -> b': { source: 'a', target: 'b', pulls: [
            { repo: 'one', number: 1, into: 'anowner/one' },
            { repo: 'two', number: 2, into: 'anowner/two' }
        ] } },
        answers: {
            'GET /repos/anowner/one/pulls/1': { status: 200, body: { number: 1, state: 'open', html_url: 'u' } },
            'GET /repos/anowner/two/pulls/2': { status: 200, body: { number: 2, state: 'open', html_url: 'u' } },
            'PUT /repos/anowner/one/pulls/1/merge': { status: 200, body: { merged: true } },
            'PUT /repos/anowner/two/pulls/2/merge': { status: 409, body: { message: 'Pull Request is not mergeable' } }
        }
    });

    const said = await actions.call('prCutLand', { source: 'a', target: 'b' });
    assert.equal(said.landed, 1);
    //PARTLY IN IS THE STATE WORTH SAYING LOUDEST — the whole point of a cut is
    //that it lands as one thing, and half of it being in is what somebody has to
    //deal with by hand.
    assert.match(said.note, /PARTLY IN/);
    assert.match(said.note, /not mergeable/);
});

//---------------------------------------------------------------------------
//2. MERGED IS NOT CLOSED.
//
//GitHub reports both as `state: closed`. Reading the state alone turns every
//merged pull request into a rejected one — the opposite news, on the pane whose
//job is telling you whether a change landed.
//---------------------------------------------------------------------------

test('a merged pull request reads as merged, not as closed', async () => {
    const { actions } = await anApp({
        landings: { 'a -> b': { source: 'a', target: 'b', pulls: [{ repo: 'one', number: 1, into: 'anowner/one' }] } },
        answers: {
            'GET /repos/anowner/one/pulls/1': {
                status: 200,
                body: { number: 1, state: 'closed', merged_at: '2026-08-01T00:00:00Z', html_url: 'u' }
            }
        }
    });

    const cut = (await actions.call('prCuts', {})).cuts[0];
    assert.equal(cut.pulls[0].state, 'merged', 'a merged pull request was reported as closed, which is the opposite news');
    assert.equal(cut.merged, 1);
    assert.equal(cut.closed, 0);
    assert.equal(cut.landed, true);
});

test('a genuinely closed one is closed, and the cut has not landed', async () => {
    const { actions } = await anApp({
        landings: { 'a -> b': { source: 'a', target: 'b', pulls: [{ repo: 'one', number: 1, into: 'anowner/one' }] } },
        answers: {
            'GET /repos/anowner/one/pulls/1': { status: 200, body: { number: 1, state: 'closed', merged_at: null, html_url: 'u' } }
        }
    });
    const cut = (await actions.call('prCuts', {})).cuts[0];
    assert.equal(cut.pulls[0].state, 'closed');
    assert.equal(cut.landed, false, 'a rejected change was reported as landed');
});

//`into` IS ASKED FIRST, because a pull request from a fork lives IN THE PARENT.
test('a pull request is looked for where it actually lives', async () => {
    const { actions, asked } = await anApp({
        landings: { 'a -> b': { source: 'a', target: 'b', pulls: [{ repo: 'one', number: 7, into: 'upstream/theirs' }] } },
        answers: { 'GET /repos/upstream/theirs/pulls/7': { status: 200, body: { number: 7, state: 'open', html_url: 'u' } } }
    });

    await actions.call('prCuts', {});
    assert.ok(asked.some((a) => a.at === '/repos/upstream/theirs/pulls/7'), 'it did not look in the parent');
    assert.ok(!asked.some((a) => a.at === '/repos/anowner/one/pulls/7'),
        'it looked on the fork first, which is where the pull request is not');
});

//---------------------------------------------------------------------------
//3. THE TEMPLATE IS OFF UNTIL SOMEBODY TURNS IT ON.
//
//What this app knows about a change is useful in a pull request and is nobody
//else's decision. A template that arrives switched on writes somebody's internal
//notes into a public repository the first time they press the button.
//---------------------------------------------------------------------------

test('nothing is added to a body until a block is switched on', async () => {
    const { prcuts } = await anApp();
    const body = await prcuts.compose('what a person wrote', {
        branch: 'x', me: 'one', repos: ['one'], note: { reason: 'a secret internal reason' }, carries: [], pulls: []
    });
    assert.equal(body, 'what a person wrote', 'a block was added that nobody turned on');
});

test('what was typed comes first, and blocks are appended under it', async () => {
    const { prcuts } = await anApp({ template: { reason: true, origin: true } });
    const body = await prcuts.compose('what a person wrote', {
        branch: 'x', me: 'one', repos: ['one'], note: { reason: 'issue #4' }, carries: [], pulls: []
    });

    assert.ok(body.startsWith('what a person wrote'), 'a person\'s own words were not first');
    assert.match(body, /Why this branch exists:\*\* issue #4/);
    assert.match(body, /Opened by the dashboard/);
});

//A BLOCK THAT SAYS "this change is also in:" AND THEN LISTS NOTHING is worse
//than silence.
test('the crosslinks block stays out of a change that is in one repository', async () => {
    const { prcuts } = await anApp({ template: { crosslinks: true } });

    const alone = await prcuts.compose('x', { me: 'one', repos: ['one'], pulls: [] });
    assert.equal(alone, 'x', 'it wrote a crosslinks block for a change with nothing to link to');

    const many = await prcuts.compose('x', {
        me: 'one', repos: ['one', 'two'],
        pulls: [{ repo: 'two', number: 4, url: 'https://example.invalid/4' }]
    });
    assert.match(many, /This change is also in/);
    assert.match(many, /two — https/);
});

test('a block that is not one is refused, and the refusal lists what is', async () => {
    const { actions } = await anApp();
    await assert.rejects(() => actions.call('prTemplateSet', { id: 'nonsense', on: true }), /is not a block/);
    await assert.rejects(() => actions.call('prTemplateSet', { id: 'nonsense', on: true }), /crosslinks/);
});

//---------------------------------------------------------------------------
//4. TWO SENTENCES THAT SAY WHAT DID NOT HAPPEN.
//---------------------------------------------------------------------------

test('saving a draft says that nothing was sent', async () => {
    const { actions } = await anApp();
    const said = await actions.call('prDraftSave', { source: 'a', target: 'b', title: 't', body: 'b' });
    assert.match(said.note, /Nothing has been pushed/);
    assert.match(said.note, /no pull request has been opened/);

    assert.equal((await actions.call('prDrafts', {})).drafts.length, 1);
});

test('forgetting a cut says the pull requests are untouched', async () => {
    const { actions } = await anApp({
        landings: { 'a -> b': { source: 'a', target: 'b', pulls: [{ repo: 'one', number: 1 }, { repo: 'two', number: 2 }] } }
    });

    const said = await actions.call('prCutForget', { source: 'a', target: 'b' });
    assert.match(said.note, /untouched/);
    assert.match(said.note, /2 pull request/);
    await assert.rejects(() => actions.call('prCutForget', { source: 'a', target: 'b' }), /no cut from/);
});

test('with no workspace open there are no cuts, and it does not throw', async () => {
    const { actions } = await anApp({ open: null });
    const said = await actions.call('prCuts', {});
    assert.deepEqual(said.cuts, []);
    assert.match(said.note, /No workspace is open/);
});
