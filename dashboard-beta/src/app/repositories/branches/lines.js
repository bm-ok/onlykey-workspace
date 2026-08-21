//---------------------------------------------------------------------------
//what a branch line IS, with no git in it and nothing to read.
//
//A LINE IS A CONCEPT AND WAS BEING TESTED AS A REPOSITORY. Every rule in this
//file is a statement about a record somebody wrote down and a table of where
//refs currently are — and all of it lived inside ./server.js, tangled with the
//calls that fetch that table. So the only way to ask "does refusing an unknown
//line name the known ones" was to build three git repositories with a bare
//origin each and push to them.
//
//IT COST FOUR SECONDS A TEST. ../../../../test/repositories/lines.test.js ran
//twenty-one of those, and was the whole two minutes of `npm test` on its own:
//thirty git processes per test to check sentences like "a default branch is
//protected too, and says so as a default".
//
//SO THE CONCEPT COMES OUT, and the shape is the one ../../queue already uses —
//policy.js, store.js and doors.js are plain modules taking what they need, which
//is why that whole group runs in eight hundred milliseconds.
//
//NOTHING HERE READS, WRITES, SPAWNS OR AWAITS. Everything arrives as an
//argument: the stored lines, which repositories are here, where each ref is.
//./server.js is what knows how to find those — now through ../refs, which reads
//each repository once for the whole group.
//---------------------------------------------------------------------------

//---- every line, with where its parts actually are ------------------------
//
//`tracked` RATHER THAN A BRANCH LIST, because a line has to stay in step ACROSS
//repositories and "in step with what" is the remote — so this wants the same
//answer the Repositories tab shows, from the same read.
//
//    stored    what somebody wrote down: { <line>: { on: {repo: branch}, why, made, marked } }
//    here      the repositories in the workspace right now, by name
//    tracked   { <repo>: { <branch>: { local, remote, state } } }, from ../refs
function board(stored, here, tracked) {
    if (stored === null || stored === undefined) return null;
    here = here || [];
    tracked = tracked || {};

    return Object.keys(stored).map(function (name) {
        var g = stored[name] || {};
        var on = g.on || {};

        var parts = Object.keys(on).map(function (repo) {
            var branch = on[repo];
            var track = (tracked[repo] || {})[branch] || null;
            return {
                repo: repo,
                branch: branch,
                there: !!track,
                //WHERE IT IS, not just that it exists. Null when the branch is
                //gone, which is the one case with no honest answer — and it
                //reads differently from a branch that is there and has never
                //moved.
                at: track ? track.local : null,
                remote: track ? track.remote : null,
                state: track ? track.state : null,
                stillHere: here.indexOf(repo) >= 0
            };
        });

        return {
            name: name,
            why: g.why || null,
            made: g.made || null,
            on: parts,
            //MISSING REPOSITORIES ARE NOT A FAULT: a line made when there were
            //three repositories still describes those three when a fourth
            //arrives.
            missing: here.filter(function (r) { return !(r in on); }),
            broken: parts.filter(function (p) { return p.stillHere && !p.there; })
                .map(function (p) { return p.branch + ' is gone from ' + p.repo; }),

            //WHERE THE LINE AS A WHOLE STANDS, which is the WORST of its parts
            //and never an average.
            //
            //  conflict  some part has moved on both sides. A fast-forward
            //            cannot help and somebody has to decide
            //  behind    some part can be caught up, and the button will
            //  ok        every part that origin also has matches it
            sync: parts.some(function (p) { return p.state === 'diverged'; }) ? 'conflict'
                : parts.some(function (p) { return p.state === 'behind' || p.state === 'different' || p.state === 'ahead'; }) ? 'behind'
                    : parts.some(function (p) { return p.state === 'same'; }) ? 'ok'
                        : null,
            behind: parts.filter(function (p) { return p.state && p.state !== 'same' && p.state !== 'only here'; }),
            //PROPOSED FOR LANDING: `{ at, by, why }`, or null.
            marked: g.marked || null
        };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
}

//=======================================================================
//THE POLICY GATE, WHICH ../../git DELIBERATELY DOES NOT HAVE.
//
//That plugin knows what git will accept. This knows what this app is FOR, and
//the rule is: work goes onto its own branch and is merged into a line
//afterwards, so nothing is built directly on a protected one.
//
//TWO WAYS TO BE PROTECTED, and a branch can be both:
//  · it is a repository's own DEFAULT, read from git
//  · it is a link in a LINE, which is a statement somebody made
//
//FAST-FORWARDING A PROTECTED BRANCH IS STILL ALLOWED, and that is not a hole.
//Protection is about building ON it; catching it up to origin is the opposite —
//it is how a line stays the thing everything else is measured against.
//=======================================================================
//
//    lines       what `board` above returned
//    baselines   [{ repo, on }] — what each repository counts from
function protectedIn(lines, baselines) {
    var out = {};

    function row(branch) {
        out[branch] = out[branch] || { branch: branch, asDefault: [], asLine: [] };
        return out[branch];
    }

    (lines || []).forEach(function (g) {
        (g.on || []).forEach(function (p) {
            var it = row(p.branch);
            if (it.asLine.indexOf(g.name) < 0) it.asLine.push(g.name);
        });
    });

    (baselines || []).forEach(function (r) {
        if (!r.on) return;
        row(r.on).asDefault.push(r.repo);
    });

    return out;
}

//THE SENTENCE, NOT A BOOLEAN. A refusal that says "that is protected" leaves
//somebody to work out WHY, and the why is the useful half — being a link in a
//line somebody named is a different situation from being a default branch, and
//they are undone in different places.
function whyProtected(branch, guarded) {
    var p = (guarded || {})[String(branch)];
    if (!p) return null;

    var parts = [];
    if (p.asDefault.length) parts.push('the default branch of ' + p.asDefault.join(', '));
    if (p.asLine.length) {
        parts.push('a link in ' + p.asLine.map(function (n) { return '"' + n + '"'; }).join(', '));
    }

    return '"' + branch + '" is ' + parts.join(' and ')
        + '. Work goes onto its own branch and is merged here afterwards, so nothing is built directly on it.';
}

module.exports = {
    board: board,
    protectedIn: protectedIn,
    whyProtected: whyProtected
};
