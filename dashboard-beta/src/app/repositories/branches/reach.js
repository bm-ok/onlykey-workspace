//---------------------------------------------------------------------------
//WHICH REPOSITORIES A BRANCH IS IN, AND WHICH IT IS MISSING FROM.
//
//THE UNION RATHER THAN THE INTERSECTION. A name present in three of four
//repositories is the normal state of a change that only touched three —
//reporting it as absent would hide the work, and reporting it as present
//everywhere would claim repositories that have nothing on it.
//
//---- and MISSING is asked of the repositories it is ABOUT ------------------
//
//NOT OF THE WHOLE WORKSPACE, and this is the one that has teeth.
//
//A branch cut from a group naming two of three repositories is COMPLETE at two.
//Calling the third "missing" reads as damage, and is worse than misleading
//because it is ACTED ON: `vmWorkspace` refuses to set a machine up on a branch
//with anything missing. So a correctly scoped branch would be permanently
//unusable, and the fix on offer would be to extend it into a repository the work
//has nothing to do with.
//
//The group a branch was cut from is therefore also the list of repositories it
//exists in, is checked out in, is measured across, and is judged on — see
//`scopeOf`, which is where that decision lives.
//
//---- and `gone` is a different problem from `missing` ----------------------
//
//A repository the line NAMED and that is not in this workspace any more. Nothing
//can extend a branch into it, so offering "cut it there" would be advice that
//cannot be taken. Reported separately rather than folded in.
//---------------------------------------------------------------------------

//`carriers` IS WHICH REPOSITORIES ACTUALLY HAVE THE BRANCH — the union, read
//from the repositories themselves. `scope` is what the branch is ABOUT.
function reachOf(carriers, scope) {
    var has = (carriers || []).slice();
    var about = (scope && scope.repos) || [];

    return {
        //ONLY THE REPOSITORIES IN SCOPE, so a branch that also exists elsewhere
        //for unrelated reasons does not drag them into this work.
        in: has.filter(function (n) { return about.indexOf(n) >= 0; }),
        about: about,
        missing: about.filter(function (n) { return has.indexOf(n) < 0; }),
        gone: (scope && scope.gone) || [],
        group: (scope && scope.group) || null
    };
}

//---- and whether a machine can be set up on it ----------------------------
//
//SAID HERE, WHERE THE FIX IS ONE COMMAND. A machine checks the branch out in
//every repository it is given, so the one without it fails INSIDE THE GUEST, in
//the middle of a setup, with git's own words about a pathspec.
//
//IN SOME REPOSITORIES AND NOT OTHERS is a state a workspace reaches on its own:
//a repository added after a branch was cut does not have it, and nothing goes
//back to extend old branches into new repositories.
function whyNotUsable(branch, reach) {
    if (!reach.about.length) {
        return '"' + branch + '" is about nothing this workspace has — there is nowhere to set a machine up.';
    }

    if (!reach.in.length) {
        return 'There is no branch called "' + branch + '" in ' + reach.about.join(', ') + '. Make it '
            + 'first, with a reason — branchCreate --branch ' + branch + ' --reason "..." --group "..." — '
            + 'so what it is for and what it starts from are both recorded before anything is built on it. '
            + 'If that name is a typo, this is the refusal that catches it.';
    }

    if (reach.missing.length) {
        return '"' + branch + '" is not in ' + reach.missing.join(', ') + ', and a machine checks it out '
            + 'in every repository. Extend it first — branchCreate --branch ' + branch + ' --reason "..." '
            + '--group "..." cuts it wherever it is missing and keeps the reason it already has.';
    }

    return null;
}

module.exports = { reachOf: reachOf, whyNotUsable: whyNotUsable };
