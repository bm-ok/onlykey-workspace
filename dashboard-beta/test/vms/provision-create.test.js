const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const statePlugin = require('../../src/app/core/state/main');
const oursPlugin = require('../../src/app/vms/ours/server');
const provisionPlugin = require('../../src/app/vms/provision/server');

//---------------------------------------------------------------------------
//making a machine: where the spec, the build and the register meet.
//
//THE CLAIM WORTH THE MOST: a name is checked against ALL of VirtualBox, not
//against this app's own list. The collision that matters is with any machine on
//the host, especially one this app must not touch — checking only our own would
//walk straight into creating over somebody else's while looking careful.
//
//AND THE SECOND: what the build DECIDED is what gets written down. The image it
//resolved, the adapter it picked, the disk it made and the console it attached
//are facts produced by the build, and a register that worked them out again
//would be a second opinion about them.
//---------------------------------------------------------------------------

let provision, ours, asked, exists, isos, bridges, said;

beforeEach(async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-create-'));
    asked = [];
    exists = {};
    isos = [{ name: 'ubuntu-24.04.iso', location: 'C:/isos/ubuntu.iso' }];
    bridges = [{ name: 'Realtek', status: 'Up', ip: '192.168.51.63' }];
    said = [];

    let state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dataDir, ...p) } },
        async (_e, s) => { state = s.state; });

    const log = {
        on: function () {
            const to = {
                good: (m) => said.push(m), warn: (m) => said.push('WARN ' + m),
                bad: (m) => said.push('BAD ' + m), info: (m) => said.push(m),
                on: () => to
            };
            return to;
        }
    };

    const vbox = {
        available: () => true,
        exists: async (name) => !!exists[name],
        run: async (args) => { asked.push(args.join(' ')); return ''; },
        isos: async () => isos,
        bridges: async () => bridges,
        hostOnlyIfs: async () => [{ name: 'HostOnly' }],
        makeHostOnlyIf: async () => 'HostOnly',
        info: async () => ({ CfgFile: 'C:/vms/one/one.vbox' }),
        setSerial: async (name, file) => { asked.push('setSerial ' + name); return { on: true, file }; },
        snapshots: async () => ({ snapshots: [] }),
        deleteSnapshot: async () => {},
        listAll: async () => [],
        runningAll: async () => [],
        state: async () => 'poweroff'
    };

    const channel = { newToken: () => 'a-token', connected: () => false, list: () => [] };

    await oursPlugin({ app: { host: {} }, log, state, vbox, channel },
        async (_e, s) => { ours = s.ours; });

    await provisionPlugin({
        app: { host: {} }, log, ours, channel, vbox,
        dataDir: { at: (...p) => path.join(dataDir, ...p) },
        //THE TWO THIS PLUGIN NEEDS TO LOAD BUT NOT TO CREATE ANYTHING. The
        //repairs are scheduled at load — see ./provision-repairs.test.js, which
        //is where what they do is checked.
        cron: { add: () => {}, does: () => () => {} },
        tls: { ensure: () => ({ fingerprint: 'aabbcc' }) },

        //THE APP'S OWN SSH KEY, which building a machine now DECLARES it needs —
        //see the consumes line in provision/server.js. Every machine built here
        //carries this in its installer's authorized_keys, and a machine built
        //without one cannot be logged into to find out why it failed.
        keys: { ssh: { ensure: () => ({ publicKey: 'ssh-ed25519 AAAAfake okc-dashboard' }) } },
        //THE VERBS A MACHINE MAY ASK THIS PLUGIN FOR ARE REGISTERED AT LOAD —
        //see src/app/vms/provision/guestapi.js, and test/vms/https-registry.test.js
        //for what the registry does with them.
        guestApi: { api: () => () => {}, PORT: 7317, CA_PORT: 7318, CHANNEL_PORT: 7374 }
    }, async (_e, s) => { provision = s.provision; });
});

//---- the refusals -----------------------------------------------------------

test('a name VirtualBox already has is refused, even one this app did not make', async () => {
    exists['somebody-elses-vm'] = true;

    //ESPECIALLY ONE THIS APP MUST NOT TOUCH. Creating over it is the mistake the
    //whole register exists to prevent.
    await assert.rejects(() => provision.create({ name: 'somebody-elses-vm', iso: 'ubuntu' }),
        /VirtualBox already has a machine called "somebody-elses-vm".*will not touch a machine it did not make/s);

    //AND NOTHING WAS BUILT. A refusal that has already run createvm is not one.
    assert.deepEqual(asked, []);
    assert.deepEqual(ours.read(), []);
});

test('a name that is not a name is refused before VirtualBox is asked anything', async () => {
    await assert.rejects(() => provision.create({ name: 'two words' }),
        /letters, numbers, dots or dashes/);
    assert.deepEqual(asked, []);
});

test('no VirtualBox at all is refused, rather than half-writing a record', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-create-'));
    let state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dataDir, ...p) } },
        async (_e, s) => { state = s.state; });

    const log = { on: function () { const to = { good() {}, warn() {}, bad() {}, info() {}, on: () => to }; return to; } };
    const gone = Object.assign({}, { available: () => false, listAll: async () => [], runningAll: async () => [] });
    let theirs, theirProvision;
    await oursPlugin({ app: { host: {} }, log, state, vbox: gone, channel: { connected: () => false, list: () => [] } },
        async (_e, s) => { theirs = s.ours; });
    await provisionPlugin({
        app: { host: {} }, log, ours: theirs, channel: { newToken: () => 't' }, vbox: gone,
        dataDir: { at: (...p) => path.join(dataDir, ...p) },
        cron: { add: () => {}, does: () => () => {} },
        tls: { ensure: () => ({ fingerprint: 'aabbcc' }) },

        //THE APP'S OWN SSH KEY, which building a machine now DECLARES it needs —
        //see the consumes line in provision/server.js. Every machine built here
        //carries this in its installer's authorized_keys, and a machine built
        //without one cannot be logged into to find out why it failed.
        keys: { ssh: { ensure: () => ({ publicKey: 'ssh-ed25519 AAAAfake okc-dashboard' }) } },
        //THE VERBS A MACHINE MAY ASK THIS PLUGIN FOR ARE REGISTERED AT LOAD —
        //see src/app/vms/provision/guestapi.js, and test/vms/https-registry.test.js
        //for what the registry does with them.
        guestApi: { api: () => () => {}, PORT: 7317, CA_PORT: 7318, CHANNEL_PORT: 7374 }
    }, async (_e, s) => { theirProvision = s.provision; });

    await assert.rejects(() => theirProvision.create({ name: 'one' }),
        /VirtualBox is not installed/);
    assert.deepEqual(theirs.read(), []);
});

//---- what gets written down --------------------------------------------------

test('what the build decided is what the register keeps', async () => {
    const vm = await provision.create({ name: 'one', iso: 'ubuntu', tags: 'worker' });

    //FACTS PRODUCED BY THE BUILD. A register that worked them out again would be
    //a second opinion about them.
    assert.equal(vm.spec.iso, 'C:/isos/ubuntu.iso');
    assert.equal(vm.spec.bridge, 'Realtek');
    assert.equal(vm.spec.disk, path.join('C:/vms/one', 'one.vdi'));

    //`serial` AMONG THE REST: the port was attached as the machine was built,
    //and the register has to say so or the window will not know there is a
    //console to read.
    assert.ok(vm.serial && vm.serial.endsWith('one.log'), JSON.stringify(vm.serial));
    assert.ok(asked.includes('setSerial one'), asked.join('\n'));
});

test('it is on the register, once, and can be read back', async () => {
    await provision.create({ name: 'one', iso: 'ubuntu' });

    assert.deepEqual(ours.read().map((v) => v.name), ['one']);
    assert.equal(ours.get('one').name, 'one');
    //AND THE SECOND ONE IS REFUSED BY THE REGISTER rather than by VirtualBox,
    //because this app already has it.
    await assert.rejects(() => provision.create({ name: 'one', iso: 'ubuntu' }),
        /already has a virtual machine called "one"/);
});

test('a supervisor is built as one and recorded as one, in the same act', async () => {
    const vm = await provision.create({ name: 'sup1', iso: 'ubuntu', supervisor: true });

    //THE FLAG, THE TAG AND THE SECRET CANNOT DISAGREE, because there is one
    //moment where any of them is set — see ./spec.js.
    assert.equal(vm.spec.supervisor, true);
    assert.deepEqual(vm.tags, ['supervisor']);
    assert.equal(ours.canBe(vm, 'supervisor'), true);
    assert.equal(ours.takesQueuedWork(vm), false);
});

test('every machine gets its own token, and it is the one the channel would check', async () => {
    const vm = await provision.create({ name: 'one', iso: 'ubuntu' });

    //ISSUED BY THE THING THAT CHECKS THEM. A token this app makes and a token
    //this app accepts coming from two places is a machine that cannot dial in
    //for a reason nothing explains.
    assert.equal(vm.spec.token, 'a-token');
});

test('and it says the machine has no operating system yet', async () => {
    await provision.create({ name: 'one', iso: 'ubuntu' });

    //THE NEXT STEP IS NAMED. "created" on its own reads as finished, and the
    //machine will not boot into anything.
    assert.ok(said.some((m) => /no operating system yet — install one next/.test(m)), said.join(' | '));
});
