const { test } = require('node:test');
const assert = require('node:assert');

const plugin = require('../../src/app/inbox/server');

//---------------------------------------------------------------------------
//EVERYTHING WAITING ON A PERSON, AS ONE LIST.
//
//THE PROMISE IS "IF THIS IS EMPTY, NOTHING NEEDS YOU", which is why most of
//what is asserted here is about what the list does NOT claim: it is composed
//from live facts rather than stored, it names the sources it is not reading,
//and it leaves out things that are true but are not errands.
//---------------------------------------------------------------------------

function anInbox(over) {
    const o = over || {};
    const defined = new Map();

    return {
        defined,
        imports: {
            app: {
                host: {
                    actions: {
                        define: (name, spec) => { defined.set(name, spec); return () => {}; },
                        call: async (what) => {
                            if (what === 'vmList') {
                                if (o.vmListThrows) throw new Error('VirtualBox is not answering');
                                return { vms: o.live || [] };
                            }
                            return null;
                        }
                    }
                }
            },
            log: { on: () => ({ good() {}, warn() {}, bad() {}, info() {} }) },
            library: o.library === null ? {} : Object.assign({
                jobs: { all: () => o.jobs || [] },
                prompts: { all: () => o.prompts || [] },
                contracts: { all: () => o.contracts || [] }
            }, o.library || {}),
            ours: { read: () => o.register || [] },
            guests: { all: () => o.guests || [] }
        }
    };
}

async function loaded(over) {
    const w = anInbox(over);
    let service = null;
    await plugin(w.imports, async (_e, s) => { service = s; });
    assert.ok(service, 'the plugin did not register');
    w.inbox = w.defined.get('inbox');
    assert.ok(w.inbox, 'inbox is not defined');
    return w;
}

//---------------------------------------------------------------------------
//NOTHING WAITING.
//---------------------------------------------------------------------------

test('an empty list says which sources it is not reading', async () => {
    //A PARTIAL LIST IN THE SHAPE OF A COMPLETE ONE IS WORSE THAN A SHORT ONE
    //here more than anywhere, because the whole promise is "if this is empty,
    //nothing needs you".
    const said = await (await loaded({})).inbox.run({});

    assert.deepEqual(said.items, []);
    assert.ok(said.notCounted.length, 'it claimed to be reading everything');
    assert.match(said.note, /not yet reading/);
});

//---------------------------------------------------------------------------
//THINGS TO APPROVE.
//---------------------------------------------------------------------------

test('an unapproved job is waiting, and an approved one is not', async () => {
    const w = await loaded({
        jobs: [
            { id: 'j1', name: 'build it', approved: false, written: '2026-01-01T00:00:00.000Z' },
            { id: 'j2', name: 'already read', approved: true }
        ]
    });
    const said = await w.inbox.run({});

    assert.equal(said.items.length, 1);
    assert.equal(said.items[0].what, 'build it');
    assert.match(said.items[0].kind, /job to approve/);
    assert.match(said.items[0].why, /Nothing can run it/);
});

test('one that was approved and then edited says that, because it is a different thing', async () => {
    //"WRITTEN AND NEVER APPROVED" AND "APPROVED, THEN CHANGED" ARE NOT THE SAME
    //REQUEST. The second means what was approved is not what would be sent.
    const w = await loaded({ prompts: [{ id: 'p1', name: 'ask it', approved: false, lapsed: true }] });
    const said = await w.inbox.run({});

    assert.match(said.items[0].why, /approved and then edited/);
});

test('a judging artifact points at the Judge tab, not at Actions', async () => {
    //COUNTED TOGETHER, THIS ONCE PUT A BADGE ON A TAB THE THINGS WERE NOT ON and
    //sent a button to a pane where they are not — reported as a button that
    //fails to switch tabs, which is exactly what it looked like.
    const w = await loaded({
        contracts: [
            { id: 'c1', name: 'for a worker', approved: false, kind: 'task' },
            { id: 'c2', name: 'for a judge', approved: false, kind: 'judge' }
        ]
    });
    const said = await w.inbox.run({});

    const worker = said.items.find((i) => i.what === 'for a worker');
    const judge = said.items.find((i) => i.what === 'for a judge');

    assert.equal(worker.where.view, 'actions');
    assert.equal(worker.where.pane, 'contracts');
    assert.equal(judge.where.view, 'judge');
    assert.equal(judge.where.pane, 'judges');
    //AND WHICH ROW TO LAND ON, so arriving means arriving at the thing.
    assert.equal(judge.where.pick, 'c2');
});

//---------------------------------------------------------------------------
//A MACHINE THAT IS OFF AND STILL HOLDING A SIGN-IN.
//---------------------------------------------------------------------------

test('a stopped machine holding a sign-in is waiting, with the reason it cannot just be forgotten', async () => {
    const w = await loaded({
        register: [{ name: 'runner2', holdsCredential: true, guest: 'work-1' }],
        live: [{ name: 'runner2', state: 'poweroff' }]
    });
    const said = await w.inbox.run({});

    assert.equal(said.items.length, 1);
    assert.equal(said.items[0].what, 'runner2');
    assert.match(said.items[0].why, /newer than the copy here/);
    assert.equal(said.items[0].where.view, 'runners');
});

test('one that is RUNNING is not waiting on anybody', async () => {
    //A RUNNING MACHINE HOLDING A CREDENTIAL IS A MACHINE AT WORK. Listing it
    //would put a permanent row on a list whose value is being empty.
    const w = await loaded({
        register: [{ name: 'runner2', holdsCredential: true, guest: 'work-1' }],
        live: [{ name: 'runner2', state: 'running' }]
    });
    assert.deepEqual((await w.inbox.run({})).items, []);
});

test('and a stopped machine holding nothing is not waiting either', async () => {
    const w = await loaded({
        register: [{ name: 'runner2', holdsCredential: false, guest: null }],
        live: [{ name: 'runner2', state: 'poweroff' }]
    });
    assert.deepEqual((await w.inbox.run({})).items, []);
});

//---------------------------------------------------------------------------
//AND IT SURVIVES A SOURCE THAT WILL NOT ANSWER.
//---------------------------------------------------------------------------

test('a register that cannot be read does not empty the list', async () => {
    //ONE SOURCE FAILING MUST NOT LOOK LIKE "NOTHING NEEDS YOU". The jobs below
    //are still true and still waiting.
    const w = await loaded({
        jobs: [{ id: 'j1', name: 'build it', approved: false }],
        vmListThrows: true,
        register: [{ name: 'runner2', holdsCredential: true, guest: 'work-1' }]
    });
    const said = await w.inbox.run({});

    //THE JOB IS STILL THERE, and the machine is judged from the register alone,
    //which still knows who holds what.
    assert.ok(said.items.some((i) => i.what === 'build it'));
});

test('a library that throws leaves the rest of the list standing', async () => {
    const w = await loaded({
        library: { jobs: { all: () => { throw new Error('the library is gone'); } } },
        register: [{ name: 'runner2', holdsCredential: true, guest: 'work-1' }],
        live: [{ name: 'runner2', state: 'poweroff' }]
    });
    const said = await w.inbox.run({});

    assert.ok(said.items.some((i) => i.what === 'runner2'),
        'one failing source took the whole list down');
});

//---------------------------------------------------------------------------
//AND WHAT IT DELIBERATELY DOES NOT LIST.
//---------------------------------------------------------------------------

test('every item can say where to go, because one that cannot is one to go and find', async () => {
    const w = await loaded({
        jobs: [{ id: 'j1', name: 'build it', approved: false }],
        register: [{ name: 'runner2', holdsCredential: true, guest: 'work-1' }],
        live: [{ name: 'runner2', state: 'poweroff' }]
    });
    const said = await w.inbox.run({});

    assert.ok(said.items.length >= 2);
    said.items.forEach((i) => {
        assert.ok(i.where && i.where.view, i.what + ' does not say where to go');
        assert.ok(i.key, i.what + ' has no key, so the pane cannot track the row');
        assert.ok(i.why, i.what + ' does not say why it needs somebody');
    });
});

test('keys are stable across two readings, so a row is not rebuilt every draw', async () => {
    const w = await loaded({ jobs: [{ id: 'j1', name: 'build it', approved: false }] });
    const first = await w.inbox.run({});
    const again = await w.inbox.run({});

    assert.deepEqual(first.items.map((i) => i.key), again.items.map((i) => i.key));
});
