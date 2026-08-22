const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const secretPlugin = require('../../src/app/core/secret/main');
const makeStore = require('../../src/app/runners/guests/store');

//---------------------------------------------------------------------------
//the boundary, for the second credential store.
//
//../../src/app/keys is the first, and its boundary test says why a rule enforced
//by a comment is a rule that is true only until somebody breaks it. This is the
//same two checks about the same kind of claim.
//
//WHY THERE IS A DOOR HERE AT ALL. A GitHub token never has to leave this host,
//so keys hands out capabilities — the request signed, the environment for a
//child. A Claude sign-in has to ARRIVE, as bytes, on a machine that is not this
//one, because that is where the worker runs. There is no capability form of "be
//signed in on another computer", so pretending there is no door would be worse
//than naming it.
//
//THE REAL SEALING, NOT A STAND-IN. What "kept" means is DPAPI on this machine,
//and a fake would be testing the fake — the same reason ../tabs/keys.test.js
//uses the real one.
//---------------------------------------------------------------------------

//A CREDENTIAL SHAPE THAT IS OBVIOUSLY NOT REAL, and distinctive enough to be
//searched for in anything this hands back.
const FAKE = 'sk-ant-oat-notARealTokenJustForADrill0123456789';
const CRED = JSON.stringify({
    claudeAiOauth: { accessToken: FAKE, refreshToken: FAKE + '-r', subscriptionType: 'max' }
});

let home;

beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-guests-')); });
afterEach(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch (e) { /* gone */ } });

async function aStore() {
    let secret = null;
    await secretPlugin({}, async (_e, s) => { secret = s.secret; });

    return makeStore({
        dir: () => path.join(home, 'guests'),
        secret: secret,
        chosen: () => null
    });
}

//---------------------------------------------------------------------------
//1. EVERY WAY OUT IS DECLARED.
//---------------------------------------------------------------------------

test('the declared exits are exactly the ones that can hand back a credential', async () => {
    const store = await aStore();

    assert.deepEqual(store.EXITS.slice().sort(), ['token'],
        'the list of ways a credential can leave changed — that is a thing to argue for in a diff, '
        + 'not to discover');

    for (const name of store.EXITS) {
        assert.equal(typeof store[name], 'function', name + ' is declared as an exit and is not callable');
    }
});

//---------------------------------------------------------------------------
//2. AND NOTHING ELSE HANDS ONE BACK.
//
//THE DIRECTION THAT CATCHES A NEW HOLE. The list above can be satisfied by
//declaring one name; what matters is that nothing ELSE on the store returns a
//credential. Every other member is called and its answer searched for the token.
//---------------------------------------------------------------------------

test('nothing outside the declared exits returns the credential', async () => {
    const store = await aStore();
    store.add({ name: 'a', token: CRED });
    store.checked('a', { ready: true, how: 'run', on: 'kit-1' });
    store.noteAccount('a', { email: 'someone@example.com', uuid: 'u-1' });

    //THE ONES THAT CHANGE THINGS are exercised in ./guests-store.test.js; what
    //matters here is only what a member RETURNS. `root` and `fileFor` answer
    //with paths, which name where a credential is and are not one.
    const skip = new Set(store.EXITS.concat(['EXITS', 'add', 'forget', 'roleOf', 'lentTo', 'backFrom']));

    let called = 0;
    for (const name of Object.keys(store)) {
        if (skip.has(name)) continue;
        const member = store[name];

        if (typeof member !== 'function') {
            assert.ok(!JSON.stringify(member == null ? null : member).includes(FAKE),
                name + ' is a value carrying the credential');
            continue;
        }

        const answer = member('a', 'worker');
        called++;
        assert.ok(!JSON.stringify(answer == null ? null : answer).includes(FAKE),
            'store.' + name + '() handed back the credential');
    }

    assert.ok(called >= 6, 'almost nothing was actually called, so this proves almost nothing — ' + called);
});

test('and neither do the ones that change something', async () => {
    //CALLED SEPARATELY because each of these moves the record, and the claim is
    //the same one: what comes back is a description, never a value.
    const store = await aStore();

    assert.ok(!JSON.stringify(store.add({ name: 'a', token: CRED })).includes(FAKE),
        'add() handed back the credential it had just sealed');
    assert.ok(!JSON.stringify(store.roleOf('a', 'judge')).includes(FAKE));
    assert.ok(!JSON.stringify(store.lentTo('a', 'kit-1', { kind: 'judge' })).includes(FAKE));

    //backFrom TAKES ONE AND IS THE MOST LIKELY TO ECHO IT.
    const rotated = JSON.stringify({ claudeAiOauth: { accessToken: FAKE + '-2', refreshToken: 'r' } });
    assert.ok(!JSON.stringify(store.backFrom('a', { token: rotated })).includes(FAKE),
        'backFrom() handed back the credential it was given');

    assert.ok(!JSON.stringify(store.forget('a')).includes(FAKE));
});

//---------------------------------------------------------------------------
//3. AND THE ONE DOOR REALLY IS SEALED BEHIND IT.
//
//The point of the exit being narrow is that the thing behind it is not readable
//without it. This is what makes the rest of the file worth anything.
//---------------------------------------------------------------------------

test('what is on the disk is not the credential', async () => {
    const store = await aStore();
    store.add({ name: 'a', token: CRED });

    const sealed = fs.readFileSync(path.join(home, 'guests', 'a.json'), 'utf8');
    const record = fs.readFileSync(path.join(home, 'guests', 'guests.json'), 'utf8');

    assert.equal(record.includes(FAKE), false, 'the list on disk carried the credential');

    //ON WINDOWS THIS IS DPAPI AND THE FILE IS CIPHERTEXT. Elsewhere there is no
    //sealing to be had, and core/secret says so rather than pretending — so the
    //claim is made where it can be true, and the exit is checked everywhere.
    if (process.platform === 'win32') {
        assert.equal(sealed.includes(FAKE), false, 'the sealed file was cleartext');
    }

    //AND THE DOOR OPENS IT, which is the other half: a store nothing can read
    //back from would be safe and useless.
    assert.equal(store.token('a'), CRED);
});
