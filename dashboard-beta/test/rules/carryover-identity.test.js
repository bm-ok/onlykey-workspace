const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const makeIdentity = require('../../src/app/carryover/identity');

//---------------------------------------------------------------------------
//BRINGING THIS HOST'S IDENTITY ACROSS.
//
//A machine does not trust an APP, it trusts a certificate authority and an ssh
//key — both pinned at install. So an app with a fresh CA is a STRANGER to every
//existing machine: the channel handshake fails, ssh fails, and the only fix on
//the machine's side is a reinstall.
//
//THE CLAIM WORTH THE MOST: it will not replace an authority that is already
//here. One that has issued anything is one machines may already have pinned, and
//replacing it strands exactly the machines this exists to keep.
//
//AND THE SECOND: the authority that arrives is the authority that left. A copy
//that truncated would leave this app serving a certificate no machine
//recognises — and it would not show until one tried to dial in.
//---------------------------------------------------------------------------

let here, over, carry;

//A REAL CA, made with the openssl that ships with git — the same one core/tls
//uses. Asserting about bytes we wrote ourselves would not catch a copy that
//mangled a PEM; asserting about a certificate openssl can still parse does.
let OPENSSL = null;
for (const p of ['C:/Program Files/Git/usr/bin/openssl.exe', '/usr/bin/openssl']) {
    try { if (fs.existsSync(p)) { OPENSSL = p; break; } } catch (e) { /* keep looking */ }
}

function realCA(dir) {
    execFileSync(OPENSSL, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', path.join(dir, 'ca.key'), '-out', path.join(dir, 'ca.pem'),
        '-days', '30', '-subj', '/CN=okc-test'], { stdio: 'ignore' });
    fs.writeFileSync(path.join(dir, 'ca.srl'), '01\n');
    fs.copyFileSync(path.join(dir, 'ca.key'), path.join(dir, 'server.key'));
    fs.copyFileSync(path.join(dir, 'ca.pem'), path.join(dir, 'server.pem'));
    fs.writeFileSync(path.join(dir, 'id_okc'), 'PRIVATE KEY BYTES');
    fs.writeFileSync(path.join(dir, 'id_okc.pub'), 'ssh-ed25519 AAAA okc');
    fs.writeFileSync(path.join(dir, 'known_hosts'), '192.168.51.221 ssh-ed25519 AAAA');
}

beforeEach(() => {
    here = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-id-here-'));
    over = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-id-over-'));
    fs.rmSync(here, { recursive: true, force: true });   //this app has nothing yet
    if (OPENSSL) realCA(over);
    carry = (dry) => makeIdentity({ here, there: over }).carry(dry);
});

const skip = OPENSSL ? false : 'no openssl on this host';

//---- what comes across ---------------------------------------------------------

test('the whole identity arrives, and the authority is the one that left', { skip }, () => {
    const r = carry();

    assert.deepEqual(r.brought.map((b) => b.name).sort(),
        ['ca.key', 'ca.pem', 'ca.srl', 'id_okc', 'id_okc.pub', 'known_hosts', 'server.key', 'server.pem']);

    //CHECKED RATHER THAN ASSUMED. A copy that silently truncated would leave
    //this app serving a certificate no machine recognises, and it would not show
    //until one tried to dial in.
    assert.ok(r.fingerprint, 'it did not check the authority it copied');
    assert.equal(r.fingerprint.length, 64);
    assert.deepEqual(r.couldNot, []);
});

test('byte for byte, because a PEM that lost a newline is not a PEM', { skip }, () => {
    carry();
    for (const name of ['ca.key', 'ca.pem', 'server.key', 'id_okc']) {
        assert.deepEqual(fs.readFileSync(path.join(here, name)),
            fs.readFileSync(path.join(over, name)), name + ' changed on the way across');
    }
});

test('openssl can still read the authority afterwards', { skip }, () => {
    carry();
    //THE STRONGEST VERSION OF THE CHECK ABOVE: not "the bytes match" but "the
    //thing that will read it can".
    assert.doesNotThrow(() => execFileSync(OPENSSL,
        ['x509', '-in', path.join(here, 'ca.pem'), '-noout', '-subject'], { stdio: 'ignore' }));
});

test('the serial counter comes too, so the next certificate does not collide', { skip }, () => {
    carry();
    //WITHOUT IT openssl starts again at 01 and issues a certificate with a
    //serial one already in the wild.
    assert.ok(fs.existsSync(path.join(here, 'ca.srl')));
});

//---- and what it refuses ----------------------------------------------------------

test('an authority already here is never replaced', { skip }, () => {
    carry();
    const was = fs.readFileSync(path.join(here, 'ca.pem'));

    //A DIFFERENT AUTHORITY over there, to prove it is the refusal doing the work
    //rather than the files happening to match.
    fs.rmSync(over, { recursive: true, force: true });
    fs.mkdirSync(over, { recursive: true });
    realCA(over);

    const again = carry();

    assert.deepEqual(again.brought, []);
    assert.equal(again.couldNot[0].name, 'ca.key');
    assert.match(again.couldNot[0].why, /strands every machine that pinned it/);
    assert.deepEqual(fs.readFileSync(path.join(here, 'ca.pem')), was, 'it replaced the authority');
});

test('nothing to bring from is said, rather than reported as a clean run', { skip }, () => {
    const r = makeIdentity({ here, there: path.join(over, 'nowhere') }).carry();

    assert.deepEqual(r.brought, []);
    assert.match(r.couldNot[0].why, /no folder at/);
    assert.match(r.note, /Pass --from/);
});

test('a missing required file is named; a missing optional one is not', { skip }, () => {
    fs.rmSync(path.join(over, 'server.key'));
    fs.rmSync(path.join(over, 'known_hosts'));

    const r = carry();

    assert.deepEqual(r.couldNot.map((c) => c.name), ['server.key']);
    assert.equal(r.brought.some((b) => b.name === 'known_hosts'), false);
});

//---- looking before leaping ---------------------------------------------------------

test('a dry run writes nothing at all', { skip }, () => {
    const r = carry(true);

    assert.equal(r.dry, true);
    assert.equal(r.brought.length, 8);
    assert.equal(fs.existsSync(path.join(here, 'ca.pem')), false, 'a dry run wrote the authority');
    assert.match(r.note, /^Nothing was written\./);
});

test('the note says what was copied is private', { skip }, () => {
    const r = carry();
    //A REAL ACT, and the person running it from a command line should not have
    //to read the source to find that out.
    assert.match(r.note, /PRIVATE KEYS/);
    assert.match(r.note, /same host as far as every machine is concerned/);
});

test('it says where it took them from and where they went', { skip }, () => {
    const r = carry(true);
    assert.equal(r.from, over);
    assert.equal(r.to, here);
});
