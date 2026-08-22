const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const makeAutoinstall = require('../../src/app/vms/provision/autoinstall');

//---------------------------------------------------------------------------
//A WAY TO WATCH AN INSTALL, and what happens when there is not one.
//
//THE CLAIM WORTH THE MOST: a machine still gets built when this fails. Being
//unable to watch is worse than not installing, but only slightly, and a machine
//that will not build because of a logging convenience is the wrong trade — so
//every failure here comes back as a reason rather than as a throw.
//
//AND THE SECOND: a placeholder that survives substitution is refused. It is not
//a syntax error and not a missing file — it is a valid autoinstall that
//authorises the literal string "@@OKC_SSH_KEY@@" as a login. The install
//succeeds, the machine comes up, and the one way in this exists to provide is
//the one thing that does not work.
//---------------------------------------------------------------------------

const TEMPLATE = [
    '#cloud-config',
    'autoinstall:',
    '  version: 1',
    '  late-commands:',
    "    - \"echo '@@OKC_SSH_KEY@@' > /home/installer/.ssh/authorized_keys\"",
    '  identity:',
    '    username: @@VBOX_INSTALL_USER@@'
].join('\n');

let wrote, files, deal;

beforeEach(() => {
    wrote = {};
    files = { autoinstall: TEMPLATE };

    deal = makeAutoinstall({
        tmpDir: () => path.join('C:', 'tmp'),
        find: (which) => {
            if (!(which in files)) throw new Error('There is no "' + which + '" in any provisioning directory.');
            return 'from/' + which;
        },
        read: (p) => files[p.replace('from/', '')],
        write: (p, text) => { wrote[p] = text; }
    });
});

test('our placeholder is filled in and VirtualBox\'s are left alone', () => {
    const r = deal.fill('one', 'ssh-ed25519 AAAAC3Nz nobody@here');

    assert.equal(r.why, null);
    assert.equal(r.file, path.join('C:', 'tmp', 'okc-autoinstall-one.yaml'));

    const text = wrote[r.file];
    assert.ok(text.includes('ssh-ed25519 AAAAC3Nz nobody@here'), text);

    //VirtualBox READS THE FILE AFTERWARDS and fills in its own. That is what
    //lets this be a COPY of their template rather than a reimplementation — the
    //two substitutions must not meet.
    assert.ok(text.includes('@@VBOX_INSTALL_USER@@'),
        'it consumed a VirtualBox placeholder, so VirtualBox will not fill it in');
});

test('the key is trimmed, because a trailing newline lands inside the quotes', () => {
    const r = deal.fill('one', '  ssh-ed25519 AAAAC3Nz\n');
    assert.ok(wrote[r.file].includes("'ssh-ed25519 AAAAC3Nz'"), wrote[r.file]);
});

test('each machine gets its own file, so two installs at once do not share one', () => {
    const a = deal.fill('one', 'k');
    const b = deal.fill('two', 'k');
    assert.notEqual(a.file, b.file);
});

//---- the refusals, none of which stop an install -----------------------------

test('a placeholder that survived substitution is refused, not written', () => {
    //A VALID AUTOINSTALL THAT AUTHORISES A LITERAL STRING. Nothing fails, and
    //the one way into the installer is the one thing that does not work.
    files.autoinstall = TEMPLATE.split('@@OKC_SSH_KEY@@').join('@@OKC_SSH_KEY@@ @@OKC_SSH_KEY@@');
    deal = makeAutoinstall({
        tmpDir: () => 'C:/tmp',
        find: () => 'from/autoinstall',
        read: () => TEMPLATE,           //the substitution below cannot reach it
        write: (p, t) => { wrote[p] = t; }
    });

    //A key that is itself the placeholder is the shape that gets through a
    //naive replace.
    const r = deal.fill('one', '@@OKC_SSH_KEY@@');
    assert.equal(r.file, null);
    assert.match(r.why, /placeholder/);
    assert.deepEqual(wrote, {}, 'it wrote a template it had already decided was wrong');
});

test('a missing template is a reason, never a throw', () => {
    delete files.autoinstall;

    const r = deal.fill('one', 'k');
    assert.equal(r.file, null);
    assert.match(r.why, /no "autoinstall"/);
});

test('a template that cannot be written is a reason, never a throw', () => {
    deal = makeAutoinstall({
        tmpDir: () => 'C:/tmp',
        find: () => 'from/autoinstall',
        read: () => TEMPLATE,
        write: () => { throw new Error('EACCES: read-only file system'); }
    });

    const r = deal.fill('one', 'k');
    assert.equal(r.file, null);
    assert.match(r.why, /EACCES/);
});

//---- and the quieter half ----------------------------------------------------

test('no ssh key still writes the template, and says what was lost', () => {
    const r = deal.fill('one', '');

    //THE TEMPLATE BUYS TWO THINGS AND ONLY ONE NEEDS A KEY. The installer's
    //journal still reaches the serial port, and that is the half that has
    //actually caught hangs — so this is a warning, not a refusal.
    assert.ok(r.file, 'it refused the whole template over the half that needs a key');
    assert.equal(r.why, null);
    assert.match(r.lost, /cannot be logged into/);
    assert.match(r.lost, /serial console still works/);
});

test('and a machine with a key loses nothing', () => {
    assert.equal(deal.fill('one', 'ssh-ed25519 AAAA').lost, null);
});
