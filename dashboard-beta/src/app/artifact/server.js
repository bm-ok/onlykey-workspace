//---------------------------------------------------------------------------
//WHAT CAME BACK, READ THE WAY A PULL REQUEST IS READ.
//
//A task delivers a BRANCH, and this is the only place that says what is on it.
//Everything here is read from the repositories on this host — never from the
//machine, and never from the worker's account of itself. That is the whole
//point: a run says what it believes it did, and the branch says what actually
//arrived. Where those differ, the branch is right.
//
//---- why it is its own plugin ---------------------------------------------
//
//THREE THINGS ASK THIS QUESTION AND NONE OF THEM OWNS IT. The Worker shows what
//a task handed over; the Judge reads it before reaching a verdict; Repositories
//asks what a branch carries before landing or deleting it. Putting it inside any
//one of those would make the other two depend on that one — and a judge that
//has to consume the worker in order to read a branch is a judge wired to the
//thing it is judging.
//
//SO IT DEPENDS ON NOTHING THAT DEPENDS ON IT. It reads git, and it asks the
//branch plugin what a branch is measured against, because that is written down
//when a branch is cut and git stops being able to say afterwards. Nothing points
//back the other way: `branchArtifacts` lives HERE rather than in Repositories,
//which is what keeps the graph one-directional.
//
//---- and it never runs git itself -----------------------------------------
//
//The app this is ported from spawned git here, with its own `--git-dir` and its
//own timeout, and said in a comment that everything it did was a read. That was
//true, and it was still a second place that knew how to run git. Here there is
//one — ../git — and the read door is a list of subcommands it will accept. This
//asks it. What was a promise in a comment is a refusal in another file.
//---------------------------------------------------------------------------
plugin.consumes = ['app', 'log', 'git', 'workspace', 'lines'];
plugin.provides = ['artifact'];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log.on('git');
    var git = imports.git;
    var workspace = imports.workspace;
    var lines = imports.lines;

    //BOUNDED ON PURPOSE. This is a summary that a person reads and a window
    //draws, not an export — a task that touched two hundred files should say so
    //in one line rather than arriving as two hundred.
    var SHOW = 20;

    //=======================================================================
    //ONE REPOSITORY'S HALF OF THE ANSWER.
    //
    //`missing` AND `empty` ARE DIFFERENT AND BOTH ARE REPORTED, because they
    //mean different things about the work: nothing was ever pushed here, versus
    //the branch exists and carries nothing beyond its base. Reporting either as
    //"no changes" loses which one it was, and they call for different questions.
    //
    //AGAINST AN EXPLICIT BASE WHEN ONE IS GIVEN. The base is normally what the
    //branch was cut from, which is the right question for "what has this task
    //delivered" and the wrong one for "what would landing this do" — a merge is
    //read against the branch it would land ON, which is a different branch in
    //each repository and is chosen at the moment somebody asks.
    //=======================================================================
    async function inRepo(repo, branch, base) {
        if (!(await git.has(repo, branch))) {
            return { repo: repo, branch: branch, base: base || null, missing: true, commits: [], files: [], ahead: 0 };
        }

        base = base || await lines.baseOf(branch, repo);

        //A BASE THAT IS NOT THERE IS NOT THE SAME AS A BRANCH THAT IS NOT THERE,
        //and saying so is the difference between "nothing to land" and "there is
        //nowhere to land it".
        if (!base || !(await git.has(repo, base))) {
            return {
                repo: repo, branch: branch, base: base || null,
                missing: false, noBase: true, empty: true,
                ahead: 0, commits: [], more: 0, files: [], moreFiles: 0, added: 0, removed: 0
            };
        }

        //`base..branch` IS WHAT THIS BRANCH ADDS, which is the reviewer's
        //question — not what it DIFFERS from, which would also count anything
        //the base gained meanwhile and read as though the worker had reverted
        //it.
        var commits = [];
        try { commits = (await git.commits(repo, base, branch)) || []; } catch (e) { /* an unborn base, or an unrelated history: nothing added */ }

        var ahead = commits.length;
        try {
            var counted = await git.countBetween(repo, base, branch);
            if (counted != null) ahead = counted;
        } catch (e) { /* as above */ }

        var files = [];
        try { files = (await git.files(repo, base, branch)) || []; } catch (e) { /* as above */ }

        return {
            repo: repo,
            branch: branch,
            base: base,
            missing: false,
            empty: ahead === 0,
            ahead: ahead,
            commits: commits.slice(0, SHOW),
            more: Math.max(0, ahead - Math.min(commits.length, SHOW)),
            files: files.slice(0, SHOW),
            moreFiles: Math.max(0, files.length - SHOW),
            added: files.reduce(function (n, f) { return n + (f.added || 0); }, 0),
            removed: files.reduce(function (n, f) { return n + (f.removed || 0); }, 0)
        };
    }

    //=======================================================================
    //THE ARTIFACT, ACROSS EVERY REPOSITORY THE BRANCH COULD HAVE LANDED IN.
    //
    //DELIVERED MEANS SOMETHING ARRIVED. A worker that exited cleanly having
    //pushed nothing has produced nothing to judge, and that is the reading that
    //matters — the run's exit code says the program ended, not that work exists.
    //=======================================================================
    async function read(branch) {
        //ACROSS THE REPOSITORIES THE BRANCH IS ABOUT, which is what its line
        //says. See ../repositories/branches for why a scope outlives the line
        //that named it.
        var scope = await lines.scopeOf(branch);
        var parts = [];
        for (var i = 0; i < scope.repos.length; i++) {
            parts.push(await inRepo(scope.repos[i], branch));
        }

        var carrying = parts.filter(function (p) { return !p.missing && !p.empty; });
        var ahead = carrying.reduce(function (n, p) { return n + p.ahead; }, 0);

        return {
            branch: branch,
            delivered: carrying.length > 0,
            group: scope.group,
            gone: scope.gone,
            repos: parts,
            //The one-line version, which is what a list of tasks shows.
            summary: carrying.length
                ? ahead + ' commit(s) in ' + carrying.map(function (p) { return p.repo; }).join(', ')
                : 'nothing has arrived on this branch yet',
            commits: ahead,
            files: carrying.reduce(function (n, p) { return n + p.files.length + p.moreFiles; }, 0)
        };
    }

    //ONE FILE'S CHANGE, IN FULL, for when the summary is not enough. Still a
    //read, and still through the one door: `git diff` against the object
    //database, nothing checked out.
    async function diff(repo, branch, file, base) {
        base = base || await lines.baseOf(branch, repo);
        if (!base) throw new Error('Nothing says what "' + branch + '" is measured against in ' + repo + '.');
        return await git.diff(repo, base, branch, file);
    }

    //THE TWO SIDES OF ONE FILE, WHOLE, for a view that shows them next to each
    //other rather than as one stream of plus and minus.
    //
    //FROM THE MERGE BASE, so the left-hand side is what the branch STARTED from
    //rather than wherever the base has since moved to. It is the same reading as
    //the three-dot diff, made explicit because two reads of a file cannot
    //express it.
    //
    //A PATH THAT DOES NOT EXIST ON ONE SIDE IS NOT AN ERROR — that is what an
    //added or deleted file IS — so it comes back as null and the caller renders
    //an empty column.
    async function sides(repo, branch, file, base) {
        base = base || await lines.baseOf(branch, repo);
        if (!base) throw new Error('Nothing says what "' + branch + '" is measured against in ' + repo + '.');
        var from = base;
        try { from = (await git.mergeBase(repo, base, branch)) || base; } catch (e) { /* unrelated histories: the base itself */ }
        return {
            repo: repo, file: file, base: base, branch: branch, from: from,
            was: await git.fileAt(repo, from, file),
            now: await git.fileAt(repo, branch, file)
        };
    }

    async function relayed(name, args) {
        if (!actions) return null;
        try { return await actions.call(name, args || {}); }
        catch (e) { return null; }
    }

    var undo = [];
    if (actions) {
        //ONE REPOSITORY'S CHANGES, IN FULL — the diff itself rather than the
        //summary `branchArtifacts` carries.
        //
        //TWO QUESTIONS, NOT ONE. That action answers "what does this branch carry"
        //across the workspace: how far ahead each repository is, which files
        //moved, and by how much. This answers "show me", for one repository and
        //optionally one file, and a board that had to fetch every diff to draw a
        //list of filenames would be unusable.
        //
        //THE BASE IS NOT AN ARGUMENT. What a branch is measured against is its
        //line's business — see `diff` above, which asks ../repositories/lines —
        //and letting a caller pass one would be a second opinion about the thing
        //this app is most careful about: what a change is a change FROM.
        undo.push(actions.define('branchDiff', {
            about: "One repository's changes on a branch, in full, without a task",
            takes: ['branch', 'repo', 'file'],
            run: async function (args) {
                var a = args || {};
                var branch = String(a.branch || '').trim();
                var repo = String(a.repo || '').trim();

                //BOTH, BECAUSE ONE WITHOUT THE OTHER IS NOT A QUESTION. A branch
                //spans repositories and a repository holds many branches, so
                //either alone names a set rather than a thing.
                if (!branch || !repo) throw new Error('Which branch, in which repository?');
                if (!(await workspace.dir())) throw new Error('No workspace is open.');

                var file = a.file ? String(a.file) : null;
                return { branch: branch, repo: repo, file: file, diff: await diff(repo, branch, file) };
            }
        }));

        undo.push(actions.define('branchArtifacts', {
            about: 'Everything a branch carries: its commits, the files handed over, and the session',
            takes: ['branch'],
            run: async function (args) {
                var branch = String((args || {}).branch || '').trim();
                if (!branch) throw new Error('Which branch?');
                if (!(await workspace.dir())) throw new Error('No workspace is open.');

                var carried = await read(branch);

                //EVERY TASK THAT NAMED THIS BRANCH, AND WHAT EACH HANDED OVER.
                //The Worker has not moved yet, so this asks by name and the relay
                //finds it in the app being ported from. An empty list is the
                //honest answer when it cannot be reached — nothing here claims a
                //branch had no work done on it.
                var said = await relayed('tasks');
                var onIt = (((said && said.tasks) || []).filter(function (t) { return t.branch === branch; }));

                return {
                    branch: branch,
                    git: carried,
                    tasks: onIt.map(function (t) {
                        return {
                            task: t.id, number: t.number, title: t.title,
                            state: t.state, machine: t.machine || null,
                            files: t.files || []
                        };
                    }),
                    //SAID PLAINLY RATHER THAN LEFT OUT. A branch is where work
                    //lives and a session is how that work was reached, so it
                    //belongs here — and nothing captures one yet. An empty panel
                    //would read as "this branch has no session"; this says the
                    //tool does not keep them.
                    session: {
                        kept: false,
                        why: 'Nothing captures a worker session yet. The machine is rolled back when its work ends, '
                            + 'and the session goes with it — so resuming one, or reading how a branch was reached, '
                            + 'is not possible from here.'
                    }
                };
            }
        }));
    }

    await register(null, {
        artifact: {
            read: read,
            inRepo: inRepo,
            diff: diff,
            sides: sides,
            SHOW: SHOW
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
