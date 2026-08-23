const { test } = require('node:test');
const assert = require('node:assert');

const plugin = require('../../src/app/supervisor/server');

//---------------------------------------------------------------------------
//WHETHER THERE IS A SUPERVISOR, AND WHETHER IT CAN ACTUALLY RUN.
//
//THREE THINGS HAVE TO BE TRUE AND THE THIRD IS THE ONE THAT GETS MISSED. The
//machine exists, it is up and dialled in, and it is HOLDING A CLAUDE SIGN-IN.
//Without the third it starts, runs, exits in about three seconds and reports
//that it asked for nothing — which from outside is indistinguishable from a
//supervisor that had nothing to do. That is the failure this answer exists to
//make visible, so it is the one most of these tests are about.
//
//AND IT IS ABOUT THIS APP'S REGISTER. Before it was ported the pane described
//the machines of the app being ported FROM: a read that answers plausibly about
//somebody else's world, which is the quietest way a ported pane can be wrong.
//---------------------------------------------------------------------------

const A_MACHINE = { name: 'beta-super1', tags: ['supervisor'] };

async function loaded(world) {
    const w = world || {};
    const defined = new Map();
    let service = null;

    await plugin({
        app: {
            host: {
                actions: {
                    define: (name, spec) => { defined.set(name, spec); return () => {}; },
                    //`vmList` IS ASKED FOR BY NAME rather than being a graph
                    //edge, so it is stubbed the same way the real one arrives.
                    call: async (what) => {
                        if (what !== 'vmList') throw new Error('unexpected call: ' + what);
                        if (w.vmListThrows) throw new Error('the register is not answering');
                        return { vms: w.live || [] };
                    }
                }
            }
        },
        log: { on: () => ({ good() {}, warn() {}, bad() {}, info() {} }) },
        state: { app: { doc: () => ({ get: () => ({}), set() {} }) } },
        ours: {
            read: () => w.register || [],
            //THE ROLE IS ../vms/ours's ANSWER, not a tag list read again here.
            canBe: (vm, role) => (vm.tags || []).indexOf(role) >= 0
        },
        guests: { all: () => w.guests || [] },
        guestApi: { api: () => () => {} },
        provision: { fileFor: () => { throw new Error('not this test'); }, STAGES: {} }
    }, async (_e, s) => { service = s; });

    assert.ok(service, 'the plugin did not register');
    return defined.get('supervisorState');
}

//---------------------------------------------------------------------------
//NONE AT ALL.
//---------------------------------------------------------------------------

test('with no supervisor it says so, and says where one is made', async () => {
    const said = await (await loaded({ register: [{ name: 'runner1', tags: ['worker'] }] })).run({});

    assert.equal(said.there, false);
    //NOT AN EMPTY LIST AND NOT AN ERROR. "There is no supervisor" is a state
    //somebody can fix, and the answer says how rather than leaving them looking.
    assert.match(said.note, /Runners tab/);
    assert.equal(said.supervisors, undefined);
});

test('a worker is not a supervisor, however many there are', async () => {
    const said = await (await loaded({
        register: [{ name: 'runner1', tags: ['worker'] }, { name: 'runner2', tags: ['worker', 'judge'] }]
    })).run({});
    assert.equal(said.there, false);
});

//---------------------------------------------------------------------------
//THE THREE REASONS IT CANNOT RUN.
//---------------------------------------------------------------------------

test('switched off is a reason, and it is the first one said', async () => {
    const said = await (await loaded({
        register: [A_MACHINE],
        live: [{ name: 'beta-super1', state: 'poweroff', connected: false }]
    })).run({});

    assert.equal(said.ready, false);
    assert.match(said.why, /switched off/);
    assert.equal(said.name, 'beta-super1', 'the pane has no machine to offer a Start button for');
});

test('up but not dialled in is a different sentence from switched off', async () => {
    //THESE WANT DIFFERENT RESPONSES — one is "press start", the other is "wait".
    //One sentence for both would make the button the answer to both.
    const said = await (await loaded({
        register: [A_MACHINE],
        live: [{ name: 'beta-super1', state: 'running', connected: false }],
        guests: [{ name: 'work-1', holder: 'beta-super1', fingerprint: 'sha256:aa' }]
    })).run({});

    assert.equal(said.ready, false);
    assert.match(said.why, /starting up/);
    assert.doesNotMatch(said.why, /switched off/);
});

test('running and dialled in but holding nothing is STILL not ready', async () => {
    //THE ONE THAT GETS MISSED. Everything about this machine looks right and a
    //wake on it does nothing at all — it exits in three seconds having asked for
    //nothing, which reads exactly like a supervisor with no work.
    const said = await (await loaded({
        register: [A_MACHINE],
        live: [{ name: 'beta-super1', state: 'running', connected: true }],
        guests: []
    })).run({});

    assert.equal(said.ready, false);
    assert.match(said.why, /no credential/);
    assert.equal(said.supervisors[0].signedInAs, null);
});

test('a sign-in held by a DIFFERENT machine does not count', async () => {
    const said = await (await loaded({
        register: [A_MACHINE],
        live: [{ name: 'beta-super1', state: 'running', connected: true }],
        guests: [{ name: 'work-1', holder: 'runner2', fingerprint: 'sha256:aa' }]
    })).run({});

    assert.equal(said.ready, false);
    assert.match(said.why, /no credential/);
});

test('two reasons at once are both said, not just the first', async () => {
    const said = await (await loaded({
        register: [A_MACHINE],
        live: [{ name: 'beta-super1', state: 'poweroff', connected: false }],
        guests: []
    })).run({});

    assert.match(said.why, /switched off/);
    assert.match(said.why, /no credential/);
});

//---------------------------------------------------------------------------
//AND WHEN IT CAN.
//---------------------------------------------------------------------------

test('up, dialled in and holding one is ready, and it is named', async () => {
    const said = await (await loaded({
        register: [A_MACHINE],
        live: [{ name: 'beta-super1', state: 'running', connected: true }],
        guests: [{ name: 'super-1', holder: 'beta-super1', fingerprint: 'sha256:aa' }]
    })).run({});

    assert.equal(said.ready, true);
    assert.equal(said.why, null);
    assert.equal(said.supervisors[0].signedInAs, 'super-1');
    assert.match(said.note, /signed in as "super-1"/);
});

test('which sign-in it holds, never what the sign-in IS', async () => {
    //THE KEYS TAB RULE, one tab along: a model may know something is there
    //without being able to know what it is. This answer is readable by a
    //supervisor's own door, so a value on it would be a credential handed to the
    //thing the credential is about.
    const said = await (await loaded({
        register: [A_MACHINE],
        live: [{ name: 'beta-super1', state: 'running', connected: true }],
        guests: [{
            name: 'super-1', holder: 'beta-super1', fingerprint: 'sha256:aa',
            token: 'sk-ant-SHOULD-NEVER-APPEAR', refresh: 'nor-this', credentials: { access: 'nor-this' }
        }]
    })).run({});

    const whole = JSON.stringify(said);
    ['sk-ant-SHOULD-NEVER-APPEAR', 'nor-this'].forEach((secret) => {
        assert.equal(whole.includes(secret), false, 'a credential value reached the answer: ' + secret);
    });
    assert.equal(said.supervisors[0].fingerprint, 'sha256:aa');
});

//---------------------------------------------------------------------------
//MORE THAN ONE, AND A REGISTER THAT WILL NOT ANSWER.
//---------------------------------------------------------------------------

test('two supervisors are both listed rather than one being picked quietly', async () => {
    const said = await (await loaded({
        register: [A_MACHINE, { name: 'beta-super2', tags: ['supervisor'] }],
        live: [
            { name: 'beta-super1', state: 'poweroff', connected: false },
            { name: 'beta-super2', state: 'running', connected: true }
        ],
        guests: [{ name: 'super-1', holder: 'beta-super2', fingerprint: 'sha256:bb' }]
    })).run({});

    assert.equal(said.supervisors.length, 2);
    //THE READY ONE IS THE ONE NAMED, not the first in the register.
    assert.equal(said.ready, true);
    assert.equal(said.name, 'beta-super2');
});

test('a register that will not answer does not take the whole answer down', async () => {
    //WHAT IS KNOWN IS STILL WORTH SAYING. `vmList` is asked for what a machine is
    //doing NOW; without it the register still knows a supervisor exists, and
    //"there is one and I cannot tell you its state" beats a pane with an error
    //on it where a machine's name should be.
    const said = await (await loaded({ register: [A_MACHINE], vmListThrows: true })).run({});

    assert.equal(said.there, true);
    assert.equal(said.ready, false);
    assert.equal(said.supervisors[0].name, 'beta-super1');
});

test('thinking is answered, and it is false because no turn can start here yet', async () => {
    //SAID AS FALSE RATHER THAN LEFT OFF. `supervisorWake` has not moved, so this
    //app cannot start a turn — false is the TRUE answer, not a placeholder, and
    //the badge it drives simply never shows. When wake lands this becomes real
    //and this test should start asserting something.
    const said = await (await loaded({
        register: [A_MACHINE],
        live: [{ name: 'beta-super1', state: 'running', connected: true }],
        guests: [{ name: 'super-1', holder: 'beta-super1', fingerprint: 'sha256:aa' }]
    })).run({});

    assert.equal(said.thinking, false);
});
