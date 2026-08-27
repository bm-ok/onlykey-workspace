const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const plugin = require('../../src/app/supervisor/server');

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

let dir, defined, asked;

//A REAL DIRECTORY WITH REAL FILES IN IT, because what this does is stat and read
//them — and the two answers that matter are "how big and when" and "the text".
function aHostWith(files) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-skills-'));
    Object.keys(files).forEach((name) => fs.writeFileSync(path.join(dir, name), files[name]));

    const STAGES = { skill: 'supervisor-skill.md', workerSkill: 'runner-skill.md' };

    return {
        app: { host: { actions: { define: (name, spec) => { defined.set(name, spec); return () => {}; } } } },
        log: { on: () => ({ good() {}, warn() {}, bad() {}, info() {} }) },
        //A DOC IS `read`/`write`, which this stub did not have — nothing in
        //this file had ever asked one for anything. `skillPropose` keeps what
        //is waiting in one, so the fake now answers the interface the real one
        //has rather than a shape nobody checked.
        state: {
            app: {
                doc: () => {
                    let held = {};
                    return { read: (or) => (held === null ? (or || {}) : held), write: (v) => { held = v; } };
                }
            }
        },
        ours: {},
        guestApi: { api: () => () => {} },
        provision: {
            STAGES,
            //THE REAL ONE THROWS when a stage is not on the search path, and the
            //list has to survive that rather than take the whole answer down.
            fileFor: (vm, stage) => {
                asked.push({ vm, stage });
                const name = (((vm && vm.spec) || {}).scripts || {})[stage] || STAGES[stage];
                const at = path.join(dir, name || '');
                if (!name || !fs.existsSync(at)) throw new Error('There is no provisioning script called "' + name + '".');
                return at;
            }
        }
    };
}

async function loaded(files) {
    defined = new Map();
    asked = [];
    let service = null;
    await plugin(aHostWith(files), async (_e, s) => { service = s; });
    assert.ok(service, 'the plugin did not register');
    return defined.get('skills');
}

const BOTH = {
    'supervisor-skill.md': '---\nname: supervising\n---\n\n# Supervising\n\nYou decide what work there is.\n',
    'runner-skill.md': '# A worker\n\nThe machine you are on is rolled back underneath you.\n'
};

beforeEach(() => { dir = null; });

//---------------------------------------------------------------------------
//LISTING THEM.
//---------------------------------------------------------------------------

test('with no name it lists what there is, and says nothing goes onto a machine', async () => {
    const skills = await loaded(BOTH);
    const said = skills.run({});

    assert.deepEqual(said.skills.map((s) => s.which), ['supervisor', 'worker']);
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

    assert.equal(said.skills.length, 2);
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
    const skills = await loaded(BOTH);
    const said = skills.run({ which: 'supervisor' });

    assert.match(said.text, /You decide what work there is/);
    assert.equal(said.characters, said.text.length);
    assert.equal(said.lines, said.text.split('\n').length);
    assert.ok(said.where.endsWith('supervisor-skill.md'));
});

test('the worker is a different document, not the same one relabelled', async () => {
    const skills = await loaded(BOTH);
    assert.match(skills.run({ which: 'worker' }).text, /rolled back underneath you/);
});

test('a name this app does not keep is refused, and the refusal lists the ones it does', async () => {
    const skills = await loaded(BOTH);
    assert.throws(() => skills.run({ which: 'judge' }), (e) => {
        assert.match(e.message, /supervisor/);
        assert.match(e.message, /worker/);
        return true;
    });
});

test('and it is two named documents rather than any file in the provisioning directory', async () => {
    //THE POINT OF THE PANE IS THE INSTRUCTIONS GIVEN TO A MODEL. A general file
    //editor pointed at the provisioning directory is a different and much larger
    //thing, and it would arrive without anybody deciding to build it.
    const skills = await loaded(Object.assign({ 'first-boot.sh': '#!/bin/bash\necho hello\n' }, BOTH));

    assert.throws(() => skills.run({ which: 'firstBoot' }));
    assert.throws(() => skills.run({ which: '../../../etc/passwd' }));
    assert.equal(skills.run({}).skills.length, 2);
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
    const skills = await loaded(BOTH);
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
    await loaded(BOTH);
    assert.equal(defined.has('skillSave'), defined.has('skillHolding'),
        'one half of the save handshake exists without the other — a save that cannot know '
        + 'the window is holding unsaved edits is one that silently overwrites them');
    assert.equal(defined.has('skillSave'), true, 'neither half is here, and the drill asks for both');
});

test('a save is refused while the window says it is holding unsaved edits', async () => {
    await loaded(BOTH);
    const hold = defined.get('skillHolding');
    const save = defined.get('skillSave');
    const good = '---\nname: supervising\ndescription: how it works\n---\n\n# Supervising\n\nNew words.\n';

    //ONLY THE WINDOW MAY SAY SO. Anything else claiming it could block every
    //save for ever by saying it once.
    assert.throws(() => hold.run({ which: 'supervisor', holding: true, _overTheWire: true }),
        /Only the window/);

    hold.run({ which: 'supervisor', holding: true });
    assert.throws(() => save.run({ which: 'supervisor', text: good }), /unsaved edits/);

    //AND FORCE SAYS WHAT IT TRAMPLED, rather than saving quietly.
    const forced = save.run({ which: 'supervisor', text: good, force: true });
    assert.equal(forced.saved, true);
    assert.equal(forced.forced, true, 'it saved over unsaved edits and did not say so');

    //THE HOLD IS CLEARED BY THE SAVE, so the next one is ordinary.
    assert.equal(hold.run({ which: 'supervisor', holding: false }).holding, false);
});

test('and a skill without frontmatter is refused, because the CLI would ignore it', async () => {
    await loaded(BOTH);
    const save = defined.get('skillSave');

    //WITHOUT A NAME AND A DESCRIPTION THE CLI NEVER LOADS IT, and the machine
    //works from the wake brief alone — which reads as a model that has stopped
    //following instructions, and is the most expensive way to find a missing
    //header.
    assert.throws(() => save.run({ which: 'supervisor', text: '# Supervising\n\nNo frontmatter.\n' }),
        /frontmatter/);
    assert.throws(() => save.run({ which: 'supervisor', text: '   \n' }),
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
