const { test } = require('node:test');
const assert = require('node:assert');

const { summariseReviews } = require('../../src/app/repositories/pr/reviews');

//---------------------------------------------------------------------------
//WHAT GITHUB SAYS ABOUT WHETHER A PULL REQUEST IS REVIEWED, summarised the
//way GitHub itself does: a reviewer's latest review is the one that counts.
//---------------------------------------------------------------------------

const R = (by, state, at, over) => Object.assign({ user: { login: by }, state, submitted_at: at, commit_id: 'abc', html_url: 'u', id: 1 }, over || {});

test('a reviewer who approved and then requested changes has requested changes', () => {
    const s = summariseReviews([R('alice', 'APPROVED', '2026-01-01'), R('alice', 'CHANGES_REQUESTED', '2026-01-02')]);
    assert.equal(s.approved, 0, 'history was counted as an opinion somebody still holds');
    assert.equal(s.changesRequested, 1);
    assert.equal(s.latest.event, 'CHANGES_REQUESTED');
});

test('two reviewers are two opinions', () => {
    const s = summariseReviews([R('alice', 'APPROVED', '2026-01-01'), R('bob', 'APPROVED', '2026-01-02'), R('carol', 'COMMENTED', '2026-01-03')]);
    assert.equal(s.approved, 2);
    assert.equal(s.commented, 1);
    assert.equal(s.reviewers.length, 3);
});

test('dismissed and pending are nothing', () => {
    const s = summariseReviews([R('alice', 'DISMISSED', '2026-01-01'), R('bob', 'PENDING', '2026-01-02')]);
    assert.deepEqual([s.approved, s.changesRequested, s.commented], [0, 0, 0]);
    assert.equal(s.latest, null);
});

test('this host finds its own review by the login its token signs in as', () => {
    const s = summariseReviews([R('alice', 'APPROVED', '2026-01-01'), R('BMatusiak', 'COMMENTED', '2026-01-02', { commit_id: 'deadbeef' })], 'bmatusiak');
    assert.equal(s.latestByThisHost.event, 'COMMENTED');
    assert.equal(s.latestByThisHost.sha, 'deadbeef');
    //AND NOT WHEN IT NEVER SPOKE.
    assert.equal(summariseReviews([R('alice', 'APPROVED', '2026-01-01')], 'bmatusiak').latestByThisHost, null);
    //AND NOT WITH NO LOGIN TO MATCH ON -- an empty login must not match an
    //empty anything.
    assert.equal(summariseReviews([R('alice', 'APPROVED', '2026-01-01')], '').latestByThisHost, null);
});

test('nothing, and rubbish, are both an empty summary rather than a throw', () => {
    assert.equal(summariseReviews([]).latest, null);
    assert.equal(summariseReviews(null).approved, 0);
    assert.equal(summariseReviews([{ state: 'APPROVED' }]).approved, 0, 'a review with no author was counted');
});
