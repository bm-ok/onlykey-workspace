//NOT `workspace`, WHICH IS THE SERVICE THIS FILE ALREADY HAS.
//
//`var workspace = imports.workspace` inside the plugin would shadow a
//module-level `workspace` for the whole function — so `workspace.script(...)`
//would reach the workspace SERVICE, which has no such method, and fail at the
//moment a machine is waiting.
//
//The app being ported from paid for exactly this once, with `log`: a local named
//`log` shadowed the logger, and the line recording a machine as holding a
//sign-in threw `log.on is not a function` AFTER the credential had already
//landed. `node --check` passes on it and so does every reading of the line in
//isolation. The only defence is not to reuse the word.
var layout = require('./workspace');
var makeSettingUp = require('./setting-up');
var serving = require('./serve');
var makeGitApi = require('./gitapi');
var makeFreeing = require('../branches/freeing');
var reach = require('../branches/reach');
var revising = require('../pr/revising');

//---------------------------------------------------------------------------
//THE REPOSITORIES IN THIS WORKSPACE, AND WHAT GITHUB SAYS ABOUT THEM.
//
//THE THIRD LAYER, AND THE POINT OF THE OTHER TWO. This plugin opens no
//credential, holds none, and does not consume ../../keys at all — look at the
//`consumes` line. It asks ../../github for what it needs, and ../../github asks
//../../keys to sign what it built. Nothing here knows a token exists.
//
//    keys          holds it. Two named exits, and a test that counts them.
//    github        the API. Builds a request, has it signed, never holds it.
//    repositories  this. Asks a question, gets an answer.
//
//THE SAME SHAPE AS `git`. What a repository IS and where it lives is ../../
//workspace's; running git is ../../git's; talking to GitHub is ../../github's.
//What is left here — and it is the only thing here — is the QUESTION: which of
//these repositories can this host actually work with, and what is stopping the
//ones that cannot.
//
//---- what is asked, and what is merely read -------------------------------
//
//`repositories` READS AND ASKS NOTHING. It is drawn on a timer by a pane, and a
//pane that asks GitHub every few seconds is a pane that spends somebody's rate
//limit on being looked at. What it returns is what was last learnt, with the
//date on it, so "as of" is visible rather than implied.
//
//`repositoriesCheck` IS THE TRIP. Reachability, what the token may do, and what
//is open — on one journey, because they are one journey and three buttons would
//be three round trips to the same place.
//
//---- and what the token may do is PROBED, not read ------------------------
//
//This is the part worth porting carefully, because getting it wrong is silent.
//`permissions` on a GitHub repository object describes THE ACCOUNT, not the
//token acting for it. A fine-grained token reports `push: true, admin: true`
//there and is then refused with "Resource not accessible by personal access
//token" the moment it asks for anything.
//
//That is not hypothetical: it happened on this app's first real check — full
//permissions reported, branches refused, and a "may push" that would have been
//believed right up until a push failed at the end of an hour's work.
//
//So each capability is established by ASKING FOR THE THING ITSELF. Two extra
//requests, on an action nobody runs on a timer, and it is the difference between
//describing an account and describing what will actually work.
//---------------------------------------------------------------------------

//---- AND WHAT SETTING A MACHINE UP NEEDS ---------------------------------
//
//`ours` and `channel` are the machine; `lines` says which repositories a branch
//is about and what is protected; `prcuts` answers whether a protected one may
//still be revised; `tls` and `guestApi` are what the machine has to trust and
//where it has to reach. `vbox` is asked one question — this host's address on
//the network the machines are on.
//`tls`, `guestApi` and `vbox` came in with `vmWorkspace` and went out with it.
//A consumes line is a claim about what this plugin can reach, and the boundary
//test above it only counts for as much as that line is kept honest.
plugin.consumes = ['app', 'log', 'git', 'github', 'workspace', 'state', 'refs',
    'ours', 'channel', 'lines', 'prcuts',
    //THE DOOR A MACHINE CLONES THROUGH -- see ./gitapi.js. Not a cycle:
    //../../vms/https consumes app, log, tls, ours and channel, and none of
    //those reaches back here. Worth checking rather than assuming, because
    //an unresolved or circular name takes down the WHOLE graph rather than
    //this plugin.
    'guestApi'];
plugin.provides = ['repositories', 'repoWorkspaces'];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log;
    var git = imports.git;
    var github = imports.github;
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


    //IN THE WORKSPACE'S DRAWER, NOT THE HOST'S. What GitHub says about
    //`local-repo-a` is a fact about the folder of repositories that is open —
    //open a different workspace and it is a different `local-repo-a`, or none.
    //This is the second caller of `state.here`, and the app being ported from
    //keeps the same file per workspace for the same reason.
    async function kept() { return state.here.doc('repositories'); }

    //WHERE EACH REPOSITORY BELONGS, recorded on first sight — see
    //../branches/freeing. In the WORKSPACE's drawer, because "where local-repo-a
    //belongs" is a fact about the folder that is open.
    async function defaults() { return state.here.doc('repo-defaults'); }

    async function read() {
        try { return (await kept()).read({}) || {}; }
        //NO WORKSPACE OPEN IS NOT AN EMPTY WORKSPACE. `state.here` refuses
        //rather than answering from the host's drawer, and a read that turned
        //that into `{}` would report "nothing known" about somewhere that is not
        //open at all.
        catch (e) { return null; }
    }

    //WHAT THE ANSWER LOOKS LIKE WHEN NOTHING CAN BE ASKED. Named once so the two
    //actions cannot disagree about it.
    function unasked(name, remote, why, reachable) {
        return {
            repo: name,
            remote: remote || null,
            reachable: reachable === undefined ? null : reachable,
            why: why,
            openPulls: null,
            may: null,
            at: new Date().toISOString()
        };
    }

    //WHERE WORK IS SENT AND WHERE ISSUES ARE READ FROM.
    //
    //NEVER NULL WHILE THERE IS A REMOTE AT ALL: unset means your own repository,
    //which is right for anything that is not a fork and is a reasonable default
    //for one that is. `repoTargetSet` is how somebody chooses otherwise, and
    //`chosen` is what lets every surface say WHICH of the two it is showing —
    //"the fork you picked" and "your own, because nothing was picked" are the
    //same string in different situations.
    function targetFrom(note, remote) {
        var self = remote && remote.owner ? remote.owner + '/' + remote.repo : null;
        var picked = note && note.target && note.target.on ? String(note.target.on) : null;
        return picked || self;
    }

    function targetOf(note, remote) {
        var self = remote && remote.owner ? remote.owner + '/' + remote.repo : null;
        var picked = note && note.target && note.target.on ? String(note.target.on) : null;
        return {
            on: picked || self,
            self: self,
            chosen: !!picked,
            at: (note && note.target && note.target.at) || null,
            by: (note && note.target && note.target.by) || null,
            why: (note && note.target && note.target.why) || null,
            //whether anything upstream is this app's business at all
            upstream: !!picked && picked !== self
        };
    }

    //THE SHA THE DEFAULT BRANCH IS AT, over there. Taken from the branch list
    //that was already fetched rather than by asking again — and null rather than
    //a guess when the token could not read the branches.
    function headOfList(branchList, want) {
        if (!want || branchList.status !== 200 || !Array.isArray(branchList.body)) return null;
        var found = branchList.body.filter(function (b) { return b.name === want; })[0];
        return (found && found.commit && found.commit.sha) || null;
    }

    //---- one repository, asked ---------------------------------------------
    async function ask(name, note) {
        var remote = null;
        try { remote = await refs.origin(name); }
        catch (e) { return unasked(name, null, 'this is not a repository this workspace knows about: ' + e.message, false); }

        if (!remote || !remote.owner || !remote.repo) {
            return unasked(name, remote, 'no remote called origin, so there is nowhere to ask about', false);
        }
        if (remote.kind !== 'github') {
            //SAID RATHER THAN GUESSED AT. Building a GitHub API path out of a
            //GitLab remote gets a 404 that means nothing.
            return unasked(name, remote,
                'origin is ' + (remote.host || 'somewhere') + ', which this cannot ask about — only github.com is understood so far',
                null);
        }

        var at = '/repos/' + remote.owner + '/' + remote.repo;
        var r;
        try { r = await github.call('GET', at); }
        catch (e) {
            //THE REFUSAL FROM ../../keys ARRIVES HERE, and it is a real answer:
            //no token, or a token kept for a different API host. It is reported
            //as the reason this repository could not be asked about, because
            //that is what it is.
            return unasked(name, remote, e.message, false);
        }

        if (r.status === 404) {
            //A FINE-GRAINED TOKEN GRANTS PER REPOSITORY, so 404 here usually
            //means "not in this token's list" rather than "does not exist" — and
            //saying the first is what stops somebody hunting for a typo.
            return unasked(name, remote, 'GitHub says 404 — either it does not exist, or this token was not granted it', false);
        }
        if (r.status !== 200) {
            return unasked(name, remote, (r.body && r.body.message) || ('GitHub answered ' + r.status), false);
        }

        //---- PROBED, NOT READ. See the header. ------------------------------
        var branchList = await github.call('GET', at + '/branches?per_page=100');
        var canReadCode = branchList.status === 200;

        var pulls = await github.call('GET', at + '/pulls?state=open&per_page=100');
        var canReadPulls = pulls.status === 200;

        //NAMED THE WAY GITHUB NAMES THEM in the token's own settings page, so
        //the missing one can be found without translating.
        var missing = [];
        if (!canReadCode) missing.push('Contents');
        if (!canReadPulls) missing.push('Pull requests');

        //---- WHERE A PULL REQUEST WOULD ACTUALLY GO --------------------------
        //
        //A FORK IS NOT A DETAIL ABOUT A REPOSITORY, it is the answer to that
        //question: a pull request from a fork is created IN THE PARENT, with
        //`head: owner:branch`. So a token scoped to the forks can push a branch
        //and still be unable to open anything — a failure that arrives at the
        //last possible moment and looks like a bug in this app.
        //
        //AND A FORK OF A FORK MAKES IT A CHOICE RATHER THAN A FACT. GitHub
        //reports two: `parent` is one level up, `source` is the root of the whole
        //network. In A <- B <- C they differ, and nothing reports the middle of a
        //longer chain at all. Which one a change should go to is a decision, so
        //both are offered and the immediate parent is the default — it is the one
        //that matches how a chain is normally worked.
        var parent = r.body.parent && r.body.parent.full_name ? r.body.parent.full_name : null;
        var source = r.body.source && r.body.source.full_name ? r.body.source.full_name : null;
        var chained = !!(parent && source && parent !== source);

        //ASKED OF EACH SEPARATELY, because a token can be granted one and not the
        //other — and in a chain that is the ordinary case rather than an unlucky
        //one.
        async function canOpenIn(full) {
            if (!full) return null;
            var bits = String(full).split('/');
            var up = await github.call('GET', '/repos/' + bits[0] + '/' + bits[1] + '/pulls?state=open&per_page=1');
            return {
                repo: full,
                mayOpen: up.status === 200,
                why: up.status === 200 ? null : (up.status === 404
                    ? 'this token was not granted it, so a pull request cannot be opened there'
                    : (up.body && up.body.message) || ('GitHub answered ' + up.status))
            };
        }

        var intoParent = parent
            ? Object.assign({}, await canOpenIn(parent), { defaultBranch: r.body.parent.default_branch || null })
            : null;
        var intoSource = chained
            ? Object.assign({}, await canOpenIn(source), { defaultBranch: r.body.source.default_branch || null })
            : null;

        if (intoParent && !intoParent.mayOpen && !(intoSource && intoSource.mayOpen)) {
            missing.push('Pull requests on ' + parent);
        }

        //---- WHAT IS OPEN ---------------------------------------------------
        //
        //ISSUES ARE READ FROM THE TARGET, NOT THE FORK. Work arrives where people
        //file it, which for a fork is normally the parent — see `issuesOn` in the
        //read below, and `repoTargetSet` for how that is chosen.
        //
        //GITHUB RETURNS PULL REQUESTS FROM THE ISSUES ENDPOINT, which is a real
        //trap: every PR is also an issue there, so a list drawn from it without
        //filtering shows each pull request twice, once as itself and once as an
        //issue. `pull_request` on the row is how they are told apart.
        var on = targetFrom(note, remote);
        var issues = null;
        if (on) {
            var bits = on.split('/');
            var got = await github.call('GET', '/repos/' + bits[0] + '/' + bits[1] + '/issues?state=open&per_page=100');
            if (got.status === 200 && Array.isArray(got.body)) {
                issues = got.body.filter(function (x) { return !x.pull_request; }).map(function (x) {
                    return {
                        number: x.number, title: x.title, at: x.created_at, updated: x.updated_at,
                        by: x.user && x.user.login, url: x.html_url, on: on,
                        //ONLY OPEN ONES ARE ASKED FOR, which is exactly why the
                        //state has to be written down rather than assumed. A row
                        //with no state is not "open" to anything reading it
                        //later: the Overview pane filters on it, and every issue
                        //vanished from a list that said it had one.
                        state: x.state || 'open',
                        labels: (x.labels || []).map(function (l) { return typeof l == 'string' ? l : l.name; }),
                        //Carried so a task can be written from the Overview list
                        //without going back to the per-repository tab to find the
                        //words again.
                        body: x.body || null
                    };
                });
            }
        }

        var now = new Date().toISOString();
        return {
            repo: name,
            remote: remote,
            //RECORDED ON THE WAY OUT, so `stale` below can compare it against the
            //remote origin points at NOW. A successful check that forgot to say
            //what it was about left that guard blind from the moment it mattered
            //most: a note full of confident facts about a repository this one is
            //no longer.
            about: remote.owner + '/' + remote.repo,
            reachable: true,
            may: { code: canReadCode, pulls: canReadPulls },
            //KEPT AND CLEARLY LABELLED, because it is a true fact about a
            //different thing. `permissions` describes the ACCOUNT; `may` above
            //describes this token. Showing them side by side is what makes the
            //difference visible instead of confusing.
            accountMay: r.body.permissions || null,
            privateRepo: r.body.private == null ? null : !!r.body.private,
            fork: !!r.body.fork,
            parent: parent,
            source: source,
            chained: chained,
            intoParent: intoParent,
            intoSource: intoSource,
            upstreamDefault: r.body.default_branch || null,
            upstreamHead: headOfList(branchList, r.body.default_branch),
            branchesThere: canReadCode && Array.isArray(branchList.body) ? branchList.body.length : null,
            pulls: canReadPulls && Array.isArray(pulls.body) ? pulls.body.map(function (p) {
                return {
                    number: p.number, title: p.title, state: p.state, draft: !!p.draft,
                    merged: !!p.merged_at,
                    head: p.head && p.head.ref, base: p.base && p.base.ref,
                    by: p.user && p.user.login, at: p.created_at, updated: p.updated_at,
                    url: p.html_url,

                    //WHOSE CODE, AND WHICH COMMIT. Fine to drop while every pull
                    //request here is one this host cut; it stops being fine the
                    //moment one ARRIVES. Deciding whether a judge may read
                    //somebody else's change needs to know whose it is, and an
                    //allowance to read it names the commit or it carries onto
                    //whatever the author pushes next.
                    headRepo: (p.head && p.head.repo && p.head.repo.full_name) || null,
                    headSha: (p.head && p.head.sha) || null,

                    //GitHub's own word for how close the author is to the
                    //repository: OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE.
                    //Carried and never interpreted — "is this person trusted" is
                    //not a question this app should answer, and the answer it
                    //could give is somebody's permissions rather than their
                    //intent.
                    association: p.author_association || null
                };
            }) : null,
            openPulls: canReadPulls && Array.isArray(pulls.body) ? pulls.body.length : null,
            issues: issues,
            openIssues: issues ? issues.length : null,
            why: missing.length
                ? 'the token cannot use ' + missing.join(' or ') + ' here — add '
                    + (missing.length === 1 ? 'that permission' : 'those permissions') + ' to it on GitHub'
                : null,
            //THE TARGET SURVIVES A CHECK. It is a person's choice about
            //where work goes, not something GitHub answered, and rewriting the
            //note wholesale would quietly reset it every time somebody pressed
            //the button.
            target: (note && note.target) || null,
            checked: now,
            gathered: now,
            at: now
        };
    }

    //---- the local half, which asks nothing and nobody --------------------
    //
    //INSTANT AND ALWAYS TRUE, unlike everything remembered from GitHub. The pane
    //draws both together and the row keeps them apart: anything above `checked`
    //is this disk right now; anything below it was asked for on purpose and
    //carries when.
    async function localOf(name) {
        var out = { path: null, default: null, head: null, branches: 0 };
        try { out.path = await workspace.folderOf(name); } catch (e) { return out; }

        try {
            var all = await refs.branches(name);
            out.branches = all.length;
        } catch (e) { /* an empty repository has none, which is not an error */ }

        //THE DEFAULT BRANCH IS WHATEVER WAS CHECKED OUT WHEN THIS FIRST LOOKED,
        //remembered from then on — the same answer the app being ported from
        //gives, and for the same reason: there is no local record of a default
        //branch, only of what HEAD points at.
        try { out.default = await refs.head(name); } catch (e) { /* said as null */ }

        if (out.default) {
            try {
                var said = await git.run(name, ['rev-parse', out.default]);
                if (said.code === 0) out.head = String(said.stdout || '').trim() || null;
            } catch (e) { /* said as null */ }
        }
        return out;
    }

    //---- what setting a machine up is built from ---------------------------
    //
    //HANDED THE PIECES RATHER THAN REACHING FOR THEM, so every gate can be
    //exercised without a machine — see ./setting-up.js, which is where they are
    //and where they are tested.
    var freeing = makeFreeing({
        repos: function () { return workspace.repos(); },
        headOf: function (repo) { return imports.refs.head(repo); },
        bare: async function () { return false; },
        checkout: function (repo, to) { return imports.git.checkout(repo, to); },
        kept: {
            read: async function (fallback) { return (await defaults()).read(fallback); },
            write: async function (all) { return (await defaults()).write(all); }
        }
    });

    var settingUp = makeSettingUp({
        ours: imports.ours,
        repos: function () { return workspace.repos(); },

        //WHICH REPOSITORIES ACTUALLY HAVE IT — the union, read from the
        //repositories themselves rather than from any record of what was cut.
        carriersOf: async function (branch) {
            var all = await imports.refs.heads();
            return Object.keys(all || {}).filter(function (r) {
                return (all[r] || {})[branch];
            });
        },
        scopeOf: function (branch) { return imports.lines.scopeOf(branch); },
        headIn: async function (repo, branch) {
            var all = await imports.refs.heads([repo]);
            return ((all || {})[repo] || {})[branch] || null;
        },
        connected: function (name) { return imports.channel.connected(name); },

        //ASKED OF GIT ITSELF, once, about whichever repository is to hand. The
        //rules are the same in all of them — this is `check-ref-format`, not a
        //question about what any one repository contains.
        nameIsOk: async function (branch) {
            var found = await workspace.repos();
            if (!found.length) return true;
            return await imports.git.nameIsOk(found[0].name, branch);
        },
        defaultOf: function (repo) { return freeing.defaultOf(repo); },

        //THE PERMISSION, ASKED WHERE IT IS WRITTEN. See ../pr/revising — the
        //host's hook asks the same function, which is the whole point of it
        //being one.
        mayRevise: async function (branch) {
            return revising.mayRevise(branch, await imports.prcuts.all(), await imports.lines.protectedOf());
        },
        reach: reach
    });

    var undo = [];
    if (actions) {
        undo.push(actions.define('repositories', {
            about: 'Every repository in this workspace: where it is, its default branch, its remote, and what was last learnt about it',
            run: async function () {
                var notes = await read();
                if (notes === null) {
                    return { repos: [], note: 'No workspace is open, so there are no repositories to report on.' };
                }

                var found = await workspace.repos();
                var rows = [];

                for (var i = 0; i < found.length; i++) {
                    var name = found[i].name;
                    var note = notes[name] || {};
                    var here = await localOf(name);
                    //THE REMOTE IS READ NOW, NOT REMEMBERED. It is a local fact
                    //and it is the thing `stale` below compares against.
                    var remote = null;
                    try { remote = await refs.origin(name); } catch (e) { /* said as null */ }

                    var about = note.about || null;
                    var mine = remote && remote.owner ? remote.owner + '/' + remote.repo : null;

                    rows.push({
                        repo: name,
                        path: here.path,
                        default: here.default,
                        head: here.head,
                        branches: here.branches,
                        remote: remote,

                        //---- everything below came from the last time somebody
                        //asked GitHub, and is shown WITH WHEN, because a fact
                        //about a remote is only as true as the moment it was read
                        //and this one can be hours old.
                        checked: note.checked || null,
                        gathered: note.gathered || null,

                        //AND WHETHER WHAT IS KNOWN IS ABOUT THE REMOTE IT IS
                        //POINTED AT NOW. If origin has moved since, all of it
                        //describes somewhere else — and the dangerous shape is
                        //not an empty panel, it is a FULL one saying confident
                        //things about the wrong place. `about` is null on notes
                        //written before this existed, which reads as "unknown"
                        //rather than as "matching".
                        about: about,
                        knownFor: about && remote ? (about === mine ? 'this remote' : about) : null,
                        stale: !!(note.checked && about && remote && about !== mine),

                        reachable: note.reachable == null ? null : note.reachable,
                        why: note.why || null,
                        may: note.may || null,
                        accountMay: note.accountMay || null,
                        parent: note.parent || null,
                        source: note.source || null,
                        chained: !!note.chained,
                        intoParent: note.intoParent || null,
                        intoSource: note.intoSource || null,
                        branchesThere: note.branchesThere == null ? null : note.branchesThere,
                        privateRepo: note.privateRepo == null ? null : note.privateRepo,
                        fork: note.fork == null ? null : note.fork,
                        upstreamDefault: note.upstreamDefault || null,
                        upstreamHead: note.upstreamHead || null,

                        //COUNTED FROM THE LIST THAT IS SHOWN, not from a separate
                        //number. The check counted pull requests on the FORK and
                        //the list reads them from the PARENT, which is where they
                        //actually are — so the badge said 0 beside a pane showing
                        //one. Two places knowing the same thing and disagreeing is
                        //the fault this window keeps finding; the list wins,
                        //because the list is what somebody reads.
                        openPulls: note.pulls
                            ? note.pulls.filter(function (x) { return x.state === 'open'; }).length
                            : (note.openPulls == null ? null : note.openPulls),
                        //NULL UNTIL SOMEBODY ASKS, which is different from an
                        //empty list, and the panes say so.
                        pulls: note.pulls || null,
                        //THE ONE PLACE A NOTE BECOMES ROWS, so the fallback for
                        //an OLD note lives here and nowhere else. Notes written
                        //before the state was recorded have none, and a row with
                        //no state is not "open" to anything filtering on it —
                        //which made every issue vanish from a list whose own
                        //chip said it had one. Only the open ones are ever
                        //gathered, so that is what a silent one is.
                        issues: note.issues
                            ? note.issues.map(function (i) {
                                return i.state ? i : Object.assign({}, i, { state: 'open' });
                            })
                            : null,
                        openIssues: note.issues ? note.issues.length : null,

                        //WHERE ISSUES ARE READ FROM, which is the target and not
                        //the parent. Unset means your own remote.
                        issuesOn: targetOf(note, remote).on,
                        target: targetOf(note, remote),

                        //COMPUTED HERE RATHER THAN STORED, so it is right even
                        //when the local branch moved after the last check.
                        inStep: note.upstreamHead && here.head ? note.upstreamHead === here.head : null
                    });
                }

                return {
                    dir: await workspace.dir(),
                    repos: rows,
                    note: 'What is known about a remote is only as true as the moment it was read. Check it to ask again.'
                };
            }
        }));

        //---- one repository's branches ------------------------------------
        //
        //TWO QUESTIONS, AND THE SECOND IS THE ONE NOTHING COULD ANSWER. The
        //remote columns answer "is my copy current". `against` answers the
        //question somebody actually has — "am I done with this branch" — and it
        //is measured BY CONTENT, because a squashed pull request leaves work
        //that has landed and looks unmerged. See `unlanded` in ../../git.
        undo.push(actions.define('repoBranches', {
            about: 'The branches in one repository: where each is here, where origin has it, and which are out of step',
            takes: ['repo'],
            run: async function (args) {
                var a = args || {};
                var name = String(a.repo || '').trim();
                if (!name) throw new Error('Say which repository.');

                var found = await workspace.repos();
                if (!found.some(function (r) { return r.name === name; })) {
                    throw new Error('There is no repository called "' + name + '" here. This workspace has: '
                        + found.map(function (r) { return r.name; }).join(', ') + '.');
                }

                var here = await localOf(name);
                var def = here.default;
                var rows = await refs.of(name);

                var out = [];
                var names = Object.keys(rows).sort(function (x, y) { return x.localeCompare(y); });
                for (var i = 0; i < names.length; i++) {
                    var b = rows[names[i]];
                    if (!def || b.branch === def || !b.local) {
                        out.push(Object.assign({}, b, { against: null }));
                        continue;
                    }
                    var behind = await git.countBetween(name, b.branch, def);
                    //THROUGH ../refs. Asking git directly cost two rev-parse
                    //processes to build the cache key, on a HIT as well as a
                    //miss — and the shas are already in `rows` above.
                    var left = await refs.unlanded(name, def, b.branch);
                    out.push(Object.assign({}, b, {
                        against: {
                            base: def,
                            behind: behind || 0,
                            unlanded: left,
                            //THREE STATES, AND THE MIDDLE ONE IS THE POINT.
                            //  live      it has work the default branch has not
                            //  landed    its changes ARE there, under other shas
                            //  unknown   the comparison could not be made
                            state: left === null ? 'unknown' : (left > 0 ? 'live' : 'landed')
                        }
                    }));
                }

                //OUT OF STEP MEANS BOTH SIDES HAVE IT AND THEY DISAGREE.
                //
                //Counting every branch that is not identical to origin made this
                //read "3 out of step" for a repository where one branch differed
                //and two had simply never been pushed. A branch that exists only
                //here is not a problem to be fixed — it is work that has not gone
                //anywhere yet, and there is nothing to catch it up TO.
                var off = out.filter(function (r) { return r.local && r.remote && r.state !== 'same'; });
                var onlyHere = out.filter(function (r) { return r.local && !r.remote; });

                return {
                    repo: name,
                    default: def,
                    branches: out,
                    outOfStep: off.length,
                    onlyHere: onlyHere.length,
                    //SAID PLAINLY, BECAUSE THE ANSWER IS OLDER THAN IT LOOKS.
                    //These remote shas are `refs/remotes/origin/*` — what origin
                    //had when somebody last fetched. A panel that shows a remote
                    //column without saying so reports "in step" about a
                    //repository nobody has asked about for a week.
                    note: [
                        off.length ? off.length + ' branch(es) differ from origin' : 'Every branch origin also has matches it',
                        onlyHere.length ? onlyHere.length + ' exist only here' : '',
                        'as of the last fetch — sync to ask again'
                    ].filter(Boolean).join(', ') + '.'
                };
            }
        }));

        //---- the fork chain, walked one link at a time --------------------
        //
        //WHERE WORK COULD GO. A fork of a fork makes "upstream" a choice rather
        //than a fact, and GitHub reports only two of the chain — one level up
        //and the root — so the middle of a longer one has to be walked.
        //
        //BOUNDED AND CYCLE-SAFE, because a loop up there would be somebody
        //else's mistake becoming an infinite loop in here.
        undo.push(actions.define('repoChain', {
            about: 'The fork chain above a repository, walked one link at a time — where work could go, and which of them this host may open a pull request in',
            takes: ['repo'],
            run: async function (args) {
                var a = args || {};
                var name = String(a.repo || '').trim();
                if (!name) throw new Error('Say which repository to walk from.');

                var remote = await refs.origin(name);
                if (!remote || remote.kind !== 'github') {
                    throw new Error('"' + name + '" has no GitHub remote, so there is no chain to walk.');
                }

                var links = [];
                var at = remote.owner + '/' + remote.repo;
                var stopped = null;
                var seen = {};

                for (var step = 0; step < 12; step++) {
                    if (seen[at]) { stopped = '"' + at + '" appears twice, so the walk stopped rather than going round.'; break; }
                    seen[at] = 1;

                    var bits = at.split('/');
                    var r = await github.call('GET', '/repos/' + bits[0] + '/' + bits[1]);
                    if (r.status !== 200) {
                        stopped = at + ' could not be read (' + r.status + '), so anything above it is unknown.';
                        break;
                    }

                    //PROBED, NOT READ OFF `permissions` — the same trap the check
                    //above is written for. `permissions` describes THE ACCOUNT; a
                    //fine-grained token reports push and admin there and is then
                    //refused the moment it asks. Choosing where work goes on that
                    //basis is choosing somewhere it will fail at the last moment.
                    var probe = await github.call('GET', '/repos/' + bits[0] + '/' + bits[1] + '/pulls?state=open&per_page=1');

                    links.push({
                        on: at,
                        fork: !!r.body.fork,
                        private: !!r.body.private,
                        defaultBranch: r.body.default_branch || null,
                        openIssues: r.body.open_issues_count == null ? null : r.body.open_issues_count,
                        //WHETHER THIS HOST MAY OPEN A PULL REQUEST THERE, which
                        //is the whole point of picking one and is a different
                        //question from reachability.
                        mayOpen: probe.status === 200,
                        //KEPT AND CLEARLY LABELLED as the account's claim, so the
                        //two can be seen to differ rather than one standing in
                        //for the other.
                        accountMayPush: !!(r.body.permissions && r.body.permissions.push),
                        //ONLY THE IMMEDIATE PARENT SYNCS WITH ONE CALL.
                        immediate: links.length === 1
                    });

                    if (!r.body.fork || !r.body.parent) break;
                    at = r.body.parent.full_name;
                }

                var notes = await read();
                var now = targetOf((notes || {})[name] || null, remote);

                log.on('github', name).info('walked ' + links.length + ' link(s) above ' + name);
                return {
                    repo: name,
                    //WHICH LINK IS THE ONE IN USE, marked on the walk rather than
                    //left for the reader to match strings.
                    links: links.map(function (l) {
                        return Object.assign({}, l, {
                            self: l.on === now.self,
                            target: l.on === now.on,
                            syncsCheaply: !!l.immediate
                        });
                    }),
                    deep: links.length,
                    stopped: stopped,
                    target: now,
                    walked: new Date().toISOString(),
                    note: stopped
                        ? stopped
                        : links.length === 1
                            ? name + ' is not a fork — work from it goes to its own remote.'
                            : links.length + ' repositories in the chain above ' + name + '. Work goes to ' + now.on + '.'
                };
            }
        }));

        //---- catching branches up to origin ---------------------------------
        //
        //ONLY FAST-FORWARDS, AND THAT IS THE WHOLE PROMISE THE BUTTON MAKES.
        //Anything that has moved here as well is reported and left alone — the
        //fast-forward could not help it, and choosing what to do instead is a
        //decision rather than a retry. See ../../git's write door.
        //
        //A PROTECTED BRANCH IS FINE HERE, and that is not a hole in the gate.
        //Protection means work is not BUILT on it; catching it up to origin is
        //the opposite — it is how a default stays the thing everything else is
        //measured against.
        async function catchUp(repo, only) {
            var got = await git.fetch(repo);
            if (!got.fetched) return [{ repo: repo, branch: only || null, moved: false, why: got.why }];

            var rows = await refs.of(repo);
            var names = only ? [String(only)] : Object.keys(rows);
            var out = [];

            for (var i = 0; i < names.length; i++) {
                var b = rows[names[i]];
                if (!b) { out.push({ repo: repo, branch: names[i], moved: false, why: 'there is no branch by that name here' }); continue; }
                //ONLY WHERE BOTH SIDES HAVE IT. A branch that exists only here
                //has nothing to catch up TO, and reporting that as a failure is
                //how "3 out of step" got counted wrong in the first place.
                if (!b.local || !b.remote) continue;
                if (b.state === 'same') continue;

                var said = await git.fastForward(repo, b.branch, 'refs/remotes/origin/' + b.branch);
                out.push({ repo: repo, branch: b.branch, moved: !!said.moved, why: said.why || null });
            }
            return out;
        }

        function syncSaid(done) {
            var moved = done.filter(function (d) { return d.moved; }).length;
            var stuck = done.filter(function (d) { return d.why; });
            return {
                on: done, moved: moved, stuck: stuck.length,
                note: moved
                    ? moved + ' branch(es) moved.' + (stuck.length ? ' ' + stuck.map(function (d) { return d.repo + '/' + d.branch + ' — ' + d.why; }).join('; ') : '')
                    : stuck.length
                        ? 'Nothing moved. ' + stuck.map(function (d) { return d.repo + '/' + d.branch + ' — ' + d.why; }).join('; ')
                        : 'Everything origin also has already matches it.'
            };
        }

        undo.push(actions.define('repoSync', {
            about: 'Fetch from origin and fast-forward every default branch. Only fast-forwards',
            run: async function () {
                var found = await workspace.repos();
                var done = [];
                for (var i = 0; i < found.length; i++) {
                    var here = await localOf(found[i].name);
                    if (!here.default) continue;
                    var said = await catchUp(found[i].name, here.default);
                    done = done.concat(said);
                }
                return syncSaid(done);
            }
        }));

        undo.push(actions.define('repoSyncBranch', {
            about: 'Fetch from origin and fast-forward one branch, or every branch in a repository',
            takes: ['repo', 'branch'],
            run: async function (args) {
                var a = args || {};
                var name = String(a.repo || '').trim();
                if (!name) throw new Error('Say which repository.');

                var found = await workspace.repos();
                if (!found.some(function (r) { return r.name === name; })) {
                    throw new Error('There is no repository called "' + name + '" here. This workspace has: '
                        + found.map(function (r) { return r.name; }).join(', ') + '.');
                }

                return syncSaid(await catchUp(name, a.branch ? String(a.branch).trim() : null));
            }
        }));

        //WHERE A CHANGE FROM THIS REPOSITORY SHOULD GO, chosen once and stuck to.
        //
        //A FORK OF A FORK MAKES THIS A DECISION RATHER THAN A FACT — see the
        //fork-chain block in `ask`. Recorded with WHO and WHY, because "why is
        //this pointed at the root instead of the parent" is a question somebody
        //asks weeks later.
        undo.push(actions.define('repoTargetSet', {
            about: 'Choose where work from a repository is sent, and where its issues are read from',
            takes: ['repo', 'on', 'why'],
            run: async function (args) {
                var a = args || {};
                var name = String(a.repo || '').trim();
                if (!name) throw new Error('Which repository?');

                var found = await workspace.repos();
                if (!found.some(function (r) { return r.name === name; })) {
                    throw new Error('There is no repository called "' + name + '" here. This workspace has: '
                        + found.map(function (r) { return r.name; }).join(', ') + '.');
                }

                var doc = await kept();
                var notes = doc.read({}) || {};
                var note = notes[name] || {};
                var remote = null;
                try { remote = await refs.origin(name); } catch (e) { /* said below */ }

                var on = a.on == null ? '' : String(a.on).trim();
                //UNSETTING IS SETTING IT BACK TO YOUR OWN, and it is how somebody
                //undoes a choice. An empty string means "no choice", not "nowhere".
                if (!on) {
                    delete note.target;
                } else {
                    if (on.split('/').length !== 2) {
                        throw new Error('A target is owner/repository, like "someone/their-fork" — "' + on + '" is not.');
                    }
                    note.target = {
                        on: on,
                        at: new Date().toISOString(),
                        by: actions.whoAsked(a),
                        why: a.why ? String(a.why) : null
                    };
                }

                notes[name] = note;
                doc.write(notes);

                var now = targetOf(note, remote);
                log.on('git', name).info(now.chosen
                    ? 'work from here goes to ' + now.on + (now.why ? ' — ' + now.why : '')
                    : 'work from here goes to its own remote again');
                return {
                    repo: name,
                    target: now,
                    note: now.chosen
                        ? 'Work from ' + name + ' goes to ' + now.on + ', and its issues are read from there. Check it to gather them.'
                        : 'Cleared. Work from ' + name + ' goes to its own remote, and its issues are read from there.'
                };
            }
        }));

        undo.push(actions.define('repositoriesCheck', {
            about: 'Ask GitHub about the repositories: reachability, what the token may do, and what is open',
            takes: ['repo'],
            run: async function (args) {
                var a = args || {};
                var found = await workspace.repos();
                if (!found.length) throw new Error('There are no repositories in this workspace to ask about.');

                var want = a.repo ? found.filter(function (r) { return r.name === a.repo; }) : found;
                if (a.repo && !want.length) {
                    throw new Error('There is no repository called "' + a.repo + '" here. This workspace has: '
                        + found.map(function (r) { return r.name; }).join(', ') + '.');
                }

                var doc = await kept();
                var notes = doc.read({}) || {};
                var rows = [];

                for (var i = 0; i < want.length; i++) {
                    var row = await ask(want[i].name, notes[want[i].name] || null);
                    rows.push(row);
                    notes[row.repo] = row;

                    //SAID AS IT GOES, because this is the slow one — three
                    //requests per repository — and a person watching wants to
                    //know it is working rather than whether it has finished.
                    var to = log.on('git', row.repo);
                    if (row.reachable === true && !row.why) to.good('reachable, and the token may use its code and pull requests');
                    else if (row.reachable === true) to.warn(row.why);
                    else if (row.reachable === false) to.bad('cannot be reached: ' + row.why);
                    else to.info(row.why);
                }

                doc.write(notes);

                var stuck = rows.filter(function (r) { return r.reachable !== true || r.why; });
                return {
                    repos: rows,
                    note: (stuck.length
                        ? stuck.length + ' of ' + rows.length + ' need attention: '
                            + stuck.map(function (r) { return r.repo + ' — ' + r.why; }).join('; ')
                        : 'All ' + rows.length + ' are reachable and the token may use them.')
                };
            }
        }));
    }

    //---- AND THE DOOR A MACHINE CLONES THROUGH ---------------------------
    //
    //REGISTERED WITH ../../vms/https, which owns the certificate, the port, and
    //has already turned `vm:token` into a machine record before anything in
    //./gitapi.js runs. What is this plugin's is where the repositories are, and
    //the rule about which of them a given machine's work is about.
    //
    //IT IS THIS PLUGIN'S BECAUSE THE REPOSITORIES ARE. A service goes where it
    //is owned -- ../../../CLAUDE.md -- and everything the door needs to answer
    //with is already here: the workspace, and `lines.scopeOf`.
    var stopServing = imports.guestApi.api(makeGitApi({
        serve: serving({ workspace: workspace, say: imports.log.on }),
        //ASKED THROUGH ../branches RATHER THAN COPIED. What a branch is about is
        //a question about lines, and a second answer to it here is how a machine
        //comes to be refused a repository the setup gave it.
        scopeOf: function (branch) { return imports.lines.scopeOf(branch); },
        say: imports.log.on
    }));
    undo.push(stopServing);

    await register(null, {
        repositories: {
            ask: ask,
            read: read
        },

        //---- WHAT A MACHINE'S WORKSPACE SHOULD BE, WITHOUT SETTING ONE UP ----
        //
        //THE DECIDING IS HERE AND THE DOING IS IN ../../runners/machines, and
        //the split is not tidiness — it is the layering this plugin is built to
        //and ../../../../test/repositories/repositories.test.js pins.
        //
        //`vmWorkspace` used to be defined in this file, ported straight across
        //from the app being ported from. It read `vm.spec.token` off a machine
        //and handed it to the script builder, which put it in the guest's
        //credential store — so THIS plugin, whose whole claim is that it opens
        //no credential and holds none, was passing one around. The boundary test
        //went red about the identifier, which is the cheapest possible way to be
        //told and was still nearly argued with.
        //
        //The app being ported from puts that action in actions/machines.js, not
        //in repos/. So both the rule and the thing being ported agree on where
        //it goes, and it went there.
        //
        //WHAT CROSSES IS A PLAN AND A SCRIPT BUILDER. Every gate — does the
        //branch exist, is anything else on it, may this machine push — is
        //decided in ./setting-up.js with nothing run and no machine touched.
        //The caller supplies the machine's own token because the machine's own
        //plugin is the one that has it.
        repoWorkspaces: {
            plan: settingUp.plan,
            script: layout.script,
            folderFor: layout.folderFor,
            freeEverywhere: freeing.freeEverywhere,

            //A PATH ON THE MACHINE, NOT ON THIS HOST — ./setting-up.js's, and
            //offered here because ../../runners/runs asks the same question of
            //`--folder` when it dispatches into one. Git Bash rewrites
            //`/home/okc/work` into `C:/Program Files/Git/home/okc/work` on the
            //way through, which is a real path on the wrong computer, and the
            //guest then makes a directory with spaces in it and works there
            //happily.
            //
            //Handed over as a service rather than copied, because it is a
            //refusal with a fix written into it and two copies of a sentence
            //like that drift. It stays tested and sabotaged where it lives.
            guestPath: settingUp.guestPath
        },

        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
