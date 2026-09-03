const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const actionsPlugin = require('../../src/app/core/actions/main');
const secretPlugin = require('../../src/app/core/secret/main');
const guestsPlugin = require('../../src/app/runners/guests/server');

//---------------------------------------------------------------------------
//the sign-ins, as actions and as a service.
//
//THE CLAIM WORTH THE MOST: nothing an action answers with, and nothing this
//plugin says to the log, carries a token. The log is the DURABLE record — it is
//read from a bookmark weeks later, and it is what a supervisor is shown — so a
//credential in it is a credential in every reading of that record afterwards.
//
//AND THE SECOND: the service answers the questions the queue asks before it
//spends a machine. Those are rules about this list, and they are here even
//though the lending is not.
//
//THE REAL SEALING, NOT A STAND-IN, for the same reason ../tabs/keys.test.js uses
//it: what "kept" means is DPAPI on this machine, and a fake would test the fake.
//---------------------------------------------------------------------------

//A CREDENTIAL SHAPE THAT IS OBVIOUSLY NOT REAL, distinctive enough to be
//searched for in an answer and in every line the log was told.
const FAKE = 'sk-ant-oat-notARealTokenJustForADrill0123456789';
const CRED = (over) => JSON.stringify({
    claudeAiOauth: Object.assign({ accessToken: FAKE, refreshToken: FAKE + '-r', subscriptionType: 'max' }, over || {})
});

let home, said, written;

beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-guests-srv-'));
    said = [];
    written = {};
});

afterEach(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch (e) { /* gone */ } });

async function aHost() {
    let actions = null;
    await actionsPlugin({}, async (_e, s) => { actions = s.actions; });

    let secret = null;
    await secretPlugin({}, async (_e, s) => { secret = s.secret; });

    const logger = ['info', 'warn', 'good', 'bad'].reduce((n, k) => {
        n[k] = (t) => said.push(k + ': ' + t);
        return n;
    }, {});

    let guests = null;
    await guestsPlugin({
        app: { host: { actions } },
        log: { on: () => logger },
        secret,
        dataDir: { at: (...p) => path.join(home, ...p) },
        settings: {
            //THE SHAPE THE REAL ONE HAS, and both halves matter. `read` is async
            //because most settings follow the open folder now; `host` is the
            //synchronous half for the few that do not, and it is the one this
            //plugin uses — a stand-in without it made "which sign-in" answer
            //null, which reads exactly like nothing having been chosen.
            read: async () => written,
            host: () => written,
            write: async (patch) => { Object.assign(written, patch); return written; }
        },

        //THE LENDING'S PIECES. This file is about the list and the labels — what
        //putting a sign-in ON a machine does is ./guests-lend.test.js, and what
        //choosing one does is ./guests-choosing.test.js — so these are here to
        //let the plugin assemble and are not exercised.
        ours: { get: () => ({ name: 'kit-1', tags: ['worker'] }), read: () => [], update: () => {}, kindsOf: (vm) => ((vm && vm.tags) || []), SUPERVISOR: 'supervisor' },
        channel: { connected: () => false, run: async () => ({ output: '' }) },
        sealed: { toTheMachine: async () => ({ fingerprint: 'x' }), fingerprint: () => 'x' },
        dispatch: { RUNS: '/runs', SUPERVISOR: '/turns', watcherFor: () => '' },

        //THE SIGN-IN DESK'S SHELL — vms/auth. This plugin now holds the four
        //vmAuth* actions, so it declares it, and the desk's user name travels
        //with the thing that runs on it rather than being known here.
        signin: {
            DESK: 'okc-signin',
            begin: () => 'begin', code: () => 'code', cancel: () => 'cancel',
            asDesk: (s) => s,
            read: () => ({ url: null, log: '', finished: true, exit: 0 })
        }
    }, async (_e, s) => { guests = s.guests; });

    return { guests, actions };
}

const add = (actions, name, over) =>
    actions.call('guestAdd', Object.assign({ name, token: CRED() }, over || {}));

//---- nothing hands back a token, and nothing says one ---------------------

test('no action answers with a credential', async () => {
    const { actions } = await aHost();
    await add(actions, 'a');

    for (const [name, args] of [
        ['guests', {}],
        ['guests', { role: 'worker' }],
        ['guestRole', { name: 'a', role: 'judge' }],
        ['supervisorKey', {}]
    ]) {
        const answer = await actions.call(name, args);
        assert.equal(JSON.stringify(answer).includes(FAKE), false, name + ' handed back the credential');
    }
});

test('and NO action this plugin defines does, named or not', async () => {
    //THE LIST ABOVE IS A LIST, AND A LIST GOES STALE. Four vmAuth* actions and
    //three claudeSignIn* ones were added to this plugin and the test above went
    //on passing without touching any of them — it was green about actions it had
    //never called.
    //
    //So this asks the TABLE what exists rather than being told. Everything is
    //called with an argument that cannot work; what is being checked is that
    //neither the answer NOR the refusal carries the credential, because an error
    //message is a place a token reaches just as easily as a return value.
    const { actions } = await aHost();
    await add(actions, 'a');

    //EVERY ROW IS THIS APP'S. It used to filter on `where === 'here'`, because
    //`all()` also listed what the app being ported from answered. There is one
    //table now, so the filter would only ever be a way to drop everything.
    const mine = ((await actions.all()).actions || []).map(a => a.name);

    //INERTNESS. If the table came back empty this would pass having proved
    //nothing, which is the shape this whole test is about.
    assert.ok(mine.length >= 8, 'only ' + mine.length + ' actions were found to check');

    for (const name of mine) {
        let said = null;
        try { said = JSON.stringify(await actions.call(name, { name: 'a' })); }
        catch (e) { said = String(e && e.message); }

        assert.equal(said.includes(FAKE), false, name + ' let the credential out');
    }
});

test('and guestAdd, which is the one that was just given one', async () => {
    const { actions } = await aHost();
    const made = await add(actions, 'a');

    assert.equal(JSON.stringify(made).includes(FAKE), false, 'it echoed the token it had just sealed');
    assert.match(made.note, /Nothing shows it again/);
    assert.match(made.fingerprint, /^[0-9a-f]{16}$/);
});

test('nothing this plugin told the log carries a credential', async () => {
    //THE LOG IS THE DURABLE RECORD. It is read from a bookmark weeks later and
    //it is what a supervisor is shown, so a token in it is a token in every
    //reading of that record afterwards.
    const { actions } = await aHost();
    await add(actions, 'a');
    await actions.call('guestRole', { name: 'a', role: 'supervisor' });
    await actions.call('supervisorKey', { name: 'a' });
    await actions.call('guestForget', { name: 'a' });

    assert.ok(said.length >= 4, 'it said almost nothing, so this proves almost nothing');
    for (const line of said) {
        assert.equal(line.includes(FAKE), false, 'a credential was written into the log: ' + line);
    }
});

test('what the log DOES say is the name and the fingerprint', async () => {
    //SAFE TO READ SIX WEEKS LATER, and enough to answer "was this the same
    //token as before".
    const { actions } = await aHost();
    const made = await add(actions, 'a');

    assert.ok(said.some((l) => l.includes('"a"') && l.includes(made.fingerprint)), said.join(' | '));
});

//---- reading the list ------------------------------------------------------

test('both roles by default, because that is one question', () => {
    //ANSWERING HALF OF IT SILENTLY is how a duplicate gets added.
    return aHost().then(async ({ actions }) => {
        await add(actions, 'w');
        await add(actions, 'j', { role: 'judge' });
        await add(actions, 's', { role: 'supervisor' });

        const said = await actions.call('guests', {});
        assert.deepEqual(said.guests.map((g) => g.name).sort(), ['j', 's', 'w']);
        assert.equal(said.held, 3);
        assert.equal(said.supervisors, 1);
        assert.equal(said.lent, 0);
    });
});

test('and one role when a pane asks for one', async () => {
    const { actions } = await aHost();
    await add(actions, 'w');
    await add(actions, 'j', { role: 'judge' });

    const only = await actions.call('guests', { role: 'judge' });
    assert.deepEqual(only.guests.map((g) => g.name), ['j']);
});

test('an empty list says what is missing in the words of the role asked for', async () => {
    //THIS ANSWERED "guest" WHATEVER WAS ASKED, which was fine while there were
    //two roles and one was called that. With three it told a judge pane about
    //guests.
    const { actions } = await aHost();

    assert.match((await actions.call('guests', { role: 'judge' })).note, /No judge sign-in yet/);
    assert.match((await actions.call('guests', { role: 'supervisor' })).note, /No supervisor sign-in yet/);
    assert.match((await actions.call('guests', {})).note, /No worker sign-in yet/);
});

test('and a full one says what a sign-in of that role is for', async () => {
    const { actions } = await aHost();
    await add(actions, 's', { role: 'supervisor' });

    const s = await actions.call('guests', { role: 'supervisor' });
    assert.match(s.note, /1 supervisor sign-in\./);
    assert.match(s.note, /never lent to a machine/);

    await add(actions, 'w');
    const w = await actions.call('guests', { role: 'worker' });
    assert.match(w.note, /1 worker sign-in\./);
    assert.match(w.note, /two machines never share one/);
});

test('a host that has never held one answers, rather than failing', async () => {
    const { actions } = await aHost();
    const said = await actions.call('guests', {});

    assert.deepEqual(said.guests, []);
    assert.equal(said.held, 0);
    assert.ok(said.where, 'it did not say where they would live');
});

//---- an empty list that is not an empty host --------------------------------
//
//THIS STORE IS THIS APP'S OWN, so a subsystem that has just moved starts empty
//— deliberately, and it is what makes the port unable to damage a credential a
//machine is using. It is also indistinguishable on screen from having lost them.

//THE EMPTY NOTE USED TO ASK THE OTHER APP how many sign-ins IT was holding and
//say so, because a store that had just moved reading as empty is
//indistinguishable, on screen, from having lost them. Three tests covered that
//relay and went with it; what is left is the note this host can answer alone.
test('an empty list says so about this host, and asks nothing of anywhere else', async () => {
    const { actions } = await aHost();

    const said = await actions.call('guests', {});

    assert.match(said.note, /No worker sign-in yet/);
    assert.equal(/still holds/.test(said.note), false,
        'the note still talks about sign-ins somewhere else');
});

test('and it is not asked at all once this host holds one', async () => {
    //IT COSTS ONE RELAY ON A SCREEN WITH NOTHING ELSE TO DRAW, and nothing at
    //all the moment there is a sign-in here — the pane polls this every fifteen
    //seconds.
    const { actions } = await aHost();
    let asked = 0;
    actions.elsewhere = async () => { asked++; return { guests: [{ name: 'a' }] }; };

    await add(actions, 'w');
    await actions.call('guests', {});

    assert.equal(asked, 0, 'it relayed on a list that had something in it');
});

//---- relabelling -----------------------------------------------------------

test('changing what a sign-in is for says what it was', async () => {
    const { actions } = await aHost();
    const made = await add(actions, 'a');

    const now = await actions.call('guestRole', { name: 'a', role: 'judge' });
    assert.equal(now.was, 'worker');
    assert.equal(now.role, 'judge');
    //THE FINGERPRINT AFTERWARDS IS THE SAME ONE, which is how somebody can tell
    //this did what it says.
    assert.equal(now.fingerprint, made.fingerprint);
    assert.match(now.note, /Its token was not touched/);
});

test('and setting it to what it already is says so rather than pretending', async () => {
    const { actions } = await aHost();
    await add(actions, 'a');

    const now = await actions.call('guestRole', { name: 'a', role: 'worker' });
    assert.match(now.note, /was already a worker/);
});

test('a name this host does not hold is named, not invented', async () => {
    const { actions } = await aHost();
    await assert.rejects(() => actions.call('guestRole', { name: 'nope', role: 'judge' }),
        /There is no sign-in called "nope"/);
});

//---- throwing one away ------------------------------------------------------

test('forgetting one says it is gone and what that means', async () => {
    const { actions } = await aHost();
    await add(actions, 'a');

    const gone = await actions.call('guestForget', { name: 'a' });
    assert.equal(gone.gone, 'a');
    assert.match(gone.note, /Anything that was using it will have to be given another/);
    assert.deepEqual((await actions.call('guests', {})).guests, []);
});

//---- which supervisor sign-in this host uses ---------------------------------

test('asked with nothing it reads, rather than changing something', async () => {
    const { actions } = await aHost();
    const said = await actions.call('supervisorKey', {});

    assert.equal(said.key, null);
    assert.match(said.why, /no supervisor sign-in at all/);
    assert.deepEqual(written, {}, 'reading it wrote a setting');
});

test('and named, it chooses one', async () => {
    const { actions } = await aHost();
    await add(actions, 'one', { role: 'supervisor' });
    await add(actions, 'two', { role: 'supervisor' });

    const said = await actions.call('supervisorKey', { name: 'two' });
    assert.equal(written.supervisorKey, 'two');
    assert.equal(said.chosen, 'two');
    assert.equal(said.key.name, 'two');
});

test('but only one this host actually holds', async () => {
    //A SETTING NAMING A SIGN-IN THIS HOST DOES NOT HOLD is a supervisor that
    //fails the next time it is woken, which is the worst moment to find out.
    const { actions } = await aHost();
    await assert.rejects(() => actions.call('supervisorKey', { name: 'nope' }),
        /There is no sign-in called "nope"/);
    assert.deepEqual(written, {});
});

test('and only a supervisor one, said with what would fix it', async () => {
    const { actions } = await aHost();
    await add(actions, 'w');

    await assert.rejects(() => actions.call('supervisorKey', { name: 'w' }),
        /"w" is a worker, not a supervisor/);
    await assert.rejects(() => actions.call('supervisorKey', { name: 'w' }),
        /change what it is for with guestRole first/);
    assert.deepEqual(written, {});
});

//---- and the service the queue reads ------------------------------------------

test('the queue is answered before it spends a machine', async () => {
    const { guests, actions } = await aHost();
    await add(actions, 'w1');
    await add(actions, 'w2');
    await add(actions, 'j', { role: 'judge' });

    assert.deepEqual(guests.forQueue(), {
        worker: { free: 2, paused: [] },
        judge: { free: 1, paused: [] }
    });
});

test('a sign-in a machine reported dead stops being offered, and is named', async () => {
    //PAUSED RATHER THAN REVOKED. Nothing spends a machine on it again until
    //somebody replaces it, which is a different act from deciding it is gone.
    const { guests, actions } = await aHost();
    await add(actions, 'w1');
    await add(actions, 'w2');

    guests.pause('w2', { on: 'kit-1', why: 'OAuth session expired', how: 'run' });

    assert.deepEqual(guests.forQueue().worker, { free: 1, paused: ['w2'] });
    assert.deepEqual(guests.pausedFor('worker').map((g) => g.name), ['w2']);
    assert.equal(guests.get('w2').lastCheck.why, 'OAuth session expired');
});

test('and a probe cannot un-pause it, wherever the call came from', async () => {
    //ONE RULE, IN ONE PLACE. A second way in would be a second set of rules
    //about which evidence may overturn which.
    const { guests, actions } = await aHost();
    await add(actions, 'w1');

    guests.pause('w1', { why: 'expired', how: 'run' });
    guests.checked('w1', { ready: true, how: 'probe' });

    assert.equal(guests.get('w1').lastCheck.ready, false);
    assert.equal(guests.forQueue().worker.free, 0);
});

test('which sign-in is on a machine is asked, not assumed', async () => {
    //A MACHINE HOLDS WHICHEVER CREDENTIAL WAS LENT TO IT, and that is the
    //account a run's cost belongs to.
    const { guests, actions } = await aHost();
    await add(actions, 'w1');

    assert.equal(guests.holderOf('kit-1'), null);

    //LENT THROUGH THE STORE, because the action that does it on a real machine
    //has not moved yet — the rule it enforces has.
    const makeStore = require('../../src/app/runners/guests/store');
    let secret = null;
    await secretPlugin({}, async (_e, s) => { secret = s.secret; });
    makeStore({ dir: () => path.join(home, 'guests'), secret }).lentTo('w1', 'kit-1', { kind: 'worker' });

    assert.equal(guests.holderOf('kit-1'), 'w1');
    assert.equal(guests.holderOf('kit-2'), null);
    assert.equal(guests.forQueue().worker.free, 0, 'a sign-in already out was offered to the queue');
});

test('and the service names its one door, so a reader of it sees the exit', async () => {
    const { guests } = await aHost();
    assert.deepEqual(guests.EXITS, ['token']);
    assert.equal(typeof guests.token, 'function');
});
