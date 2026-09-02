const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const makeMemory = require('../../src/app/supervisor/memory');
const statePlugin = require('../../src/app/core/state/main');
const actionsPlugin = require('../../src/app/core/actions/main');
const supervisorPlugin = require('../../src/app/supervisor/server');

//---------------------------------------------------------------------------
//WHAT THE SUPERVISOR KNOWS: the store's rules, and what it may do with them.
//
//THIS FILE WAS THE TODO LIST'S. Most of what it asserted went with the list —
//refs handed out in order, three fixed states, and the refusal that made that
//list worth reading: a supervisor could add and finish but not DELETE, so what
//it had been asked to do could not be quietly emptied.
//
//THE MEMORY INVERTS THAT ON PURPOSE, and it is the one thing here worth reading
//twice. A memory the supervisor may not empty is not its memory. So `memoryForget`
//is on its allowed list, and what is left of the old property is the record —
//every write and every forget is an event under the `memory` tag.
//
//WHAT IS KEPT FROM THE OLD FILE is everything that was about the STORE rather
//than about to-dos: it belongs to the folder it was written in, it refuses a
//write with nowhere to go, and it survives being read again.
//---------------------------------------------------------------------------

const somewhere = () => fs.mkdtempSync(path.join(os.tmpdir(), 'okc-memory-'));

//THE REAL ../core/state, NOT A STAND-IN. The store is what decides what keeping
//something means — the write beside and the move into place — and a fake here
//would be testing the fake.
const aDoc = (dir) => {
    let state = null;
    statePlugin({ dataDir: { at: (...p) => path.join(dir, ...p) } }, async (_e, s) => { state = s.state; });
    return state.app.doc('memory');
};

async function anApp() {
    let actions = null;
    await actionsPlugin({}, async (_e, s) => { actions = s.actions; });

    const dir = somewhere();
    const said = [];
    const logger = { good: (t) => said.push(t), warn: (t) => said.push(t), info: (t) => said.push(t), bad: () => {} };
    //`.on` APPENDS, so a scoped logger has to hand back something scopable —
    //src/app/supervisor/server.js says `say('memory').on('supervisor')`.
    logger.on = () => logger;

    let state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dir, ...p) } }, async (_e, s) => { state = s.state; });

    const here = path.join(dir, 'a-workspace');
    state.follow(async () => here);
    state.at(here);

    await supervisorPlugin(
        {
            app: { host: { actions } }, log: { on: () => logger }, state,
            ours: { canBe: function () { return false; } },
            guestApi: { api: function () { return function () {}; } }
        },
        async () => {}
    );
    return {
        actions, dir, said,
        go: (to) => { state.follow(async () => to); state.at(to); }
    };
}

//---------------------------------------------------------------------------
//THE STORE.
//---------------------------------------------------------------------------

//THE SHAPE THE WHOLE THING TURNS ON. A memory that appended would hold three
//versions of what somebody prefers and nothing to say which is current — which
//is what a list of dated notes becomes after a fortnight, and is why this is
//keyed rather than a list.
test('writing the same name again changes it rather than adding a second copy', () => {
    const memory = makeMemory(aDoc(somewhere()));

    memory.set({ name: 'how the owner likes commits', note: 'small ones' });
    memory.set({ name: 'how the owner likes commits', note: 'small ones, and never force-push to main' });

    const all = memory.all();
    assert.equal(all.length, 1, 'the same name was remembered twice, so nothing says which is true');
    assert.equal(all[0].note, 'small ones, and never force-push to main');
});

//AND IT SAYS WHICH IT WAS, because "remembered" and "changed its mind about" are
//different events and the caller writes different lines for them.
test('it says whether the name was already known', () => {
    const memory = makeMemory(aDoc(somewhere()));

    assert.equal(memory.set({ name: '#131', note: 'waiting on J7' }).was, null,
        'a name never seen before was reported as a change');

    const again = memory.set({ name: '#131', note: 'J7 said no' });
    assert.ok(again.was, 'changing an entry was reported as a new one');
    assert.equal(again.was.note, 'waiting on J7', 'what it used to say was not handed back');
});

//THE CHANGE FROM ./carrying.js, WHICH REQUIRED ONE. A state is right for
//something being waited on and wrong for a fact: "the owner prefers short
//commits" is not in a state, and refusing it for not naming one refuses the fact.
test('a state is optional, and absent rather than empty when it is not given', () => {
    const memory = makeMemory(aDoc(somewhere()));

    const row = memory.set({ name: 'the firmware repo', note: 'do not touch it without asking' }).row;
    assert.equal(row.state, null, 'a memory with no state stored an empty string instead of nothing');

    const waiting = memory.set({ name: '#12', note: 'sent for judging', state: 'waiting on a judge' }).row;
    assert.equal(waiting.state, 'waiting on a judge');
});

test('a name with nothing behind it is refused, and so is a note with no name', () => {
    const memory = makeMemory(aDoc(somewhere()));

    //A NAME ALONE IS A REMINDER THAT THERE WAS SOMETHING TO REMEMBER, which is
    //worse than not writing it down: it takes up a line and answers nothing.
    assert.throws(() => memory.set({ name: 'something' }), /Say what you know/);
    assert.throws(() => memory.set({ name: 'something', note: '   ' }), /Say what you know/);

    assert.throws(() => memory.set({ note: 'a fact with nowhere to live' }), /Say what this is about/);
});

//THE OTHER CHANGE FROM ./carrying.js. Its notes were capped at 500 characters
//deliberately, so it could not become the place a model wrote its reasoning.
//That cap makes a memory useless — a fact whose reason will not fit is a fact
//that loses its reason, and the reason then goes in the chat and is gone when
//the conversation is long.
test('a note holds a paragraph, and keeps the shape of one', () => {
    const memory = makeMemory(aDoc(somewhere()));

    //LONGER THAN THE OLD LIMIT ON PURPOSE, because that is the claim. `carrying`
    //capped a note at 500 characters; anything shorter than that here would pass
    //against either limit and prove nothing.
    const long = 'The owner prefers small commits.\n\n'
        + 'Not a style preference: the judge reads a diff per commit, and a large one comes back unclear. '.repeat(12);
    assert.ok(long.length > 500, 'the fixture is not long enough to tell the two limits apart');

    const row = memory.set({ name: 'commits', note: long }).row;

    assert.ok(row.note.length > 500, 'the note was cut to the old triage limit of 500');
    //COMPARED AGAINST THE TRIMMED FIXTURE, because trimming is what the store is
    //meant to do — the repeated sentence ends in a space, and asserting the raw
    //length would be asserting that it does not.
    assert.equal(row.note, long.trim(), 'the note was cut somewhere before its own cap');
    assert.ok(row.note.includes('\n\n'), 'the line breaks were flattened, so a paragraph became a wall');

    //AND IT IS STILL BOUNDED. It lives in the workspace drawer and is read whole
    //at the head of a waking — a memory big enough to fill a context window
    //crowds out what the waking is about.
    const huge = memory.set({ name: 'huge', note: 'x'.repeat(makeMemory.MOST_NOTE + 500) }).row;
    assert.equal(huge.note.length, makeMemory.MOST_NOTE, 'a note grew past its cap');

    //THE NAME AND THE STATE ARE STILL FLATTENED, because they are labels rather
    //than prose and a two-line label breaks every list that shows one.
    const odd = memory.set({ name: 'a\nb', note: 'x', state: 'c\nd' }).row;
    assert.equal(odd.name, 'a b');
    assert.equal(odd.state, 'c d');
});

test('forgetting takes the one named and says what it was', () => {
    const memory = makeMemory(aDoc(somewhere()));
    memory.set({ name: 'keep', note: 'this one stays' });
    memory.set({ name: 'drop', note: 'this one goes' });

    const gone = memory.forget('drop');
    assert.equal(gone.forgotten, 'drop');
    assert.equal(gone.note, 'this one goes', 'what was forgotten is not said, so the record cannot carry it');

    assert.equal(memory.all().length, 1);
    assert.equal(memory.all()[0].name, 'keep');

    //FORGETTING WHAT IS NOT THERE IS REFUSED rather than reported as done: "it
    //is gone now" and "it was never here" are different answers.
    assert.throws(() => memory.forget('drop'), /Nothing is remembered/);
});

test('it survives being written and read again', () => {
    const dir = somewhere();

    const first = makeMemory(aDoc(dir));
    first.set({ name: '#131', note: 'waiting on J7', state: 'waiting on a judge' });

    const second = makeMemory(aDoc(dir));
    const all = second.all();
    assert.equal(all.length, 1);
    assert.equal(all[0].name, '#131');
    assert.equal(all[0].state, 'waiting on a judge');
});

//IT CANNOT GROW FOR EVER. A memory nobody reads is one that got too long to
//read, and the entries that matter are the ones touched recently.
test('it is capped, oldest first', () => {
    const memory = makeMemory(aDoc(somewhere()));
    const cap = makeMemory.MOST_ROWS;

    for (let i = 0; i < cap + 5; i++) memory.set({ name: 'n' + i, note: 'x' });

    const all = memory.all();
    assert.equal(all.length, cap, 'the memory grew past its cap');
    assert.ok(!all.some((r) => r.name === 'n0'), 'the oldest entry survived the cap');
    assert.ok(all.some((r) => r.name === 'n' + (cap + 4)), 'the newest entry was dropped instead');
});

//---------------------------------------------------------------------------
//AND WHAT A SUPERVISOR MAY DO WITH IT.
//---------------------------------------------------------------------------

test('a supervisor may write, change and forget its own memory', async () => {
    const app = await anApp();

    await app.actions.call('memorySet', { name: '#12', note: 'sent for judging', _overTheWire: true });
    assert.equal((await app.actions.call('memory', {})).memory.length, 1);

    await app.actions.call('memorySet', { name: '#12', note: 'J5 said yes', _overTheWire: true });
    const after = await app.actions.call('memory', {});
    assert.equal(after.memory.length, 1, 'changing its mind added a second entry');
    assert.equal(after.memory[0].note, 'J5 said yes');

    //THE INVERSION FROM THE TODO LIST THIS REPLACES. `todoRemove` refused over
    //the wire, because a list the worker can empty is a list nobody can use to
    //check up on the worker. A MEMORY IS NOT THAT: it is the supervisor's own,
    //and one it may not forget from is not a memory.
    await app.actions.call('memoryForget', { name: '#12', _overTheWire: true });
    assert.equal((await app.actions.call('memory', {})).memory.length, 0,
        'a supervisor could not forget something it had remembered');
});

//WHAT IS LEFT OF THE PROPERTY THE LIST HAD. It may empty this, so what it did
//has to be in the record instead — see the `memory` tag in ../../src/app/core/events.
test('what it wrote and what it forgot are both said out loud', async () => {
    const app = await anApp();

    await app.actions.call('memorySet', { name: 'a thing', note: 'first' });
    await app.actions.call('memorySet', { name: 'a thing', note: 'second' });
    await app.actions.call('memoryForget', { name: 'a thing' });

    const heard = app.said.join(' | ');
    assert.ok(/written down/.test(heard), 'writing something down was not recorded: ' + heard);
    assert.ok(/changed/.test(heard), 'changing its mind was not recorded: ' + heard);
    assert.ok(/forgotten/.test(heard), 'forgetting was not recorded, so it leaves no trace: ' + heard);
});

test('a memory belongs to the folder it was written in, and does not follow', async () => {
    const app = await anApp();

    await app.actions.call('memorySet', { name: '#12', note: 'judge the cut' });
    await app.actions.call('memorySet', { name: 'the maintainer', note: 'answer them' });
    assert.equal((await app.actions.call('memory', {})).memory.length, 2);

    app.go(path.join(app.dir, 'another-project'));
    assert.equal((await app.actions.call('memory', {})).memory.length, 0,
        'the last project’s memory was waiting in a folder it says nothing about');

    //AND WRITING HERE DOES NOT REACH BACK, which is the other half: two
    //memories, not one memory with two projects in it.
    await app.actions.call('memorySet', { name: 'set this one up', note: 'x' });
    assert.equal((await app.actions.call('memory', {})).memory.length, 1);

    app.go(path.join(app.dir, 'a-workspace'));
    const back = await app.actions.call('memory', {});
    assert.equal(back.memory.length, 2, 'coming back did not find what was left here');
    assert.deepEqual(back.memory.map((r) => r.name).sort(), ['#12', 'the maintainer']);
});

test('with no workspace open, the memory is empty and nothing can be written to it', async () => {
    const app = await anApp();
    await app.actions.call('memorySet', { name: 'something', note: 'x' });

    app.go(null);
    assert.equal((await app.actions.call('memory', {})).memory.length, 0,
        'a memory was shown for a folder that is not open');

    //A READ WITH NOWHERE TO READ FROM IS EMPTY; A WRITE REFUSES. Somewhere
    //quietly is how a note ends up kept against the wrong project.
    await assert.rejects(() => app.actions.call('memorySet', { name: 'nowhere', note: 'x' }),
        /No workspace is open/);
});
