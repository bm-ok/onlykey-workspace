//---------------------------------------------------------------------------
//EVERY BRANCH THAT HAS MOVED ON BOTH SIDES, AND WHICH FILES WOULD ACTUALLY
//CONFLICT.
//
//THE SECOND HALF IS THE WHOLE POINT. "Diverged" is cheap to compute and almost
//useless on its own: most diverged branches merge perfectly, because the two
//sides touched different files. A panel that lists every diverged branch as a
//problem is a panel somebody stops reading by the end of the first week — and
//then misses the one that matters.
//
//So each one is ASKED: would these two actually conflict, and where. That is
//`git merge-tree --write-tree` through ../../git, which answers without merging
//anything. See the `merge-tree` entry in that plugin's READS for why a flag
//with `write` in its name is allowed on a plugin that refuses to write.
//
//THREE ANSWERS, NOT TWO. Clean, conflicted, and COULD NOT TELL — an unrelated
//history, a missing object, a ref that will not resolve. The third must not read
//as the first: a pane that paints "no conflicts" over an unanswerable question
//is worse than one that says it does not know.
//
//---- and why it names the lines --------------------------------------------
//
//A conflict is reported against a repository, and what somebody is usually
//trying to do is move a LINE — the named thing spanning several of them. So each
//row carries the lines that name it, and a stuck line reads as "this line is
//stuck" rather than as one repository's problem.
//
//`lines` HAS NOT BEEN PORTED YET, so that annotation comes down the relay. It is
//asked for by name through the action table rather than consumed as a service —
//a lookup resolves at call time, so this works whether or not that half exists,
//and the rows are simply un-annotated when it does not. When `lines` moves here
//nothing about this file changes.
//---------------------------------------------------------------------------

plugin.consumes = ['app', 'log', 'git', 'workspace', 'refs'];
plugin.provides = [];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var git = imports.git;
    var workspace = imports.workspace;

    //REFS FOR READING, git FOR THE REST. ../refs reads each repository once for
    //the whole group and knows when to stop believing it; asking git.tracked
    //here directly is a second read of the same thing on this pane's own timer.
    //`wouldConflict` stays on git — it is not a ref read.
    var refs = imports.refs;

    //WHICH LINES NAME THIS BRANCH. Empty when nothing can answer, which is a
    //true answer and not a failure — see the header.
    async function linesFor() {
        if (!actions) return [];
        try {
            var said = await actions.call('lines', {});
            return (said && said.lines) || (said && said.groups) || [];
        } catch (e) { return []; }
    }

    async function gather() {
        var found = await workspace.repos();
        var groups = await linesFor();
        var out = [];

        for (var i = 0; i < found.length; i++) {
            var repo = found[i].name;
            var rows;
            try { rows = await refs.of(repo); }
            catch (e) { continue; }

            var names = Object.keys(rows);
            for (var j = 0; j < names.length; j++) {
                var b = rows[names[j]];
                //ONLY THE ONES THAT HAVE MOVED ON BOTH SIDES. Everything else is
                //a fast-forward in one direction or the other, and the Repos
                //pane already has a button for it.
                if (b.state !== 'diverged') continue;

                //THROUGH ../refs, which already holds both shas from the read
                //above — so the key costs nothing and `merge-tree` runs once per
                //pair of commits rather than once every fifteen seconds.
                var would = await refs.wouldConflict(repo, b.branch, 'refs/remotes/origin/' + b.branch);
                out.push({
                    repo: repo,
                    branch: b.branch,
                    local: b.local,
                    remote: b.remote,
                    ahead: b.ahead,
                    behind: b.behind,
                    lines: groups.filter(function (g) {
                        return (g.on || []).some(function (p) { return p.repo === repo && p.branch === b.branch; });
                    }).map(function (g) { return g.name; }),
                    files: would.files,
                    clean: would.clean,
                    why: would.why
                });
            }
        }
        return out;
    }

    var undo = [];
    if (actions) {
        undo.push(actions.define('conflicts', {
            about: 'Every branch that has moved on both sides, and which files would actually conflict',
            run: async function () {
                var all = await gather();
                //`clean === false` IS THE ONLY THING THAT IS A CONFLICT. `null`
                //is "could not tell" and is counted separately rather than
                //folded into either side.
                var real = all.filter(function (c) { return c.clean === false; });
                var unknown = all.filter(function (c) { return c.clean === null; });

                return {
                    conflicts: real,
                    //THE CLEAN ONES ARE RETURNED TOO, because "twelve diverged
                    //and eleven of them merge fine" is the reassuring half of
                    //the answer and it is the half that stops the list being
                    //read as twelve problems.
                    diverged: all,
                    unknown: unknown,
                    note: !all.length
                        ? 'Nothing has moved on both sides.'
                        : real.length
                            ? real.length + ' of ' + all.length + ' diverged branch' + (all.length === 1 ? '' : 'es')
                                + ' would actually conflict.'
                            : 'All ' + all.length + ' diverged branch' + (all.length === 1 ? '' : 'es')
                                + ' would merge cleanly — they have moved on both sides without touching the same files.'
                };
            }
        }));
    }

    await register(null, {
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
