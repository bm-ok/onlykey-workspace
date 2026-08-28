const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const plugin = require('../../src/app/supervisor/server');
const versionsPlugin = require('../../src/app/core/versions/server');

//---------------------------------------------------------------------------
//THE INSTRUCTIONS A MODEL IS GIVEN, READ IN THE WINDOW.
//
//This is the actual control surface. The loop a supervisor works to, what it may
//propose and what it may never do are twenty-six thousand characters of prose,
//and until this pane existed they were a file only somebody with a checkout
//could read — so "what is it actually being told" was not a question anybody
//could answer while looking at the thing.
//
//NOTHING IS INSTALLED ON A MACHINE, which is why editing it is cheap and why
//this reads from the provisioning search path rather than from anywhere on a
//guest: it is fetched from this host at the head of every turn.
//---------------------------------------------------------------------------

let dir, kept, mineDir, versions, defined, asked;

//A REAL DIRECTORY WITH REAL FILES IN IT, because what this does is stat and read
//them — and the two answers that matter are "how big and when" and "the text".
function aHostWith(files) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-skills-'));
    kept = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-skills-kept-'));
    //THE WORKSPACE'S OWN PROVISION FOLDER, kept apart from `dir` on purpose:
    //a test where read-from and written-to are the same folder cannot tell
    //the two apart, which is the whole thing that went wrong.
    mineDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-skills-mine-'));
    Object.keys(files).forEach((name) => fs.writeFileSync(path.join(dir, name), files[name]));

    const STAGES = {
        skill: 'supervisor-skill.md',
        workerSkill: 'runner-skill.md',
        judgeSkill: 'judge-skill.md'
    };

    return {
        //---- THE ACTION TABLE, WITH THE TWO THINGS THE REAL ONE HAS --------
        //
        //`define` WAS THE WHOLE FAKE, and that was enough only for as long as
        //nothing here was exercised end to end. `skillApprove` does its writing
        //by CALLING `skillSave` through the table, and `skillPropose` asks who
        //is asking — so a stub with neither could only ever test doors that
        //talk to nobody.
        app: {
            host: {
                actions: {
                    define: (name, spec) => { defined.set(name, spec); return () => {}; },
                    call: (name, args) => {
                        const door = defined.get(name);
                        assert.ok(door, 'nothing defined "' + name + '"');
                        return door.run(args || {});
                    },
                    //THE SAME ANSWER THE REAL ONE GIVES, which is the whole of
                    //what attribution rests on: down the pipe it is the command
                    //line, and at the window it is the window.
                    whoAsked: (a) => ((a && (a._overTheWire || a._driven)) ? 'the command line' : 'the window')
                }
            }
        },
        //A LOGGER THAT CAN BE NARROWED AGAIN, which the real one can: this
        //file tags itself `todo` and then says supervisor things through
        //`log.on('supervisor')`, because a rewritten skill filed under todos is
        //a line nobody reading about the supervisor would ever find.
        log: { on: function again() { return { on: again, good() {}, warn() {}, bad() {}, info() {} }; } },
        //A DOC IS `read`/`write`, which this stub did not have — nothing in
        //this file had ever asked one for anything. `skillPropose` keeps what
        //is waiting in one, so the fake now answers the interface the real one
        //has rather than a shape nobody checked.
        state: {
            app: {
                //WHERE COPIES OF WHAT WAS APPROVED GO. ../../src/app/core/versions
                //roots itself here, so without it every version is dropped with a
                //warning and this file would prove nothing about keeping any.
                where: kept,
                doc: () => {
                    let held = {};
                    return { read: (or) => (held === null ? (or || {}) : held), write: (v) => { held = v; } };
                }
            }
        },
        ours: {},
        guestApi: { api: () => () => {} },
        //THE REAL ONE, NOT A FAKE. What has to hold is that a save and an
        //approval keep a copy that can be READ BACK — and a stub of `versions`
        //here would agree with whatever this file did and prove nothing. It is
        //rooted at `state.app.where`, which is why the stub above grew one.
        versions: versions,
        provision: {
            STAGES,
            //WHERE A PERSON'S OWN COPY GOES, which is NOT where one is read
            //from. A skill is read off a search path and written to the
            //workspace's own drawer -- writing back over whichever file it had
            //read is what put an edit inside a build output, where the next
            //rebuild silently reverted it.
            keptFor: async (stage) => path.join(mineDir, STAGES[stage]),
            freshen: async () => {},
            //THE REAL ONE THROWS when a stage is not on the search path, and the
            //list has to survive that rather than take the whole answer down.
            fileFor: (vm, stage) => {
                asked.push({ vm, stage });
                const name = (((vm && vm.spec) || {}).scripts || {})[stage] || STAGES[stage];
                if (!name) throw new Error('There is no provisioning script called "' + name + '".');

                //THE SEARCH PATH, IN THE ORDER THE REAL ONE USES IT: what a
                //person wrote, then what the app ships. Modelling only the
                //second made a second save unable to see what the first one had
                //written, so "nothing changed, so nothing was written" could
                //never happen -- which is the one behaviour that tells a save
                //apart from a no-op.
                for (const where of [mineDir, dir]) {
                    const at = path.join(where, name);
                    if (fs.existsSync(at)) return at;
                }
                throw new Error('There is no provisioning script called "' + name + '".');
            }
        }
    };
}

async function loaded(files) {
    defined = new Map();
    asked = [];
    let service = null;
    //THE HOST IS BUILT FIRST, because standing `versions` up needs the
    //folder it makes -- and the supervisor is handed the result.
    const host = aHostWith(files);
    await versionsPlugin(
        { app: host.app, log: host.log, state: host.state },
        async (_e, v) => { versions = v.versions; }
    );
    host.versions = versions;
    await plugin(host, async (_e, s) => { service = s; });
    assert.ok(service, 'the plugin did not register');
    return defined.get('skills');
}

//NAMED `ALL` AND NOT `BOTH`, BECAUSE THERE ARE THREE. The worker's file used to
//go to judges as well, which is what made two look like the whole set.
const ALL = {
    'supervisor-skill.md': '---\nname: supervising\n---\n\n# Supervising\n\nYou decide what work there is.\n',
    'runner-skill.md': '# A worker\n\nThe machine you are on is rolled back underneath you.\n',
    'judge-skill.md': '# A judge\n\nYou are not here to do the work. You may not push.\n'
};

beforeEach(() => { dir = null; });

//---------------------------------------------------------------------------
//LISTING THEM.
//---------------------------------------------------------------------------

test('with no name it lists what there is, and says nothing goes onto a machine', async () => {
    const skills = await loaded(ALL);
    const said = skills.run({});

    assert.deepEqual(said.skills.map((s) => s.which), ['supervisor', 'worker', 'judge']);
    assert.ok(said.skills.every((s) => s.there && s.bytes > 0 && s.edited),
        'a skill that is on disk was listed as though it were not');
    assert.match(said.note, /nothing is installed on a machine/i);
});

test('one that is not on the search path is a row, not an error', async () => {
    //A PROJECT CAN REPLACE EITHER OF THESE and one of them being absent is a
    //fact worth showing. Letting it throw would take the OTHER one down with it,
    //so the pane would say nothing at all about a skill that is perfectly there.
    const skills = await loaded({ 'supervisor-skill.md': '# Supervising\n' });
    const said = skills.run({});

    assert.equal(said.skills.length, 3);
    const worker = said.skills.find((s) => s.which === 'worker');
    assert.equal(worker.there, false);
    assert.equal(worker.bytes, null);
    assert.equal(worker.edited, null);
    //STILL NAMED AND STILL DESCRIBED, because "this exists and is missing" and
    //"this is not a thing" are different answers.
    assert.ok(worker.title && worker.about);
});

//---------------------------------------------------------------------------
//READING ONE.
//---------------------------------------------------------------------------

test('naming one gives the text, and how much of it there is', async () => {
    const skills = await loaded(ALL);
    const said = skills.run({ which: 'supervisor' });

    assert.match(said.text, /You decide what work there is/);
    assert.equal(said.characters, said.text.length);
    assert.equal(said.lines, said.text.split('\n').length);
    assert.ok(said.where.endsWith('supervisor-skill.md'));
});

test('the worker is a different document, not the same one relabelled', async () => {
    const skills = await loaded(ALL);
    assert.match(skills.run({ which: 'worker' }).text, /rolled back underneath you/);
});

test('a name this app does not keep is refused, and the refusal lists the ones it does', async () => {
    const skills = await loaded(ALL);
    //THIS ASKED FOR 'judge' AND EXPECTED A REFUSAL, which was correct when there
    //were two — and was also the whole fault written down as a passing test. A
    //judge has its own document now, so the name that is not a skill has to be a
    //name that is genuinely not one.
    assert.throws(() => skills.run({ which: 'operator' }), (e) => {
        assert.match(e.message, /supervisor/);
        assert.match(e.message, /worker/);
        assert.match(e.message, /judge/);
        return true;
    });
});

test('the judge is a third document, and not the worker one relabelled', async () => {
    //THE FAULT THIS EXISTS FOR: one file went to both roles and it is the
    //worker's, which opens by telling its reader to commit and push its branch —
    //the one thing a judge may not do. See ../vms/dispatch-script.test.js for
    //the other half, which is that the right one is actually fetched.
    const skills = await loaded(ALL);
    const judge = skills.run({ which: 'judge' });
    const worker = skills.run({ which: 'worker' });

    assert.notEqual(judge.text, worker.text);
    assert.match(judge.text, /may not push/);
    assert.ok(judge.where.endsWith('judge-skill.md'));
});

test('and it is named documents rather than any file in the provisioning directory', async () => {
    //THE POINT OF THE PANE IS THE INSTRUCTIONS GIVEN TO A MODEL. A general file
    //editor pointed at the provisioning directory is a different and much larger
    //thing, and it would arrive without anybody deciding to build it.
    const skills = await loaded(Object.assign({ 'first-boot.sh': '#!/bin/bash\necho hello\n' }, ALL));

    assert.throws(() => skills.run({ which: 'firstBoot' }));
    assert.throws(() => skills.run({ which: '../../../etc/passwd' }));
    assert.equal(skills.run({}).skills.length, 3);
});

//---------------------------------------------------------------------------
//AND WHOSE COPY IT IS.
//---------------------------------------------------------------------------

test('it reads the stage default and never one machine\'s substitute', async () => {
    //A MACHINE MAY NAME A DIFFERENT FILE FOR ANY STAGE in its spec, and that is
    //exactly what must not happen here: this pane is about the document THIS
    //HOST serves at the head of every turn, not about what one machine happened
    //to be built with. Passing a vm would make the pane's answer depend on which
    //machine somebody had in mind, silently.
    const skills = await loaded(ALL);
    skills.run({ which: 'supervisor' });
    skills.run({});

    assert.ok(asked.length, 'nothing was resolved at all, so this proves nothing');
    assert.ok(asked.every((a) => a.vm === null),
        'a machine was handed to fileFor, so a spec could choose what this pane shows');
});

//---------------------------------------------------------------------------
//AND THE SAVE, WHICH IS BOTH HALVES OR NEITHER.
//
//THIS CHECKED THAT NEITHER EXISTED, and it was right for as long as that was
//true: `skillSave` is refused while a window holds unsaved edits, `skillHolding`
//is how it knows, and a save without that silently overwrites whoever is typing.
//The drill in the kit — "changing its instructions" — had been failing on the
//absence the whole time, four of its six checks unrunnable behind it.
//
//SO THE CLAIM MOVES RATHER THAN GOING. What mattered was never that they were
//missing; it was that one without the other is worse than neither. That is what
//is checked now, and it is the check that would catch somebody porting half of
//it again.
//---------------------------------------------------------------------------

test('the save and the handshake arrive together, or not at all', async () => {
    await loaded(ALL);
    assert.equal(defined.has('skillSave'), defined.has('skillHolding'),
        'one half of the save handshake exists without the other — a save that cannot know '
        + 'the window is holding unsaved edits is one that silently overwrites them');
    assert.equal(defined.has('skillSave'), true, 'neither half is here, and the drill asks for both');
});

test('a save is refused while the window says it is holding unsaved edits', async () => {
    await loaded(ALL);
    const hold = defined.get('skillHolding');
    const save = defined.get('skillSave');
    const good = '---\nname: supervising\ndescription: how it works\n---\n\n# Supervising\n\nNew words.\n';

    //ONLY THE WINDOW MAY SAY SO. Anything else claiming it could block every
    //save for ever by saying it once.
    assert.throws(() => hold.run({ which: 'supervisor', holding: true, _overTheWire: true }),
        /Only the window/);

    hold.run({ which: 'supervisor', holding: true });
    await assert.rejects(() => save.run({ which: 'supervisor', text: good }), /unsaved edits/);

    //AND FORCE SAYS WHAT IT TRAMPLED, rather than saving quietly.
    const forced = await save.run({ which: 'supervisor', text: good, force: true });
    assert.equal(forced.saved, true);
    assert.equal(forced.forced, true, 'it saved over unsaved edits and did not say so');

    //THE HOLD IS CLEARED BY THE SAVE, so the next one is ordinary.
    assert.equal(hold.run({ which: 'supervisor', holding: false }).holding, false);
});

test('and a skill without frontmatter is refused, because the CLI would ignore it', async () => {
    await loaded(ALL);
    const save = defined.get('skillSave');

    //WITHOUT A NAME AND A DESCRIPTION THE CLI NEVER LOADS IT, and the machine
    //works from the wake brief alone — which reads as a model that has stopped
    //following instructions, and is the most expensive way to find a missing
    //header.
    await assert.rejects(() => save.run({ which: 'supervisor', text: '# Supervising\n\nNo frontmatter.\n' }),
        /frontmatter/);
    await assert.rejects(() => save.run({ which: 'supervisor', text: '   \n' }),
        /nothing in it/);
});

test('and a supervisor could not call one anyway', async () => {
    //WHERE "IT MAY NOT REWRITE ITS OWN INSTRUCTIONS" ACTUALLY LIVES. Not in a
    //refusal here — in the allowlist, which is the only door it has.
    const allowed = require('../../src/app/supervisor/allowed');
    ['skillSave', 'skillHolding', 'skills', 'skillApprove'].forEach((name) => {
        assert.equal(allowed.may(name), false, name + ' is on the supervisor\'s list');
    });

    //---- AND THE ONE THING IT MAY DO WITH THEM -------------------------
    //
    //IT MAY ASK. The line is between proposing and approving, exactly as it is
    //for a job, a prompt and a contract — and a system meant to get better at
    //this over time cannot be shut out of the one document that says what it
    //is. What it writes is served to nobody until a person moves it.
    //
    //ASSERTED HERE BECAUSE THE ALLOWLIST IS THE ONLY DOOR. A refusal written
    //anywhere else is a second opinion about the same question.
    assert.equal(allowed.may('skillPropose'), true,
        'it cannot say what it thinks is wrong with its own instructions');
});

//---------------------------------------------------------------------------
//AND WHAT IT HAS BEEN.
//
//A SKILL IS REWRITTEN IN PLACE, so before ../../src/app/core/versions the
//previous answer was simply gone — "it has been working to different
//instructions since Tuesday" was not a question anybody could ask.
//
//THE HALF THAT WAS MISSING WAS THE SAVE. `skillApprove` kept a copy from the
//day proposals existed and `skillSave` kept nothing, so half of what a skill
//had ever been was kept and half was overwritten. It is the same asymmetry
//../library had, and the same answer: writing it at the window IS the reading,
//because nothing but the window can reach the door.
//---------------------------------------------------------------------------

const A_SKILL = '---\nname: supervising\ndescription: what to do\n---\n\n# Supervising\n\nOne.\n';

test('a save keeps a copy of what was written, and it reads back', async () => {
    const skills = await loaded(ALL);
    assert.equal(defined.get('skillVersions').run({ which: 'supervisor' }).versions.length, 0);

    await defined.get('skillSave').run({ which: 'supervisor', text: A_SKILL });

    const said = defined.get('skillVersions').run({ which: 'supervisor' });
    assert.equal(said.versions.length, 1);
    assert.equal(said.versions[0].first, true);
    assert.equal(said.newest.text, A_SKILL);
    assert.equal(said.newest.by, 'the window');
    //A FIRST VERSION IS NOT A CHANGE TO ANYTHING, and drawing it as one would
    //mark every line as added.
    assert.equal(said.newest.changed, null);
});

test('a second save keeps what changed, against what was written before it', async () => {
    const skills = await loaded(ALL);
    await defined.get('skillSave').run({ which: 'supervisor', text: A_SKILL });
    await defined.get('skillSave').run({ which: 'supervisor', text: A_SKILL.replace('One.', 'One.\nAnd two.') });

    const said = defined.get('skillVersions').run({ which: 'supervisor' });
    assert.equal(said.versions.length, 2);
    assert.equal(said.newest.added, 1);
    assert.equal(said.newest.gone, 0);
    assert.match(said.newest.changed, /^\+ And two\.$/m);
});

test('a save that changes nothing keeps nothing, because nothing was written', async () => {
    const skills = await loaded(ALL);
    await defined.get('skillSave').run({ which: 'supervisor', text: A_SKILL });
    const again = await defined.get('skillSave').run({ which: 'supervisor', text: A_SKILL });

    assert.equal(again.saved, false);
    assert.equal(defined.get('skillVersions').run({ which: 'supervisor' }).versions.length, 1);
});

test('each skill has its own past, and they do not share one', async () => {
    const skills = await loaded(ALL);
    await defined.get('skillSave').run({ which: 'supervisor', text: A_SKILL });

    //ALL THREE ARE THIS HOST'S, so the id is the plain name — no workspace in
    //front of it, unlike a job. What must still hold is that they are three
    //separate histories.
    assert.equal(defined.get('skillVersions').run({ which: 'supervisor' }).versions.length, 1);
    assert.equal(defined.get('skillVersions').run({ which: 'worker' }).versions.length, 0);
    assert.equal(defined.get('skillVersions').run({ which: 'judge' }).versions.length, 0);
});

test('the listing says which one has something waiting and how much is kept', async () => {
    const skills = await loaded(ALL);
    await defined.get('skillSave').run({ which: 'supervisor', text: A_SKILL });

    const rows = skills.run({}).skills;
    const sup = rows.find((r) => r.which === 'supervisor');
    //WITHOUT THESE THE MASTER COLUMN CANNOT SAY ANYTHING ABOUT A SKILL IT IS
    //NOT SHOWING — and a proposal hidden behind an unselected row is a decision
    //made by silence.
    assert.equal(sup.kept, 1);
    assert.equal(sup.waiting, false);
    assert.equal(rows.find((r) => r.which === 'judge').kept, 0);
});

test('an older version is read by the moment it was written, and the newest by default', async () => {
    const skills = await loaded(ALL);
    await defined.get('skillSave').run({ which: 'supervisor', text: A_SKILL });
    await defined.get('skillSave').run({ which: 'supervisor', text: A_SKILL.replace('One.', 'Two.') });

    const all = defined.get('skillVersions').run({ which: 'supervisor' }).versions;
    const first = all[all.length - 1];

    assert.match(defined.get('skillVersion').run({ which: 'supervisor', at: first.at }).text, /One\./);
    assert.match(defined.get('skillVersion').run({ which: 'supervisor' }).text, /Two\./);
});

test('asking for a version of something that is not a skill is refused', async () => {
    const skills = await loaded(ALL);
    assert.throws(() => defined.get('skillVersions').run({ which: 'operator' }), /not a skill/);
    assert.throws(() => defined.get('skillVersion').run({ which: 'operator' }), /not a skill/);
});

test('nothing kept is an answer, not a failure', async () => {
    const skills = await loaded(ALL);
    const said = defined.get('skillVersions').run({ which: 'judge' });

    //"NOTHING KEPT" AND "IT COULD NOT BE READ" ARE DIFFERENT SENTENCES, and a
    //panel that drew an error for the ordinary state of a file nobody has
    //rewritten yet is one nobody would trust.
    assert.deepEqual(said.versions, []);
    assert.equal(said.newest, null);
    assert.match(said.note, /Versions start at the first save or approval/);
    //READING one, though, is a refusal: there is nothing to hand back.
    assert.throws(() => defined.get('skillVersion').run({ which: 'judge' }), /Nothing has been kept/);
});

//---------------------------------------------------------------------------
//THE GUARDS.
//
//`skillApprove` CARRIED `protect: true` AND IT MEANT NOTHING. Nothing in
//../../src/app/core/actions or ../../src/app/guards reads that field off an
//ACTION — it is the prop a window CONTROL takes — so it sat in the source
//looking exactly like a guard and refused nothing at all. `okc.js skillApprove`
//went straight through to the door's own checks.
//
//WHICH IS THE ONE THING THIS MUST NOT ALLOW: what is approved here is a
//document a model wrote about its own instructions. A purple button with no
//refusal behind it is theatre — the command line calls the action instead of
//pressing the button.
//---------------------------------------------------------------------------

test('approving a skill is refused down the pipe and when a press is driven', async () => {
    const skills = await loaded(ALL);
    const approve = defined.get('skillApprove');

    for (const mark of ['_overTheWire', '_driven']) {
        await assert.rejects(
            () => approve.run({ which: 'supervisor', [mark]: true }),
            /may not ratify its own/,
            mark + ' reached the approval'
        );
    }
});

test('rewriting a skill is refused down the pipe, because a save here is an approval', async () => {
    const skills = await loaded(ALL);
    const save = defined.get('skillSave');

    for (const mark of ['_overTheWire', '_driven']) {
        await assert.rejects(
            () => save.run({ which: 'supervisor', text: A_SKILL, [mark]: true }),
            /done in the window/,
            mark + ' rewrote a skill'
        );
    }

    //AND NOTHING WAS WRITTEN OR KEPT BY THE ATTEMPT, which is the half that
    //would be silent: a refusal that has already had its effect is not one.
    assert.equal(defined.get('skillVersions').run({ which: 'supervisor' }).versions.length, 0);
});

test('a drill may still do both, exactly as it may for a contract', async () => {
    //`_fromTest` IS NOT `_overTheWire`, DELIBERATELY. It is how a run gets
    //something it can then dispatch, and the app being ported from draws the
    //same line — see ../../src/app/library/server.js.
    const skills = await loaded(ALL);
    const said = await defined.get('skillSave').run({ which: 'supervisor', text: A_SKILL, _fromTest: true });
    assert.equal(said.saved, true);
});

test('no action declares protect, because on an action it does nothing', async () => {
    //THE FIELD IS REAL ON A WINDOW CONTROL AND DEAD ON AN ACTION, which is the
    //worst kind of dead: it reads as a guard to whoever adds the next one. If
    //this ever fails, either the field became real — in which case delete this
    //test — or somebody wrote a guard that is not one.
    const fs2 = require('node:fs');
    const path2 = require('node:path');
    const APP = path2.join(__dirname, '..', '..', 'src', 'app');

    const found = [];
    (function walk(at) {
        for (const e of fs2.readdirSync(at, { withFileTypes: true })) {
            const here = path2.join(at, e.name);
            if (e.isDirectory()) { if (e.name !== 'vendor') walk(here); continue; }
            if (e.name !== 'server.js' && e.name !== 'main.js') continue;
            const src = fs2.readFileSync(here, 'utf8');
            if (/^\s*protect:\s*true\s*,?\s*$/m.test(src)) found.push(path2.relative(APP, here));
        }
    })(APP);

    assert.deepEqual(found, [], 'these declare a guard that refuses nothing: ' + found.join(', '));
});

//---------------------------------------------------------------------------
//AND WHOSE CHANGE IT WAS.
//
//`skillApprove` DOES ITS WRITING BY CALLING `skillSave`, and `skillSave` is
//what keeps the copy. Two keeps of the same text deduplicate and the FIRST one
//wins — so without the attribution travelling with it, every approved proposal
//was filed as "written at the window" and both who asked for it and the
//argument that was actually approved were lost.
//---------------------------------------------------------------------------

test('an approved proposal is kept as the proposer, with the argument made for it', async () => {
    const skills = await loaded(ALL);

    defined.get('skillPropose').run({
        which: 'supervisor',
        text: A_SKILL.replace('One.', 'One, and a reason.'),
        why: 'the loop skipped a step nobody could see',
        _overTheWire: true
    });

    await defined.get('skillApprove').run({ which: 'supervisor' });

    const said = defined.get('skillVersions').run({ which: 'supervisor' });
    assert.equal(said.versions.length, 1);
    assert.equal(said.newest.why, 'the loop skipped a step nobody could see');
    assert.notEqual(said.newest.by, 'the window');
    assert.match(said.newest.text, /One, and a reason\./);
});

test('a proposal is what a person writing one makes too, so both are approved the same way', async () => {
    //THE PANE SAVES BY PROPOSING. Writing the file straight from the window
    //would make a skill the one document in this app that changes what a machine
    //is told on a single press, while a contract of forty words needs somebody
    //to read it and say so afterwards.
    //
    //WHICH MEANS ONE REVIEW SURFACE, whoever wrote the thing being reviewed —
    //asserted here because nothing else would notice if `skillPropose` started
    //refusing the window.
    const skills = await loaded(ALL);
    const said = defined.get('skillPropose').run({
        which: 'supervisor', text: A_SKILL, why: 'because I said so'
    });

    assert.equal(said.which, 'supervisor');
    //NOTHING IS SERVED FROM IT YET, which is the whole of what proposing means.
    assert.match(skills.run({ which: 'supervisor' }).text, /You decide what work there is/);
    assert.ok(skills.run({ which: 'supervisor' }).proposed);
    assert.equal(skills.run({}).skills.find((r) => r.which === 'supervisor').waiting, true);
});

//---------------------------------------------------------------------------
//ASKING, AND THEN FINDING OUT.
//
//THE GAP THESE CLOSE: a supervisor could propose a change to its own
//instructions and had no way to learn what happened to it. Approving keeps a
//version and drops the proposal; refusing drops it and says why into the
//conversation. Both are right, and between them the drawer is empty afterwards
//either way — and an empty drawer reads exactly like never having asked.
//
//Something that cannot tell "still waiting" from "turned down" either asks
//again into silence or stops asking. Neither is a thing improving itself.
//---------------------------------------------------------------------------

test('with nothing asked, it says so rather than looking like a refusal', async () => {
    await loaded(ALL);
    const said = defined.get('skillAsked').run({ which: 'supervisor' });

    assert.equal(said.waiting, null);
    assert.deepEqual(said.decided, []);
    //NOT "NOTHING HAS BEEN ASKED", which is more than this knows. Answers are
    //recorded from the day recording started, and a supervisor reading this
    //beside a conversation that held two refusals caught it saying otherwise.
    assert.match(said.note, /no answer has been recorded here/i);
});

test('a proposal that is waiting says so, and says since when', async () => {
    await loaded(ALL);
    defined.get('skillPropose').run({
        which: 'supervisor', text: A_SKILL, why: 'the loop skipped a step', _overTheWire: true
    });

    const said = defined.get('skillAsked').run({ which: 'supervisor' });
    assert.equal(said.waiting.why, 'the loop skipped a step');
    assert.ok(said.waiting.at);
    assert.match(said.note, /Waiting on a person/);

    //AND NEVER THE TEXT, of the proposal or of the skill. This answers what
    //happened, not what either document says — see ../../src/app/supervisor/allowed.js.
    assert.equal(JSON.stringify(said).indexOf('Supervising'), -1);
});

test('an approval is an answer it can find, not only a document that changed under it', async () => {
    await loaded(ALL);
    defined.get('skillPropose').run({
        which: 'supervisor', text: A_SKILL, why: 'because the loop skipped a step', _overTheWire: true
    });
    await defined.get('skillApprove').run({ which: 'supervisor' });

    const said = defined.get('skillAsked').run({ which: 'supervisor' });
    assert.equal(said.waiting, null);
    assert.equal(said.decided[0].what, 'approved');
    assert.equal(said.decided[0].why, 'because the loop skipped a step');
    assert.match(said.note, /last answer was "approved"/);
});

test('a refusal carries the reason, which is the whole of what changes the next one', async () => {
    await loaded(ALL);
    defined.get('skillPropose').run({
        which: 'supervisor', text: A_SKILL, why: 'I want to skip the judge', _overTheWire: true
    });
    defined.get('skillReject').run({ which: 'supervisor', why: 'a judge is the point, not an obstacle' });

    const said = defined.get('skillAsked').run({ which: 'supervisor' });
    assert.equal(said.decided[0].what, 'turned down');
    //BOTH HALVES. "Turned down" on its own says nothing about which idea was
    //turned down, and the person's reason is what the next proposal has to go on.
    assert.equal(said.decided[0].why, 'I want to skip the judge');
    assert.equal(said.decided[0].because, 'a judge is the point, not an obstacle');
});

test('the answers are kept newest first, and do not grow without limit', async () => {
    await loaded(ALL);
    for (let i = 0; i < 15; i++) {
        defined.get('skillPropose').run({
            which: 'supervisor', text: A_SKILL, why: 'try ' + i, _overTheWire: true
        });
        defined.get('skillReject').run({ which: 'supervisor', why: 'no, ' + i });
    }

    const all = defined.get('skillAsked').run({ which: 'supervisor' });
    //THE SHAPE OF RECENT ANSWERS IS WHAT IS USEFUL — that three in a row were
    //turned down for the same reason is worth knowing, and the one from March
    //is not. Six come back; twelve are kept.
    assert.equal(all.decided.length, 6);
    assert.equal(all.decided[0].why, 'try 14');
});

test('each skill has its own answers, and they do not run together', async () => {
    await loaded(ALL);
    defined.get('skillPropose').run({ which: 'worker', text: A_SKILL, why: 'a worker thing', _overTheWire: true });
    defined.get('skillReject').run({ which: 'worker', why: 'not that' });

    assert.equal(defined.get('skillAsked').run({ which: 'worker' }).decided.length, 1);
    assert.equal(defined.get('skillAsked').run({ which: 'supervisor' }).decided.length, 0);
    assert.equal(defined.get('skillAsked').run({ which: 'judge' }).decided.length, 0);
});

//---- and what it has been -------------------------------------------------

test('it can read how its instructions have changed, without being handed them', async () => {
    await loaded(ALL);
    await defined.get('skillSave').run({ which: 'supervisor', text: A_SKILL });
    await defined.get('skillSave').run({ which: 'supervisor', text: A_SKILL.replace('One.', 'One.\nTwo.') });

    const said = defined.get('skillHistory').run({ which: 'supervisor' });
    assert.equal(said.versions.length, 2);
    assert.equal(said.versions[0].added, 1);
    assert.equal(said.versions[1].first, true);
    assert.ok(said.versions[0].characters > 0);

    //NO TEXT. Four versions of a twenty-seven-thousand-character skill would be
    //a hundred thousand characters handed back to answer "has this been getting
    //longer" — and the document itself is already in front of it.
    assert.equal(JSON.stringify(said).indexOf('Supervising'), -1);
});

test('both reads refuse a name that is not a skill', async () => {
    await loaded(ALL);
    assert.throws(() => defined.get('skillAsked').run({ which: 'operator' }), /not a skill/);
    assert.throws(() => defined.get('skillHistory').run({ which: 'operator' }), /not a skill/);
});

test('a supervisor may ask both, and still may not read or ratify the document', async () => {
    const allowed = require('../../src/app/supervisor/allowed');

    //THE POINT OF THE PAIR: proposing is worth something only if the answer can
    //be found, and neither of these hands back a document.
    assert.equal(allowed.may('skillAsked'), true);
    assert.equal(allowed.may('skillHistory'), true);

    ['skills', 'skillSave', 'skillApprove', 'skillHolding'].forEach((name) => {
        assert.equal(allowed.may(name), false, name + ' is on the supervisor\'s list');
    });
});

//---------------------------------------------------------------------------
//WHAT A SUPERVISOR FOUND WHEN IT WAS ASKED TO READ ITS OWN INSTRUCTIONS.
//
//It could not. Asked to compare the document it works to against the tools it
//has, it answered: "the 28,040-character supervisor skill was not handed to me
//this waking — all I got was the harness prompt and a one-line 'use the
//supervising skill' — and no tool will show me its text". Then it declined to
//propose a change, rather than guess at wording it could not read.
//
//THE REASON `skills` WAS KEPT OFF THE ALLOWLIST WAS WRONG. It said the document
//is already in front of a supervisor because the CLI fetches it at the head of
//every waking — and fetching is not reading. A skill's name and description sit
//in context; the body loads when the skill is INVOKED, so a turn that never
//invokes it never sees a word.
//
//AND THE NAME IT KNOWS ITSELF BY WAS REFUSED. The frontmatter says
//`name: supervising` and the wake brief says "use the supervising skill", while
//this door took only `supervisor`. The one name it had was the one name that
//did not work.
//---------------------------------------------------------------------------

test('it can read the document it is governed by', async () => {
    const skills = await loaded(ALL);
    const said = await defined.get('skillReading').run({ which: 'supervisor' });

    assert.match(said.text, /You decide what work there is/);
    assert.equal(said.characters, said.text.length);
    //AND IS TOLD WHAT TO DO ABOUT IT, since reading it is only useful if
    //saying what is wrong with it goes somewhere.
    assert.match(said.note, /skillPropose/);
});

test('the name in its own frontmatter is a name this app answers to', async () => {
    const skills = await loaded(ALL);

    //`supervising` IS WHAT THE WAKE BRIEF SAYS AND WHAT THE FILE CALLS ITSELF.
    //A refusal that is correct and unguessable reads as the feature not being
    //there — which is how it was reported.
    assert.equal((await defined.get('skillReading').run({ which: 'supervising' })).which, 'supervisor');
    assert.equal(defined.get('skillAsked').run({ which: 'supervising' }).which, 'supervisor');
    assert.equal(defined.get('skillHistory').run({ which: 'supervising' }).which, 'supervisor');
});

test('an alias files under one name, so a history is not split in two', async () => {
    const skills = await loaded(ALL);
    defined.get('skillPropose').run({
        which: 'supervising', text: A_SKILL, why: 'asked for by the name it knows', _overTheWire: true
    });

    //ASKED FOR UNDER EITHER NAME, IT IS THE SAME ONE THING. Filing under the
    //alias would put half of a skill's history in a drawer nothing else reads.
    assert.ok(defined.get('skillAsked').run({ which: 'supervisor' }).waiting);
    assert.ok(defined.get('skillAsked').run({ which: 'supervising' }).waiting);
});

test('a name that is neither a skill nor an alias is still refused', async () => {
    const skills = await loaded(ALL);
    await assert.rejects(() => defined.get('skillReading').run({ which: 'operator' }), /not a skill/);
});

test('with no answers recorded it says so without claiming none were ever asked', async () => {
    const skills = await loaded(ALL);
    const said = defined.get('skillAsked').run({ which: 'supervisor' });

    //IT CAUGHT THIS TOO: the window had turned two proposals down and this read
    //said nothing had ever been asked, because answers are recorded from the day
    //recording started. Honest is "nothing recorded here", not "nothing asked".
    assert.match(said.note, /no answer has been recorded here/);
    assert.doesNotMatch(said.note, /nothing has been asked/);
});

test('a supervisor may read what governs it, and still may not change or ratify it', async () => {
    const allowed = require('../../src/app/supervisor/allowed');

    assert.equal(allowed.may('skillReading'), true);
    ['skills', 'skillSave', 'skillApprove', 'skillHolding'].forEach((name) => {
        assert.equal(allowed.may(name), false, name + ' is on the supervisor\'s list');
    });
});
