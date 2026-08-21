const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const tlsPlugin = require('../../src/app/core/tls/server');

//---------------------------------------------------------------------------
//the certificate this host serves with, and the small authority that signed it.
//
//AGAINST A REAL openssl, because what this does IS run one — and the two claims
//that matter are about what ends up IN the certificate, which only a real one
//can answer.
//
//THE CLAIMS:
//
//  * the addresses are in subjectAltName, not only the common name. Clients
//    have ignored CN for this purpose for years, and a CN-only certificate is
//    the usual reason a self-signed setup fails with an error that says nothing
//    about names
//  * it is made ONCE. Every machine is told to trust this authority, so a new
//    one per start means every machine losing its trust on every restart
//  * TWO UNRELATED WAYS IT STOPS WORKING are both answered: it expires, with a
//    month's warning; or the host's address moves, with none at all
//  * and both are read OFF the certificate rather than from what we meant to
//    put in it
//
//ONE CERTIFICATE FOR THE WHOLE FILE. Making one runs openssl four times and
//nothing here writes to it, so a fresh one per test would be seconds of nothing.
//---------------------------------------------------------------------------

let tls, dir, said;

before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-tls-'));
    process.env.OKC_KEYS = dir;

    said = [];
    tls = null;
    await tlsPlugin({
        app: { host: {} },
        log: { on: () => ({ good: (t) => said.push(t), warn: (t) => said.push(t), bad() {}, info() {} }) },
        dataDir: { path: dir, at: (...p) => path.join(dir, ...p) }
    }, async (_e, s) => { tls = s.tls; });
});

after(() => {
    delete process.env.OKC_KEYS;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* windows may hold a handle */ }
});

//---------------------------------------------------------------------------

test('there is nothing until one is made, and it says missing rather than guessing', () => {
    assert.equal(tls.have(), false);
    assert.deepEqual(tls.state(), { ok: false, missing: true });
    assert.deepEqual(tls.covers(), []);
});

test('every address a guest might dial is offered', () => {
    const all = tls.addresses();
    assert.ok(all.includes('127.0.0.1'), all.join(', '));
    assert.ok(all.includes('::1'), all.join(', '));
});

test('an address that means nothing is not offered', () => {
    //STUBBED RATHER THAN TAKEN FROM THIS MACHINE, because this machine has no
    //link-local interface — so the check passed with the filter deleted and
    //proved nothing at all. A test whose condition never arises is a sentence.
    const real = os.networkInterfaces;
    os.networkInterfaces = () => ({
        'Ethernet': [{ family: 'IPv4', address: '192.168.1.5' }],
        'Unplugged': [{ family: 'IPv4', address: '169.254.13.201' }],
        'Wi-Fi': [{ family: 'IPv6', address: 'fe80::1' }]
    });

    try {
        const all = tls.addresses();

        assert.ok(all.includes('192.168.1.5'), all.join(', '));
        //169.254 IS WHAT AN INTERFACE HAS WHEN IT HAS NO ADDRESS. Naming one in
        //a certificate says this host is reachable somewhere it is not.
        assert.ok(!all.some((a) => a.startsWith('169.254')),
            'a link-local address was offered: ' + all.join(', '));
        //AND ONLY IPv4 FROM AN INTERFACE, since what a guest dials is an IPv4
        //address; the loopbacks are named outright.
        assert.ok(!all.includes('fe80::1'), all.join(', '));
    } finally { os.networkInterfaces = real; }
});

test('making one produces an authority and a certificate it signed', () => {
    const names = tls.ensure();

    assert.equal(tls.have(), true);
    assert.ok(names.ca.length, 'no authority');
    assert.ok(names.cert.length, 'no certificate');
    assert.ok(names.key.length, 'no key');

    //THE AUTHORITY IS AN AUTHORITY, and only ever signs this one certificate.
    const ca = new crypto.X509Certificate(names.ca);
    assert.equal(ca.ca, true, 'the authority is not marked as one');

    const cert = new crypto.X509Certificate(names.cert);
    assert.equal(cert.ca, false, 'the serving certificate is marked as an authority');
    assert.equal(cert.checkIssued(ca), true, 'the certificate was not signed by the authority');
});

test('the addresses are in subjectAltName, which is the field that is read', () => {
    tls.ensure();
    const cert = new crypto.X509Certificate(fs.readFileSync(path.join(dir, 'server.pem')));

    //A CN-ONLY CERTIFICATE is the usual reason a self-signed setup fails with an
    //error that says nothing about names.
    assert.ok(cert.subjectAltName, 'nothing in subjectAltName at all');
    assert.match(cert.subjectAltName, /127\.0\.0\.1/);
    assert.match(cert.subjectAltName, /localhost/);

    //AND WHAT IT COVERS IS READ BACK OFF IT rather than from what we meant.
    assert.ok(tls.covers().includes('127.0.0.1'), tls.covers().join(', '));
});

test('it can be served with — node accepts the key and certificate together', () => {
    const it = tls.ensure();
    //THE PAIR IS THE POINT. A certificate whose key does not match it is one
    //that fails at the moment a machine dials in, not here.
    assert.doesNotThrow(() => crypto.createPrivateKey(it.key));
    const cert = new crypto.X509Certificate(it.cert);
    assert.equal(cert.checkPrivateKey(crypto.createPrivateKey(it.key)), true);
});

test('the authority fingerprint is published, which is what makes the first fetch safe', () => {
    const it = tls.ensure();

    //NOT A SECRET. It is published so that fetching the authority over an
    //unprotected connection is still safe — which is what makes the very first
    //fetch on a brand-new machine possible at all.
    assert.match(it.fingerprint, /^[0-9a-f]{64}$/);

    const ca = new crypto.X509Certificate(fs.readFileSync(it.caFile));
    assert.equal(it.fingerprint, ca.fingerprint256.replace(/:/g, '').toLowerCase());
});

//---------------------------------------------------------------------------
//MADE ONCE.
//---------------------------------------------------------------------------

test('asking again does not make a new one, because every machine trusts this authority', () => {
    const first = tls.ensure();
    const again = tls.ensure();

    //A NEW AUTHORITY EACH START would mean every machine losing its trust every
    //time the dashboard restarts — which happens constantly while working on it.
    assert.equal(again.fingerprint, first.fingerprint, 'it quietly made a new authority');
});

test('and forcing it is the way out of the one thing it cannot survive', () => {
    const first = tls.ensure();
    const forced = tls.ensure({ force: true });

    //THE HOST'S ADDRESS CHANGING. Nothing regenerates on its own, because doing
    //so silently would break every machine's trust without anybody asking.
    assert.notEqual(forced.fingerprint, first.fingerprint);
});

//---------------------------------------------------------------------------
//TWO UNRELATED WAYS IT STOPS WORKING.
//---------------------------------------------------------------------------

test('a fresh one is good, and says how long it has', () => {
    tls.ensure({ force: true });
    const now = tls.state('127.0.0.1');

    assert.equal(now.ok, true);
    assert.equal(now.expired, false);
    assert.equal(now.expiringSoon, false);
    assert.equal(now.why, null);
    assert.ok(now.daysLeft > 300, 'a year was asked for and ' + now.daysLeft + ' days came back');
});

test('an address it does not cover is refused, with no warning to have given', () => {
    tls.ensure({ force: true });
    const now = tls.state('203.0.113.7');

    //THIS ONE HAS NO DATE AND NO WARNING AT ALL — the host's address simply
    //moved, and every machine is dialling somewhere the certificate never named.
    assert.equal(now.ok, false);
    assert.equal(now.matches, false);
    assert.match(now.why, /does not cover 203\.0\.113\.7/);
    //IT NAMES WHAT IT ACTUALLY NAMES, so somebody reading the refusal can see
    //at once whether the host moved or the certificate was made somewhere else.
    assert.match(now.why, /It names .*127\.0\.0\.1/);
    assert.match(now.why, /Make a new one/);
});

test('the address is checked before the date, because it is the one with no warning', () => {
    tls.ensure({ force: true });
    const now = tls.state('203.0.113.7');
    assert.doesNotMatch(now.why, /expires/);
});

test('no address asked about means no address to disagree with', () => {
    tls.ensure({ force: true });
    assert.equal(tls.state().matches, true);
    assert.equal(tls.matches('127.0.0.1'), true);
    assert.equal(tls.matches('203.0.113.7'), false);
});

test('something unreadable is said as unreadable, not as missing', () => {
    tls.ensure({ force: true });
    fs.writeFileSync(path.join(dir, 'server.pem'), 'this is not a certificate');

    //MISSING AND UNREADABLE ASK FOR DIFFERENT THINGS: one is "make one", the
    //other is "something is wrong with the one you have".
    const now = tls.state('127.0.0.1');
    assert.equal(now.ok, false);
    assert.equal(now.unreadable, true);
    assert.equal(now.missing, undefined);

    tls.ensure({ force: true });
});
