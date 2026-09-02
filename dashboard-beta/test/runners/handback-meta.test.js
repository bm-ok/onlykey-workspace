const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { Readable } = require('node:stream');

const APP = path.join(__dirname, '..', '..', 'src', 'app');
const makeGuestApi = require(path.join(APP, 'runners', 'handback', 'guestapi.js'));

//---------------------------------------------------------------------------
//WHAT IS WRITTEN BESIDE A HANDED-BACK FILE.
//
//THE FILE OUTLIVES THE RECORD THAT EXPLAINS IT, deliberately. ../../core/archive
//lists these by reading the DIRECTORY rather than whatever points at it, "so a
//file whose task was thrown away is still findable". That is the right way
//round, and it is exactly why the metadata has to be complete at the moment it
//is written: afterwards there may be nothing left to ask.
//
//SO THIS TESTS THE SIDECAR AND NOT THE UPLOAD. Whether the bytes land is
//../../core/archive's business and is covered where the store is. What is
//covered here is what the door CHOOSES to record about them, which is this
//file's own decision and is recoverable from nowhere else.
//---------------------------------------------------------------------------

//THE DOOR ASKED THE WAY THE SERVER ASKS IT, through `routes` rather than by
//reaching for `takeFile` — the export is the surface, and a test that called the
//inner function would go on passing if the route stopped pointing at it.
function aDoor(over) {
    const o = over || {};
    const kept = [];

    const api = makeGuestApi({
        whatIsOn: async () => (o.doing === undefined ? aTask() : o.doing),
        may: () => ({ may: true }),
        say: () => ({ good() {}, warn() {}, bad() {}, info() {} }),
        artifacts: {
            keep: async (uid, name, bytes, meta) => {
                kept.push({ uid, name, bytes, meta });
                return { bytes: bytes.length };
            }
        },
        verdictFor: async () => ({})
    });

    const post = api.routes.filter(r => r.path === '/artifact')[0];
    return { kept, post };
}

function aTask() {
    return {
        kind: 'task',
        ref: '#7',
        uid: 'mtkgedhj00125r',
        id: 'remember-a-number',
        title: 'Remember a number',
        item: { number: 7, run: 'job-do-the-work-20260902185507', branch: 'test/session' }
    };
}

function aJudgement() {
    return {
        kind: 'judgement',
        ref: 'J1',
        uid: 'fd8d27ec-cdcf-4277-9b64-ba83fbb9c2c6',
        id: 'judge-test-session',
        title: 'judge test/session',
        reads: 'test/session',
        item: { number: 1, run: 'job-check-a-claim-20260902190221', branch: 'test/session' }
    };
}

//A REQUEST WITH A BODY, because the door reads one off the stream and a plain
//object would never emit `end`.
async function send(post, body) {
    const req = Readable.from([Buffer.from(body == null ? 'hello' : body)]);
    let code = null;
    const res = { writeHead: (c) => { code = c; }, end: () => {} };

    await post.run({
        req, res,
        vm: { name: 'ok-runner1', tags: ['worker'] },
        url: new URL('https://host/artifact?name=NOTES.md&vm=ok-runner1')
    });
    return code;
}

test('a task hands a file back and the branch cut is written beside it', async () => {
    const { kept, post } = aDoor();
    assert.equal(await send(post), 200);

    assert.equal(kept.length, 1, 'the door did not keep the file');
    const meta = kept[0].meta;

    //THE ONE THIS FILE EXISTS FOR. Without it, a file whose task is later thrown
    //away has no line anywhere on this host saying what it was delivering on.
    assert.equal(meta.branch, 'test/session',
        'the branch cut is not recorded, so what this file delivered on dies with the task record');

    //AND FILED UNDER THE UID, which is what makes the directory findable at all.
    assert.equal(kept[0].uid, 'mtkgedhj00125r');
});

test('a judgement records both the branch and what it read, and they are not merged', async () => {
    const { kept, post } = aDoor({ doing: aJudgement() });
    assert.equal(await send(post), 200);

    const meta = kept[0].meta;

    //TWO FACTS THAT LOOK LIKE ONE HERE AND ARE NOT. `reads` is the change being
    //read; `branch` is where work lands. They happen to agree for a judgement of
    //a branch cut and do NOT agree for a judgement of an arrived pull request —
    //so neither may stand in for the other, however often they match.
    assert.equal(meta.reads, 'test/session', 'what it read was lost');
    assert.equal(meta.branch, 'test/session', 'the branch cut was lost');
    assert.equal(meta.kind, 'judgement');
});

test('a run with no branch records null rather than inventing one', async () => {
    //A SHAPE THIS CANNOT NAME IS LEFT EMPTY. Guessing a cut is the other kind of
    //wrong — it files a delivery against a line it never touched — and the same
    //rule is written into ../../src/app/worker/sessions/keying.js for the same
    //reason.
    const doing = aTask();
    delete doing.item.branch;

    const { kept, post } = aDoor({ doing });
    assert.equal(await send(post), 200);
    assert.equal(kept[0].meta.branch, null, 'a missing branch was filled in with something');
});

test('a bare job files under its run and claims no branch at all', async () => {
    //NO WORK ITEM MEANS NO CUT TO CLAIM. `whatIsOn` answers null for a machine
    //that was not GIVEN queued work, and the door files under the run id.
    const { kept, post } = aDoor({ doing: null });

    const req = Readable.from([Buffer.from('hello')]);
    let code = null;
    await post.run({
        req,
        res: { writeHead: (c) => { code = c; }, end: () => {} },
        vm: { name: 'ok-diy1', tags: ['diy'] },
        url: new URL('https://host/artifact?name=NOTES.md&run=job-api-tour-20260902190000')
    });

    assert.equal(code, 200);
    assert.equal(kept[0].uid, 'job-api-tour-20260902190000', 'a bare job was not filed under its run');
    assert.equal(kept[0].meta.branch, undefined,
        'a run belonging to no work item claimed a branch cut');
});
