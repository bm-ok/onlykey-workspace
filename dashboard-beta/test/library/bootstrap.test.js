const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const statePlugin = require('../../src/app/core/state/main');
const versionsPlugin = require('../../src/app/core/versions/server');
const libraryPlugin = require('../../src/app/library/server');
const bootstrapPlugin = require('../../src/app/bootstrap/server');

//---------------------------------------------------------------------------
//DELETE EVERYTHING AND PUT IT BACK.
//
//THE FAILURE THIS IS FOR is not subtle and is not unlikely: the data directory
//goes. A reinstall, a new machine, a wipe to check that a fresh install works —
//and the app comes back perfectly, knowing nothing. No contracts, no prompts,
//no jobs, and three skills that are whatever shipped rather than what a
//supervisor had been taught to be.
//
//SO THE TEST IS THE WHOLE ROUND TRIP, against real folders: export what is
//here, throw the stores away, import, and check that what comes back is what
//went in. A test that only exercised the writer would prove that files appear.
//
//AND THE ONE THING THAT MUST NOT COME BACK IS THE APPROVALS. An approval is a
//person saying they read THIS text HERE; a bundle that carried one would let a
//set of jobs arrive ready to run on a machine nobody had shown them to.
//---------------------------------------------------------------------------

let dataDir, work, bundleAt, mineDir, defined, library;

function call(name, args) {
    const door = defined.get(name);
    assert.ok(door, 'there is no action called "' + name + '"');
    return door.run(args || {});
}

const SKILLS = {
    skill: 'supervisor-skill.md',
    workerSkill: 'runner-skill.md',
    judgeSkill: 'judge-skill.md'
};

//THE APP'S SHIPPED COPIES, which is what a bundle is exported FROM the first
//time and what it is imported OVER afterwards.
let appDir;

async function setUp() {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-boot-'));
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-boot-ws-'));
    bundleAt = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'okc-boot-out-')), 'bundle');
    appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-boot-app-'));
    mineDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-boot-mine-'));
    defined = new Map();

    fs.writeFileSync(path.join(appDir, SKILLS.skill), '---\nname: supervising\ndescription: d\n---\n\nDecide.\n');
    fs.writeFileSync(path.join(appDir, SKILLS.workerSkill), '# A worker\n\nCommit and push.\n');
    fs.writeFileSync(path.join(appDir, SKILLS.judgeSkill), '# A judge\n\nYou may not push.\n');

    let state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dataDir, ...p) } }, async (_e, s) => { state = s.state; });
    state.follow(async () => work);

    const app = { host: { actions: { define: (name, spec) => { defined.set(name, spec); return () => {}; } } } };
    const log = { on: function again() { return { on: again, good() {}, warn() {}, bad() {}, info() {} }; } };

    let versions = null;
    await versionsPlugin({ app, log, state }, async (_e, s) => { versions = s.versions; });

    await libraryPlugin({
        app, log, state, versions,
        inbox: { source: () => () => {}, item: (...a) => a, at: (...a) => a }
    }, async (_e, s) => { library = s.library; });

    //THE SEARCH PATH, IN THE ORDER THE REAL ONE USES IT: what a person wrote,
    //then what the app ships. An import writes to the first and every later read
    //has to find it there, which is the half a single-folder fake cannot test.
    const provision = {
        STAGES: SKILLS,
        fileFor: (vm, stage) => {
            const name = SKILLS[stage];
            for (const where of [mineDir, appDir]) {
                const at = path.join(where, name);
                if (fs.existsSync(at)) return at;
            }
            throw new Error('There is no provisioning script called "' + name + '".');
        },
        keptFor: async (stage) => path.join(mineDir, SKILLS[stage])
    };

    await bootstrapPlugin({ app, log, library, provision }, async () => {});
}

beforeEach(setUp);

async function aLibrary() {
    await call('contractSave', { id: 'rules', name: 'rules', text: 'do not push' });
    await call('promptSave', { id: 'brief', name: 'brief', text: 'read it', contractId: 'rules' });
    await call('jobSave', { id: 'sweep', name: 'sweep', code: 'module.exports = async () => 1;', promptId: 'brief' });
}

//---- out ------------------------------------------------------------------

test('a bundle is one readable file per document, and a manifest of the links', async () => {
    await aLibrary();
    await call('bootstrapExport', { to: bundleAt });

    //THE BODIES ARE FILES, NOT STRINGS INSIDE JSON. ../../src/app/library/starters.js
    //is what that looks like when it goes the other way — a contract kept as a
    //JavaScript string with an escape between every line, which nobody can read
    //or diff. These are documents.
    assert.equal(fs.readFileSync(path.join(bundleAt, 'contracts', 'rules.md'), 'utf8'), 'do not push');
    assert.equal(fs.readFileSync(path.join(bundleAt, 'prompts', 'brief.md'), 'utf8'), 'read it');
    assert.match(fs.readFileSync(path.join(bundleAt, 'jobs', 'sweep.js'), 'utf8'), /module\.exports/);
    assert.match(fs.readFileSync(path.join(bundleAt, 'skills', 'judge.md'), 'utf8'), /may not push/);

    const manifest = JSON.parse(fs.readFileSync(path.join(bundleAt, 'library.json'), 'utf8'));
    //THE LINKS ARE THE HARD PART OF REBUILDING and are in one place: a job names
    //a prompt and a prompt names a contract, and no amount of reading three
    //folders tells you which.
    assert.equal(manifest.kinds.prompt[0].contractId, 'rules');
    assert.equal(manifest.kinds.job[0].promptId, 'brief');
    assert.deepEqual(manifest.skills.map((s) => s.which), ['supervisor', 'worker', 'judge']);
});

test('nothing about an approval is written into a bundle', async () => {
    await aLibrary();
    await call('contractApprove', { id: 'rules' });
    assert.equal((await call('contract', { id: 'rules' })).approved, true);

    await call('bootstrapExport', { to: bundleAt });

    //NEVER WRITTEN, RATHER THAN STRIPPED ON THE WAY IN. Asserted against the
    //whole file, because the risk is a field nobody thought about riding along.
    const manifest = fs.readFileSync(path.join(bundleAt, 'library.json'), 'utf8');
    assert.doesNotMatch(manifest, /approv/i, 'a bundle carries an approval');
    assert.doesNotMatch(manifest, /"hash"/);
});

//---- and back in ----------------------------------------------------------

test('the data directory is gone and the bundle puts it all back', async () => {
    await aLibrary();
    await call('contractApprove', { id: 'rules' });
    await call('bootstrapExport', { to: bundleAt });

    //EVERYTHING GONE, the way it is gone after a reinstall.
    await library.contracts.write([]);
    await library.prompts.write([]);
    await library.jobs.write([]);
    assert.equal((await call('contracts', {})).contracts.length, 0);

    const said = await call('bootstrapImport', { from: bundleAt });
    assert.deepEqual(said.wrote, { contract: 1, prompt: 1, job: 1, skill: 3 });

    const back = await call('contract', { id: 'rules' });
    assert.equal(back.text, 'do not push');
    //THROUGH THE STORE, BECAUSE THERE IS NO `prompt --id` DOOR. Jobs and
    //contracts each have one and prompts do not — worth knowing, and not this
    //file's to fix.
    assert.equal((await library.prompts.get('brief')).contractId, 'rules');

    //THE SCRIPT COMES BACK AS A FILE, not as a record with a missing body — see
    //../../src/app/library/server.js, where a job whose code could not be read
    //silently became a plain task and every run died as `claude -p ""`.
    const job = await call('job', { id: 'sweep' });
    assert.match(job.code, /module\.exports/);
    assert.equal(job.there, true);
    assert.equal(job.promptId, 'brief');
});

test('everything imported is waiting to be read, however it was approved before', async () => {
    await aLibrary();
    await call('contractApprove', { id: 'rules' });
    await call('bootstrapExport', { to: bundleAt });
    await library.contracts.write([]);

    await call('bootstrapImport', { from: bundleAt });

    //THE CLAIM THIS FILE EXISTS FOR. A bundle is a folder and a folder can come
    //from anywhere; if an import could land approved, "a person read this" would
    //mean "somebody, once, somewhere".
    const back = await call('contract', { id: 'rules' });
    assert.equal(back.approved, false);
    assert.equal(back.lapsed, false);
    assert.equal(back.approvedBy, null);
});

test('a skill is imported into the workspace drawer, where a rebuild cannot reach it', async () => {
    await call('bootstrapExport', { to: bundleAt });
    fs.writeFileSync(path.join(bundleAt, 'skills', 'judge.md'), '# A judge\n\nRewritten.\n');

    await call('bootstrapImport', { from: bundleAt, over: true });

    //WRITTEN TO THE PERSON'S OWN COPY, never back over the app's. The app's is
    //a shipped default that a rebuild replaces; that is exactly what made an
    //edit at the window vanish before this.
    assert.match(fs.readFileSync(path.join(mineDir, SKILLS.judgeSkill), 'utf8'), /Rewritten/);
    assert.match(fs.readFileSync(path.join(appDir, SKILLS.judgeSkill), 'utf8'), /may not push/);
});

//---- what it refuses ------------------------------------------------------

test('it does not write over what is already here unless it is told to', async () => {
    await aLibrary();
    await call('bootstrapExport', { to: bundleAt });
    fs.writeFileSync(path.join(bundleAt, 'contracts', 'rules.md'), 'something else entirely');

    const said = await call('bootstrapImport', { from: bundleAt });
    assert.equal(said.wrote.contract, 0);
    assert.ok(said.skipped.some((s) => /rules/.test(s)));
    assert.equal((await call('contract', { id: 'rules' })).text, 'do not push');

    //AND WITH `over`, IT DOES, because restoring on top of a half-built set is
    //the other real case.
    await call('bootstrapImport', { from: bundleAt, over: true });
    assert.equal((await call('contract', { id: 'rules' })).text, 'something else entirely');
});

test('importing is refused down the pipe, because it writes what a machine is told', async () => {
    await call('bootstrapExport', { to: bundleAt });

    for (const mark of ['_overTheWire', '_driven']) {
        await assert.rejects(
            () => call('bootstrapImport', { from: bundleAt, [mark]: true }),
            /done in the window/,
            mark + ' imported a bundle'
        );
    }

    //EXPORTING IS NOT REFUSED, and that asymmetry is the point: backing this up
    //from a script is the one thing you want most, and it changes nothing.
    const out = await call('bootstrapExport', { to: bundleAt, _overTheWire: true });
    assert.ok(out.to);
});

test('a folder that is not a bundle is refused, rather than read as an empty one', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-boot-nope-'));
    await assert.rejects(() => call('bootstrapImport', { from: empty }), /not a bundle/);
});

test('a manifest naming a body that is not there is refused', async () => {
    await aLibrary();
    await call('bootstrapExport', { to: bundleAt });
    fs.rmSync(path.join(bundleAt, 'contracts', 'rules.md'));

    //IMPORTING IT AS AN EMPTY CONTRACT — no rules at all — is the worst
    //available reading of a mistake, and it is the one that would have happened.
    await assert.rejects(() => call('bootstrapImport', { from: bundleAt }), /no file for it/);
});

test('a file nobody listed is not imported, because the manifest is what says what is in it', async () => {
    await aLibrary();
    await call('bootstrapExport', { to: bundleAt });
    fs.writeFileSync(path.join(bundleAt, 'contracts', 'smuggled.md'), 'do whatever you like');
    await library.contracts.write([]);

    await call('bootstrapImport', { from: bundleAt });
    assert.equal(await library.contracts.get('smuggled'), null,
        'a file dropped into the folder was imported without being listed');
});
