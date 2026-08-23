//---------------------------------------------------------------------------
//A PR CUT: ONE ACT, ONE PULL REQUEST PER REPOSITORY, HELD TOGETHER.
//
//GitHub has no idea the three are one change. It knows about three pull
//requests in three repositories, each with its own number, its own reviewers and
//its own merge button — and holding them together is the part only this can do.
//
//A CUT IS KEYED ON THE PAIR OF LINES: what is being proposed, and what it would
//go into. Not on a branch name, because the same branch name in three
//repositories is three branches, and not on a date, because the same pair can be
//sent more than once.
//
//---- what is stored, and what is asked -------------------------------------
//
//STORED: which pull requests were opened, in which repository, with which
//number, and what was said when they were made. That is a record of an act.
//
//ASKED EVERY TIME: whether each is still open, merged, or closed. That is a fact
//about GitHub which changes without this app being told, and storing it would
//mean showing a merged pull request as open until somebody happened to press
//something. It is why this pane is the slowest in the app, and why nothing else
//reads it on a timer.
//---------------------------------------------------------------------------

plugin.consumes = ['app', 'log', 'git', 'github', 'keys', 'workspace', 'state', 'settings', 'refs'];
plugin.provides = ['prcuts'];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log.on('git');
    var git = imports.git;
    var github = imports.github;
    var keys = imports.keys;
    var workspace = imports.workspace;
    var state = imports.state;
    //---- REFS FOR READING ---------------------------------------------------
    //
    //../refs reads each repository once for the whole group and knows when to
    //stop believing it -- through ../../git's own announcement of a write, and
    //through a watch on .git for the branch somebody cut in a terminal.
    //
    //ASKING git DIRECTLY FOR THESE WAS A SECOND READ of what a sibling pane had
    //already just done, on this pane's own timer. `origin` is the one worth
    //naming: it cannot change through this app at all -- ../../git's url read is
    //fixed argv with no set-url door -- so it is the cheapest thing here to stop
    //re-reading, and it was being asked four times a draw.
    //
    //EVERYTHING THAT IS NOT A REF READ STAYS ON git: the diffs, the commit
    //counts, and every write.
    var refs = imports.refs;

    var settings = imports.settings;

    //---- the three stores, all per workspace -------------------------------
    async function landings() { return state.here.doc('landings'); }
    async function drafts() { return state.here.doc('pr-drafts'); }
    async function template() { return state.here.doc('pr-template'); }

    function key(source, target) { return String(source) + ' -> ' + String(target); }

    async function read(doc) {
        try { return (await doc()).read({}) || {}; }
        catch (e) { return null; }
    }

    //=======================================================================
    //WHAT GOES IN THE BODY OF A PULL REQUEST, and it is composed rather than
    //typed twice.
    //
    //EVERY BLOCK IS OFF UNTIL SOMEBODY TURNS IT ON. What this app knows about a
    //change — why the branch was cut, what it was cut from, which commits — is
    //useful in a pull request and is nobody else's decision to make. A template
    //that arrives switched on writes somebody's internal notes into a public
    //repository the first time they press the button.
    //=======================================================================
    var BLOCKS = [
        {
            id: 'crosslinks',
            label: 'Links to the other pull requests in this change',
            about: 'Each pull request names the others by number and link. Written after all of them exist, because the numbers do not exist before that.',
            //ONLY WHEN THERE IS MORE THAN ONE. A pull request that says "this
            //change is also in:" and then lists nothing is worse than silence.
            manyOnly: true,
            write: function (c, me) {
                var others = (c.pulls || []).filter(function (p) { return p.number && p.repo !== me; });
                if (!others.length) return null;
                return ['**This change is also in:**'].concat(others.map(function (p) {
                    return '- ' + p.repo + ' — ' + p.url;
                })).join('\n');
            }
        },
        {
            id: 'reason',
            label: 'Why the branch was cut',
            about: 'The reason recorded when the branch was made, which this app refuses to create one without.',
            write: function (c) {
                return c.note && c.note.reason ? '**Why this branch exists:** ' + c.note.reason : null;
            }
        },
        {
            id: 'cutfrom',
            label: 'What it was cut from',
            about: 'The line or branch this work started from, recorded at the time — git stops being able to say once both have moved on.',
            write: function (c) {
                if (!c.note) return null;
                var from = c.note.group ? 'the "' + c.note.group + '" line' : c.note.cutFrom;
                return from ? '**Cut from:** ' + from : null;
            }
        },
        {
            id: 'commits',
            label: 'The commits it carries',
            about: 'What this branch adds to what it was cut from, by subject.',
            write: function (c, me) {
                var mine = (c.carries || []).filter(function (a) { return a.repo === me; })[0];
                if (!mine || !mine.commits || !mine.commits.length) return null;
                return ['**Commits:**'].concat(mine.commits.map(function (x) {
                    return '- `' + String(x.sha).slice(0, 7) + '` ' + x.subject;
                })).join('\n');
            }
        },
        {
            id: 'origin',
            label: 'That this app opened it',
            about: 'A line saying which tool made the pull request, so a reader knows what wrote the rest of the body.',
            write: function () { return '_Opened by the dashboard, as one act across every repository this change touches._'; }
        }
    ];

    async function blocksOn() {
        var chosen = (await read(template)) || {};
        return BLOCKS.map(function (b) {
            return { id: b.id, label: b.label, about: b.about, manyOnly: !!b.manyOnly, on: !!chosen[b.id] };
        });
    }

    //THE BODY SOMEBODY WROTE COMES FIRST, ALWAYS. Everything composed is
    //appended under it, so a person's own words are never rearranged or wrapped.
    async function compose(said, context) {
        if (!context) return String(said || '');
        var chosen = (await read(template)) || {};
        var parts = [String(said || '').trim()];

        for (var i = 0; i < BLOCKS.length; i++) {
            var b = BLOCKS[i];
            if (!chosen[b.id]) continue;
            if (b.manyOnly && (context.repos || []).length < 2) continue;
            var text = null;
            try { text = b.write(context, context.me); } catch (e) { text = null; }
            if (text) parts.push(String(text).trim());
        }

        return parts.filter(Boolean).join('\n\n');
    }

    //---- what a cut is, right now ------------------------------------------
    //
    //ASKED OF GITHUB PER PULL REQUEST, because whether one is merged is not
    //something this app is told about. `into` is where it actually lives — a
    //pull request from a fork is IN THE PARENT — so it is asked for there first
    //and only then looked for on the repository itself.
    async function stateOf(rec) {
        var now = [];
        for (var i = 0; i < (rec.pulls || []).length; i++) {
            var p = rec.pulls[i];
            if (!p.number) { now.push(Object.assign({}, p, { state: 'never opened' })); continue; }

            var where = p.into || null;
            var found = null;
            try {
                if (where) {
                    var bits = String(where).split('/');
                    var r = await github.call('GET', '/repos/' + bits[0] + '/' + bits[1] + '/pulls/' + p.number);
                    if (r.status === 200 && r.body) found = shapePull(r.body);
                }
                if (!found) {
                    var remote = await refs.origin(p.repo);
                    if (remote && remote.owner) {
                        var r2 = await github.call('GET', '/repos/' + remote.owner + '/' + remote.repo + '/pulls/' + p.number);
                        if (r2.status === 200 && r2.body) found = shapePull(r2.body);
                    }
                }
                now.push(found
                    ? Object.assign({}, p, found)
                    : Object.assign({}, p, { state: 'could not be found', why: (p.into || p.repo) + ' did not answer for #' + p.number }));
            } catch (e) {
                now.push(Object.assign({}, p, { state: 'could not be read', why: e.message }));
            }
        }

        var opened = now.filter(function (p) { return p.number; });
        var merged = now.filter(function (p) { return p.state === 'merged'; });
        var closed = now.filter(function (p) { return p.state === 'closed'; });

        return Object.assign({}, rec, {
            pulls: now,
            //WHERE THE CUT AS A WHOLE STANDS, and it is the WORST of its parts
            //for the same reason a line's is: the point of holding them together
            //is that they land together.
            landed: opened.length > 0 && merged.length === opened.length,
            partly: merged.length > 0 && merged.length < opened.length,
            merged: merged.length,
            closed: closed.length,
            open: opened.length - merged.length - closed.length,
            of: opened.length
        });
    }

    function shapePull(body) {
        return {
            number: body.number,
            title: body.title,
            url: body.html_url,
            draft: !!body.draft,
            by: body.user && body.user.login,
            at: body.created_at,
            base: body.base && body.base.ref,
            head: body.head && body.head.ref,
            //MERGED IS NOT CLOSED, and GitHub reports both as `state: closed`.
            //Reading the state alone turns every merged pull request into a
            //rejected one, which is the opposite news.
            state: body.merged_at ? 'merged' : body.state,
            mergedAt: body.merged_at || null,
            mergeable: body.mergeable == null ? null : !!body.mergeable
        };
    }

    //=======================================================================
    //SENDING A CHANGE OUT, WHICH IS THE ONE ACT WITH CONSEQUENCES OUTSIDE THIS
    //HOST.
    //
    //THE GATE IN THE APP BEING PORTED FROM IS A JUDGEMENT. Over the pipe,
    //`prCutMake` requires that something has read the code — a judgement of the
    //line or of any branch it is made of, done, not stale against what it read,
    //and not rejected. Without it, the one step where a change leaves this host
    //and reaches somebody else's repository would be the only step taken on
    //nothing but a model's own confidence.
    //
    //THAT GATE CANNOT BE PORTED YET, BECAUSE THE JUDGE HAS NOT BEEN. Staleness
    //is measured by `staleAgainst` and `tipsFor`, which are internals of the
    //judging half rather than actions anything can ask for — so a port today
    //could check that a judgement EXISTS and could not check that it describes
    //what is there NOW.
    //
    //SO THE PIPE IS REFUSED OUTRIGHT INSTEAD. That is stricter than the original,
    //deliberately: a gate ported at two thirds is worse than no gate, because it
    //reads as the whole one. A person at the window may still send — they have
    //read the change, or decided they need not, which is the same boundary as
    //approving a job.
    //
    //WHEN THE JUDGE PORTS, this becomes the three-part check and not before.
    function notFromThePipe(a) {
        if (!a || !a._overTheWire) return;
        throw new Error(
            'A change is sent out from the window, by a person. Over the pipe this needs a judgement — '
            + 'something that has read the code, is not stale against what it read, and did not reject it — '
            + 'and the judging half has not been ported here yet, so that check cannot be made honestly. '
            + 'It is refused rather than half-checked: a gate that only asks whether a judgement EXISTS '
            + 'would pass a judgement of an earlier state, which is exactly as useful as none.');
    }

    //WHICH REPOSITORIES ACTUALLY CARRY SOMETHING. A cut that opens a pull request
    //in a repository with nothing in it is noise in three places at once — a
    //reviewer's list, the cut's own state, and the branch board.
    async function carrying(source, target) {
        var lines = await relayed('lines');
        var all = (lines && (lines.lines || lines.groups)) || [];
        var from = all.filter(function (g) { return g.name === source; })[0];
        var into = all.filter(function (g) { return g.name === target; })[0];
        if (!from) throw new Error('There is no line called "' + source + '".');
        if (!into) throw new Error('There is no line called "' + target + '".');

        var out = [];
        for (var i = 0; i < from.on.length; i++) {
            var p = from.on[i];
            if (!p.stillHere || !p.there) continue;
            var base = (into.on.filter(function (x) { return x.repo === p.repo; })[0] || {}).branch;
            if (!base) continue;

            var ahead = 0;
            try { ahead = (await git.commits(p.repo, base, p.branch)).length; } catch (e) { ahead = 0; }
            if (ahead > 0) out.push({ repo: p.repo, head: p.branch, base: base, ahead: ahead });
        }
        return { from: from, into: into, on: out };
    }

    async function relayed(name, args) {
        if (!actions) return null;
        try { return await actions.call(name, args || {}); }
        catch (e) { return null; }
    }

    //---- opening one, in the right place ------------------------------------
    //
    //IN THE PARENT, WHEN THERE IS ONE. A pull request from a fork is created in
    //the repository being merged INTO, with the head written `owner:branch`.
    //
    //GETTING THIS WRONG DOES NOT FAIL LOUDLY. It opens a pull request inside the
    //fork, from the fork's branch into the fork's own default — which looks
    //perfectly normal, reports success, and lands the work nowhere anybody is
    //watching. That is the worst shape a bug can have here, and it is why the
    //target is asked for rather than assumed.
    async function openOne(repo, want) {
        var remote = await refs.origin(repo);
        if (!remote || remote.kind !== 'github') {
            return { repo: repo, opened: false, why: '"' + repo + '" has no GitHub remote to open a pull request on.' };
        }

        var known = await relayed('repositories');
        var row = ((known && known.repos) || []).filter(function (r) { return r.repo === repo; })[0];
        var target = want.into || (row && row.target && row.target.on) || (remote.owner + '/' + remote.repo);
        var bits = String(target).split('/');
        var crossing = target !== (remote.owner + '/' + remote.repo);
        var head = crossing ? remote.owner + ':' + want.head : want.head;

        //DOES THE BASE EVEN EXIST THERE, asked before anything is sent. GitHub
        //answers this with `PullRequest base invalid` in a 422, which is accurate
        //and says nothing a person can act on — it does not name the base and it
        //does not say where it was looked for.
        var there = await github.call('GET', '/repos/' + bits[0] + '/' + bits[1] + '/branches/' + encodeURIComponent(want.base));
        if (there.status === 404) {
            return {
                repo: repo, opened: false,
                why: target + ' has no branch called "' + want.base + '", so a pull request cannot be opened against it.'
                    + (row && row.target && row.target.chosen
                        ? ' That is where "' + repo + '" sends work.'
                        : ' Nothing has been picked for "' + repo + '", so work stays on your own remote — walk the fork chain and say where work goes.')
            };
        }

        var body = { title: want.title, body: want.body, head: head, base: want.base };
        if (want.draft) body.draft = true;
        if (crossing) body.head_repo = remote.owner + '/' + remote.repo;

        var r = await github.call('POST', '/repos/' + bits[0] + '/' + bits[1] + '/pulls', body);
        if (r.status === 201) {
            return {
                repo: repo, opened: true, number: r.body.number, url: r.body.html_url,
                state: r.body.state, into: target, head: head, base: want.base
            };
        }
        return {
            repo: repo, opened: false,
            why: (r.body && r.body.message) || ('GitHub answered ' + r.status)
                + (r.body && r.body.errors ? ' — ' + JSON.stringify(r.body.errors) : '')
        };
    }

    //=======================================================================
    //WHICH INCOMING PULL REQUESTS A JUDGE MAY READ, AND AT WHICH COMMIT.
    //
    //Everything else this app judges is its own: a branch cut here, or a cut this
    //host made. A pull request that ARRIVES is different in kind — it is somebody
    //else's code, and judging it means fetching that code onto a machine holding
    //a Claude credential, a token that can push, and this app's own ssh key.
    //Rolling the machine back afterwards does not help: anything sent out during
    //the run has already gone.
    //
    //SO A PERSON SAYS WHICH ONES, ONE AT A TIME, AND NOTHING ELSE CAN.
    //
    //KEYED TO THE COMMIT, NOT TO THE PULL REQUEST, and that is the whole reason
    //this is a record rather than a flag on a row. A pull request is a moving
    //target: its author can push again a second after it is allowed, and an
    //approval naming only the number would carry silently onto code nobody read.
    //The head sha is recorded and an allowance stops applying the moment the head
    //moves.
    //
    //WHAT IT DOES NOT SAY. That a judge may READ this commit. It is not a
    //statement that the code is safe to RUN, and nothing should ever read it as
    //one.
    //
    //IN THE HOST'S DRAWER, NOT THE WORKSPACE'S. It names `owner/name#number`,
    //which is true wherever the folder is, and a person's decision about
    //somebody else's code should not quietly stop applying because a different
    //workspace was opened.
    //
    //`prFetch` HAS NOT MOVED, and it reads the app being ported from — so an
    //allowance given here does not reach it and it refuses. That is the safe
    //direction and it is temporary: bringing an arrived pull request into the
    //workspace is a git FETCH of `pull/<n>/head`, which is a door the write half
    //of `git` does not have yet, and there is nothing to bring one here FOR
    //until a judge can read it.
    //=======================================================================
    function allowKey(on, number) { return String(on || '').trim() + '#' + Number(number); }

    function allowances() { return state.app.doc('pr-allowed'); }

    //THREE ANSWERS, BECAUSE THEY NEED THREE DIFFERENT THINGS DONE ABOUT THEM.
    //`stale` is the one worth having a word for: it is not "no" — a person has
    //looked and formed a view — and it is emphatically not "yes", because the
    //thing they looked at is gone.
    function allowCheck(on, number, sha) {
        var said = (allowances().read({}) || {})[allowKey(on, number)] || null;
        var now = String(sha || '').trim();
        if (!said) return { allowed: false, stale: false, said: null, why: 'nobody has allowed this pull request to be judged' };
        if (!now) return { allowed: false, stale: false, said: said, why: 'this host does not know which commit the pull request is at, so an allowance cannot be matched to it' };
        if (said.sha !== now) {
            return {
                allowed: false, stale: true, said: said,
                why: 'it was allowed at ' + said.sha.slice(0, 7) + ' and is now at ' + now.slice(0, 7)
                    + ' — the author has pushed since, so what was read is not what is there'
            };
        }
        return { allowed: true, stale: false, said: said, why: null };
    }

    var undo = [];
    if (actions) {
        //ASKS GITHUB, unlike the same question on the Overview row, which is
        //answered from the last gathering because it is redrawn every few
        //seconds. This one is pressed on purpose and the answer that matters is
        //about the commit the pull request is on NOW.
        undo.push(actions.define('prJudging', {
            about: 'Pull requests that have arrived, who wrote them, and whether a judge may read them',
            run: async function () {
                var known = await relayed('repositories');
                var mine = (known && known.repos) || [];
                var rows = [];

                //WHOSE REMOTES ARE OURS, worked out once, and the test is where
                //the branch LIVES rather than who typed it. A cut this host made
                //pushes to a fork this host owns, so its head repository is one
                //of ours; anything else came from somewhere this app does not
                //control.
                var ours = {};
                mine.forEach(function (r) {
                    if (r.remote && r.remote.owner) ours[r.remote.owner + '/' + r.remote.repo] = true;
                });

                for (var i = 0; i < mine.length; i++) {
                    var r = mine[i];
                    var on = r.issuesOn || (r.remote && r.remote.owner ? r.remote.owner + '/' + r.remote.repo : null);
                    if (!on) continue;
                    var bits = on.split('/');
                    var said = null;
                    try { said = await github.call('GET', '/repos/' + bits[0] + '/' + bits[1] + '/pulls?state=open&per_page=100'); }
                    catch (e) { continue; }
                    if (said.status !== 200 || !Array.isArray(said.body)) continue;

                    said.body.forEach(function (p) {
                        var from = String((p.head && p.head.repo && p.head.repo.full_name) || '').trim();
                        var sha = (p.head && p.head.sha) || null;
                        var isOurs = from ? !!ours[from] : false;
                        var may = allowCheck(on, p.number, sha);
                        rows.push({
                            on: on, repo: r.repo, number: p.number, title: p.title, url: p.html_url,
                            author: (p.user && p.user.login) || null,
                            //GitHub's own word for how close the author is to the
                            //repository. Reported rather than interpreted — "is
                            //this person trusted" is not this app's judgement to
                            //make, and the answer it would give is somebody's
                            //GitHub permissions rather than their intentions.
                            association: p.author_association || null,
                            headRepo: from || null, headSha: sha,
                            ours: isOurs,
                            allowed: isOurs ? true : may.allowed,
                            stale: isOurs ? false : may.stale,
                            why: isOurs ? null : may.why,
                            said: may.said || null
                        });
                    });
                }

                var waiting = rows.filter(function (x) { return !x.ours && !x.allowed; });
                return {
                    pulls: rows,
                    waiting: waiting.length,
                    note: rows.length
                        ? (waiting.length
                            ? waiting.length + ' pull request(s) arrived from outside and cannot be judged until you allow it. '
                                + 'Allowing names the commit: if the author pushes again it has to be allowed again.'
                            : 'Every open pull request here is either this host\'s own or has been allowed at the commit it is on.')
                        : 'No open pull requests.'
                };
            }
        }));

        undo.push(actions.define('prAllowJudging', {
            about: 'Allow a judge to read an incoming pull request, at the commit it is on now',
            takes: ['repo', 'number', 'note'],
            run: async function (args) {
                var a = args || {};
                //A MODEL MAY NOT DECIDE THAT SOMEBODY ELSE'S CODE IS FIT TO BE
                //READ HERE. This is the same boundary as approving a job, and it
                //is the one the standing rule about incoming pull requests is
                //about.
                if (a._overTheWire) {
                    throw new Error('Allowing a pull request to be judged is done in the window, by a person who has looked at it. '
                        + 'A model may not decide that somebody else\'s code is fit to be read here.');
                }

                var repo = String(a.repo || '').trim();
                var number = Number(a.number);
                if (!repo || !number) throw new Error('Say which repository and which pull request.');

                var known = await relayed('repositories');
                var row = ((known && known.repos) || []).filter(function (r) { return r.repo === repo; })[0];
                if (!row) throw new Error('There is no repository called "' + repo + '" in this workspace.');

                var on = row.issuesOn || (row.remote && row.remote.owner ? row.remote.owner + '/' + row.remote.repo : null);
                if (!on) throw new Error('"' + repo + '" has no GitHub remote this host can read from.');

                var bits = on.split('/');
                var r = await github.call('GET', '/repos/' + bits[0] + '/' + bits[1] + '/pulls/' + number);
                if (r.status !== 200 || !r.body) throw new Error(on + ' has no pull request #' + number + '.');

                //WITHOUT A COMMIT THERE IS NOTHING TO RECORD IT AGAINST, and an
                //allowance with no commit is one that carries onto whatever the
                //author pushes next.
                var sha = r.body.head && r.body.head.sha;
                if (!sha) {
                    throw new Error('GitHub did not say which commit ' + on + '#' + number + ' is at, so there is nothing to record an allowance against.');
                }

                var doc = allowances();
                var all = doc.read({}) || {};
                all[allowKey(on, number)] = {
                    on: on, number: number, sha: sha,
                    //WHO ALLOWED A STRANGER'S CODE TO BE READ HERE is exactly the
                    //question somebody asks afterwards, and the answer must not
                    //be reconstructed from memory.
                    by: actions.whoAsked(a),
                    note: a.note ? String(a.note) : null,
                    at: new Date().toISOString()
                };
                doc.write(all);

                log.good('#' + number + ' on ' + on + ' may be judged at ' + sha.slice(0, 7));
                return {
                    allowed: all[allowKey(on, number)],
                    note: on + '#' + number + ' may be read at ' + sha.slice(0, 7) + '. '
                        + 'This says a judge may READ that commit — it is not a statement that the code is safe to run, '
                        + 'and the allowance stops applying the moment the author pushes again.'
                };
            }
        }));

        undo.push(actions.define('prForbidJudging', {
            about: 'Take back an allowance to judge an incoming pull request',
            takes: ['repo', 'number'],
            run: async function (args) {
                var a = args || {};
                //IN THE WINDOW, LIKE GIVING ONE. Taking one back is the safe
                //direction and could be argued either way — but an allowance is
                //a person's statement, and something that can be withdrawn from
                //outside can be withdrawn at a moment nobody notices, which is
                //how a judging job fails in a way that reads as a bug.
                if (a._overTheWire) throw new Error('Taking an allowance back is done in the window, like giving one.');

                var repo = String(a.repo || '').trim();
                var number = Number(a.number);
                if (!repo || !number) throw new Error('Say which repository and which pull request.');

                var known = await relayed('repositories');
                var row = ((known && known.repos) || []).filter(function (r) { return r.repo === repo; })[0];
                if (!row) throw new Error('There is no repository called "' + repo + '" in this workspace.');
                var on = row.issuesOn || (row.remote && row.remote.owner ? row.remote.owner + '/' + row.remote.repo : null);
                if (!on) throw new Error('"' + repo + '" has no GitHub remote this host can read from.');

                var id = allowKey(on, number);
                var doc = allowances();
                var all = doc.read({}) || {};
                var had = all[id] || null;
                if (had) { delete all[id]; doc.write(all); log.warn('#' + number + ' on ' + on + ' may no longer be judged'); }
                return {
                    forgotten: had,
                    note: had
                        ? on + '#' + number + ' may no longer be judged. A judgement already running is not stopped by this — '
                            + 'it stops the next one being asked for.'
                        : 'Nothing was allowing ' + on + '#' + number + '.'
                };
            }
        }));
        undo.push(actions.define('prCuts', {
            about: 'Every PR cut: one act, one pull request per repository, and how far each has got',
            run: async function () {
                var all = await read(landings);
                if (all === null) return { cuts: [], drafts: [], note: 'No workspace is open, so there are no PR cuts.' };

                var rows = [];
                var names = Object.keys(all);
                for (var i = 0; i < names.length; i++) {
                    rows.push(await stateOf(all[names[i]]));
                }

                //A DRAFT IS A CUT THAT HAS NOT LEFT YET, and it belongs at the
                //top rather than sorted among the finished ones. Seventeen landed
                //cuts are history and want nothing; the one thing waiting for a
                //person is the reason somebody opened this pane.
                var written = (await read(drafts)) || {};
                var waiting = Object.keys(written).map(function (k) {
                    return Object.assign({ id: k, draft: true }, written[k]);
                });

                var live = rows.filter(function (r) { return !r.landed; });
                return {
                    cuts: rows.sort(function (a, b) { return String(b.touched || b.opened).localeCompare(String(a.touched || a.opened)); }),
                    drafts: waiting,
                    note: (waiting.length ? waiting.length + ' written and not sent. ' : '')
                        + (rows.length
                            ? rows.length + ' cut' + (rows.length === 1 ? '' : 's') + ', ' + live.length + ' not landed yet.'
                            : 'Nothing has been sent from here yet.')
                };
            }
        }));

        undo.push(actions.define('prDrafts', {
            about: 'What has been written for a pair of lines and not sent',
            run: async function () {
                var all = await read(drafts);
                if (all === null) return { drafts: [], note: 'No workspace is open.' };
                var rows = Object.keys(all).map(function (k) { return Object.assign({ id: k }, all[k]); });
                return {
                    drafts: rows,
                    note: rows.length ? rows.length + ' written and not sent.' : 'Nothing written and unsent.'
                };
            }
        }));

        undo.push(actions.define('prDraft', {
            about: 'What has been written for one pair of lines',
            takes: ['source', 'target'],
            run: async function (args) {
                var a = args || {};
                if (!a.source || !a.target) throw new Error('Say which two lines — what is being proposed, and what it would go into.');
                var all = (await read(drafts)) || {};
                var k = key(a.source, a.target);
                return { id: k, source: a.source, target: a.target, draft: all[k] || null, note: all[k] ? null : 'Nothing written for this pair yet.' };
            }
        }));

        undo.push(actions.define('prDraftSave', {
            about: 'Keep what has been written for a pair of lines, without cutting anything',
            takes: ['source', 'target', 'title', 'body'],
            run: async function (args) {
                var a = args || {};
                if (!a.source || !a.target) throw new Error('Say which two lines.');
                var doc = await drafts();
                var all = doc.read({}) || {};
                var k = key(a.source, a.target);
                all[k] = {
                    source: a.source, target: a.target,
                    title: a.title == null ? (all[k] || {}).title : String(a.title),
                    body: a.body == null ? (all[k] || {}).body : String(a.body),
                    by: actions.whoAsked(a),
                    at: new Date().toISOString()
                };
                doc.write(all);
                //NOTHING IS SENT, and the sentence says so — this button sits
                //beside one that does send, and the two must not read alike.
                return { id: k, draft: all[k], note: 'Kept. Nothing has been pushed and no pull request has been opened.' };
            }
        }));

        undo.push(actions.define('prTemplate', {
            about: 'Which blocks are added to the body of every pull request this app opens',
            run: async function () {
                var rows = await blocksOn();
                var count = rows.filter(function (b) { return b.on; }).length;
                return {
                    blocks: rows,
                    note: count
                        ? count + ' of ' + rows.length + ' blocks are added under whatever is written.'
                        : 'Nothing is added. What is typed is what is sent.'
                };
            }
        }));

        undo.push(actions.define('prTemplateSet', {
            about: 'Turn a template block on or off',
            takes: ['id', 'on'],
            run: async function (args) {
                var a = args || {};
                var id = String(a.id || '').trim();
                if (!BLOCKS.some(function (b) { return b.id === id; })) {
                    throw new Error('"' + id + '" is not a block. It is one of: '
                        + BLOCKS.map(function (b) { return b.id; }).join(', ') + '.');
                }
                var want = a.on === true || a.on === 'true' || a.on === 1 || a.on === '1';
                var doc = await template();
                var now = doc.read({}) || {};
                now[id] = want;
                doc.write(now);

                var row = (await blocksOn()).filter(function (b) { return b.id === id; })[0];
                return { blocks: await blocksOn(), note: '"' + row.label + '" is ' + (want ? 'added' : 'not added') + '.' };
            }
        }));

        //---- WHAT WOULD ACTUALLY GO OUT --------------------------------------
        //
        //THE LAST THING BETWEEN WRITING A PULL REQUEST AND PUBLISHING IT. What
        //`prDraftSave` stores is what somebody typed; what goes to GitHub is
        //that with every template block on this host appended under it, into a
        //repository this host does not own. Those are not the same text and not
        //obviously the same address, and the difference is only visible here.
        //
        //IT PUBLISHES NOTHING, which is why it is allowed over the wire when
        //`prCutMake` is not: reading what a press would do is not the press.
        //
        //AND IT NEVER GUESSES. Before a cut exists its pull requests have no
        //numbers, so the cross-links show `?` rather than a plausible number —
        //a preview that invents is the one thing a preview must not do, since
        //its whole job is being believed.
        undo.push(actions.define('prTemplatePreview', {
            about: 'What the pull requests would say for a pair of lines, composed from the blocks that are on',
            needs: 'workspace',
            takes: ['source', 'target', 'title', 'body', 'repo'],
            run: async function (args) {
                var a = args || {};
                var source = String(a.source || '').trim();
                var target = String(a.target || '').trim();

                var pair = await carrying(source, target);

                //CARRYING NOTHING IS AN ANSWER, not a refusal. It is the
                //ordinary state of a pair somebody is still working on, and the
                //pane draws it as a sentence rather than as an error.
                if (!pair.on.length) {
                    return {
                        text: '', repos: [], where: [],
                        note: '"' + source + '" carries nothing that "' + target + '" does not already '
                            + 'have, so no pull request would be opened.'
                    };
                }

                //REAL NUMBERS WHEN THERE ARE ANY. Once a cut exists its pull
                //requests have numbers, so the cross-links can be the ones an
                //edit would actually write.
                var kept = ((await landings()).read({}) || {})[key(source, target)] || null;
                var real = (kept && kept.pulls ? kept.pulls : []).filter(function (p) { return p.number; });

                var pulls = real.length
                    ? real.map(function (p) { return { repo: p.repo, number: p.number, url: p.url }; })
                    : pair.on.map(function (r) {
                        return { repo: r.repo, number: '?', url: 'https://github.com/…/pull/?  (' + r.repo + ')' };
                    });

                var on = pair.on.map(function (r) { return r.repo; });
                var which = a.repo && on.indexOf(a.repo) >= 0 ? a.repo : on[0];
                var typed = String(a.body || '').trim();

                //---- WHERE EACH ONE WOULD GO ---------------------------------
                //
                //`repos` IS A LIST OF NAMES, which answers "how many" and not
                //"into whose". Only one of those is worth asking before pressing
                //a button that publishes: a pull request goes FROM a fork this
                //host pushes to, INTO a repository somebody else owns, and here
                //those are two different accounts.
                //
                //THE WHOLE ADDRESS, NOT ONLY THE OWNER AND NAME. Two forks can
                //differ by one character in the middle of a word, and which of
                //them receives this is exactly what is being checked.
                //THE TARGET IS WORKED OUT THE WAY `openOne` WORKS IT OUT, from
                //`repositories`' own `target.on`, falling back to this
                //repository's own remote. Not from anything on the git remote
                //itself: `git.origin` answers `{ url, owner, repo, kind }` and
                //has no idea a fork has a parent, so a preview reading a
                //`parent` field off it would quietly show every pull request
                //going into the fork it came from.
                //
                //THAT IS THE FAILURE `openOne` IS WRITTEN AGAINST — "it opens a
                //pull request inside the fork... which looks perfectly normal,
                //reports success, and lands the work nowhere anybody is
                //watching". A preview that showed it landing in the right place
                //while the press sent it somewhere else would be worse than no
                //preview, because its whole job is being believed.
                var known = await relayed('repositories');
                var rows = (known && known.repos) || [];

                var where = [];
                for (var i = 0; i < pair.on.length; i++) {
                    var r = pair.on[i];
                    var remote = null;
                    try { remote = await refs.origin(r.repo); } catch (e) { remote = null; }

                    var mine = remote && remote.owner ? remote.owner + '/' + remote.repo : null;
                    var row = rows.filter(function (x) { return x.repo === r.repo; })[0];
                    var into = (row && row.target && row.target.on) || mine;

                    where.push({
                        repo: r.repo, branch: r.head, base: r.base, ahead: r.ahead,
                        from: mine, into: into,
                        //AND WHETHER IT CROSSES AT ALL, which is the one-word
                        //version of the two addresses under it.
                        crossing: !!(mine && into && into !== mine),
                        fromUrl: mine ? 'https://github.com/' + mine : null,
                        intoUrl: into ? 'https://github.com/' + into : null
                    });
                }

                var context = {
                    branch: (pair.on[0] || {}).head,
                    me: which,
                    repos: on,
                    pulls: pulls
                };

                return {
                    repos: on,
                    where: where,
                    showing: which,
                    //SEPARATELY, so the window can recompose as somebody types
                    //without asking again. What the blocks add depends on the
                    //pair and on which copy — never on what is typed — so it is
                    //fetched once and the sentence in front of it joined on
                    //locally.
                    additions: await compose('', context),
                    text: await compose(typed, context),
                    title: String(a.title || '').trim() || (kept && kept.said && kept.said.title) || source,
                    said: (kept && kept.said) || null,
                    existing: kept ? { count: real.length, opened: kept.opened } : null,
                    guessing: !real.length,
                    note: 'As ' + which + ' would read it. ' + on.length + ' repositor'
                        + (on.length === 1 ? 'y' : 'ies') + ' carry work: ' + on.join(', ') + '.'
                        + (real.length
                            ? ' The links are the real pull request numbers.'
                            : ' Nothing is cut yet, so the links show ? until it is.')
                };
            }
        }));

        //---- sending it out --------------------------------------------------
        //
        //ONE LANDING, N PULL REQUESTS. Each repository that carries something
        //gets its branch pushed and a pull request opened, and the whole thing is
        //recorded under one key so it can be read as one change afterwards.
        //
        //PUSHED FIRST, THEN OPENED. A pull request against a branch the far end
        //has never seen is a 422 with nothing useful in it.
        //
        //AND THE CROSSLINKS ARE WRITTEN LAST, in a second pass, because the
        //numbers do not exist until every one of them is open.
        undo.push(actions.define('prCutMake', {
            about: 'Push a line onward and open a pull request per repository, tracked together as one landing',
            takes: ['source', 'target', 'title', 'body', 'into', 'draft'],
            run: async function (args) {
                var a = args || {};
                notFromThePipe(a);

                var source = String(a.source || '').trim();
                var target = String(a.target || '').trim();
                if (!source || !target) throw new Error('Say which line is being proposed and which it would go into.');
                if (!String(a.title || '').trim()) throw new Error('Give it a title — it is the first thing a reviewer reads.');

                var pair = await carrying(source, target);
                if (!pair.on.length) {
                    throw new Error('"' + source + '" carries nothing that "' + target + '" does not already have.');
                }

                //THE CREDENTIAL COMES FROM ../../keys AND IS NOT LOOKED AT HERE.
                //`env` and `helper` go straight to git; this file never reads
                //either, and could not say what is in them.
                var env = keys.github.envForPush();
                var helper = keys.github.credentialHelper;

                var doc = await landings();
                var opened = [];

                for (var i = 0; i < pair.on.length; i++) {
                    var w = pair.on[i];

                    var sent = await git.push(w.repo, w.head, { env: env, helper: helper });
                    if (!sent.pushed) {
                        opened.push({ repo: w.repo, opened: false, head: w.head, base: w.base, why: 'it could not be pushed — ' + sent.why });
                        continue;
                    }

                    var note = ((await relayed('branchBoard')) || {});
                    var row = ((note.branches) || []).filter(function (b) { return b.name === w.head; })[0] || null;

                    var body = await compose(a.body, {
                        branch: w.head, me: w.repo,
                        repos: pair.on.map(function (x) { return x.repo; }),
                        note: row ? row.note : null,
                        carries: row ? row.on : [],
                        pulls: opened
                    });

                    opened.push(await openOne(w.repo, {
                        head: w.head, base: w.base, title: String(a.title).trim(),
                        body: body, into: a.into || null, draft: !!a.draft
                    }));
                }

                //RECORDED WHATEVER HAPPENED, including the ones that did not
                //open. A cut where two of three went out is the state somebody
                //most needs to see, and losing the record of it would leave two
                //pull requests nothing here knows about.
                var all = doc.read({}) || {};
                var k = key(source, target);
                var was = all[k] || { source: source, target: target, opened: new Date().toISOString(), by: actions.whoAsked(a), pulls: [] };
                var merged = was.pulls.slice();
                opened.forEach(function (p) {
                    var at = merged.map(function (x) { return x.repo; }).indexOf(p.repo);
                    if (at < 0) merged.push(p); else merged[at] = Object.assign({}, merged[at], p);
                });
                all[k] = Object.assign({}, was, { pulls: merged, touched: new Date().toISOString() });
                doc.write(all);

                //AND THE DRAFT IS DONE WITH, because it has been sent.
                try {
                    var dd = await drafts();
                    var written = dd.read({}) || {};
                    if (written[k]) { delete written[k]; dd.write(written); }
                } catch (e) { /* nothing was written for it */ }

                var went = opened.filter(function (p) { return p.opened; });
                var stuck = opened.filter(function (p) { return !p.opened; });
                log.good('cut "' + source + '" into "' + target + '" — ' + went.length + ' pull request(s) opened');

                return {
                    source: source, target: target, pulls: opened, opened: went.length,
                    note: went.length + ' of ' + opened.length + ' opened.'
                        + (stuck.length ? ' ' + stuck.map(function (p) { return p.repo + ' — ' + p.why; }).join('; ') : '')
                };
            }
        }));

        //---- landing it ------------------------------------------------------
        //
        //A PERSON PRESSING THE BUTTON IN THE WINDOW IS THAT PERSON LANDING THEIR
        //OWN CHANGE. Anything else is a model merging into somebody's repository,
        //and that has to have been said out loud first — which is what testing
        //mode being on for this workspace means.
        undo.push(actions.define('prCutLand', {
            about: 'Merge every pull request in a cut, so the change lands as one thing',
            takes: ['source', 'target', 'how'],
            run: async function (args) {
                var a = args || {};
                if (a._overTheWire) {
                    var may = await settings.allowed();
                    if (!may.allowed) {
                        throw new Error('Landing a cut from outside the window is only done while testing mode is on for this workspace. '
                            + may.why + ' A person pressing the button in the window is that person landing their own change; '
                            + 'this is a model merging into somebody\'s repository, and that needs to have been said out loud first.');
                    }
                }

                var all = await read(landings);
                if (all === null) throw new Error('No workspace is open.');
                var rec = all[key(a.source, a.target)];
                if (!rec) throw new Error('Nothing has been cut from "' + a.source + '" into "' + a.target + '" from here.');

                var at = await stateOf(rec);
                var open = at.pulls.filter(function (p) { return p.number && p.state !== 'merged' && p.state !== 'closed'; });
                var already = at.pulls.filter(function (p) { return p.state === 'merged'; });

                if (!open.length) {
                    return {
                        merged: [], note: already.length
                            ? 'Already landed: all ' + already.length + ' pull request(s) are merged.'
                            : 'There is nothing open to merge in this cut.'
                    };
                }

                var how = String(a.how || 'squash');
                var done = [];
                for (var i = 0; i < open.length; i++) {
                    var p = open[i];
                    var bits = String(p.into || '').split('/');
                    if (bits.length !== 2) {
                        var remote = await refs.origin(p.repo);
                        bits = [remote.owner, remote.repo];
                    }
                    var r = await github.call('PUT', '/repos/' + bits[0] + '/' + bits[1] + '/pulls/' + p.number + '/merge',
                        { merge_method: how });
                    done.push({
                        repo: p.repo, number: p.number,
                        merged: r.status === 200,
                        why: r.status === 200 ? null : ((r.body && r.body.message) || ('GitHub answered ' + r.status))
                    });
                }

                var went = done.filter(function (d) { return d.merged; });
                log.warn('landed ' + went.length + ' of ' + done.length + ' in "' + a.source + '"');
                return {
                    merged: done, landed: went.length,
                    //PARTLY LANDED IS THE STATE WORTH SAYING LOUDEST. The whole
                    //point of a cut is that it lands as one thing, and half of it
                    //being in is the situation somebody has to deal with by hand.
                    note: went.length === done.length
                        ? 'Landed: ' + went.length + ' pull request(s) merged.'
                        : went.length + ' of ' + done.length + ' merged — this change is PARTLY IN. '
                            + done.filter(function (d) { return !d.merged; })
                                .map(function (d) { return d.repo + ' #' + d.number + ' — ' + d.why; }).join('; ')
                };
            }
        }));

        undo.push(actions.define('prCutUpdate', {
            about: 'Change the title, the description, or the state of every pull request in a cut at once',
            takes: ['source', 'target', 'title', 'body', 'state'],
            run: async function (args) {
                var a = args || {};
                notFromThePipe(a);

                var all = await read(landings);
                if (all === null) throw new Error('No workspace is open.');
                var rec = all[key(a.source, a.target)];
                if (!rec) throw new Error('Nothing has been cut from "' + a.source + '" into "' + a.target + '" from here.');

                var fields = {};
                if (a.title != null) fields.title = String(a.title);
                if (a.body != null) fields.body = String(a.body);
                if (a.state != null) fields.state = String(a.state);
                if (!Object.keys(fields).length) throw new Error('Say what to change — a title, a description, or the state.');

                var done = [];
                for (var i = 0; i < (rec.pulls || []).length; i++) {
                    var p = rec.pulls[i];
                    if (!p.number) continue;
                    var bits = String(p.into || '').split('/');
                    if (bits.length !== 2) {
                        var remote = await refs.origin(p.repo);
                        bits = [remote.owner, remote.repo];
                    }
                    var r = await github.call('PATCH', '/repos/' + bits[0] + '/' + bits[1] + '/pulls/' + p.number, fields);
                    done.push({
                        repo: p.repo, number: p.number, changed: r.status === 200,
                        why: r.status === 200 ? null : ((r.body && r.body.message) || ('GitHub answered ' + r.status))
                    });
                }

                //WHAT WAS SAID IS KEPT, so the next thing that composes a body
                //starts from what is actually on the pull requests.
                var doc = await landings();
                var now = doc.read({}) || {};
                var k = key(a.source, a.target);
                if (now[k]) {
                    now[k] = Object.assign({}, now[k], {
                        said: Object.assign({}, now[k].said || {}, fields, { at: new Date().toISOString() })
                    });
                    doc.write(now);
                }

                var went = done.filter(function (d) { return d.changed; });
                return {
                    on: done, changed: went.length,
                    note: went.length + ' of ' + done.length + ' changed.'
                        + (went.length === done.length ? '' : ' ' + done.filter(function (d) { return !d.changed; })
                            .map(function (d) { return d.repo + ' #' + d.number + ' — ' + d.why; }).join('; '))
                };
            }
        }));

        undo.push(actions.define('prCutForget', {
            about: 'Stop tracking a PR cut here. The pull requests on GitHub are untouched',
            takes: ['source', 'target'],
            run: async function (args) {
                var a = args || {};
                if (!a.source || !a.target) throw new Error('Say which two lines.');
                var doc = await landings();
                var all = doc.read({}) || {};
                var k = key(a.source, a.target);
                if (!all[k]) throw new Error('There is no cut from "' + a.source + '" to "' + a.target + '" here.');

                var was = all[k];
                delete all[k];
                doc.write(all);

                log.warn('stopped tracking the cut ' + k);
                return {
                    forgotten: k, was: was,
                    //THE PULL REQUESTS ARE UNTOUCHED, and saying so is the point.
                    //"Forget" is a word somebody might read as "close them".
                    note: 'No longer tracked here. The ' + (was.pulls || []).length
                        + ' pull request(s) on GitHub are untouched — open, merged or closed exactly as they were.'
                };
            }
        }));
    }

    await register(null, {
        prcuts: {
            all: function () { return read(landings); },
            stateOf: stateOf,
            compose: compose,
            blocks: blocksOn,
            key: key,
            //ONE PLACE ANSWERS "MAY THIS BE READ HERE", and everything that
            //leads to the same room asks it here rather than reading the store
            //itself. A second reader is a second chance to get the staleness
            //rule slightly different.
            allowed: { check: allowCheck, all: function () { return allowances().read({}) || {}; } }
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
