const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const actionsPlugin = require('../../src/app/core/actions/main');
const diyPlugin = require('../../src/app/diy/server');

//---------------------------------------------------------------------------
//THE DOOR ONTO THE EDITOR — the action, not the engine.
//
//../vms/editor-open.test.js already holds the engine to everything that was
//measured about starting VS Code on a real workstation. NOTHING HERE SPAWNS
//ANYTHING: the engine is a stand-in that records what it was asked for, because
//what this file is about is the three decisions the ACTION makes before the
//engine is reached.
//
//1. WHO MAY PRESS IT. It starts a window on the operator's own computer, so the
//   command line and a driven press are refused. A refusal nothing exercises is
//   a refusal nobody finds out has stopped working, so `_fromTest` is let
//   through on purpose and this file is what uses it.
//
//2. WHAT THE FAR END IS, which is the one that would fail silently. ssh matches
//   its configuration on the host argument it is GIVEN: hand VS Code
//   `okc@1.2.3.4` and the `Host okc-<name>` block never matches, so
//   `IdentityFile` and `IdentitiesOnly` never apply — and the connection falls
//   back to whatever identity the operator happens to have, which is the one key
//   ../core/ssh exists to stop using. It would still OPEN. It would open with
//   the wrong key, on every machine, and nothing on screen would differ.
//
//3. THAT THE KEY IS SET UP FIRST. A press that only works if somebody visited
//   the Keys pane earlier is a press that works on the machine it was written on.
//---------------------------------------------------------------------------

let asked, said, register, machines;

//THE MACHINE THE PANE WAS BUILT AGAINST, spelt the way the register spells it.
const VM = (over) => Object.assign({
    name: 'beta-worker1',
    running: true,
    spec: { folder: '/home/okc/workspace' }
}, over || {});

//WHAT ../core/ssh HANDS BACK, and the shape matters as much as the values —
//`alias` and `usesOurKey` are added by the service on the way out, and a
//stand-in without them would let a pane pass that reads neither.
const READING = (over) => Object.assign({
    name: 'beta-worker1',
    address: '192.168.51.221',
    user: 'okc',
    alias: 'okc-beta-worker1',
    usesOurKey: true
}, over || {});

beforeEach(() => {
    asked = { opened: [], ssh: [] };
    said = [];
    machines = { 'beta-worker1': VM() };
    register = READING();
});

async function anApp(over) {
    let actions = null;
    await actionsPlugin({}, async (_e, s) => { actions = s.actions; });

    const logger = ['info', 'warn', 'good', 'bad'].reduce((n, k) => {
        n[k] = (t) => said.push(k + ': ' + t);
        return n;
    }, {});

    await diyPlugin(Object.assign({
        app: { host: { actions } },
        log: { on: () => logger },

        //THE ENGINE, RECORDING RATHER THAN SPAWNING. It answers the shape the
        //real one answers with — see ../../src/app/vms/editor/open-editor.js —
        //so the note this action builds is built from real fields.
        editor: {
            open: async (it) => {
                asked.opened.push(it);
                return { opened: it.dir, on: it.remote, using: 'code.cmd', found: 'found where it installs' };
            }
        },

        //ALL THREE RECORDED IN ORDER, because the ORDER is the claim: the config
        //has to be written before anything tries to connect through it.
        ssh: {
            ensure: () => { asked.ssh.push('ensure'); return {}; },
            writeConfig: (list) => { asked.ssh.push('writeConfig:' + (list || []).length); return 'ssh_config'; },
            ensureInclude: () => { asked.ssh.push('ensureInclude'); return { added: false }; },
            readingOf: () => register
        },

        ours: {
            get: (n) => machines[n],
            read: () => Object.keys(machines).map((k) => machines[k])
        },

        repoWorkspaces: { folderFor: (spec) => (spec && spec.folder) || '/home/okc/workspace' }
    }, over || {}), async () => {});

    return actions;
}

//---- who may press it ------------------------------------------------------

test('the command line is refused, and told where the button is', async () => {
    const actions = await anApp();

    await assert.rejects(
        () => actions.call('openEditor', { name: 'beta-worker1', _overTheWire: true }),
        (e) => {
            assert.match(e.message, /person's press/i);
            //THE REFUSAL HAS TO SAY WHERE TO GO. A refusal that only says no
            //leaves somebody driving it from the Windows side by hand, which is
            //the thing this plugin was written after.
            assert.match(e.message, /DIY/);
            return true;
        }
    );

    assert.equal(asked.opened.length, 0, 'nothing should have been opened');
});

test('a driven press is refused too', async () => {
    const actions = await anApp();
    await assert.rejects(() => actions.call('openEditor', { name: 'beta-worker1', _driven: true }), /person's press/i);
    assert.equal(asked.opened.length, 0);
});

test('a test may press it, or the refusal could never be exercised', async () => {
    const actions = await anApp();
    const said2 = await actions.call('openEditor', { name: 'beta-worker1', _overTheWire: true, _fromTest: true });
    assert.equal(said2.name, 'beta-worker1');
    assert.equal(asked.opened.length, 1);
});

//---- what the far end is ---------------------------------------------------

test('it opens the ALIAS, never user@address', async () => {
    const actions = await anApp();
    await actions.call('openEditor', { name: 'beta-worker1', _fromTest: true });

    const it = asked.opened[0];
    assert.equal(it.remote, 'okc-beta-worker1');

    //SAID AS ITS OWN CHECK rather than left to the equality above. The failure
    //this guards against is not "the wrong string" — it is a string that WORKS,
    //connects, opens the folder, and uses the operator's own key to do it.
    assert.ok(!/@/.test(it.remote),
        'user@address matches no Host block, so IdentityFile never applies and ssh falls back to the operator\'s key');
});

test('the folder is the machine\'s workspace, and --dir overrides it', async () => {
    const actions = await anApp();

    await actions.call('openEditor', { name: 'beta-worker1', _fromTest: true });
    assert.equal(asked.opened[0].dir, '/home/okc/workspace');

    await actions.call('openEditor', { name: 'beta-worker1', dir: '/tmp/somewhere', _fromTest: true });
    assert.equal(asked.opened[1].dir, '/tmp/somewhere');
});

//---- that the key is set up first ------------------------------------------

test('the key, the config and the Include all happen before it opens', async () => {
    const actions = await anApp();
    await actions.call('openEditor', { name: 'beta-worker1', _fromTest: true });

    assert.deepEqual(asked.ssh, ['ensure', 'writeConfig:1', 'ensureInclude']);
    assert.equal(asked.opened.length, 1, 'and the editor was reached after them');
});

//---- the refusals that are about the machine -------------------------------

test('a machine that has not dialled in is refused in a sentence', async () => {
    register = READING({ address: null });
    const actions = await anApp();

    await assert.rejects(
        () => actions.call('openEditor', { name: 'beta-worker1', _fromTest: true }),
        (e) => {
            assert.match(e.message, /has not said where it is/);
            //NOT A STACK, AND NOT "undefined". This is the button where somebody
            //meets the system, and the machine simply not being up yet is the
            //ordinary way to arrive here.
            assert.ok(!/undefined/.test(e.message), e.message);
            return true;
        }
    );
    assert.equal(asked.opened.length, 0);
});

test('a machine that is off says so, since that is why it has no address', async () => {
    machines['beta-worker1'] = VM({ running: false });
    register = READING({ address: null, user: null });
    const actions = await anApp();

    await assert.rejects(
        () => actions.call('openEditor', { name: 'beta-worker1', _fromTest: true }),
        /it is not running/
    );
});

test('a name nothing knows is refused by name', async () => {
    const actions = await anApp();
    await assert.rejects(
        () => actions.call('openEditor', { name: 'nope', _fromTest: true }),
        /no machine called "nope"/
    );
});

test('no name at all says what to type', async () => {
    const actions = await anApp();
    await assert.rejects(() => actions.call('openEditor', { _fromTest: true }), /Say which machine/);
});

//---- the machine built with somebody else's key -----------------------------

test('a machine not built with this app\'s key still opens, and says so', async () => {
    register = READING({ usesOurKey: false });
    const actions = await anApp();

    const answer = await actions.call('openEditor', { name: 'beta-worker1', _fromTest: true });

    //IT OPENS. The config leaves such a machine to ssh's own defaults, which is
    //what reached it before this app had a key at all — refusing would be this
    //app breaking a machine it did not build.
    assert.equal(asked.opened.length, 1);
    assert.equal(answer.usesOurKey, false);

    //AND IT IS ON THE ANSWER AND IN THE LOG, because "which key opened this"
    //is not a question anybody thinks to ask until the day it matters.
    assert.match(answer.note, /default identity/);
    assert.ok(said.some((l) => /warn: .*ssh key/.test(l)), said.join(' | '));
});

test('the ordinary answer does not warn about the key', async () => {
    const actions = await anApp();
    const answer = await actions.call('openEditor', { name: 'beta-worker1', _fromTest: true });

    assert.equal(answer.usesOurKey, true);
    assert.ok(!/default identity/.test(answer.note), answer.note);
    assert.ok(!said.some((l) => /warn:/.test(l)), said.join(' | '));
});
