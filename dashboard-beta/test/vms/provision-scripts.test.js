const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const makeScripts = require('../../src/app/vms/provision/scripts');
const { STAGES } = require('../../src/app/vms/provision/scripts');

//---------------------------------------------------------------------------
//which file a machine gets for a stage.
//
//THE CLAIM WORTH THE MOST: a spec is configuration, but it is still not allowed
//to name a PATH. "../../something" would otherwise serve any file on this host
//to a guest — and what a guest is handed here it runs as root, at first boot.
//
//AND THE SECOND: the project's copy wins. That is what makes a baseline
//replaceable without editing the app.
//---------------------------------------------------------------------------

let scripts, appDir, workspaceDir, outside;

beforeEach(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-scripts-'));
    appDir = path.join(root, 'app', 'provision');
    workspaceDir = path.join(root, 'workspace', 'provision');
    fs.mkdirSync(appDir, { recursive: true });
    fs.mkdirSync(workspaceDir, { recursive: true });

    fs.writeFileSync(path.join(appDir, 'first-boot.sh'), '# the app first boot\n');
    fs.writeFileSync(path.join(appDir, 'toolchain.sh'), '# the app toolchain\n');
    fs.writeFileSync(path.join(appDir, 'agent.py'), '# the agent\n');
    fs.writeFileSync(path.join(appDir, 'supervisor-skill.md'), '# the skill\n');
    fs.writeFileSync(path.join(appDir, 'notes.txt'), 'not servable\n');

    //SOMETHING WORTH STEALING, one level up from both directories.
    outside = path.join(root, 'secrets.sh');
    fs.writeFileSync(outside, 'the credentials\n');

    scripts = makeScripts({ appDir, workspaceDir });
});

//---- a spec may not name a path --------------------------------------------

test('a plain filename inside the app’s folder resolves', () => {
    assert.equal(scripts.resolve('first-boot.sh'), path.join(appDir, 'first-boot.sh'));
});

test('a path is reduced to its last part, so it cannot escape', () => {
    //WHAT A GUEST IS HANDED HERE IT RUNS AS ROOT, at first boot.
    for (const wanted of [
        '../secrets.sh',
        '../../secrets.sh',
        '/etc/passwd.sh',
        'a/b/../../../secrets.sh',
        'C:\\Windows\\System32\\evil.sh'
    ]) {
        //Either it refuses outright, or it resolves to something INSIDE one of
        //the two folders. Never to the file one level up.
        let got = null;
        try { got = scripts.resolve(wanted); } catch (e) { got = null; }
        if (got !== null) {
            assert.ok(got === path.join(appDir, path.basename(wanted))
                || got === path.join(workspaceDir, path.basename(wanted)),
            wanted + ' resolved to ' + got);
        }
        assert.notEqual(got, outside, wanted);
    }
});

test('and a name that escapes to a real file still does not reach it', () => {
    //THE BASENAME IS TAKEN BEFORE ANYTHING IS JOINED. A check done after
    //joining is a check that has already lost.
    assert.throws(() => scripts.resolve('../secrets.sh'),
        /There is no provisioning script called "secrets.sh"/);
});

test('only the four kinds that are meant to be served are servable', () => {
    assert.ok(scripts.resolve('agent.py'));
    assert.ok(scripts.resolve('supervisor-skill.md'));

    //A GUARD ABOUT WHAT MAY BE SERVED from these folders, so it grows with them
    //rather than meaning "scripts only".
    assert.throws(() => scripts.resolve('notes.txt'), /is not a provisioning file/);
    assert.throws(() => scripts.resolve(''), /is not a provisioning file/);
    assert.throws(() => scripts.resolve(null), /is not a provisioning file/);
    assert.throws(() => scripts.resolve('first-boot'), /is not a provisioning file/);
});

test('a file that is servable but not there says so plainly', () => {
    assert.throws(() => scripts.resolve('nothing-here.sh'),
        /There is no provisioning script called "nothing-here.sh"/);
});

//---- the project's copy wins ------------------------------------------------

test('a project file of the same name replaces the app’s outright', () => {
    fs.writeFileSync(path.join(workspaceDir, 'toolchain.sh'), '# the project toolchain\n');

    //FOR WHEN THE BASELINE ITSELF IS WRONG FOR A PROJECT.
    assert.equal(scripts.resolve('toolchain.sh'), path.join(workspaceDir, 'toolchain.sh'));
    assert.equal(scripts.sourceOf(scripts.resolve('toolchain.sh')), 'the project');
});

test('and the app’s is used when the project brings none', () => {
    assert.equal(scripts.sourceOf(scripts.resolve('first-boot.sh')), 'the app');
});

test('a host with no workspace folder at all still works', () => {
    const only = makeScripts({ appDir, workspaceDir: path.join(appDir, 'nope') });
    assert.equal(only.resolve('first-boot.sh'), path.join(appDir, 'first-boot.sh'));
    assert.deepEqual(only.searchPath(), [appDir]);
});

//---- which file for which stage ---------------------------------------------

test('a stage resolves to its default file', () => {
    assert.equal(scripts.fileFor({ name: 'r1' }, 'firstBoot'), path.join(appDir, 'first-boot.sh'));
});

test('and a machine may name a different one for any stage', () => {
    fs.writeFileSync(path.join(workspaceDir, 'other-toolchain.sh'), '# a different one\n');

    //MAKING A DIFFERENT KIND OF MACHINE IS EDITING OR REPLACING A SCRIPT rather
    //than changing this app.
    const vm = { name: 'r1', spec: { scripts: { toolchain: 'other-toolchain.sh' } } };
    assert.equal(scripts.fileFor(vm, 'toolchain'), path.join(workspaceDir, 'other-toolchain.sh'));
});

test('a machine naming a path for a stage does not escape either', () => {
    const vm = { name: 'r1', spec: { scripts: { toolchain: '../secrets.sh' } } };
    assert.throws(() => scripts.fileFor(vm, 'toolchain'), /no provisioning script/);
});

test('whether a stage exists is a question, not an error to catch', () => {
    //`extra.sh` USUALLY ONLY EXISTS FOR A PROJECT, and its absence is normal.
    assert.equal(scripts.has({ name: 'r1' }, 'extra'), false);

    fs.writeFileSync(path.join(workspaceDir, 'extra.sh'), '# the project adds\n');
    assert.equal(scripts.has({ name: 'r1' }, 'extra'), true);
    assert.equal(scripts.has({ name: 'r1' }, 'firstBoot'), true);
});

test('the stages a file belongs to, so a request by name still works', () => {
    assert.equal(scripts.stageOfFile('first-boot.sh'), 'firstBoot');
    assert.equal(scripts.stageOfFile('supervisor-user.sh'), 'supervisorUser');
    assert.equal(scripts.stageOfFile('nothing.sh'), null);
});

test('root and user are separate stages, not one script switching user', () => {
    //PACKAGES AND /etc ARE ROOT'S, a shell file or a per-user install is the
    //user's, and mixing them is how a home directory ends up owned by root.
    for (const [root, user] of [
        ['toolchain', 'toolchainUser'],
        ['extra', 'extraUser'],
        ['supervisor', 'supervisorUser']
    ]) {
        assert.ok(STAGES[root], root);
        assert.ok(STAGES[user], user);
        assert.notEqual(STAGES[root], STAGES[user]);
    }
});

//---- what is available ------------------------------------------------------

test('everything available is listed, with whose copy would be used', () => {
    fs.writeFileSync(path.join(workspaceDir, 'toolchain.sh'), '# the project toolchain\n');
    fs.writeFileSync(path.join(workspaceDir, 'extra.sh'), '# the project adds\n');

    const listed = scripts.list();
    const by = Object.fromEntries(listed.map((f) => [f.file, f.from]));

    assert.equal(by['toolchain.sh'], 'the project');
    assert.equal(by['extra.sh'], 'the project');
    assert.equal(by['first-boot.sh'], 'the app');

    //ONE ENTRY PER NAME, not one per copy — the question is which would run.
    assert.equal(listed.filter((f) => f.file === 'toolchain.sh').length, 1);
    //AND NOTHING THAT IS NOT SERVABLE.
    assert.equal(by['notes.txt'], undefined);
});

//---- what the app actually ships -------------------------------------------
//
//THE TABLE AND THE FOLDER HAVE TO AGREE. A stage naming a file nobody shipped
//is silent until a machine is halfway through being built: the install reaches
//that stage, asks for a script, and gets "there is no provisioning script
//called X" twenty minutes in.

const SHIPPED = path.join(__dirname, '..', '..', 'src', 'app', 'vms', 'provision', 'scripts');

test('every stage the app owns has a file in the folder the app ships', () => {
    const app = makeScripts({ appDir: SHIPPED });

    //`extra` AND `extraUser` ARE THE PROJECT'S, and their absence is normal —
    //that is the whole difference between the two folders.
    //
    //AND THE THREE SKILLS ARE A WORKSPACE'S. The app shipped one of each until
    //the repo was found to be holding every skill twice — once beside the source
    //and once in `okc-bootstrap.tar` — with the two drifted ten thousand
    //characters apart. The tar is the copy that is true, and a workspace is set
    //up from it, so there is nothing here to ship.
    //
    //THEY ARE STILL IN THE REPO. If that ever stops being true this test is the
    //wrong place to notice; ../library/bootstrap.test.js is where the bundle is
    //held to carrying them.
    //AND SO ARE THE TWO THAT RUN AFTER THE FIRST SNAPSHOT, for the same reason
    //as `extra`: what a machine needs in order to build somebody's project is
    //that project's business, and this app does not know the name of one. A
    //workspace supplying neither gets the ordinary base snapshot and no second
    //turn at all — see ../../src/app/vms/provision/afterwards.js.
    const NOT_OURS = ['extra', 'extraUser', 'afterSnapshot', 'afterSnapshotUser',
        'skill', 'workerSkill', 'judgeSkill'];
    const ours = Object.keys(STAGES).filter((s) => !NOT_OURS.includes(s));

    for (const stage of ours) {
        assert.ok(app.has({ name: 'r1' }, stage),
            stage + ' names ' + STAGES[stage] + ', which the app does not ship');
    }

    //INERTNESS: there are stages, and the loop above ran over them. The floor
    //moved from twelve to eleven when the three skills stopped being the app's
    //to ship — a number that only ever goes down by somebody deciding it should.
    assert.ok(ours.length >= 11, String(ours.length));

    //AND THE THREE ARE REALLY EXCLUDED rather than quietly passing. A list that
    //stopped matching the stage names would leave this test asserting nothing
    //about them while still looking like it covered every stage.
    ['skill', 'workerSkill', 'judgeSkill'].forEach(function (s) {
        assert.ok(STAGES[s], s + ' is not a stage any more, so this exclusion is stale');
        assert.ok(!ours.includes(s));
    });
});

test('and they are sent byte for byte, with the line endings a guest needs', () => {
    //A SHEBANG WITH A CARRIAGE RETURN IS `bad interpreter: /bin/bash^M`, and it
    //is a failure that appears only in a fresh clone — never on the machine the
    //files were written on, and never in a diff. See .gitattributes.
    const runnable = fs.readdirSync(SHIPPED)
        .filter((f) => /\.(sh|py|js)$/.test(f) || f === 'autoinstall-user-data');

    for (const f of runnable) {
        const text = fs.readFileSync(path.join(SHIPPED, f), 'utf8');
        assert.equal(text.includes('\r'), false, f + ' has carriage returns in it');
    }

    assert.ok(runnable.length >= 10, String(runnable.length));
});

test('the installer seed is shipped but not servable, which is deliberate', () => {
    //IT IS HANDED TO VirtualBox's UNATTENDED INSTALLER rather than fetched by a
    //guest, so it has no extension and does not belong on the served list.
    assert.ok(fs.existsSync(path.join(SHIPPED, 'autoinstall-user-data')));

    const app = makeScripts({ appDir: SHIPPED });
    assert.throws(() => app.resolve('autoinstall-user-data'), /is not a provisioning file/);
    assert.equal(app.list().some((f) => f.file === 'autoinstall-user-data'), false);
});

//---- the header, the script, and the machine's own steps --------------------

const where = {
    hostAddress: '192.168.51.63', port: 7443, channelPort: 7374,
    caPort: 7375, caFingerprint: 'ab:cd'
};

test('the script goes in unchanged, between the header and the extra steps', () => {
    const vm = { name: 'r1', spec: { token: 't', setup: [{ name: 'a thing', run: 'apt install cowsay' }] } };
    const said = scripts.render('toolchain', vm, where);

    //THAT IS WHAT KEEPS IT RUNNABLE BY HAND on the machine: the header only
    //defines things, and the steps only come after.
    const header = said.indexOf('OKC_VM=');
    const body = said.indexOf('# the app toolchain');
    const steps = said.indexOf('apt install cowsay');

    assert.ok(header >= 0 && body > header && steps > body, said.slice(0, 200));
    assert.ok(said.includes('# the app toolchain\n'), 'the file itself is not in there unchanged');
});

test('a machine with no extra steps gets no extra steps section', () => {
    const said = scripts.render('toolchain', { name: 'r1', spec: { token: 't' } }, where);
    assert.equal(said.includes("this machine's own setup steps"), false);
});

test('what is SAID about a step is quoted; the step itself is shell', () => {
    const vm = {
        name: 'r1',
        spec: { token: 't', setup: [{ name: "it's a thing", run: 'echo hello' }] }
    };
    const said = scripts.render('toolchain', vm, where);

    //A STEP IS SHELL — that is what somebody typed it as. What we say ABOUT it
    //is a VALUE, and a label carrying a quote must not end the string it is in.
    assert.match(said, /say 'extra step 1: it'\\''s a thing'/);
    assert.match(said, /^echo hello$/m);
});

test('the whole rendered thing is valid shell, label and all', () => {
    const vm = {
        name: "r'1",
        spec: { token: "'; id; '", setup: [{ name: "'; rm -rf /; '", run: 'echo ok' }] }
    };
    try {
        require('node:child_process').execFileSync('bash', ['-n'],
            { input: scripts.render('toolchain', vm, where), stdio: ['pipe', 'ignore', 'pipe'] });
    } catch (e) {
        if (e.code === 'ENOENT') return;   //no bash on this host
        assert.fail('bash -n refused it: ' + String(e.stderr || e.message));
    }
});

test('a file is read fresh every time, so editing one needs no restart', () => {
    const file = path.join(appDir, 'toolchain.sh');
    assert.match(scripts.raw({ name: 'r1' }, 'toolchain'), /the app toolchain/);

    fs.writeFileSync(file, '# edited while running\n');

    //THE ONE PLACE WHERE NOT CACHING IS THE POINT rather than an omission.
    assert.match(scripts.raw({ name: 'r1' }, 'toolchain'), /edited while running/);
});

//---- what this workspace's own folder holds --------------------------------
//
//A BUNDLE CARRIES THIS FOLDER, so what belongs in it is the question. Only the
//kept half: the app's shipped copies travel with the app, and a bundle carrying
//`first-boot.sh` would PIN it — every workspace made from that bundle would
//start with a copy that stops tracking the app the day either changes.
//
//This replaced a table mapping `skills/supervisor.md` onto
//`supervisor-skill.md`. Bundles carry the real names now, so a skill has one
//spelling everywhere and there is nothing to map.

test('it reads the workspace’s own folder, and not the search path', () => {
    fs.writeFileSync(path.join(workspaceDir, 'extra.sh'), '# ours\n');

    const s = makeScripts({ appDir, workspaceDir, keptDir: () => workspaceDir });
    const names = s.kept().map((f) => f.name);

    assert.deepEqual(names, ['extra.sh']);
    assert.ok(!names.includes('first-boot.sh'), 'the app’s own script was included, which pins it');
});

test('it carries the text, so a bundle can be written from it', () => {
    fs.writeFileSync(path.join(workspaceDir, 'extra.sh'), '#!/bin/bash\n# ours\n');

    const s = makeScripts({ appDir, workspaceDir, keptDir: () => workspaceDir });
    assert.equal(s.kept()[0].text, '#!/bin/bash\n# ours\n');
});

test('anything that is not servable is left out', () => {
    fs.writeFileSync(path.join(workspaceDir, 'notes.txt'), 'not a script\n');
    fs.writeFileSync(path.join(workspaceDir, 'extra.sh'), '# ours\n');

    const s = makeScripts({ appDir, workspaceDir, keptDir: () => workspaceDir });
    assert.deepEqual(s.kept().map((f) => f.name), ['extra.sh']);
});

test('no folder yet is no files, and not a failure', () => {
    const s = makeScripts({ appDir, workspaceDir, keptDir: () => path.join(workspaceDir, 'nope') });
    assert.deepEqual(s.kept(), []);
});

test('and with no workspace open there is nothing of its own', () => {
    const s = makeScripts({ appDir, workspaceDir, keptDir: () => null });
    assert.deepEqual(s.kept(), []);
});
