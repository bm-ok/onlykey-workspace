const { test } = require('node:test');
const assert = require('node:assert');

const m = require('../../src/app/repositories/pr/mergeability');

//WHETHER A PULL REQUEST WILL GO IN, AND WHETHER IT ALREADY DID.
//
//These two questions were both being asked of `p.merged`, which is not a
//field on a pull request here — `shapePull` writes `state: 'merged'`. The
//fixtures below are therefore shaped like `shapePull`'s output and NOT like
//what the code used to expect, because a fixture that carries the imagined
//field proves nothing about the app.

const OPEN = { repo: 'a', number: 1, state: 'open', mergeable: true, mergeableState: 'clean' };
const MERGED = { repo: 'b', number: 2, state: 'merged', mergedAt: '2026-09-01T17:03:00Z' };
const CONFLICT = { repo: 'c', number: 4, state: 'open', mergeable: false, mergeableState: 'dirty' };
const NOTYET = { repo: 'd', number: 5, state: 'open', mergeable: null, mergeableState: null };
const CLOSED = { repo: 'e', number: 6, state: 'closed', mergeable: false, mergeableState: 'dirty' };

test('a merged pull request is merged without a `merged` field', () => {
    //THE BUG: every merged pull request drew as "open", because the only
    //thing asked was `p.merged` and nothing sets it.
    assert.equal(MERGED.merged, undefined, 'the fixture must not carry the imagined field');
    assert.equal(m.isMerged(MERGED), true);
    assert.equal(m.isMerged(OPEN), false);
    assert.equal(m.isMerged(CLOSED), false);
});

test('mergedAt alone is enough', () => {
    assert.equal(m.isMerged({ state: 'open', mergedAt: '2026-09-01T17:03:00Z' }), true);
});

test('a settled pull request is not asked whether it would merge', () => {
    //GitHub's word on a merged or closed one goes stale behind it, and
    //`CLOSED` here is deliberately stale-and-false to prove it is not read.
    assert.equal(m.goesIn(MERGED), null);
    assert.equal(m.goesIn(CLOSED), null);
    assert.equal(m.goesIn({ repo: 'f', state: 'open' }), null, 'no number: never sent');
});

test('a conflict is named, not just refused', () => {
    assert.deepEqual(m.goesIn(CONFLICT), { kind: 'bad', word: 'conflicts' });
    assert.deepEqual(m.goesIn({ number: 1, state: 'open', mergeable: false, mergeableState: 'behind' }),
        { kind: 'bad', word: 'behind its base' });
    assert.deepEqual(m.goesIn({ number: 1, state: 'open', mergeable: false, mergeableState: null }),
        { kind: 'bad', word: 'will not merge' }, 'a reason GitHub did not give still says no');
});

test('null is not clean', () => {
    //Drawing "not worked out yet" as fine is the original fault one rung
    //down: it would make a conflicted-but-unrefreshed cut look ready.
    const said = m.goesIn(NOTYET);
    assert.equal(said.kind, 'muted');
    assert.notEqual(said.word, 'would merge');
    assert.deepEqual(m.goesIn(OPEN), { kind: 'ok', word: 'would merge' });
});

test('a state that is not clean warns even when mergeable is true', () => {
    assert.deepEqual(m.goesIn({ number: 1, state: 'open', mergeable: true, mergeableState: 'behind' }),
        { kind: 'warn', word: 'behind its base' });
    //An unrecognised state is not invented a meaning for.
    assert.deepEqual(m.goesIn({ number: 1, state: 'open', mergeable: true, mergeableState: 'weird' }),
        { kind: 'ok', word: 'would merge' });
});

test('the stuck ones in a cut, which is what the left-hand list must say', () => {
    //THE CUT THAT STARTED THIS: four pull requests, three merged, one
    //conflicted — and the list said "1 open".
    const pulls = [MERGED, CONFLICT, { repo: 'g', number: 1, state: 'merged' }, { repo: 'h', number: 2, state: 'merged' }];
    assert.deepEqual(m.stuck(pulls).map(p => p.repo), ['c']);
    assert.deepEqual(m.unknown(pulls), []);
    assert.deepEqual(m.stuck([]), []);
    assert.deepEqual(m.stuck(undefined), [], 'a cut with no pulls yet is not an error');
});

test('unknown and stuck are different lists', () => {
    //So a cut that is merely unrefreshed is never reported as broken.
    const pulls = [NOTYET, CONFLICT];
    assert.deepEqual(m.stuck(pulls).map(p => p.repo), ['c']);
    assert.deepEqual(m.unknown(pulls).map(p => p.repo), ['d']);
});

test('why names the reason for the merge dialog', () => {
    assert.equal(m.why(CONFLICT), 'conflicts');
    assert.equal(m.why({ mergeableState: null }), 'will not merge');
});
