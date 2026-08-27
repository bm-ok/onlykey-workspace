const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const actionsPlugin = require('../../src/app/core/actions/main');
const statePlugin = require('../../src/app/core/state/main');
const prPlugin = require('../../src/app/repositories/pr/server');
const { refsFor } = require('../../tools/test-parts');
const Many = require('../../src/app/github/many');

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
            //THE REAL POOL, NOT A STAND-IN FOR IT. A stub that ran these one at
            //a time would pass every check below exactly as happily, so the day
            //this stopped being concurrent nothing here would say so — a stub
            //easier to satisfy than the thing it stands for is a stub being
            //tested. See ../../src/app/github/many.js.
            many: Many(8),
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
        //THE REAL ../../src/app/git HAS THIS, and ../../src/app/repositories/refs
        //subscribes to it — so a stand-in without it is a stand-in that could
        //not stand in. It returns the way to stop listening.
        wrote: () => () => {},
        tracked: async () => ({}),
        head: async () => 'master',
        branches: async () => [],
        push: async (repo, branch, opts2) => { pushes.push({ repo, branch, opts: opts2 }); return { pushed: true }; }
    };

    const { refs } = await refsFor({
        git,
        workspace: { dir: async () => 'C:/work/alpha', repos: async () => [{ name: 'one' }] },
        log: { on: () => logger }
    });

    let prcuts = null;
    const sources = [];
    await prPlugin({
        app: { host: { actions } },
        log: { on: () => logger },
        git, github: gh.github,
        keys: { github: { envForPush: () => ({ OKC_GIT_TOKEN: 'ghp_notReal' }), credentialHelper: 'C:\\helper.js' } },
        workspace: { dir: async () => 'C:\\work\\alpha', repos: async () => [{ name: 'one' }] },
        state,
        settings: { allowed: async () => o.testing || { allowed: false, why: 'The drills are switched off.' } },
        refs,
        //THE INBOX, KEPT RATHER THAN STUBBED AWAY. `source()` hands back the
        //`waiting` function so a test can ask it what it would raise — which is
        //the only way to see this source at all, since the pane that shows it is
        //in the other half.
        inbox: {
            source: (spec) => { sources.push(spec); return () => {}; },
            item: (kind, which, why, where, more) => Object.assign({ kind, which, why, where }, more || {}),
            at: (tab, pane, pick) => ({ tab, pane, pick })
        }
    }, async (_e, s) => { prcuts = s.prcuts; });

    return { actions, prcuts, state, said, asked: gh.asked, pushes, sources };
}

//---------------------------------------------------------------------------
//1. THE GATE ON SENDING A CHANGE OUT.
//
//The pipe may send a change only when something has READ it — a judgement, not
//stale against what it read, and not rejected. That is `mustBeJudged`, and the
//facts come from ../../judge because the staleness rule and the `tips` are its.
//
//THIS USED TO REFUSE THE PIPE ENTIRELY, and the refusal said why: the judging
//half was not ported, so staleness could not be checked, and a gate ported at
//two thirds reads as the whole one. It is ported now — `judgementVerdict`
//records a verdict and `judgementsFor` answers what is current — so the blanket
//refusal is gone and the real check is here.
//
//WHAT A UNIT TEST CAN HOLD IT TO. The gate needs the branch names a judge could
//have read, which are not known until the line is resolved — so against a bare
//app with no lines it is the LINE that is missing, not the judgement, and that
//is the honest answer. What this pins is the half that matters either way:
//NOTHING IS PUSHED BEFORE THE REFUSAL, whichever refusal it is. The three-part
//check itself is drilled against real lines and real judgements in
//09-judging/06-nothing-goes-out-unjudged.
//---------------------------------------------------------------------------

test('a change is not sent out down the pipe before it has been read', async () => {
    const { actions, pushes } = await anApp();

    await assert.rejects(
        () => actions.call('prCutMake', { source: 'a', target: 'b', title: 't', _overTheWire: true }),
        /There is no line called/);

    //THE ONE THAT MATTERS. Whatever the sentence, nothing left this host: the
    //gate and every check before it run before the first push.
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

//---------------------------------------------------------------------------
//AND MERGED IS THE ONE ANSWER WORTH WRITING DOWN.
//
//GitHub will not reopen a merged pull request, so asking a second time can only
//ever be told the same thing. Twenty-six of the twenty-six cuts on the host this
//was written against are merged, and re-reading all of them is what made this
//pane take twenty-three seconds.
//
//THE CHECK IS THAT IT IS NOT ASKED TWICE, which is the only claim that matters
//here — the ANSWER was already right when it asked every time.
//---------------------------------------------------------------------------
test('a pull request that has merged is asked about once and then never again', async () => {
    const { actions, asked } = await anApp({
        landings: { 'a -> b': { source: 'a', target: 'b', pulls: [{ repo: 'one', number: 1, into: 'anowner/one' }] } },
        answers: {
            'GET /repos/anowner/one/pulls/1': {
                status: 200,
                body: { number: 1, state: 'closed', merged_at: '2026-08-01T00:00:00Z', html_url: 'u' }
            }
        }
    });

    const first = (await actions.call('prCuts', {})).cuts[0];
    assert.equal(first.pulls[0].state, 'merged');
    const afterOne = asked.filter((a) => a.at.includes('/pulls/1')).length;
    assert.equal(afterOne, 1, 'the first read did not ask GitHub at all');

    //THE SECOND LOAD OF THE SAME PANE.
    const again = (await actions.call('prCuts', {})).cuts[0];
    assert.equal(asked.filter((a) => a.at.includes('/pulls/1')).length, 1,
        'it asked GitHub again about a pull request that cannot stop being merged');

    //AND IT STILL SAYS THE SAME THING, which is the half that would make this
    //a saving rather than a bug.
    assert.equal(again.pulls[0].state, 'merged');
    assert.equal(again.pulls[0].mergedAt, '2026-08-01T00:00:00Z');
    assert.equal(again.landed, true);
    assert.equal(again.merged, 1);
});

//THE OPPOSITE, AND IT IS THE DIRECTION THE APP BEING PORTED FROM WAS BURNED IN.
//A closed pull request CAN be reopened and an open one can become anything, so
//neither may be written off. The record there was written when a cut was made
//and never refreshed, so every cut read "open" for ever and a sweep once
//reported fifteen outstanding pull requests that had all been merged days
//earlier.
test('an open or closed pull request is asked about every single time', async () => {
    for (const state of ['open', 'closed']) {
        const { actions, asked } = await anApp({
            landings: { 'a -> b': { source: 'a', target: 'b', pulls: [{ repo: 'one', number: 1, into: 'anowner/one' }] } },
            answers: {
                'GET /repos/anowner/one/pulls/1': { status: 200, body: { number: 1, state: state, merged_at: null, html_url: 'u' } }
            }
        });

        await actions.call('prCuts', {});
        await actions.call('prCuts', {});
        assert.equal(asked.filter((a) => a.at.includes('/pulls/1')).length, 2,
            'a ' + state + ' pull request was written off as settled — it can still change, and nothing would notice');
    }
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

//---------------------------------------------------------------------------
//5. A DRAFT CAN BE THROWN AWAY, AND WHAT IS STILL OUT IS AT THE TOP.
//
//The app being ported from can do both and this could do neither. Text written
//for a pair of lines could be replaced and never removed, so a draft whose
//branch no longer carried anything sat on the list as outstanding work with no
//way off it except doing the thing it was asking for. And the list was sorted by
//date alone, which put thirty finished cuts above the one still in flight.
//---------------------------------------------------------------------------

test('a draft can be thrown away, and the sentence says nothing on GitHub changed', async () => {
    const { actions } = await anApp();
    await actions.call('prDraftSave', { source: 'a', target: 'b', title: 't', body: 'x' });

    const gone = await actions.call('prDraftForget', { source: 'a', target: 'b' });
    assert.equal(gone.forgotten, 'a -> b');
    assert.match(gone.note, /Thrown away/);
    //NOTHING WAS SENT, so nothing anywhere else moved — and this is the moment
    //to say so, beside a pane whose other buttons all reach GitHub.
    assert.match(gone.note, /nothing there changed/);
    assert.equal((await actions.call('prDrafts', {})).drafts.length, 0);
});

//"THERE WAS NONE" IS NOT "THROWN AWAY". Both leave nothing behind, and only one
//of them means something was removed.
test('throwing away a draft that is not there says so, and names the pair', async () => {
    const { actions } = await anApp();
    const said = await actions.call('prDraftForget', { source: 'a', target: 'b' });
    assert.equal(said.forgotten, null);
    assert.match(said.note, /There was none/);
    assert.match(said.note, /"a" into "b"/);
    await assert.rejects(() => actions.call('prDraftForget', { source: 'a' }), /Say which two lines/);
});

test('a draft whose pair has already been cut is not still waiting to be sent', async () => {
    const { actions } = await anApp({
        landings: { 'a -> b': { source: 'a', target: 'b', opened: '2026-01-01T00:00:00Z', pulls: [] } }
    });

    //WRITTEN FOR THAT CUT, and the cut exists. Listing it again as "not sent" is
    //asking for the same thing twice, and the copy is the one that reads as
    //something still to do.
    await actions.call('prDraftSave', { source: 'a', target: 'b', title: 't', body: 'x' });
    await actions.call('prDraftSave', { source: 'c', target: 'b', title: 'other', body: 'y' });

    const said = await actions.call('prCuts', {});
    assert.deepEqual(said.drafts.map((d) => d.source), ['c'],
        'a draft for a pair that has been cut is still being listed as waiting');

    //AND `prDrafts` STILL HAS BOTH. It answers what is written, which is a
    //different question from what is outstanding — the writer pane reads it to
    //find the text for a pair it is editing.
    assert.equal((await actions.call('prDrafts', {})).drafts.length, 2);
});

test('what has not landed is above what has, whatever the dates say', async () => {
    const { actions } = await anApp({
        landings: {
            'old-out -> b': {
                source: 'old-out', target: 'b', opened: '2026-01-01T00:00:00Z',
                pulls: [{ repo: 'one', number: 1, into: 'anowner/one' }]
            },
            'new-landed -> b': {
                source: 'new-landed', target: 'b', opened: '2026-09-09T00:00:00Z',
                pulls: [{ repo: 'one', number: 2, into: 'anowner/one', mergedAt: '2026-09-09T01:00:00Z' }]
            }
        },
        answers: {
            'GET /repos/anowner/one/pulls/1': {
                status: 200,
                body: { number: 1, state: 'open', title: 'still out', updated_at: '2026-01-02T00:00:00Z' }
            }
        }
    });

    const said = await actions.call('prCuts', {});
    assert.deepEqual(said.cuts.map((c) => c.source), ['old-out', 'new-landed'],
        'the finished one sorted above the one still in flight, which is the wall of green this fixed');

    //AND WHEN IT LAST MOVED CAME BACK WITH IT. The detail panel has always drawn
    //a "last touched" row and never had a value for it: the field was read off a
    //shape that did not carry it, so the row simply never appeared.
    assert.equal(said.cuts[0].pulls[0].updated, '2026-01-02T00:00:00Z');
});

//---------------------------------------------------------------------------
//6. CHANGING WHAT IS ALREADY OUT.
//
//`prCutUpdate` is the reason a cut is a thing rather than three pull requests:
//GitHub has no idea they are one change, so keeping their text and their state
//in step is this app's job. It had one test, and that test was about the pipe
//being refused — nothing held it to what it does when it is allowed.
//---------------------------------------------------------------------------

const CUT_OUT = {
    'a -> b': {
        source: 'a', target: 'b', opened: '2026-01-01T00:00:00Z',
        pulls: [
            { repo: 'one', number: 1, into: 'anowner/one' },
            { repo: 'two', number: 2, into: 'anowner/two' }
        ]
    }
};

test('one title and one description are written to every pull request in the cut', async () => {
    const { actions, asked } = await anApp({
        landings: CUT_OUT,
        answers: {
            'PATCH /repos/anowner/one/pulls/1': { status: 200, body: { number: 1 } },
            'PATCH /repos/anowner/two/pulls/2': { status: 200, body: { number: 2 } }
        }
    });

    const said = await actions.call('prCutUpdate', { source: 'a', target: 'b', title: 'one sentence', body: 'the rest' });
    assert.equal(said.changed, 2);
    assert.match(said.note, /2 of 2 changed/);

    //BOTH OF THEM, AND EACH WHERE IT ACTUALLY LIVES. A cut spans repositories,
    //so a loop that used one address for all of them would edit one pull request
    //twice and report two.
    const patched = asked.filter((x) => x.method === 'PATCH').map((x) => x.at);
    assert.deepEqual(patched.sort(), ['/repos/anowner/one/pulls/1', '/repos/anowner/two/pulls/2']);

    //AND WHAT WAS SAID IS KEPT, so the next thing that composes a body starts
    //from what is on the pull requests rather than from what was typed once.
    const kept = (await actions.call('prCuts', {})).cuts.find((c) => c.source === 'a');
    assert.equal(kept.said.title, 'one sentence');
});

//ONE OF THEM FAILING IS THE CASE THIS EXISTS FOR. A cut half-edited is exactly
//the drift a cut is meant to prevent, so the answer names which one and why.
test('a pull request that refuses the change is named, and the others still go', async () => {
    const { actions } = await anApp({
        landings: CUT_OUT,
        answers: {
            'PATCH /repos/anowner/one/pulls/1': { status: 200, body: { number: 1 } },
            'PATCH /repos/anowner/two/pulls/2': { status: 403, body: { message: 'Resource not accessible by integration' } }
        }
    });

    const said = await actions.call('prCutUpdate', { source: 'a', target: 'b', title: 't' });
    assert.equal(said.changed, 1);
    assert.match(said.note, /1 of 2 changed/);
    assert.match(said.note, /two #2/);
    assert.match(said.note, /not accessible/);
});

test('closing a cut closes every pull request in it, and only "open" or "closed" is a state', async () => {
    const { actions, asked } = await anApp({
        landings: CUT_OUT,
        answers: {
            'PATCH /repos/anowner/one/pulls/1': { status: 200, body: { number: 1 } },
            'PATCH /repos/anowner/two/pulls/2': { status: 200, body: { number: 2 } }
        }
    });

    await actions.call('prCutUpdate', { source: 'a', target: 'b', state: 'closed' });
    const shut = asked.filter((x) => x.method === 'PATCH');
    assert.equal(shut.length, 2);
    assert.ok(shut.every((x) => x.body && x.body.state === 'closed'),
        'a state was sent that is not the one asked for');

    //REFUSED BEFORE ANYTHING IS SENT. A word GitHub does not know reached it as
    //a change to somebody's repository and came back as a 422 naming a field
    //rather than the word that was wrong — once per repository.
    const before = asked.length;
    await assert.rejects(
        () => actions.call('prCutUpdate', { source: 'a', target: 'b', state: 'merged' }),
        /"open" or "closed"/);
    assert.equal(asked.length, before, 'it asked GitHub something before refusing the state');

    await assert.rejects(
        () => actions.call('prCutUpdate', { source: 'a', target: 'b' }),
        /Say what to change/);
});

//---------------------------------------------------------------------------
//7. THE READS THAT NOTHING HELD.
//
//`prCutState`, `prDraft` and `prTemplate` had no test at all. None of them
//changes anything, which is exactly why they went unnoticed: a read that answers
//the wrong thing is silent, and every one of these is what a pane draws from.
//---------------------------------------------------------------------------

test('what became of one cut is asked per pull request, where each one lives', async () => {
    const { actions } = await anApp({
        landings: CUT_OUT,
        answers: {
            'GET /repos/anowner/one/pulls/1': { status: 200, body: { number: 1, state: 'open', title: 'still out' } },
            'GET /repos/anowner/two/pulls/2': {
                status: 200,
                body: { number: 2, state: 'closed', merged_at: '2026-02-02T00:00:00Z', title: 'in' }
            }
        }
    });

    const said = await actions.call('prCutState', { source: 'a', target: 'b' });
    assert.equal(said.landed, false, 'one of two merged is not landed');
    assert.equal(said.merged, 1);
    assert.equal(said.of, 2);
    assert.equal(said.partly, true, 'half a landing is the state this app exists to make visible');
    assert.equal(said.pulls.find((p) => p.repo === 'two').state, 'merged',
        'GitHub reports a merged pull request as closed, and reading that alone turns a landing into a rejection');
});

test('a pair with nothing written says so rather than answering with a blank draft', async () => {
    const { actions } = await anApp();
    const empty = await actions.call('prDraft', { source: 'a', target: 'b' });
    assert.equal(empty.draft, null);
    assert.match(empty.note, /Nothing written/);

    await actions.call('prDraftSave', { source: 'a', target: 'b', title: 't', body: 'x' });
    const one = await actions.call('prDraft', { source: 'a', target: 'b' });
    assert.equal(one.draft.title, 't');
    assert.equal(one.note, null, 'a pair that HAS text should not also carry a sentence saying it has none');

    await assert.rejects(() => actions.call('prDraft', { source: 'a' }), /Say which two lines/);
});

test('the template says which blocks are on, and that is what gets added', async () => {
    const { actions } = await anApp();
    const said = await actions.call('prTemplate', {});
    assert.ok(said.blocks.length >= 3, 'only ' + said.blocks.length + ' block(s) — the scan is broken, not the template');
    assert.ok(said.blocks.every((b) => b.id && b.label), 'a block with no id or label cannot be switched on by name');

    //THE SENTENCE COUNTS WHAT IS ON, and it is the only thing on the pane that
    //says a pull request will not be only what somebody typed.
    const on = said.blocks.filter((b) => b.on).length;
    assert.match(said.note, on ? new RegExp(on + ' of ' + said.blocks.length) : /What is typed is what is sent/);
});

//---------------------------------------------------------------------------
//AND WHAT IS OUT AND WAITING ON SOMEBODY.
//
//THIS PLUGIN PUT NOTHING IN THE INBOX AT ALL, and that is how three pull
//requests sat open with nothing anywhere saying so. They were found by reading
//`prCutState` by hand, after somebody asked why the dashboard had not mentioned
//them — and the answer was that it had no source for it.
//
//A CHANGE THAT IS OUT IS WAITING ON A PERSON BY DEFINITION: by this app's own
//rule a person presses merge. So it belongs on the list of what is waiting, from
//the moment it opens until it lands.
//---------------------------------------------------------------------------

const OUT = {
    'a -> b': {
        source: 'a', target: 'b', opened: '2026-08-26T10:00:00.000Z',
        pulls: [
            { repo: 'one', number: 7, into: 'anowner/one', base: 'master' },
            { repo: 'two', number: 9, into: 'anowner/two', base: 'version2' }
        ]
    }
};

test('a change that is out and not merged is waiting on somebody', async () => {
    const { sources } = await anApp({
        landings: OUT,
        answers: {
            'GET /repos/anowner/one/pulls/7': { status: 200, body: { number: 7, state: 'open', merged_at: null, base: { ref: 'master' }, head: { ref: 'a' } } },
            'GET /repos/anowner/two/pulls/9': { status: 200, body: { number: 9, state: 'open', merged_at: null, base: { ref: 'version2' }, head: { ref: 'a' } } }
        }
    });

    const source = sources.find((s) => /out and not merged/.test(s.name));
    assert.ok(source, 'this plugin registers nothing with the inbox, so nothing it knows about ever reaches the list');

    const waiting = await source.waiting();
    assert.equal(waiting.length, 1, 'one cut is open and it raised ' + waiting.length + ' item(s)');
    assert.equal(waiting[0].kind, 'change out and not merged');
    assert.equal(waiting[0].which, 'a into b');

    //NAMED BY OWNER AND REPOSITORY, which is the whole point. In a workspace of
    //forks OF forks, "one #7" says nothing — "#7 on which one, and into what?"
    //is a real question somebody asked about a real pull request.
    assert.match(waiting[0].why, /anowner\/one#7 → master/);
    assert.match(waiting[0].why, /anowner\/two#9 → version2/);

    //AND IT LANDS ON THE CUT, not on a list to go and find it in.
    assert.deepEqual(waiting[0].where, { tab: 'Repositories', pane: 'PR cuts', pick: 'a' });
});

test('and one that has landed is not waiting on anybody', async () => {
    const { sources } = await anApp({
        landings: OUT,
        answers: {
            'GET /repos/anowner/one/pulls/7': { status: 200, body: { number: 7, state: 'closed', merged_at: '2026-08-26T11:00:00.000Z' } },
            'GET /repos/anowner/two/pulls/9': { status: 200, body: { number: 9, state: 'closed', merged_at: '2026-08-26T11:00:00.000Z' } }
        }
    });

    const source = sources.find((s) => /out and not merged/.test(s.name));
    assert.deepEqual(await source.waiting(), [], 'a change that landed is still being nagged about');
});

test('and one that was closed unmerged is a decision, not an errand', async () => {
    //SOMEBODY ALREADY DECIDED. Nagging about a pull request that was closed on
    //purpose is nagging about a decision that has been made — which is how a
    //list of what is waiting stops being read.
    const { sources } = await anApp({
        landings: OUT,
        answers: {
            'GET /repos/anowner/one/pulls/7': { status: 200, body: { number: 7, state: 'closed', merged_at: null } },
            'GET /repos/anowner/two/pulls/9': { status: 200, body: { number: 9, state: 'closed', merged_at: null } }
        }
    });

    const source = sources.find((s) => /out and not merged/.test(s.name));
    assert.deepEqual(await source.waiting(), [], 'a cut everything was closed on is still on the list');
});
