const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const statePlugin = require('../../src/app/core/state/main');
const actionsPlugin = require('../../src/app/core/actions/main');
const settingsPlugin = require('../../src/app/settings/server');

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
    let actions = null;
    await actionsPlugin({}, async (_e, s) => { actions = s.actions; });

    const dir = somewhere();
    let state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dir, ...p) } }, async (_e, s) => { state = s.state; });

    //MOVED BY THE TEST, read by the plugin on every call.
    let open = 'C:\\work\\alpha';
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
    assert.equal(settings.read().testsEnabled, false);
    assert.equal(settings.read().watchGitHub, false);
    assert.equal(settings.read().supervisorKey, null);
});

test('a key that is not declared cannot be kept', async () => {
    const { settings } = await anApp();
    assert.throws(() => settings.write({ nonsense: true }), /is not a setting/);
});

//A SETTING THAT HAS SINCE BEEN REMOVED IS NOT CARRIED FORWARD as though it still
//meant something — the file is merged ONTO the declared list, not beside it.
test('a leftover key on disk is not read back', async () => {
    const { settings, dir } = await anApp();
    settings.write({ watchGitHub: true });

    const file = path.join(dir, 'state', 'settings.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.somethingRemovedLastYear = 'still here';
    fs.writeFileSync(file, JSON.stringify(raw));

    assert.equal(settings.read().watchGitHub, true, 'the real setting did not survive');
    assert.ok(!('somethingRemovedLastYear' in settings.read()), 'a removed setting was carried forward');
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
        assert.equal(settings.read().watchGitHub, false, JSON.stringify(off) + ' did not read as off');
    }
    for (const on of ['true', 'on', '1', 1, true]) {
        await actions.call('settingSet', { name: 'watchGitHub', value: on, _overTheWire: true });
        assert.equal(settings.read().watchGitHub, true, JSON.stringify(on) + ' did not read as on');
    }

    //a name is a name, and an empty one is nothing rather than ""
    await actions.call('settingSet', { name: 'supervisorKey', value: '  bench  ', _overTheWire: true });
    assert.equal(settings.read().supervisorKey, 'bench');
    await actions.call('settingSet', { name: 'supervisorKey', value: '', _overTheWire: true });
    assert.equal(settings.read().supervisorKey, null, 'an empty name was kept as a name');
});

//---- the predicate ---------------------------------------------------------

test('both halves are required, and the third state is the interesting one', async () => {
    const { settings, go } = await anApp();

    assert.equal((await settings.allowed()).allowed, false, 'off is not allowed');

    settings.write({ testsEnabled: true, testsFor: 'C:\\work\\alpha' });
    assert.equal((await settings.allowed()).allowed, true);

    //ON, FOR SOMEWHERE THAT IS NOT HERE. This is the state the whole design
    //exists to make visible, and every shorter phrasing of it reads as ON.
    go('C:\\work\\beta');
    const elsewhere = await settings.allowed();
    assert.equal(elsewhere.allowed, false, 'enabled for another folder read as enabled here');
    assert.match(elsewhere.why, /alpha/, 'the refusal did not say which folder it was on for');
    assert.match(elsewhere.why, /beta/, 'the refusal did not say which folder is open now');

    //and back again — nothing was cleared, it was compared
    go('C:\\work\\alpha');
    assert.equal((await settings.allowed()).allowed, true, 'coming back did not restore it');
});

test('no workspace open is not allowed, whatever is set', async () => {
    const { settings, go } = await anApp();
    settings.write({ testsEnabled: true, testsFor: 'C:\\work\\alpha' });
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

    assert.equal(settings.read().testsEnabled, false, 'it went on anyway — the refusal came after the write');
});

test('a request to run them cannot be answered down the pipe', async () => {
    const { actions, settings } = await anApp();
    await actions.call('testsAsk', { why: 'to prove the port', _overTheWire: true });

    await assert.rejects(
        () => actions.call('testsAnswer', { allow: true, _overTheWire: true }),
        /answered in the window/);

    assert.equal(settings.read().testsEnabled, false);
    assert.ok(settings.read().testsAsked, 'the refused answer cleared the request as a side effect');
});

test('a person at the window may do both', async () => {
    const { actions, settings } = await anApp();

    const on = await actions.call('settingSet', { name: 'testsEnabled', value: true });
    assert.equal(on.settings.testsEnabled, true);
    assert.equal((await settings.allowed()).allowed, true);

    await actions.call('settingSet', { name: 'testsEnabled', value: false });
    assert.equal(settings.read().testsFor, null, 'turning them off left them pointed at a folder');
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
    assert.equal(settings.read().testsEnabled, false, 'asking turned them on');
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
test('a yes does not follow you to a different workspace', async () => {
    const { actions, settings, go } = await anApp();
    await actions.call('testsAsk', { why: 'against the scaffolding', _overTheWire: true });

    go('C:\\somebody\\real-work');
    await assert.rejects(() => actions.call('testsAnswer', { allow: true }), /asked about/);

    assert.equal(settings.read().testsEnabled, false, 'the drills were armed against the wrong folder');
    assert.equal(settings.read().testsAsked, null, 'the request stood, ready to be answered wrongly again');
});

test('answering yes here arms them here, in one act', async () => {
    const { actions, settings, where } = await anApp();
    await actions.call('testsAsk', { why: 'against the scaffolding', _overTheWire: true });

    const yes = await actions.call('testsAnswer', { allow: true });
    assert.equal(yes.allowed, true);
    assert.equal(settings.read().testsFor, where(), 'armed without recording what for');
    assert.equal(settings.read().testsAsked, null, 'the request outlived being answered');
    assert.equal((await settings.allowed()).allowed, true);
});

test('declining clears the request and changes nothing else', async () => {
    const { actions, settings } = await anApp();
    await actions.call('testsAsk', { why: 'no thanks', _overTheWire: true });

    const no = await actions.call('testsAnswer', { allow: false });
    assert.equal(no.allowed, false);
    assert.equal(settings.read().testsAsked, null);
    assert.equal(settings.read().testsEnabled, false);
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

    go('C:\\work\\beta');
    assert.equal((await actions.call('settings')).askedToTest, null,
        'a request about another folder was put in front of somebody who cannot answer it');
});

test('the answer carries the derived state, not just the two fields', async () => {
    const { actions, go } = await anApp();
    await actions.call('settingSet', { name: 'testsEnabled', value: true });

    go('C:\\work\\beta');
    const said = await actions.call('settings');
    assert.equal(said.tests.enabled, true, 'the raw field went missing');
    assert.equal(said.tests.allowed, false, 'the pane would have to recompute this and could disagree');
    assert.equal(said.tests.forDir, 'C:\\work\\alpha');
    assert.equal(said.tests.openDir, 'C:\\work\\beta');
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
