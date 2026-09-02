const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const statePlugin = require('../../src/app/core/state/main');
const actionsPlugin = require('../../src/app/core/actions/main');
const settingsPlugin = require('../../src/app/settings/server');

//---- TWO WORKSPACES, AND THEY HAVE TO BE REAL FOLDERS ----------------------
//
//These were two fixed made-up paths, which was fine while a workspace drawer
//lived under the app data directory: the path was only ever a KEY, hashed into a
//slug, and a fresh dataDir per fixture meant a fresh drawer.
//
//A WORKSPACE KEEPS ITS STATE INSIDE ITSELF NOW, so the path is a place. Made-up
//ones made every test in this file share one directory on the machine running
//the suite, and CREATE it, so nothing was isolated.
const ALPHA = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-ws-alpha-'));
const BETA = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-ws-beta-'));

//AND A CLEAN DRAWER PER TEST, WHICH USED TO COME FOR FREE.
function fresh() {
    [ALPHA, BETA].forEach(function (w) {
        try { fs.rmSync(path.join(w, '.okc'), { recursive: true, force: true }); }
        catch (e) { /* nothing kept there yet */ }
    });
}


//---------------------------------------------------------------------------
//what this app is set to.
//
//THE WORKSPACE IS A VARIABLE HERE, AND THAT IS THE POINT. The one claim this
//file makes that the code cannot make on its own is "switching workspace
//switches the drills off" — which is true by CONSTRUCTION rather than by a hook,
//so the way to test it is to move the folder underneath a live plugin and ask
//again. A fixed workspace would let every one of these pass with `testsFor`
//ignored entirely.
//
//THE REAL ../core/state AND THE REAL ../core/actions, not stand-ins. The store
//is what decides what keeping something means and `whoAsked` lives on the table;
//a fake of either would be testing the fake.
//---------------------------------------------------------------------------

const somewhere = () => fs.mkdtempSync(path.join(os.tmpdir(), 'okc-settings-'));

async function anApp() {
    fresh();
    let actions = null;
    await actionsPlugin({}, async (_e, s) => { actions = s.actions; });

    const dir = somewhere();
    let state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dir, ...p) } }, async (_e, s) => { state = s.state; });

    //MOVED BY THE TEST, read by the plugin on every call.
    let open = ALPHA;
    const said = [];
    const logger = { warn: (t) => said.push(t), info: (t) => said.push(t), good: () => {}, bad: () => {} };

    let settings = null;
    await settingsPlugin({
        app: { host: { actions } },
        log: { on: () => logger },
        state,
        workspace: { dir: async () => open }
    }, async (_e, s) => { settings = s.settings; });

    return {
        actions, settings, dir, said,
        go: (to) => { open = to; },
        where: () => open
    };
}

//---- the document itself ---------------------------------------------------

test('nothing kept reads as every default, and the drills are off', async () => {
    const { settings } = await anApp();
    assert.equal((await settings.read()).testsEnabled, false);
    assert.equal((await settings.read()).watchGitHub, false);
    assert.equal((await settings.read()).supervisorKey, null);
});

test('a key that is not declared cannot be kept', async () => {
    const { settings } = await anApp();
    assert.rejects(() => settings.write({ nonsense: true }), /is not a setting/);
});

//A SETTING THAT HAS SINCE BEEN REMOVED IS NOT CARRIED FORWARD as though it still
//meant something — the file is merged ONTO the declared list, not beside it.
test('a leftover key on disk is not read back', async () => {
    const { settings, dir } = await anApp();
    await settings.write({ watchGitHub: true });

    const file = path.join(dir, 'state', 'settings.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.somethingRemovedLastYear = 'still here';
    fs.writeFileSync(file, JSON.stringify(raw));

    assert.equal((await settings.read()).watchGitHub, true, 'the real setting did not survive');
    assert.ok(!('somethingRemovedLastYear' in (await settings.read())), 'a removed setting was carried forward');
});

//---------------------------------------------------------------------------
//A COMMAND LINE HAS NO TYPES, and this is the failure that has a blast radius.
//
//`--value false` hands over the STRING "false", which is truthy. Kept as it
//arrives — which is what the app being ported from does — the one command
//anybody would type to turn OFF a standing network call against somebody else's
//service turns it ON, silently, answering "Saved."
//
//BOTH DIRECTIONS ARE ASSERTED. A coercion that always returned false would pass
//the half of this that matters and be worthless.
//---------------------------------------------------------------------------
test('a value is put into the shape its default declares', async () => {
    const { actions, settings } = await anApp();

    for (const off of ['false', 'off', 'no', false]) {
        await actions.call('settingSet', { name: 'watchGitHub', value: off, _overTheWire: true });
        assert.equal((await settings.read()).watchGitHub, false, JSON.stringify(off) + ' did not read as off');
    }
    for (const on of ['true', 'on', '1', 1, true]) {
        await actions.call('settingSet', { name: 'watchGitHub', value: on, _overTheWire: true });
        assert.equal((await settings.read()).watchGitHub, true, JSON.stringify(on) + ' did not read as on');
    }

    //a name is a name, and an empty one is nothing rather than ""
    await actions.call('settingSet', { name: 'supervisorKey', value: '  bench  ', _overTheWire: true });
    assert.equal((await settings.read()).supervisorKey, 'bench');
    await actions.call('settingSet', { name: 'supervisorKey', value: '', _overTheWire: true });
    assert.equal((await settings.read()).supervisorKey, null, 'an empty name was kept as a name');
});

//---- the predicate ---------------------------------------------------------

test('both halves are required, and the third state is the interesting one', async () => {
    const { settings, go } = await anApp();

    assert.equal((await settings.allowed()).allowed, false, 'off is not allowed');

    await settings.write({ testsEnabled: true, testsFor: ALPHA });
    assert.equal((await settings.allowed()).allowed, true);

    //ON, FOR SOMEWHERE THAT IS NOT HERE. This is the state the whole design
    //exists to make visible, and every shorter phrasing of it reads as ON.
    go(BETA);
    const elsewhere = await settings.allowed();
    assert.equal(elsewhere.allowed, false, 'enabled for another folder read as enabled here');
    assert.match(elsewhere.why, /alpha/, 'the refusal did not say which folder it was on for');
    assert.match(elsewhere.why, /beta/, 'the refusal did not say which folder is open now');

    //and back again — nothing was cleared, it was compared
    go(ALPHA);
    assert.equal((await settings.allowed()).allowed, true, 'coming back did not restore it');
});

test('no workspace open is not allowed, whatever is set', async () => {
    const { settings, go } = await anApp();
    await settings.write({ testsEnabled: true, testsFor: ALPHA });
    go(null);
    assert.equal((await settings.allowed()).allowed, false);
});

//---------------------------------------------------------------------------
//THE REFUSALS.
//
//A model may ASK for the drills and may not decide that somebody's repository is
//a fine place to run them. Everything else in this file is bookkeeping.
//---------------------------------------------------------------------------

test('the drills cannot be switched on down the pipe', async () => {
    const { actions, settings } = await anApp();

    //WORD FOR WORD, because a drill reads this message. `settingSet testsEnabled`
    //is watched by src/app/tests/suites/02-the-refusals, which matches on this
    //phrase — so the wording is part of the interface and not decoration.
    await assert.rejects(
        () => actions.call('settingSet', { name: 'testsEnabled', value: true, _overTheWire: true }),
        /switched on in the window/);

    assert.equal((await settings.read()).testsEnabled, false, 'it went on anyway — the refusal came after the write');
});

test('a request to run them cannot be answered down the pipe', async () => {
    const { actions, settings } = await anApp();
    await actions.call('testsAsk', { why: 'to prove the port', _overTheWire: true });

    await assert.rejects(
        () => actions.call('testsAnswer', { allow: true, _overTheWire: true }),
        /answered in the window/);

    assert.equal((await settings.read()).testsEnabled, false);
    assert.ok((await settings.read()).testsAsked, 'the refused answer cleared the request as a side effect');
});

test('a person at the window may do both', async () => {
    const { actions, settings } = await anApp();

    const on = await actions.call('settingSet', { name: 'testsEnabled', value: true });
    assert.equal(on.settings.testsEnabled, true);
    assert.equal((await settings.allowed()).allowed, true);

    await actions.call('settingSet', { name: 'testsEnabled', value: false });
    assert.equal((await settings.read()).testsFor, null, 'turning them off left them pointed at a folder');
});

//---- asking ----------------------------------------------------------------

test('asking is the one thing the pipe may do, and it must say what for', async () => {
    const { actions, settings, where } = await anApp();

    await assert.rejects(
        () => actions.call('testsAsk', { _overTheWire: true }),
        /Say what they are wanted for/);

    const asked = await actions.call('testsAsk', { why: 'the branch drill', _overTheWire: true });
    assert.equal(asked.asked, true);
    assert.equal(asked.request.forDir, where());
    assert.equal((await settings.read()).testsEnabled, false, 'asking turned them on');
});

test('asking when they are already allowed changes nothing', async () => {
    const { actions } = await anApp();
    await actions.call('settingSet', { name: 'testsEnabled', value: true });

    const again = await actions.call('testsAsk', { why: 'again', _overTheWire: true });
    assert.equal(again.asked, false);
});

//---------------------------------------------------------------------------
//ASKED ABOUT ONE FOLDER, ANSWERED AFTER SWITCHING TO ANOTHER.
//
//The folder is checked at the moment of answering rather than taken from the
//request, so a yes cannot be moved onto work nobody was asked about. The request
//is CLEARED rather than honoured — answering the wrong question is worse than
//having to ask again.
//---------------------------------------------------------------------------
//A REQUEST IS RAISED ABOUT A FOLDER, AND IT STAYS THERE.
//
//It used to be one value for the whole app, and the answer compared the folder
//it named against the folder open now. Now it follows the folder — so from
//anywhere else there is no request at all, and the thing worth testing is that
//answering "yes" to a question nobody asked here does not arm anything. That
//check had to be written: every step after the comparison used to be reached
//only with a live request in hand, and without one they all still ran.
test('a yes does not follow you to a different workspace', async () => {
    const { actions, settings, go } = await anApp();
    await actions.call('testsAsk', { why: 'against the scaffolding', _overTheWire: true });

    go('C:\\somebody\\real-work');
    await assert.rejects(() => actions.call('testsAnswer', { allow: true }), /asked about this folder/);

    assert.equal((await settings.read()).testsEnabled, false, 'the drills were armed against the wrong folder');
    assert.equal((await settings.read()).testsAsked, null, 'a request raised elsewhere was visible here');

    //AND IT IS STILL THERE WHERE IT WAS ASKED, waiting for somebody standing in
    //front of the folder it is about. Refusing it and clearing it would be two
    //different things, and only one of them was wanted.
    go(ALPHA);
    assert.ok((await settings.read()).testsAsked, 'answering it from the wrong folder threw the request away');
});

test('answering yes here arms them here, in one act', async () => {
    const { actions, settings, where } = await anApp();
    await actions.call('testsAsk', { why: 'against the scaffolding', _overTheWire: true });

    const yes = await actions.call('testsAnswer', { allow: true });
    assert.equal(yes.allowed, true);
    assert.equal((await settings.read()).testsFor, where(), 'armed without recording what for');
    assert.equal((await settings.read()).testsAsked, null, 'the request outlived being answered');
    assert.equal((await settings.allowed()).allowed, true);
});

test('declining clears the request and changes nothing else', async () => {
    const { actions, settings } = await anApp();
    await actions.call('testsAsk', { why: 'no thanks', _overTheWire: true });

    const no = await actions.call('testsAnswer', { allow: false });
    assert.equal(no.allowed, false);
    assert.equal((await settings.read()).testsAsked, null);
    assert.equal((await settings.read()).testsEnabled, false);
});

//---- what the pane reads ---------------------------------------------------

//THE STANDING REQUEST COMES BACK WITH THE SETTINGS and is already filtered to
//the open folder, because a request about somewhere else is not a question
//anybody standing here can answer — and offering it invites exactly the answer
//the test above refuses.
test('the pane is not offered a request about another folder', async () => {
    const { actions, go } = await anApp();
    await actions.call('testsAsk', { why: 'about alpha', _overTheWire: true });

    assert.ok((await actions.call('settings')).askedToTest, 'the request was not offered where it was raised');

    go(BETA);
    assert.equal((await actions.call('settings')).askedToTest, null,
        'a request about another folder was put in front of somebody who cannot answer it');
});

test('the answer carries the derived state, not just the two fields', async () => {
    const { actions, go } = await anApp();
    await actions.call('settingSet', { name: 'testsEnabled', value: true });

    go(BETA);
    const said = await actions.call('settings');
    //`enabled` IS THIS FOLDER'S ANSWER. It was alpha's switch that was pressed,
    //and beta never had one pressed — which is the whole change.
    assert.equal(said.tests.enabled, false, 'a switch pressed in another folder read as pressed here');
    assert.equal(said.tests.allowed, false, 'the pane would have to recompute this and could disagree');
    assert.equal(said.tests.openDir, BETA);
    //AND WHERE IT IS ON, so a pane can say "not here, but there" rather than a
    //bare off that reads like a switch that did not work.
    assert.deepEqual(said.tests.elsewhere, [ALPHA]);
    assert.match(said.tests.why, /alpha/);
    assert.match(said.tests.why, /beta/);
});

//---------------------------------------------------------------------------
//THE OTHER HALF OF THE SAME GATE.
//
//`settingSet` guards `testsEnabled` and the app being ported from guards nothing
//else — but the predicate is `testsEnabled && testsFor === the folder open now`,
//and BOTH halves are writable settings. So a caller refused the switch can move
//the FOLDER instead: leave the switch alone, point `testsFor` at whatever is
//open, and `allowed()` turns true without the guarded key ever being touched.
//
//It needs the switch to be on already, which it often is — turned on last week
//against the scaffolding, still on, now pointed somewhere else. That is exactly
//the state `testsFor` exists to make safe, and it is the state this defeats.
//---------------------------------------------------------------------------
test('the pipe cannot arm the drills by moving the folder instead of the switch', async () => {
    const { actions, settings, go } = await anApp();

    await actions.call('settingSet', { name: 'testsEnabled', value: true });
    go('C:\somebody\real-work');
    assert.equal((await settings.allowed()).allowed, false, 'switching workspace did not switch them off');

    await assert.rejects(
        () => actions.call('settingSet', { name: 'testsFor', value: 'C:\\somebody\\real-work', _overTheWire: true }),
        /other half of that same permission/);

    //AND IT SAYS WHERE TO GO INSTEAD. A refusal with no door is one whoever hit
    //it works around, which is the whole reason `testsAsk` exists.
    await assert.rejects(
        () => actions.call('settingSet', { name: 'testsFor', value: 'C:\\x', _overTheWire: true }),
        /testsAsk/);

    assert.equal((await settings.allowed()).allowed, false,
        'the drills were armed against somebody else\'s folder without the guarded switch being touched');
});

//AND THE REQUEST IS NOT SETTABLE EITHER. Forging one is not itself dangerous —
//a raised hand changes nothing and answering is what is guarded — but a request
//written down the pipe is a sentence in a dialog that a person is about to read
//and trust, saying it came from somebody who asked. `testsAsk` writes it, with a
//reason and the folder checked; that is the only door.
test('the standing request is written by asking, not by setting', async () => {
    const { actions } = await anApp();
    await assert.rejects(
        () => actions.call('settingSet', { name: 'testsAsked', value: 'anything', _overTheWire: true }),
        /window|testsAsk/);
});

//---------------------------------------------------------------------------
//AND THE OTHER PERMISSION IN THAT FILE: whose words from GitHub may be read as
//a request. See ../../src/app/github/trust.js.
//
//IT IS NOT A PREFERENCE. Naming somebody opens a channel from the internet into
//what this host acts on, which is why it sits beside the drills rather than
//beside the theme.
//---------------------------------------------------------------------------

test('nothing from GitHub can be a request until somebody says who and what', async () => {
    const { settings } = await anApp();
    const now = (await settings.read());
    //THE STATE THIS SHIPS IN, asserted rather than assumed. A default this app
    //picked for the marker would be a word an attacker could read out of the
    //source.
    assert.deepEqual(now.githubTrusted, [], 'somebody was trusted before anybody said so');
    assert.equal(now.githubMarker, '', 'a marker was set out of the box');
});

test('the pipe cannot decide whose words count, in either half', async () => {
    const { actions, settings } = await anApp();

    await assert.rejects(
        () => actions.call('settingSet', { name: 'githubTrusted', value: ['an-account-i-control'], _overTheWire: true }),
        /opens a channel from the internet/);

    //THE HALF THAT LOOKS HARMLESS AND IS NOT. The marker is applied to text that
    //already exists: set it to a word a trusted person writes habitually and
    //their old comments become requests, with nobody having written anything new.
    await assert.rejects(
        () => actions.call('settingSet', { name: 'githubMarker', value: 'Update', _overTheWire: true }),
        /text that already exists/);

    //A DRILL IS NOT A PERSON EITHER, and neither is a driven press. Both reach
    //this door, and only `_overTheWire` was ever watched here once before.
    await assert.rejects(
        () => actions.call('settingSet', { name: 'githubMarker', value: 'okc', _fromTest: true }),
        /window/);
    await assert.rejects(
        () => actions.call('settingSet', { name: 'githubTrusted', value: ['x'], _driven: true }),
        /window/);

    const now = (await settings.read());
    assert.deepEqual(now.githubTrusted, [], 'the list moved anyway');
    assert.equal(now.githubMarker, '', 'the marker moved anyway');
});

test('a list setting is stored as a list, whatever it was typed as', async () => {
    const { actions, settings } = await anApp();

    //THE SAME DEFECT AS `watchGitHub false` WEARING DIFFERENT CLOTHES. A command
    //line has no types, and `--value bmatusiak` is the obvious thing to type —
    //stored as a string it is not an array, so trust.js reads it as nobody being
    //trusted while this reports "Saved."
    await actions.call('settingSet', { name: 'githubTrusted', value: 'someone, another ,' });
    assert.deepEqual((await settings.read()).githubTrusted, ['someone', 'another'],
        'a typed list was kept as whatever came in');

    //THE TRAILING COMMA IS THE POINT OF THE THIRD ENTRY ABOVE. An empty name in
    //the list is what `same()` in trust.js has to defend against; dropping it
    //here is the other half of that defence.

    //JSON TOO, because that is what a script hands over.
    await actions.call('settingSet', { name: 'githubTrusted', value: '["a-person","a-person"]' });
    assert.deepEqual((await settings.read()).githubTrusted, ['a-person'], 'the same name was kept twice');

    //AND A SHAPE SURVIVES BEING A SHAPE. The window looks the account up before
    //adding it, so it has the number — which is what makes the entry survive a
    //rename, and is worth nothing if this flattens it back to a string.
    await actions.call('settingSet', { name: 'githubTrusted', value: [{ login: 'bmatusiak', id: 1822932 }] });
    assert.deepEqual((await settings.read()).githubTrusted, [{ login: 'bmatusiak', id: 1822932 }],
        'the account number was dropped on the way in');
});


//---------------------------------------------------------------------------
//ONLY AGAINST A SANDBOX. Testing mode is per folder and remembers nothing
//about what the folder's remotes are; the sandbox list is what does.
//---------------------------------------------------------------------------

function withRepos(app, rows) {
    app.actions.define('repositories', { about: 'a stand-in', run: async () => ({ repos: rows }) });
}

test('with nothing on the sandbox list the switch alone decides', async () => {
    const app = await anApp();
    await app.settings.write({ testsEnabled: true, testsFor: ALPHA });
    withRepos(app, [{ repo: 'one', remote: { owner: 'real-project' }, parent: 'upstream/thing' }]);
    const said = await app.actions.call('settings', {});
    assert.equal(said.tests.allowed, true);
    assert.deepEqual(said.tests.sandbox.list, []);
});

test('a remote whose owner is not on the list refuses, and the refusal names it', async () => {
    const app = await anApp();
    await app.settings.write({ testsEnabled: true, testsFor: ALPHA, testsSandbox: ['bm-sandbox-a', 'bm-sandbox-b'] });
    withRepos(app, [
        { repo: 'one', remote: { owner: 'bm-sandbox-a' } },
        { repo: 'two', remote: { owner: 'real-project' } }
    ]);
    const said = await app.actions.call('settings', {});
    assert.equal(said.tests.allowed, false);
    assert.match(said.tests.why, /two's remote is real-project, which is not on the sandbox list \(bm-sandbox-a, bm-sandbox-b\)/);
});

test('an owner in the chain work goes through must be on the list too', async () => {
    const app = await anApp();
    await app.settings.write({ testsEnabled: true, testsFor: ALPHA, testsSandbox: ['bm-sandbox-a'] });
    withRepos(app, [{ repo: 'one', remote: { owner: 'bm-sandbox-a' }, parent: 'the-project/thing', target: { on: 'the-project/thing' } }]);
    const said = await app.actions.call('settings', {});
    assert.equal(said.tests.allowed, false);
    assert.match(said.tests.why, /one sends work through the-project/);

    //AND LEVEL WHEN THE CHAIN IS NAMED. Case does not matter: GitHub's does not.
    await app.settings.write({ testsSandbox: ['BM-Sandbox-A', 'The-Project'] });
    assert.equal((await app.actions.call('settings', {})).tests.allowed, true);
});

test('the sandbox list cannot be set down the pipe', async () => {
    const { actions, settings } = await anApp();
    await assert.rejects(
        () => actions.call('settingSet', { name: 'testsSandbox', value: ['anything'], _overTheWire: true }),
        /set in the window/);
    assert.deepEqual((await settings.read()).testsSandbox, []);
});

//---------------------------------------------------------------------------
//A NEW WORKSPACE IS INERT.
//
//Every switch that arms this app lived in one document, so a folder opened for
//the first time arrived already watching somebody's repositories, already
//allowed to wake a supervisor, already sending replies nobody had read, and
//already holding a list of people whose marked words are read as instructions.
//None of that was decided about the folder now open; all of it was decided
//about the last one.
//
//`FOLLOWS_THE_FOLDER` in the plugin is the list, and these are the claims that
//list is making.

test('a switch armed in one folder is off in the next, and comes back on returning', async () => {
    const { settings, go } = await anApp();

    await settings.write({
        watchGitHub: true, supervisorWakes: true,
        githubReplyDirect: true, githubMarker: 'okc', githubTrusted: ['bmatusiak']
    });
    const armed = await settings.read();
    assert.equal(armed.watchGitHub, true);
    assert.equal(armed.githubMarker, 'okc');

    go('C:\\somebody\\real-work');
    const fresh = await settings.read();
    assert.equal(fresh.watchGitHub, false, 'the new folder arrived watching GitHub');
    assert.equal(fresh.supervisorWakes, false, 'the new folder arrived able to wake a supervisor');
    assert.equal(fresh.githubReplyDirect, false, 'the new folder arrived sending replies nobody reads');
    assert.equal(fresh.githubMarker, '', 'a marker set for another project made its comments requests here');
    assert.deepEqual(fresh.githubTrusted, [], 'a trusted list decided elsewhere applied here');

    //NOTHING WAS CLEARED, IT WAS KEPT SOMEWHERE ELSE. Switching back is not
    //re-arming: the first folder's answers are still its own.
    go(ALPHA);
    const back = await settings.read();
    assert.equal(back.watchGitHub, true, 'coming back did not restore what was set here');
    assert.deepEqual(back.githubTrusted, ['bmatusiak']);
});

test('what is about this computer does not follow the folder', async () => {
    const { settings, go } = await anApp();
    await settings.write({ supervisorKey: 'bench' });

    go('C:\\somebody\\real-work');
    assert.equal((await settings.read()).supervisorKey, 'bench',
        'which sign-in this host uses is a fact about the keyring, not about the work');

    //AND THE SYNCHRONOUS DOOR ANSWERS THE SAME, which is what ../runners/guests
    //reads it through — it has nothing to wait for and should not have to.
    assert.equal(settings.host().supervisorKey, 'bench');
    assert.equal('watchGitHub' in settings.host(), false,
        'the host half offered a setting whose value belongs to no particular folder');
});

test('arming something with no workspace open is refused rather than applied to the next one', async () => {
    const { settings, go } = await anApp();
    go(null);

    await assert.rejects(() => settings.write({ watchGitHub: true }), /nothing to set that for/);
    //THE HOST'S OWN STILL WORK, because they are about this computer and there
    //is always one of those.
    await settings.write({ supervisorKey: 'bench' });
    assert.equal(settings.host().supervisorKey, 'bench');
});

//---- and what happens to a host that was already set up ---------------------
//
//THE FOLDER OPEN AT THE UPGRADE INHERITS IT, AND NOTHING ELSE EVER DOES.
//Somebody who has already set this app up should not come back to find it
//switched off; somebody opening a second folder should not find it switched on.

test('what was already set carries over to the folder open at the time, and no further', async () => {
    fresh();
    const dir = somewhere();
    const legacy = {
        watchGitHub: true, supervisorWakes: true, githubMarker: 'okc',
        githubTrusted: ['bmatusiak'], supervisorKey: 'bench'
    };

    //WRITTEN IN THE OLD SHAPE — flat, with no `forFolder` — which is what every
    //host that has ever run this app has on disk.
    let state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dir, ...p) } }, async (_e, s) => { state = s.state; });
    state.app.doc('settings').write(legacy);

    let open = ALPHA;
    let settings = null;
    let actions = null;
    await actionsPlugin({}, async (_e, s) => { actions = s.actions; });
    await settingsPlugin({
        app: { host: { actions } },
        log: { on: () => ({ warn: () => {}, info: () => {}, good: () => {}, bad: () => {} }) },
        state,
        workspace: { dir: async () => open }
    }, async (_e, s) => { settings = s.settings; });

    const here = await settings.read();
    assert.equal(here.watchGitHub, true, 'a host that was already watching came back switched off');
    assert.equal(here.githubMarker, 'okc');
    assert.deepEqual(here.githubTrusted, ['bmatusiak']);

    open = 'C:\\somebody\\real-work';
    const next = await settings.read();
    assert.equal(next.watchGitHub, false, 'the inheritance followed them into a folder it was never decided about');
    assert.equal(next.githubMarker, '');
    assert.equal(next.supervisorKey, 'bench', 'the host half was not inherited at all');

    //AND THE OLD FLAT KEYS ARE GONE FROM THE DOCUMENT, rather than sitting there
    //looking like they still mean something to whoever opens the file next.
    const raw = state.app.doc('settings').read({});
    assert.equal('watchGitHub' in raw, false, 'the value that no longer decides anything was left in place');
    assert.equal(raw.supervisorKey, 'bench');
    assert.ok(raw.forFolder[ALPHA]);
});

test('a host with nothing set up inherits nothing, and says so by being empty', async () => {
    const { settings, go } = await anApp();
    go('C:\\anywhere');
    const said = await settings.read();
    assert.equal(said.watchGitHub, false);
    assert.deepEqual(said.githubTrusted, []);
    assert.equal(said.testsEnabled, false);
});
