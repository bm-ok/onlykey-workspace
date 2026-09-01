//WHETHER A PULL REQUEST WILL GO IN, AND WHETHER IT ALREADY DID.
//
//Both questions were being asked of fields that were not there, and both
//failed the same way: silently, with a plausible-looking answer. This module
//exists so the answers can be tested without a window.
//
//GitHub answers "will it merge" on the SINGLE pull request only — the list
//endpoint omits it — and it answers in three values, not two:
//
//    mergeable: true       it merges
//    mergeable: false      it does not
//    mergeable: null       nobody has asked recently enough; GitHub is
//                          computing it now and will have it next time
//
//That third value is why this is not a boolean. Drawing `null` as "fine"
//says a conflicted pull request is clean until somebody refreshes, and
//drawing it as "broken" cries wolf on every freshly opened cut.
//
//`mergeable_state` is the WHY, and it is the more useful half: `dirty` is a
//real conflict in the files and needs a person; `behind`, `blocked` and
//`unstable` are all things that pass on their own once something else moves.

var WHY_NOT = {
    dirty: 'conflicts',
    behind: 'behind its base',
    blocked: 'blocked',
    unstable: 'checks failing',
    draft: 'draft on GitHub'
};

//`p.merged` IS NOT A FIELD ON A PULL REQUEST HERE and never has been.
//`shapePull` writes `state: 'merged'` and `mergedAt`. The CUT carries a
//`merged` COUNT, which is a different thing one level up, and reading the two
//as one is how `p.merged` came to be written in four places.
//
//Every one of them read `undefined`, so every merged pull request drew as
//"open" — in a panel sitting directly above a story that said it merged. Two
//parts of one pane disagreeing is the shape that makes somebody doubt the
//app rather than the badge.
function isMerged(p) {
    return p.state === 'merged' || !!p.mergedAt;
}

function isOut(p) {
    return !!p.number && !isMerged(p) && p.state !== 'closed';
}

//WHAT TO SAY ABOUT ONE THAT IS STILL OUT, or null for one that is settled —
//a merged or closed pull request has its answer already and GitHub's word on
//its mergeability goes stale behind it.
function goesIn(p) {
    if (!isOut(p)) return null;
    if (p.mergeable === false) {
        return { kind: 'bad', word: WHY_NOT[p.mergeableState] || 'will not merge' };
    }
    if (p.mergeable == null) return { kind: 'muted', word: 'GitHub has not said yet' };
    if (p.mergeableState && p.mergeableState !== 'clean' && WHY_NOT[p.mergeableState]) {
        return { kind: 'warn', word: WHY_NOT[p.mergeableState] };
    }
    return { kind: 'ok', word: 'would merge' };
}

//THE ONES THAT WILL NOT GO IN, which is what the cut in the left-hand list
//has to say about itself. "4 pull requests, 3 merged" is true of a cut with a
//conflict in it and tells you nothing.
function stuck(pulls) {
    return (pulls || []).filter(function (p) { return isOut(p) && p.mergeable === false; });
}

//THE ONES NOBODY CAN ANSWER FOR YET. Named separately so a cut that is
//merely unrefreshed never gets reported as broken.
function unknown(pulls) {
    return (pulls || []).filter(function (p) { return isOut(p) && p.mergeable == null; });
}

function why(p) {
    return WHY_NOT[p.mergeableState] || 'will not merge';
}

module.exports = {
    WHY_NOT: WHY_NOT,
    isMerged: isMerged,
    isOut: isOut,
    goesIn: goesIn,
    stuck: stuck,
    unknown: unknown,
    why: why
};
