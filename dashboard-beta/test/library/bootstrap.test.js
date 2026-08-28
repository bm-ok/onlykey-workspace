const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const statePlugin = require('../../src/app/core/state/main');
const versionsPlugin = require('../../src/app/core/versions/server');
const libraryPlugin = require('../../src/app/library/server');
const bootstrapPlugin = require('../../src/app/bootstrap/server');
const archivePlugin = require('../../src/app/core/archive/server');

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

let dataDir, work, bundleAt, mineDir, defined, library, archive;

//HANDED OUT so the tests can read back what the app wrote with the same reader
//the app uses -- see the file tests at the bottom.
function archiveOf() { return archive; }

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

    //THE REAL TAR WRITER AND READER, not a fake: what has to hold is that
    //what this app WRITES is what it can READ BACK, and a stub of one half
    //would agree with whatever the other half did.
    await archivePlugin({ state }, async (_e, s) => { archive = s.archive; });

    await bootstrapPlugin({ app, log, library, provision, archive }, async () => {});
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

//---------------------------------------------------------------------------
//THE SAME SET AS ONE FILE.
//
//A FOLDER IS THE RIGHT SHAPE ON DISK AND THE WRONG ONE TO HAND A PERSON.
//Twenty-five files is what you want in a repository, where each is read and
//diffed on its own; it is not the answer to "where do I keep this so I can put
//it back", which is one file you can name and move.
//
//WHAT MUST HOLD ACROSS BOTH: a bundle means the same thing whichever way it was
//carried. Two importers is where that would stop being true, so there is one —
//and these tests exist to catch the day somebody adds a second.
//---------------------------------------------------------------------------

test('the whole set comes back as one file that this app can read again', async () => {
    await aLibrary();
    const made = await call('bootstrapFile', {});

    assert.match(made.name, /\.tar$/);
    assert.ok(made.size > 0);
    //THE MANIFEST AND EVERY BODY, which is 3 documents, 3 skills and the
    //manifest itself.
    assert.equal(made.files, 7);

    //READ BACK BY THE READER THIS APP ALREADY HAD. If these two ever disagree,
    //the app can produce something it cannot open.
    const seen = archiveOf().inside(Buffer.from(made.bytes, 'base64'));
    assert.equal(seen.unreadable, null);
    assert.ok(seen.entries.some((e) => e.name === 'library.json'));
    assert.ok(seen.entries.some((e) => e.name === 'contracts/rules.md'));
    assert.ok(seen.entries.some((e) => e.name === 'jobs/sweep.js'));
    assert.ok(seen.entries.some((e) => e.name === 'skills/judge.md'));
});

test('a file holds no more about approvals than a folder does', async () => {
    await aLibrary();
    await call('contractApprove', { id: 'rules' });

    const made = await call('bootstrapFile', {});
    const whole = Buffer.from(made.bytes, 'base64').toString('utf8');
    assert.doesNotMatch(whole, /approvedBy|"approval"/);
});

test('the data directory is gone and a saved file puts it all back', async () => {
    await aLibrary();
    await call('contractApprove', { id: 'rules' });
    const made = await call('bootstrapFile', {});

    await library.contracts.write([]);
    await library.prompts.write([]);
    await library.jobs.write([]);

    const said = await call('bootstrapFromFile', { bytes: made.bytes });
    assert.deepEqual(said.wrote, { contract: 1, prompt: 1, job: 1, skill: 3 });

    assert.equal((await call('contract', { id: 'rules' })).text, 'do not push');
    assert.equal((await library.prompts.get('brief')).contractId, 'rules');
    assert.match((await call('job', { id: 'sweep' })).code, /module\.exports/);

    //AND STILL WAITING TO BE READ, the same as through a folder. The claim is
    //about what a bundle MEANS, so it has to hold whichever way it travelled.
    assert.equal((await call('contract', { id: 'rules' })).approved, false);
});

test('a file that is not a bundle is refused rather than half-read', async () => {
    await assert.rejects(
        () => call('bootstrapFromFile', { bytes: Buffer.from('not a tar at all').toString('base64') }),
        /not a bundle/
    );

    //A REAL TAR WITH NO MANIFEST IN IT is the more interesting one: it opens
    //perfectly and still is not a bundle, and reading the folders inside it
    //would be trusting whatever somebody put there.
    const notOurs = archiveOf().make([{ name: 'hello.txt', data: 'hi' }]);
    await assert.rejects(
        () => call('bootstrapFromFile', { bytes: notOurs.toString('base64') }),
        /no library\.json/
    );
});

test('a manifest naming a body that is not in the file is refused', async () => {
    await aLibrary();
    const made = await call('bootstrapFile', {});

    //REBUILT WITHOUT ONE OF THE BODIES, which is what a truncated or
    //hand-edited file looks like. Importing it as an empty contract — no rules
    //at all — is the worst available reading of a mistake.
    const seen = archiveOf().inside(Buffer.from(made.bytes, 'base64'));
    const short = archiveOf().make(
        seen.entries
            .filter((e) => e.name !== 'contracts/rules.md')
            .map((e) => ({ name: e.name, data: Buffer.from(e.data) }))
    );

    await assert.rejects(() => call('bootstrapFromFile', { bytes: short.toString('base64') }), /no contracts/);
});

test('a bundle named by path may be a saved file as well as a folder', async () => {
    await aLibrary();
    const made = await call('bootstrapFile', {});

    //THE SET THAT SHIPS WITH THE APP IS A TAR, and the pane restores from it by
    //naming its path — so the door that takes a path has to take both shapes.
    const saved = path.join(bundleAt + '-file.tar');
    fs.mkdirSync(path.dirname(saved), { recursive: true });
    fs.writeFileSync(saved, Buffer.from(made.bytes, 'base64'));

    await library.contracts.write([]);
    const said = await call('bootstrapImport', { from: saved });

    assert.equal(said.wrote.contract, 1);
    assert.equal((await call('contract', { id: 'rules' })).text, 'do not push');
});

test('told apart by what is there, not by the name on the end', async () => {
    await aLibrary();

    //A FOLDER CALLED `.tar` IS STILL A FOLDER, and a bundle saved without a
    //suffix is still a bundle. Deciding on the suffix would get both wrong.
    const oddly = bundleAt + '.tar';
    await call('bootstrapExport', { to: oddly });
    await library.contracts.write([]);

    const said = await call('bootstrapImport', { from: oddly });
    assert.equal(said.wrote.contract, 1);
});

test('a path with nothing at it says so, rather than reading as an empty bundle', async () => {
    await assert.rejects(
        () => call('bootstrapImport', { from: path.join(bundleAt, 'nowhere-at-all') }),
        /nothing at/
    );
});

//---------------------------------------------------------------------------
//THE TAR THE REPO SHIPS, REWRITTEN FROM WHAT IS LIVE.
//
//It went stale by fourteen thousand characters because refreshing it was a
//window press plus a save-as over the checked-in file, with no receipt. The
//command is the same bytes onto that file, and an account of what moved --
//which is the thing the commit message needs and a tar diff cannot show.
//---------------------------------------------------------------------------

const bundleModule = require('../../src/app/bootstrap/bundle');

test('what moved between two bundles is said by name, with both sizes', () => {
    const was = [{ name: 'a.md', data: 'one' }, { name: 'b.md', data: 'two' }, { name: 'gone.md', data: 'x' }];
    const now = [{ name: 'a.md', data: 'one' }, { name: 'b.md', data: 'two, longer' }, { name: 'new.md', data: 'y' }];
    const m = bundleModule.changes(was, now);
    assert.deepEqual(m.same, ['a.md']);
    assert.deepEqual(m.changed, [{ name: 'b.md', was: 3, now: 11 }]);
    assert.deepEqual(m.added, [{ name: 'new.md', now: 1 }]);
    assert.deepEqual(m.removed, [{ name: 'gone.md', was: 1 }]);
    assert.equal(m.moved, 3);
    //NOTHING BEFORE IS EVERYTHING ADDED, which is what the first ship of a
    //repository looks like.
    assert.equal(bundleModule.changes(null, now).added.length, 3);
});

test('shipping writes the tar and says what moved; shipping again writes nothing', async () => {
    await aLibrary();
    const to = path.join(bundleAt, 'ship', 'okc-bootstrap.tar');

    const first = await call('bootstrapShip', { to });
    assert.equal(first.wrote, true);
    assert.equal(first.moved.added.length, 7, 'the whole set is new the first time');
    assert.equal(first.moved.moved, 7);
    assert.ok(fs.statSync(to).isFile());

    //THE SAME AGAIN IS A NO-OP, AND SAID: a tar that is rewritten identically
    //still shows as changed to anything watching the file.
    const again = await call('bootstrapShip', { to });
    assert.equal(again.wrote, false);
    assert.equal(again.moved.moved, 0);

    //ONE DOCUMENT EDITED, ONE ENTRY NAMED, both sizes on it.
    await call('contractSave', { id: 'rules', name: 'rules', text: 'do not push, and do not force' });
    const third = await call('bootstrapShip', { to });
    assert.equal(third.wrote, true);
    assert.deepEqual(third.moved.changed.map((e) => e.name), ['contracts/rules.md']);
    assert.equal(third.moved.changed[0].was, 'do not push'.length);
    assert.equal(third.moved.changed[0].now, 'do not push, and do not force'.length);

    //AND WHAT WAS WRITTEN IS A BUNDLE THIS APP READS BACK, the same as the
    //file the window hands out.
    const seen = archiveOf().inside(fs.readFileSync(to));
    assert.equal(seen.unreadable, null);
    assert.ok(seen.entries.some((e) => e.name === 'library.json'));
});

test('shipping is a command-line act, and a driven window is refused it', async () => {
    await aLibrary();
    const to = path.join(bundleAt, 'ship2', 'okc-bootstrap.tar');
    await assert.rejects(() => call('bootstrapShip', { to, _driven: true }), /at this host/);
    assert.ok(!fs.existsSync(to));

    //THE COMMAND LINE IS THE PIPE, and it is the caller this exists for.
    const out = await call('bootstrapShip', { to, _overTheWire: true });
    assert.equal(out.wrote, true);
});

test('with no path and no repository above it, shipping says so rather than writing into the app', async () => {
    await aLibrary();
    const was = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
        await assert.rejects(() => call('bootstrapShip', {}), /--to/);
    } finally {
        if (was === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = was;
    }
});
