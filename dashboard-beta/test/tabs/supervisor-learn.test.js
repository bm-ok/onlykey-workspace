const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const statePlugin = require('../../src/app/core/state/main');
const actionsPlugin = require('../../src/app/core/actions/main');
const supervisorPlugin = require('../../src/app/supervisor/server');

//---------------------------------------------------------------------------
//THE ONE PRESS THAT TEACHES A SUPERVISOR WHAT A PROJECT IS.
//
//A supervisor cannot read code — that is the design, not a gap — so on a project
//nobody has bootstrapped it has been told nothing and manages the work anyway.
//`supervisorLearn` sends it a brief and wakes it; it commissions the survey,
//reads what comes back and writes its own memory.
//
//WHAT IS WORTH TESTING HERE IS NOT THE PROSE. It is the two things that decide
//whether the press works at all:
//
//  * it REFUSES when the supervisor cannot run, in that machine's own words
//  * it turns SELF-WAKING on, because without it the bootstrap asks for a
//    judgement, stops, and never reads the answer — with no error anywhere,
//    which looks exactly like a button that did nothing
//
//THE SECOND IS THE ONE THAT COULD ROT QUIETLY. A refusal that stops refusing is
//loud; a setting that stops being turned on is a bootstrap that half-runs.
//---------------------------------------------------------------------------

const somewhere = () => fs.mkdtempSync(path.join(os.tmpdir(), 'okc-learn-'));

//THE SUPERVISOR STATE IS THE STAND-IN, and it is the only one. Everything else
//is the real plugin: the settings it writes, the chat it says into, and the
//action table it calls through — because what is under test is what it does with
//those, not whether a fake agrees with it.
async function anApp(over) {
    const o = over || {};
    let actions = null;
    await actionsPlugin({}, async (_e, s) => { actions = s.actions; });

    const dir = somewhere();
    const said = [];
    const logger = { good: (t) => said.push(t), warn: (t) => said.push(t), info: (t) => said.push(t), bad: () => {} };
    logger.on = () => logger;

    let state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dir, ...p) } }, async (_e, s) => { state = s.state; });
    const here = path.join(dir, 'a-workspace');
    state.follow(async () => here);
    state.at(here);

    //THE SETTINGS THIS WRITES, kept as a plain object so the test can read what
    //was written rather than trusting the answer's own account of it.
    const settings = { supervisorWakes: o.wakes === true };
    const woke = [];

    await supervisorPlugin(
        {
            app: { host: { actions } }, log: { on: () => logger }, state,
            ours: { canBe: function () { return false; } },
            guestApi: { api: function () { return function () {}; } },
            settings: {
                read: async () => Object.assign({}, settings),
                write: async (patch) => { Object.assign(settings, patch); return settings; }
            }
        },
        async () => {}
    );

    //THE TWO ACTIONS IT LEANS ON, defined over the top so this file does not
    //need a machine. `supervisorState` is what it refuses by; `supervisorWake`
    //is a real turn of a real model and is the one thing that must not run here.
    actions.define('supervisorState', {
        about: 'stand-in',
        run: async () => (o.state || { there: true, ready: true, name: 'ok-super1', why: null, note: 'ready' })
    });
    actions.define('supervisorWake', {
        about: 'stand-in',
        run: async (a) => { woke.push((a || {}).why || ''); return { woke: true }; }
    });

    return { actions, settings, woke, said, dir };
}

test('it refuses when the supervisor cannot run, and says why in that machine’s words', async () => {
    const app = await anApp({
        state: {
            there: true, ready: false, name: 'ok-super1',
            why: 'it is switched off, and it is holding no credential, so a worker on it cannot authenticate',
            note: 'ok-super1 cannot run.'
        }
    });

    await assert.rejects(() => app.actions.call('supervisorLearn', {}),
        /switched off, and it is holding no credential/);

    //AND NOTHING WAS DONE ON THE WAY TO REFUSING. A press that turned self-waking
    //on and then failed would leave this host doing something new for a bootstrap
    //that never started.
    assert.equal(app.settings.supervisorWakes, false, 'it armed self-waking and then refused');
    assert.equal(app.woke.length, 0, 'it woke a supervisor it had just said could not run');
});

test('with no supervisor machine at all it says so rather than talking about credentials', async () => {
    const app = await anApp({
        state: { there: false, note: 'This host has no supervisor machine. Make one on the Runners tab.' }
    });

    await assert.rejects(() => app.actions.call('supervisorLearn', {}), /no supervisor machine/);
    assert.equal(app.woke.length, 0);
});

//THE ONE THAT WOULD ROT QUIETLY.
test('it turns self-waking on, because the bootstrap stalls silently without it', async () => {
    const app = await anApp({ wakes: false });

    const r = await app.actions.call('supervisorLearn', {});

    assert.equal(app.settings.supervisorWakes, true,
        'self-waking was left off — the survey is commissioned and nothing ever reads the answer');

    //AND IT SAYS IT DID. Turning this on changes what the host does unasked, and
    //a press that did it silently is one somebody would not have made knowingly.
    assert.equal(r.turnedOnWaking, true);
    assert.match(r.note, /self-waking was off and is now on/i);
});

test('and does not claim to have turned it on when it was already on', async () => {
    const app = await anApp({ wakes: true });

    const r = await app.actions.call('supervisorLearn', {});

    assert.equal(app.settings.supervisorWakes, true);
    assert.equal(r.turnedOnWaking, false, 'it said it changed a setting it did not change');
    assert.ok(!/is now on/i.test(r.note), 'the note claims a change that did not happen: ' + r.note);
});

test('it briefs the supervisor once, and the brief names the survey and the memory', async () => {
    const app = await anApp();

    await app.actions.call('supervisorLearn', {});

    const chat = await app.actions.call('chat', {});
    const mine = (chat.said || chat.messages || chat.lines || []).filter((m) => (m.text || '').includes('Learn what this project is'));
    assert.equal(mine.length, 1, 'the brief was written ' + mine.length + ' times');

    const text = mine[0].text;
    //THE THREE THINGS THE BRIEF EXISTS TO SAY. Not the wording — the verbs, so a
    //rewrite that drops one is caught.
    assert.match(text, /investigate-the-codebase/, 'the brief does not name the job that surveys a codebase');
    assert.match(text, /memorySet/, 'the brief does not tell it to write what it learns down');
    assert.match(text, /judgementFindings/, 'the brief does not tell it how to read what came back');

    //AND IT IS ASKED NOT TO QUEUE WORK OFF THE BACK OF IT, which is the one
    //instruction that stops a bootstrap becoming a machine spending twenty
    //minutes on something nobody decided.
    assert.match(text, /Do not queue any work/i);
});

//ONE PRESS IS ONE WAKING, AND THIS FOUND IT WAS TWO.
//
//`supervisorLearn` said the brief AND called `supervisorWake`. But `chatSay`
//wakes it ITSELF, always — that gate was removed deliberately, because
//"somebody typing a sentence and pressing send has already asked". So the press
//started two turns racing each other, the second folded into the first by
//`alsoWake` if the timing went one way and starting a second turn if it went the
//other.
//
//NEITHER OUTCOME FAILS. One is waste and the other is the thing the
//one-supervisor rule exists to prevent, and both look fine from outside — which
//is why this is a test rather than something anybody would have noticed.
test('one press is one waking, not two', async () => {
    const app = await anApp();
    await app.actions.call('supervisorLearn', {});

    assert.equal(app.woke.length, 1,
        'one press woke it ' + app.woke.length + ' times: ' + JSON.stringify(app.woke));

    //AND IT IS `chatSay`'s WAKING, which is the right one: the message is the
    //asking, and the brief is sitting in the conversation saying what for.
    assert.match(app.woke[0], /you said something/i);
});
