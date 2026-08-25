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

var LINES = require('./lines');

plugin.consumes = ['app', 'log', 'git', 'workspace', 'state', 'refs', 'inbox'];
plugin.provides = ['lines'];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log.on('git');
    var git = imports.git;
    var workspace = imports.workspace;
    var state = imports.state;

    //---- REFS FOR READING, git FOR WRITING AND FOR RESOLVING ---------------
    //
    //../refs reads each repository once for the whole group and knows when to
    //stop believing it. Everything here that asked git.tracked, git.head or
    //git.branches was a second read of the same thing on this pane's own timer.
    //
    //`git.has` IS NOT REPLACED WHOLESALE, and that is the careful part. It
    //resolves ANY ref -- a sha, a tag, HEAD~3 -- and refs cannot answer that
    //from a list of branches. The dangerous half is the NEGATIVE: a tag is a
    //real ref and is not in that list, so a derived "no" would refuse something
    //that is really there. Where the question is genuinely about a BRANCH,
    //refs.hasBranch and refs.hasRemote say so by name; where it is about a
    //start point somebody typed, it stays on git.
    var refs = imports.refs;

    async function kept() { return state.here.doc('lines'); }

    async function stored() {
        try { return (await kept()).read({}) || {}; }
        //NO WORKSPACE OPEN IS NOT AN EMPTY ONE — see ../repos/server.js.
        catch (e) { return null; }
    }

    //---- every line, with where its parts actually are ----------------------
    //
    //WHAT A LINE IS LIVES IN ./lines.js, which has no git in it and nothing to
    //read. This half is only the fetching: which repositories are here, and
    //where each ref is. See that file for why they are separate.
    async function groups() {
        var all = await stored();
        if (all === null) return null;

        var found = await workspace.repos();
        var here = found.map(function (r) { return r.name; });

        //ONE READ PER REPOSITORY, REUSED ACROSS EVERY LINE THAT NAMES IT. See
        //the header for what this cost before.
        var tracked = {};
        var named = Object.keys(all);
        for (var i = 0; i < named.length; i++) {
            var on = (all[named[i]] || {}).on || {};
            var repos = Object.keys(on);
            for (var j = 0; j < repos.length; j++) {
                if (repos[j] in tracked) continue;
                try { tracked[repos[j]] = await refs.of(repos[j]); }
                catch (e) { tracked[repos[j]] = {}; }
            }
        }

        return LINES.board(all, here, tracked);
    }

    //WHAT EACH REPOSITORY COUNTS FROM, which is what a new line defaults to.
    async function baselines() {
        var found = await workspace.repos();
        var out = [];
        for (var i = 0; i < found.length; i++) {
            var name = found[i].name;
            var def = null;
            try { def = await refs.head(name); } catch (e) { /* said as null */ }
            var all = [];
            try { all = await refs.branches(name); } catch (e) { /* said as empty */ }
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
        return LINES.protectedIn(await groups(), await baselines());
    }

    async function whyProtected(branch) {
        return LINES.whyProtected(branch, await protectedOf());
    }

    //---- what was recorded when a branch was cut ---------------------------
    //
    //PER WORKSPACE, and kept because git stops being able to say. A branch that
    //has been merged into looks identical to one cut somewhere else, so what it
    //was cut FROM is only knowable if it was written down at the time.
    async function cuts() { return state.here.doc('cuts'); }

    //---- what a branch is measured against ---------------------------------
    //
    //THE LINE IT WAS CUT FROM, RECORDED WHEN IT WAS MADE — and the default only
    //when there is no record. "3 commits ahead" is a statement about a branch, so
    //it must depend on that branch and nothing else; measuring against whatever
    //the default happens to be today re-interprets every number on the board the
    //moment somebody moves one.
    async function baseFor(branch, repo, notes, here) {
        var note = notes[branch];
        if (note && note.from && note.from[repo]) return note.from[repo];
        if (note && note.cutFrom) return note.cutFrom;
        if (note && note.group) {
            var g = (await groups() || []).filter(function (x) { return x.name === note.group; })[0];
            if (g) {
                var p = g.on.filter(function (x) { return x.repo === repo; })[0];
                if (p) return p.branch;
            }
        }
        var row = here.filter(function (r) { return r.repo === repo; })[0];
        return row ? row.on : null;
    }

    //---- what a branch carries, per repository ------------------------------
    //
    //`base..branch` IS WHAT THIS BRANCH ADDS, which is the reviewer's question —
    //not what it DIFFERS from, which would also count anything the base gained
    //meanwhile and read as though the worker had reverted it.
    //
    //CACHED ON THE PAIR OF COMMITS, WITH NO CLOCK IN IT — the same shape as
    //`unlanded` and `wouldConflict` in ../../git, and for the same reason. What
    //a branch carries is a pure function of two commits: if neither has moved it
    //cannot have changed, and if either has, the key is different.
    //
    //THIS ONE WAS NOT OPTIONAL. `branchBoard` asks for every branch in every
    //repository — eleven branches across three is up to sixty-six git processes
    //— and the pane draws it every ten seconds. Without this the board took long
    //enough to watch it arrive, which is the same fault the app being ported
    //from traced to 39% of its samples inside `spawn` with the window idle.
    var carried = {};
    var carriedCount = 0;

    //WHERE EVERY BRANCH IN EVERY REPOSITORY IS, IN ONE PROCESS PER REPOSITORY.
    //
    //THE CACHE BELOW WAS PAYING MORE FOR ITS KEY THAN IT SAVED. Building it cost
    //four git processes per branch per repository — two `has` and two
    //`rev-parse` — and every one of them ran on a cache HIT as well as a miss.
    //Eleven branches across three repositories is 132 processes before a single
    //answer is reused, which is fifteen seconds, which is what the board took on
    //every draw whether or not anything had moved.
    //
    //A CACHE THAT COSTS WHAT IT SAVES IS NOT A CACHE, and it read as one: the
    //heavy calls really were being skipped, the timing never changed, and
    //nothing said why.
    //
    //`tracked` ALREADY ANSWERS THIS. One `for-each-ref` per repository lists
    //every head and its commit, which is both halves of the question — does this
    //branch exist here, and what is it pointing at. See its own note in ../../git
    //about a panel spawning forty processes a minute.
    //NOW ONE CALL, because ../refs answers exactly this shape for the whole
    //workspace and holds the reads behind it.
    function headsIn(repos) { return refs.heads(repos); }

    async function carries(branch, notes, here, at) {
        var found = await workspace.repos();
        var heads = at || await headsIn(found);
        var out = [];

        for (var i = 0; i < found.length; i++) {
            var repo = found[i].name;
            var mine = heads[repo] || {};
            if (!mine[branch]) continue;

            var base = await baseFor(branch, repo, notes, here);
            //A BASE THAT IS NOT THERE IS NOT THE SAME AS A BRANCH THAT IS NOT
            //THERE, and saying so is the difference between "nothing to land"
            //and "there is nowhere to land it".
            if (!base || !mine[base]) {
                out.push({ repo: repo, branch: branch, base: base, noBase: true, ahead: 0, files: 0, added: 0, removed: 0 });
                continue;
            }

            //THE TWO COMMITS, WHICH ARE THE KEY — now read out of the one list
            //above rather than asked for one at a time.
            var key = repo + '|' + mine[base] + '|' + mine[branch];

            if (key in carried) { out.push(carried[key]); continue; }

            var commits = [];
            var files = [];
            try { commits = await git.commits(repo, base, branch); } catch (e) { /* said as none */ }
            try { files = await git.files(repo, base, branch); } catch (e) { /* said as none */ }

            var row = {
                repo: repo, branch: branch, base: base, noBase: false,
                ahead: commits.length,
                commits: commits,
                files: files.length,
                added: files.reduce(function (n, f) { return n + (f.added || 0); }, 0),
                removed: files.reduce(function (n, f) { return n + (f.removed || 0); }, 0)
            };

            //BOUNDED, because the key contains commits and commits keep being
            //made. Far more than a session needs, and nothing here is expensive
            //to recompute once.
            if (carriedCount > 500) { carried = {}; carriedCount = 0; }
            carried[key] = row;
            carriedCount++;
            out.push(row);
        }
        return out;
    }

    //ASKED BY NAME, because machines and the task board have not been ported and
    //this must work whether or not they answer. Same shape as the `lines` lookup
    //in ../conflicts — a lookup resolves at call time and is not a graph edge.
    async function relayed(name, args) {
        if (!actions) return null;
        try { return await actions.call(name, args || {}); }
        catch (e) { return null; }
    }

    //---- HOW A LINE ENDS, WHICH IS THE HALF NOTHING SAID -------------------
    //
    //A LINE IS MADE, WORK IS CUT FROM IT, AND THEN IT IS FOR EVER. Six lines
    //here and one of them is a baseline: the other five are finished work that
    //was promoted so it could be compared and sent, and FOUR OF THOSE HAVE
    //LANDED — merged, weeks ago, still named, still protecting their branches.
    //
    //THAT IS WHAT MAKES THE BOARD SILT UP. Promoting a cut is how a change gets
    //sent, and it is one-way: the cut stops being a cut. Every completed piece
    //of work therefore costs the workspace one branch cut, permanently, and the
    //list of places work can go shrinks every time work finishes. It was down
    //to two.
    //
    //ASKED OF THE CUTS RATHER THAN REMEMBERED. Whether a change landed is
    //something GitHub knows and ../pr already asks it — a second record here
    //would be a second opinion, and the app being ported from was burned by
    //exactly that: state written when a pull request opened and never
    //refreshed, so every cut read "open" for ever.
    //
    //AND IT IS SAID, NEVER ACTED ON. Retiring a line is a person's press — see
    //`lineRetire`. What this adds is the thing that press needs and did not
    //have: which of these is finished with.
    async function endsOf(all) {
        var said = await relayed('prCuts', {});
        var cuts = (said && said.cuts) || [];
        if (!said) return {};

        var byLine = {};
        all.forEach(function (g) {
            var sent = cuts.filter(function (c) { return c.source === g.name; });
            var into = cuts.filter(function (c) { return c.target === g.name; });

            //LANDED IF ANY CUT FROM IT LANDED. A line sent twice — reopened
            //after a first attempt was closed — is finished the moment one of
            //them is in, and the others are history rather than outstanding.
            var landed = sent.filter(function (c) { return c.landed; });
            var open = sent.filter(function (c) { return !c.landed; });

            byLine[g.name] = {
                //`null` IS NOT "never sent". A workspace whose pull requests
                //could not be read answers nothing, and a line reported as
                //never sent on that basis is one somebody might retire.
                sent: sent.length,
                landed: landed.length,
                open: open.length,
                receives: into.length,
                ends: landed.length ? 'landed' : (open.length ? 'out' : 'here'),
                //WHERE IT WENT, so the pane can say it rather than "landed".
                where: (landed[0] || open[0] || {}).target || null
            };
        });
        return byLine;
    }

    var undo = [];

    //---- AND IT ASKS FOR SOMEBODY, BECAUSE NOTHING ELSE WILL --------------
    //
    //RETIRING A LINE IS A PERSON'S PRESS AND MUST STAY ONE. Nothing in this app
    //revokes on a timer. But an act that only a person can do, on a state
    //nothing announces, is an act that never happens — which is exactly what
    //occurred: four lines merged weeks apart, each one quietly taking a branch
    //cut out of circulation, until "Work in this Branch Cut" offered two options
    //out of eleven and looked broken.
    //
    //SO IT IS AN ERRAND RATHER THAN A BADGE. ../../inbox is the list of things
    //waiting for a person, and this is one: the change is in, the line has done
    //its job, and only somebody who can be sure can say so. The badge on the
    //pane says which; this says that there is something to go and look at, from
    //a screen nobody has to think to open.
    //
    //ONE ITEM PER LINE AND NOT ONE SUMMARY. `where` takes a pick, so each row
    //lands on the line it is about with that line already selected — an errand
    //that drops somebody on a list to find the thing themselves is one they put
    //off. It also means the count on the inbox is the number of presses left.
    //
    //IT ASKS GITHUB, THROUGH ../pr, so an inbox that cannot reach it says
    //nothing rather than guessing. `endsOf` answers `{}` when the cuts could not
    //be read, and an empty answer here is an errand nobody is nagged about — the
    //right way round for a list whose whole worth is that everything on it is
    //real.
    if (imports.inbox) {
        undo.push(imports.inbox.source({
            name: 'lines whose change has landed',
            waiting: async function () {
                var all = await groups();
                if (!all || !all.length) return [];

                var ends = await endsOf(all);
                return all.filter(function (g) {
                    return (ends[g.name] || {}).ends === 'landed';
                }).map(function (g) {
                    var it = ends[g.name];
                    return imports.inbox.item(
                        'line to retire',
                        g.name,
                        'Its change landed in ' + (it.where || 'its target') + ', so this line has done its job — '
                            + 'and until it is retired it goes on protecting '
                            + ((g.on || []).length) + ' branch(es) and taking a place work could be cut to.',
                        imports.inbox.at('Repositories', 'Branches Lines', g.name),
                        { id: g.name }
                    );
                });
            }
        }));
    }

    if (actions) {
        undo.push(actions.define('lines', {
            about: 'Every named line: one branch per repository, what work is cut from, and whether its change has landed',
            run: async function () {
                var all = await groups();
                if (all === null) {
                    return { lines: [], groups: [], repos: [], note: 'No workspace is open, so there are no lines.' };
                }

                //HOW EACH ONE ENDS, folded onto the rows rather than handed back
                //as a second list a pane has to join. See `endsOf`.
                var ends = await endsOf(all);
                all = all.map(function (g) {
                    return Object.assign({}, g, ends[g.name] || { ends: null });
                });

                var done = all.filter(function (g) { return g.ends === 'landed'; });
                var stuck = all.filter(function (g) { return g.sync === 'conflict'; });
                return {
                    //`lines` AND `groups` ARE THE SAME ARRAY, under both names.
                    //The app being ported from calls them groups and every pane
                    //here calls them lines; returning one and renaming later
                    //would mean a flag day across five panes for a word.
                    lines: all,
                    groups: all,
                    repos: await baselines(),
                    //WHAT IS FINISHED WITH, COUNTED, because it is the reason
                    //this list is as long as it is. A line whose change landed
                    //is doing nothing but protecting a branch and taking a place
                    //work could be cut to.
                    landed: done.length,
                    note: !all.length
                        ? 'No lines yet. A line names one branch per repository so a change can be talked about as one thing.'
                        : stuck.length
                            ? stuck.length + ' of ' + all.length + ' have a part that moved on both sides — see Conflicts.'
                            : all.length + ' line' + (all.length === 1 ? '' : 's') + '.'
                                + (done.length
                                    ? ' ' + done.length + ' of them landed and can be retired — a line that has landed goes '
                                        + 'on protecting its branch and taking a place work could be cut to.'
                                    : '')
                };
            }
        }));

        //---- every branch, and what is true of it ---------------------------
        //
        //THREE THINGS THIS CANNOT ANSWER ITSELF, asked of the action table by
        //name because machines, tasks and handed-over files have not been
        //ported. Each arrives as null when nothing answers, and the row says so
        //rather than claiming a branch is spare because nothing could be asked.
        //---- what may not be built on, and nothing else --------------------
        //
        //ITS OWN ACTION BECAUSE THE PANE ASKS ITS OWN QUESTION. Protected drew
        //from `branchBoard` and read exactly one field of it — `protected` — so
        //every eight seconds it paid for the entire board to list some names:
        //a relayed `vmList`, which shells out to VBoxManage in the app being
        //ported from and takes between 0.7 and 3.5 seconds; a relayed `tasks`;
        //and `carries()` for every branch in every repository.
        //
        //MEASURED, BECAUSE THE GUESS WOULD HAVE BEEN git. After ../refs landed,
        //the local half of the board is about 160ms and `vmList` on its own is
        //1423ms — so the pane that felt slowest was the one asking for the least
        //and waiting on machines it never mentions.
        //
        //THIS IS `groups()` AND `baselines()`, both of which now read through
        //../refs, so it spawns nothing at all in the steady state.
        undo.push(actions.define('branchProtected', {
            about: 'Every branch that may not be built on, and whether that could be changed',
            run: async function () {
                var guarded = await protectedOf();
                return {
                    protected: Object.keys(guarded).sort().map(function (b) { return guarded[b]; })
                };
            }
        }));

        //---- EVERY BRANCH, AS THE DRILLS AND A MACHINE ASK FOR IT ---------
        //
        //THE SAME FACTS AS `branchBoard`, TURNED THE OTHER WAY UP. That board is
        //drawn for a person looking at a pane: it says where a branch IS. This
        //answers "may I point a machine at this one", which needs the opposite —
        //where it is NOT.
        //
        //`missing` IS THE WHOLE REASON THIS IS NOT JUST AN ALIAS. A machine
        //checks a branch out in EVERY repository, so one that exists in two of
        //three is not work a machine can be given. The drills ask exactly that,
        //with `!(b.missing || []).length` — and against a board that has no such
        //field, `(undefined || []).length` is 0 and every branch reads as
        //complete. A silently wrong answer, in the check whose job is to catch
        //an incomplete one.
        //
        //BUILT ON `branchBoard` RATHER THAN BESIDE IT. Two answers to "what
        //branches are there" is the fault this app keeps finding; asking the
        //action is a lookup, and it cannot drift from what the pane shows.
        //
        //---- AND WHAT IS NOT HERE, SAID RATHER THAN GUESSED --------------
        //
        //The app being ported from also answers `usable`, which is `available`
        //AND `reclaimable` — whether this host can get its own checkout out of
        //the way. Beta has no `reclaimable`: the nearest things on the board are
        //`spare`, `removable` and `heldRunning`, and none of them means that.
        //Inventing a `usable` out of the three would be a confident wrong answer
        //about whether work can go somewhere, which is worse than not answering.
        //So it is absent and `note` says so.
        undo.push(actions.define('gitBranches', {
            about: 'Every branch across the workspace repositories, which have each, and which are taken',
            needs: 'workspace',
            run: async function () {
                var board = await actions.call('branchBoard', {});
                var repos = board.repos || [];

                return {
                    repos: repos,
                    branches: (board.branches || []).map(function (b) {
                        var inThese = b.in || [];
                        var missing = repos.filter(function (r) { return inThese.indexOf(r) < 0; });

                        //TWO QUESTIONS, ANSWERED SEPARATELY. Protected is about
                        //the branch; held is about a machine having claimed it.
                        //They fail for different reasons and are put right in
                        //different places, so they are not folded into one flag.
                        return Object.assign({}, b, {
                            missing: missing,
                            available: !b.protected && !b.heldBy
                        });
                    }),
                    //NEITHER `usable` NOR `defaultHeads`, and both omissions are
                    //the same decision. Over there `defaultHeads` says where each
                    //default branch actually IS, as a commit, so a drill can check
                    //that nothing landed on master rather than looking at master
                    //and finding it plausible. Nothing here answers it yet, and
                    //writing `await defaultHeads()` — which is what I reached for
                    //first — would have been a free identifier: valid syntax, a
                    //clean build, and a ReferenceError the first time a drill
                    //asked. Fifth one this sitting.
                    note: 'Two things the app being ported from answers are not here: "reclaimable", whether this '
                        + 'host can get its own checkout out of a branch, and "defaultHeads", where each default '
                        + 'branch actually is. Nothing here means either yet, so neither is guessed at.'
                };
            }
        }));

        undo.push(actions.define('branchBoard', {
            about: 'Every branch: who claims it, what is on it, and whether it can be deleted',
            run: async function () {
                var found = await workspace.repos();
                var notes = (await (await cuts()).read({})) || {};
                var here = await baselines();
                var guarded = await protectedOf();

                //ONE READ PER REPOSITORY FOR THE WHOLE DRAW. Every branch's row
                //needs to know where it is and where its base is, and asking per
                //branch is what made this board take fifteen seconds whether or
                //not anything had moved. See `headsIn`.
                var heads = await headsIn(found);

                //WHICH REPOSITORIES HAVE IT, AND WHERE IT IS CHECKED OUT.
                //
                //BUILT FROM WHAT HAS ALREADY BEEN READ. This asked git for every
                //repository's HEAD and branch list — which `baselines()` had
                //fetched thirty lines above and `headsIn` had fetched again in
                //between. Three reads of one fact per repository, in one call,
                //on a pane that redraws on a timer.
                //
                //Nothing was wrong with any of them individually, which is how
                //it survived: each one is a reasonable line where it stands, and
                //only reading the whole function shows the same question asked
                //three times.
                var seen = {};
                for (var i = 0; i < found.length; i++) {
                    var repo = found[i].name;
                    var row = here.filter(function (r) { return r.repo === repo; })[0] || { on: null, branches: [] };
                    var names = row.branches || [];
                    for (var j = 0; j < names.length; j++) {
                        var b = names[j];
                        if (!seen[b]) seen[b] = { name: b, in: [], head: [] };
                        seen[b].in.push(repo);
                        if (b === row.on) seen[b].head.push(repo);
                    }
                }

                //THE LIVE LIST, NOT THE REGISTRY. A claim outlives the machine
                //being on — which is why "claimed by a machine that is off" is a
                //separate thing to say — but WHETHER it is on comes from the
                //machine layer, and reading `running` off a stored record gets
                //`undefined` every time. A machine somebody was working in then
                //reports itself as off, which is the exact lie the distinction
                //exists to stop telling.
                var vms = await relayed('vmList');
                var machines = (vms && (vms.vms || vms)) || [];
                var board = await relayed('tasks');
                var claimsOn = (board && (board.tasks || board)) || [];

                var rows = [];
                var all = Object.keys(seen).sort(function (x, y) { return x.localeCompare(y); });

                for (var k = 0; k < all.length; k++) {
                    var name = all[k];
                    var row = seen[name];
                    var p = guarded[name] || null;
                    var note = notes[name] || null;

                    var held = machines.filter(function (v) { return v.branch === name; })[0] || null;
                    //EVERY TASK THAT NAMED THIS BRANCH, not the first. Two tasks
                    //on one branch is a mistake worth seeing rather than a case
                    //to pick a winner in.
                    var claims = claimsOn.filter(function (t) { return t.branch === name; });

                    //A DEFAULT IS NEVER MEASURED AGAINST ITSELF.
                    var isDefault = !!(p && p.asDefault.length);
                    var art = isDefault ? null : await carries(name, notes, here, heads);
                    var carrying = art ? art.filter(function (a) { return !a.noBase; }) : [];

                    rows.push(Object.assign({}, row, {
                        cut: !!note,
                        note: note,
                        group: note ? note.group : null,
                        protected: !!p,
                        asDefault: p ? p.asDefault : [],
                        why: p ? await whyProtected(name) : null,

                        heldBy: held ? held.name : null,
                        heldRunning: !!(held && held.running),
                        tasks: claims.map(function (t) {
                            return { id: t.id, number: t.number, title: t.title, state: t.state };
                        }),

                        commits: carrying.reduce(function (n, a) { return n + a.ahead; }, 0),
                        files: carrying.reduce(function (n, a) { return n + a.files; }, 0),
                        on: art,
                        summary: isDefault
                            ? 'a default branch — where work lands, never measured against itself'
                            : carrying.length
                                ? carrying.reduce(function (n, a) { return n + a.ahead; }, 0) + ' commit(s) in '
                                    + carrying.filter(function (a) { return a.ahead; }).length + ' repositor'
                                    + (carrying.filter(function (a) { return a.ahead; }).length === 1 ? 'y' : 'ies')
                                : 'nothing beyond what it was cut from',
                        //EVERYTHING IT CARRIES IS ALREADY IN ITS BASE.
                        contained: art ? (carrying.length > 0 && carrying.every(function (a) { return a.ahead === 0; })) : null,

                        //SPARE AND ORPHANED ARE DIFFERENT, and both need all
                        //three answers. `null` where nothing could be asked, so
                        //an unreachable machine layer cannot make a held branch
                        //read as free.
                        //
                        //THIS COMMENT DESCRIBED A PAIR AND ONLY ONE OF THEM WAS
                        //HERE. `orphaned` was dropped in the port and ../branches
                        //went on reading it — a badge that never drew and a
                        //filter chip that silently answered "nothing" whichever
                        //branches were on the board. Exactly the failure
                        //`branchBoard`'s own header records having found once
                        //already with `protected`, in the pane next door.
                        //
                        //THE TWO DIFFER ON ONE TERM AND THAT TERM IS THE WHOLE
                        //POINT: whether anything is actually ON it. Both mean
                        //"not protected, nobody's task, no machine, and readable"
                        //— and then:
                        //
                        //    spare      carries nothing. A name and nothing
                        //               else, so sweeping it up loses exactly
                        //               nothing. Most of what accumulates here
                        //               is this — a drill's branch outliving the
                        //               drill.
                        //
                        //    orphaned   carries work, and the task that asked
                        //               for it is gone. The one row on the board
                        //               where somebody has to decide whether to
                        //               throw work away.
                        //
                        //So the difference between them is the whole of what
                        //deleting costs, which is why one badge is muted and the
                        //other is a warning.
                        //
                        //`delivered` IN THE APP BEING PORTED FROM IS
                        //`carrying.length > 0` — at least one repository has
                        //commits on it. `carrying` here is already the parts
                        //that have a base, so the same question is
                        //`some(ahead > 0)`, which is `spare`'s condition
                        //negated. Written as its own expression rather than as
                        //`!spare`, because `spare` is `null` when nothing could
                        //be asked and `!null` is `true` — an unreachable machine
                        //layer would have made every branch read as orphaned.
                        spare: (vms && board)
                            ? (!p && !claims.length && !held && !!art && carrying.every(function (a) { return a.ahead === 0; }))
                            : null,
                        orphaned: (vms && board)
                            ? (!p && !claims.length && !held && !!art && carrying.some(function (a) { return a.ahead > 0; }))
                            : null,
                        removable: !p && !held && !claims.length
                    }));
                }

                var cutRows = rows.filter(function (r) { return r.cut; });
                return {
                    repos: found.map(function (r) { return r.name; }),
                    branches: rows,

                    //WHAT MAY NOT BE BUILT ON, AS ITS OWN LIST.
                    //
                    //THIS WAS MISSING AND THE PANE READ IT ANYWAY. Protected asks
                    //for `branchBoard` and takes `state.protected`, which was
                    //never in the answer — so it drew the empty case, and the
                    //empty case does not say "nothing to show". It says "no
                    //repository here has a default branch — worth looking at",
                    //in red, about three repositories that all have one.
                    //
                    //THAT IS THE WORST SHAPE THIS PARTICULAR PANE CAN FAIL IN.
                    //It is the policy gate's own display: it exists to show what
                    //is refused, and it was telling somebody that nothing was —
                    //while the gate itself was working perfectly and refusing
                    //exactly what it should. An alarming lie about a working
                    //guard is how a working guard gets "fixed".
                    //
                    //A PANE NAMING A FIELD AN ACTION DOES NOT HAVE IS INVISIBLE
                    //to every check here: it compiles, it renders, the walk
                    //counts it as a pane with content, and React draws
                    //`undefined` as nothing at all. The same shape as a misspelt
                    //class and a misspelt action name — this port has now found
                    //one of each.
                    protected: Object.keys(guarded).sort().map(function (b) { return guarded[b]; }),
                    //WHAT COULD NOT BE ASKED, SAID RATHER THAN IMPLIED.
                    asked: { machines: !!vms, tasks: !!board },
                    note: cutRows.length + ' cut, ' + rows.length + ' branch(es) in all'
                        + ((!vms || !board) ? ' — who holds them could not be asked, so nothing is reported as spare.' : '.')
                };
            }
        }));

        //---- a cut becomes a line -------------------------------------------
        //
        //THE MOMENT WORK STOPS BEING A BRANCH AND BECOMES A THING. A cut is
        //where work happens; naming it a line is saying it is now the point
        //other work is measured against — and from then on it is protected.
        undo.push(actions.define('branchAsLine', {
            about: 'Name a cut as a line, so it becomes a point work can be measured against',
            takes: ['branch', 'name', 'why'],
            run: async function (args) {
                var a = args || {};
                var branch = String(a.branch || '').trim();
                if (!branch) throw new Error('Say which branch.');

                var found = await workspace.repos();
                var on = {};
                for (var i = 0; i < found.length; i++) {
                    if (await refs.hasBranch(found[i].name, branch)) on[found[i].name] = branch;
                }
                if (!Object.keys(on).length) {
                    throw new Error('No repository here has a branch called "' + branch + '", so there is nothing to name.');
                }

                var title = String(a.name || branch).trim();
                var doc = await kept();
                var lines = doc.read({}) || {};
                var was = lines[title] || {};

                //WHY IT EXISTS, TAKEN FROM THE CUT WHEN NOTHING ELSE IS SAID.
                //The reason somebody cut it is usually the reason it is a line,
                //and asking them to type it again is how the two drift apart.
                var note = ((await (await cuts()).read({})) || {})[branch] || null;
                lines[title] = {
                    on: on,
                    why: a.why ? String(a.why).trim() : (was.why || (note && note.reason) || null),
                    made: was.made || new Date().toISOString(),
                    marked: was.marked || null
                };
                doc.write(lines);

                log.good('"' + title + '" is a line, naming ' + branch + ' in ' + Object.keys(on).length + ' repositor'
                    + (Object.keys(on).length === 1 ? 'y' : 'ies'));
                var now = (await groups() || []).filter(function (g) { return g.name === title; })[0] || null;
                return Object.assign({ name: title }, now || {}, {
                    note: '"' + title + '" is a line now, naming ' + branch + ' in ' + Object.keys(on).length
                        + ' repositor' + (Object.keys(on).length === 1 ? 'y' : 'ies')
                        + '. Its branches are protected from here on — work goes onto its own branch and is merged in.'
                });
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
                    if (!(await refs.hasBranch(repo, name))) continue;
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
                    //
                    //AND THE FETCH IS WHAT MAKES THAT SAFE TO ASK ../refs. A
                    //fetch is a write as far as ../../git is concerned, so it
                    //announces itself and refs drops this repository — the read
                    //below is of what just arrived, not of what was there before.
                    if (!(await refs.hasRemote(p.repo, p.branch))) {
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

        //---- and the end of a line's life -----------------------------------
        //
        //A LINE HAD NO END. It is made, work is cut from it, it is promoted so
        //the change can be sent — and then it is for ever. Four of the six lines
        //in the workspace this was written against had LANDED: merged, weeks
        //earlier, still named, still protecting their branches.
        //
        //WHICH IS WHAT MAKES THE BOARD SILT UP, and it is not cosmetic.
        //Promoting a cut is one-way: the cut stops being a cut. So every piece
        //of work that completes costs the workspace one branch cut for ever, and
        //the list of places work can be put shrinks each time work finishes. It
        //was down to two, on a board with eleven branches.
        //
        //FORGETTING AND RETIRING ARE DIFFERENT ACTS AND BOTH ARE KEPT.
        //`lineForget` is "I do not want this line any more" and asks no
        //questions — it is the way out of a line made by mistake, or one whose
        //work was abandoned. This one is "this landed, tidy it up", and it
        //refuses anything else.
        //
        //IT IS NOT AUTOMATIC AND MUST NOT BECOME SO. Nothing in this app revokes
        //on a timer; a merge is a person's press and so is clearing up after
        //one. What was missing was never the automation — it was that nothing
        //SAID which lines were finished with, so the press had no information
        //behind it. See `endsOf` above, which is the other half of this.
        //
        //---- what it refuses, and why each one --------------------------
        //
        //NOT LANDED. Retiring an open line deletes branches carrying a change
        //that is still out for review, and the pull request is left pointing at
        //a head that is gone.
        //
        //A LINE OTHER CUTS ARE MADE INTO. `default` receives every cut this host
        //makes; retiring it would take away the thing everything else is
        //measured against, and `branchCreate` would answer "there is no line
        //called default" to the next person trying to start work.
        //
        //AND THE BRANCHES GO ONLY IF ASKED. Forgetting the line unprotects them,
        //which is already enough to free the board; deleting them is the extra
        //step, and it is the one that cannot be undone.
        undo.push(actions.define('lineRetire', {
            about: 'Retire a line whose change has landed: forget it, and delete the branches it named if asked',
            takes: ['name', 'branches'],
            run: async function (args) {
                var a = args || {};
                var title = String(a.name || '').trim();
                if (!title) throw new Error('Say which line.');

                var all = await groups();
                if (all === null) throw new Error('No workspace is open.');
                var line = all.filter(function (g) { return g.name === title; })[0];
                if (!line) {
                    throw new Error('There is no line called "' + title + '". There is: '
                        + all.map(function (g) { return g.name; }).join(', ') + '.');
                }

                var ends = (await endsOf(all))[title];
                if (!ends) {
                    throw new Error('This host could not read what became of "' + title + '" on GitHub, so it will not '
                        + 'retire it. A line retired on the strength of an unanswered question is one whose change may '
                        + 'still be out.');
                }
                if (ends.receives) {
                    throw new Error('"' + title + '" is what ' + ends.receives + ' cut(s) are made INTO, so it is a '
                        + 'baseline rather than a change. Retiring it would take away the thing work is measured '
                        + 'against, and the next branchCreate would answer "there is no line called ' + title + '".');
                }
                if (ends.ends !== 'landed') {
                    throw new Error('"' + title + '" has not landed'
                        + (ends.open ? ' — ' + ends.open + ' cut(s) from it are still open' : ' and has never been sent')
                        + ', so there is nothing to tidy up yet. `lineForget` is the way to drop a line you do not '
                        + 'want; this one is only for a change that is already in.');
                }

                //THE LINE FIRST, BECAUSE IT IS WHAT PROTECTS THE BRANCHES.
                //`branchDelete` refuses a protected branch, and it is right to —
                //so this unprotects by forgetting, and only then deletes.
                var gone = await actions.call('lineForget', { name: title });

                var removed = [];
                var failed = [];
                var alsoBranches = a.branches === true || a.branches === 'true';

                if (alsoBranches) {
                    //BY NAME, ONCE EACH. A line names one branch per repository
                    //and they are usually the same name; `branchDelete` already
                    //takes a name and removes it wherever it is.
                    var names = {};
                    (line.on || []).forEach(function (p) { if (p.branch) names[p.branch] = true; });

                    var want = Object.keys(names);
                    for (var i = 0; i < want.length; i++) {
                        try {
                            //FORCED, because the whole precondition of this door
                            //is that the change is already in. git's own "not
                            //fully merged" test compares against the CURRENT
                            //branch, which is not what landed it.
                            await actions.call('branchDelete', { branch: want[i], force: true });
                            removed.push(want[i]);
                        } catch (e) {
                            failed.push(want[i] + ': ' + e.message);
                        }
                    }
                }

                log.warn('line "' + title + '" retired — it landed in ' + (ends.where || 'its target')
                    + (removed.length ? ', and ' + removed.length + ' branch(es) went with it' : ''));

                return {
                    retired: title,
                    landedIn: ends.where || null,
                    was: gone.was,
                    branches: removed,
                    failed: failed,
                    //SAID RATHER THAN DONE, for the half that reaches somebody
                    //else's repository. See ../repos/branchDeleteRemote — a
                    //branch on the fork is theirs, and any pull request open
                    //from one is on it.
                    note: '"' + title + '" landed in ' + (ends.where || 'its target') + ' and is retired.'
                        + (removed.length
                            ? ' ' + removed.join(', ') + ' deleted here. Anything on the fork is untouched — '
                                + 'branchDeleteRemote is the door for that.'
                            : ' Its branches are untouched and no longer protected by it.')
                        + (failed.length ? ' Could not delete: ' + failed.join('; ') + '.' : '')
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

    //---- what a branch is measured against, asked from outside --------------
    //
    //`baseFor` above takes the notes and the baselines because it is called once
    //per repository per branch inside a board draw, and reading them again each
    //time is the cost that made the board slow. Anything OUTSIDE this plugin has
    //one branch and no context, so it gets a form that reads them itself.
    //
    //IT LIVES HERE BECAUSE THE CUT NOTE DOES. What a branch was cut from is
    //written down at the moment it is cut, by the door in this file, and git
    //stops being able to say afterwards — a branch that has been merged into
    //looks identical to one cut somewhere else. Two plugins keeping their own
    //answer to "measured against what" is two boards that disagree about how far
    //along the same work is.
    async function baseOf(branch, repo) {
        var notes = (await (await cuts()).read({})) || {};
        return await baseFor(branch, repo, notes, await baselines());
    }

    //WHICH REPOSITORIES A BRANCH IS ABOUT, which is what its line says.
    //
    //A branch scoped to two of three reported with a third row reading "not in
    //this repository" is true and reads as a gap in the work rather than as the
    //shape somebody chose — a reviewer counting three rows and finding two is
    //looking for a problem that does not exist.
    async function scopeOf(branch) {
        var found = await workspace.repos();
        var here = found.map(function (r) { return r.name; });
        var note = ((await (await cuts()).read({})) || {})[branch] || null;
        if (!note || !note.group) return { group: null, repos: here, whole: true, gone: [] };

        var found2 = ((await groups()) || []).filter(function (g) { return g.name === note.group; })[0];
        //A LINE FORGOTTEN SINCE IS NOT A REASON TO WIDEN A BRANCH'S REACH. What
        //it named is recorded on the branch itself, and that record outlives the
        //line precisely so this question stays answerable.
        var named = found2
            ? found2.on.map(function (p) { return p.repo; })
            : Object.keys(note.from || {});

        var scoped = here.filter(function (n) { return named.indexOf(n) >= 0; });
        return {
            group: note.group,
            repos: scoped.length ? scoped : here,
            whole: !scoped.length || scoped.length === here.length,
            //Repositories the line named that are not in this workspace any
            //more. Reported rather than dropped: a task that spanned three
            //repositories and can now only reach two is a different task.
            gone: named.filter(function (n) { return here.indexOf(n) < 0; })
        };
    }

    await register(null, {
        lines: {
            all: groups,
            protectedOf: protectedOf,
            whyProtected: whyProtected,
            baselines: baselines,
            baseOf: baseOf,
            scopeOf: scopeOf
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
