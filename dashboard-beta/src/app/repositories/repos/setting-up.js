//---------------------------------------------------------------------------
//DECIDING WHETHER A MACHINE CAN BE SET UP, AND ON WHAT.
//
//WHAT IS KNOWABLE WITHOUT A MACHINE IS CHECKED WITHOUT ONE. That is the whole
//organising idea. A branch that does not exist is a mistake whether or not
//anything is running, and it used to be discovered AFTER starting a machine and
//waiting for it to dial in — so the answer to a typo was five minutes away, and
//arrived as though the machine were the problem.
//
//SO THIS DECIDES AND ./workspace.js BUILDS. Every gate is here, in order, with
//nothing run and no machine touched; what comes back is what the script needs.
//A gate that can only be exercised by setting up a real machine is a gate nobody
//tests.
//
//---- set up to READ, which is not set up to WORK --------------------------
//
//Everything here is written for a machine that is going to CHANGE something: one
//branch across every repository the work is about, claimed by this machine so
//two cannot race for the same ref, and recorded so a push can be checked
//against it.
//
//Judging an arrived pull request is none of that. The change is on one branch in
//ONE repository — the pull request's — and the reason the others come along is
//the question a single-repository view cannot answer: does anything else need a
//change this pull request is missing. Nothing will be pushed from either, so
//there is nothing to claim and nothing to race for.
//
//WHY THE INVARIANTS ARE SKIPPED RATHER THAN SATISFIED:
//
//  the branch exists everywhere   it does not, and cannot. Extending it would
//                                 mean cutting somebody else's branch name into
//                                 repositories their change never touched.
//  one machine per branch         nothing is claimed, so there is no ref for two
//                                 machines to race for.
//  the host steps off the branch  that exists so a push to a checked-out branch
//                                 is not refused. There is no push, and the
//                                 defaults are exactly what the host normally
//                                 sits on — so applying it would try to move
//                                 somebody's own checkouts out of the way of a
//                                 machine that is only reading.
//
//THE REFUSAL TO PUSH IS NOT ONE OF THE THINGS BEING SKIPPED. It is on the host,
//in the git route, where no guest can edit it.
//---------------------------------------------------------------------------

//---- a path on the machine, not on this host -------------------------------
//
//GIT BASH REWRITES IT ON THE WAY THROUGH. Type `--folder /home/okc/work` in that
//shell and what arrives is `C:/Program Files/Git/home/okc/work` — a real path,
//on the wrong computer, which the guest then makes as a directory with spaces in
//it and works in happily.
//
//Refused with the fix in it, because nothing about the symptom points at the
//shell that caused it.
function guestPath(p, what) {
    if (!p) return p;

    if (/^[A-Za-z]:[\\/]/.test(p) || String(p).indexOf('\\') >= 0) {
        throw new Error('"' + p + '" is a path on this host, not on the machine. If you are in Git Bash '
            + 'it rewrote ' + what + ' on the way here; run it as MSYS_NO_PATHCONV=1 okc.js ... or write '
            + 'the path with two leading slashes.');
    }

    return p;
}

module.exports = function settingUp(deps) {
    var d = deps || {};

    var ours = d.ours;                    //get, read
    var repos = d.repos;                  //async () -> [{ name }]
    var carriersOf = d.carriersOf;        //async (branch) -> [repo] that have it
    var scopeOf = d.scopeOf;              //async (branch) -> { group, repos, gone }
    var headIn = d.headIn;                //async (repo, branch) -> sha, or null
    var connected = d.connected;
    var nameIsOk = d.nameIsOk;            //async (branch) -> true
    var defaultOf = d.defaultOf;          //async (repo) -> branch
    var mayRevise = d.mayRevise;          //async (branch) -> boolean
    var reach = d.reach;                  //reachOf, whyNotUsable

    async function plan(name, want) {
        var it = want || {};
        var vm = ours.get(name);

        //---- WHAT IS BEING READ, IF ANYTHING --------------------------------
        var reads = it.reading ? await whatItReads(it.reading) : null;

        //---- AND WHICH BRANCH ------------------------------------------------
        var wanted = reads ? reads.branch : String(it.branch || vm.branch || '').trim();
        if (!wanted) throw new Error('Say which branch "' + name + '" is to work on.');

        //A READING MACHINE IS NOT MEASURED AGAINST THE WORKSPACE'S BRANCHES. The
        //branch it reads was fetched from somebody else and exists in exactly one
        //repository, on purpose.
        var found = null;
        if (!reads) {
            found = reach.reachOf(await carriersOf(wanted), await scopeOf(wanted));
            var why = reach.whyNotUsable(wanted, found);
            if (why) throw new Error(why);
        }

        if (!connected(name)) {
            throw new Error('"' + name + '" is not dialled in. Start it and wait for it to connect.');
        }

        guestPath(it.folder, '--folder');

        //---- A MACHINE STAYS ON ITS BRANCH UNTIL IT IS CLEAN ------------------
        //
        //NOT A PREFERENCE ABOUT TIDINESS: switching is how half-finished work
        //stops being anywhere. The commits would still be on the machine, on a
        //branch it may no longer push, and nothing would say so — so the work is
        //neither finished nor lost, which is the state that gets discovered
        //weeks later.
        //
        //The only way off a branch is back to a snapshot from before it, which
        //is an action that states plainly what it discards.
        //
        //REFUSED HERE AND NOT ONLY ON THE BUTTON, because the button is a
        //courtesy and this is the boundary.
        var asked = reads ? '' : String(it.branch || '').trim();
        if (!reads && vm.branch && asked && asked !== vm.branch) {
            throw new Error('"' + name + '" is set up on ' + vm.branch + ' and stays there until it is '
                + 'clean. To work on something else, go back to a snapshot taken before that branch — '
                + '"Go back to it" says what it discards — or use another machine.');
        }

        var on = reads ? reads.branch : (asked || vm.branch).trim();
        if (!(await nameIsOk(on))) {
            throw new Error('"' + on + '" is not a name git will accept for a branch.');
        }

        //---- ONE MACHINE PER BRANCH -------------------------------------------
        //
        //Two machines on one branch push to the same ref, so the second to finish
        //is refused as a non-fast-forward — and its commits are then STRANDED:
        //real work, on a branch it may push, that cannot land without a merge
        //nobody asked for. The same "neither finished nor lost" state as moving a
        //machine between branches, arriving by a different door.
        //
        //A branch is therefore CLAIMED by the machine set up on it, and released
        //when that machine is rolled back to a point before it. Two runners on
        //one task deliberately is a real thing to want — but it wants two branch
        //names, not one branch and a race.
        if (!reads) {
            var held = (ours.read() || []).filter(function (v) {
                return v.name !== name && v.branch === on;
            })[0];

            if (held) {
                throw new Error('"' + on + '" is already being worked on by "' + held.name + '". Two '
                    + 'machines on one branch race for the same ref and the loser\'s commits strand. Pick '
                    + 'another branch, or roll "' + held.name + '" back to a point before it.');
            }
        }

        var here = (await repos()) || [];
        if (!here.length) throw new Error('There are no repositories in this workspace to set up.');

        //---- ONLY THE REPOSITORIES THIS BRANCH IS ABOUT -----------------------
        //
        //The machine used to be handed every repository in the workspace,
        //whatever the work was. Every checkout on it is something a worker can
        //read, change and push, so a change concerning two repositories was
        //granted four — and the extra two are precisely the ones nobody reviews
        //afterwards, because nobody expected the work to touch them.
        //
        //EVERY REPOSITORY WHEN READING, and only the ones a line is about when
        //working. The reason they differ is the reason reading exists: a judge
        //that can only see the repository a change is in cannot say whether
        //another one needed changing too.
        var names = here.map(function (r) { return r.name || r; });
        var scope = reads
            ? { group: null, repos: names, whole: true, gone: [] }
            : { group: found.group, repos: found.about, gone: found.gone };

        var mine = names.filter(function (n) { return scope.repos.indexOf(n) >= 0; });
        if (!mine.length) {
            throw new Error('"' + on + '" is about ' + scope.repos.join(', ') + ', and none of those are '
                + 'in this workspace.');
        }

        //---- WHICH BRANCH IN WHICH REPOSITORY, only when reading --------------
        //
        //The pull request's branch where it lives, and every other repository on
        //its own default — which is what "the rest of the workspace as it stands"
        //means.
        var perRepo = null;
        if (reads) {
            perRepo = {};
            for (var i = 0; i < mine.length; i++) {
                perRepo[mine[i]] = mine[i] === reads.repo
                    ? reads.branch
                    : ((await defaultOf(mine[i])) || on);
            }
        }

        return {
            branch: on,
            reading: reads,
            repos: mine,
            on: perRepo,
            group: scope.group,
            gone: scope.gone || [],
            in: reads ? [reads.repo] : found.in,

            //---- AND THE SIGN AGREES WITH THE RULE ----------------------------
            //
            //A judge is always read-only and that is not negotiable. Otherwise
            //this asks the same question the host's hook asks — see
            //../pr/revising — because a branch the hook WOULD accept a push to
            //must not carry a notice saying it will refuse one. It did, and the
            //run that found out was thrown away.
            readOnly: reads ? true : await readOnlyOn(on),

            //---- AND WHETHER THE MACHINE CLAIMS IT ----------------------------
            //
            //A READING MACHINE CLAIMS NOTHING. Being set up on a branch is what
            //every other machine's permission to push is MADE of, so recording it
            //would hand a judge the right to write to the very thing it is
            //judging.
            claims: reads ? null : on
        };
    }

    //---- WHETHER THE CHECKOUT CARRIES A READ-ONLY NOTICE ----------------------
    //
    //ONE QUESTION, ASKED ONCE. The app being ported from writes this as
    //`isProtected(on) && !mayRevise(on)`, and the first half is redundant:
    //`mayRevise` opens by returning TRUE for a branch nothing protects, so the
    //`&&` can only ever agree with it.
    //
    //It is dropped rather than copied, and the reason matters more than the line.
    //../pr/revising exists BECAUSE this permission was once asked in two places
    //that disagreed — the host's hook allowed a push and the checkout's notice
    //refused it, and the exception was dead code for the exact case it was
    //written for. Keeping a second protection check here, beside the one inside
    //`mayRevise`, is how that happens again.
    //
    //SO THE CONTRACT THIS LEANS ON IS EXPLICIT: `mayRevise` answers for every
    //branch, protected or not, and a branch nothing protects may be pushed to.
    //../../../test/repositories/pr-revising.test.js pins that.
    async function readOnlyOn(branch) {
        return !(await mayRevise(branch));
    }

    //---- AN ARRIVED PULL REQUEST IS NOT A BRANCH HERE UNTIL IT IS BROUGHT -----
    //
    //`reading` is { repo, branch }: which repository carries the change and what
    //it is called there.
    async function whatItReads(reading) {
        var where = String((reading || {}).repo || '').trim();
        var what = String((reading || {}).branch || '').trim();

        if (!where || !what) {
            throw new Error('Reading takes both a repository and the branch in it that carries the change.');
        }

        var here = ((await repos()) || []).map(function (r) { return r.name || r; });
        if (here.indexOf(where) < 0) {
            throw new Error('There is no repository called "' + where + '" in this workspace.');
        }

        var at = await headIn(where, what);
        if (!at) {
            throw new Error('"' + where + '" has no branch called "' + what + '", so there is nothing on '
                + 'it to read. Bring the pull request here first — prFetch.');
        }

        return { repo: where, branch: what, head: at };
    }

    return { plan: plan, guestPath: guestPath };
};

module.exports.guestPath = guestPath;
