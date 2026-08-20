const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const logPlugin = require('../src/app/core/log/main');
const actionsPlugin = require('../src/app/core/actions/main');
const eventsPlugin = require('../src/app/core/events/main');

//the durable record: what may reach disk, and what may not survive inside it.
//
//THE LIVE LOG STAYS IN MEMORY BECAUSE OF CREDENTIALS, and this file is the
//exception that was allowed on two conditions — an allowlist of acts, and
//redaction at the boundary. Both are load-bearing and neither is visible from
//reading a line that came out right.

//THE REAL THREE, WIRED TOGETHER. events takes the log's `keeper` slot itself, so
//a stand-in for the log would be testing the stand-in's idea of that seam.
async function anApp() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-events-'));

    let log = null;
    await logPlugin({}, async (_e, s) => { log = s.log; });

    let actions = null;
    await actionsPlugin({}, async (_e, s) => { actions = s.actions; });

    let events = null;
    await eventsPlugin(
        { log, actions, dataDir: { at: (...p) => path.join(dir, ...p) } },
        async (_e, s) => { events = s.events; });

    return { log, actions, events, dir };
}

const e = (tags, text, level) => ({ at: new Date().toISOString(), tags, text, level: level || 'info' });

//THE ONE THAT WAS WRITTEN AND NEVER ENFORCED. Every denied entry also carries a
//tag that IS kept — a channel line is tagged ['vm', <name>, 'channel'] — so a
//check that asks the allowlist first can never fire the deny list, and the record
//fills with a heartbeat while the acts scroll out of it.
test('a denied tag is refused even when the entry also carries a kept one', async () => {
    const { events } = await anApp();

    assert.equal(events.worthKeeping(e(['vm', 'runner1'], 'runner1 started')), true);
    assert.equal(events.worthKeeping(e(['vm', 'runner1', 'channel'], 'reading its runs')), false,
        'the deny list never fired — this is the bug that emptied the record');
    assert.equal(events.worthKeeping(e(['vm', 'capture'], 'took a picture')), false);
    assert.equal(events.worthKeeping(e(['vm', 'provision'], 'installing')), false);
});

test('command output and a machine talking are never kept', async () => {
    const { events } = await anApp();

    assert.equal(events.worthKeeping(e(['vm'], 'ordinary act')), true);
    assert.equal(events.worthKeeping(e(['vm'], 'a line of git output', 'out')), false, '`out` reached the record');
    assert.equal(events.worthKeeping(e(['guest', 'vm'], 'whatever a worker printed')), false, 'a guest reached the record');
});

test('a tag nobody named is not kept, so a new logger cannot start writing to disk', async () => {
    const { events } = await anApp();
    assert.equal(events.worthKeeping(e(['somethingNew'], 'an act nobody decided about')), false);
});

//REDACTION AT THE BOUNDARY. `credentialsBegin` writes an authorize URL under the
//`vm` tag, which IS kept — so without this, beginning a sign-in puts a sign-in
//link on disk through the door the allowlist opened.
test('a sign-in URL does not survive being kept, though the act does', async () => {
    const { events } = await anApp();

    const out = events.scrub('runner1 is waiting to be signed in — open https://claude.ai/oauth/authorize?code=abc123xyz');
    assert.ok(!out.includes('oauth'), 'the path survived');
    assert.ok(!out.includes('abc123xyz'), 'the code survived');
    assert.ok(out.includes('claude.ai'), 'the host went too — that part is the useful half and is not the secret');
    assert.ok(out.includes('runner1 is waiting to be signed in'), 'the act itself was mangled');
});

test('a token does not survive, wherever in the sentence it is', async () => {
    const { events } = await anApp();

    assert.ok(!events.scrub('pushed with ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345').includes('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'));
    assert.ok(!events.scrub('set token = hunter2sekrit').includes('hunter2sekrit'));

    //THE PROPERTY, NOT THE MARKER. This read `/<credential>@/`, which is the
    //word the blunt `//user:pass@` rule leaves behind — and it stopped matching
    //when a rule that KNOWS what a GitHub token is started firing first, leaving
    //`https://<redacted>@github.com/o/r`. Nothing got weaker: the secret is gone
    //either way and the host survives, which is more useful than either marker.
    //
    //A test that asserts which of two correct rules won is a test that goes red
    //when the redaction improves.
    const url = events.scrub('remote https://x:ghp_abc@github.com/o/r');
    assert.ok(!url.includes('ghp_abc'), 'a token in a remote URL survived');
    assert.match(url, /<redacted>|<credential>/, 'it was dropped silently, with nothing saying something was there');
    assert.match(url, /github\.com/, 'the host went too, so the line no longer says where the push was going');
});

//---------------------------------------------------------------------------
//THE SEAM, DRIVEN RATHER THAN READ.
//---------------------------------------------------------------------------

test('a kept act written to the live log lands in the record, and an unkept one does not', async () => {
    const { log, events } = await anApp();

    log.on('todo').good('T1 "a thing" — added by the window');
    log.on('okc').good('connected to the dashboard');
    log.on('vm', 'runner1', 'channel').info('reading its runs');

    const rows = events.all({});
    assert.equal(rows.length, 1, 'the allowlist let something through, or dropped the act');
    assert.match(rows[0].text, /T1 "a thing"/);
});

test('it survives the process it was written by', async () => {
    const { log, events, actions, dir } = await anApp();
    log.on('task').good('a task was written');
    assert.equal(events.all({}).length, 1);

    //a second app over the same folder — which is what a restart is
    let log2 = null;
    await logPlugin({}, async (_e, s) => { log2 = s.log; });
    let events2 = null;
    await eventsPlugin(
        { log: log2, actions, dataDir: { at: (...p) => path.join(dir, ...p) } },
        async (_e, s) => { events2 = s.events; });

    const rows = events2.all({});
    assert.equal(rows.length, 1, 'the record did not survive the restart it exists for');
    assert.match(rows[0].text, /a task was written/);
});

test('the bookmark is what you pass back to see only what is new', async () => {
    const { log, actions } = await anApp();
    log.on('task').good('the first thing');

    const first = await actions.call('events', {});
    assert.equal(first.events.length, 1);
    assert.ok(first.bookmark);

    const nothingNew = await actions.call('events', { since: first.bookmark });
    assert.equal(nothingNew.events.length, 0, 'it re-read what the caller already had');

    log.on('task').good('the second thing');
    const since = await actions.call('events', { since: first.bookmark });
    assert.equal(since.events.length, 1);
    assert.match(since.events[0].text, /the second thing/);
});

//THE ONE THE FLAKY VERSION OF THE TEST ABOVE WAS ACTUALLY FINDING.
//
//`at` is milliseconds, and two acts in one millisecond is not a rare case — the
//queue puts a machine away and writes the next line immediately. While the
//bookmark was a timestamp, the second of them was not GREATER than the mark, so
//it never came back: a watcher following along never learned it happened, and
//nothing anywhere said so.
//
//THE COLLISION IS WRITTEN, NOT WAITED FOR. Logging twice in one tick USUALLY
//shares a millisecond, which made the first version of this test flaky in both
//directions — it caught the bug about one run in six and proved nothing the rest
//of the time. `keep` takes the entry, `at` and all, so the timestamps can simply
//be made identical and the answer is the same on every run.
test('two acts in the same millisecond are both readable after a bookmark', async () => {
    const { events, actions } = await anApp();
    const at = '2026-08-20T12:00:00.000Z';

    events.keep({ at: at, level: 'good', tags: ['task'], text: 'the first thing' });
    const mark = (await actions.call('events', {})).bookmark;

    events.keep({ at: at, level: 'good', tags: ['task'], text: 'same ms, one' });
    events.keep({ at: at, level: 'good', tags: ['task'], text: 'same ms, two' });

    const rows = (await actions.call('events', { since: mark })).events;
    assert.equal(new Set(rows.concat([{ at: at }]).map((e) => e.at)).size, 1,
        'the fixture stopped sharing one timestamp, so this proves nothing');
    assert.equal(rows.length, 2, 'an act was lost because another shared its millisecond');
    assert.deepEqual(rows.map((e) => e.text), ['same ms, one', 'same ms, two']);
});

//A LEAK CANNOT BE UNDONE ONCE IT IS ON DISK, so this reads the file rather than
//the accessor: an in-memory scrub with an unscrubbed write behind it would pass
//every assertion above.
test('what reaches the file is what was scrubbed, not what was said', async () => {
    const { log, events } = await anApp();
    log.on('vm').info('runner1 waiting — open https://claude.ai/oauth/authorize?code=SEKRIT12345');

    const onDisk = fs.readFileSync(events.FILE, 'utf8');
    assert.ok(onDisk.includes('runner1 waiting'), 'the act is not on disk at all');
    assert.ok(!onDisk.includes('SEKRIT12345'), 'the credential is on disk');
    assert.ok(!onDisk.includes('oauth'), 'the path is on disk');
});
