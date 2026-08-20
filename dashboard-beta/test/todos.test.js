const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const makeTodos = require('../src/app/supervisor/todos');
const statePlugin = require('../src/app/core/state/main');
const actionsPlugin = require('../src/app/core/actions/main');
const supervisorPlugin = require('../src/app/supervisor/server');

//the list of things to do: the store's own rules, and the one refusal the list
//is worth reading because of.

const somewhere = () => fs.mkdtempSync(path.join(os.tmpdir(), 'okc-todos-'));

//THE REAL ../core/state, NOT A STAND-IN. The store is what decides what keeping
//something means — the write beside and the move into place — and a fake here
//would be testing the fake. It is handed a temp folder rather than the app's.
const aDoc = (dir) => {
    let state = null;
    statePlugin({ dataDir: { at: (...p) => path.join(dir, ...p) } }, async (_e, s) => { state = s.state; });
    return state.app.doc('todo');
};

//THE REAL TABLE, NOT A STAND-IN. `whoAsked` lives on it, and the refusal below
//turns on what it answers — a fake table here would be testing the fake.
async function anApp() {
    let actions = null;
    await actionsPlugin({}, async (_e, s) => { actions = s.actions; });

    const dir = somewhere();
    const said = [];
    const logger = { good: (t) => said.push(t), warn: (t) => said.push(t), info: () => {}, bad: () => {} };

    let state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dir, ...p) } }, async (_e, s) => { state = s.state; });

    await supervisorPlugin(
        { app: { host: { actions } }, log: { on: () => logger }, state },
        async () => {}
    );
    return { actions, dir, said };
}

//COUNTED, NOT RANDOM — and taken from the highest ever used, so removing one does
//not hand its number to the next thing written. Two things in a list that have
//both been called T2 is a reference that stops meaning anything.
test('a ref is never reused, even after the one holding it is gone', () => {
    const todos = makeTodos(aDoc(somewhere()));

    assert.equal(todos.add('first').ref, 'T1');
    assert.equal(todos.add('second').ref, 'T2');
    todos.remove('T2');
    assert.equal(todos.add('third').ref, 'T3', 'T2 was handed out twice');
});

test('it is found by whatever somebody has to hand', () => {
    const todos = makeTodos(aDoc(somewhere()));
    const one = todos.add('look at the fork');

    assert.equal(todos.get('T1').what, 'look at the fork');
    assert.equal(todos.get('1').what, 'look at the fork');
    assert.equal(todos.get(one.id).what, 'look at the fork');
    assert.equal(todos.get('t1').what, 'look at the fork', 'the ref is not case sensitive');
    assert.equal(todos.get('T9'), null);
});

//WHAT IS CHANGED IS WHAT IS PASSED, so marking something done does not quietly
//drop the reason it was written.
test('editing one field leaves the others alone', () => {
    const todos = makeTodos(aDoc(somewhere()));
    todos.add('ask about the coercion in #13', 'it changes what we recommend');

    const after = todos.edit('T1', { state: 'doing' });
    assert.equal(after.what, 'ask about the coercion in #13');
    assert.equal(after.why, 'it changes what we recommend', 'the reason went with the state change');
});

test('when it was finished is kept, cleared on reopen, and moved when it is finished again', () => {
    const todos = makeTodos(aDoc(somewhere()));
    todos.add('a thing');

    const first = todos.edit('T1', { state: 'done' }).done;
    assert.ok(first, 'it recorded when it was done');

    const edited = todos.edit('T1', { what: 'a thing, reworded' });
    assert.equal(edited.done, first, 'editing a finished todo moved its date');

    assert.equal(todos.edit('T1', { state: 'open' }).done, null, 'reopening left the old date on it');

    const again = todos.edit('T1', { state: 'done' }).done;
    assert.ok(again && again !== first, 'finishing it a second time kept the first date');
});

test('a state that is not one of the three is refused, not stored', () => {
    const todos = makeTodos(aDoc(somewhere()));
    todos.add('a thing');

    assert.throws(() => todos.edit('T1', { state: 'nearly' }), /not a state/);
    assert.equal(todos.get('T1').state, 'open', 'it wrote the bad state anyway');
    assert.throws(() => todos.add('another', null, 'whenever'), /not a state/);
});

test('a line nobody could read is refused rather than stored empty', () => {
    const todos = makeTodos(aDoc(somewhere()));
    assert.throws(() => todos.add('   '), /Say what is to be done/);
    todos.add('real');
    assert.throws(() => todos.edit('T1', { what: '' }), /nothing in it is not a todo/);
});

test('what is stored is trimmed to what a list can show', () => {
    const todos = makeTodos(aDoc(somewhere()));
    const one = todos.add('x'.repeat(500), 'y'.repeat(3000));
    assert.equal(one.what.length, 200);
    assert.equal(one.why.length, 2000);

    //one line, whatever was pasted in — this is what shows in a list of twenty
    assert.equal(todos.add('two   spaces\tand a tab').what, 'two spaces and a tab');
});

test('it survives being written and read again', () => {
    const dir = somewhere();
    makeTodos(aDoc(dir)).add('written by one', 'and read by another');

    const later = makeTodos(aDoc(dir)).all();
    assert.equal(later.length, 1);
    assert.equal(later[0].what, 'written by one');
    assert.equal(later[0].ref, 'T1');
});

//---------------------------------------------------------------------------
//THE REFUSAL THAT MAKES THE LIST WORTH READING.
//---------------------------------------------------------------------------

test('a supervisor may add to the list and say who it was', async () => {
    const { actions } = await anApp();

    const mine = await actions.call('todoAdd', { what: 'from the window' });
    assert.equal(mine.by, 'the window');

    const theirs = await actions.call('todoAdd', { what: 'from the pipe', _overTheWire: true });
    assert.equal(theirs.by, 'the command line', 'it could not tell the two ends apart');
});

test('a supervisor may mark something done', async () => {
    const { actions } = await anApp();
    await actions.call('todoAdd', { what: 'a thing', _overTheWire: true });

    const after = await actions.call('todoSet', { id: 'T1', state: 'done', _overTheWire: true });
    assert.equal(after.state, 'done');
    assert.equal(after.was, 'open');
});

test('a supervisor may not take something off the list', async () => {
    const { actions } = await anApp();
    await actions.call('todoAdd', { what: 'the one it would want gone' });

    await assert.rejects(
        () => actions.call('todoRemove', { id: 'T1', _overTheWire: true }),
        /in the window, by a person/);

    const still = await actions.call('todos');
    assert.equal(still.todos.length, 1, 'it went anyway — the refusal came after the removal');
});

test('a person at the window may', async () => {
    const { actions } = await anApp();
    await actions.call('todoAdd', { what: 'a thing' });

    const gone = await actions.call('todoRemove', { id: 'T1' });
    assert.equal(gone.ref, 'T1');
    assert.equal((await actions.call('todos')).todos.length, 0);
});

//A LIST TWO THINGS WRITE TO IS ONE WHERE "WHO" IS THE FIRST QUESTION, and only
//the moves are worth a line in the record — a rewording is not.
test('the record says when something moved, and not when it was reworded', async () => {
    const { actions, said } = await anApp();
    await actions.call('todoAdd', { what: 'a thing' });
    assert.equal(said.length, 1, 'adding it was not recorded');

    await actions.call('todoSet', { id: 'T1', what: 'a thing, reworded' });
    assert.equal(said.length, 1, 'a rewording reached the record');

    await actions.call('todoSet', { id: 'T1', state: 'doing' });
    assert.equal(said.length, 2);
    assert.match(said[1], /open to doing, by the window/);
});
