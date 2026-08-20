const { test } = require('node:test');
const assert = require('node:assert');

const plugin = require('../src/app/core/log/main');

//the live log, and the four claims its own comments make about it. it is the
//first of the dashboard's server logic to live in this app, and everything
//ported after it writes into it — so these are worth holding down here rather
//than re-deciding in each of them.

async function aLog() {
    let log = null;
    await plugin({}, async (_err, services) => { log = services.log; });
    return log;
}

//THE ONE THAT MATTERS. Not being written to disk was taken as enough over there,
//and it was not: the window draws these lines, windowShot photographs them and
//logSince hands them to whoever asks at the command line. A worker credential
//went through all three.
test('a credential is never a line here, whatever printed it', async () => {
    const log = await aLog();

    const key = 'sk-ant-' + 'api03-NOTAREALKEY_abcdef123456';
    log.on('guest').out('claude said: using ' + key + ' now');
    log.on('guest').out('{"accessToken":"ya29.a0AfB_verySecretValue","scope":"x"}');
    log.on('guest').out('{"refreshToken": "1//04refreshMe" }');

    const text = log.all().map((e) => e.text).join('\n');
    assert.ok(!text.includes(key), 'an sk-ant key reached the log');
    assert.ok(!text.includes('ya29.a0AfB_verySecretValue'), 'an access token reached the log');
    assert.ok(!text.includes('1//04refreshMe'), 'a refresh token reached the log');
    assert.ok(text.includes('<redacted>'), 'it scrubbed by dropping the line rather than the value');

    //AND IT IS NARROW ON PURPOSE. A guest's output is full of commit hashes and
    //base64; scrubbing anything long and random would make this log useless for
    //the thing it exists for.
    log.on('git').out('merged 9f4a1c2e8b7d6a5f4e3c2b1a0f9e8d7c6b5a4938');
    assert.ok(log.all().some((e) => e.text.includes('9f4a1c2e8b7d6a5f4e3c2b1a0f9e8d7c6b5a4938')),
        'a commit hash was mangled');
});

//A WATCHER THAT RECONNECTS INTO A NEW LOG asks for everything after an id that
//no longer exists. Answering "nothing" leaves it connected, healthy, and never
//printing another line — which looks exactly like a quiet system.
test('an id from a log that no longer exists reads as "start again"', async () => {
    const log = await aLog();
    log.on('a').info('one');
    log.on('a').info('two');

    assert.equal(log.since(1).length, 1, 'an ordinary id filters');
    assert.equal(log.since(0).length, 2, 'nothing read yet gets everything');
    assert.equal(log.since(412).length, 2, 'an id from a previous life gets everything, not nothing');
});

test('the newest lines survive and the oldest are dropped', async () => {
    const log = await aLog();
    for (let i = 1; i <= 2100; i++) log.on('bulk').info('line ' + i);

    const all = log.all();
    assert.equal(all.length, 2000, 'it is capped');
    assert.equal(all[all.length - 1].text, 'line 2100', 'the newest is kept');
    assert.ok(!all.some((e) => e.text === 'line 1'), 'the oldest went');

    //the census the window builds its filters from, rather than a hardcoded list
    assert.deepEqual(log.tags(), [{ tag: 'bulk', n: 2000 }]);
});

//ONE BAD WATCHER MUST NOT TAKE DOWN EVERY WRITE for the rest of the process.
test('a listener that throws is dropped, not fatal', async () => {
    const log = await aLog();
    const seen = [];

    log.subscribe(() => { throw new Error('this watcher is broken'); });
    log.subscribe((e) => seen.push(e.text));

    assert.doesNotThrow(() => log.on('x').info('first'));
    log.on('x').info('second');

    assert.deepEqual(seen, ['first', 'second'], 'the good watcher kept its place');
});

//THE ONE PLACE ANYTHING FROM HERE MAY REACH DISK, and there is one slot rather
//than a list — so a durable record stays a decision somebody makes once.
test('the durable record is a single replaceable slot, and its failure is not the line\'s', async () => {
    const log = await aLog();
    const kept = [];

    const stop = log.keeper((e) => kept.push(e.text));
    log.on('x').info('one');

    const undo = log.keeper(() => { throw new Error('the disk is full'); });
    assert.doesNotThrow(() => log.on('x').info('two'), 'a failed keep took the line with it');
    assert.equal(log.all().length, 2, 'the line is still live; only the note is lost');
    assert.deepEqual(kept, ['one'], 'the second keeper replaced the first rather than joining it');

    undo();
    log.on('x').info('three');
    assert.deepEqual(kept, ['one'], 'a removed keeper stays removed');
    assert.equal(typeof stop, 'function');
});
