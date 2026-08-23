const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', 'src', 'app');
const makeSshKey = require(path.join(APP, 'keys', 'ssh-key.js'));

//---------------------------------------------------------------------------
//THE KEY THIS APP USES TO REACH THE MACHINES IT MADE.
//
//THE CLAIM WORTH THE MOST: it is never quietly remade. The public half lives in
//every machine's `authorized_keys` and nothing here can reach in to change it,
//so a new key locks out every machine that already exists. That has to be a
//deliberate act, not something that happens because a file was missing at an
//awkward moment.
//
//AND THE SECOND: the private half is never handed out. The public half is not a
//secret and is shown in full — it is what goes INTO a guest — but nothing that
//leaves this module carries the private key's contents.
//---------------------------------------------------------------------------

let dir, ran;

function sshWith(opts) {
    const o = opts || {};
    ran = [];
    return makeSshKey({
        dirOf: () => dir,
        run: (exe, args) => {
            ran.push({ exe, args });
            if (o.blowUp) throw new Error('ssh-keygen is not here');

            //A STAND-IN THAT BEHAVES LIKE THE REAL ONE: `-f` writes both halves,
            //`-lf` reports a fingerprint. Anything else and the test would be
            //checking the stand-in.
            const at = args.indexOf('-f');
            if (at >= 0) {
                fs.writeFileSync(args[at + 1], 'PRIVATE-' + Date.now());
                fs.writeFileSync(args[at + 1] + '.pub', 'ssh-ed25519 AAAAC3Nz-fake okc-dashboard');
            }
            if (args[0] === '-lf') return '256 SHA256:abc123def456 okc-dashboard (ED25519)\n';
            return '';
        }
    });
}

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-sshkey-'));
});

//---------------------------------------------------------------------------
//1. MADE ONCE.
//---------------------------------------------------------------------------

test('with no key, one is made', () => {
    const ssh = sshWith({});
    assert.equal(ssh.have(), false);

    const out = ssh.make();
    assert.equal(out.made, true);
    assert.equal(ssh.have(), true);
});

test('a second call does NOT remake it', () => {
    //THE ONE THAT MATTERS. A new key locks out every machine that has the old
    //public half in its authorized_keys.
    const ssh = sshWith({});
    ssh.make();
    const before = fs.readFileSync(path.join(dir, 'id_okc'), 'utf8');

    const again = ssh.make();
    assert.equal(again.made, false);
    assert.equal(fs.readFileSync(path.join(dir, 'id_okc'), 'utf8'), before);
});

test('and `ensure` is safe to call on every start', () => {
    //It is called whenever a machine is built, so it must be idempotent — this
    //is the path by which a key would get quietly replaced.
    const ssh = sshWith({});
    ssh.ensure();
    const before = fs.readFileSync(path.join(dir, 'id_okc'), 'utf8');
    ssh.ensure();
    ssh.ensure();
    assert.equal(fs.readFileSync(path.join(dir, 'id_okc'), 'utf8'), before);
});

test('force remakes it, because that is a deliberate act', () => {
    const ssh = sshWith({});
    ssh.make();
    const before = fs.readFileSync(path.join(dir, 'id_okc'), 'utf8');

    const again = ssh.make({ force: true });
    assert.equal(again.made, true);
    assert.notEqual(fs.readFileSync(path.join(dir, 'id_okc'), 'utf8'), before);
});

test('a half-written pair is remade rather than used', () => {
    //Both halves or neither. A private key with no public half cannot be put
    //into a guest, and reporting "have" for it would hide that.
    const ssh = sshWith({});
    fs.writeFileSync(path.join(dir, 'id_okc'), 'only the private half');
    assert.equal(ssh.have(), false);
    assert.equal(ssh.make().made, true);
});

test('it is made without a passphrase, because it is used unattended', () => {
    //A passphrase this app would have to store beside the key protects nothing.
    const ssh = sshWith({});
    ssh.make();
    const args = ran.find(r => r.args.indexOf('-f') >= 0).args;
    assert.ok(args.includes('-N'), 'no passphrase flag was passed');
    assert.equal(args[args.indexOf('-N') + 1], '', 'a passphrase was set');
    assert.equal(args[args.indexOf('-t') + 1], 'ed25519');
});

//---------------------------------------------------------------------------
//2. WHAT LEAVES THIS MODULE.
//---------------------------------------------------------------------------

test('the public half is given out in full, because it goes into a guest', () => {
    const ssh = sshWith({});
    ssh.make();
    assert.match(ssh.publicKey(), /^ssh-ed25519 /);
});

test('nothing it answers with carries the private half', () => {
    //The public key is not a secret; the private one never leaves. `state` is
    //what the window draws, so it is the one most likely to be widened.
    const ssh = sshWith({});
    ssh.make();

    const secret = fs.readFileSync(path.join(dir, 'id_okc'), 'utf8');
    const said = JSON.stringify(ssh.state());

    assert.ok(said.indexOf(secret) < 0, 'the private key is in what the window is shown');
    assert.ok(said.indexOf('PRIVATE-') < 0, 'the private key is in what the window is shown');
    //and the path to it IS named, which is not the same thing
    assert.ok(said.indexOf('id_okc') >= 0);
});

test('the fingerprint is the middle field, not the whole line', () => {
    //`256 SHA256:abc... comment (ED25519)` — the part a person compares.
    const ssh = sshWith({});
    ssh.make();
    assert.equal(ssh.fingerprint(), 'SHA256:abc123def456');
});

//---------------------------------------------------------------------------
//3. WHEN THERE IS NOTHING, AND WHEN THE TOOL IS MISSING.
//---------------------------------------------------------------------------

test('with no key, state says so plainly rather than looking broken', () => {
    const ssh = sshWith({});
    const said = ssh.state();
    assert.equal(said.have, false);
    assert.equal(said.publicKey, null);
    assert.equal(said.fingerprint, null);
    assert.match(said.note, /No key yet/);
});

test('and state warns what remaking one costs', () => {
    const ssh = sshWith({});
    ssh.make();
    assert.match(ssh.state().note, /locks out every machine/);
});

test('no public key reads as null rather than throwing', () => {
    const ssh = sshWith({});
    assert.equal(ssh.publicKey(), null);
    assert.equal(ssh.fingerprint(), null);
});

test('a fingerprint that cannot be taken is null, not an exception', () => {
    //ssh-keygen missing is a real state on a host without git, and it must not
    //stop the window drawing.
    const ssh = sshWith({});
    ssh.make();

    const broken = makeSshKey({ dirOf: () => dir, run: () => { throw new Error('no ssh-keygen'); } });
    assert.equal(broken.fingerprint(), null);
    assert.doesNotThrow(() => broken.state());
});
