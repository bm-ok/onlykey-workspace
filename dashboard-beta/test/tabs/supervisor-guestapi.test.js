const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { Readable } = require('node:stream');

const makeGuestApi = require('../../src/app/supervisor/guestapi');

//---------------------------------------------------------------------------
//THE ONLY DOOR A SUPERVISOR HAS INTO THIS HOST.
//
//THE CLAIM WORTH THE MOST: a supervisor does not get to say where its call came
//from. Several actions behave differently depending on who asked — a job written
//AT THE WINDOW is approved by whoever wrote it, written OVER THE WIRE it waits,
//and approving is refused over the wire outright. So a body containing
//`_overTheWire: false` would be a machine writing a program and marking it read.
//
//TWO HALVES, AND THE SECOND IS THE ONE THAT GETS FORGOTTEN. Stamping the flag is
//easy; DROPPING every `_` key the machine sent, before stamping, is what makes
//the stamp worth anything.
//
//AND THE SECOND CLAIM: a runner is not a supervisor. The refusal is the same one
//vms/https gives a bad token, so a machine cannot work out what shape of machine
//drives this host by asking.
//---------------------------------------------------------------------------

let api, called, said, res, written;

const SUP = { name: 'supervisor-1', tags: ['supervisor'] };
const RUNNER = { name: 'kit-1', tags: ['worker'] };

function fakeRes() {
    written = { code: null, body: '' };
    return {
        writeHead: (c) => { written.code = c; return res; },
        end: (b) => { written.body = String(b || ''); }
    };
}

function post(body) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return Readable.from([Buffer.from(text)]);
}

const at = (over) => Object.assign({
    vm: SUP,
    url: new URL('https://h/supervisor/do?what=taskCreate'),
    req: post({}),
    res: res
}, over || {});

beforeEach(() => {
    called = [];
    said = [];
    res = fakeRes();

    api = makeGuestApi({
        ours: { canBe: (vm, role) => (vm.tags || []).includes(role) },
        call: async (what, args) => { called.push({ what, args }); return { ran: what }; },
        catalogue: async () => [{ name: 'taskCreate', takes: ['task'] }],
        say: () => {
            const to = {
                info: (m) => said.push(m), warn: (m) => said.push('WARN ' + m),
                good: (m) => said.push(m), bad: (m) => said.push('BAD ' + m), on: () => to
            };
            return to;
        }
    });
});

const run = (path, over) => api.routes.find((r) => r.path === path).run(at(over));

//---- who may reach it -----------------------------------------------------------

test('a supervisor may, and a runner may not', () => {
    assert.equal(api.may(SUP), true);
    assert.equal(api.may(RUNNER), false);
    assert.equal(api.may({ name: 'x', tags: [] }), false);
});

//---- what it does not get to say ------------------------------------------------

test('it cannot claim not to be over the wire', async () => {
    //A JOB WRITTEN AT THE WINDOW IS APPROVED BY WHOEVER WROTE IT. This is a
    //machine writing a program and marking it read.
    await run('/supervisor/do', { req: post({ task: 'do it', _overTheWire: false }) });

    assert.equal(called.length, 1);
    assert.equal(called[0].args._overTheWire, true, 'a supervisor talked its way into being the window');
});

test('it cannot claim to be another machine', async () => {
    await run('/supervisor/do', { req: post({ task: 'do it', _fromMachine: 'somebody-else' }) });

    //THE NAME COMES FROM THE TOKEN THAT AUTHENTICATED THE CALL. It is the one
    //question the record has to answer later.
    assert.equal(called[0].args._fromMachine, 'supervisor-1');
});

test('every underscore key it sent is dropped, not just the two we thought of', async () => {
    //THE HALF THAT GETS FORGOTTEN. Naming the two known flags would leave the
    //next one that matters to be discovered later.
    await run('/supervisor/do', {
        req: post({ task: 'do it', _driven: true, _approved: true, _anything: 'at all' })
    });

    const sent = Object.keys(called[0].args).filter((k) => k.charAt(0) === '_');
    assert.deepEqual(sent.sort(), ['_fromMachine', '_overTheWire']);
    assert.equal(called[0].args.task, 'do it', 'it dropped a real argument too');
});

//---- the fence -------------------------------------------------------------------

test('a verb off the list is refused, and never run', async () => {
    await run('/supervisor/do', { url: new URL('https://h/supervisor/do?what=vmRemove') });

    assert.deepEqual(called, [], 'it ran something a supervisor may not ask for');
    assert.equal(written.code, 403);
    //PARSED RATHER THAN PATTERN-MATCHED. The body is JSON, so the quotes in the
    //refusal are escaped on the wire — asserting against that would be a test
    //about the encoding rather than about what was said.
    assert.match(JSON.parse(written.body).error, /may not ask for "vmRemove"/);
});

test('and the refusal never names what else this host can do', async () => {
    await run('/supervisor/do', { url: new URL('https://h/supervisor/do?what=prCutLand') });

    for (const secret of ['vmCreate', 'claudeSignIn', 'taskRemove']) {
        assert.equal(written.body.includes(secret), false, 'the refusal named ' + secret);
    }
    //IT DOES SAY WHAT IT MAY DO INSTEAD, because the thing reading it is a model
    //that will otherwise retry with a different spelling.
    assert.match(written.body, /What it may ask for: /);
});

test('a verb with no name at all is refused like any other', async () => {
    await run('/supervisor/do', { url: new URL('https://h/supervisor/do') });
    assert.deepEqual(called, []);
    assert.equal(written.code, 403);
});

//---- the body ---------------------------------------------------------------------

test('no body at all is no arguments, not an error', async () => {
    await run('/supervisor/do', { req: post('') });
    assert.equal(called.length, 1);
    assert.deepEqual(Object.keys(called[0].args).sort(), ['_fromMachine', '_overTheWire']);
});

test('a body that is not JSON is said plainly and nothing runs', async () => {
    await run('/supervisor/do', { req: post('{not json') });
    assert.deepEqual(called, []);
    assert.equal(written.code, 400);
    assert.match(written.body, /not JSON/);
});

test('an array is not a set of arguments', async () => {
    //TAKEN HERE rather than left to the action, which would report something
    //confusing about a field being missing.
    await run('/supervisor/do', { req: post([1, 2, 3]) });
    assert.deepEqual(called, []);
    assert.equal(written.code, 400);
    assert.match(written.body, /object of arguments, or nothing at all/);
});

test('more than a megabyte is stopped at the door', async () => {
    //THE POINT OF A CAP IS NOT TO HAVE ACCEPTED THE THING IT REFUSES.
    let destroyed = false;
    const big = Readable.from([Buffer.alloc(makeGuestApi.MOST + 10, 0x61)]);
    big.destroy = () => { destroyed = true; };

    await run('/supervisor/do', { req: big });

    assert.deepEqual(called, []);
    assert.equal(written.code, 413);
    assert.equal(destroyed, true, 'it read the whole thing and then complained');
});

//---- what it may do -----------------------------------------------------------------

test('the list is the allowlist, with what each verb takes', async () => {
    const out = await run('/supervisor');

    assert.equal(out.vm, 'supervisor-1');
    assert.ok(out.may.length > 40);
    assert.ok(out.may.every((m) => m.what && m.why), 'a verb was listed without its reason');

    const one = out.may.find((m) => m.what === 'taskCreate');
    assert.deepEqual(one.takes, ['task'], 'it did not say what the verb takes');
});

test('it says this is a named list rather than a filter', async () => {
    const out = await run('/supervisor');
    //SO A MODEL DOES NOT GO LOOKING for what was filtered out.
    assert.match(out.note, /named list, not a filter/);
    assert.match(out.how, /POST \/supervisor\/do\?what=/);
});

test('a catalogue that could not be read still answers with the verbs', async () => {
    const broken = makeGuestApi({
        ours: { canBe: () => true },
        call: async () => ({}),
        catalogue: async () => { throw new Error('the pipe is down'); },
        say: () => { const to = { info() {}, warn: (m) => said.push('WARN ' + m), bad() {}, good() {}, on: () => to }; return to; }
    });

    const out = await broken.routes.find((r) => r.path === '/supervisor').run(at());

    //THE VERBS ARE STILL THE VERBS, and losing the argument names is worth less
    //than failing the call.
    assert.ok(out.may.length > 40);
    assert.deepEqual(out.may[0].takes, []);
    assert.ok(said.some((m) => /could not read what each verb takes/.test(m)), said.join(' | '));
});
