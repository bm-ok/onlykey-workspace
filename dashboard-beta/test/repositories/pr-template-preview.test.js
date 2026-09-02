const { test } = require('node:test');
const assert = require('node:assert');

const plugin = require('../../src/app/repositories/pr/server');

//---------------------------------------------------------------------------
//WHAT WOULD ACTUALLY GO OUT.
//
//THE LAST THING BETWEEN WRITING A PULL REQUEST AND PUBLISHING IT. What a draft
//stores is what somebody typed; what reaches GitHub is that with every template
//block on this host appended under it, into a repository this host does not own.
//Those are not the same text and not obviously the same address.
//
//SO THE TWO THINGS ASSERTED HARDEST ARE: it publishes nothing, and it does not
//GUESS. A preview's whole job is being believed, so a number it invented or an
//address it assumed would be worse than no preview at all.
//---------------------------------------------------------------------------

function aPr(over) {
    const o = over || {};
    const did = { github: [] };
    const defined = new Map();

    //TWO LINES AND WHAT EACH REPOSITORY IS ON. `carrying` reads these through
    //the action table, which is where they still come from.
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
                            if (what === 'branchBoard') return { branches: [] };
                            return null;
                        }
                    }
                }
            },
            log: { on: () => ({ good() {}, warn() {}, bad() {}, info() {} }) },
            git: {
                //AHEAD BY SOMETHING, or the pair carries nothing and there is no
                //pull request to preview.
                commits: async () => (o.ahead === undefined ? [{ sha: 'aaaaaaa', subject: 'the change' }] : o.ahead),
                push: async () => ({ pushed: true })
            },
            github: {
                call: async (method, path, body) => {
                    did.github.push({ method, path, body });
                    return { status: 200, body: {} };
                }
            },
            keys: { github: { envForPush: () => ({}), credentialHelper: null } },
            workspace: { dir: async () => 'C:/work', repos: async () => [{ name: 'repo-one' }] },
            state: { here: { doc: (n) => doc(n) } },
            settings: { read: () => ({}) },
            refs: {
                origin: async () => (o.origin === undefined
                    ? { url: 'https://github.com/me/repo-one', owner: 'me', repo: 'repo-one', kind: 'github' }
                    : o.origin),
                heads: async () => ({})
            }
        }
    };
}

async function loaded(over) {
    const w = aPr(over);
    let service = null;
    await plugin(w.imports, async (_e, s) => { service = s; });
    w.preview = w.defined.get('prTemplatePreview');
    assert.ok(w.preview, 'prTemplatePreview is not defined');
    w.service = service;
    return w;
}

//---------------------------------------------------------------------------
//IT PUBLISHES NOTHING.
//---------------------------------------------------------------------------

test('composing a preview never posts anything', async () => {
    //WHICH IS WHY IT IS ALLOWED OVER THE WIRE WHEN `prCutMake` IS NOT. Reading
    //what a press would do is not the press.
    const w = await loaded({});
    await w.preview.run({ source: 'fix/thing', target: 'default', _overTheWire: true });

    const posts = w.did.github.filter((c) => c.method === 'POST');
    assert.deepEqual(posts, [], 'a preview posted to GitHub');
});

//---------------------------------------------------------------------------
//CARRYING NOTHING IS AN ANSWER.
//---------------------------------------------------------------------------

test('a pair that carries nothing is a sentence, not a refusal', async () => {
    //THE ORDINARY STATE OF A PAIR SOMEBODY IS STILL WORKING ON. Drawn as prose;
    //throwing here would put an error on a pane for a normal condition.
    const w = await loaded({ ahead: [] });
    const said = await w.preview.run({ source: 'fix/thing', target: 'default' });

    assert.deepEqual(said.repos, []);
    assert.equal(said.text, '');
    assert.match(said.note, /carries nothing/);
});

test('a line nobody has named is refused, because that is a mistake', async () => {
    const w = await loaded({});
    await assert.rejects(() => w.preview.run({ source: 'no-such-line', target: 'default' }),
        /There is no line called "no-such-line"/);
});

//---------------------------------------------------------------------------
//WHERE IT WOULD GO.
//---------------------------------------------------------------------------

test('it names the whole address on both sides, not just how many repositories', async () => {
    //"HOW MANY" AND "INTO WHOSE" ARE DIFFERENT QUESTIONS and only one of them is
    //worth asking before pressing a button that publishes. Two forks can differ
    //by one character in the middle of a word.
    const w = await loaded({
        repos: [{ repo: 'repo-one', target: { on: 'someone-else/repo-one' } }]
    });
    const said = await w.preview.run({ source: 'fix/thing', target: 'default' });

    assert.equal(said.where.length, 1);
    assert.equal(said.where[0].from, 'me/repo-one');
    assert.equal(said.where[0].into, 'someone-else/repo-one');
    assert.equal(said.where[0].crossing, true);
    assert.match(said.where[0].fromUrl, /github\.com\/me\/repo-one/);
    assert.match(said.where[0].intoUrl, /github\.com\/someone-else\/repo-one/);
});

//THE PREVIEW SHOWS THE NOTHING THE CUT WOULD REFUSE ON.
//
//It used to draw this host's own remote as the destination when nobody had
//picked one -- the same fallback the pane drew as a ticked radio while calling
//itself "not picked". A preview that shows a pull request landing somewhere the
//press would refuse is worse than no preview, because its whole job is being
//believed.
test('with nothing picked there is no destination, and it says which nothing it is', async () => {
    const w = await loaded({ repos: [{ repo: 'repo-one' }] });
    const said = await w.preview.run({ source: 'fix/thing', target: 'default' });

    assert.equal(said.where[0].into, null, 'a destination nobody picked was drawn as the destination');
    assert.equal(said.where[0].crossing, false);
    assert.match(said.where[0].intoWhy, /nothing has been picked/);

    //AND IT NO LONGER SENDS ANYBODY ANYWHERE. This ended "Repositories → Repos
    //→ Where work goes", which is the pane stopping somebody at the exact
    //moment it could have helped — see `couldBe` below, which is what it
    //offers instead.
    assert.ok(!/Repositories/.test(said.where[0].intoWhy), 'it still names a tab to go to');
});

//---------------------------------------------------------------------------
//AND WHAT COULD BE PICKED, SO THE PANE CAN OFFER IT RATHER THAN NAME A TAB.
//
//The app knows both answers already: the remote this repository was cloned
//from, and the fork it was forked FROM. They are a real choice and not a
//default — one keeps the work yours, the other reaches a repository somebody
//else owns — so both are handed over and neither is chosen here.
//---------------------------------------------------------------------------

test('a repository with nowhere to open is told what it could open on', async () => {
    const w = await loaded({ repos: [{ repo: 'repo-one', parent: 'upstream/repo-one' }] });
    const said = await w.preview.run({ source: 'fix/thing', target: 'default' });

    assert.deepEqual(said.where[0].couldBe, { self: 'me/repo-one', parent: 'upstream/repo-one' });
});

test('one that is not a fork has a single answer', async () => {
    //AND THEN THE PANE IS ONE PRESS. `parent` is null for anything nobody
    //forked, which is the case that prompted this: a repository whose sibling
    //was set to exactly its own remote, blocked on a choice with one option.
    const w = await loaded({ repos: [{ repo: 'repo-one' }] });
    const said = await w.preview.run({ source: 'fix/thing', target: 'default' });

    assert.deepEqual(said.where[0].couldBe, { self: 'me/repo-one', parent: null });
});

test('a repository that already has one is not offered alternatives to it', async () => {
    //`couldBe` IS STILL ANSWERED, because the pane only reads it when there is
    //no destination — but nothing here should read as a suggestion to change a
    //choice somebody has made.
    const w = await loaded({ repos: [{ repo: 'repo-one', target: { on: 'someone-else/repo-one' } }] });
    const said = await w.preview.run({ source: 'fix/thing', target: 'default' });

    assert.equal(said.where[0].into, 'someone-else/repo-one');
    assert.equal(said.where[0].intoWhy, null, 'it explained a destination that is set');
});

test('and one set to send nowhere says that instead', async () => {
    const w = await loaded({ repos: [{ repo: 'repo-one', target: { off: true } }] });
    const said = await w.preview.run({ source: 'fix/thing', target: 'default' });

    assert.equal(said.where[0].into, null);
    assert.match(said.where[0].intoWhy, /nowhere/);
});

test('the target comes from the repository record, never from the git remote', async () => {
    //THE FAILURE THIS IS WRITTEN AGAINST: `git.origin` answers
    //{ url, owner, repo, kind } and has no idea a fork has a parent. A preview
    //reading a `parent` off it would show every pull request going into the fork
    //it came from — which is what `openOne` calls the worst shape a bug can have
    //here, because it looks normal and lands the work where nobody is watching.
    //
    //A `parent` IS PLANTED ON THE REMOTE AND MUST BE IGNORED.
    const w = await loaded({
        origin: { url: 'https://github.com/me/repo-one', owner: 'me', repo: 'repo-one', kind: 'github', parent: 'wrong/place' },
        repos: [{ repo: 'repo-one', target: { on: 'right/place' } }]
    });
    const said = await w.preview.run({ source: 'fix/thing', target: 'default' });

    assert.equal(said.where[0].into, 'right/place');
    assert.notEqual(said.where[0].into, 'wrong/place');
});

//---------------------------------------------------------------------------
//AND IT DOES NOT INVENT NUMBERS.
//---------------------------------------------------------------------------

test('before anything is cut the links show ?, and it says it is guessing', async () => {
    const w = await loaded({});
    const said = await w.preview.run({ source: 'fix/thing', target: 'default' });

    assert.equal(said.guessing, true);
    assert.equal(said.existing, null);
    assert.match(said.note, /Nothing is cut yet/);
});

test('once a cut exists the real numbers are used', async () => {
    const w = await loaded({});
    //THE RECORD AS THE CUT WRITES IT, put where the action reads it.
    w.doc('landings').write({
        'fix/thing -> default': {
            source: 'fix/thing', target: 'default', opened: '2026-01-01T00:00:00.000Z',
            said: { title: 'a title somebody wrote' },
            pulls: [{ repo: 'repo-one', number: 7, url: 'https://github.com/x/y/pull/7' }]
        }
    });

    const said = await w.preview.run({ source: 'fix/thing', target: 'default' });
    assert.equal(said.guessing, false);
    assert.equal(said.existing.count, 1);
    assert.match(said.note, /real pull request numbers/);
    //AND THE TITLE ALREADY WRITTEN, rather than the line's name.
    assert.equal(said.title, 'a title somebody wrote');
});

//---------------------------------------------------------------------------
//WHAT IS TYPED, AND WHAT IS ADDED TO IT.
//---------------------------------------------------------------------------

test('the typed body comes first and is never rearranged', async () => {
    //A PERSON'S OWN WORDS ARE NOT WRAPPED OR REORDERED. Everything composed is
    //appended under them.
    const w = await loaded({});
    w.doc('pr-template').write({ origin: true });

    const said = await w.preview.run({
        source: 'fix/thing', target: 'default', body: 'Here is what this does.'
    });

    assert.ok(said.text.startsWith('Here is what this does.'),
        'the typed body was not first: ' + JSON.stringify(said.text.slice(0, 60)));
    assert.match(said.text, /Opened by the dashboard/);
});

test('the additions are given separately, so typing does not need another ask', async () => {
    //WHAT THE BLOCKS ADD DEPENDS ON THE PAIR AND ON WHICH COPY — never on what
    //is typed — so it is fetched once and the sentence in front of it is joined
    //on locally as somebody types.
    const w = await loaded({});
    w.doc('pr-template').write({ origin: true });

    const said = await w.preview.run({ source: 'fix/thing', target: 'default', body: 'Typed.' });

    assert.doesNotMatch(said.additions, /Typed\./);
    assert.match(said.additions, /Opened by the dashboard/);
});

test('with every block off, what is sent is exactly what was typed', async () => {
    //EVERY BLOCK IS OFF UNTIL SOMEBODY TURNS IT ON, because a template that
    //arrives switched on writes somebody's internal notes into a public
    //repository the first time they press the button.
    const w = await loaded({});
    const said = await w.preview.run({ source: 'fix/thing', target: 'default', body: 'Just this.' });

    assert.equal(said.text, 'Just this.');
    assert.equal(said.additions, '');
});
