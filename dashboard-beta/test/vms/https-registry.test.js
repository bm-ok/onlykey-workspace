const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makeRegistry = require('../../src/app/vms/https/registry');

//---------------------------------------------------------------------------
//WHAT A MACHINE MAY REACH, AND WHO SAYS SO.
//
//THE CLAIM WORTH THE MOST: a plugin cannot register verbs without saying which
//machines may reach them. Defaulting that to "anyone" would be the worst
//available default — an omission would open real verbs to every machine on the
//host and would look exactly like a decision.
//
//AND THE SECOND: a machine is never told what it is not. A runner asking for a
//supervisor verb gets the same answer as a machine with a bad token, because
//anything more tells whatever reached this port what shape of machine gets in.
//---------------------------------------------------------------------------

let reg, said;

const RUNNER = { name: 'kit-1', tags: ['worker'] };
const SUP = { name: 'supervisor-1', tags: ['supervisor'] };

beforeEach(() => {
    said = [];
    reg = makeRegistry({
        say: () => {
            const to = {
                info: (m) => said.push(m), warn: (m) => said.push('WARN ' + m),
                good: (m) => said.push(m), bad: (m) => said.push('BAD ' + m), on: () => to
            };
            return to;
        }
    });
});

const anAPI = (over) => Object.assign({
    name: 'job',
    may: (vm) => (vm.tags || []).includes('worker'),
    routes: [{ method: 'POST', path: '/artifact', run: () => 'kept' }]
}, over || {});

//---- who may reach it ----------------------------------------------------------

test('an api cannot be registered without saying who may reach it', () => {
    //THE WORST AVAILABLE DEFAULT. A plugin that forgot would open its verbs to
    //every machine on the host, and the omission would look like a decision.
    assert.throws(() => reg.api(anAPI({ may: undefined })), /must say which machines may reach it/);
    assert.throws(() => reg.api(anAPI({ may: true })), /must say which machines may reach it/);
});

test('the machine it is for gets in, and one it is not for does not', () => {
    reg.api(anAPI());
    const hit = reg.match('POST', '/artifact');

    assert.equal(reg.allowed(hit, RUNNER), true);
    assert.equal(reg.allowed(hit, SUP), false);
});

test('two apis, each with its own rule, and neither reaches the other', () => {
    reg.api(anAPI());
    reg.api(anAPI({
        name: 'supervisor',
        may: (vm) => (vm.tags || []).includes('supervisor'),
        routes: [{ method: 'POST', path: '/supervisor/do', run: () => 'done' }]
    }));

    //A SUPERVISOR HOLDS NO REPOSITORIES AND A RUNNER DRIVES NOTHING. Each rule
    //is stated beside the verbs it is about.
    assert.equal(reg.allowed(reg.match('POST', '/supervisor/do'), SUP), true);
    assert.equal(reg.allowed(reg.match('POST', '/supervisor/do'), RUNNER), false);
    assert.equal(reg.allowed(reg.match('POST', '/artifact'), SUP), false);
});

test('a may that throws is a no, not an error a machine can read', () => {
    reg.api(anAPI({ may: () => { throw new Error('the register could not be read'); } }));

    //A RULE THAT COULD NOT BE EVALUATED HAS NOT BEEN SATISFIED — and it is about
    //real verbs on real machines.
    assert.equal(reg.allowed(reg.match('POST', '/artifact'), RUNNER), false);
    assert.ok(said.some((m) => /BAD.*may not/.test(m)), said.join(' | '));
});

test('a may that answers anything other than true is a no', () => {
    //`return vm.tags.length` WOULD BE TRUTHY AND IS NOT A DECISION.
    for (const sloppy of [1, 'yes', {}, [], 'true']) {
        const r = makeRegistry({});
        r.api(anAPI({ may: () => sloppy }));
        assert.equal(r.allowed(r.match('POST', '/artifact'), RUNNER), false,
            JSON.stringify(sloppy) + ' was taken as permission');
    }
});

//---- what answers ----------------------------------------------------------------

test('a path is matched whole, not by prefix', () => {
    reg.api(anAPI());
    assert.ok(reg.match('POST', '/artifact'));
    assert.equal(reg.match('POST', '/artifacts-elsewhere'), null);
    assert.equal(reg.match('POST', '/artifact/more'), null);
});

test('and one trailing star matches beneath it, which git needs', () => {
    reg.api(anAPI({ name: 'git', routes: [{ method: 'GET', path: '/git/*', run: () => 'ok' }] }));

    assert.ok(reg.match('GET', '/git/repo.git/info/refs'));
    assert.ok(reg.match('GET', '/git/'));
    assert.equal(reg.match('GET', '/gitsomething'), null);
});

test('the method is part of the match', () => {
    reg.api(anAPI());
    assert.equal(reg.match('GET', '/artifact'), null);
    assert.ok(reg.match('post', '/artifact'), 'the method should not be case-sensitive');
});

test('nothing registered answers nothing, rather than everything', () => {
    assert.equal(reg.match('GET', '/anything'), null);
    assert.equal(reg.allowed(null, RUNNER), false);
});

//---- registering ------------------------------------------------------------------

test('two plugins cannot claim one api name', () => {
    reg.api(anAPI());
    assert.throws(() => reg.api(anAPI()), /already registered/);
});

test('an api with no routes is refused, because nothing could reach it', () => {
    assert.throws(() => reg.api(anAPI({ routes: [] })), /registers no routes/);
});

test('a route with no path or nothing to run is refused', () => {
    assert.throws(() => reg.api(anAPI({ routes: [{ method: 'GET', run: () => 1 }] })), /no path/);
    assert.throws(() => reg.api(anAPI({ routes: [{ method: 'GET', path: '/x' }] })), /nothing to run/);
    assert.throws(() => reg.api(anAPI({ routes: [{ method: 'GET', path: 'x', run: () => 1 }] })), /no path/);
});

test('registering hands back a way to take it away again', () => {
    const undo = reg.api(anAPI());
    assert.ok(reg.match('POST', '/artifact'));

    //THE NODE BUNDLE IS REBUILT ON EVERY SAVE, and an api registered twice is
    //two handlers for one path.
    undo();
    assert.equal(reg.match('POST', '/artifact'), null);
    assert.doesNotThrow(() => reg.api(anAPI()), 'the name was not released');
});

test('two apis claiming one path is reported as a fault, not resolved quietly', () => {
    reg.api(anAPI());
    reg.api(anAPI({ name: 'other', routes: [{ method: 'POST', path: '/artifact', run: () => 'other' }] }));

    const hit = reg.match('POST', '/artifact');
    assert.equal(hit.api.name, 'job', 'the first registered should answer');
    assert.ok(said.some((m) => /WARN.*claimed by 2 apis/.test(m)), said.join(' | '));
    assert.ok(said.some((m) => /fault rather than a preference/.test(m)));
});

//---- and what is listed ------------------------------------------------------------

test('what is reachable can be listed, for a person', () => {
    reg.api(anAPI({ about: 'what a job is handed' }));

    assert.deepEqual(reg.list(), [{
        name: 'job', about: 'what a job is handed', routes: ['POST /artifact']
    }]);
});

test('the list carries no rule, because it is not for a machine', () => {
    reg.api(anAPI());
    //THE LIST OF WHAT EXISTS is exactly what a refusal declines to give.
    assert.equal(JSON.stringify(reg.list()).includes('may'), false);
});
