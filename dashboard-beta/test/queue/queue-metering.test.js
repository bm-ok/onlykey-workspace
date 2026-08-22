const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makeMetering = require('../../src/app/queue/metering');
const { authTrouble, lastResult, troubleIn } = require('../../src/app/queue/metering');

//---------------------------------------------------------------------------
//WHAT A RUN COST, READ BEFORE THE MACHINE IS PUT AWAY.
//
//A run's transcript lives ON THE MACHINE, and the machine is restored to base
//the moment the work around it ends — so this is the only window in which the
//numbers exist at all.
//
//THE CLAIM WORTH THE MOST: "it went wrong" is not "it could not sign in". A run
//fails for every ordinary reason; only the ones that sound like authentication
//pause a sign-in, because pausing one wrongly stops every machine using it.
//
//AND THE SECOND: never fatal. A run that happened and was not metered is a gap
//in a total; a run that FAILED because the metering did is work lost for
//bookkeeping.
//---------------------------------------------------------------------------

const RESULT = (over) => JSON.stringify(Object.assign({
    type: 'result', subtype: 'success', is_error: false,
    num_turns: 12, duration_ms: 90000, total_cost_usd: 0.42
}, over || {}));

let said, to, paused, recorded, output, fails;

beforeEach(() => {
    said = [];
    paused = [];
    recorded = [];
    output = '';
    fails = null;
    to = {
        info: (m) => said.push(m), warn: (m) => said.push('WARN ' + m),
        bad: (m) => said.push('BAD ' + m), good: (m) => said.push(m)
    };
});

function metering(over) {
    return makeMetering(Object.assign({
        call: async () => { if (fails) throw new Error(fails); return { output }; },
        holderOf: () => 'a-worker',
        pause: (who, how) => paused.push({ who, how }),
        record: (row) => { recorded.push(row); return { key: row.key, cost: (row.result || {}).total_cost_usd }; }
    }, over || {}));
}

const meter = (over) => metering(over).meterRun(to, 'kit-1', 'run-1', { kind: 'task', about: 'do it', ref: 'task 7' });

//---- what a line says about authentication -----------------------------------------

test('a structured error that sounds like a sign-in is trouble', () => {
    const said401 = authTrouble(JSON.stringify({
        type: 'result', is_error: true, result: 'API Error: 401 unauthorized'
    }));
    assert.match(said401, /401 unauthorized/);
});

test('and every shape the CLI has used to say it went wrong', () => {
    //IT HAS SAID IT SEVERAL WAYS ACROSS VERSIONS, and a run that failed to
    //authenticate while this recognised only last month's shape is a machine
    //spent for nothing.
    const shapes = [
        { is_error: true, result: 'failed to authenticate' },
        { is_api_error_message: true, result: 'invalid_grant' },
        { error: 'oauth token expired' },
        { error: { message: 'credit balance too low' } },
        { subtype: 'error_during_execution', result: 'unauthorized' },
        { is_error: true, message: { content: [{ text: 'your api key is invalid' }] } }
    ];
    for (const s of shapes) {
        assert.ok(authTrouble(JSON.stringify(s)), 'missed: ' + JSON.stringify(s));
    }
});

test('an error that is not about signing in is not trouble', () => {
    //A RUN FAILS FOR EVERY ORDINARY REASON. Pausing a sign-in wrongly stops
    //every machine using it.
    assert.equal(authTrouble(JSON.stringify({ is_error: true, result: 'the tests did not pass' })), null);
    assert.equal(authTrouble(JSON.stringify({ is_error: true, result: 'no such file or directory' })), null);
});

test('and a run that succeeded is never trouble, whatever it talked about', () => {
    //A WORKER DISCUSSING AN API KEY is a thing workers do.
    assert.equal(authTrouble(JSON.stringify({
        type: 'result', is_error: false, result: 'I rotated the api key as asked'
    })), null);
});

test('plain text must announce itself as an error AND sound like a sign-in', () => {
    //MATCHING THE PHRASES ALONE ON PLAIN TEXT would catch a worker talking about
    //credentials.
    assert.ok(authTrouble('Error: failed to authenticate with the api key'));
    assert.equal(authTrouble('I will now check the api key'), null,
        'a worker mentioning an api key paused a sign-in');
    assert.equal(authTrouble('Error: the build broke'), null);
});

test('a line that is not json and not an error is nothing', () => {
    assert.equal(authTrouble('{not json'), null);
    assert.equal(authTrouble('just some output'), null);
});

test('at most three complaints, and not more than 600 characters', () => {
    //THIS ENDS UP IN A LOG LINE A PERSON READS; the whole of a model's complaint
    //is not that.
    const line = JSON.stringify({ is_error: true, result: 'oauth ' + 'x'.repeat(400) });
    const got = troubleIn([line, line, line, line, line].join('\n'));

    assert.ok(got.length <= 600, 'it was ' + got.length + ' characters');
});

//---- the last thing it said about the whole run --------------------------------------

test('the LAST result line is the one about the whole run', () => {
    const text = [RESULT({ total_cost_usd: 0.1 }), 'some noise', RESULT({ total_cost_usd: 0.9 })].join('\n');
    assert.equal(lastResult(text).total_cost_usd, 0.9);
});

test('a line the tail cut in half is skipped, not guessed at', () => {
    //PARSED AS WHOLE JSON rather than by regex over the file: half-reading
    //somebody else's format is how a number silently becomes the wrong number.
    const text = ['{"type":"result","total_cost', RESULT({ total_cost_usd: 0.5 })].join('\n');
    assert.equal(lastResult(text).total_cost_usd, 0.5);
});

test('no result line at all is null, not a zero', () => {
    assert.equal(lastResult('nothing here\nnor here'), null);
    assert.equal(lastResult(''), null);
    assert.equal(lastResult(null), null);
});

test('a json line that is not a result is not one', () => {
    assert.equal(lastResult(JSON.stringify({ type: 'assistant', result: 'said something' })), null);
});

//---- metering a run ---------------------------------------------------------------------

test('what it cost is recorded against the sign-in that ran it', () => {
    output = RESULT();
    return meter().then((out) => {
        assert.equal(recorded.length, 1);
        assert.equal(recorded[0].key, 'a-worker', 'it was billed to nobody');
        assert.equal(recorded[0].machine, 'kit-1');
        assert.equal(recorded[0].ref, 'task 7');
        assert.equal(out.row.cost, 0.42);
        assert.ok(said.some((m) => /task 7 cost 0\.4200 USD on a-worker/.test(m)), said.join(' | '));
    });
});

test('a sign-in that could not authenticate is paused, and named back', async () => {
    output = [JSON.stringify({ is_error: true, result: 'oauth token has expired' }), RESULT()].join('\n');

    const out = await meter();

    assert.equal(out.failedAuthAs, 'a-worker');
    assert.equal(paused.length, 1);
    assert.equal(paused[0].how.ready, false);
    assert.match(paused[0].how.why, /oauth token has expired/);
    assert.ok(said.some((m) => /BAD.*that sign-in is paused/.test(m)), said.join(' | '));
});

test('and the caller is told, because it changes what happens to the WORK', async () => {
    //A RUN THAT COULD NOT AUTHENTICATE DID NOT FAIL — it never started, and the
    //difference decides whether the task is finished or waiting.
    output = JSON.stringify({ is_error: true, result: 'invalid_grant' });
    assert.equal((await meter()).failedAuthAs, 'a-worker');

    paused.length = 0;
    output = RESULT();
    assert.equal((await meter()).failedAuthAs, null);
});

test('trouble on a machine holding no sign-in pauses nothing', async () => {
    output = JSON.stringify({ is_error: true, result: 'unauthorized' });
    const out = await metering({ holderOf: () => null }).meterRun(to, 'kit-1', 'run-1', {});

    assert.deepEqual(paused, []);
    assert.equal(out.failedAuthAs, null);
});

//---- and never fatal ----------------------------------------------------------------------

test('output that cannot be read is said, and returns rather than throwing', async () => {
    fails = 'the channel is down';
    const out = await meter();

    assert.deepEqual(out, { row: null, failedAuthAs: null });
    assert.ok(said.some((m) => /WARN could not read what run-1 cost: the channel is down/.test(m)), said.join(' | '));
});

test('a pause that throws does not stop the run being metered', async () => {
    //THE METER'S OWN JOB MATTERS MORE THAN THIS NOTE: a run metered whose
    //credential trouble went unreported beats neither.
    output = [JSON.stringify({ is_error: true, result: 'oauth expired' }), RESULT()].join('\n');

    const out = await metering({ pause: () => { throw new Error('the guests store is gone'); } }).meterRun(
        to, 'kit-1', 'run-1', { ref: 'task 7' });

    assert.equal(recorded.length, 1, 'the run went unmetered because the note failed');
    assert.equal(out.row.cost, 0.42);
});

test('nothing to meter is not an error', async () => {
    output = 'the run printed nothing json-shaped';
    const out = await meter();
    assert.deepEqual(out, { row: null, failedAuthAs: null });
    assert.deepEqual(recorded, []);
});
