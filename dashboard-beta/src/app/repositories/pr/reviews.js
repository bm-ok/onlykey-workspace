//---------------------------------------------------------------------------
//what GitHub says about whether a pull request has been reviewed.
//
//THE APP DID NOT KNOW. It kept `saidOn` -- a note that this host had posted a
//comment -- and nothing else: not whether anybody approved, not whether changes
//were requested, not whether the judge had already spoken at this commit. Those
//are facts GitHub holds on the pull request, and "is it reviewed" is a question
//GitHub answers; keeping a private copy of the answer is the shadow this whole
//piece of work exists to stop.
//
//---- GitHub's own rule, followed rather than reinvented -------------------
//
//A REVIEWER'S LATEST REVIEW IS THE ONE THAT COUNTS. Somebody who approved and
//then requested changes has requested changes; the approval is history. That is
//how GitHub computes its own decision, and a count of every review ever left
//would say "2 approved" about a pull request nobody currently approves of.
//
//DISMISSED IS NOTHING, PENDING IS NOTHING. A dismissed review was withdrawn by
//a maintainer; a pending one has not been submitted and only its author can see
//it. Neither is an opinion anybody holds about the change.
//
//---- what this is not -----------------------------------------------------
//
//NOT A DECISION. REST does not return GitHub's `review_decision`; that needs
//branch protection and GraphQL. This is the summary a person reads off the
//pull request page, in numbers, plus the one thing only this host can add:
//which of these reviews was ITS OWN, because the judge must not review the
//same commit twice and a person releasing a review draft should see one is
//already there.
//---------------------------------------------------------------------------

function summariseReviews(list, ownLogin) {
    var rows = Array.isArray(list) ? list : [];
    var latest = {};
    var order = [];

    rows.forEach(function (r) {
        var state = String(r && r.state || '').toUpperCase();
        var who = r && r.user && r.user.login;
        if (!who) return;
        if (state === 'DISMISSED' || state === 'PENDING') return;
        //LATEST PER REVIEWER. GitHub lists reviews oldest first; the last one
        //seen for a login wins, which is the same thing GitHub's page shows.
        if (!latest[who]) order.push(who);
        latest[who] = {
            by: who, event: state, at: r.submitted_at || null, sha: r.commit_id || null,
            url: r.html_url || null, id: r.id || null
        };
    });

    var out = { approved: 0, changesRequested: 0, commented: 0, latest: null, latestByThisHost: null, reviewers: [] };
    var newest = null;
    order.forEach(function (who) {
        var v = latest[who];
        if (v.event === 'APPROVED') out.approved++;
        else if (v.event === 'CHANGES_REQUESTED') out.changesRequested++;
        else if (v.event === 'COMMENTED') out.commented++;
        out.reviewers.push({ by: v.by, event: v.event, at: v.at, sha: v.sha });
        if (!newest || String(v.at || '') > String(newest.at || '')) newest = v;
    });
    out.latest = newest ? { by: newest.by, event: newest.event, at: newest.at, sha: newest.sha } : null;

    //THIS HOST'S OWN, matched on the login its token signs in as. Case does not
    //distinguish two GitHub accounts, so it must not here.
    var me = String(ownLogin || '').trim().toLowerCase();
    if (me) {
        order.forEach(function (who) {
            if (String(who).toLowerCase() === me) {
                var v = latest[who];
                out.latestByThisHost = { event: v.event, at: v.at, sha: v.sha, url: v.url };
            }
        });
    }
    return out;
}

module.exports = { summariseReviews: summariseReviews };
