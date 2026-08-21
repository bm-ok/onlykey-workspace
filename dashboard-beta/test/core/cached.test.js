const { test } = require('node:test');
const assert = require('node:assert');

const Drawers = require('../../src/app/core/cached/drawers');

//---------------------------------------------------------------------------
//the mechanism every plugin was writing its own copy of.
//
//THE CLAIMS THIS FILE IS FOR, and they are not all about speed:
//
//  * an answer is worked out once, and a second asker mid-flight does not
//    start a second one — which the app being ported from could not have got
//    wrong, because its reads were synchronous, and this one can
//  * a failure is never kept, and `null` always is — those are opposite
//    answers and a truth test cannot tell them apart
//  * a write drops the clock-keyed drawers and NOTHING else, because a moved
//    ref gives a content-keyed drawer a different key and there is nothing in
//    it to be wrong
//  * a stamp-keyed drawer offers nothing to write down, ever. That one is not
//    about correctness: what that kind holds in the app being ported from is
//    what a sealed credential unsealed to.
//---------------------------------------------------------------------------

function counted(value) {
    var n = 0;
    var f = function () { n++; return value; };
    f.runs = function () { return n; };
    return f;
}

test('an answer is worked out once and reused', async () => {
    const c = Drawers({});
    const d = c.byContent('merges');
    const make = counted('clean');

    assert.equal(await d.get('repo|aaa|bbb', make), 'clean');
    assert.equal(await d.get('repo|aaa|bbb', make), 'clean');
    assert.equal(await d.get('repo|aaa|bbb', make), 'clean');

    assert.equal(make.runs(), 1, 'the second and third ask must not run it again');
    assert.equal(d.stats().hits, 2);
    assert.equal(d.stats().misses, 1);
});

test('a different key is a different answer, which is the whole rule', async () => {
    const c = Drawers({});
    const d = c.byContent('merges');
    const make = counted('x');

    await d.get('repo|aaa|bbb', make);
    await d.get('repo|aaa|ccc', make);

    assert.equal(make.runs(), 2, 'a moved ref must not be answered from the old key');
});

test('two callers asking at once share one answer', async () => {
    const c = Drawers({});
    const d = c.byContent('merges');

    let runs = 0;
    let release;
    const held = new Promise(r => { release = r; });
    const slow = () => { runs++; return held; };

    //BOTH ASKED BEFORE EITHER WAS ANSWERED, which is what two panes polling the
    //same board on unsynchronised timers does routinely.
    const a = d.get('k', slow);
    const b = d.get('k', slow);
    release('done');

    assert.equal(await a, 'done');
    assert.equal(await b, 'done');
    assert.equal(runs, 1, 'the second asker must wait on the first, not start its own');
    assert.equal(d.stats().shared, 1);
});

test('a failure is not kept, and the next ask tries again', async () => {
    const c = Drawers({});
    const d = c.byContent('merges');

    let n = 0;
    const flaky = () => { n++; if (n === 1) throw new Error('git was busy'); return 'ok'; };

    await assert.rejects(() => d.get('k', flaky), /git was busy/);
    assert.equal(await d.get('k', flaky), 'ok', 'a blink must not outlive the thing that caused it');
    assert.equal(n, 2);
});

test('a failure reaches everybody who was waiting on it', async () => {
    const c = Drawers({});
    const d = c.byContent('merges');

    let boom;
    const held = new Promise((_, reject) => { boom = reject; });
    const a = d.get('k', () => held);
    const b = d.get('k', () => held);
    boom(new Error('gone'));

    await assert.rejects(() => a, /gone/);
    await assert.rejects(() => b, /gone/, 'a sharer must not be left hanging on a failed answer');
});

test('null is an answer and is kept like any other', async () => {
    const c = Drawers({});
    const d = c.byContent('merges');
    const make = counted(null);

    assert.equal(await d.get('k', make), null);
    assert.equal(await d.get('k', make), null);

    //`wouldConflict` answers null for "could not tell", and re-running
    //merge-tree to be told again that it cannot tell is the most expensive way
    //to learn nothing.
    assert.equal(make.runs(), 1, 'null must not read as "nothing kept"');
});

test('undefined is an answer too', async () => {
    const c = Drawers({});
    const d = c.byContent('merges');
    const make = counted(undefined);

    await d.get('k', make);
    await d.get('k', make);
    assert.equal(make.runs(), 1);
});

test('whileFresh answers from the drawer inside its window and re-reads after it', async () => {
    let now = 1000;
    const c = Drawers({ now: () => now });
    const d = c.whileFresh('refs', 1000);
    const make = counted('refs');

    await d.get('repo', make);
    now = 1500;
    await d.get('repo', make);
    assert.equal(make.runs(), 1, 'inside the window it must not ask again');

    now = 2001;
    await d.get('repo', make);
    assert.equal(make.runs(), 2, 'past the window it must');
});

test('whileFresh insists on being told how long fresh is', () => {
    const c = Drawers({});
    assert.throws(() => c.whileFresh('refs'), /how long is fresh/);
    assert.throws(() => c.whileFresh('refs', 0), /how long is fresh/);
});

test('a write drops the clock-keyed drawers and leaves the others alone', async () => {
    const c = Drawers({});
    const refs = c.whileFresh('refs', 60000);
    const merges = c.byContent('merges');
    const files = c.byStamp('files');

    const a = counted('a'), b = counted('b'), f = counted('f');
    await refs.get('repo', a);
    await merges.get('repo|1|2', b);
    await files.get('cfg|99:120', f);

    const dropped = c.stale();
    assert.equal(dropped, 1, 'one clock-keyed answer was held');

    await refs.get('repo', a);
    await merges.get('repo|1|2', b);
    await files.get('cfg|99:120', f);

    assert.equal(a.runs(), 2, 'the clock-keyed drawer must be re-read after a write');
    assert.equal(b.runs(), 1, 'a moved ref gives a different key — there is nothing in here to be wrong');
    assert.equal(f.runs(), 1, 'a stamp key says for itself whether the file moved');
});

test('a drawer drops the lot at its limit rather than growing for ever', async () => {
    const c = Drawers({ limit: 4 });
    const d = c.byContent('merges');

    for (var i = 0; i < 5; i++) await d.get('k' + i, counted(i));

    assert.equal(d.stats().wipes, 1);
    assert.equal(d.stats().held, 1, 'the wipe keeps the answer that caused it, and nothing else');
});

test('a stamp-keyed drawer offers nothing to write down, ever', async () => {
    const c = Drawers({});
    const stamp = c.byStamp('credentials');
    const clock = c.whileFresh('refs', 1000);
    const content = c.byContent('merges');

    await stamp.get('cred|1:2', counted({ oauth: 'a-token' }));
    await clock.get('repo', counted(['main']));
    await content.get('repo|1|2', counted('clean'));

    //THIS IS THE SECURITY HALF, not a tidiness one. In the app being ported
    //from, the stamp-keyed drawer holds what `core/secret` unsealed a
    //credential file to. A persisted copy of that is a worse bug than every
    //spawn this whole mechanism saves.
    assert.equal(stamp.save(), null, 'a stamp-keyed drawer must never reach disk');
    assert.equal(clock.save(), null, 'a clock-keyed drawer would come back stale by exactly its window');
    assert.notEqual(content.save(), null, 'a content-keyed drawer is the one kind worth keeping');
});

test('a stamp-keyed drawer refuses what is handed back to it', async () => {
    const c = Drawers({});
    const stamp = c.byStamp('credentials');

    assert.equal(stamp.load({ 'cred|1:2': { oauth: 'a-token' } }), 0);
    assert.equal(stamp.peek('cred|1:2'), undefined, 'nothing may be loaded into a drawer that may not be saved');
});

test('a content-keyed drawer comes back from what was written down', async () => {
    const c = Drawers({});
    const d = c.byContent('merges');
    const make = counted('recomputed');

    d.load({ 'repo|aaa|bbb': 'clean' });

    assert.equal(await d.get('repo|aaa|bbb', make), 'clean');
    assert.equal(make.runs(), 0, 'what survived the restart must be used');
});

test('what is already held wins over what is loaded on top of it', async () => {
    const c = Drawers({});
    const d = c.byContent('merges');

    await d.get('k', counted('now'));
    d.load({ k: 'from-disk' });

    assert.equal(d.peek('k'), 'now', 'a stale file must not overwrite a fresh answer');
});

test('a load stops at the limit rather than blowing past it', () => {
    const c = Drawers({ limit: 3 });
    const d = c.byContent('merges');

    const rows = {};
    for (var i = 0; i < 50; i++) rows['k' + i] = i;
    d.load(rows);

    assert.equal(d.stats().held, 3, 'a file that grew across restarts must not be loaded whole');
});

test('a drawer asked for twice by name is the same drawer', async () => {
    const c = Drawers({});
    const make = counted('v');

    await c.byContent('merges').get('k', make);
    await c.byContent('merges').get('k', make);

    assert.equal(make.runs(), 1, 'two plugins naming the same drawer must share it, not shadow it');
});

test('a key that is not a key is refused rather than pooled under one name', async () => {
    const c = Drawers({});
    const d = c.byContent('merges');

    await assert.rejects(() => d.get(null, counted('a')), /asked for by key/);
    await assert.rejects(() => d.get(undefined, counted('a')), /asked for by key/);
    await assert.rejects(() => d.get('', counted('a')), /asked for by key/);
});

test('forget takes one answer out, empty takes them all', async () => {
    const c = Drawers({});
    const d = c.byContent('merges');

    await d.get('a', counted(1));
    await d.get('b', counted(2));

    assert.equal(d.forget('a'), true);
    assert.equal(d.forget('a'), false, 'forgetting what is not there is not an error');
    assert.equal(d.peek('a'), undefined);
    assert.equal(d.peek('b'), 2);

    assert.equal(d.empty(), 1);
    assert.equal(d.peek('b'), undefined);
});

test('peek never starts any work', async () => {
    const c = Drawers({});
    const d = c.byContent('merges');

    assert.equal(d.peek('nothing'), undefined);
    assert.equal(d.stats().misses, 0, 'looking is not asking');
});

test('about() names every drawer that has been opened', async () => {
    const c = Drawers({});
    c.byContent('merges');
    c.whileFresh('refs', 1000);
    c.byStamp('files');

    const kinds = {};
    c.about().forEach(s => { kinds[s.name] = s.kind; });

    assert.deepEqual(kinds, { merges: 'content', refs: 'clock', files: 'stamp' });
});
