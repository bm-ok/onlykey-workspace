const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sshPlugin = require('../../src/app/core/ssh/server');

//---------------------------------------------------------------------------
//the key this app uses to get into the machines it made.
//
//THE CLAIMS, and most of them are about what it must NOT do:
//
//  * it is never quietly remade. A new key locks out every machine already
//    built, because the old public half is in their authorized_keys and nothing
//    here can reach in to change it
//  * the private half is never handed out — a path is, and a fingerprint
//  * the config names this key ONLY for machines that would accept it.
//    Naming it unconditionally broke every machine built before it existed
//  * and it writes BOTH spellings of the include path, because there are two
//    ssh programs on a Windows machine and a missing include is silently not an
//    error in either
//
//AGAINST A REAL ssh-keygen, because what this does IS run one. A fake would be
//testing the fake — and the fingerprint has to come back in a shape a person can
//compare.
//---------------------------------------------------------------------------

let ssh, dir, home, made;

beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-ssh-'));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-ssh-home-'));

    //THE KEYS DIRECTORY IS OVERRIDABLE precisely so a test can make one without
    //touching the key real machines already trust.
    process.env.OKC_KEYS = dir;

    said = [];
    ssh = null;
    await sshPlugin({
        app: { host: {} },
        log: { on: () => ({ good: (t) => said.push(t), warn: (t) => said.push(t), bad() {}, info() {} }) },
        dataDir: { path: dir, at: (...p) => path.join(dir, ...p) }
    }, async (_e, s) => { ssh = s.ssh; });
});

let said;

after(() => { delete process.env.OKC_KEYS; });

//A REAL KEY IS SLOW-ISH TO MAKE, so the tests that need one share the check.
const aKey = () => ssh.make();

//---------------------------------------------------------------------------
//MADE ONCE, AND NEVER QUIETLY REMADE.
//---------------------------------------------------------------------------

test('there is no key until one is made, and it says so rather than pretending', () => {
    const before = ssh.state();

    assert.equal(ssh.have(), false);
    assert.equal(before.ok, false);
    assert.equal(before.missing, true);
    assert.match(before.why, /no ssh key of its own yet/);
    assert.equal(ssh.publicKey(), null);
    assert.equal(ssh.fingerprint(), null);
});

test('making one gives a key and its public half', () => {
    const out = aKey();

    assert.equal(out.made, true);
    assert.equal(ssh.have(), true);
    assert.match(ssh.publicKey(), /^ssh-ed25519 /);
    //THE COMMENT SAYS WHOSE IT IS, so a person reading an authorized_keys knows.
    assert.match(ssh.publicKey(), /okc-dashboard$/);
});

test('making one again does nothing, because a new key locks out every machine', () => {
    aKey();
    const first = ssh.publicKey();

    const again = ssh.make();
    assert.equal(again.made, false);
    assert.equal(ssh.publicKey(), first, 'it quietly made a second key');
});

test('and forcing it is a deliberate act that says what it cost', () => {
    aKey();
    const first = ssh.publicKey();

    const forced = ssh.make({ force: true });
    assert.equal(forced.made, true);
    assert.notEqual(ssh.publicKey(), first);

    //THE COST IS STATED. Every machine built with the old key is now unreachable
    //and nothing here can reach in to fix that.
    assert.match(said.join(' | '), /can no longer be reached/);
});

//---------------------------------------------------------------------------
//THE PRIVATE HALF IS NEVER HANDED OUT.
//---------------------------------------------------------------------------

test('what the window is shown is a fingerprint and a path, never the key', () => {
    aKey();
    const now = ssh.state();

    assert.equal(now.ok, true);
    //SHA256:… is what a person compares.
    assert.match(now.fingerprint, /^SHA256:/);
    assert.equal(now.file, path.join(dir, 'id_okc'));
    assert.ok(now.made, 'it does not say when it was made');

    //A WINDOW THAT SHOWS A PRIVATE KEY IS A WINDOW THAT ENDS UP IN A SCREENSHOT.
    const secret = fs.readFileSync(path.join(dir, 'id_okc'), 'utf8');
    const shown = JSON.stringify(now);
    assert.equal(shown.indexOf('PRIVATE KEY'), -1, 'the private key reached the window');
    assert.ok(secret.length > 100);
    secret.split('\n').filter((l) => l.length > 30).forEach((line) => {
        assert.equal(shown.indexOf(line.trim()), -1, 'a line of the private key reached the window');
    });
});

//---------------------------------------------------------------------------
//THE CONFIG, AND THE MACHINES IT MUST NOT BREAK.
//---------------------------------------------------------------------------

const machines = () => [
    { name: 'runner2', address: '192.168.51.221', user: 'okc', mine: true },
    { name: 'older-one', address: '192.168.51.9', user: 'okc', mine: false }
];

test('a machine gets an alias, an address and a user', () => {
    aKey();
    const at = ssh.writeConfig(machines());
    const text = fs.readFileSync(at, 'utf8');

    assert.match(text, /Host okc-runner2/);
    assert.match(text, /HostName 192\.168\.51\.221/);
    assert.match(text, /User okc/);
});

test('this key is named ONLY for machines that would accept it', () => {
    aKey();
    const text = fs.readFileSync(ssh.writeConfig(machines()), 'utf8');

    const blocks = text.split('Host ').filter((b) => b.trim());
    const mine = blocks.find((b) => b.startsWith('okc-runner2'));
    const theirs = blocks.find((b) => b.startsWith('okc-older-one'));

    assert.match(mine, /IdentityFile/);
    assert.match(mine, /IdentitiesOnly yes/);

    //NAMING IT UNCONDITIONALLY BROKE EVERY MACHINE BUILT BEFORE THE KEY EXISTED:
    //they have somebody else's public half in authorized_keys, and
    //`IdentitiesOnly` then guarantees the one identity that cannot work is the
    //only one offered.
    assert.doesNotMatch(theirs, /IdentityFile/);
    assert.doesNotMatch(theirs, /IdentitiesOnly/);
});

test('paths in it are forward slashes, because a backslash is an escape there', () => {
    aKey();
    const text = fs.readFileSync(ssh.writeConfig(machines()), 'utf8');
    const back = String.fromCharCode(92);

    text.split('\n').filter((l) => /IdentityFile|UserKnownHostsFile/.test(l)).forEach((line) => {
        assert.equal(line.indexOf(back), -1, 'a backslash reached an ssh config value: ' + line);
    });
});

test('a host key that changed is expected rather than alarming', () => {
    aKey();
    const text = fs.readFileSync(ssh.writeConfig(machines()), 'utf8');

    //THESE MACHINES ARE MADE AND DESTROYED CONSTANTLY and their addresses are
    //reused. And it is kept out of the operator's known_hosts for the same
    //reason.
    assert.match(text, /StrictHostKeyChecking no/);
    assert.match(text, /UserKnownHostsFile/);
    assert.doesNotMatch(text, new RegExp(os.homedir().split(String.fromCharCode(92)).join('/') + '/.ssh/known_hosts'));
});

test('it is rewritten whole, so a machine that has gone leaves nothing behind', () => {
    aKey();
    ssh.writeConfig(machines());
    ssh.writeConfig([machines()[0]]);

    const text = fs.readFileSync(ssh.writeConfig([machines()[0]]), 'utf8');
    //A FILE THAT ONLY EVER GREW would accumulate entries pointing at nothing,
    //which fail slowly and confusingly rather than not existing.
    assert.match(text, /okc-runner2/);
    assert.doesNotMatch(text, /okc-older-one/);
});

test('a machine with no address or no user is not written at all', () => {
    aKey();
    const text = fs.readFileSync(ssh.writeConfig([
        { name: 'half', address: null, user: 'okc', mine: true },
        { name: 'other-half', address: '10.0.0.1', user: null, mine: true }
    ]), 'utf8');

    assert.doesNotMatch(text, /okc-half/);
    assert.doesNotMatch(text, /okc-other-half/);
});

test('an alias cannot carry anything ssh would read as syntax', () => {
    assert.equal(ssh.aliasFor('runner 2'), 'okc-runner-2');
    assert.equal(ssh.aliasFor('a/b c'), 'okc-a-b-c');
    assert.equal(ssh.aliasFor('fine.name_1-2'), 'okc-fine.name_1-2');
});

//---------------------------------------------------------------------------
//TWO SPELLINGS OF ONE PATH.
//---------------------------------------------------------------------------

test('both spellings are offered, because two ssh programs read this differently', () => {
    const lines = ssh.includeLines();

    if (process.platform === 'win32') {
        //Windows OpenSSH wants C:/Users/…; git's MSYS ssh reads that as a
        //RELATIVE path, finds nothing, and carries on WITHOUT SAYING ANYTHING —
        //so the alias is simply not there and `ssh okc-runner2` answers "could
        //not resolve hostname" as though the machine were the problem.
        assert.equal(lines.length, 2, 'only one spelling was offered');
        assert.ok(lines.some((l) => /Include "[A-Za-z]:\//.test(l)), lines.join(' | '));
        assert.ok(lines.some((l) => /Include "\/[a-z]\//.test(l)), lines.join(' | '));
    } else {
        assert.equal(lines.length, 1, 'two spellings offered where there is only one');
    }
});

test('the operator’s config gets the lines it is missing, at the top', () => {
    const user = path.join(home, '.ssh', 'config');
    const was = 'Host something-of-mine\n  HostName example.invalid\n';
    fs.mkdirSync(path.dirname(user), { recursive: true });
    fs.writeFileSync(user, was);

    const realHome = os.homedir;
    os.homedir = () => home;
    try {
        const first = ssh.ensureInclude();
        assert.equal(first.added, true);

        const text = fs.readFileSync(user, 'utf8');
        //`Include` HAS TO COME BEFORE ANY `Host` BLOCK to apply to everything.
        assert.ok(text.indexOf('Include') < text.indexOf('Host something-of-mine'));
        //AND WHAT WAS THERE IS KEPT. This is the only edit this app makes to a
        //file it does not own.
        assert.ok(text.indexOf(was.trim()) >= 0, 'it overwrote the operator’s own config');

        //IDEMPOTENT.
        const again = ssh.ensureInclude();
        assert.equal(again.added, false);
        assert.deepEqual(again.lines, []);
    } finally { os.homedir = realHome; }
});

test('a config written before the second spelling was known is repaired, not left half-working', () => {
    const user = path.join(home, '.ssh', 'config');
    fs.mkdirSync(path.dirname(user), { recursive: true });

    const lines = ssh.includeLines();
    if (lines.length < 2) return; //only one spelling on this platform

    //EACH LINE IS CHECKED SEPARATELY. Every machine that already exists is in
    //exactly this state.
    fs.writeFileSync(user, lines[0] + '\n');

    const realHome = os.homedir;
    os.homedir = () => home;
    try {
        const said = ssh.ensureInclude();
        assert.equal(said.added, true);
        assert.deepEqual(said.lines, [lines[1]], 'it added the wrong line, or both again');
    } finally { os.homedir = realHome; }
});
