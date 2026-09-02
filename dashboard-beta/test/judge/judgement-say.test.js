const { test } = require('node:test');
const assert = require('node:assert');

const plugin = require('../../src/app/judge/server');

//---------------------------------------------------------------------------
//SAYING A JUDGEMENT OUT LOUD, ON SOMEBODY ELSE'S PULL REQUEST.
//
//THE ONLY THING IN THIS APP THAT PUBLISHES UNDER A PERSON'S NAME TO A
//REPOSITORY THAT IS NOT THEIRS. A comment cannot be unsent — an edit leaves the
//original in the history and the notification has already gone — so every
//assertion below is about one of the two things that keeps that safe: it is
//READ FIRST, and it is a PERSON who presses it.
//
//WHAT IS DELIBERATELY NOT TESTED AGAINST GITHUB: the posting call itself is
//stubbed. Proving it end to end means publishing a real comment on a real pull
//request, which is exactly the act this file exists to keep behind a person.
//---------------------------------------------------------------------------

const REVIEW = [
    '# What I read',
    '',
    'The change adds a null check and nothing else. It does what the brief asked.',
    '',
    '## What I could not check',
    '',
    'Nothing here exercises the Windows path. I did not run the suite.',
    '',
    'RECOMMENDATION: accept',
    ''
].join('\n');

function aJudge(over) {
    const o = over || {};
    const did = { posted: [], updated: [] };
    const defined = new Map();

    const one = Object.assign({
        id: 'j-1', uid: 'u-1', number: 3, ref: 'J3', state: 'done',
        subject: { kind: 'pull', on: 'someone/their-repo', number: 42, sha: 'abcdef1234567890', name: 'their-repo#42' }
    }, o.judgement || {});

    const files = o.files === undefined ? [{ file: 'REVIEW.md', bytes: REVIEW.length }] : o.files;
    const bodies = o.bodies === undefined ? { 'REVIEW.md': REVIEW } : o.bodies;

    return {
        did, defined, one,
        imports: {
            app: {
                host: {
                    actions: {
                        define: (name, spec) => { defined.set(name, spec); return () => {}; },
                        call: async (what) => {
                            if (what === 'repositories') {
                                return {
                                    repos: o.repos || [{
                                        repo: 'their-repo',
                                        issuesOn: 'someone/their-repo',
                                        target: { on: 'someone/their-repo' }
                                    }]
                                };
                            }
                            return null;
                        }
                    }
                }
            },
            log: { on: () => ({ good() {}, warn() {}, bad() {}, info() {} }) },
            state: { here: { doc: () => ({ read: (f) => f, write: (v) => v }) } },
            prcuts: {},
            refs: { origin: async () => ({ owner: 'someone', repo: 'their-repo' }), heads: async () => ({}) },
            //WHAT A JUDGEMENT HANDED BACK, asked of ../../src/app/artifact,
            //which owns that drawer. Stubbed as the LANE-BOUND form the plugin
            //uses -- `handedBack('judge')` hands over a store, and everything
            //after that is `list(uid)` and `read(uid, file)` as before.
            artifact: {
                handedBack: () => ({
                    list: async () => files,
                    read: async (uid, file) => ({ text: bodies[file] })
                })
            },
            github: {
                call: async (method, path, body) => {
                    //THE PULL REQUEST AS IT IS NOW, which a review draft reads
                    //before anything else: its author and its head.
                    if (method === 'GET') {
                        return { status: 200, body: { user: { login: 'a-stranger' }, head: { sha: 'abcdef1234567890' }, state: 'open' } };
                    }
                    did.posted.push({ method, path, body });
                    return o.githubSays || { status: 201, body: { html_url: 'https://github.com/x/y/issues/42#c1' } };
                }
            }
        }
    };
}

//---- a judgement that is actually IN the record ---------------------------
//
//`store.add` MAKES THE ROW: it assigns the id, the number, the uid and the
//state, and ignores anything handed in for them. So a fixture cannot be dropped
//beside the store — it is added through the door and then moved to the state the
//test needs, which is also the only sequence that exists on a real host.
function rememberingDoc() {
    let kept = null;
    return { read: (fallback) => (kept === null ? fallback : kept), write: (v) => { kept = v; return v; } };
}

async function withJudgement(over) {
    const o = over || {};
    const w = aJudge(o);
    const docs = {};
    w.imports.state = { here: { doc: (name) => (docs[name] = docs[name] || rememberingDoc()) } };

    let service = null;
    await plugin(w.imports, async (_e, s) => { service = s; });

    const made = await service.judge.add({ subject: w.one.subject });
    const moved = await service.judge.update(made.id, { state: (o.judgement || {}).state || 'done' });
    if ((o.judgement || {}).verdict) await service.judge.update(made.id, { verdict: o.judgement.verdict });

    w.say = w.defined.get('judgementSay');
    assert.ok(w.say, 'judgementSay is not defined');
    w.service = service;
    w.made = moved || made;
    //THE REF SOMEBODY WOULD TYPE, taken from the row rather than assumed — the
    //number is the store's to hand out.
    w.ref = w.made.ref || service.judge.refOf(w.made.number);
    return w;
}

//---------------------------------------------------------------------------
//WHAT HAS NOWHERE TO BE SAID.
//---------------------------------------------------------------------------

test('a judgement of this host\'s own cut is refused, and the refusal says why', async () => {
    //A CUT OF THIS HOST'S OWN WORK IS ANSWERED BY LANDING IT OR NOT. There is
    //nobody to tell.
    const w = await withJudgement({
        judgement: { subject: { kind: 'branch', branch: 'fix/x', name: 'fix/x' } }
    });

    await assert.rejects(() => w.say.run({ ref: w.ref, preview: true }), /landing it or not/);
    assert.deepEqual(w.did.posted, []);
});

test('one that has not finished reading is refused', async () => {
    const w = await withJudgement({ judgement: { state: 'given' } });
    await assert.rejects(() => w.say.run({ ref: w.ref, preview: true }), /has not finished reading/);
});

test('one that handed nothing back is refused, because it is not a review', async () => {
    const w = await withJudgement({ files: [] });
    await assert.rejects(() => w.say.run({ ref: w.ref, preview: true }), /handed nothing back/);
});

test('and files that are all empty are refused too', async () => {
    const w = await withJudgement({ files: [{ file: 'REVIEW.md' }], bodies: { 'REVIEW.md': '   \n\n' } });
    await assert.rejects(() => w.say.run({ ref: w.ref, preview: true }), /none of them has anything in it/);
});

//---------------------------------------------------------------------------
//READING IT BEFORE IT GOES.
//---------------------------------------------------------------------------

test('a preview composes what would go up and posts nothing', async () => {
    const w = await withJudgement({});
    const said = await w.say.run({ ref: w.ref, preview: true });

    assert.equal(said.posted, false);
    assert.deepEqual(w.did.posted, [], 'a preview reached GitHub');
    assert.match(said.note, /Nothing has been posted/);
    assert.equal(said.on, 'someone/their-repo');
    assert.equal(said.number, 42);
});

test('the whole review goes, not a summary of it', async () => {
    //SUMMARISING MEANS CHOOSING WHICH OF A JUDGE'S RESERVATIONS THE AUTHOR SEES,
    //and the section a summary drops first is "what I could not check" — the one
    //that makes the rest honest.
    const w = await withJudgement({});
    const said = await w.say.run({ ref: w.ref, preview: true });

    assert.match(said.body, /What I could not check/);
    assert.match(said.body, /did not run the suite/);
    assert.ok(said.body.length >= REVIEW.length, 'the review came back shorter than it is');
    assert.equal(said.characters, said.body.length);
});

test('it says it read nothing and changed nothing, at the commit it read', async () => {
    const w = await withJudgement({});
    const said = await w.say.run({ ref: w.ref, preview: true });

    assert.match(said.body, /Read at abcdef1/);
    assert.match(said.body, /ran nothing from it, and changed nothing anywhere/);
});

//---------------------------------------------------------------------------
//THE RECOMMENDATION COMES OFF THE FILE.
//---------------------------------------------------------------------------

test('the recommendation is read from the review, not from the record', async () => {
    //SO THE LINE AT THE TOP CANNOT SAY ONE THING WHILE THE REVIEW UNDER IT SAYS
    //ANOTHER. The record carries a verdict a person set; this is what the judge
    //actually wrote.
    const w = await withJudgement({ judgement: { verdict: 'rejected' } });
    const said = await w.say.run({ ref: w.ref, preview: true });

    assert.equal(said.recommend, 'YES');
    assert.match(said.body, /\*\*Recommend Pulling: YES\*\*/);
});

test('a review that never recommended says UNSTATED, and says the answer is not its answer', async () => {
    const w = await withJudgement({ bodies: { 'REVIEW.md': '# What I read\n\nIt is fine, mostly.\n' } });
    const said = await w.say.run({ ref: w.ref, preview: true });

    assert.equal(said.recommend, 'UNSTATED');
    assert.match(said.body, /not its answer/);
});

test('"reject" is read as NO', async () => {
    const w = await withJudgement({ bodies: { 'REVIEW.md': 'It is wrong.\n\nRECOMMENDATION: reject\n' } });
    assert.equal((await w.say.run({ ref: w.ref, preview: true })).recommend, 'NO');
});

//---------------------------------------------------------------------------
//AND WHO IS ALLOWED TO PRESS IT.
//---------------------------------------------------------------------------

//---------------------------------------------------------------------------
//IT WRITES A DRAFT NOW, AND POSTS NOTHING ITSELF.
//
//`judgementSay` used to post a plain comment and refuse the pipe. It is the
//same door onto the review machinery: it writes a review draft that a person
//releases with `issueApprove`, which is where the refusal lives now. Writing a
//draft is not speech; releasing it is. See ./review-draft.test.js for the
//review itself.
//---------------------------------------------------------------------------

test('a press writes a draft and nothing reaches GitHub', async () => {
    const w = await withJudgement({});
    const said = await w.say.run({ ref: w.ref });
    assert.equal(said.posted, false);
    assert.equal(said.waiting, true);
    assert.deepEqual(w.did.posted, [], 'a draft reached GitHub');
    assert.match(said.note, /waiting/);
});

test('over the wire it is the same draft, not a refusal', async () => {
    //THE OLD REFUSAL CONTRADICTED THE SUPERVISOR'S LIST, which names this verb.
    const w = await withJudgement({});
    const said = await w.say.run({ ref: w.ref, _overTheWire: true });
    assert.equal(said.waiting, true);
    assert.deepEqual(w.did.posted, []);
});

test('a preview is still a preview', async () => {
    const w = await withJudgement({});
    const said = await w.say.run({ ref: w.ref, preview: true, _overTheWire: true });
    assert.equal(said.posted, false);
    assert.deepEqual(w.did.posted, []);
});

//---------------------------------------------------------------------------
//RE-READING A VERDICT THE PARSER MISSED. For a while the queue read every
//drawer as empty, so judgements that had handed back RECOMMENDATION or CLAIM
//were recorded as having concluded nothing. The report is still there.
//---------------------------------------------------------------------------

test('a done judgement with a report but no conclusion is re-read, and the last line is recorded', async () => {
    const w = await withJudgement({ judgement: { subject: { kind: 'branch', branch: 'fix/x', name: 'fix/x' } } });
    const again = w.defined.get('judgementReconclude');
    assert.ok(again, 'judgementReconclude is not defined');
    assert.equal((await w.service.judge.get(w.ref)).concluded, null);

    const said = await again.run({ all: true });
    assert.equal(said.changed, 1);
    assert.equal(said.judgements[0].concluded, 'accept');
    assert.equal((await w.service.judge.get(w.ref)).concluded, 'accept');

    //AND NOT TWICE: a judgement that already says so is left alone.
    const twice = await again.run({ ref: w.ref });
    assert.equal(twice.changed, 0);
});

test('a judgement whose report has no verdict line stays unconcluded, and says so', async () => {
    const w = await withJudgement({
        judgement: { subject: { kind: 'branch', branch: 'fix/y', name: 'fix/y' } },
        bodies: { 'REVIEW.md': 'I read it and I am not sure.' }
    });
    const said = await w.defined.get('judgementReconclude').run({ ref: w.ref });
    assert.equal(said.changed, 0);
    assert.match(said.note, /handed back no verdict line/);
    assert.equal((await w.service.judge.get(w.ref)).concluded, null);
});
