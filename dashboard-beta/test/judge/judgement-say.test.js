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
            archive: {
                store: () => ({
                    list: async () => files,
                    read: async (uid, file) => ({ text: bodies[file] })
                })
            },
            github: {
                call: async (method, path, body) => {
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

test('posting is refused over the wire, and nothing reaches GitHub', async () => {
    //A SUPERVISOR CANNOT REACH THIS ANYWAY — it is not on its allowlist — and
    //this is the second stop, for the command line and for anything driving the
    //window from outside.
    const w = await withJudgement({});

    await assert.rejects(() => w.say.run({ ref: w.ref, _overTheWire: true }),
        /done in the window, by a person who has read what is about to be posted/);
    assert.deepEqual(w.did.posted, []);
});

test('and refused to a driven click, for the same reason', async () => {
    const w = await withJudgement({});
    await assert.rejects(() => w.say.run({ ref: w.ref, _driven: true }), /cannot be unsent/);
    assert.deepEqual(w.did.posted, []);
});

test('a PREVIEW is allowed over the wire, because it publishes nothing', async () => {
    //THE READ HALF IS NOT THE DANGEROUS HALF. Refusing it would make the command
    //line unable to show what a press would do, which is the opposite of the
    //point.
    const w = await withJudgement({});
    const said = await w.say.run({ ref: w.ref, preview: true, _overTheWire: true });
    assert.equal(said.posted, false);
    assert.deepEqual(w.did.posted, []);
});

//---------------------------------------------------------------------------
//AND WHERE IT GOES.
//---------------------------------------------------------------------------

test('a person\'s press posts to the issues endpoint of the repository it is ON', async () => {
    //A PULL REQUEST IS AN ISSUE ON GITHUB. The pulls endpoint carries review
    //comments, which are a different thing attached to lines of a diff.
    const w = await withJudgement({});
    const said = await w.say.run({ ref: w.ref });

    assert.equal(w.did.posted.length, 1);
    assert.equal(w.did.posted[0].method, 'POST');
    assert.equal(w.did.posted[0].path, '/repos/someone/their-repo/issues/42/comments');
    assert.equal(w.did.posted[0].body.body, said.body || w.did.posted[0].body.body);
    assert.equal(said.posted, true);
    assert.match(said.note, /nothing was merged, changed or pushed/);
});

test('a repository this workspace does not have is refused before anything is sent', async () => {
    const w = await withJudgement({ repos: [{ repo: 'something-else', issuesOn: 'me/something-else' }] });
    await assert.rejects(() => w.say.run({ ref: w.ref }), /is not a repository in this workspace/);
    assert.deepEqual(w.did.posted, []);
});

test('a GitHub that refuses the comment is reported, and nothing is recorded as said', async () => {
    const w = await withJudgement({ githubSays: { status: 403, body: { message: 'Resource not accessible' } } });
    await assert.rejects(() => w.say.run({ ref: w.ref }), /Resource not accessible/);

    const after = await w.service.judge.get(w.ref);
    assert.equal(after.saidOn, undefined, 'it recorded a comment GitHub refused');
});

test('and a comment that went is written down with where it went', async () => {
    const w = await withJudgement({});
    await w.say.run({ ref: w.ref });

    const after = await w.service.judge.get(w.ref);
    assert.ok(after.saidOn, 'nothing was recorded');
    assert.equal(after.saidOn.recommend, 'YES');
    assert.match(after.saidOn.url, /github\.com/);
});
