const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const statePlugin = require('../../src/app/core/state/main');
const versionsPlugin = require('../../src/app/core/versions/server');
const libraryPlugin = require('../../src/app/library/server');

//---------------------------------------------------------------------------
//WHAT WAS APPROVED, READ BACK.
//
//A LIBRARY ENTRY CARRIES `lapsed` — "somebody approved this and it has been
//edited since" — and until ../../src/app/core/versions existed the text they
//approved was gone. The app could tell you your agreement was stale and not what
//you had agreed TO.
//
//THE REAL versions PLUGIN, NOT A FAKE ONE, and that is the point of this file.
//The two halves have to agree on the id a copy is filed under, and they very
//nearly did not: a job is filed per workspace and a prompt and a contract are
//not. Looked for under the wrong one, a version does not error — it is an EMPTY
//HISTORY, which reads exactly like "this has never been approved" and is the one
//answer nobody would question.
//
//So keeping and reading are exercised through the doors, against a real folder,
//in one test each. A stub of `versions` here would agree with whatever the
//library did and prove nothing at all.
//---------------------------------------------------------------------------

let defined, work, dataDir;

function call(name, args) {
    const door = defined.get(name);
    assert.ok(door, 'there is no action called "' + name + '"');
    return door.run(args || {});
}

async function setUp() {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-lib-'));
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-lib-ws-'));
    defined = new Map();

    let state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dataDir, ...p) } }, async (_e, s) => { state = s.state; });
    state.follow(async () => work);

    const app = { host: { actions: { define: (name, spec) => { defined.set(name, spec); return () => {}; } } } };
    const log = { on: () => ({ good() {}, warn() {}, bad() {}, info() {} }) };

    let versions = null;
    await versionsPlugin({ app: app, log: log, state: state }, async (_e, s) => { versions = s.versions; });

    await libraryPlugin({
        app: app, log: log, state: state, versions: versions,
        //THE LIBRARY REGISTERS AN INBOX SOURCE and nothing here reads it. It has
        //to be answerable rather than right.
        inbox: { source: () => () => {}, item: (...a) => a, at: (...a) => a }
    }, async () => {});
}

beforeEach(setUp);

//---- the first approval is where a history starts --------------------------

test('nothing approved keeps nothing, and says so rather than failing', async () => {
    //DOWN THE PIPE, SO NOTHING IS APPROVED AND NOTHING IS KEPT. At the window
    //the save IS the approval, which is a different test.
    await call('contractSave', { id: 'rules', name: 'rules', text: 'do not push', _overTheWire: true });

    const said = await call('contractVersions', { id: 'rules' });
    assert.deepEqual(said.versions, []);
    assert.equal(said.newest, null);
    //THE DISTINCTION THIS PANE RESTS ON. "Nothing kept" is not "it could not be
    //read", and a panel that drew an error for the ordinary state of every
    //newly written contract would be one nobody trusted.
    assert.match(said.note, /Versions start at the first approval/);
});

test('a version is kept when a person approves, and never down the pipe', async () => {
    //WRITING IT DOWN THE PIPE APPROVES NOTHING, so there is nothing to keep — a
    //draft a model wrote is not a version of anything, which is the whole rule
    //`keepApproved` is hung on.
    await call('contractSave', { id: 'rules', name: 'rules', text: 'a draft', _overTheWire: true });
    assert.equal((await call('contractVersions', { id: 'rules' })).versions.length, 0);

    //AND WRITING IT AT THE WINDOW IS THE READING, which is this library's oldest
    //rule and means the version arrives with the save rather than after it.
    await call('contractSave', { id: 'rules', name: 'rules', text: 'do not push' });

    const said = await call('contractVersions', { id: 'rules' });
    assert.equal(said.versions.length, 1);
    assert.equal(said.versions[0].first, true);
    assert.equal(said.newest.text, 'do not push');
    //A FIRST VERSION IS NOT A CHANGE TO ANYTHING, and drawing it as one would
    //mark every line as added.
    assert.equal(said.newest.changed, null);
});

//---- PRESSING THE BUTTON, WHICH IS ITS OWN PATH ----------------------------
//
//EVERY OTHER TEST IN THIS FILE WENT THROUGH `save`, AND SO DID THE FEATURE. A
//save at the window stamps an approval of its own, so a `contractApprove` after
//one is re-approving text a copy has already been kept of — identical, so
//deduplicated, so a test that proves nothing while passing. `approve` kept
//nothing at all and every assertion here was still green.
//
//SO THE ENTRY IS WRITTEN DOWN THE PIPE FIRST. That approves nothing, which
//leaves the button as the only thing that can have kept anything.
test('pressing approve keeps a copy, with nothing having been saved at the window', async () => {
    await call('contractSave', { id: 'rules', name: 'rules', text: 'do not push', _overTheWire: true });
    assert.equal((await call('contractVersions', { id: 'rules' })).versions.length, 0);

    await call('contractApprove', { id: 'rules' });

    const said = await call('contractVersions', { id: 'rules' });
    assert.equal(said.versions.length, 1, 'the button that the library is named for kept nothing');
    assert.equal(said.newest.text, 'do not push');
    assert.equal(said.newest.by, 'the window');
});

test('a rewrite down the pipe and a press keeps what changed since the last press', async () => {
    await call('contractSave', { id: 'rules', name: 'rules', text: 'do not push', _overTheWire: true });
    await call('contractApprove', { id: 'rules' });

    //A MODEL REWRITES IT, WHICH CLEARS THE APPROVAL rather than lapsing it —
    //this is the ordinary way a contract comes to differ from the copy somebody
    //last read, and the state the approval dialog actually meets.
    await call('contractSave', { id: 'rules', name: 'rules', text: 'do not push\nask first', _overTheWire: true });
    const now = await call('contract', { id: 'rules' });
    assert.equal(now.approved, false);
    assert.equal(now.lapsed, false);

    //AND THE DIALOG STILL HAS SOMETHING TO COMPARE AGAINST, which is the whole
    //point: what is on the left is the last thing a person said yes to.
    const said = await call('contractVersions', { id: 'rules' });
    assert.equal(said.newest.text, 'do not push');
    assert.notEqual(said.newest.text, now.text);

    await call('contractApprove', { id: 'rules' });
    const after = await call('contractVersions', { id: 'rules' });
    assert.equal(after.versions.length, 2);
    assert.equal(after.newest.added, 1);
    assert.match(after.newest.changed, /^\+ ask first$/m);
});

//---- and what changed to reach each one after that -------------------------

test('an edit and a second approval keeps what changed, against what was approved before', async () => {
    await call('contractSave', { id: 'rules', name: 'rules', text: 'do not push\nand do not merge' });
    await call('contractApprove', { id: 'rules' });

    await call('contractSave', { id: 'rules', name: 'rules', text: 'do not push\nand never merge\nask first' });
    await call('contractApprove', { id: 'rules' });

    const said = await call('contractVersions', { id: 'rules' });
    assert.equal(said.versions.length, 2);
    //NEWEST FIRST, which the chips in the pane rely on to know which one stands.
    assert.equal(said.versions[0].first, false);
    assert.equal(said.versions[1].first, true);

    assert.equal(said.newest.added, 2);
    assert.equal(said.newest.gone, 1);
    assert.match(said.newest.changed, /^- and do not merge$/m);
    assert.match(said.newest.changed, /^\+ and never merge$/m);
    assert.match(said.newest.changed, /^\+ ask first$/m);
});

test('an older version is read by the moment it was approved', async () => {
    await call('contractSave', { id: 'rules', name: 'rules', text: 'one' });
    await call('contractApprove', { id: 'rules' });
    await call('contractSave', { id: 'rules', name: 'rules', text: 'two' });
    await call('contractApprove', { id: 'rules' });

    const all = await call('contractVersions', { id: 'rules' });
    const first = all.versions[all.versions.length - 1];

    const older = await call('contractVersion', { id: 'rules', at: first.at });
    assert.equal(older.text, 'one');

    //AND WITHOUT AN `at`, THE NEWEST — the same default the pane draws with.
    assert.equal((await call('contractVersion', { id: 'rules' })).text, 'two');
});

test('approving the same text again does not keep a second identical copy', async () => {
    await call('contractSave', { id: 'rules', name: 'rules', text: 'do not push' });
    await call('contractApprove', { id: 'rules' });
    await call('contractWithdraw', { id: 'rules' });
    await call('contractApprove', { id: 'rules' });

    //RE-READING AND CONFIRMING IS AN ORDINARY THING, and a second identical copy
    //is noise in the one list that should be all signal.
    assert.equal((await call('contractVersions', { id: 'rules' })).versions.length, 1);
});

//---- the id, which is the thing that quietly goes wrong --------------------

test('a job is filed under its workspace and read back from the same place', async () => {
    await call('jobSave', { id: 'sweep', name: 'sweep', code: 'module.exports = async () => {};' });
    await call('jobApprove', { id: 'sweep' });

    const said = await call('jobVersions', { id: 'sweep' });
    //THE ASSERTION THIS FILE EXISTS FOR. Kept under `<workspace>--sweep` and
    //looked for under `sweep`, this is an empty list and a green test.
    assert.equal(said.versions.length, 1, 'the job was kept somewhere this cannot read it back from');
    assert.match(said.newest.text, /module\.exports/);
});

test('a job is filed under the workspace name and not under its id alone', async () => {
    await call('jobSave', { id: 'sweep', name: 'sweep', code: 'the first workspace' });
    await call('jobApprove', { id: 'sweep' });

    //THE SAME NAME IN ANOTHER WORKSPACE MUST BE ANOTHER HISTORY, or each would
    //look as though the other had been editing it — and the difference drawn on
    //the pane would be between two unrelated documents, which is worse than
    //drawing none.
    //
    //ASSERTED ON DISK RATHER THAN BY SWITCHING WORKSPACE, because a job RECORD
    //is per workspace too: somewhere else there is no such job at all, and the
    //door refuses before it ever reaches a version. That refusal is correct and
    //it proves nothing about where the copy went.
    const kept = path.join(dataDir, 'state', 'approved', 'job');
    const under = fs.readdirSync(kept);
    assert.equal(under.length, 1);
    assert.notEqual(under[0], 'sweep', 'a job was filed under its bare id, so two workspaces would share it');
    assert.match(under[0], /--sweep$/);
    //THE WORKSPACE PART IS SLUGGED BY ../core/state and is not the folder name
    //spelled out, so what is asserted is that there IS one and that it is not
    //something a second workspace could also produce.
    assert.ok(under[0].length > '--sweep'.length, 'nothing stands in front of the id');
});

test('the doors refuse an id that is not there rather than answering emptily', async () => {
    await assert.rejects(() => call('contractVersions', { id: 'nothing-by-that-name' }), /no contract called/);
    await assert.rejects(() => call('contractVersion', { id: 'nothing-by-that-name' }), /no contract called/);
});

test('a version asked for at a moment nothing was approved says so', async () => {
    await call('contractSave', { id: 'rules', name: 'rules', text: 'do not push' });
    await call('contractApprove', { id: 'rules' });

    await assert.rejects(() => call('contractVersion', { id: 'rules', at: '1999-01-01T00:00:00.000Z' }),
        /Nothing was approved/);
});
