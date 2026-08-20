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
plugin.consumes = ['app', 'git', 'workspace'];
plugin.provides = [];
async function plugin(imports, register) {
    var git = imports.git;
    var workspace = imports.workspace;
    var actions = imports.app.host && imports.app.host.actions;

    //`actions` is absent when this half is built against a bare host — the test
    //suite does exactly that. See ../../core/okc/server.js.
    if (!actions) return register(null, {});

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

            var rows = [];
            for (var i = 0; i < where.length; i++) {
                var repo = where[i].name;
                var hasBase = await git.has(repo, refs.base);
                var hasHead = await git.has(repo, refs.head);

                if (!hasBase && !hasHead) {
                    rows.push({ repo: repo, has: 'neither', files: 0, commits: 0 });
                    continue;
                }
                if (!hasBase || !hasHead) {
                    rows.push({
                        repo: repo, has: hasHead ? 'only the head' : 'only the base',
                        missing: hasHead ? refs.base : refs.head, files: 0, commits: 0
                    });
                    continue;
                }

                var files = await git.files(repo, refs.base, refs.head);
                var commits = await git.commits(repo, refs.base, refs.head);
                rows.push({
                    repo: repo, has: 'both',
                    files: files.length,
                    commits: commits.length,
                    //THE SHAPE OF THE CHANGE, not just that there is one. A row
                    //saying "4 files" reads the same for a comment fix and a
                    //rewrite; the counts are what tell them apart at a glance.
                    added: files.reduce(function (n, f) { return n + (f.added || 0); }, 0),
                    removed: files.reduce(function (n, f) { return n + (f.removed || 0); }, 0),
                    names: files.map(function (f) { return f.file; })
                });
            }

            var carrying = rows.filter(function (r) { return r.has === 'both' && r.files > 0; });
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

    undo.push(actions.define('compareLog', {
        about: 'The commits one branch carries that another does not, in one repository',
        takes: ['base', 'head', 'repo'],
        run: async function (a) {
            var refs = twoRefs(a);
            return { repo: a.repo, base: refs.base, head: refs.head,
                commits: await git.commits(a.repo, refs.base, refs.head) };
        }
    }));

    undo.push(actions.define('compareDiff', {
        about: 'The diff between two branches in one repository. --file for one file',
        takes: ['base', 'head', 'repo', 'file'],
        run: async function (a) {
            var refs = twoRefs(a);
            return { repo: a.repo, base: refs.base, head: refs.head, file: a.file || null,
                diff: await git.diff(a.repo, refs.base, refs.head, a.file) };
        }
    }));

    await register(null, {
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
