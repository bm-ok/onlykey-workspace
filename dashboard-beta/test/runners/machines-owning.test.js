const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const actionsPlugin = require('../../src/app/core/actions/main');
const machinesPlugin = require('../../src/app/runners/machines/server');

//---------------------------------------------------------------------------
//TWO REGISTERS, ONE VirtualBox.
//
//THE CLAIM THIS FILE IS FOR, and it is the whole reason this port can be run
//beside the app it is porting from:
//
//    THIS APP MAY ONLY DESTROY WHAT ITS OWN REGISTER LISTS,
//    AND MAY ONLY CREATE WHAT VirtualBox DOES NOT ALREADY HAVE.
//
//Those are two different sources of truth ON PURPOSE, and each is the right one
//for its question:
//
//  removing   asks OUR REGISTER. A machine this app did not make is somebody
//             else's — including the app being ported from, which is still
//             running and still using its machines. Clearing this app's state
//             therefore makes it unable to delete anything at all, which is the
//             property stated as a consequence rather than special-cased.
//
//  creating   asks VirtualBox. Either register can be empty while VirtualBox
//             still holds the name, so checking a register would look careful
//             and walk straight into creating over somebody else's machine.
//
//WHAT IS NOT TESTED HERE is the build itself — ../../src/app/vms/provision owns
//that and is tested there. This is the door.
//---------------------------------------------------------------------------

let actions, asked, registry;

//THE MACHINE THAT PROVES IT. `runner1` is in VirtualBox and NOT in this app's
//register — which is exactly the shape of every machine belonging to the app
//being ported from.
const IN_VBOX_ONLY = 'runner1';
const OURS = 'kit-1';

beforeEach(async () => {
    asked = { destroyed: [], dropped: [], created: [], busyFor: [] };
    registry = [{ name: OURS, spec: {}, tags: [] }];

    let table = null;
    await actionsPlugin({}, async (_e, s) => { table = s.actions; });

    await machinesPlugin({
        app: { host: { actions: table } },
        log: { on: () => ({ good() {}, warn() {}, bad() {}, info() {}, out() {} }) },
        dataDir: { at: (...p) => path.join('/tmp', ...p) },

        ours: {
            //THE REAL SHAPE OF THE REFUSAL, which is what is being tested. It is
            //deliberately the same for "no such machine" and "not ours",
            //because saying which would be a way to probe what else is on this
            //host.
            get: (name) => {
                const found = registry.filter(v => v.name === name)[0];
                if (!found) {
                    throw new Error('"' + name + '" is not a virtual machine this app made, so it '
                        + 'will not touch it.');
                }
                return found;
            },
            read: () => registry,
            all: () => registry,
            forget: (name) => {
                registry = registry.filter(v => v.name !== name);
                return { forgotten: name };
            }
        },

        vbox: {
            //VirtualBox HAS BOTH. That is the situation this file is about.
            exists: async (name) => [OURS, IN_VBOX_ONLY].indexOf(name) >= 0,
            destroy: async (name) => { asked.destroyed.push(name); return { destroyed: name }; },
            info: async () => ({}),
            snapshots: async () => [],
            screenshot: async () => null,
            hostAddress: async () => '10.0.0.1'
        },

        busy: {
            during: (name, why, fn) => { asked.busyFor.push(name + ':' + why); return Promise.resolve().then(fn); },
            comingUp: (name, fn) => Promise.resolve().then(fn),
            what: () => null
        },

        channel: {
            connected: () => false,
            drop: (name, why) => asked.dropped.push(name + ':' + why),
            run: async () => ({ code: 0, output: '' })
        },

        provision: {
            create: async (spec) => {
                //THE REAL REFUSAL LIVES IN vms/provision AND IS TESTED THERE.
                //What this stand-in reproduces is only that it ASKS VirtualBox,
                //so the door can be checked for passing the question along.
                asked.created.push(spec && spec.name);
                if ([OURS, IN_VBOX_ONLY].indexOf(spec && spec.name) >= 0) {
                    throw new Error('VirtualBox already has a machine called "' + spec.name + '". '
                        + 'Pick another name — this app will not touch a machine it did not make.');
                }
                registry.push({ name: spec.name, spec: spec, tags: [] });
                return { name: spec.name };
            }
        },

        repoWorkspaces: { folderFor: () => '$HOME/workspace', guestPath: (p) => p, plan: async () => ({}), script: () => '', freeEverywhere: async () => [] },
        tls: { ensure: async () => ({ ca: '' }) },
        guestApi: { PORT: 7317 }
    }, async () => {});

    actions = table;
});

//---------------------------------------------------------------------------
//1. REMOVING ASKS OUR OWN REGISTER, AND NOTHING ELSE.
//---------------------------------------------------------------------------

test('a machine VirtualBox has but our register does not is refused', async () => {
    //THE ONE THAT MATTERS. This is the shape of every machine belonging to the
    //app being ported from: real, running, and none of this app's business.
    await assert.rejects(() => actions.call('vmRemove', { name: IN_VBOX_ONLY }),
        /is not a virtual machine this app made/);

    assert.deepEqual(asked.destroyed, [], 'a machine this app did not make was destroyed');
    assert.deepEqual(asked.dropped, [], 'its channel was dropped anyway');
});

test('and it is refused BEFORE anything is touched, not partway through', async () => {
    //`ours.get` is the first line for this reason: dropping the channel and then
    //refusing would have interfered with a machine belonging to the other app.
    await assert.rejects(() => actions.call('vmRemove', { name: IN_VBOX_ONLY }));
    assert.deepEqual(asked.busyFor, [], 'it took a lock on somebody else\'s machine');
});

test('forgetting one that is not ours is refused too', async () => {
    //Letting go of something we never held is not harmless — it would answer as
    //though this app had been managing it.
    await assert.rejects(() => actions.call('vmForget', { name: IN_VBOX_ONLY }),
        /is not a virtual machine this app made/);
    assert.deepEqual(asked.dropped, []);
});

test('one of ours is removed, and its channel is dropped first', async () => {
    //BEFORE THE MACHINE GOES, so nothing is left holding a session for something
    //that no longer exists — and so a new machine of the same name cannot
    //inherit it.
    const out = await actions.call('vmRemove', { name: OURS });

    assert.deepEqual(asked.dropped, [OURS + ':was deleted']);
    assert.deepEqual(asked.destroyed, [OURS]);
    assert.equal(out.forgotten, OURS);
    assert.deepEqual(registry.map(v => v.name), []);
});

test('removing takes the lock, so nothing else touches that machine meanwhile', async () => {
    await actions.call('vmRemove', { name: OURS });
    assert.deepEqual(asked.busyFor, [OURS + ':being deleted']);
});

test('forgetting one of ours drops the record and leaves the machine alone', async () => {
    const out = await actions.call('vmForget', { name: OURS });

    assert.equal(out.forgotten, OURS);
    assert.deepEqual(asked.destroyed, [], 'forgetting destroyed the machine');
    assert.deepEqual(asked.dropped, [OURS + ':is no longer managed here']);
    assert.deepEqual(registry.map(v => v.name), []);
});

test('an EMPTY register can delete nothing at all', async () => {
    //THE PROPERTY, STATED AS A CONSEQUENCE. A fresh install of this app knows no
    //machines, so every name belongs to somebody else, so every removal is
    //refused. There is no special case for it and there does not need to be.
    registry = [];

    for (const name of [OURS, IN_VBOX_ONLY, 'anything-at-all']) {
        await assert.rejects(() => actions.call('vmRemove', { name }),
            /is not a virtual machine this app made/);
        await assert.rejects(() => actions.call('vmForget', { name }),
            /is not a virtual machine this app made/);
    }

    assert.deepEqual(asked.destroyed, []);
});

//---------------------------------------------------------------------------
//2. CREATING ASKS VirtualBox, NOT EITHER REGISTER.
//---------------------------------------------------------------------------

test('a name VirtualBox already has is refused, even with an empty register', async () => {
    //CHECKING A REGISTER WOULD LOOK CAREFUL AND WALK STRAIGHT INTO IT. Clearing
    //this app's state changes what it can SEE and nothing about what may be
    //made.
    registry = [];

    await assert.rejects(() => actions.call('vmCreate', { vm: { name: IN_VBOX_ONLY } }),
        /VirtualBox already has a machine called "runner1"/);
    await assert.rejects(() => actions.call('vmCreate', { vm: { name: OURS } }),
        /VirtualBox already has a machine called "kit-1"/);
});

test('a name nothing has is created and joins our register', async () => {
    const made = await actions.call('vmCreate', { vm: { name: 'runner-new' } });
    assert.equal(made.name, 'runner-new');
    assert.ok(registry.some(v => v.name === 'runner-new'));
});

test('creating with nothing said still reaches the builder, which names the fault', async () => {
    //Refusing here would be this door deciding what a spec must contain, which
    //is vms/provision's to say — and it says it in one place for the window and
    //the command line at once.
    await actions.call('vmCreate', {}).catch(() => {});
    assert.equal(asked.created.length, 1, 'the door answered instead of asking the builder');
});
