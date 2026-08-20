const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const actionsPlugin = require('../src/app/core/actions/main');
const secretPlugin = require('../src/app/core/secret/main');
const keysPlugin = require('../src/app/keys/server');

const APP = path.join(__dirname, '..', 'src', 'app');

//---------------------------------------------------------------------------
//the boundary.
//
//WHAT MAKES THIS A LOCKDOWN RATHER THAN A FOLDER. The app being ported from has
//the same discipline enforced by a comment — "THE ONE PLACE THE TOKEN LEAVES
//THIS MODULE... Nothing else may call this, and nothing else does" — which was
//true, and was true because nobody had broken it yet.
//
//So the checks here are about the RULE, not about a call site:
//
//    1. every way out is in EXITS, and EXITS is what is actually callable
//    2. nothing outside keys/ opens a credential
//    3. the token is only ever attached to the host it was kept for
//    4. nothing that answers a question hands back the secret
//
//THE REAL SEALING, NOT A STAND-IN. What "kept" means is DPAPI on this machine,
//and a fake would be testing the fake — the same reason core/state is real in
//the tests that use it.
//---------------------------------------------------------------------------

const somewhere = () => fs.mkdtempSync(path.join(os.tmpdir(), 'okc-keys-'));

async function aHost() {
    let actions = null;
    await actionsPlugin({}, async (_e, s) => { actions = s.actions; });

    let secret = null;
    await secretPlugin({}, async (_e, s) => { secret = s.secret; });

    const dir = somewhere();
    const said = [];
    const logger = { warn: (t) => said.push(t), info: (t) => said.push(t), good: (t) => said.push(t), bad: (t) => said.push(t) };

    let keys = null;
    await keysPlugin({
        app: { host: { actions } },
        log: { on: () => logger },
        secret,
        dataDir: { at: (...p) => path.join(dir, ...p) }
    }, async (_e, s) => { keys = s.keys; });

    return { keys, actions, dir, said };
}

//A TOKEN SHAPE THAT IS OBVIOUSLY NOT REAL, and long enough that the redaction
//patterns would catch it — which is the point of the last test in this file.
const FAKE = 'ghp_notARealTokenJustForADrill0123456789';

//---------------------------------------------------------------------------
//1. EVERY WAY OUT IS DECLARED.
//---------------------------------------------------------------------------

test('the declared exits are exactly the ones that can hand back a secret', async () => {
    const { keys } = await aHost();

    assert.deepEqual(keys.EXITS.slice().sort(), ['envForPush', 'sign'],
        'the list of ways a secret can leave changed — that is a thing to argue for in a diff, not to discover');

    for (const name of keys.EXITS) {
        assert.equal(typeof keys.github[name], 'function', name + ' is declared as an exit and is not callable');
    }
});

//THE OTHER DIRECTION, AND IT IS THE ONE THAT CATCHES A NEW HOLE. The list above
//can be satisfied by declaring two names; what matters is that nothing ELSE on
//the service hands a credential back. Every other member is called and its
//answer is searched for the token.
test('nothing outside the declared exits returns the token', async () => {
    const { keys, actions } = await aHost();
    await keys.github.put(FAKE, { api: 'api.github.com' });

    const skip = new Set(keys.EXITS.concat(['PUBLIC', 'where']));
    let called = 0;

    for (const name of Object.keys(keys.github)) {
        if (skip.has(name)) continue;
        const member = keys.github[name];
        if (typeof member !== 'function') {
            assert.ok(!JSON.stringify(member || null).includes(FAKE), name + ' is a value carrying the token');
            continue;
        }
        //`forget` and `put` change things; called last would be nicer, and what
        //matters is only what they RETURN.
        if (name === 'forget' || name === 'put' || name === 'remember') continue;

        const answer = member();
        called++;
        assert.ok(!JSON.stringify(answer == null ? null : answer).includes(FAKE),
            'keys.github.' + name + '() handed back the token');
    }

    assert.ok(called >= 3, 'almost nothing was actually called, so this proves almost nothing');

    //and the same for every action this plugin defines
    for (const name of ['githubHeld']) {
        const answer = await actions.call(name, {});
        assert.ok(!JSON.stringify(answer).includes(FAKE), name + ' returned the token');
    }
});

//---------------------------------------------------------------------------
//2. NOTHING OUTSIDE keys/ OPENS A CREDENTIAL.
//
//A source scan, because this is a claim about the whole app rather than about
//one call. It is the check that would have caught the second module to decide it
//needed the token "just this once".
//---------------------------------------------------------------------------

test('only the keys plugin reads a credential off the disk', () => {
    const guilty = [];

    (function under(dir) {
        for (const name of fs.readdirSync(dir)) {
            if (name.startsWith('_') || name.startsWith('.') || name === 'vendor' || name === 'suites') continue;
            const full = path.join(dir, name);
            if (fs.statSync(full).isDirectory()) { under(full); continue; }
            if (!name.endsWith('.js')) continue;

            const rel = path.relative(APP, full).split(path.sep).join('/');
            //keys owns them; core/secret IS the sealing; the test folder is not app code
            if (rel.startsWith('keys/') || rel.startsWith('core/secret/')) continue;

            const src = fs.readFileSync(full, 'utf8');
            //THE TWO WAYS IN: opening a sealed file, or naming the folder they
            //live in. Comments are stripped first, so a file that MENTIONS the
            //rule is not accused of breaking it.
            const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
            if (/\bsecret\s*\.\s*(read|open)\s*\(/.test(code)) guilty.push(rel + ' — opens a sealed file');
            if (/['"]credentials['"]/.test(code)) guilty.push(rel + ' — names the credentials folder');
        }
    })(APP);

    assert.deepEqual(guilty, [],
        'something outside keys/ reaches a credential directly. It should ask keys for a capability instead — see the header of keys/server.js');
});

//---------------------------------------------------------------------------
//3. THE TOKEN GOES TO ONE HOST AND NOWHERE ELSE.
//
//This is what makes `sign` worth having rather than `token()` with extra steps.
//github/server.js follows redirects for reads; this is what stops that being a
//way out, and it would stop a mistyped host or a swapped API base as well.
//---------------------------------------------------------------------------

test('a request bound anywhere but the API host is not signed', async () => {
    const { keys } = await aHost();
    await keys.github.put(FAKE, { api: 'api.github.com' });

    const good = keys.github.sign('api.github.com', { accept: 'x' });
    assert.match(good.authorization, /^Bearer /, 'the right host got no credential');
    assert.equal(good.accept, 'x', 'it dropped the headers it was given');

    for (const bad of [
        'evil.example.invalid',
        'api.github.com.evil.example.invalid',
        'API.GITHUB.COM',
        'github.com',
        ''
    ]) {
        assert.throws(() => keys.github.sign(bad, {}), /not signed/,
            'a request to "' + bad + '" was signed — the token has left this host');
    }
});

test('a host the token was kept for is the one it is signed for, not a default', async () => {
    const { keys } = await aHost();
    //GitHub Enterprise, or anything that is not github.com
    await keys.github.put(FAKE, { api: 'github.internal.example' });

    assert.match(keys.github.sign('github.internal.example', {}).authorization, /^Bearer /);
    assert.throws(() => keys.github.sign('api.github.com', {}), /not signed/,
        'it signed for the public API when the token was kept for somewhere else');
});

test('with no token held, both exits refuse and say where to go', async () => {
    const { keys } = await aHost();

    assert.throws(() => keys.github.sign('api.github.com', {}), /Keys tab/);
    assert.throws(() => keys.github.envForPush(), /Keys tab/);
});

//---------------------------------------------------------------------------
//4. THE ONE PLACE A RAW TOKEN HAS TO BE A VALUE.
//---------------------------------------------------------------------------

test('the push environment carries it, as an object rather than a string', async () => {
    const { keys } = await aHost();
    await keys.github.put(FAKE, {});

    const env = keys.github.envForPush();
    assert.equal(typeof env, 'object', 'it handed back a bare string, which is the shape that ends up in a log line');
    assert.equal(env.OKC_GIT_TOKEN, FAKE);
    assert.deepEqual(Object.keys(env), ['OKC_GIT_TOKEN'], 'it carries more than the one thing a push needs');
});

//---------------------------------------------------------------------------
//WHAT IS KEPT, AND WHAT IS SAID ABOUT IT.
//---------------------------------------------------------------------------

test('it is sealed on disk, and `held` says which protection it got', async () => {
    const { keys, dir } = await aHost();
    const { sealed } = await keys.github.put(FAKE, { api: 'api.github.com' });

    const now = keys.github.held();
    assert.equal(now.held, true);
    assert.equal(now.sealed, sealed);
    assert.match(now.protection, sealed ? /encrypted/ : /file permissions/);

    const raw = fs.readFileSync(path.join(dir, 'credentials', 'github.json')).toString('utf8');
    if (sealed) assert.ok(!raw.includes(FAKE), 'the cleartext token is sitting in the file');
});

test('forgetting takes the notes with it, and says it is not a revocation', async () => {
    const { keys, actions } = await aHost();
    await keys.github.put(FAKE, { api: 'api.github.com' });
    keys.github.remember({ login: 'someone' });

    const said = await actions.call('githubKeyForget', {});
    assert.equal(said.gone, true);
    assert.match(said.note, /NOT revoked/, 'deleting a copy read as ending the credential');

    const now = keys.github.held();
    assert.equal(now.held, false);
    assert.ok(!JSON.stringify(now).includes('someone'), 'the notes outlived the token they were about');
});

//---------------------------------------------------------------------------
//WHAT IS SAID IS THAT SOMETHING HAPPENED, NEVER WHAT.
//
//The standing rule for this tab: you should be able to see THAT a credential was
//changed and never the credential. The log is where that goes wrong first,
//because a log line is written by somebody in a hurry.
//---------------------------------------------------------------------------

test('nothing the log was told carries the token', async () => {
    const { keys, said } = await aHost();
    await keys.github.put(FAKE, { api: 'api.github.com' });
    keys.github.forget();

    assert.ok(said.length >= 2, 'it kept quiet about a credential being written and thrown away');
    for (const line of said) {
        assert.ok(!line.includes(FAKE), 'a log line carried the token: ' + line);
    }
    assert.ok(said.some((l) => /kept/.test(l)), 'nothing said a token had been kept');
});
