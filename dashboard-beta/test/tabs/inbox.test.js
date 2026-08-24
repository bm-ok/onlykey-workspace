const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const actionsPlugin = require('../../src/app/core/actions/main');
const statePlugin = require('../../src/app/core/state/main');
const inboxPlugin = require('../../src/app/inbox/server');
const libraryPlugin = require('../../src/app/library/server');

//---------------------------------------------------------------------------
//WHAT THE LIBRARY PUTS ON THE LIST OF THINGS WAITING ON A PERSON.
//
//THE PROMISE IS "IF THIS IS EMPTY, NOTHING NEEDS YOU". A job, prompt or
//contract nobody has read is the plainest case there is: a model may write one
//and may not approve its own, so an unread one is work that has silently
//stopped and will sit there for a week.
//
//---- THE REAL LIBRARY, AND THAT IS THE POINT OF THIS FILE ------------------
//
//This used to hand the inbox a stand-in shaped like the library:
//
//    jobs: { all: () => o.jobs || [] }
//
//and every test here passed. The real `all()` reads a document off disk and is
//ASYNC, so the code being tested handed a PROMISE to `.filter`, threw on every
//call, and was swallowed by a `catch` whose comment read "the library is not
//answering". An unapproved job never once reached the list. The count somebody
//would have trusted was always zero, and this file said it was fine.
//
//A STUB EASIER TO SATISFY THAN THE THING IT STANDS IN FOR TESTS THE STUB. It is
//the third time in one sitting: ../runners/onmachine.test.js had arrays where
//the queue and the judge return promises, and ../vms/busy's ledger had a
//stand-in that recorded nothing. Every one was green.
//
//So the library here is the REAL plugin, on a real temporary state directory.
//It is a few more lines of setup and it is the only version of this file that
//can fail when it should.
//---------------------------------------------------------------------------

let actions, inbox, library, dataDir, state;

beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-inbox-'));

    let table = null;
    await actionsPlugin({}, async (_e, s) => { table = s.actions; });
    actions = table;

    let made = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dataDir, ...p) } },
        async (_e, s) => { made = s.state; });
    state = made;

    //A LIBRARY IS KEPT PER WORKSPACE, not per host — what a worker may be told
    //is a fact about the folder that is open. So one has to be, or `save`
    //refuses with "there is nowhere to keep this", which is the right refusal
    //and not the subject of this file.
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-inbox-ws-'));
    state.follow(async () => work);

    const quiet = { on: () => ({ info() {}, good() {}, warn() {}, bad() {} }) };

    let box = null;
    await inboxPlugin({ app: { host: { actions } }, log: quiet }, async (_e, s) => { box = s.inbox; });
    inbox = box;

    let lib = null;
    await libraryPlugin({ app: { host: { actions } }, log: quiet, state, inbox },
        async (_e, s) => { lib = s.library; });
    library = lib;
});

const ask = () => actions.call('inbox', {});

//WRITTEN THE WAY A MODEL WRITES ONE, which is the case this list exists for.
//
//THE SECOND ARGUMENT IS WHAT DECIDES. `save(body)` defaults to "the window" and
//approves as it writes — somebody at the screen typed it, so somebody read it.
//Anything else waits, because a model may write one and may not ratify its own.
//That is the gate, and it is why an unwritten-down `by` would have made every
//test in this file pass with nothing waiting.
async function write(shelf, body) {
    return await library[shelf].save(body, 'the command line');
}

//---- what is waiting ------------------------------------------------------

test('an unapproved job is waiting, and an approved one is not', async () => {
    const one = await write('jobs', { name: 'build it', kind: 'task', code: 'echo hi' });

    let out = await ask();
    assert.equal(out.count, 1, 'an unapproved job did not reach the list');
    assert.equal(out.items[0].what, 'build it');
    assert.match(out.items[0].kind, /job to approve/);

    //AND IT DISAPPEARS BY THE FACT CHANGING, which is the whole design: nothing
    //here is stored and nothing is marked read.
    await library.jobs.approve(one.id);
    out = await ask();
    assert.equal(out.count, 0, 'an approved job is still being called an errand');
});

test('one that was approved and then edited says that, because it is a different thing', async () => {
    //---- THE EDIT HAS TO HAPPEN WHERE AN APPROVAL CAN SURVIVE IT -----------
    //
    //A SAVE DOWN THE PIPE THAT CHANGES ANYTHING CLEARS THE APPROVAL OUTRIGHT --
    //see ../../src/app/library/entries.js, `made.approval = atWindow ? ... :
    //(changed ? null : ...)`. So that route can never produce `lapsed`; it
    //produces plain unapproved, which the list already reports.
    //
    //`lapsed` IS FOR THE BODY MOVING UNDER A RECORD NOBODY TOUCHED, and for a
    //job the body is the SCRIPT ON DISK. Editing that file changes what would
    //run while every field of the record, and every badge drawn from it, stays
    //exactly as it was. That is the case worth a different sentence: somebody
    //read this and said so, and then it changed.
    const one = await write('jobs', { name: 'run it', kind: 'task', code: 'echo first' });
    await library.jobs.approve(one.id);
    assert.equal((await ask()).count, 0, 'an approved job is being called an errand');

    const where = await state.here.where();
    fs.writeFileSync(path.join(where, 'jobs', one.id + '.js'), 'echo quite different');

    const out = await ask();
    assert.equal(out.count, 1, 'the script changed under an approval and the list said nothing');
    assert.match(out.items[0].why, /approved and then edited/);
});

//---- and where it sends you -----------------------------------------------

test('a judging one points at the Judge tab, and a task one at Worker', async () => {
    await write('jobs', { name: 'read a change', kind: 'judge', code: 'echo hi' });
    await write('jobs', { name: 'do the work', kind: 'task', code: 'echo hi' });

    const out = await ask();
    const by = {};
    out.items.forEach((i) => { by[i.what] = i.where; });

    //TWO MEANINGS OF `kind` MEET IN ONE ROW. What the thing IS — a job — and who
    //it is FOR. Counted together they once put a badge on a tab the things were
    //not on, and sent a button to a pane where they are not.
    assert.equal(by['read a change'].view, 'Judge');
    assert.equal(by['do the work'].view, 'Worker');

    //THE PANE NAME IS THE ONE ../ui/shell REGISTERED, capitalised. A lower-case
    //one lands on the tab with no pane chosen, which looks like the row simply
    //not working.
    assert.equal(by['do the work'].pane, 'Jobs');
});

test('every item can say where to go, because one that cannot is one to go and find', async () => {
    await write('jobs', { name: 'a', kind: 'task', code: 'x' });
    await write('prompts', { name: 'b', kind: 'judge', text: 'x' });
    await write('contracts', { name: 'c', kind: 'task', text: 'x' });

    const out = await ask();
    assert.equal(out.count, 3);
    out.items.forEach((i) => {
        assert.ok(i.where && i.where.view, i.what + ' does not say which tab');
        assert.ok(i.key, i.what + ' has no stable key, so the pane cannot draw a list of them');
    });
});

//---- and what it is not counting -------------------------------------------

test('the sources nobody has written are named even when something IS waiting', async () => {
    await write('jobs', { name: 'build it', kind: 'task', code: 'x' });

    const out = await ask();
    assert.equal(out.count, 1);
    //A PARTIAL LIST IN THE SHAPE OF A COMPLETE ONE is the failure this guards.
    //Having found something must not stop it saying where it did not look.
    assert.ok(out.notCounted.length >= 4, 'a list with an item on it stopped saying what it cannot see');
});
