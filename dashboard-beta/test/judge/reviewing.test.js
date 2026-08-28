const { test } = require('node:test');
const assert = require('node:assert');

const { reviewPlan } = require('../../src/app/judge/reviewing');

//---------------------------------------------------------------------------
//WHAT A JUDGE'S CONCLUSION BECOMES ON THE PULL REQUEST. The whole table, and
//the two things that bend it.
//---------------------------------------------------------------------------

test('accept approves, reject requests changes, nothing comments', () => {
    assert.equal(reviewPlan({ concluded: 'accept' }).event, 'APPROVE');
    assert.equal(reviewPlan({ concluded: 'reject' }).event, 'REQUEST_CHANGES');
    assert.equal(reviewPlan({ concluded: 'pending' }).event, 'COMMENT');
    assert.equal(reviewPlan({ concluded: null }).event, 'COMMENT');
    assert.equal(reviewPlan({ concluded: 'accept' }).call, 'YES');
    assert.equal(reviewPlan({ concluded: 'reject' }).call, 'NO');
    assert.equal(reviewPlan({}).call, 'UNSTATED');
});

test('on your own pull request every verdict is a comment, and the draft says why', () => {
    //GITHUB REFUSES AN APPROVAL FROM THE AUTHOR. Sending it anyway is a 422 and
    //a draft nobody can release.
    const own = reviewPlan({ concluded: 'accept', ownAuthor: true });
    assert.equal(own.event, 'COMMENT');
    assert.equal(own.forced, true);
    assert.match(own.why, /your own pull request/);
    //THE RECOMMENDATION SURVIVES IN THE HEADER.
    assert.equal(own.call, 'YES');
    assert.equal(reviewPlan({ concluded: 'reject', ownAuthor: true }).event, 'COMMENT');
    //AND A COMMENT IS NOT "FORCED" -- it was going to be one.
    assert.equal(reviewPlan({ concluded: null, ownAuthor: true }).forced, false);
});

test('a claim check is never a review', () => {
    const p = reviewPlan({ concluded: 'accept', job: 'check-a-claim' });
    assert.equal(p.skip, true);
    assert.equal(reviewPlan({ concluded: 'accept', job: 'check-a-claim-and-say-what-else' }).skip, true);
    assert.equal(reviewPlan({ concluded: 'accept', job: 'judge-a-pull-request' }).skip, false);
});
