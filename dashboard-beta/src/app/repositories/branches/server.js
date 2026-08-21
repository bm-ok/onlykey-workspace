//---------------------------------------------------------------------------
//A LINE: ONE BRANCH PER REPOSITORY, NAMED, SO IT CAN BE TALKED ABOUT AS ONE
//THING.
//
//This is the idea the whole app is arranged around, and it exists because the
//work does not fit in one repository. Three repositories each with a branch
//called `fix/the-thing` are three branches; a LINE is the statement that those
//three are one change, made once and then referred to by name.
//
//WHICH IS WHY ITS STATE IS THE WORST OF ITS PARTS, never an average. "Two of
//three are in step" is the one answer a line must never give: the entire point
//of naming one is that the three move together, so one part being behind IS the
//line being behind. That is not visible from any single repository, and it is
//the reason a line has its own sync rather than three.
//
//---- what is stored, and what is worked out --------------------------------
//
//STORED: the name, why it exists, when it was made, which branch in which
//repository, and whether it has been proposed for landing. That is all. It is a
//statement somebody made and nothing else belongs in it.
//
//WORKED OUT EVERY TIME: where each branch actually is, where origin has it,
//whether it still exists, and what the line as a whole therefore is. Storing any
//of that would be storing a claim about a repository that changes underneath it.
//
//IN THE WORKSPACE'S DRAWER, because a line names branches in the repositories of
//one folder. Open a different workspace and those names mean nothing.
//
//---- and it is read several times per draw ---------------------------------
//
//EACH REPOSITORY IS ASKED ONCE, not once per line that names it. The app being
//ported from asked git for a repository's branches inside the per-part loop, so
//three lines across three repositories was nine `for-each-ref` processes for
//three answers — and this is called several times over during one board read.
//A trace found 39% of the window's samples inside `spawn` with the window idle;
//fifteen of the eighteen processes one board read cost were this.
//---------------------------------------------------------------------------

plugin.consumes = ['app', 'log', 'git', 'workspace', 'state'];
plugin.provides = ['lines'];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log.on('git');
    var git = imports.git;
    var workspace = imports.workspace;
    var state = imports.state;

    async function kept() { return state.here.doc('lines'); }

    async function stored() {
        try { return (await kept()).read({}) || {}; }
        //NO WORKSPACE OPEN IS NOT AN EMPTY ONE — see ../repos/server.js.
        catch (e) { return null; }
    }

    //---- every line, with where its parts actually are ----------------------
    async function groups() {
        var all = await stored();
        if (all === null) return null;

        var found = await workspace.repos();
        var here = found.map(function (r) { return r.name; });

        //ONE READ PER REPOSITORY, REUSED ACROSS EVERY LINE THAT NAMES IT. See
        //the header for what this cost before.
        //
        //`tracked` RATHER THAN A BRANCH LIST, because a line has to stay in step
        //ACROSS repositories and "in step with what" is the remote — so this
        //needs the same answer the Repositories tab shows, from the same read.
        var seen = {};
        async function trackedIn(repo) {
            if (repo in seen) return seen[repo];
            var at = {};
            try { at = await git.tracked(repo); } catch (e) { at = {}; }
            seen[repo] = at;
            return at;
        }

        var names = Object.keys(all);
        var out = [];

        for (var i = 0; i < names.length; i++) {
            var name = names[i];
            var g = all[name] || {};
            var on = g.on || {};
            var repos = Object.keys(on);
            var parts = [];

            for (var j = 0; j < repos.length; j++) {
                var repo = repos[j];
                var branch = on[repo];
                var rows = await trackedIn(repo);
                var track = rows[branch] || null;

                parts.push({
                    repo: repo,
                    branch: branch,
                    there: !!track,
                    //WHERE IT IS, not just that it exists. Null when the branch
                    //is gone, which is the one case with no honest answer — and
                    //it reads differently from a branch that is there and has
                    //never moved.
                    at: track ? track.local : null,
                    remote: track ? track.remote : null,
                    state: track ? track.state : null,
                    stillHere: here.indexOf(repo) >= 0
                });
            }

            out.push({
                name: name,
                why: g.why || null,
                made: g.made || null,
                on: parts,
                //MISSING REPOSITORIES ARE NOT A FAULT: a line made when there
                //were three repositories still describes those three when a
                //fourth arrives.
                missing: here.filter(function (r) { return !(r in on); }),
                broken: parts.filter(function (p) { return p.stillHere && !p.there; })
                    .map(function (p) { return p.branch + ' is gone from ' + p.repo; }),

                //WHERE THE LINE AS A WHOLE STANDS, which is the WORST of its
                //parts — see the header for why this is never an average.
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
            });
        }

        return out.sort(function (a, b) { return a.name.localeCompare(b.name); });
    }

    //WHAT EACH REPOSITORY COUNTS FROM, which is what a new line defaults to.
    async function baselines() {
        var found = await workspace.repos();
        var out = [];
        for (var i = 0; i < found.length; i++) {
            var name = found[i].name;
            var def = null;
            try { def = await git.head(name); } catch (e) { /* said as null */ }
            var all = [];
            try { all = await git.branches(name); } catch (e) { /* said as empty */ }
            out.push({ repo: name, on: def, branches: all });
        }
        return out;
    }

    var undo = [];
    if (actions) {
        undo.push(actions.define('lines', {
            about: 'Every named line: one branch per repository, and what work is cut from',
            run: async function () {
                var all = await groups();
                if (all === null) {
                    return { lines: [], groups: [], repos: [], note: 'No workspace is open, so there are no lines.' };
                }
                var stuck = all.filter(function (g) { return g.sync === 'conflict'; });
                return {
                    //`lines` AND `groups` ARE THE SAME ARRAY, under both names.
                    //The app being ported from calls them groups and every pane
                    //here calls them lines; returning one and renaming later
                    //would mean a flag day across five panes for a word.
                    lines: all,
                    groups: all,
                    repos: await baselines(),
                    note: !all.length
                        ? 'No lines yet. A line names one branch per repository so a change can be talked about as one thing.'
                        : stuck.length
                            ? stuck.length + ' of ' + all.length + ' have a part that moved on both sides — see Conflicts.'
                            : all.length + ' line' + (all.length === 1 ? '' : 's') + '.'
                };
            }
        }));

        undo.push(actions.define('lineWithdraw', {
            about: 'Take a line back out of being proposed, so work on it can continue',
            takes: ['name'],
            run: async function (args) {
                var a = args || {};
                var title = String(a.name || '').trim();
                if (!title) throw new Error('Say which line.');

                var doc = await kept();
                var all = doc.read({}) || {};
                if (!(title in all)) {
                    var have = Object.keys(all);
                    throw new Error('There is no line called "' + title + '".'
                        + (have.length ? ' There is: ' + have.join(', ') + '.' : ' There are none.'));
                }

                all[title] = Object.assign({}, all[title], { marked: null });
                doc.write(all);

                log.warn('"' + title + '" is no longer proposed');
                var now = (await groups() || []).filter(function (g) { return g.name === title; })[0] || null;
                return Object.assign({ name: title }, now || {}, {
                    //ITS BRANCHES STAY PROTECTED, and saying so is the point of
                    //this sentence: withdrawing a proposal is not un-protecting
                    //the work, and somebody who wanted the second thing has to
                    //be told they have not got it.
                    note: '"' + title + '" is a line again rather than a proposal. Its branches stay protected while it is a line at all — forget the line to build on them directly.'
                });
            }
        }));
    }

    await register(null, {
        lines: {
            all: groups,
            baselines: baselines
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
