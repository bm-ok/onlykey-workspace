//---------------------------------------------------------------------------
//WHERE A BRANCH STANDS, IN EVERY REPOSITORY THAT HAS IT.
//
//Read either side of a run so "did this task deliver anything" can be answered
//about THIS RUN rather than about the branch. Those are different questions and
//the difference was invisible: a task whose push was refused by the protection
//hook was reported as "1 commit(s) in local-repo-b" — true of the branch, which
//carried a commit from the task before it, and completely wrong about the run
//that had just lost its work.
//
//EVERY REPOSITORY, NOT THE FIRST ONE FOUND. A line spans repositories and the
//first in the list is rarely the one the work was about: the run that proved
//this said "still at 0f586d0", which was one repository sitting exactly where it
//had always been, while the repository being worked in was another. A true
//number about the wrong repository reads as a fact and is worse than no number.
//
//---- and a repository without the branch is `null`, not absent -------------
//
//../queue/onetask compares the two reads key by key. A repository that answers
//with nothing on one side and a missing key on the other is a repository that
//appears to have changed — so every repository is in every answer, and "does not
//have this branch" is a value.
//---------------------------------------------------------------------------

module.exports = function heads(deps) {
    var d = deps || {};
    var all = d.all;   //async () -> { repo: { branch: sha } }

    async function on(branch) {
        var out = {};
        if (!branch) return out;

        var everywhere = null;
        try { everywhere = await all(); } catch (e) { return out; }

        Object.keys(everywhere || {}).forEach(function (repo) {
            var there = everywhere[repo] || {};
            out[repo] = there[branch] || null;
        });

        return out;
    }

    return { on: on };
};
