const { test } = require('node:test');
const assert = require('node:assert');

const actionsPlugin = require('../../src/app/core/actions/main');
const permissionsPlugin = require('../../src/app/permissions/server');

//---------------------------------------------------------------------------
//WHAT A RUN MAY DO, DECLARED BY WHOEVER REFUSES IT.
//
//The supervisor has had `allowed.js` all along and a pane drawing it. A worker
//and a judge have rules too — a judge may not push to the change it was asked
//to read — and they were real, enforced, and invisible: written into the doors
//that refuse them and nowhere anybody could read.
//
//THE DOOR ASKS THIS RATHER THAN DECIDING TWICE, which is the property worth
//testing: one rule, one place, the refusal and the pane reading the same
//string. A central list that the doors did NOT consult would be a copy, and a
//copy is right on the day it is written.
//---------------------------------------------------------------------------

async function aRegistry() {
    let actions = null;
    await actionsPlugin({}, async (_e, s) => { actions = s.actions; });

    const said = [];
    const logger = { info: (t) => said.push(t), good: () => {}, warn: () => {}, bad: () => {} };

    let permissions = null;
    await permissionsPlugin(
        { app: { host: { actions } }, log: { on: () => logger } },
        async (_e, s) => { permissions = s.permissions; }
    );
    return { permissions, actions };
}

const PUSH = {
    kind: 'judgement', door: 'push', may: false,
    why: 'a judging machine is set up ON the branch it is reading, so every other check would say yes'
};

test('a declared rule is what the door gets back, reason and all', async () => {
    const { permissions } = await aRegistry();
    permissions.rule(PUSH);

    const said = permissions.may('judgement', 'push');
    assert.equal(said.may, false);
    assert.equal(said.declared, true);
    //THE REASON TRAVELS WITH THE ANSWER. Every caller turns a refusal into a
    //sentence for somebody on a machine, and a caller writing its own is a
    //caller whose wording drifts from the pane's.
    assert.match(said.why, /set up ON the branch/);
});

test('a kind nobody declared for is refused, not waved through', async () => {
    //IT FAILS SHUT, which is the only safe direction for a question shaped
    //"may it" — the same direction the guards plugin failed in before it went.
    const { permissions } = await aRegistry();
    permissions.rule(PUSH);

    const said = permissions.may('task', 'push');
    assert.equal(said.may, false);
    assert.equal(said.declared, false, 'an undeclared door reported itself as a decision somebody made');
    assert.match(said.why, /nothing has said/);
});

test('an undeclared DOOR is refused too, and says which', async () => {
    const { permissions } = await aRegistry();
    permissions.rule(PUSH);

    const said = permissions.may('judgement', 'set the workspace on fire');
    assert.equal(said.may, false);
    assert.match(said.why, /set the workspace on fire/);
});

test('a rule has to say why, because a list of yes and no is what this replaces', async () => {
    const { permissions } = await aRegistry();
    assert.throws(() => permissions.rule({ kind: 'task', door: 'push', may: true }), /has to say WHY/);
    assert.throws(() => permissions.rule({ kind: 'task', door: 'push', may: true, why: '  ' }), /has to say WHY/);
});

test('a rule has to name a kind and a door', async () => {
    const { permissions } = await aRegistry();
    assert.throws(() => permissions.rule({ door: 'push', may: true, why: 'x' }), /which KIND/);
    assert.throws(() => permissions.rule({ kind: 'task', may: true, why: 'x' }), /name the door/);
});

test('two plugins cannot answer for one door', async () => {
    //Two answers for one question, and only one of them would be the one that
    //refuses — the same rule ../inbox holds its sources to.
    const { permissions } = await aRegistry();
    permissions.rule(PUSH);
    assert.throws(() => permissions.rule(Object.assign({}, PUSH, { may: true, why: 'no it may' })),
        /already declared/);

    //AND THE SAME DOOR FOR A DIFFERENT KIND IS A DIFFERENT RULE, which is the
    //whole shape of this: push is allowed for one and refused for the other.
    permissions.rule({ kind: 'task', door: 'push', may: true, why: 'delivering IS pushing' });
    assert.equal(permissions.may('task', 'push').may, true);
    assert.equal(permissions.may('judgement', 'push').may, false);
});

test('a rule can be taken away again, which is what a reload does', async () => {
    const { permissions } = await aRegistry();
    const undeclare = permissions.rule(PUSH);
    assert.equal(permissions.may('judgement', 'push').declared, true);

    undeclare();
    assert.equal(permissions.may('judgement', 'push').declared, false,
        'a reloaded plugin would declare its rule twice, or the old one would outlive it');
});

test('the action answers per kind, and names the kinds there are', async () => {
    const { permissions, actions } = await aRegistry();
    permissions.rule(PUSH);
    permissions.rule({ kind: 'task', door: 'push', may: true, why: 'delivering IS pushing' });
    permissions.rule({ kind: 'judgement', door: 'verdict', may: true, why: 'it is what a judgement is for' });

    const all = await actions.call('permissions', {});
    assert.deepEqual(all.kinds.slice().sort(), ['judgement', 'task']);
    assert.equal(all.rules.length, 3);

    const judge = await actions.call('permissions', { kind: 'judgement' });
    assert.deepEqual(judge.rules.map((r) => r.door).sort(), ['push', 'verdict']);
    assert.equal(judge.kind, 'judgement');

    //A KIND WITH NOTHING DECLARED SAYS SO rather than looking like a role with
    //no limits.
    const none = await actions.call('permissions', { kind: 'nobody' });
    assert.deepEqual(none.rules, []);
    assert.match(none.note, /Nothing has declared a rule for a nobody/);
});
