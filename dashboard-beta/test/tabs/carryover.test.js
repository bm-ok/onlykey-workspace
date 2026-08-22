const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const statePlugin = require('../../src/app/core/state/main');
const libraryPlugin = require('../../src/app/library/server');
const carryPlugin = require('../../src/app/carryover/server');

//---------------------------------------------------------------------------
//bringing the library across from the app being ported from.
//
//TWO RULES ARE THE WHOLE PLUGIN, and both are about what it must NOT do:
//
//  * NOTHING ARRIVES APPROVED. An approval is a person saying they read THIS,
//    HERE — copying one between two apps makes it a statement about a record
//    rather than about a reading, which is the door library/entries.js already
//    refuses to leave open when something is set aside and brought back over
//    the wire.
//
//  * NOTHING ALREADY HERE IS TOUCHED. Without that, a second run rewrites an
//    entry somebody has just approved — and a rewrite down the pipe takes the
//    approval with it, which is this plugin undoing the one thing it may not.
//
//AND IT ASKS THE OTHER APP BY NAME. `jobs`, `prompts` and `contracts` are all
//defined HERE now, so `actions.call` would answer with this app's own library
//and report confidently that there was nothing to bring across.
//---------------------------------------------------------------------------

let actions, library, defined, askedFor, over;

const THERE = {
    contracts: { contracts: [{ id: 'read-only', name: 'read only', text: 'do not push', kind: 'judge' }] },
    prompts: { prompts: [{ id: 'p1', name: 'the brief', text: 'read it', contractId: 'read-only', kind: 'judge' }] },
    jobs: { jobs: [{ id: 'j1', name: 'the job', promptId: 'p1', kind: 'judge', tags: ['test'] }] },
    job: { id: 'j1', code: 'module.exports = () => 1' }
};

beforeEach(async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-carry-'));
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-carry-ws-'));

    let state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dataDir, ...p) } }, async (_e, s) => { state = s.state; });
    state.follow(async () => work);

    defined = {};
    askedFor = [];
    over = { ...THERE };

    actions = {
        define: (name, spec) => { defined[name] = spec; return () => { delete defined[name]; }; },
        //THIS APP'S TABLE. If the plugin reaches for `call` it gets the local,
        //empty library — which is the mistake the plugin exists to avoid.
        call: async (name, args) => {
            askedFor.push('call:' + name);
            if (!defined[name]) throw new Error('no such action ' + name);
            return defined[name].run(args || {});
        },
        elsewhere: async (name, args) => {
            askedFor.push('elsewhere:' + name);
            const said = name === 'job'
                ? (over.job && over.job.id === (args || {}).id ? over.job : null)
                : over[name];
            if (said === undefined || said === null) throw new Error('the other app said nothing');
            return said;
        }
    };

    const quiet = { on: () => ({ info() {}, good() {}, warn() {}, bad() {}, out() {} }) };

    await libraryPlugin({ app: { host: { actions } }, log: quiet, state },
        async (_e, s) => { library = s.library; });

    //`ours` IS THE MACHINE REGISTER, which this plugin also writes to — see
    //src/app/carryover/machines.js. What it does with it is checked in
    //test/vms/carryover-machines.test.js against a real one; here it only
    //has to exist, because the library half never touches it.
    var ours = { has: function () { return false; }, add: function () {}, update: function () {}, read: function () { return []; } };
    await carryPlugin({ app: { host: { actions } }, log: quiet, library, ours }, async () => {});
});

const carry = (args) => defined.carryOver.run(args || {});

//---------------------------------------------------------------------------

test('it asks the OTHER app, never this one', async () => {
    await carry();

    //`actions.call` would answer with this app's own empty library and report,
    //perfectly confidently, that there was nothing to bring across.
    assert.ok(askedFor.every((a) => a.startsWith('elsewhere:')),
        'it asked its own table: ' + askedFor.join(', '));
    assert.ok(askedFor.includes('elsewhere:jobs'));
});

test('everything arrives waiting to be read', async () => {
    const said = await carry();
    assert.equal(said.brought.length, 3);

    for (const one of [await library.jobs.get('j1'),
                       await library.prompts.get('p1'),
                       await library.contracts.get('read-only')]) {
        assert.equal(one.approved, false, one.id + ' arrived approved');
        assert.equal(one.approval, null, one.id + ' arrived carrying an approval record');
        assert.equal(one.lapsed, false, one.id + ' arrived looking like somebody had read it');
    }

    assert.match(said.note, /NOTHING IS APPROVED/);
});

test('the chain comes with it, in an order that resolves', async () => {
    await carry();
    const it = await library.resolved();

    //A prompt names its contract and a job names its prompt, so carrying them
    //the other way round leaves entries pointing at things that are not here
    //yet — which reads as "its contract is gone" until the next one lands.
    assert.equal(it.prompts[0].missingContract, false);
    assert.equal(it.prompts[0].contract.name, 'read only');
    assert.equal(it.jobs[0].missingPrompt, false);
    assert.equal(it.jobs[0].prompt.name, 'the brief');
});

test('a job brings its script, which the listing does not carry', async () => {
    await carry();
    const one = await defined.job.run({ id: 'j1' });
    assert.equal(one.code, 'module.exports = () => 1');
});

test('what it is FOR comes with it, so a judge does not become a worker', async () => {
    await carry();
    assert.equal((await library.jobs.get('j1')).kind, 'judge');
    assert.equal((await library.prompts.get('p1')).kind, 'judge');
});

//---------------------------------------------------------------------------
//NOTHING ALREADY HERE IS TOUCHED.
//---------------------------------------------------------------------------

test('a second run brings nothing and reports what was already here', async () => {
    await carry();
    const again = await carry();

    assert.equal(again.brought.length, 0);
    assert.equal(again.already.length, 3);
});

test('and it does not rewrite something somebody has since approved', async () => {
    await carry();
    await library.contracts.approve('read-only', 'I read it');
    assert.equal((await library.contracts.get('read-only')).approved, true);

    //THE FAULT THIS GUARDS AGAINST: a rewrite down the pipe takes the approval
    //with it, so a second run would quietly undo the one thing this plugin must
    //not touch.
    over.contracts = { contracts: [{ id: 'read-only', name: 'read only', text: 'DIFFERENT RULES NOW', kind: 'judge' }] };
    await carry();

    const now = await library.contracts.get('read-only');
    assert.equal(now.approved, true, 'it rewrote an approved entry');
    assert.equal(now.text, 'do not push', 'it overwrote the text that was read');
});

//---------------------------------------------------------------------------
//SAYING SO RATHER THAN GUESSING.
//---------------------------------------------------------------------------

test('a dry run writes nothing and says what would come', async () => {
    const said = await carry({ dry: true });

    assert.equal(said.dry, true);
    assert.equal(said.brought.length, 3);
    assert.ok(said.brought.every((b) => b.would));
    assert.deepEqual(await library.jobs.all(), [], 'a dry run wrote something');
    assert.match(said.note, /Nothing was written/);
});

test('one kind at a time, if that is what was asked', async () => {
    const said = await carry({ what: 'contracts' });

    assert.equal(said.brought.length, 1);
    assert.equal(said.brought[0].kind, 'contract');
    assert.deepEqual(await library.jobs.all(), []);
});

test('a kind that is not one is refused, and the refusal lists them', async () => {
    //NOT `machines`, WHICH IS ONE NOW. This test used that as its example of a
    //name that means nothing, and the day the machines could be carried across
    //the example quietly became valid — which the suite caught, and which is
    //the whole reason the refusal lists what there IS rather than just saying no.
    await assert.rejects(() => carry({ what: 'sandwiches' }), /There is: contract, prompt, job, machine/);
});

test('a library that could not be read is not an empty library', async () => {
    over.jobs = null;
    const said = await carry();

    //"THE OTHER APP HAS NOTHING" AND "I COULD NOT SEE IT" are opposite reports,
    //and this one would otherwise look like a clean run that found no jobs.
    assert.deepEqual(said.unreachable, ['jobs']);
    assert.match(said.note, /Could not read jobs/);
    assert.match(said.note, /Nothing here was changed/);
});

test('a job whose script cannot be read is named rather than half-carried', async () => {
    over.job = null;
    const said = await carry();

    assert.equal(said.couldNot.length, 1);
    assert.equal(said.couldNot[0].id, 'j1');
    assert.match(said.couldNot[0].why, /script could not be read/);
    //AND THE RECORD IS NOT WRITTEN, because a job with no script is one that
    //reads as "its script is missing" for ever.
    assert.deepEqual(await library.jobs.all(), []);
});
