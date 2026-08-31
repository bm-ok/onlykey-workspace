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

let asked, said, register, machines, homeSays, guestExtension;

//BUILT RATHER THAN TYPED. A backslash-n written into this file through a shell
//heredoc arrives as a REAL newline — see ../../CLAUDE.md, which has the same
//warning and was itself mangled by it. This is the one shape that cannot be.
const EOL = String.fromCharCode(10);

//THE MACHINE THE PANE WAS BUILT AGAINST, spelt the way the register spells it.
const VM = (over) => Object.assign({
    name: 'beta-worker1',
    running: true,
    //NO `folder` OF ITS OWN, which is the ordinary case: `folderFor` falls
    //back to its default, and the default is a SHELL string.
    spec: { user: 'okc' }
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
    asked = { opened: [], ssh: [], ran: [], order: [] };
    said = [];
    homeSays = '/home/okc';
    guestExtension = 'installed';
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

    //THE MACHINE ANSWERING WHERE ITS HOME IS. `folderFor` gives a SHELL string,
    //and a URI does not expand shell variables — so this is asked before the
    //editor is opened. It answers the way the real `vmRun` does: the echoed
    //`$ what` line, then the output.
    //TWO THINGS ARE ASKED OF THE MACHINE IN THIS PRESS, and they are told apart
    //the way the guest would tell them apart — by what the command IS. A stub
    //answering both with one canned reply would let either half pass while the
    //other never ran.
    actions.define('vmRun', {
        about: 'vmRun',
        run: async (a) => {
            asked.ran.push(a.command);
            asked.order.push(/install-extension/.test(a.command) ? 'install' : 'ask-home');

            if (/install-extension/.test(a.command)) {
                if (guestExtension === 'throw') throw new Error('it is not dialled in');
                //THE SHAPE THE REAL SCRIPT ANSWERS IN — a line among whatever
                //else a guest shell decided to print. See
                //../../src/app/vms/editor/on-the-guest.js.
                return { code: 0, output: 'Welcome to Ubuntu' + EOL + 'okc-extension ' + guestExtension };
            }

            if (homeSays === null) throw new Error('the machine said nothing');
            return { code: 0, output: '$ ' + a.what + EOL + homeSays };
        }
    });

    await diyPlugin(Object.assign({
        app: { host: { actions } },
        log: { on: () => logger },

        //THE ENGINE, RECORDING RATHER THAN SPAWNING. It answers the shape the
        //real one answers with — see ../../src/app/vms/editor/open-editor.js —
        //so the note this action builds is built from real fields.
        editor: {
            open: async (it) => {
                asked.opened.push(it);
                //ONE LIST FOR BOTH, because the claim about the extension is
                //that it is installed AFTER the editor is launched — and two
                //separate lists cannot be compared for order.
                asked.order.push('editor.open');
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

        //THE REAL DEFAULT, WHICH IS `$HOME/workspace`. This said
        //`/home/okc/workspace` — an absolute path the real one never
        //answers unless a machine was given a folder of its own — so every
        //test here passed against a string the app does not actually get,
        //and VS Code was asked to open a folder called `$HOME`.
        repoWorkspaces: { folderFor: (spec) => (spec && spec.folder) || '$HOME/workspace' }
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

//---- A PATH A URI CAN CARRY, WHICH IS NOT A PATH A SHELL CAN ----------------
//
//`repoWorkspaces.folderFor` ANSWERS `$HOME/workspace` AND IS RIGHT TO. Every
//other caller of it puts that string into a shell command running ON the
//machine, where `$HOME` is the machine's own answer to a question this app
//cannot answer for it.
//
//THIS IS THE ONE CALLER THAT IS NOT A SHELL. It goes into
//`vscode-remote://ssh-remote+<alias><path>` and nothing expands a shell
//variable in a URI, so VS Code was handed
//`vscode-remote://ssh-remote+okc-ok-diy1/$HOME/workspace` and said "Unable to
//resolve nonexistent file".
//
//AND THE PRESS REPORTED SUCCESS. The editor started, which is all `open` ever
//claimed — so the log said "VS Code was asked to open it", three times over
//three days, while the window said the workspace does not exist.
//
//THIS FILE'S OWN STAND-IN WAS WHY NOTHING CAUGHT IT: `folderFor` here answered
//`/home/okc/workspace`, an absolute path the real one gives only for a machine
//that was configured with a folder of its own.

test('a shell variable never reaches the editor, because a URI cannot expand one', async () => {
    const actions = await anApp();

    await actions.call('openEditor', { name: 'beta-worker1', _fromTest: true });

    const dir = asked.opened[0].dir;
    assert.equal(dir, '/home/okc/workspace');
    assert.ok(dir.indexOf('$') < 0, 'a shell variable went into the URI: ' + dir);
    assert.ok(dir.indexOf('~') < 0, 'a tilde went into the URI: ' + dir);
});

test('and the machine is ASKED where home is, rather than it being assumed', async () => {
    //`/home/<user>` IS RIGHT FOR THESE MACHINES AND WRONG FOR root, and wrong
    //again for anything built differently. This is the app that must not guess
    //where somebody's work is.
    homeSays = '/var/lib/somewhere-else';
    const actions = await anApp();

    await actions.call('openEditor', { name: 'beta-worker1', _fromTest: true });
    assert.equal(asked.opened[0].dir, '/var/lib/somewhere-else/workspace');
});

test('and it is asked ONCE, however many times the editor is opened', async () => {
    //HOME DOES NOT MOVE WHILE A MACHINE IS UP, and the second press of the day
    //is meant to be the fast one — see "the second press does nothing but open
    //it" in ./open.test.js.
    const actions = await anApp();

    await actions.call('openEditor', { name: 'beta-worker1', _fromTest: true });
    await actions.call('openEditor', { name: 'beta-worker1', _fromTest: true });
    await actions.call('openEditor', { name: 'beta-worker1', _fromTest: true });

    //COUNTED BY WHICH QUESTION IT IS. Two things are asked of the machine in
    //this press now, and a bare count would move whenever the other one did.
    const homeAsks = asked.ran.filter((c) => /HOME/.test(c) && !/install-extension/.test(c));
    assert.equal(homeAsks.length, 1, 'it asked ' + homeAsks.length + ' times: ' + homeAsks.join(' | '));
});

test('a machine that will not say falls back, opens anyway, and SAYS it assumed', async () => {
    //A PRESS THAT REFUSES BECAUSE IT COULD NOT ASK is worse than one that opens
    //the folder that is almost certainly right. But an assumption nobody is told
    //about is how somebody spends an afternoon on the wrong checkout.
    homeSays = null;
    const actions = await anApp();

    await actions.call('openEditor', { name: 'beta-worker1', _fromTest: true });

    assert.equal(asked.opened[0].dir, '/home/okc/workspace');
    assert.ok(said.some((l) => /warn.*did not say where home is/.test(l)), said.join(' | '));
});

test('and a machine given a folder of its own is not asked at all', async () => {
    //AN ABSOLUTE PATH NEEDS NOTHING EXPANDING, so the round trip is skipped —
    //`spec.folder` is the override that exists for exactly this.
    machines['beta-worker1'] = VM({ spec: { user: 'okc', folder: '/srv/work' } });
    const actions = await anApp();

    await actions.call('openEditor', { name: 'beta-worker1', _fromTest: true });

    assert.equal(asked.opened[0].dir, '/srv/work');
    assert.equal(asked.ran.filter((c) => /HOME/.test(c) && !/install-extension/.test(c)).length, 0,
        'it asked about home for an absolute path');
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


//---- AND CLAUDE INSIDE THE EDITOR -------------------------------------------
//
//AN EDITOR OPENED ON A MACHINE WITH NO CLAUDE IN IT is most of a press. The
//extension runs in the REMOTE extension host, so the one installed on the
//operator's desktop is not the one that window uses — and the window says so:
//"This extension is disabled in this workspace because it is defined to run in
//the Remote Extension Host."
//
//IT MATTERS MOST AFTER A CLEAR. Rolling a machine back to base takes the VS
//Code server and every extension on it away with the disk — so an install done
//by hand lasts exactly until the first time somebody uses the other button.

const anEditor = (actions) => actions.call('openEditor', { name: 'beta-worker1', _fromTest: true });

test('opening installs claude on the machine, AFTER the editor is launched', async () => {
    //AFTER, AND THAT IS THE WHOLE REASON IT IS ORDERED THIS WAY. There is no VS
    //Code server on a machine that was just rolled back — the editor puts one
    //there when it connects — so before the launch there is nothing to install
    //with. Doing it first would work on a machine that had been opened before
    //and on no other.
    const actions = await anApp();

    const out = await anEditor(actions);

    assert.ok(asked.order.indexOf('editor.open') >= 0, 'it never opened the editor');
    assert.ok(asked.order.indexOf('install') > asked.order.indexOf('editor.open'),
        'it tried to install before VS Code had put a server there: ' + asked.order.join(' -> '));
    assert.equal(out.claude, 'installed it on the machine');
});

test('and what it runs is the thing that installs claude, not something else', async () => {
    const actions = await anApp();

    await anEditor(actions);

    const ran = asked.ran.filter((c) => /install-extension/.test(c));
    assert.equal(ran.length, 1, asked.ran.join(' | '));
    assert.match(ran[0], /anthropic\.claude-code/);
});

test('an extension already on the machine is not fetched again', async () => {
    guestExtension = 'already-there';
    const actions = await anApp();

    const out = await anEditor(actions);

    assert.equal(out.claude, 'already there');
    //AND IT IS NOT SHOUTED ABOUT. The common case is silent; only a change or a
    //failure is worth a line.
    assert.ok(!said.some((l) => /claude in the editor/.test(l)), said.join(' | '));
});

test('and it NEVER fails the press, whatever the machine said', async () => {
    //THE EDITOR IS OPEN EITHER WAY. Refusing to report a press that worked
    //because a convenience did not is how somebody stops believing what this
    //answers — and this press starts a virtual machine, so being believed is
    //most of what it is for.
    for (const answer of ['no-server', 'failed', 'nonsense', 'throw']) {
        //RESET PER CASE. `beforeEach` runs once for the whole test, so without
        //this the counts below are of every case so far rather than of this one.
        asked = { opened: [], ssh: [], ran: [], order: [] };
        said = [];
        guestExtension = answer;
        const actions = await anApp();

        const out = await anEditor(actions);

        assert.equal(out.opened, '/home/okc/workspace', answer);
        assert.equal(out.claude, false, answer);
        assert.match(out.note, /Claude may not be in it/, answer);
        assert.equal(asked.opened.length, 1, answer);
    }
});

test('and each of those is said out loud, rather than swallowed', async () => {
    //AN EDITOR THAT QUIETLY HAS NO CLAUDE IN IT is the failure this whole step
    //exists for, so the one thing it must not do is happen silently.
    for (const answer of ['no-server', 'failed', 'throw']) {
        asked = { opened: [], ssh: [], ran: [], order: [] };
        said = [];
        guestExtension = answer;
        const actions = await anApp();
        await anEditor(actions);

        assert.ok(said.some((l) => /warn: claude may not be in the editor/.test(l)),
            answer + ': ' + said.join(' | '));
    }
});

test('a machine with no server yet is told what to do about it', async () => {
    //"IT DID NOT WORK" IS NOT ACTIONABLE. This one fixes itself by pressing the
    //same button again once the window is up, and that is worth saying rather
    //than leaving somebody to guess whether the machine is broken.
    guestExtension = 'no-server';
    const actions = await anApp();

    await anEditor(actions);

    assert.ok(said.some((l) => /opening it again once the window is up/i.test(l)), said.join(' | '));

    //AND THAT IT MAY NEVER COME AT ALL. Open the editor, sleep the machine,
    //clear it back to base, open again — every step a button here — and no
    //server arrived at all; closing the leftover window and pressing again
    //worked at once. From the guest that is indistinguishable from a slow
    //download, so the sentence has to carry the thing to check.
    //
    //WHAT IS ASSERTED IS THE ADVICE, NOT A MECHANISM. Why the connection does
    //not happen is not established — `--new-window` is already passed, so the
    //obvious explanation is ruled out — and a test that pinned a cause would be
    //pinning a guess.
    assert.ok(said.some((l) => /slept or cleared/i.test(l)),
        'it does not mention the window left over from before the machine was cleared, which is the '
            + 'case that never resolves itself: ' + said.join(' | '));
});
