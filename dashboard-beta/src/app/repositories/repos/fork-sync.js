//---------------------------------------------------------------------------
//WHICH REPOSITORY A FORK SYNC WOULD ACTUALLY PULL FROM, and whether the press
//can close the gap being looked at.
//
//GITHUB'S merge-upstream ONLY SYNCS FROM THE IMMEDIATE PARENT. That is the one
//fact everything here follows from, and it is a fact about GitHub rather than
//about this app, so no amount of picking changes it.
//
//THE CARD THAT ASKS THIS MEASURES SOMETHING ELSE: the fork against WHERE ITS
//WORK GOES, which for a fork of a fork is a third repository. Answering "how far
//behind" and "what would this press do" from the same field is how the button
//came to say `Sync fork from trustcrypto` while the action answered "GitHub can
//only sync a fork from its own immediate parent, which is 0c-coder/python-
//onlykey" — two sentences about one repository, at one moment, disagreeing.
//
//IT IS A MODULE AND NOT FOUR LINES IN THE PANE because the pane cannot be
//pressed from here: `windowClick` is refused while the drills are off, and they
//are off for the workspace this is developed against. ../../ui/theme/dialog.js
//has the same shape for the same reason — the choice is between a decision that
//can be rendered in a test and one that ships read but never run.
//
//THE OTHER TWO SURFACES ALREADY KNEW THIS. ./repos.js warns while somebody
//picks a target ("It is NOT the immediate parent, so syncing the fork cannot use
//the one-call merge-upstream that GitHub offers") and ./server.js's
//`repoForkSync` refuses when it is pressed. This is the third asking the same
//question rather than a fourth answer.
//---------------------------------------------------------------------------

//`parent` IS THE WHOLE ANSWER TO "FROM WHERE", and `null` when this is not a
//fork of anything known — which is an ordinary state (a repository nobody
//forked) and not a failure.
//
//`on` IS WHERE THE GAP BEING SHOWN IS MEASURED TO. Where the two are the same
//string this is the ordinary case and every answer below is what it always was.
function forkSyncFrom(repo, gap) {
    var r = repo || {};
    var to = (gap && gap.on) || null;
    var from = r.parent || null;

    if (!from) {
        return {
            from: null, canSync: false,
            why: 'This is not a fork of anything this app knows about, so there is nothing '
                + 'upstream to pull from'
        };
    }

    if (to && to !== from) {
        return {
            from: from, canSync: false,
            //THE ACTION'S OWN WORDS, deliberately: somebody who reads this and
            //then presses anyway should meet the sentence they were already
            //shown, not a second phrasing of it that reads like a new problem.
            why: 'GitHub can only sync a fork from its immediate parent, ' + from
                + '. This gap is against ' + to + ', and closing it means fetching and merging '
                + 'through this host — a different act, and one to ask for.'
        };
    }

    return { from: from, canSync: true, why: null };
}

module.exports = { forkSyncFrom: forkSyncFrom };
