//---------------------------------------------------------------------------
//what a judge's conclusion becomes on the pull request.
//
//A JUDGEMENT LIVED ONLY HERE. The recommendation a judge wrote was a field on a
//record in this app, and the only way it reached GitHub was a plain comment --
//which carries no state, satisfies no branch rule, and reads to a maintainer as
//somebody talking rather than somebody reviewing. GitHub's object for "a
//reviewer concluded X at commit Y" is a pull request review, and this is the
//map from what the judge said to what that review is.
//
//---- the map, and the two things that bend it -----------------------------
//
//  accept   -> APPROVE          reject  -> REQUEST_CHANGES
//  pending, or nothing -> COMMENT, with the header saying the judge did not
//                         conclude -- so a reader is not handed silence
//
//GITHUB REFUSES AN APPROVAL FROM THE AUTHOR. A pull request this host opened is
//opened under the same token the judge reviews with, so on its own cuts the
//event is forced to COMMENT and the recommendation goes in the header where a
//person can still read it. Sending APPROVE anyway is a 422 and a draft nobody
//can release.
//
//A CLAIM IS NOT A REVIEW. `check-a-claim` answers a question the flow asked --
//"is this already fixed?" -- and its `CLAIM: true` is for the supervisor, not
//the maintainer. ../judge/server.js already refuses to count one as a review
//in either direction; this refuses to post one as one.
//
//PURE, so the whole table above is a test.
//---------------------------------------------------------------------------

var EVENTS = { accept: 'APPROVE', reject: 'REQUEST_CHANGES' };
var WORDS = { accept: 'YES', reject: 'NO' };

function reviewPlan(d) {
    var o = d || {};
    var job = String(o.job || '');
    if (/^check-a-claim/.test(job)) {
        return { skip: true, why: 'a claim check answers the flow, not the maintainer; it is never posted as a review' };
    }
    var said = String(o.concluded || '').toLowerCase();
    var event = EVENTS[said] || 'COMMENT';
    var call = WORDS[said] || 'UNSTATED';
    var forced = false;
    if (o.ownAuthor && event !== 'COMMENT') {
        forced = true;
        event = 'COMMENT';
    }
    return {
        skip: false,
        event: event,
        call: call,
        //SAID ON THE DRAFT, so the person releasing it is not surprised that
        //their approval went out as a comment.
        forced: forced,
        why: forced
            ? 'this is your own pull request, and GitHub does not take an approval or a request for changes from its author -- it is posted as a comment with the recommendation in the header'
            : null
    };
}

module.exports = { reviewPlan: reviewPlan };
