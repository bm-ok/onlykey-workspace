const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const actionsPlugin = require('../../src/app/core/actions/main');
const diyPlugin = require('../../src/app/diy/server');

//---------------------------------------------------------------------------
//THE ONE PRESS.
//
//FOUR ACTS TO THE APP AND ONE ACT TO THE PERSON. Take the machine out of the
//pool, bring it up, lay the cut on it, lend it the sign-in, open it. What this
//file holds is the two claims that make it one press rather than a macro:
//
//  * EVERY STEP IS SKIPPED IF IT IS ALREADY TRUE. Otherwise the second press of
//    the day re-lays a workspace over work in progress and lends a credential
//    that is already there — and both of those are quiet.
//  * IT REFUSES RATHER THAN GUESSING which machine and which sign-in, and the
//    refusal carries the list, because that is the moment somebody is least
//    likely to know what there is.
//
//NOTHING HERE TOUCHES A MACHINE. Every action it calls is a stand-in that
//records the call, so the ORDER is what is being tested — which is the part
//that cannot be seen by reading, and the part that costs a rolled-back disk
//when it is wrong.
//---------------------------------------------------------------------------

let kept, called, vms, guests;

function doc() {
    return Promise.resolve({
        read: function (fallback) { return kept === null ? fallback : JSON.parse(JSON.stringify(kept)); },
        write: function (v) { kept = JSON.parse(JSON.stringify(v)); return v; }
    });
}

//THE MACHINE AS THE REGISTER HOLDS IT. `forTasks: false` is kept back,
//`connected` is dialled in, `branch` is what it claims.
const VM = (over) => Object.assign({
    name: 'beta-diy1', running: false, connected: false,
    forTasks: undefined, branch: null, holdsCredential: false, tags: ['worker']
}, over || {});

beforeEach(() => {
    kept = null;
    called = [];
    vms = { 'beta-diy1': VM() };
    guests = [
        { name: 'worker-b2', role: 'worker', has: true, holder: null },
        { name: 'super-a2', role: 'supervisor', has: true, holder: null }
    ];
});

async function anApp() {
    let actions = null;
    await actionsPlugin({}, async (_e, s) => { actions = s.actions; });

    //THE ACTIONS THE PRESS LEANS ON, EACH RECORDING AND EACH MOVING THE WORLD
    //THE WAY THE REAL ONE WOULD — a stand-in that records but does not change
    //what the next step reads would let "skip if already true" pass by never
    //becoming true.
    const stub = (name, fn) => actions.define(name, { about: name, run: async (a) => { called.push(name); return fn ? fn(a || {}) : {}; } });

    stub('vmForTasks', (a) => { vms[a.name].forTasks = false; return { name: a.name }; });
    stub('vmStart', (a) => { vms[a.name].running = true; return { name: a.name }; });
    stub('vmAwait', (a) => { vms[a.name].connected = true; return { name: a.name }; });
    stub('vmWorkspace', (a) => { vms[a.name].branch = a.branch; return { name: a.name }; });
    stub('guestLend', (a) => { vms[a.machine].holdsCredential = true; return { name: a.name }; });
    stub('guests', () => ({ guests: guests }));
    stub('credentialsHeld', () => ({ guests: guests }));
    stub('branchBoard', () => ({ branches: [{ name: 'diy/flat', in: ['a', 'b'], cut: true }] }));

    await diyPlugin({
        app: { host: { actions } },
        log: { on: () => ({ info: () => {}, good: () => {}, warn: () => {}, bad: () => {} }) },
        editor: { open: async (it) => { called.push('editor.open'); return { opened: it.dir, on: it.remote, using: 'code' }; } },
        ssh: {
            ensure: () => ({}), writeConfig: () => 'ssh_config', ensureInclude: () => ({ added: false }),
            readingOf: (vm) => ({ name: vm.name, address: '10.0.0.2', user: 'okc', alias: 'okc-' + vm.name, usesOurKey: true })
        },
        ours: {
            get: (n) => vms[n],
            read: () => Object.keys(vms).map((k) => vms[k])
        },
        repoWorkspaces: { folderFor: () => '/home/okc/workspace' },
        state: { here: { doc: doc } }
    }, async () => {});

    return actions;
}

const start = (actions, over) =>
    actions.call('diyStart', Object.assign({ title: 'flat workspace layout', cut: 'diy/flat' }, over || {}));

//---- who may press it ------------------------------------------------------

test('the command line is refused, and told where the button is', async () => {
    const actions = await anApp();
    const it = await start(actions);

    await assert.rejects(
        () => actions.call('diyOpen', { id: it.id, _overTheWire: true }),
        (e) => {
            assert.match(e.message, /person's press/i);
            assert.match(e.message, /DIY/);
            return true;
        }
    );
    assert.equal(called.filter((c) => c === 'editor.open').length, 0);
});

//---- the whole sequence, in order ------------------------------------------

test('from cold it does all five, in order', async () => {
    const actions = await anApp();
    const it = await start(actions);

    const said = await actions.call('diyOpen',
        { id: it.id, machine: 'beta-diy1', signIn: 'worker-b2', _fromTest: true });

    //THE ORDER IS THE CLAIM. Laying the workspace before the machine has
    //dialled in has nothing to talk to; lending the sign-in before the
    //workspace puts a credential on a machine that may still fail to set up.
    assert.deepEqual(
        called.filter((c) => c !== 'credentialsHeld' && c !== 'branchBoard' && c !== 'guests'),
        ['vmForTasks', 'vmStart', 'vmAwait', 'vmWorkspace', 'guestLend', 'editor.open']
    );

    assert.equal(said.machine, 'beta-diy1');
    assert.equal(said.cut, 'diy/flat');
    assert.equal(said.opened, '/home/okc/workspace');
    assert.equal(said.on, 'okc-beta-diy1');

    //AND IT SAYS WHAT IT DID. A press that performs five acts on real machines
    //and answers "ok" is one nobody can check afterwards.
    assert.ok(said.did.length >= 5, said.did.join(' | '));
    assert.match(said.note, /kept beta-diy1 back/);
});

test('the second press does nothing but open it', async () => {
    const actions = await anApp();
    const it = await start(actions);

    await actions.call('diyOpen', { id: it.id, machine: 'beta-diy1', signIn: 'worker-b2', _fromTest: true });
    called = [];

    await actions.call('diyOpen', { id: it.id, _fromTest: true });

    //THIS IS WHAT MAKES IT THE SAME PRESS TWICE. Re-laying a workspace over
    //work in progress moves the host's checkouts about and re-clones on the
    //machine; re-lending a credential that is already there is a second
    //credential movement nobody asked for. Both are quiet when they happen.
    assert.deepEqual(called.filter((c) => c !== 'credentialsHeld' && c !== 'branchBoard'), ['editor.open']);
});

test('it remembers the machine and the sign-in, so it only asks once', async () => {
    const actions = await anApp();
    const it = await start(actions);

    await actions.call('diyOpen', { id: it.id, machine: 'beta-diy1', signIn: 'worker-b2', _fromTest: true });

    const list = await actions.call('diy', {});
    const mine = list.items[0];
    assert.equal(mine.machine.name, 'beta-diy1');
    assert.equal(mine.machine.running, true);
});

test('a machine already up and on the branch is only opened', async () => {
    const actions = await anApp();
    vms['beta-diy1'] = VM({ running: true, connected: true, forTasks: false, branch: 'diy/flat', holdsCredential: true });

    const it = await start(actions);
    await actions.call('diyOpen', { id: it.id, machine: 'beta-diy1', _fromTest: true });

    assert.deepEqual(called.filter((c) => c !== 'credentialsHeld' && c !== 'branchBoard'), ['editor.open']);
});

//---- what it refuses to guess ----------------------------------------------

test('with no cut there is nowhere for the work to go', async () => {
    const actions = await anApp();
    const it = await actions.call('diyStart', { title: 'no cut on this' });

    await assert.rejects(
        () => actions.call('diyOpen', { id: it.id, machine: 'beta-diy1', _fromTest: true }),
        /no branch cut, so there is nowhere for the work to go/
    );
    assert.equal(called.filter((c) => c === 'editor.open').length, 0);
});

test('with no machine it refuses, and the refusal carries the list', async () => {
    const actions = await anApp();
    const it = await start(actions);

    await assert.rejects(
        () => actions.call('diyOpen', { id: it.id, _fromTest: true }),
        (e) => {
            assert.match(e.message, /has no machine yet/);
            //THE LIST IS THE POINT. This is the moment somebody is least likely
            //to know which machines exist, and a refusal they have to go to
            //another tab to act on is one that costs the press.
            assert.match(e.message, /beta-diy1/);
            return true;
        }
    );
});

test('with no sign-in it refuses, and names the ones that are free', async () => {
    const actions = await anApp();
    const it = await start(actions);

    await assert.rejects(
        () => actions.call('diyOpen', { id: it.id, machine: 'beta-diy1', _fromTest: true }),
        (e) => {
            assert.match(e.message, /no sign-in chosen/);
            assert.match(e.message, /worker-b2 \(worker\)/);
            //A SUPERVISOR SIGN-IN IS NOT A THING TO OFFER HERE. Lending one to
            //a runner is refused downstream anyway, and offering it makes the
            //refusal something the person walks into.
            assert.ok(!/super-a2/.test(e.message), e.message);
            return true;
        }
    );

    //AND IT STOPPED BEFORE THE EDITOR, having already done the earlier steps —
    //which is correct: they are what it could do, and each is skipped next time.
    assert.equal(called.filter((c) => c === 'editor.open').length, 0);
});

test('a machine that is not in the register is refused by name', async () => {
    const actions = await anApp();
    const it = await start(actions);

    await assert.rejects(
        () => actions.call('diyOpen', { id: it.id, machine: 'nope', _fromTest: true }),
        /no machine called "nope"/
    );
});

test('nothing is remembered when the press falls over', async () => {
    const actions = await anApp();
    const it = await start(actions);

    await assert.rejects(() => actions.call('diyOpen', { id: it.id, machine: 'beta-diy1', _fromTest: true }));

    //WRITTEN AFTER, NOT BEFORE. A piece of work claiming a sign-in that was
    //never lent is a seat that draws as ready and cannot be opened.
    const list = await actions.call('diy', {});
    assert.equal(list.items[0].signIn, null);
});
