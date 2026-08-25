//---------------------------------------------------------------------------
//comparing two branches across the whole workspace — the Changes pane's half.
//
//WHAT THIS ADDS OVER ../../git, WHICH IS THE REASON IT EXISTS. That plugin
//answers about ONE repository: the files, the commits, the diff. This answers
//the question the pane is actually asking, which is about the workspace: WHERE
//does this change live, and where does it not. A branch cut across three
//repositories usually only carries something in one of them, and "the other two
//have nothing" is an answer rather than an absence.
//
//A REPOSITORY HAS FOUR ANSWERS AND THEY ARE NOT THE SAME NEWS:
//
//    it has neither side          not part of this comparison at all
//    it has one side              the branch was never cut here
//    it has both, and nothing     cut here, carrying nothing yet
//    it has both, and something   this is where the change is
//
//Folding those together is how a repository that was never cut reads as a
//finished change, which is the mistake the old pane names in its own code.
//
//THE PANE ASKS HERE AND NOT ../../git. `gitDiff` and the rest are the general
//git surface and anything may use them; these are what THIS pane means by a
//comparison, in the vocabulary of the pane. When the pane learns to compare
//something that is not two branches, this is the file that changes.
//
//NOTHING HERE WRITES. Reading a comparison cannot alter a repository, and the
//plugin underneath refuses to write at all — see ../../git/server.js, where that
//is a door rather than a rule.
//---------------------------------------------------------------------------

//THREE PLUGINS, EACH ASKED FOR WHAT IT OWNS. ../../workspace says which folders
//are repositories, ../../git runs the commands, and this decides what a
//comparison MEANS across them. None of the three reaches into another's job, so
//the day any one of them changes it changes alone.
plugin.consumes = ['app', 'log', 'git', 'workspace', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    var git = imports.git;
    var workspace = imports.workspace;
    var okc = imports.okc;
    var log = imports.log.on('git');
    var actions = imports.app.host && imports.app.host.actions;

    //`actions` is absent when this half is built against a bare host — the test
    //suite does exactly that. See ../../core/okc/server.js.
    if (!actions) return register(null, {});

    //ONE NAME MEANS TWO DIFFERENT THINGS AND BOTH ARE ORDINARY.
    //
    //A BRANCH is itself, in whatever repository has it. A LINE is a name for a
    //set of branches that are not all called the same thing — "csvstat lockfile
    //ignore" is `fix/csvstat-lockfile-ignore` in one repository and may be
    //something else in the next. So a name resolves to a FUNCTION from repository
    //to ref rather than to a string.
    //
    //RESOLVED HERE SO THE PANE HAS ONE PATH. The alternative was the pane
    //choosing between two actions depending on what somebody picked, which is a
    //branch in the code for a difference the reader does not have.
    //
    //LINES CAME FROM THE RELAY, and that sentence outlived the thing it
    //described. `okc.call` is the pipe to the app being ported from and NOTHING
    //ELSE — it rejects with "the dashboard is not listening" when that app is not
    //running — while `lines` has since become an action of this one. So this
    //asked a dead pipe, the catch below turned the rejection into an empty list,
    //and every line name fell through to being treated as a branch.
    //
    //WHAT THAT COST: comparing anything against a line answered "Nothing to land
    //— no repository carries anything", about a branch carrying a commit. Not an
    //error, not an empty pane: a confident wrong answer, which is the shape of
    //failure this app is arranged against. Found by a drill that made a commit
    //and then could not see it.
    //
    //`actions.call` IS THE ONE TO ASK. It tries this app's own table first and
    //falls through to the pipe for anything not moved yet — so this keeps working
    //either way round, which is the whole point of that order.
    //
    //A name that is not a line is a branch — deliberately in that order, since a
    //line named after a branch is somebody meaning the line.
    async function lines() {
        try {
            var said = await actions.call('lines', {});
            return (said && said.groups) || [];
        } catch (e) {
            //SAID, NOT SWALLOWED. Returning an empty list is the right fallback —
            //branch-to-branch comparison still works without any lines — but it
            //makes every line name silently wrong, so it cannot also be silent.
            log.warn('the lines could not be read, so a comparison naming one will be about a branch of that name: ' + e.message);
            return [];
        }
    }

    function refIn(name, groups) {
        var line = groups.filter(function (g) { return g.name === name; })[0];
        if (!line) return function () { return name; };

        var per = {};
        (line.on || []).forEach(function (p) {
            //A BRANCH THAT IS NO LONGER THERE IS NOT A REF. The line still names
            //it; the repository does not have it, and comparing against a name
            //that is gone is an error about spelling rather than about the line.
            if (p.stillHere !== false) per[p.repo] = p.branch;
        });
        return function (repo) { return per[repo] || null; };
    }

    function twoRefs(a) {
        var base = String((a && a.base) || '').trim();
        var head = String((a && a.head) || '').trim();
        if (!base || !head) throw new Error('Two branches: --base what it would go into, --head what carries the change.');
        //THE SAME BRANCH ON BOTH SIDES IS NOT A COMPARISON, and git would answer
        //"nothing" — which reads as "this branch is empty" rather than "these are
        //the same thing". Said here so it cannot be read as the first.
        if (base === head) throw new Error('"' + base + '" cannot be compared with itself.');
        return { base: base, head: head };
    }

    var undo = [];

    undo.push(actions.define('compare', {
        about: 'What one branch carries that another does not, across every repository in the workspace',
        takes: ['base', 'head'],
        run: async function (a) {
            var refs = twoRefs(a);
            var where = await workspace.repos();
            var groups = await lines();
            var baseIn = refIn(refs.base, groups);
            var headIn = refIn(refs.head, groups);

            var rows = [];
            for (var i = 0; i < where.length; i++) {
                var repo = where[i].name;
                var b = baseIn(repo);
                var h = headIn(repo);

                //A LINE THAT DOES NOT REACH THIS REPOSITORY is not a missing
                //branch — it is a line that was cut across two of three, which
                //is the ordinary case and an answer rather than a fault.
                var hasBase = b ? await git.has(repo, b) : false;
                var hasHead = h ? await git.has(repo, h) : false;

                //EVERY ROW SAYS WHAT IT LOOKED FOR, whether or not it found it.
                //A line resolves to a different branch in each repository, so
                //"only the head" without naming the ref leaves somebody unable to
                //tell a line that was never cut here from a branch that is simply
                //spelt differently. `null` means the name does not reach this
                //repository at all, which is a third thing again.
                if (!hasBase && !hasHead) {
                    rows.push({ repo: repo, has: 'neither', base: b, head: h, files: [], commits: [] });
                    continue;
                }
                if (!hasBase || !hasHead) {
                    rows.push({
                        repo: repo, has: hasHead ? 'only the head' : 'only the base',
                        base: b, head: h,
                        missing: hasHead ? (b || refs.base) : (h || refs.head),
                        files: [], commits: []
                    });
                    continue;
                }

                var files = await git.files(repo, b, h);
                var commits = await git.commits(repo, b, h);
                rows.push({
                    repo: repo, has: 'both',
                    //WHICH BRANCH THIS REPOSITORY'S HALF ACTUALLY IS. For a
                    //branch it is the name again; for a line it is the only way
                    //to know what was compared, and it is the question a reader
                    //has to answer before anything else on the row means
                    //anything.
                    base: b, head: h,
                    //THE FILES AND THE COMMITS THEMSELVES, not counts. The pane
                    //draws both, and counts would mean a second call per
                    //repository to fetch what this already had in its hand — the
                    //shape the old `changeRead` returns, for the same reason.
                    files: files,
                    commits: commits,
                    //THE SHAPE OF THE CHANGE, not just that there is one. A row
                    //saying "4 files" reads the same for a comment fix and a
                    //rewrite; these are what tell them apart at a glance.
                    added: files.reduce(function (n, f) { return n + (f.added || 0); }, 0),
                    removed: files.reduce(function (n, f) { return n + (f.removed || 0); }, 0)
                });
            }

            var carrying = rows.filter(function (r) { return r.has === 'both' && r.files.length > 0; });
            return {
                base: refs.base,
                head: refs.head,
                repos: rows,
                carrying: carrying.map(function (r) { return r.repo; }),
                anything: carrying.length > 0,
                note: carrying.length
                    ? null
                    : 'Nothing to land — no repository carries anything on "' + refs.head
                        + '" that "' + refs.base + '" does not already have.'
            };
        }
    }));

    //WHAT THERE IS TO COMPARE, in one call, so the pane does not have to know
    //that lines come from one place and branches from another.
    //
    //LINES FIRST, BECAUSE A LINE IS THE THING SOMEBODY LANDS. A branch is where
    //work happens; a line is a change that has been named and is going somewhere,
    //and the pane opens on one when there is one.
    undo.push(actions.define('compareRefs', {
        about: 'What can be compared: the named lines, and every branch in the workspace',
        run: async function () {
            var where = await workspace.repos();
            var groups = await lines();

            var seen = {};
            for (var i = 0; i < where.length; i++) {
                var names = await git.branches(where[i].name);
                names.forEach(function (n) {
                    if (!seen[n]) seen[n] = [];
                    seen[n].push(where[i].name);
                });
            }

            return {
                //A LINE CARRIES WHICH REPOSITORIES IT REACHES, because a line
                //across two of three repositories is the ordinary case and the
                //pane says so before anything is compared.
                lines: groups.map(function (g) {
                    return {
                        name: g.name,
                        //CARRIED THROUGH AS IT IS, not flattened to a flag. A
                        //proposal is somebody waiting on a read, and the pane
                        //says who and why — which a boolean cannot.
                        marked: g.marked || null,
                        broken: (g.broken || []).length > 0,
                        repos: (g.on || []).filter(function (p) { return p.stillHere !== false; })
                            .map(function (p) { return p.repo; })
                    };
                }),
                branches: Object.keys(seen).sort().map(function (n) {
                    return { name: n, repos: seen[n] };
                })
            };
        }
    }));

    undo.push(actions.define('compareLog', {
        about: 'The commits one branch carries that another does not, in one repository',
        takes: ['base', 'head', 'repo'],
        run: async function (a) {
            var refs = twoRefs(a);
            var groups = await lines();
            var b = refIn(refs.base, groups)(a.repo);
            var h = refIn(refs.head, groups)(a.repo);
            if (!b || !h) throw new Error('"' + (b ? refs.head : refs.base) + '" does not reach ' + a.repo + '.');
            return { repo: a.repo, base: b, head: h, of: refs,
                commits: await git.commits(a.repo, b, h) };
        }
    }));

    //THERE WAS A `compareFile` HERE — one file, both sides, whole. It was built
    //for a side-by-side made of two editors, and that turned out to be the wrong
    //shape: the alignment has to come from the diff, so the pane draws both
    //readings from `compareDiff` and never asked for it again.
    //
    //Removed rather than left as a thing the command line could still call. An
    //action nothing uses is a promise about a shape nobody is checking, and the
    //first time somebody built on it they would find out whether it still worked
    //by being the one to break it. ../../git keeps `fileAt` — reading a file at a
    //ref is general git logic and the next thing that needs it should ask there.
    undo.push(actions.define('compareDiff', {
        about: 'The diff between two branches in one repository. --file for one file',
        takes: ['base', 'head', 'repo', 'file'],
        run: async function (a) {
            var refs = twoRefs(a);
            var groups = await lines();
            var b = refIn(refs.base, groups)(a.repo);
            var h = refIn(refs.head, groups)(a.repo);
            if (!b || !h) throw new Error('"' + (b ? refs.head : refs.base) + '" does not reach ' + a.repo + '.');
            return { repo: a.repo, base: b, head: h, of: refs, file: a.file || null,
                diff: await git.diff(a.repo, b, h, a.file) };
        }
    }));

    await register(null, {
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
