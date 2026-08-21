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

    //=======================================================================
    //THE POLICY GATE, WHICH ../../git DELIBERATELY DOES NOT HAVE.
    //
    //That plugin knows what git will accept. This one knows what this app is
    //FOR, and the rule is: work goes onto its own branch and is merged into a
    //line afterwards, so nothing is built directly on a protected one.
    //
    //TWO WAYS TO BE PROTECTED, and a branch can be both:
    //  · it is a repository's own DEFAULT, read from git
    //  · it is a link in a LINE, which is a statement somebody made
    //
    //FAST-FORWARDING A PROTECTED BRANCH IS STILL ALLOWED, and that is not a hole.
    //Protection is about building ON it; catching it up to origin is the
    //opposite — it is how a line stays the thing everything else is measured
    //against. The `⟳` on the Lines pane does exactly this, on purpose.
    //=======================================================================
    async function protectedOf() {
        var out = {};
        var all = await groups();
        (all || []).forEach(function (g) {
            (g.on || []).forEach(function (p) {
                out[p.branch] = out[p.branch] || { branch: p.branch, asDefault: [], asLine: [] };
                if (out[p.branch].asLine.indexOf(g.name) < 0) out[p.branch].asLine.push(g.name);
            });
        });

        var here = await baselines();
        here.forEach(function (r) {
            if (!r.on) return;
            out[r.on] = out[r.on] || { branch: r.on, asDefault: [], asLine: [] };
            out[r.on].asDefault.push(r.repo);
        });

        return out;
    }

    //THE SENTENCE, NOT A BOOLEAN. A refusal that says "that is protected" leaves
    //somebody to work out WHY, and the why is the useful half — being a link in
    //a line somebody named is a different situation from being a default branch,
    //and they are undone in different places.
    async function whyProtected(branch) {
        var p = (await protectedOf())[String(branch)];
        if (!p) return null;
        var parts = [];
        if (p.asDefault.length) parts.push('the default branch of ' + p.asDefault.join(', '));
        if (p.asLine.length) {
            parts.push('a link in ' + p.asLine.map(function (n) { return '"' + n + '"'; }).join(', '));
        }
        return '"' + branch + '" is ' + parts.join(' and ')
            + '. Work goes onto its own branch and is merged here afterwards, so nothing is built directly on it.';
    }

    //---- what was recorded when a branch was cut ---------------------------
    //
    //PER WORKSPACE, and kept because git stops being able to say. A branch that
    //has been merged into looks identical to one cut somewhere else, so what it
    //was cut FROM is only knowable if it was written down at the time.
    async function cuts() { return state.here.doc('cuts'); }

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

        //---- cutting a branch across the repositories a line touches --------
        //
        //A REASON IS REQUIRED, and so is a named starting point. Both refusals
        //are the same rule: a branch nobody can say the reason or the origin of
        //is a branch whose "3 commits ahead" means nothing in particular six
        //weeks later.
        //
        //FROM A LINE OR FROM A BRANCH, NEVER BOTH. They are two different
        //starting points and only one of them can be true — and a line names a
        //DIFFERENT branch in each repository, which is the whole reason cutting
        //from one is not the same as cutting from a branch name.
        undo.push(actions.define('branchCreate', {
            about: 'Cut a branch across every repository, from a named line or from another branch',
            takes: ['branch', 'reason', 'group', 'from'],
            run: async function (args) {
                var a = args || {};
                var name = String(a.branch || '').trim();
                if (!name) throw new Error('Say what the branch is called.');
                if (!String(a.reason || '').trim()) {
                    throw new Error('Say what "' + name + '" is for. A branch with no reason on it is one nobody can account for later.');
                }

                var guarded = await whyProtected(name);
                if (guarded) throw new Error(guarded);

                var line = a.group ? String(a.group).trim() : null;
                var from = a.from ? String(a.from).trim() : null;
                if (line && from) {
                    throw new Error('Say either which line "' + name + '" is cut from or which branch, not both — they are two different starting points and only one of them can be true.');
                }
                if (!line && !from) {
                    throw new Error('Say where "' + name + '" is cut from — a line, or a branch. A workspace with no named lines has not decided what work is measured against.');
                }
                if (from === name) throw new Error('"' + name + '" cannot be cut from itself.');

                //WHERE, AND FROM WHAT IN EACH. From a line this is per
                //repository; from a branch it is the same name everywhere it
                //exists.
                var where = [];
                if (line) {
                    var g = (await groups() || []).filter(function (x) { return x.name === line; })[0];
                    if (!g) throw new Error('There is no line called "' + line + '".');
                    g.on.forEach(function (p) {
                        if (p.stillHere && p.there) where.push({ repo: p.repo, from: p.branch });
                    });
                    if (!where.length) throw new Error('"' + line + '" names nothing that is still here, so there is nowhere to cut from.');
                } else {
                    var found = await workspace.repos();
                    for (var i = 0; i < found.length; i++) {
                        if (await git.has(found[i].name, from)) where.push({ repo: found[i].name, from: from });
                    }
                    if (!where.length) {
                        throw new Error('There is no branch called "' + from + '" in any repository here, so there is nowhere to cut "' + name + '" from.');
                    }
                }

                var made = [];
                for (var j = 0; j < where.length; j++) {
                    var w = where[j];
                    var said = await git.makeBranch(w.repo, name, w.from);
                    made.push({ repo: w.repo, branch: name, from: w.from, created: !!said.made, already: !!said.already, why: said.why || null });
                }

                //RECORDED ONCE, AND NOT OVERWRITTEN. Cutting the same name again
                //in a fourth repository must not rewrite why it was cut the
                //first time.
                var doc = await cuts();
                var notes = doc.read({}) || {};
                if (!notes[name]) {
                    var from2 = {};
                    made.filter(function (m) { return m.created; }).forEach(function (m) { from2[m.repo] = m.from; });
                    notes[name] = {
                        reason: String(a.reason).trim(),
                        by: actions.whoAsked(a),
                        made: new Date().toISOString(),
                        cutIn: made.filter(function (m) { return m.created; }).map(function (m) { return m.repo; }),
                        group: line,
                        cutFrom: from,
                        from: from2
                    };
                    doc.write(notes);
                }

                var n = made.filter(function (m) { return m.created; }).length;
                var stuck = made.filter(function (m) { return m.why; });
                log.good('cut ' + name + ' in ' + n + ' repositor' + (n === 1 ? 'y' : 'ies'));
                return {
                    branch: name, on: made, created: n,
                    note: n
                        ? 'Cut in ' + n + ' repositor' + (n === 1 ? 'y' : 'ies') + '.'
                            + (stuck.length ? ' ' + stuck.length + ' could not be: ' + stuck.map(function (m) { return m.repo + ' — ' + m.why; }).join('; ') : '')
                        : 'Nothing was cut — it was already there everywhere it would have gone.'
                };
            }
        }));

        //---- and removing one ----------------------------------------------
        //
        //REFUSED WHILE IT IS PROTECTED, which is the same rule as cutting onto
        //one. A line's branches stop being protected when the line is forgotten,
        //and the message for that is on `lineForget`.
        undo.push(actions.define('branchDelete', {
            about: 'Delete a branch from every repository that has it',
            takes: ['branch', 'force'],
            run: async function (args) {
                var a = args || {};
                var name = String(a.branch || '').trim();
                if (!name) throw new Error('There is no branch to delete.');

                var guarded = await whyProtected(name);
                if (guarded) throw new Error(guarded);

                var force = a.force === true || a.force === 'true' || a.force === 1 || a.force === '1';
                var found = await workspace.repos();
                var done = [];

                for (var i = 0; i < found.length; i++) {
                    var repo = found[i].name;
                    if (!(await git.has(repo, name))) continue;
                    var said = await git.removeBranch(repo, name, { force: force });
                    done.push({ repo: repo, removed: !!said.removed, unmerged: !!said.unmerged, why: said.why || null });
                }

                if (!done.length) throw new Error('No repository here has a branch called "' + name + '".');

                var gone = done.filter(function (d) { return d.removed; }).length;
                var kept = done.filter(function (d) { return !d.removed; });

                //THE NOTE GOES WHEN THE LAST COPY DOES, and not before. A branch
                //deleted from two of three repositories still exists, and why it
                //was cut is still the answer to a question somebody has.
                if (gone && !kept.length) {
                    var doc = await cuts();
                    var notes = doc.read({}) || {};
                    if (notes[name]) { delete notes[name]; doc.write(notes); }
                }

                log.warn('deleted ' + name + ' from ' + gone + ' repositor' + (gone === 1 ? 'y' : 'ies'));
                return {
                    branch: name, on: done, removed: gone,
                    //UNMERGED IS ITS OWN ANSWER, because the fix for it is a
                    //decision rather than a retry.
                    unmerged: kept.some(function (k) { return k.unmerged; }),
                    note: kept.length
                        ? gone + ' of ' + done.length + ' deleted. ' + kept.map(function (k) { return k.repo + ' — ' + k.why; }).join('; ')
                            + (kept.some(function (k) { return k.unmerged; }) ? ' Deleting it anyway needs `force`, and what it carries goes with it.' : '')
                        : 'Gone from ' + gone + ' repositor' + (gone === 1 ? 'y' : 'ies') + '.'
                };
            }
        }));

        //---- catching a line up to origin -----------------------------------
        //
        //ONE ACT ACROSS SEVERAL REPOSITORIES, which is the whole reason a line
        //has its own sync rather than three. It only ever fast-forwards: a part
        //that has moved on both sides is REPORTED and left alone, because a
        //fast-forward cannot help it and this is not the place that decides.
        undo.push(actions.define('lineSync', {
            about: 'Fetch from origin and fast-forward every branch a line names, as one act',
            takes: ['name'],
            run: async function (args) {
                var a = args || {};
                var want = String(a.name || '').trim();
                if (!want) throw new Error('Say which line.');

                var line = (await groups() || []).filter(function (g) { return g.name === want; })[0];
                if (!line) throw new Error('There is no line called "' + want + '".');

                var done = [];
                for (var i = 0; i < line.on.length; i++) {
                    var p = line.on[i];
                    if (!p.stillHere || !p.there) {
                        done.push({ repo: p.repo, branch: p.branch, moved: false, why: 'it is not here' });
                        continue;
                    }
                    await git.fetch(p.repo);
                    //ASKED AFTER THE FETCH, because what origin has is the thing
                    //that just changed.
                    if (!(await git.has(p.repo, 'refs/remotes/origin/' + p.branch))) {
                        done.push({ repo: p.repo, branch: p.branch, moved: false, why: 'origin has no branch by this name' });
                        continue;
                    }
                    var said = await git.fastForward(p.repo, p.branch, 'refs/remotes/origin/' + p.branch);
                    done.push({ repo: p.repo, branch: p.branch, moved: !!said.moved, already: !!said.already, why: said.why || null });
                }

                var moved = done.filter(function (d) { return d.moved; }).length;
                var stuck = done.filter(function (d) { return d.why; });
                return {
                    name: want, on: done, moved: moved, stuck: stuck.length,
                    note: moved
                        ? moved + ' of ' + done.length + ' moved.'
                            + (stuck.length ? ' ' + stuck.map(function (d) { return d.repo + ' — ' + d.why; }).join('; ') : '')
                        : stuck.length
                            ? 'Nothing moved. ' + stuck.map(function (d) { return d.repo + ' — ' + d.why; }).join('; ')
                            : 'Every branch this line names already matches origin.'
                };
            }
        }));

        //---- naming a line -------------------------------------------------
        //
        //TAKING THE CURRENT STATE AS THE DEFAULT IS DELIBERATE. A line is usually
        //something somebody has just finished arranging one repository at a time,
        //and asking them to type it all again is how the two drift apart.
        undo.push(actions.define('lineSave', {
            about: 'Name a line: one branch per repository, so work can be cut from that point',
            takes: ['name', 'why', 'on'],
            run: async function (args) {
                var a = args || {};
                var title = String(a.name || '').trim();
                if (!title) throw new Error('Give the line a name — it is what a task will be based on.');

                var on = a.on;
                if (typeof on === 'string') {
                    try { on = JSON.parse(on); } catch (e) { throw new Error('`on` is a name-to-branch object, or leave it out to take what each repository is on now.'); }
                }

                if (!on || !Object.keys(on).length) {
                    var here = await baselines();
                    on = {};
                    here.forEach(function (r) { if (r.on) on[r.repo] = r.on; });
                }
                if (!Object.keys(on).length) throw new Error('There are no repositories to name, so there is no line to make.');

                var doc = await kept();
                var all = doc.read({}) || {};
                var was = all[title] || {};

                all[title] = {
                    on: on,
                    why: a.why ? String(a.why).trim() : (was.why || null),
                    made: was.made || new Date().toISOString(),
                    //A LINE BEING REWRITTEN KEEPS WHAT IT WAS MARKED AS, because
                    //marking is a statement about the LINE and not about the
                    //particular branches in it today.
                    marked: was.marked || null
                };
                doc.write(all);

                log.good('line "' + title + '" — ' + Object.keys(on).map(function (r) { return r + ':' + on[r]; }).join(', '));
                var now = (await groups() || []).filter(function (g) { return g.name === title; })[0] || null;
                return Object.assign({ name: title }, now || {}, {
                    note: '"' + title + '" names ' + Object.keys(on).length + ' branch(es). Work cut from it is measured against it.'
                });
            }
        }));

        undo.push(actions.define('lineForget', {
            about: 'Forget a line. Its branches are untouched, and stop being protected by it',
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

                var was = all[title];
                delete all[title];
                doc.write(all);

                log.warn('line "' + title + '" forgotten — its branches are untouched');
                return {
                    forgotten: title,
                    was: was,
                    //THE BRANCHES ARE UNTOUCHED AND STOP BEING PROTECTED, and both
                    //halves matter. Somebody forgetting a line to tidy up has
                    //also just made its branches writable, and that is not
                    //obvious from the word "forget".
                    note: '"' + title + '" is gone. Its branches are untouched — and they stop being protected by it, so work can be done directly on them again.'
                };
            }
        }));

        //---- a line that is finished, and up to be landed -------------------
        //
        //MARKING IS THE DIFFERENCE BETWEEN "work happens here" AND "this is what
        //we are proposing". It changes nothing about the branches; it changes
        //which side of a comparison the line appears on.
        undo.push(actions.define('linePropose', {
            about: 'Propose a line for landing. It appears on the left of a comparison and stays protected',
            takes: ['name', 'why'],
            run: async function (args) {
                var a = args || {};
                var title = String(a.name || '').trim();
                if (!title) throw new Error('Say which line.');

                var doc = await kept();
                var all = doc.read({}) || {};
                if (!(title in all)) throw new Error('There is no line called "' + title + '".');

                //A LINE WITH A BRANCH MISSING FROM IT IS NOT A THING ANYBODY CAN
                //READ, and proposing one is proposing to land something that is
                //not all there. Refused with the missing part named.
                var now = (await groups() || []).filter(function (g) { return g.name === title; })[0] || null;
                if (now && now.broken.length) {
                    throw new Error('"' + title + '" cannot be proposed: ' + now.broken.join('; ')
                        + '. A line with a branch missing from it is not a thing anybody can read.');
                }

                all[title] = Object.assign({}, all[title], {
                    marked: {
                        at: new Date().toISOString(),
                        by: actions.whoAsked(a),
                        why: a.why ? String(a.why).trim() : null
                    }
                });
                doc.write(all);

                log.good('"' + title + '" is proposed for landing' + (a.why ? ' — ' + String(a.why).trim() : ''));
                var after = (await groups() || []).filter(function (g) { return g.name === title; })[0] || null;
                return Object.assign({ name: title }, after || {}, {
                    note: '"' + title + '" is up to be landed. Compare it against the line it would go into, and withdraw it to carry on working.'
                });
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
            protectedOf: protectedOf,
            whyProtected: whyProtected,
            baselines: baselines
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
