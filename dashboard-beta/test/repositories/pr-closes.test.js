const { test } = require('node:test');
const assert = require('node:assert');

const plugin = require('../../src/app/repositories/pr/server');

//---------------------------------------------------------------------------
//THE PULL REQUEST SAYS WHICH ISSUE IT CLOSES.
//
//"Closes owner/repo#N" is GitHub's keyword and what it does is GitHub's: the
//issue closes when the pull request merges. Nothing here closes anything -- the
//whole point is that the fact goes where GitHub keeps it, and the maintainer's
//merge does the rest.
//
//AND IT IS THE ONE BLOCK THAT IS ON BY DEFAULT. The others publish this app's
//internal notes and are rightly off; this publishes GitHub's own fact about
//GitHub's own object, which the person who tagged the issue asked for.
//---------------------------------------------------------------------------

//THE SAME STAND-IN ./pr-template-preview.test.js USES, except that branchBoard
//can answer with a cut note -- which is the carrier this whole file is about,
//and which that harness returns empty.
function aPr(over) {
    const o = over || {};
    const did = { github: [] };
    const defined = new Map();
    const lines = o.lines || [
        { name: 'fix/thing', on: [{ repo: 'repo-one', branch: 'fix/thing', stillHere: true, there: true }] },
        { name: 'default', on: [{ repo: 'repo-one', branch: 'master', stillHere: true, there: true }] }
    ];
    const docs = {};
    function doc(name) {
        if (!docs[name]) {
            let kept = null;
            docs[name] = { read: (f) => (kept === null ? f : kept), write: (v) => { kept = v; return v; } };
        }
        return docs[name];
    }
    return {
        did, defined, doc,
        imports: {
            app: {
                host: {
                    actions: {
                        define: (name, spec) => { defined.set(name, spec); return () => {}; },
                        whoAsked: () => 'a test',
                        call: async (what) => {
                            if (what === 'lines') return { lines };
                            if (what === 'repositories') return { repos: o.repos || [] };
                            if (what === 'branchBoard') return { branches: o.branches || [] };
                            return null;
                        }
                    }
                }
            },
            log: { on: () => ({ good() {}, warn() {}, bad() {}, info() {} }) },
            git: {
                commits: async () => [{ sha: 'aaaaaaa', subject: 'the change' }],
                push: async () => ({ pushed: true })
            },
            github: {
                call: async (method, path, body) => { did.github.push({ method, path, body }); return { status: 200, body: {} }; }
            },
            keys: { github: { envForPush: () => ({}), credentialHelper: null } },
            workspace: { dir: async () => 'C:/work', repos: async () => [{ name: 'repo-one' }] },
            state: { here: { doc: (n) => doc(n) } },
            settings: { read: () => ({}) },
            refs: {
                origin: async () => ({ url: 'https://github.com/me/repo-one', owner: 'me', repo: 'repo-one', kind: 'github' }),
                heads: async () => ({})
            }
        }
    };
}

async function loaded(over) {
    const w = aPr(over);
    let service = null;
    await plugin(w.imports, async (_e, s) => { service = s; });
    w.prcuts = service.prcuts;
    w.set = w.defined.get('prTemplateSet');
    w.preview = w.defined.get('prTemplatePreview');
    return w;
}

const NOTE = { reason: 'the header wraps', issue: { on: 'someone/their-repo', number: 17 } };

test('a cut that knows its issue composes a Closes line, fully qualified', async () => {
    const w = await loaded({});
    const body = await w.prcuts.compose('what I typed', { note: NOTE, repos: ['repo-one'], me: 'repo-one', pulls: [] });
    //FULLY QUALIFIED, ALWAYS. A bare #17 means "this repository", and a pull
    //request into a fork or across a chain is not on the repository the issue
    //lives on.
    assert.match(body, /Closes someone\/their-repo#17/);
    //AND UNDER WHAT WAS TYPED, never over it.
    assert.ok(body.indexOf('what I typed') < body.indexOf('Closes'));
});

test('a cut with no issue says nothing at all', async () => {
    const w = await loaded({});
    const body = await w.prcuts.compose('typed', { note: { reason: 'r' }, repos: ['repo-one'], me: 'repo-one', pulls: [] });
    assert.equal(body, 'typed');
    const none = await w.prcuts.compose('typed', { note: null, repos: ['repo-one'], me: 'repo-one', pulls: [] });
    assert.equal(none, 'typed');
});

test('it is on by default and every other block is off', async () => {
    //THE SABOTAGE THIS FILE EXISTS FOR. Flip the default and the drills record
    //the failure: the issue stays open through the merge and is closed by hand.
    const w = await loaded({});
    const blocks = await w.prcuts.blocks();
    const closes = blocks.filter((b) => b.id === 'closes')[0];
    assert.ok(closes, 'there is no closes block');
    assert.equal(closes.on, true, 'the closes block is off by default');
    blocks.filter((b) => b.id !== 'closes').forEach((b) => {
        assert.equal(b.on, false, b.id + ' is on by default, and it publishes internal notes');
    });
});

test('a person may switch it off, and an explicit off beats the default', async () => {
    const w = await loaded({});
    await w.set.run({ id: 'closes', on: false });
    assert.equal((await w.prcuts.blocks()).filter((b) => b.id === 'closes')[0].on, false);
    const body = await w.prcuts.compose('typed', { note: NOTE, repos: ['repo-one'], me: 'repo-one', pulls: [] });
    assert.equal(body, 'typed', 'the block wrote itself after being switched off');
    //AND BACK ON.
    await w.set.run({ id: 'closes', on: true });
    assert.match(await w.prcuts.compose('', { note: NOTE, repos: ['repo-one'], me: 'repo-one', pulls: [] }), /Closes/);
});

test('the preview carries the cut note, so what is shown is what will go out', async () => {
    //THE GAP: the preview composed without `note`, so reason, cutfrom and
    //commits previewed blank and appeared only on the real pull request -- the
    //one place a surprise is expensive. A Closes line that a person did not
    //see before pressing send is exactly that surprise.
    const w = await loaded({
        branches: [{ name: 'fix/thing', note: NOTE, on: [{ repo: 'repo-one', commits: [] }] }]
    });
    const said = await w.preview.run({ source: 'fix/thing', target: 'default' });
    assert.match(said.additions || '', /Closes someone\/their-repo#17/, 'the preview did not show the Closes line');
    assert.match(said.text || '', /Closes someone\/their-repo#17/);
});

test('a malformed issue on a note writes nothing rather than nonsense', async () => {
    const w = await loaded({});
    for (const bad of [{ on: 'a/b' }, { number: 3 }, { on: 'a/b', number: 0 }, 'a/b#3']) {
        const body = await w.prcuts.compose('t', { note: { issue: bad }, repos: ['repo-one'], me: 'repo-one', pulls: [] });
        assert.equal(body, 't', 'wrote a Closes line from ' + JSON.stringify(bad));
    }
});
