//---------------------------------------------------------------------------
//what arrived since the last look, worked out from two of GitHub's own lists.
//
//THE SWEEP WROTE EVERY FRESH ANSWER OVER THE OLD ONE AND COMPARED NOTHING, so
//"what is new" was a question nobody here could answer -- `whatsNew.arrived`
//was hard-coded null and said so. This is the comparison, and it is pure: two
//rows in, a list out, so a test can hand it any pair of sweeps and read the
//answer without a GitHub, a workspace or a clock.
//
//---- what counts as arriving --------------------------------------------
//
//  new     an issue or pull request not in the previous sweep at all
//  asked   an issue that was there before and has NOW been tagged -- `asked`
//          was null and is set, OR it names a newer turn than it did. This is
//          the one a person did on purpose, and the only one worth waking
//          anything for.
//
//          THE SECOND HALF WAS MISSING AND A CONVERSATION WENT UNHEARD. An
//          issue tagged in its body is `asked` from the first sweep; when the
//          maintainer then answered the reply with another marked comment,
//          `asked` moved to that comment and nothing counted it, because
//          "null before" was the whole test. A person talking to the
//          supervisor through GitHub is exactly what a tag is for, and every
//          turn of it after the first was silent.
//
//NOT: a closed issue, an edit, a reply that carries no marker. Those are the
//ordinary churn of a project and a supervisor woken for each would be a
//supervisor woken for everything, which is a supervisor nobody leaves on.
//
//THE FIRST SWEEP REPORTS NOTHING. With no previous list every open issue is
//"new", and reporting a hundred arrivals the moment the watch is turned on is
//exactly the opposite of what arriving means. `was` missing is the signal for
//that, and it is the caller's job to pass it honestly.
//---------------------------------------------------------------------------

function keyOf(x) { return String(x.on || '') + '#' + Number(x.number); }

function pick(i) {
    return { on: i.on, number: i.number, title: i.title || null, by: i.by || null, url: i.url || null };
}

function diffArrived(was, now) {
    var out = { issues: [], pulls: [] };
    if (!was || !now) return out;

    var hadIssue = {};
    (was.issues || []).forEach(function (i) { hadIssue[keyOf(i)] = i; });
    (now.issues || []).forEach(function (i) {
        var k = keyOf(i);
        var before = hadIssue[k];
        if (!before) {
            out.issues.push(Object.assign(pick(i), { kind: 'new', asked: i.asked || null }));
            return;
        }
        //TAGGED SINCE. Null before and set now, or set to a NEWER turn than
        //before -- `asked` follows the latest marked comment, so a new one
        //moves its `at`. A tag that was already there is not news, and one
        //that was withdrawn is not an arrival either.
        if (i.asked && (!before.asked || (i.asked.at && before.asked.at !== i.asked.at))) {
            out.issues.push(Object.assign(pick(i), { kind: 'asked', asked: i.asked }));
        }
    });

    //THE SAME TWO CASES FOR A PULL REQUEST. A marked comment under one is a
    //person saying what they want done about the code, and it went unheard
    //once because only the reviews were read.
    var hadPull = {};
    (was.pulls || []).forEach(function (p) { hadPull[keyOf(p)] = p; });
    (now.pulls || []).forEach(function (p) {
        var k = keyOf(p);
        var before = hadPull[k];
        if (!before) {
            out.pulls.push(Object.assign(pick(p), { kind: 'new', asked: p.asked || null }));
            return;
        }
        if (p.asked && (!before.asked || (p.asked.at && before.asked.at !== p.asked.at))) {
            out.pulls.push(Object.assign(pick(p), { kind: 'asked', asked: p.asked }));
        }
    });

    return out;
}

module.exports = { diffArrived: diffArrived, keyOf: keyOf };
