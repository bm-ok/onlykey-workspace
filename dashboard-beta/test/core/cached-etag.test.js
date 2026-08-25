const { test } = require('node:test');
const assert = require('node:assert');

const Drawers = require('../../src/app/core/cached/drawers');

//---------------------------------------------------------------------------
//the fourth door — an answer held beside the far end's fingerprint for it.
//
//WHAT MAKES THIS DIFFERENT FROM THE OTHER THREE, and what these checks are for:
//it is the only drawer whose key does NOT determine its answer. A URL says
//nothing about whether somebody merged something a minute ago, so this kind can
//never hand back what it holds on its own — every read has to go and ask, and
//what it saves is the PAYLOAD rather than the round trip.
//
//THE CLAIMS:
//
//  * it has no `get`, and that is deliberate rather than unfinished. `get(key,
//    make)` is the interface that says "hand me what you have"; an etag drawer
//    offering it would be serving the last answer as though it were this one.
//  * an answer with no fingerprint is not kept, because nothing could ever
//    check it again
//  * it survives being written down, which is what makes a restart cheap
//  * a write does NOT wipe it, unlike the clock-keyed drawers — it corrects
//    itself, because a changed resource gets a new fingerprint and the next
//    read comes back 200 instead of 304
//---------------------------------------------------------------------------

test('an etag drawer has no get, so nothing can take the answer without asking', () => {
    const d = Drawers().byEtag('pulls');
    assert.equal(typeof d.get, 'undefined',
        'it offers get, which is the interface that hands back an answer without validating it');
    assert.equal(typeof d.tag, 'function');
    assert.equal(typeof d.got, 'function');
    assert.equal(typeof d.still, 'function');
    assert.equal(d.kind, 'etag');
});

test('nothing is held until an answer arrives, and then its fingerprint is', () => {
    const d = Drawers().byEtag('pulls');
    assert.equal(d.tag('/repos/a/b/pulls/1'), null, 'it claims a fingerprint for something never asked');
    assert.equal(d.still('/repos/a/b/pulls/1'), undefined);

    d.got('/repos/a/b/pulls/1', 'W/"abc"', { state: 'merged' });
    assert.equal(d.tag('/repos/a/b/pulls/1'), 'W/"abc"');
    assert.deepEqual(d.still('/repos/a/b/pulls/1'), { state: 'merged' });
});

test('a new answer for the same url replaces the old fingerprint', () => {
    const d = Drawers().byEtag('pulls');
    d.got('/one', 'W/"first"', { state: 'open' });
    d.got('/one', 'W/"second"', { state: 'merged' });
    assert.equal(d.tag('/one'), 'W/"second"');
    assert.deepEqual(d.still('/one'), { state: 'merged' });
});

//---------------------------------------------------------------------------
//AN ANSWER WITH NO FINGERPRINT IS WORSE THAN NO ANSWER.
//
//It would sit in the drawer with no way for the next read to check it, which is
//a cache that has to be believed — and the whole argument for writing this kind
//to disk is that nothing in it is ever believed.
//---------------------------------------------------------------------------
test('an answer with no fingerprint is refused, and drops any older one', () => {
    const d = Drawers().byEtag('pulls');
    d.got('/one', 'W/"first"', { state: 'open' });

    assert.equal(d.got('/one', null, { state: 'merged' }), false, 'it kept an answer it can never revalidate');
    assert.equal(d.tag('/one'), null, 'the older fingerprint survived an answer that had none');
    assert.equal(d.still('/one'), undefined,
        'the stale value is still in there, and the next read has no fingerprint to check it with');
});

test('an empty-string fingerprint is no fingerprint', () => {
    const d = Drawers().byEtag('pulls');
    assert.equal(d.got('/one', '', { state: 'open' }), false);
    assert.equal(d.tag('/one'), null);
});

//---------------------------------------------------------------------------
//WRITTEN DOWN, AND FOR A DIFFERENT REASON THAN `byContent` IS.
//
//Content reaches disk because it is true for ever. This reaches disk because it
//is never believed without asking, so the worst a stale file can do is send a
//fingerprint the far end no longer recognises and get a full answer back —
//which is exactly what having no file does.
//---------------------------------------------------------------------------
test('it offers what it holds to be written down, and takes it back', () => {
    const one = Drawers().byEtag('pulls');
    one.got('/one', 'W/"a"', { state: 'merged' });
    one.got('/two', 'W/"b"', { state: 'open' });

    const rows = one.save();
    assert.ok(rows, 'an etag drawer offered nothing to write down');

    //A RESTART: a fresh drawer, handed the file.
    const two = Drawers().byEtag('pulls');
    assert.equal(two.tag('/one'), null, 'it had something before it was given anything');
    two.load(JSON.parse(JSON.stringify(rows)));

    assert.equal(two.tag('/one'), 'W/"a"', 'the fingerprint did not survive the restart, so the next read is a full download');
    assert.deepEqual(two.still('/two'), { state: 'open' });
});

//---------------------------------------------------------------------------
//AND A WRITE LEAVES IT ALONE.
//
//`stale()` empties the clock-keyed drawers, which have nothing else to protect
//them. This kind corrects itself: the resource changed, the far end issues a new
//fingerprint, and the next read is a 200 rather than a 304. Wiping it would
//throw away the fingerprints and turn every read afterwards back into a full
//download — the cost it exists to avoid, paid on every write.
//---------------------------------------------------------------------------
test('a write drops the clock-keyed drawers and leaves the fingerprints alone', () => {
    const c = Drawers();
    const tags = c.byEtag('pulls');
    const quick = c.whileFresh('refs', 1000);

    tags.got('/one', 'W/"a"', { state: 'merged' });

    const dropped = c.stale();
    assert.equal(tags.tag('/one'), 'W/"a"', 'a write threw away a fingerprint, so the next read downloads the lot again');
    assert.equal(typeof dropped, 'number');
    assert.ok(quick, 'the clock-keyed drawer was never made');
});

test('it is counted, and a 304 reads as a hit rather than as nothing happening', () => {
    const d = Drawers().byEtag('pulls');
    d.got('/one', 'W/"a"', { state: 'merged' });
    d.still('/one');
    d.still('/one');

    const s = d.stats();
    assert.equal(s.kind, 'etag');
    assert.equal(s.held, 1);
    assert.equal(s.misses, 1, 'the first fetch was not counted as a miss');
    assert.equal(s.hits, 2, 'the answers served against a 304 were not counted');
});

test('it can be forgotten one at a time and all at once', () => {
    const d = Drawers().byEtag('pulls');
    d.got('/one', 'W/"a"', 1);
    d.got('/two', 'W/"b"', 2);

    assert.equal(d.forget('/one'), true);
    assert.equal(d.tag('/one'), null);
    assert.equal(d.tag('/two'), 'W/"b"');

    assert.equal(d.empty(), 1);
    assert.equal(d.tag('/two'), null);
});

//---------------------------------------------------------------------------
//THE NAME RULE IS THE SAME ONE, checked here because a fourth door added later
//is exactly where a rule quietly stops applying.
//---------------------------------------------------------------------------
test('an etag drawer is named by the same rule as the other three', () => {
    assert.throws(() => Drawers().byEtag('../escape'), /named in letters/);
    assert.throws(() => Drawers().byEtag(''), /named in letters/);
});

test('asking the same name twice is the same drawer', () => {
    const c = Drawers();
    c.byEtag('pulls').got('/one', 'W/"a"', 1);
    assert.equal(c.byEtag('pulls').tag('/one'), 'W/"a"', 'a second call made a second drawer, so nothing is ever a hit');
});
