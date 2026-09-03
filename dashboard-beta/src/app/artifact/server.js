//---------------------------------------------------------------------------
//WHAT WORK PRODUCED. TWO HALVES, AND THEY ANSWER ONE QUESTION.
//
//    the branch      what a task DELIVERED: commits, and the diff against what
//                    the branch was cut from. Read from the repositories on this
//                    host — never from the machine, never from the worker's
//                    account of itself. A run says what it believes it did and
//                    the branch says what arrived; where those differ the branch
//                    is right.
//    the drawer      what a run HANDED BACK: a file it produced and gave to this
//                    host over the guest door. A built binary, a screenshot, a
//                    log. For a judgement it is the whole deliverable, because a
//                    judge may not push.
//
//BOTH ARE "WHAT DID THIS WORK PRODUCE", asked of the two places an answer can
//be. A task usually has both and either may be empty; a judgement has only the
//second.
//
//---- the drawer had no owner, and that is why it is here -------------------
//
//`archive.store('artifacts')` WAS OPENED FOUR TIMES, DIRECTLY — by the door that
//writes into it, by ../judge, and twice by ../queue, once of those under a
//different name. ../core/archive owns where the bytes live; nothing owned what a
//handed-back file IS. So the card, the dialog and the reading were about to be
//written a second time for the Worker, which is the fault the paragraph below
//was already written about.
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
//THE SAME SENTENCE DECIDED WHERE THE DRAWER WENT. ../core/archive consumes only
//`state`, ../queue already consumes this, and nothing this takes consumes it
//back — so owning the drawer here costs the graph nothing and stops ../judge
//having to reach into a store ../queue also opens.
//
//---- one drawer per LANE, and the lane is in the path ----------------------
//
//    artifacts/worker/<uid>/     what a task handed back
//    artifacts/judge/<uid>/      what a judgement handed back
//    artifacts/job/<run>/        a run belonging to no work item
//
//`worker` AND `judge` RATHER THAN `task` AND `judgement`, because that is the
//vocabulary ../worker/sessions/keying.js already uses for the same split. Two
//words for one distinction is how the two come to disagree.
//
//WHICH DRAWER ANSWERED IS THE LANE, so `everything()` below does not read a
//sidecar to find out what a row is. That was the alternative and it is worse: a
//sidecar can be missing, and a missing one would have to mean something.
//
//`job/` IS NOT `diy/`. `whatIsOn` answers null unless a machine was GIVEN queued
//work, so a job run on a machine holding nothing files under its own run id.
//DIY is not a producer today and would land here without anything being added if
//it became one — the lane is about what the run WAS, not who started it.
//
//---- and it never runs git itself -----------------------------------------
//
//The app this is ported from spawned git here, with its own `--git-dir` and its
//own timeout, and said in a comment that everything it did was a read. That was
//true, and it was still a second place that knew how to run git. Here there is
//one — ../git — and the read door is a list of subcommands it will accept. This
//asks it. What was a promise in a comment is a refusal in another file.
//---------------------------------------------------------------------------
plugin.consumes = ['app', 'log', 'git', 'workspace', 'lines', 'archive'];
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
    //WHAT A RUN HANDED BACK.
    //=======================================================================
    //
    //ONE DRAWER PER LANE. See the header for why the lane is in the path rather
    //than only in a sidecar.
    //
    //`LANES` IS A MAP AND NOT A LIST, because every caller arrives holding the
    //word the rest of the app uses. ../runners/handback knows `doing.kind`,
    //which is `task` or `judgement`; the panes and the actions think in `worker`
    //and `judge`. Translating in one place is what stops a fifth spelling
    //appearing the next time somebody adds a caller.
    var LANES = {
        worker: imports.archive.store('artifacts/worker'),
        judge: imports.archive.store('artifacts/judge'),
        job: imports.archive.store('artifacts/job')
    };

    //THE TWO VOCABULARIES, JOINED HERE AND NOWHERE ELSE.
    function laneFor(what) {
        var said = String(what == null ? '' : what).toLowerCase();
        if (said === 'judge' || said === 'judgement') return 'judge';
        if (said === 'worker' || said === 'task') return 'worker';
        if (said === 'job') return 'job';
        return null;
    }

    //A LANE THAT IS NOT ONE IS REFUSED, NOT GUESSED. Filing a delivery in the
    //wrong drawer is worse than failing to file it: the file is then somewhere
    //nobody looks, and the drawer it landed in claims a kind of work it did not
    //come from. Every caller knows its own lane, so there is nothing to infer.
    function drawerFor(what) {
        var lane = laneFor(what);
        if (!lane) {
            throw new Error('"' + what + '" is not a lane. What a run hands back is filed under worker, '
                + 'judge or job, and which it is comes from the work rather than from the file.');
        }
        return LANES[lane];
    }

    //ASKED FOR A LANE ONCE, AND THEN USED AS A STORE.
    //
    //`handedBack('judge')` HANDS BACK THE DRAWER ITSELF, so every call after that
    //is `list(uid)`, `read(uid, file)` — exactly what these callers were already
    //written against when each opened its own. Threading a lane through every
    //call site instead would have been forty edits to say one thing, and forty
    //places for the next person to say it differently.
    //
    //THE LANE IS NAMED AT THE TOP OF THE FILE THAT USES IT, which is where
    //somebody reading ../judge or ../queue wants to see it.
    function handedBack(what) {
        var drawer = drawerFor(what);

        //---- AND THE NAME SOMEBODY WOULD ACTUALLY TYPE ---------------------
        //
        //A file is kept as `<run>--<name>`, so two runs of one piece of work
        //cannot overwrite each other. That prefix is this app's bookkeeping;
        //asking for "CLAIM.md" is what anybody reading the contract would do,
        //and what every list in this app SHOWS.
        //
        //IT LIVED IN ../judge AND NOWHERE ELSE, which is how `taskFileRead`
        //came to refuse a name `taskFiles` had just printed. The judge's own
        //note says a supervisor was "refused for naming the file the job was
        //told to write"; the task door had the same fault and no such note.
        //
        //HERE BECAUSE THE DRAWER IS HERE. Both readers want one answer to "which
        //file is that", and the second copy was about to be written rather than
        //shared.
        //
        //ONLY WHERE IT IS UNAMBIGUOUS. If two runs both handed back a CLAIM.md
        //the short name names two things, and refusing is right — it lists them
        //and asks which, rather than picking the newer and being quietly wrong
        //about which reading is being read. An EXACT match always wins, so a
        //caller holding the on-disk name is never sent through the guessing.
        drawer.find = async function (uid, want) {
            var asked = String(want == null ? '' : want);
            var handed = await drawer.list(uid);

            var exact = handed.filter(function (f) { return f.file === asked; })[0];
            if (exact) return { one: exact, handed: handed, many: null };

            var ends = handed.filter(function (f) {
                return String(f.file).indexOf('--' + asked) === String(f.file).length - asked.length - 2;
            });
            if (ends.length === 1) return { one: ends[0], handed: handed, many: null };
            if (ends.length > 1) return { one: null, handed: handed, many: ends };

            return { one: null, handed: handed, many: null };
        };

        return drawer;
    }

    //---- AND EVERYTHING, ACROSS THE LANES ---------------------------------
    //
    //EACH ROW SAYS WHICH DRAWER ANSWERED. That is the lane, known from where the
    //row was found rather than from a sidecar — which can be missing, and a
    //missing one would then have to mean something.
    //
    //ONE LANE WHEN ASKED FOR ONE, because `taskFiles` with no id wants every
    //task's and not every judgement's. A bound drawer answers its own
    //`everything()` for that; this is the form that spans them.
    handedBack.everything = async function (what) {
        var want = what == null ? null : laneFor(what);
        if (what != null && !want) return [];

        var lanes = want ? [want] : Object.keys(LANES);
        var out = [];

        for (var i = 0; i < lanes.length; i++) {
            var rows = await LANES[lanes[i]].everything();
            for (var n = 0; n < rows.length; n++) {
                out.push(Object.assign({}, rows[n], { lane: lanes[i] }));
            }
        }

        //NEWEST FIRST ACROSS ALL OF THEM, since each drawer sorted only its own
        //and a caller asking for everything wants one list.
        return out.sort(function (a, b) {
            return String(b.last || '').localeCompare(String(a.last || ''));
        });
    };

    //THE LANES THERE ARE, for anything that has to show all of them without
    //knowing the words in advance.
    handedBack.lanes = function () { return Object.keys(LANES); };

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
                //ASKED BY NAME rather than through a service, and an empty list
                //is the honest answer when it cannot be read — nothing here
                //claims a branch had no work done on it.
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
            //---- what a branch carries ------------------------------------
            read: read,
            inRepo: inRepo,
            diff: diff,
            sides: sides,
            SHOW: SHOW,

            //---- and what a run handed back --------------------------------
            handedBack: handedBack
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
