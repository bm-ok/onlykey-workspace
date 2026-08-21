const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makeSpec = require('../../src/app/vms/provision/spec');

//---------------------------------------------------------------------------
//what a machine is built as, decided once.
//
//THE CLAIM WORTH THE MOST: the flag, the tag and the secret cannot disagree,
//because there is only one moment at which any of them is set. A supervisor
//built with the box ticked and no tag was offered to the queue as an ordinary
//runner — that is the bug this shape exists to make impossible.
//---------------------------------------------------------------------------

let spec, tokens;

beforeEach(() => {
    tokens = 0;
    spec = makeSpec({
        newToken: () => 'token-' + (++tokens),
        SUPERVISOR: 'supervisor',
        POOL: 'default'
    });
});

//---- a name is an address --------------------------------------------------

test('a name of letters, numbers, dots and dashes is fine', () => {
    for (const name of ['runner1', 'kit-1', 'sup.one', 'a_b']) {
        assert.equal(spec.fill({ name }).name, name);
    }
});

test('anything else is refused, and the refusal says what IS allowed', () => {
    //VirtualBox KNOWS THE MACHINE BY IT, every action takes it, and it ends up in
    //a hostname and a folder path.
    for (const name of ['two words', '', '   ', 'has/slash', '../escape', 'quote"s']) {
        assert.throws(() => spec.fill({ name }),
            /letters, numbers, dots or dashes/, JSON.stringify(name));
    }
});

test('a name is trimmed rather than refused for surrounding space', () => {
    assert.equal(spec.fill({ name: '  runner1  ' }).name, 'runner1');
});

//---- decided here or never -------------------------------------------------

test('a desktop is off unless it was asked for', () => {
    //EVERY MACHINE IS INSTALLED FROM THE SERVER IMAGE and a desktop is something
    //ADDED. Stripping is never as complete as never installing.
    assert.equal(spec.fill({ name: 'r1' }).desktop, false);
    assert.equal(spec.fill({ name: 'r1', desktop: true }).desktop, true);
    //THE WINDOW SENDS A STRING, a script sends a boolean.
    assert.equal(spec.fill({ name: 'r1', desktop: 'true' }).desktop, true);
    assert.equal(spec.fill({ name: 'r1', desktop: 'false' }).desktop, false);
    assert.equal(spec.fill({ name: 'r1', desktop: 'yes' }).desktop, false);
});

test('and so is being a supervisor', () => {
    assert.equal(spec.fill({ name: 'r1' }).supervisor, false);
    assert.equal(spec.fill({ name: 's1', supervisor: true }).supervisor, true);
    assert.equal(spec.fill({ name: 's1', supervisor: 'true' }).supervisor, true);
});

test('a supervisor always carries its tag, whatever else was typed', () => {
    //THE TAG IS WHAT THE QUEUE READS. The flag and the tag cannot disagree if
    //there is only one moment where either is set.
    assert.deepEqual(spec.fill({ name: 's1', supervisor: true }).tags, ['supervisor']);
    assert.deepEqual(spec.fill({ name: 's1', supervisor: true, tags: 'test' }).tags,
        ['test', 'supervisor']);
    assert.deepEqual(spec.fill({ name: 's1', supervisor: true, tags: ['worker'] }).tags,
        ['worker', 'supervisor']);
});

//---- which pool -------------------------------------------------------------

test('a machine given no kind is in the ordinary pool, and says so', () => {
    //A READER INFERRING IT is how "which pool is this in" came to have two sorts
    //of answer: a tag, or a shrug.
    assert.deepEqual(spec.fill({ name: 'r1' }).tags, ['default']);
    assert.deepEqual(spec.fill({ name: 'r1', tags: '' }).tags, ['default']);
    assert.deepEqual(spec.fill({ name: 'r1', tags: [] }).tags, ['default']);
    assert.deepEqual(spec.fill({ name: 'r1', tags: '  ,  ,' }).tags, ['default']);
});

test('a supervisor is not put in the pool work is drawn from', () => {
    //IT TAKES NO WORK AT ALL, so a name for it there is a name for something
    //that can never happen.
    assert.equal(spec.fill({ name: 's1', supervisor: true }).tags.includes('default'), false);
});

test('tags arrive as a list or as one typed line, and mean the same thing', () => {
    assert.deepEqual(spec.fill({ name: 'r1', tags: 'worker, test' }).tags, ['worker', 'test']);
    assert.deepEqual(spec.fill({ name: 'r1', tags: ['worker', 'test'] }).tags, ['worker', 'test']);
});

test('tags are lowered and de-duplicated', () => {
    assert.deepEqual(spec.fill({ name: 'r1', tags: 'Worker, WORKER, worker' }).tags, ['worker']);
});

//---- its own secret ---------------------------------------------------------

test('every machine gets its own token', () => {
    //SO A MACHINE CAN ONLY EVER DIAL IN AS ITSELF.
    const a = spec.fill({ name: 'r1' }).token;
    const b = spec.fill({ name: 'r2' }).token;

    assert.ok(a);
    assert.notEqual(a, b);
});

test('and one that already has a token keeps it', () => {
    //REBUILDING A MACHINE MUST NOT SILENTLY LOCK OUT the one that is running.
    assert.equal(spec.fill({ name: 'r1', token: 'already-had-one' }).token, 'already-had-one');
    assert.equal(tokens, 0);
});

//---- the additions follow the desktop ---------------------------------------

test('additions are installed for a machine somebody will sit in front of', () => {
    assert.equal(spec.fill({ name: 'r1', desktop: true }).installAdditions, true);
    assert.equal(spec.fill({ name: 'r1' }).installAdditions, false);
});

test('and forced on by shared folders, whatever else was said', () => {
    //A SHARE NEEDS THE MOUNT HELPER, and a machine that declared shares and
    //cannot mount them is one whose whole reason for existing quietly did not
    //happen.
    assert.equal(spec.fill({ name: 'r1', shares: [{ name: 'src', path: '/x' }] }).installAdditions, true);
});

test('but an explicit answer wins over both', () => {
    assert.equal(spec.fill({ name: 'r1', desktop: true, installAdditions: false }).installAdditions, false);
    assert.equal(spec.fill({ name: 'r1', installAdditions: true }).installAdditions, true);
});

//---- declared, never assumed ------------------------------------------------

test('the lists are lists, and empty means the concept does not apply', () => {
    const vm = spec.fill({ name: 'r1' });
    assert.deepEqual(vm.usb, []);
    assert.deepEqual(vm.shares, []);
    assert.deepEqual(vm.setup, []);

    //AND RUBBISH IN THEIR PLACE IS NOT SILENTLY CARRIED. "not been asked" and
    //"does not apply" have to stay different answers.
    const junk = spec.fill({ name: 'r1', usb: 'a mouse', shares: null, setup: 7 });
    assert.deepEqual(junk.usb, []);
    assert.deepEqual(junk.shares, []);
    assert.deepEqual(junk.setup, []);
});

test('a hostname is made from the name when none was given', () => {
    assert.equal(spec.fill({ name: 'kit-1' }).hostname, 'kit-1.local');
    assert.equal(spec.fill({ name: 'sup.one' }).hostname, 'sup-one.local');
    assert.equal(spec.fill({ name: 'r1', hostname: 'chosen.example' }).hostname, 'chosen.example');
});

test('the defaults are the ones arrived at by running the thing', () => {
    const vm = spec.fill({ name: 'r1' });

    //A BUILD IN A 2-CPU GUEST IS MISERABLE; a toolchain plus sources outgrows
    //30GB; and "Ubuntu_64" makes VirtualBox pick worse unattended defaults.
    assert.equal(vm.cpus, 4);
    assert.equal(vm.memoryMB, 8192);
    assert.equal(vm.diskMB, 61440);
    assert.equal(vm.ostype, 'Ubuntu24_LTS_64');
    //BRIDGED, because on NAT a guest cannot see this host at all.
    assert.equal(vm.network, 'bridged');
});

test('a number given as a string is a number, and nonsense is the default', () => {
    assert.equal(spec.fill({ name: 'r1', cpus: '8' }).cpus, 8);
    assert.equal(spec.fill({ name: 'r1', cpus: 'lots' }).cpus, 4);
    assert.equal(spec.fill({ name: 'r1', cpus: 0 }).cpus, 4);
});
