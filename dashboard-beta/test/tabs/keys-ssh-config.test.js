const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', 'src', 'app');
const makeSshConfig = require(path.join(APP, 'keys', 'ssh-config.js'));
const { aliasFor, msys, slashes } = makeSshConfig;

//---------------------------------------------------------------------------
//SO A MACHINE CAN BE REACHED BY NAME.
//
//TWO CLAIMS, AND BOTH FAIL SILENTLY IF THEY ARE WRONG:
//
//  the two spellings   there are two different `ssh` programs on Windows and
//                      they do not read the same path string. A missing include
//                      is not an error in either, so the alias is simply absent
//                      and `ssh okc-runner2` answers "could not resolve
//                      hostname" as though the machine were the problem.
//
//  IdentityFile only   naming this app's key on a machine that does not have it
//                      in authorized_keys, together with `IdentitiesOnly yes`,
//                      guarantees the one identity that CANNOT work is the only
//                      one offered. That locks out every machine built before
//                      the key existed.
//---------------------------------------------------------------------------

const OUR_KEY = 'ssh-ed25519 AAAAOURS okc-dashboard';

let dir, home, ssh;

function sshWith(over) {
    const o = over || {};
    return makeSshConfig({
        dirOf: () => dir,
        homeOf: () => home,
        keyFile: () => path.join(dir, 'id_okc'),
        publicKey: () => (o.publicKey === undefined ? OUR_KEY : o.publicKey)
    });
}

const ours = (name, extra) => Object.assign({
    name, address: '192.168.51.90', user: 'okc', spec: { sshKey: OUR_KEY }
}, extra || {});

const theirs = (name, extra) => Object.assign({
    name, address: '192.168.51.91', user: 'okc', spec: { sshKey: 'ssh-ed25519 AAAASOMEBODYELSE them' }
}, extra || {});

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-sshcfg-'));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-home-'));
    ssh = sshWith({});
});

const written = () => fs.readFileSync(path.join(dir, 'ssh_config'), 'utf8');

//---------------------------------------------------------------------------
//1. AN ALIAS PER MACHINE.
//---------------------------------------------------------------------------

test('a machine gets a host block under a predictable alias', () => {
    ssh.write([ours('runner1')]);
    const out = written();

    assert.match(out, /Host okc-runner1/);
    assert.match(out, /HostName 192\.168\.51\.90/);
    assert.match(out, /User okc/);
});

test('an alias is safe to put in a config, whatever the machine is called', () => {
    assert.equal(aliasFor('runner1'), 'okc-runner1');
    assert.equal(aliasFor('a machine/with spaces'), 'okc-a-machine-with-spaces');
    assert.equal(aliasFor('kit-1.local'), 'okc-kit-1.local');
});

test('a machine with no address is left out entirely', () => {
    //A Host block with no HostName resolves to the ALIAS and fails with "could
    //not resolve hostname" — which reads as the machine being broken rather than
    //as this app never having heard where it is.
    ssh.write([ours('runner1'), { name: 'never-dialled-in', user: 'okc' }, { name: 'no-user', address: '10.0.0.5' }]);
    const out = written();

    assert.match(out, /Host okc-runner1/);
    assert.doesNotMatch(out, /never-dialled-in/);
    assert.doesNotMatch(out, /no-user/);
});

//---------------------------------------------------------------------------
//1b. A REGISTER ROW IS WHAT ARRIVES, NOT A TIDIED ONE.
//---------------------------------------------------------------------------

test('a raw register row is understood, with lastAddress and lastUser', () => {
    //THE BUG THIS CAUGHT. The mapping from `lastAddress` to `address` lived in
    //the ACTION, and the other caller — provision, on dial-in — passes register
    //rows straight through. So every time a machine actually arrived, the config
    //was rewritten with NO HOSTS IN IT: correct until the moment it was supposed
    //to become correct.
    ssh.write([{
        name: 'runner1',
        lastAddress: '192.168.51.108',
        lastUser: 'okc',
        spec: { sshKey: OUR_KEY, user: 'okc' }
    }]);

    const out = written();
    assert.match(out, /Host okc-runner1/);
    assert.match(out, /HostName 192\.168\.51\.108/);
    assert.match(out, /User okc/);
    assert.match(out, /IdentitiesOnly yes/);
});

test('a live address beats what was last recorded', () => {
    //A connected machine is telling us NOW; the record is what it said last
    //time, and these addresses come from DHCP and are reused.
    ssh.write([{
        name: 'runner1',
        agent: { from: '::ffff:192.168.51.200:54321' },
        lastAddress: '192.168.51.108',
        lastUser: 'okc',
        spec: { sshKey: OUR_KEY }
    }]);

    const out = written();
    assert.match(out, /HostName 192\.168\.51\.200/);
    assert.doesNotMatch(out, /192\.168\.51\.108/);
});

test("the machine's own answer for the user beats the spec", () => {
    //A provisioning script can make a different user than the one asked for, and
    //the config has to match what is actually there.
    ssh.write([{
        name: 'runner1',
        lastAddress: '10.0.0.5',
        agent: { facts: { user: 'somebodyelse' } },
        spec: { sshKey: OUR_KEY, user: 'okc' }
    }]);
    assert.match(written(), /User somebodyelse/);
});

test('and the spec is the last resort, not the first', () => {
    ssh.write([{ name: 'runner1', lastAddress: '10.0.0.5', spec: { sshKey: OUR_KEY, user: 'okc' } }]);
    assert.match(written(), /User okc/);
});

test('what the pane is shown uses the same reading as what is written', () => {
    //Two readings of one register is how a pane says a machine is reachable
    //while the file says nothing about it.
    const rows = [{ name: 'runner1', lastAddress: '10.0.0.5', lastUser: 'okc', spec: { sshKey: OUR_KEY } }];
    ssh.write(rows);

    const said = ssh.state(rows);
    assert.equal(said.hosts.length, 1);
    assert.equal(said.hosts[0].address, '10.0.0.5');
    assert.match(written(), /HostName 10\.0\.0\.5/);
});

//---------------------------------------------------------------------------
//2. REWRITTEN WHOLE.
//---------------------------------------------------------------------------

test('a machine that is gone leaves no entry behind', () => {
    //NOT APPENDED TO. Addresses change and machines are deleted; a file that only
    //grows accumulates entries pointing at nothing, which fail slowly and
    //confusingly rather than not existing.
    ssh.write([ours('runner1'), ours('runner2')]);
    assert.match(written(), /okc-runner2/);

    ssh.write([ours('runner1')]);
    assert.doesNotMatch(written(), /okc-runner2/);
});

test('a changed address replaces the old one rather than joining it', () => {
    ssh.write([ours('runner1')]);
    ssh.write([ours('runner1', { address: '192.168.51.99' })]);

    const out = written();
    assert.match(out, /HostName 192\.168\.51\.99/);
    assert.doesNotMatch(out, /192\.168\.51\.90/);
});

test('the file says it is rewritten, so nobody edits it twice', () => {
    ssh.write([]);
    assert.match(written(), /Edits here are lost/);
});

//---------------------------------------------------------------------------
//3. THE KEY IS NAMED ONLY WHERE IT WOULD WORK.
//---------------------------------------------------------------------------

test("this app's key is offered to machines built with it", () => {
    ssh.write([ours('runner1')]);
    const out = written();
    assert.match(out, /IdentityFile .*id_okc/);
    assert.match(out, /IdentitiesOnly yes/);
});

test('and NOT to a machine built with somebody else\'s', () => {
    //THE ONE THAT LOCKS PEOPLE OUT. `IdentitiesOnly yes` beside an identity the
    //machine has never heard of means the only key offered is the only key that
    //cannot work. Left to ssh's defaults instead, which is what reached it
    //before and still does.
    ssh.write([theirs('older-one')]);
    const out = written();

    assert.match(out, /Host okc-older-one/);
    assert.doesNotMatch(out, /IdentityFile/);
    assert.doesNotMatch(out, /IdentitiesOnly/);
});

test('with no key of our own, nothing claims one', () => {
    const bare = sshWith({ publicKey: null });
    bare.write([ours('runner1')]);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'ssh_config'), 'utf8'), /IdentityFile/);
});

test('a machine with no key recorded is not treated as ours', () => {
    ssh.write([ours('runner1', { spec: {} })]);
    assert.doesNotMatch(written(), /IdentitiesOnly/);
});

test('the two are decided per machine, in one file', () => {
    ssh.write([ours('mine'), theirs('not-mine')]);
    const out = written();

    const mine = out.slice(out.indexOf('Host okc-mine'), out.indexOf('Host okc-not-mine'));
    const not = out.slice(out.indexOf('Host okc-not-mine'));

    assert.match(mine, /IdentitiesOnly yes/);
    assert.doesNotMatch(not, /IdentitiesOnly/);
});

//---------------------------------------------------------------------------
//4. CHURN IS THIS APP'S, NOT THE OPERATOR'S.
//---------------------------------------------------------------------------

test('host keys are not checked, and not written into the operator\'s known_hosts', () => {
    //These machines are made and destroyed constantly and their addresses are
    //REUSED, so a changed host key is expected rather than alarming.
    ssh.write([ours('runner1')]);
    const out = written();

    assert.match(out, /StrictHostKeyChecking no/);
    assert.match(out, /UserKnownHostsFile .*known_hosts/);
    assert.doesNotMatch(out, /\.ssh\/known_hosts/);
});

test('paths are written with forward slashes, because a backslash is an escape', () => {
    ssh.write([ours('runner1')]);
    const out = written();
    const identity = out.split('\n').find(l => l.includes('IdentityFile'));
    assert.ok(identity.indexOf(String.fromCharCode(92)) < 0, 'a backslash reached the config: ' + identity);
});

//---------------------------------------------------------------------------
//5. THE TWO SPELLINGS, AND THE INCLUDE.
//---------------------------------------------------------------------------

test('a windows path is offered in both spellings', () => {
    //Windows OpenSSH wants `C:/Users/...`; git's MSYS ssh reads that as a
    //RELATIVE path, finds nothing, and says nothing.
    assert.equal(msys('C:/Users/bmatu/x'), '/c/Users/bmatu/x');
    assert.equal(slashes('C:' + String.fromCharCode(92) + 'Users'), 'C:/Users');

    const win = makeSshConfig({
        dirOf: () => 'C:' + String.fromCharCode(92) + 'data',
        homeOf: () => home, keyFile: () => 'k', publicKey: () => OUR_KEY
    });
    const lines = win.includeLines();
    assert.equal(lines.length, 2);
    assert.ok(lines.some(l => l.includes('C:/data/ssh_config')));
    assert.ok(lines.some(l => l.includes('/c/data/ssh_config')));
});

test('a path with no drive letter is offered once, not twice identically', () => {
    const nix = makeSshConfig({
        dirOf: () => '/home/someone/.config/okc',
        homeOf: () => home, keyFile: () => 'k', publicKey: () => OUR_KEY
    });
    assert.equal(nix.includeLines().length, 1);
});

test('the include goes at the TOP of the operator\'s config', () => {
    //`Include` has to come before any `Host` block to apply to everything.
    fs.mkdirSync(path.join(home, '.ssh'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ssh', 'config'), 'Host something-of-mine\n  HostName example.com\n');

    ssh.ensureInclude();
    const out = fs.readFileSync(path.join(home, '.ssh', 'config'), 'utf8');

    assert.ok(out.indexOf('Include') < out.indexOf('Host something-of-mine'));
    assert.match(out, /Host something-of-mine/, "the operator's own config was thrown away");
});

test('it is the only edit made, and it is idempotent', () => {
    ssh.ensureInclude();
    const once = fs.readFileSync(path.join(home, '.ssh', 'config'), 'utf8');

    const again = ssh.ensureInclude();
    assert.equal(again.added, false);
    assert.equal(fs.readFileSync(path.join(home, '.ssh', 'config'), 'utf8'), once);
});

test('a config missing only ONE spelling is repaired rather than left half-working', () => {
    //Which is the state every machine written before the second spelling was
    //known is in.
    const win = makeSshConfig({
        dirOf: () => 'C:' + String.fromCharCode(92) + 'data',
        homeOf: () => home, keyFile: () => 'k', publicKey: () => OUR_KEY
    });
    const [first, second] = win.includeLines();

    fs.mkdirSync(path.join(home, '.ssh'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ssh', 'config'), first + '\n');

    const out = win.ensureInclude();
    assert.equal(out.added, true);
    assert.deepEqual(out.lines, [second]);

    const text = fs.readFileSync(path.join(home, '.ssh', 'config'), 'utf8');
    assert.ok(text.includes(first) && text.includes(second));
});

test('with no config at all, one is made', () => {
    const out = ssh.ensureInclude();
    assert.equal(out.added, true);
    assert.match(fs.readFileSync(path.join(home, '.ssh', 'config'), 'utf8'), /Include/);
});

//---------------------------------------------------------------------------
//6. WHAT THE PANE IS SHOWN.
//---------------------------------------------------------------------------

test('the pane gets names, aliases and whether each takes our key', () => {
    const said = ssh.state([ours('mine'), theirs('not-mine'), { name: 'no-address' }]);

    assert.equal(said.hosts.length, 2);
    assert.deepEqual(said.hosts.map(h => h.alias), ['okc-mine', 'okc-not-mine']);
    assert.equal(said.hosts[0].usesOurKey, true);
    assert.equal(said.hosts[1].usesOurKey, false);
});

test('and never a key', () => {
    const said = JSON.stringify(ssh.state([ours('mine')]));
    assert.ok(said.indexOf('AAAAOURS') < 0, 'a public key is in what the pane is shown');
    assert.ok(said.indexOf('id_okc') < 0 || said.indexOf('PRIVATE') < 0);
});
