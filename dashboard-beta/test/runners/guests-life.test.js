const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', 'src', 'app');
const makeLife = require(path.join(APP, 'runners', 'guests', 'life.js'));

//---------------------------------------------------------------------------
//HOW LONG A STORED SIGN-IN HAS LEFT, WITHOUT USING IT.
//
//THE CLAIM: this answers from a clock, and a clock cannot say a credential
//works. Two clocks live in one file and confusing them is the whole difficulty:
//
//  the access token   hours. EXPIRED IS ITS NORMAL STATE, because Claude Code
//                     refreshes it whenever it needs to.
//  the refresh token  weeks. When it goes the credential is dead and only a
//                     person at a sign-in page can replace it.
//
//So `usable` is never true. A live refresh token means "not known to be dead" —
//a refresh ROTATES the token, so one grabbed off a machine that refreshed since
//is already superseded.
//---------------------------------------------------------------------------

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

let reads;

function lifeWith(payload, opts) {
    const o = opts || {};
    reads = 0;
    return makeLife({
        read: (f) => {
            reads++;
            if (o.unreadable) throw new Error('sealed shut');
            return Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
        },
        statOf: () => (o.noStat ? null : { mtimeMs: o.mtime || 1000, size: o.size || 42 })
    });
}

const cred = (over) => ({
    claudeAiOauth: Object.assign({
        accessToken: 'sk-ant-oat-notreal',
        refreshToken: 'sk-ant-ort-notreal',
        subscriptionType: 'max',
        scopes: ['a', 'b'],
        expiresAt: Date.now() + HOUR,
        refreshTokenExpiresAt: Date.now() + 30 * DAY
    }, over || {})
});

//---------------------------------------------------------------------------
//1. THE TWO CLOCKS.
//---------------------------------------------------------------------------

test('an expired ACCESS token says nothing about whether it works', () => {
    //ITS NORMAL STATE. Reporting a credential as dead for this would condemn
    //nearly every healthy one on the host.
    const l = lifeWith(cred({ expiresAt: Date.now() - HOUR }));
    const out = l.of('/creds/a.json');

    assert.equal(out.access.expired, true);
    assert.equal(out.refresh.expired, false);
    assert.equal(out.usable, null, 'an expired access token was read as unusable');
});

test('an expired REFRESH token is the one certain answer', () => {
    const l = lifeWith(cred({ refreshTokenExpiresAt: Date.now() - DAY }));
    const out = l.of('/creds/a.json');

    assert.equal(out.usable, false);
    assert.match(out.why, /cannot be recovered, only replaced/);
});

test('a live refresh token is never reported as working', () => {
    //`null`, NOT `true`. A refresh rotates the token, so one grabbed from a
    //machine that refreshed since is already superseded.
    const l = lifeWith(cred());
    const out = l.of('/creds/a.json');

    assert.equal(out.usable, null);
    assert.match(out.why, /not the same as it working/);
    assert.match(out.why, /already superseded/);
});

test('no refresh clock at all is "nothing can be told", not "dead"', () => {
    const l = lifeWith(cred({ refreshTokenExpiresAt: undefined }));
    const out = l.of('/creds/a.json');

    assert.equal(out.refresh, null);
    assert.equal(out.usable, null);
    assert.match(out.why, /nothing can be told from here/);
});

test('usable is never true, whatever the clocks say', () => {
    //INERTNESS. If a future edit made the healthy case `true`, everything above
    //still passes — this is the assertion that would not.
    for (const over of [
        {},
        { expiresAt: Date.now() - HOUR },
        { expiresAt: Date.now() + DAY, refreshTokenExpiresAt: Date.now() + 365 * DAY }
    ]) {
        assert.notEqual(lifeWith(cred(over)).of('/creds/a.json').usable, true);
    }
});

//---------------------------------------------------------------------------
//2. WHAT IT SAYS ABOUT THE ACCOUNT, AND WHAT IT NEVER SAYS.
//---------------------------------------------------------------------------

test('it reports facts that tell two credentials apart', () => {
    const l = lifeWith(cred());
    const out = l.of('/creds/a.json');

    assert.equal(out.plan, 'max');
    assert.equal(out.scopes, 2);
});

test('and never a token', () => {
    //TIMESTAMPS ONLY. This app's panes are photographed on purpose several times
    //a day.
    const said = JSON.stringify(lifeWith(cred()).of('/creds/a.json'));
    assert.ok(said.indexOf('sk-ant-oat-notreal') < 0, 'the access token is in the answer');
    assert.ok(said.indexOf('sk-ant-ort-notreal') < 0, 'the refresh token is in the answer');
});

//---------------------------------------------------------------------------
//3. WHEN IT CANNOT BE READ.
//---------------------------------------------------------------------------

test('an unreadable credential says so rather than throwing', () => {
    const l = lifeWith(cred(), { unreadable: true });
    const out = l.of('/creds/a.json');

    assert.equal(out.readable, false);
    assert.match(out.why, /could not be read or is not the shape/);
});

test('and rubbish that parses to nothing useful is not a crash', () => {
    const l = lifeWith('this is not json at all');
    assert.equal(l.of('/creds/a.json').readable, false);
});

test('an unreadable one is NOT cached', () => {
    //A file that could not be read may be MID-WRITE, and remembering
    //"unreadable" against an mtime would keep saying so after it became readable
    //at the same mtime — which happens when a write finishes inside one
    //millisecond.
    let broken = true;
    const l = makeLife({
        read: () => {
            if (broken) throw new Error('mid-write');
            return Buffer.from(JSON.stringify(cred()));
        },
        statOf: () => ({ mtimeMs: 1000, size: 42 })
    });

    assert.equal(l.of('/creds/a.json').readable, false);
    broken = false;
    assert.equal(l.of('/creds/a.json').readable, true, 'the failure was cached against the mtime');
});

//---------------------------------------------------------------------------
//4. IT IS ASKED ON A DRAW LOOP.
//---------------------------------------------------------------------------

test('a second read of an unchanged file does not unseal it again', () => {
    const l = lifeWith(cred());
    l.of('/creds/a.json');
    l.of('/creds/a.json');
    l.of('/creds/a.json');
    assert.equal(reads, 1, 'the credential was unsealed ' + reads + ' times for three reads');
});

test('a file that changed within the same millisecond is still re-read', () => {
    //Keyed on mtime AND size, because a rewrite inside one millisecond is a
    //thing that happens.
    let size = 42;
    let n = 0;
    const l = makeLife({
        read: () => { n++; return Buffer.from(JSON.stringify(cred())); },
        statOf: () => ({ mtimeMs: 1000, size: size })
    });

    l.of('/creds/a.json');
    size = 43;
    l.of('/creds/a.json');
    assert.equal(n, 2, 'a same-millisecond rewrite was served from the cache');
});
