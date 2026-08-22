//---------------------------------------------------------------------------
//WHETHER A WORKER MAY PUSH TO A PROTECTED BRANCH.
//
//THE WHOLE PERMISSION, IN ONE PLACE, because it is ASKED IN TWO.
//
//The host's pre-receive hook is the RULE: it runs in a directory no guest can
//reach and cannot be edited, skipped or pushed past. A pre-push hook put in the
//guest's checkout is the SIGN, which says the same thing where a worker will
//meet it first. They are deliberately two mechanisms — one cannot be edited, the
//other can, and removing the sign does not get the push through.
//
//THEY ARE NOT ALLOWED TO BE TWO OPINIONS. The first version of this exception
//was written into the host's hook alone, and the sign went on refusing: the push
//was granted by the rule and stopped by the notice, which made the new exception
//DEAD CODE for the exact case it was written for. A run was lost finding that
//out, after another run had been lost finding the first gate.
//
//So both ask this, and this is a pure function of two records — which is what
//lets a drill ask it about a merged cut and an open one without either existing
//on the host.
//
//---- and what qualifies -----------------------------------------------------
//
//A branch qualifies when it is protected ONLY AS A LINK IN A LINE — never as any
//repository's default branch, which is protected for what it IS — and is the
//source of a pull request this host opened and nobody has merged.
//---------------------------------------------------------------------------

//---- is this branch the source of a pull request still out ------------------
//
//READ FROM THE CUT RECORD, WHICH IS LOCAL. This is consulted on a PUSH, so it
//may not ask GitHub: the answer has to be here, and the record already carries
//each pull request's head as "owner:branch".
//
//NOT ONE THAT HAS MERGED. Once it lands, the branch is history again and the
//ordinary rule applies.
function underRevision(branch, cuts) {
    if (!branch) return false;

    var all = cuts || {};
    var names = Object.keys(all);

    for (var i = 0; i < names.length; i++) {
        var pulls = (all[names[i]] || {}).pulls || [];

        for (var j = 0; j < pulls.length; j++) {
            var p = pulls[j];
            if (p.merged === true) continue;

            //"owner:branch" IS WHAT GITHUB CALLS A HEAD, and the part after the
            //colon is the branch. A head with no colon is already just a name.
            var head = String(p.head || '');
            var named = head.indexOf(':') >= 0 ? head.slice(head.indexOf(':') + 1) : head;

            if (named && named === branch) return true;
        }
    }

    return false;
}

//---- and the whole permission ------------------------------------------------
//
//`protectedRows` IS ../branches' ANSWER, keyed by branch: { branch, asDefault,
//asLine }. A branch nothing protects is pushable by the ordinary rule and never
//reaches here as a question.
function mayRevise(branch, cuts, protectedRows) {
    if (!branch) return false;

    var p = (protectedRows || {})[branch];

    //NOT PROTECTED AT ALL, so there is nothing to make an exception to.
    if (!p) return true;

    //PROTECTED FOR WHAT IT IS. A repository's default branch is not a link in a
    //line, and no pull request makes it one.
    if ((p.asDefault || []).length) return false;

    return underRevision(branch, cuts);
}

module.exports = { underRevision: underRevision, mayRevise: mayRevise };
