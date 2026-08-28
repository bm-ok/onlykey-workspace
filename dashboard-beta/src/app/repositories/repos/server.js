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
var makeFreeing = require('../branches/freeing');
var reach = require('../branches/reach');
var revising = require('../pr/revising');
//WHOSE WORDS AN ISSUE CARRIES, and whether they may be read as a request. Every
//body that leaves this file goes through it — see ../../github/trust.js.
var trust = require('../../github/trust');

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
    'ours', 'channel', 'lines', 'prcuts', 'settings',
    //`inbox` FOR ONE ERRAND: a fork nobody has said where to send work from.
    'inbox'];
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

    //---- WHERE THINGS ARE READ FROM, WHICH IS NOT WHERE THEY ARE SENT ------
    //
    //ONE VALUE ANSWERED THREE QUESTIONS and they are not the same question.
    //Issues are read where people FILE them; pull requests are read where they
    //ARRIVE; a change is SENT to one place and only one. A fork you collaborate
    //through can be the destination while the issues worth reading are still on
    //the project above it — and with a single `target` that was unsayable, so
    //the app read from wherever it happened to send to.
    //
    //TWO SETS AND ONE CHOICE. Reading is a set because more than one place can
    //be worth watching; sending is a single value because a change goes
    //somewhere, once. `target` keeps its meaning — where pull requests are
    //OPENED — so `prCutMake` is untouched by this.
    //
    //EMPTY MEANS THE TARGET, which is what every record written before this
    //says by omission and is the behaviour it had. Nothing is migrated: absence
    //is read as "the same as where work goes", which is both the old answer and
    //a sensible default.
    function readsOf(note, remote) {
        var fallback = targetOf(note, remote).on;
        var kept = (note && note.reads) || {};
        function set(which) {
            var list = Array.isArray(kept[which]) ? kept[which].filter(Boolean) : null;
            return list && list.length ? list : (fallback ? [fallback] : []);
        }
        return {
            issues: set('issues'),
            pulls: set('pulls'),
            //WHETHER ANYBODY SAID SO, kept apart from the value for the same
            //reason `chosen` is on the target: "the default" and "what somebody
            //picked" are the same list in different situations.
            chosen: !!(kept.issues || kept.pulls),
            at: kept.at || null,
            by: kept.by || null
        };
    }

    //WHAT ONE PLACE IN A READ SET ANSWERED, in the words a pane can print.
    //
    //410 IS NOT AN ERROR, IT IS A SETTING. GitHub answers Gone for the issues of
    //a repository whose owner has switched issues OFF — which is a normal thing
    //to do on a fork, and is why bm-sandbox-b/local-repo-b returns nothing. Read
    //as a failure it reads as "the token cannot see it" and sends somebody to
    //the permissions page for a checkbox on the repository's own settings.
    function whatItSaid(on, got, what) {
        var said = { on: on, count: null, off: false, asked: true, why: null };
        if (got.status === 200 && Array.isArray(got.body)) {
            said.count = got.body.length;
            return said;
        }
        if (got.status === 410) {
            said.off = true;
            said.count = 0;
            said.why = what === 'issues'
                ? 'issues are switched off on this repository'
                : 'pull requests are switched off on this repository';
            return said;
        }
        if (got.status === 404) {
            said.why = 'GitHub says 404 — either it does not exist, or this token was not granted it';
            return said;
        }
        said.why = (got.body && got.body.message) || ('GitHub answered ' + got.status);
        return said;
    }

    //ONE PULL REQUEST, in this app's words. Used for every place in the read
    //set, so `on` says which repository it is OPEN ON — with two forks read at
    //once, "#1" on its own names two different pull requests.
    function onePull(on, p) {
        return {
            on: on,
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
    //CAN THIS TOKEN OPEN A PULL REQUEST THERE.
    //
    //ASKED OF EACH PLACE SEPARATELY, because a token can be granted one
    //repository and not another — and in a chain that is the ordinary case
    //rather than an unlucky one.
    //
    //AT PLUGIN SCOPE because two callers need it: the whole read below, and
    //`repoTargetSet`, which has to re-ask the moment somebody points work
    //somewhere new.
    async function canOpenIn(full) {
        if (!full) return null;
        var bits = String(full).split('/');
        var up = await github.call('GET', '/repos/' + bits[0] + '/' + bits[1] + '/pulls?state=open&per_page=1');

        //AND WHETHER IT HAS AN ISSUES TAB AT ALL. A repository's owner can switch
        //issues off, and several of these forks have — reading issues from one
        //then spends a request to be told 410 Gone, every check, forever. Asking
        //the repository itself is one call and it is the same call the etag door
        //answers from cache, so knowing this costs nothing and saves a request
        //per check per place.
        //
        //`null` MEANS NOT KNOWN, which is not `false`. A place that could not be
        //asked must not be recorded as having issues switched off: that would
        //take the choice away on screen for what is really a permissions problem.
        var about = await github.call('GET', '/repos/' + bits[0] + '/' + bits[1]);
        return {
            repo: full,
            hasIssues: about.status === 200 && about.body && about.body.has_issues !== undefined
                ? !!about.body.has_issues
                : null,
            mayOpen: up.status === 200,
            why: up.status === 200 ? null : (up.status === 404
                ? 'this token was not granted it, so a pull request cannot be opened there'
                : (up.body && up.body.message) || ('GitHub answered ' + up.status))
        };
    }

    async function ask(name, note) {
        //HOW TEXT FROM GITHUB IS TO BE READ, asked at the head of every answer.
        //Settings change while this app runs, and the direction a stale one is
        //wrong in is the bad one: a host whose owner has just withdrawn trust
        //would go on treating a stranger's words as a request.
        await readSettings();

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

        //THE PROBE, WHICH IS A DIFFERENT QUESTION FROM THE READ BELOW. This asks
        //whether the token may use Pull requests ON THIS REPOSITORY, and feeds
        //the missing-permission sentence. WHICH repositories are read from is a
        //decision somebody made — see the `reads.pulls` loop further down.
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

        var intoParent = parent
            ? Object.assign({}, await canOpenIn(parent), { defaultBranch: r.body.parent.default_branch || null })
            : null;
        var intoSource = chained
            ? Object.assign({}, await canOpenIn(source), { defaultBranch: r.body.source.default_branch || null })
            : null;

        //---- AND THE ONE THAT ACTUALLY MATTERS: THE TARGET ------------------
        //
        //WHERE PULL REQUESTS WILL BE OPENED IS THE TARGET, and until now nothing
        //asked whether the token can open one THERE. The panel probed the
        //immediate parent and said "one level up" — which is the right question
        //only while the target is inferred from the parent, and this app lets
        //somebody pick any link in the chain, or their own remote.
        //
        //So a target three links up, or a target that is your own fork, was
        //never checked at all: the row said the parent was reachable and the
        //push went somewhere else. The check that matters is the one against the
        //place a change will actually land.
        //
        //ASKED SEPARATELY EVEN WHEN IT IS THE PARENT. A token can be granted one
        //repository and not another, and in a chain that is the ordinary case;
        //reusing the parent's answer because the names happen to match would be
        //right until somebody picks a different link and silently wrong after.
        var wantOn = targetOf(note, remote).on;
        var intoTarget = wantOn
            ? Object.assign({}, await canOpenIn(wantOn), { chosen: !!(note && note.target && note.target.on) })
            : null;

        //REPORTED AGAINST THE TARGET, not the parent. This said "Pull requests
        //on <parent>" while work was being sent somewhere else entirely.
        if (intoTarget && !intoTarget.mayOpen) {
            missing.push('Pull requests on ' + wantOn);
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
        //FROM EVERY PLACE THIS REPOSITORY READS ISSUES FROM, which is a SET and
        //was one value. Issues arrive where people file them, and for a fork of
        //a fork that can be two places at once — the fork you collaborate
        //through and the project above it — so reading only from wherever work
        //is SENT missed half of them with nothing to say so. See `readsOf`.
        //
        //ASKED IN ORDER AND CONCATENATED, each row carrying `on`, so a list can
        //say which repository an issue came from rather than implying they are
        //all one repository's.
        //
        //AND WHAT EACH PLACE ANSWERED, kept beside the list. A set can be half
        //readable — a repository in it with ISSUES SWITCHED OFF answers 410 and
        //an unreadable one answers 404 — and both look identical in a
        //concatenated list: fewer rows, no reason. `issuesFrom` carries one
        //entry per place so a pane can say which fork went quiet and why,
        //rather than showing a short list that reads as "there are none".
        //---- WHERE THERE IS NO ISSUES TAB TO READ ---------------------------
        //
        //ISSUES CAN BE SWITCHED OFF PER REPOSITORY, and on these forks they often
        //are: bm-sandbox-c/local-repo-a has them, bm-sandbox-c/local-repo-c and
        //bm-sandbox-b/local-repo-b do not. GitHub answers 410 Gone for the issues
        //of a repository whose owner turned them off, so a read set naming one
        //spends a request every check to be told the same thing.
        //
        //ASKED ONCE, FROM WHAT IS ALREADY IN HAND. `has_issues` is on the
        //repository, and GitHub embeds the whole parent and source objects in
        //it — so this costs nothing for the chain, and `canOpenIn` learns it for
        //a target picked anywhere else.
        //
        //ONLY `false` COUNTS. Anything not known stays unknown and is asked for
        //as normal: refusing to read from a place because a probe failed would
        //turn a token problem into a setting nobody can find.
        var noIssues = {};
        function noteIssues(on, has) {
            if (on && has === false) noIssues[on] = true;
        }
        var mineFull = remote && remote.owner ? remote.owner + '/' + remote.repo : null;
        noteIssues(mineFull, r.body.has_issues);
        if (r.body.parent) noteIssues(parent, r.body.parent.has_issues);
        if (r.body.source) noteIssues(source, r.body.source.has_issues);
        [intoParent, intoSource, intoTarget].forEach(function (probe) {
            if (probe) noteIssues(probe.repo, probe.hasIssues);
        });

        var from = readsOf(note, remote).issues;
        var issues = null;
        var issuesFrom = [];
        for (var ri = 0; ri < from.length; ri++) {
            var on = from[ri];
            if (noIssues[on]) {
                //NOT ASKED, and the row says so rather than saying zero. `asked`
                //is what separates "there is no issues tab here" from "there is
                //one and it is empty" — they look the same in a count.
                issuesFrom.push({ on: on, count: 0, off: true, asked: false,
                    why: 'issues are switched off on this repository' });
                continue;
            }
            var bits = on.split('/');
            var got = await github.call('GET', '/repos/' + bits[0] + '/' + bits[1] + '/issues?state=open&per_page=100');
            issuesFrom.push(whatItSaid(on, got, 'issues'));
            if (got.status === 200 && Array.isArray(got.body)) {
                //NULL UNTIL SOMETHING ANSWERS. An empty array means "asked, and
                //there are none", which is a different answer from "could not
                //ask" — and the panes tell them apart.
                if (issues === null) issues = [];
                issues = issues.concat(got.body.filter(function (x) { return !x.pull_request; }).map(function (x) {
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
                        //HOW MANY REPLIES, WHICH IS WHY THIS IS CARRIED AT ALL.
                        //It decides whether the thread is worth a second
                        //request, and it is the only way to know that without
                        //making the request.
                        comments: Number(x.comments || 0),
                        //---- THE WORDS, AND WHOSE THEY ARE -----------------
                        //
                        //CARRIED so a task can be written from the Overview list
                        //without going back to the per-repository tab to find
                        //them again — and NEVER carried bare, because this is
                        //text written by anybody on the internet arriving on the
                        //same answer as everything this host knows for certain.
                        //
                        //See ../../github/trust.js. `body` is the fenced form,
                        //which says who wrote it and what may be done about it;
                        //`reading` says which of the two it is. Both blank
                        //settings means everything here is a quotation, which is
                        //what this ships as.
                        reading: readingOf({
                            number: x.number, on: on, body: x.body || null,
                            by: x.user && x.user.login,
                            labels: (x.labels || []).map(function (l) { return typeof l == 'string' ? l : l.name; })
                        }),
                        body: fencedBody({
                            number: x.number, on: on, body: x.body || null,
                            by: x.user && x.user.login,
                            labels: (x.labels || []).map(function (l) { return typeof l == 'string' ? l : l.name; })
                        })
                    };
                }));
            }
        }

        //---- AND THE REPLIES, WHICH ARE WHERE PEOPLE ACTUALLY SAY THINGS ------
        //
        //AN ISSUE BODY IS WHAT SOMEBODY OPENED WITH. The conversation is
        //underneath it, and that is where a person says "yes, do this" — the
        //body was written before anybody had agreed to anything.
        //
        //IT IS ALSO WHERE THE AUTHORS DIVERGE. One issue has one author; a
        //thread under it has as many as have replied, and a reply from a
        //stranger sits in the same list as one from the owner. So every comment
        //carries its own `by` and its own fence, decided on its own — reading
        //them as "the issue's text" would let anybody who can comment write in
        //somebody else's name.
        //
        //ONLY WHERE THERE ARE ANY, and only for issues, which is why the count
        //above is carried: a request per issue is a request per issue, and most
        //have nothing under them.
        for (var ci = 0; ci < (issues || []).length; ci++) {
            var one = issues[ci];
            if (!one.comments) { one.said = []; continue; }

            var where = String(one.on || '').split('/');
            if (where.length !== 2) { one.said = []; continue; }

            var replies = await github.call('GET',
                '/repos/' + where[0] + '/' + where[1] + '/issues/' + one.number + '/comments?per_page=100');

            //A THREAD THAT COULD NOT BE READ IS SAID, not silently empty. "No
            //replies" and "the replies could not be fetched" are different
            //answers, and one of them means somebody should look.
            if (replies.status !== 200 || !Array.isArray(replies.body)) {
                one.said = null;
                one.saidWhy = 'the replies could not be read: ' + (replies.status || 'no answer');
                continue;
            }

            one.said = replies.body.map(function (c) {
                var asItself = {
                    number: one.number, on: one.on,
                    by: c.user && c.user.login,
                    body: c.body || null,
                    //A COMMENT CARRIES NO LABELS. The marker has to be in what
                    //was written, which is the point: a label is the issue's and
                    //a comment is one person's.
                    labels: []
                };
                var reading = readingOf(asItself);
                return {
                    at: c.created_at, by: asItself.by, url: c.html_url,
                    reading: reading,
                    body: trust.fenced(asItself, reading)
                };
            });
        }

        //---- AND WHETHER ANYBODY ACTUALLY ASKED FOR ANYTHING -----------------
        //
        //ONE FIELD TO LOOK AT rather than a rule to re-derive. A request can be
        //in the body or in any reply, and something reading this should not have
        //to work out the precedence — nor be tempted to invent its own.
        for (var ai = 0; ai < (issues || []).length; ai++) {
            var it = issues[ai];
            var asked = it.reading && it.reading.kind === 'request'
                ? { where: 'the issue', by: it.reading.by, why: it.reading.why }
                : null;

            //THE LAST ONE WINS, because a thread is read in order and the most
            //recent word is the current one. Somebody who asked and then said
            //"actually, no" has said the second thing.
            (it.said || []).forEach(function (c) {
                if (c.reading && c.reading.kind === 'request') {
                    asked = { where: 'a reply', by: c.reading.by, at: c.at, why: c.reading.why };
                }
            });

            it.asked = asked;
        }

        //FROM EVERY PLACE THIS REPOSITORY READS PULL REQUESTS FROM, the same set
        //shape as the issues above and for the same reason: a change somebody
        //else opened arrives in the repository they opened it on, which is not
        //necessarily this fork.
        var pullFrom = readsOf(note, remote).pulls;
        var pullList = null;
        var pullsFrom = [];
        for (var pi = 0; pi < pullFrom.length; pi++) {
            var pOn = pullFrom[pi];
            var pBits = pOn.split('/');
            //THE PROBE ANSWERED THIS ONE ALREADY when the set is just this
            //repository, which is the common case. Asking twice would be
            //harmless — the second is a 304 — but it would be two lines in the
            //log for one question.
            var pGot = (pOn === mineFull)
                ? pulls
                : await github.call('GET', '/repos/' + pBits[0] + '/' + pBits[1] + '/pulls?state=open&per_page=100');
            pullsFrom.push(whatItSaid(pOn, pGot, 'pulls'));
            if (pGot.status === 200 && Array.isArray(pGot.body)) {
                if (pullList === null) pullList = [];
                pullList = pullList.concat(pGot.body.map(onePull.bind(null, pOn)));
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
            intoTarget: intoTarget,
            upstreamDefault: r.body.default_branch || null,
            upstreamHead: headOfList(branchList, r.body.default_branch),
            branchesThere: canReadCode && Array.isArray(branchList.body) ? branchList.body.length : null,
            pulls: pullList,
            openPulls: pullList ? pullList.length : null,
            issues: issues,
            openIssues: issues ? issues.length : null,

            //WHAT EACH PLACE IN THE TWO READ SETS ANSWERED, one entry per place.
            //A concatenated list cannot say that one of the forks it was built
            //from is unreadable, or has issues switched off — it just comes back
            //shorter, which reads as "there are none".
            issuesFrom: issuesFrom,
            pullsFrom: pullsFrom,
            //AND THE PLACES WITH NO ISSUES TAB AT ALL, so the pane that picks
            //read sets can refuse to offer one rather than letting somebody
            //choose a repository that can never answer.
            noIssuesAt: Object.keys(noIssues),
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

        //ASKED OF ../refs RATHER THAN OF GIT DIRECTLY, which is what it was.
        //
        //ONE `rev-parse` PER REPOSITORY PER DRAW, GOING ROUND THE ONE PLUGIN
        //THAT EXISTS TO STOP THAT. Every other answer on this row comes out of a
        //drawer; this one spawned a process every single time, so a board where
        //nothing had changed and nothing was worked out still started three git
        //processes to ask where three default branches were.
        //
        //IT IS NOT THE SHORT SHA FROM THE REF WALK, and that is why ../refs has
        //a function for it rather than this reading `of()`. Line ~576 below
        //compares this against a sha GITHUB gave — forty characters — to say
        //whether this host is in step with its fork, and a short sha never
        //equals a long one.
        if (out.default) {
            try { out.head = await refs.sha(name, out.default); }
            catch (e) { /* said as null */ }
        }
        return out;
    }

    //---- what setting a machine up is built from ---------------------------
    //
    //HANDED THE PIECES RATHER THAN REACHING FOR THEM, so every gate can be
    //exercised without a machine — see ./setting-up.js, which is where they are
    //and where they are tested.
    //---- THE ONE PERMISSION, PUT TOGETHER ONCE -----------------------------
    //
    //`revising.mayRevise` IS THE RULE and this is the only place its arguments
    //are gathered. Two assemblies would be two opinions the moment one of them
    //learned something the other did not, which is exactly what the drill
    //`02-the-refusals/05-one-permission-many-gates` is a record of: the
    //exception for a branch that is out as a pull request was taught to three
    //gates ONE AT A TIME, and each discovery cost a worker run whose commit the
    //rollback then destroyed -- three tasks that finished exit 0 with nothing on
    //the branch.
    async function mayRevise(branch) {
        return revising.mayRevise(branch, await imports.prcuts.all(), await imports.lines.protectedOf());
    }

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
        //being one. Named above so ../gitserve can be handed the SAME assembly
        //rather than building a second one out of the same parts.
        mayRevise: mayRevise,
        reach: reach
    });

    //---- HOW TEXT FROM GITHUB IS READ HERE ---------------------------------
    //
    //ASKED PER ANSWER RATHER THAN HELD, because these are settings and a value
    //read once at startup is the old answer for the rest of the run — and the
    //direction it would be wrong in is the bad one: a host whose owner has just
    //turned trust OFF would go on treating text as a request.
    //
    //FAILING SHUT. If the settings cannot be read, nobody is trusted and no
    //marker is set, which is the state that makes everything a quotation.
    var howToRead = { trusted: [], marker: '' };

    async function readSettings() {
        try {
            var kept = await imports.settings.read();
            howToRead = {
                trusted: Array.isArray(kept.githubTrusted) ? kept.githubTrusted : [],
                marker: typeof kept.githubMarker == 'string' ? kept.githubMarker : ''
            };
        } catch (e) { howToRead = { trusted: [], marker: '' }; }
        return howToRead;
    }

    function readingOf(entry) { return trust.readingOf(entry, howToRead); }
    function fencedBody(entry) { return trust.fenced(entry, trust.readingOf(entry, howToRead)); }

    var undo = [];
    //---- AND A FORK NOBODY HAS SAID WHERE TO SEND WORK FROM ----------------
    //
    //THE ERRAND THAT WOULD HAVE SAVED AN AFTERNOON. Every repository here is a
    //fork, every one has a real chain above it, and not one has ever had a
    //target picked — so `target.on` is the repository ITSELF. Nothing said so.
    //
    //WHAT THAT COSTS IS NOT ABSTRACT. Issues are read from the target and pull
    //requests are opened on it, so with nothing picked a change sent out opens
    //pull requests against OUR OWN FORK rather than the parent, and nothing at
    //the time says which way it went. That happened: three pull requests, all
    //on `bm-sandbox-c`, all into its own default branches, and the question
    //"forks of a fork — into what?" had to be answered by hand afterwards.
    //
    //IT ALSO BLOCKS THE DRILLS. "the fork is behind its parent, and syncing
    //pulls it up" has nothing to exercise while every repository sends work to
    //itself, which takes `the order` off runnable and everything under it with
    //it — the guards, a task on a machine, judging, the supervisor.
    //
    //ONE ITEM PER REPOSITORY, landing on that repository with it already
    //picked, because the answer is different for each and a summary would be an
    //errand somebody has to go and decompose.
    //
    //ONLY FOR A FORK. A repository that is nobody's fork IS the project, and
    //keeping to itself is the whole of the right answer — nagging about that
    //would be nagging about nothing, which is how a list stops being read.
    //
    //NOTHING IS ASKED OF GITHUB. `fork` is on the record and the target is the
    //record plus the remote, so this costs a document read — which matters for
    //something the inbox draws on a timer.
    if (imports.inbox) {
        undo.push(imports.inbox.source({
            name: 'forks with nowhere to send work',
            waiting: async function () {
                var notes = await read();
                if (notes === null) return [];

                var found = [];
                try { found = await workspace.repos(); } catch (e) { return []; }

                var out = [];
                for (var i = 0; i < found.length; i++) {
                    var name = found[i].name;
                    var note = notes[name] || {};

                    //NULL IS NOT FALSE. `fork` is unknown until GitHub has been
                    //asked once, and "we have not looked" is not "it is not a
                    //fork" — raising an errand off an unknown would nag about
                    //repositories nobody has established anything about.
                    if (note.fork !== true) continue;

                    var remote = null;
                    try { remote = await refs.origin(name); } catch (e) { remote = null; }

                    var target = targetOf(note, remote);
                    if (target.chosen) continue;

                    out.push(imports.inbox.item(
                        'where work goes',
                        name,
                        'It is a fork and nothing has been picked, so issues and pull requests both stay on '
                            + (target.self || 'itself') + ' and nothing upstream is watched. Walk the fork '
                            + 'chain and say where work goes.',
                        imports.inbox.at('Repositories', 'Repos', name),
                        { since: null, id: name }
                    ));
                }
                return out;
            }
        }));
    }

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
                        intoTarget: note.intoTarget || null,
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
                        //THE SETS, BESIDE THE ONE VALUE. `issuesOn` stays what
                        //it was — the single place, for anything still asking
                        //that question — and `reads` is where more than one can
                        //be named.
                        reads: readsOf(note, remote),
                        target: targetOf(note, remote),

                        //CARRIED THROUGH TO THE PANES, which is the whole point
                        //of writing them down: Issues and Pull requests say
                        //which fork each row came from, and Repos greys the
                        //places that have no issues tab.
                        issuesFrom: note.issuesFrom || null,
                        pullsFrom: note.pullsFrom || null,
                        noIssuesAt: note.noIssuesAt || [],

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

                //---- KEPT, BECAUSE OTHER THINGS NEED TO KNOW WHAT IS UP THERE
                //
                //THE WALK WAS COMPUTED AND THROWN AWAY. Every caller that
                //wanted to know which places this repository is related to had
                //to walk it again — and `repoReadsSet`, which must refuse a
                //place that is not in the chain, had nothing to check against
                //at all: it would have rejected the parent, which is the
                //ordinary answer.
                //
                //WRITTEN WHOLE rather than merged, because a chain is a shape:
                //a link that has gone is not a link to keep, and merging would
                //leave a repository claiming a relationship GitHub no longer
                //reports.
                if (notes) {
                    var was = notes[name] || {};
                    was.chain = { links: links, walked: new Date().toISOString() };
                    notes[name] = was;
                    (await kept()).write(notes);
                }

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

                //---- A BRANCH NOBODY HAS IS NOT A BRANCH TO SYNC -----------
                //
                //REFUSED RATHER THAN REPORTED, and the difference is the whole
                //point. This pushed a row saying `moved: false, why: "there is
                //no branch by that name here"` — a successful answer with a note
                //in it. `repoSyncBranch` then returned 200 and whatever asked
                //carried on believing the branch was up to date.
                //
                //ONLY REACHABLE WHEN SOMEBODY NAMED ONE. With no branch given,
                //`names` comes from `rows` itself, so every name is there by
                //construction. So arriving here means a caller asked for a
                //branch that does not exist — a typo or a stale name — and that
                //is a mistake to stop, not a note to file.
                //
                //AFTER THE FETCH, WHICH THE APP BEING PORTED FROM DID NOT DO. It
                //refused against the branches it already knew; this asks origin
                //first, so a branch that exists only on the remote is caught up
                //to rather than refused as absent.
                if (!b) {
                    throw new Error('"' + repo + '" has no branch called "' + names[i] + '".');
                }
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

                //---- AND WHAT WAS KNOWN ABOUT THE OLD TARGET IS NOW WRONG --
                //
                //PICKING A TARGET MAKES THE LAST ANSWER STALE, and nothing said
                //so. `intoTarget` — whether this token can open a pull request
                //where work goes — was probed against the PREVIOUS target, and
                //`checked` was minutes old, so the panel redrew with the same
                //row and the same verdict about a repository that is no longer
                //the destination. From outside: "I am selecting target forks and
                //nothing changes."
                //
                //SO THE ANSWER IS REPLACED HERE, not left for a later read. It
                //is one conditional request against the place work will now go,
                //and it is the fact the row exists to show.
                var now = targetOf(note, remote);
                try {
                    note.intoTarget = Object.assign({}, await canOpenIn(now.on), { chosen: now.chosen });
                } catch (e) {
                    //NOT KNOWING IS ITS OWN ANSWER, and better than the previous
                    //target's. The row says it plainly rather than showing a
                    //verdict about somewhere else.
                    note.intoTarget = { repo: now.on, mayOpen: null, why: 'could not be asked: ' + e.message, chosen: now.chosen };
                }
                //AND WHAT IS OPEN THERE IS A DIFFERENT REPOSITORY'S NOW, so the
                //rest of the read is stale too. Clearing the stamp is what makes
                //the panel ask again on its next draw — see `keptFresh` in
                //../chassis — rather than trusting an answer about a place
                //nobody is sending work to any more.
                note.checked = null;

                notes[name] = note;
                doc.write(notes);
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

        //---- AND WHERE THEY ARE READ FROM --------------------------------
        //
        //A SET PER QUESTION, and the two are set together because they are one
        //decision on one screen: which places this workspace watches. Sending
        //stays `repoTargetSet` — a different act, with a different blast
        //radius, and the one that reaches somebody else's repository.
        //
        //NAMES ARE CHECKED AGAINST THE CHAIN, not accepted as typed. A place
        //this repository has no relationship to is not somewhere its issues
        //live, and a set holding one would read from a stranger for ever with
        //nothing to say why.
        undo.push(actions.define('repoReadsSet', {
            about: 'Choose which places this repository reads issues and pull requests from',
            takes: ['repo', 'issues', 'pulls'],
            run: async function (args) {
                var a = args || {};
                var name = String(a.repo || '').trim();
                if (!name) throw new Error('Which repository?');

                var found = await workspace.repos();
                if (!found.filter(function (x) { return x.name === name; }).length) {
                    throw new Error('There is no repository called "' + name + '" here. This workspace has: '
                        + found.map(function (x) { return x.name; }).join(', ') + '.');
                }

                var remote = null;
                try { remote = await refs.origin(name); } catch (e) { remote = null; }

                var doc = await kept();
                var notes = doc.read({}) || {};
                var note = notes[name] || {};

                //WHAT THIS REPOSITORY COULD POSSIBLY READ FROM: itself, and
                //every link above it that has been walked. Unwalked, the chain
                //is unknown and only its own remote can be vouched for.
                var chainKnown = (note.chain && note.chain.links) || [];
                var may = {};
                if (remote && remote.owner) may[remote.owner + '/' + remote.repo] = true;
                chainKnown.forEach(function (l) { if (l && l.on) may[l.on] = true; });

                function asList(v) {
                    if (v == null) return null;
                    var list = Array.isArray(v) ? v : String(v).split(',');
                    return list.map(function (x) { return String(x).trim(); }).filter(Boolean);
                }

                var want = { issues: asList(a.issues), pulls: asList(a.pulls) };
                ['issues', 'pulls'].forEach(function (which) {
                    (want[which] || []).forEach(function (on) {
                        //A REPOSITORY WITH ISSUES SWITCHED OFF CANNOT BE READ
                        //FROM, and refusing it here rather than only greying the
                        //box is the difference between a disabled control and a
                        //rule. The pane is one caller; the command line is
                        //another, and it never sees a disabled anything.
                        if (which === 'issues' && (note.noIssuesAt || []).indexOf(on) !== -1
                            && ((note.reads || {}).issues || []).indexOf(on) === -1) {
                            throw new Error('"' + on + '" has issues switched off on GitHub, so there is nothing '
                                + 'to read there. Turn them on in that repository’s settings, or read issues '
                                + 'from somewhere else in the chain.');
                        }
                        if (Object.keys(may).length && !may[on]) {
                            throw new Error('"' + on + '" is not this repository or anywhere in the chain above '
                                + 'it, so its issues and pull requests are not ' + name + "'s. Walk the chain "
                                + 'and pick from what is there.');
                        }
                    });
                });

                //AND ONE ALREADY IN THE RECORD IS DROPPED RATHER THAN REFUSED.
                //Issues can be switched off after a read set was chosen, and a
                //stored place that is now refused would fail every later change
                //to the set — including the one that would have removed it.
                var dropped = (want.issues || []).filter(function (on) {
                    return (note.noIssuesAt || []).indexOf(on) !== -1;
                });
                if (dropped.length) {
                    want.issues = want.issues.filter(function (on) { return dropped.indexOf(on) === -1; });
                }

                note.reads = {
                    issues: want.issues == null ? (note.reads || {}).issues : want.issues,
                    pulls: want.pulls == null ? (note.reads || {}).pulls : want.pulls,
                    at: new Date().toISOString(),
                    by: actions.whoAsked(a)
                };

                //WHAT WAS READ FROM SOMEWHERE ELSE IS NOT THIS PLACE'S ANSWER,
                //so the stamp goes and the panel asks again — the same rule
                //`repoTargetSet` follows for the same reason.
                note.checked = null;

                notes[name] = note;
                doc.write(notes);

                var now = readsOf(note, remote);
                if (dropped.length) {
                    log.on('git', name).info('dropped ' + dropped.join(', ')
                        + ' from where issues are read: issues are switched off there');
                }
                log.on('git', name).info('reads issues from ' + (now.issues.join(', ') || 'nowhere')
                    + '; pull requests from ' + (now.pulls.join(', ') || 'nowhere'));

                return {
                    repo: name,
                    reads: now,
                    note: name + ' reads issues from ' + (now.issues.join(', ') || 'nowhere')
                        + ' and pull requests from ' + (now.pulls.join(', ') || 'nowhere') + '.'
                };
            }
        }));

        //---- PULLING A FORK UP FROM ITS PARENT ----------------------------
        //
        //THE ANSWER TO "I MERGED THE PULL REQUEST AND NOW MY BRANCH AND MASTER
        //ARE OFF". The change landed on the parent; the fork did not move, so
        //everything cut from the fork afterwards starts from something out of
        //date. GitHub offers one button for this and one API call, and this is
        //that call rather than a fetch-and-merge through this host.
        //
        //IT CANNOT FOLLOW THE CHOSEN TARGET, and that is GitHub rather than a
        //decision here. `merge-upstream` takes no destination: it pulls a fork
        //from ITS OWN immediate parent, which is why this posts to the FORK.
        //
        //So when the chosen target IS the immediate parent — the ordinary case,
        //and the whole point of picking the fork you forked from — it is one call
        //and costs nothing. When somebody has picked further up the chain this
        //REFUSES rather than quietly syncing from somewhere they are not sending
        //work. Fetching and merging through this host would do it; that is a
        //different and slower act, and it should be asked for rather than
        //substituted.
        //
        //ONE REPOSITORY'S FAILURE DOES NOT STOP THE OTHERS. A repository that is
        //not a fork, or a conflict GitHub will not resolve, is reported on its own
        //row — a workspace of five where the third is not a fork should still pull
        //the other four up.
        //---- DELETING A BRANCH ON THE FORK -------------------------------
        //
        //THE BUTTON GITHUB OFFERS ON A MERGED PULL REQUEST. A fork that keeps
        //every branch it has ever merged is a list nobody can read, and the
        //branches that matter are lost among the ones already in master.
        //
        //IT IS SOMEBODY ELSE'S SERVER, so it is gated from outside the window the
        //same way the other outward acts are: over the wire or driven, testing
        //mode must be on for THIS workspace. A model deciding to delete branches
        //on a repository is not a thing to make possible by default.
        //
        //THROUGH THE API, NOT THROUGH A PUSH. ../../git's write door says what it
        //is for — "NOTHING ELSE. No `--delete`" — and a delete-by-push would need
        //that list opened. GitHub has a ref endpoint; this is one call to it, and
        //the git door is left as it is.
        //
        //AND THE COPY HERE GOES WITH IT, IN THE SAME ACT. `refs/remotes/origin/
        //<branch>` is this host's record of what the fork has; deleting the branch
        //there and leaving the copy is a second opinion about one fact, and every
        //panel that reads "where origin has it" believes the copy. That is how a
        //drill which had cleaned up after itself was reported as having left
        //something behind.
        //
        //BY FETCHING, which already prunes — rather than by reaching for
        //`update-ref -d`, which would be a new kind of write for one caller.
        undo.push(actions.define('branchDeleteRemote', {
            about: 'Delete a branch from the fork on GitHub, the way the button on a merged pull request does',
            takes: ['branch', 'repo'],
            run: async function (args) {
                var a = args || {};
                var on = String(a.branch || '').trim();
                if (!on) throw new Error('Say which branch.');

                if (a._overTheWire || a._driven) {
                    var may = await imports.settings.allowed();
                    if (!may.allowed) {
                        throw new Error('Deleting a branch on the fork from outside the window is only done while '
                            + 'testing mode is on for this workspace. ' + may.why);
                    }
                }

                var found = await workspace.repos();
                var here = found.map(function (r) { return r.name; });
                var want = a.repo ? [String(a.repo)] : here;
                for (var i = 0; i < want.length; i++) {
                    if (here.indexOf(want[i]) < 0) {
                        throw new Error('There is no repository called "' + want[i] + '" here. There is: '
                            + here.join(', ') + '.');
                    }
                }

                var done = [];
                for (var j = 0; j < want.length; j++) {
                    var name = want[j];
                    var to = log.on('git', name);

                    try {
                        var remote = await refs.origin(name);
                        if (!remote || remote.kind !== 'github') {
                            throw new Error('"' + name + '" has no GitHub remote.');
                        }

                        var where = remote.owner + '/' + remote.repo;
                        var r = await github.call('DELETE',
                            '/repos/' + remote.owner + '/' + remote.repo + '/git/refs/heads/' + on);

                        //204 IS GONE. 422 AND 404 ARE "IT WAS NOT THERE", which is
                        //the same state and not a failure to report as one — a
                        //cleanup that runs twice should be quiet the second time.
                        if (r.status === 422 || r.status === 404) {
                            done.push({ repo: name, branch: on, gone: false, already: true, on: where });
                            continue;
                        }
                        if (r.status !== 204) {
                            throw new Error('Could not delete "' + on + '" on ' + where + ': '
                                + ((r.body && r.body.message) || ('GitHub answered ' + r.status)));
                        }

                        //THE COPY HERE, through the door that already prunes.
                        try { await git.fetch(name); }
                        catch (e) { to.info('deleted it there, but this host still has its own copy of the branch: ' + e.message); }

                        to.good('deleted ' + on + ' on ' + where);
                        done.push({ repo: name, branch: on, gone: true, on: where });
                    } catch (e) {
                        to.warn(e.message);
                        done.push({ repo: name, branch: on, gone: false, why: e.message });
                    }
                }

                var gone = done.filter(function (d) { return d.gone; });
                return {
                    branch: on,
                    repos: done,
                    note: gone.length
                        ? '"' + on + '" deleted on ' + gone.map(function (d) { return d.repo; }).join(', ')
                            + '. It is untouched here — branchDelete removes it from this host.'
                        : 'Nothing to delete: no fork had "' + on + '".'
                };
            }
        }));

        undo.push(actions.define('repoForkSync', {
            about: "Pull each fork's default branch up from its parent on GitHub, the way the Sync fork button does",
            takes: ['repo', 'branch'],
            run: async function (args) {
                var a = args || {};

                var found = await workspace.repos();
                if (!found.length) throw new Error('There are no repositories in this workspace to sync.');

                var here = found.map(function (r) { return r.name; });
                var want = a.repo ? [String(a.repo)] : here;
                for (var i = 0; i < want.length; i++) {
                    if (here.indexOf(want[i]) < 0) {
                        throw new Error('There is no repository called "' + want[i] + '" here. There is: '
                            + here.join(', ') + '.');
                    }
                }

                var doc = await kept();
                var notes = doc.read({}) || {};
                var done = [];

                for (var j = 0; j < want.length; j++) {
                    var name = want[j];
                    var to = log.on('git', name);

                    try {
                        var note = notes[name] || {};
                        var remote = await refs.origin(name);

                        if (!remote || remote.kind !== 'github') {
                            throw new Error('"' + name + '" has no GitHub remote to sync.');
                        }
                        if (!note.parent) {
                            throw new Error('"' + name + '" is not a fork of anything this app knows about, so there '
                                + 'is nothing upstream to pull from. Ask GitHub about it first.');
                        }

                        var sends = targetOf(note, remote);
                        if (sends.chosen && sends.on !== note.parent) {
                            throw new Error('"' + name + '" sends work to ' + sends.on + ', and GitHub can only sync a '
                                + 'fork from its own immediate parent, which is ' + note.parent + '. Syncing from '
                                + sends.on + ' means fetching and merging through this host — a different act, and one '
                                + 'to ask for rather than have substituted.');
                        }

                        var branch = String(a.branch || note.upstreamDefault || '').trim();
                        if (!branch) throw new Error('Nothing says which branch of "' + name + '" to sync.');

                        var r = await github.call('POST',
                            '/repos/' + remote.owner + '/' + remote.repo + '/merge-upstream', { branch: branch });

                        if (r.status !== 200) {
                            //409 IS A CONFLICT THE FORK CANNOT RESOLVE ON ITS OWN
                            //and 422 is a branch GitHub will not merge into. Said
                            //as itself, because both need a person and neither is
                            //this app being wrong.
                            throw new Error('Could not sync "' + name + '" from ' + note.parent + ': '
                                + ((r.body && r.body.message) || ('GitHub answered ' + r.status)));
                        }

                        //GITHUB SAYS WHICH OF THREE HAPPENED: fast-forward, merge,
                        //or none. "none" is NOT a failure — it is a fork that was
                        //already up to date, and reporting it as an error would
                        //make the ordinary case look wrong.
                        var how = (r.body && r.body.merge_type) || 'none';
                        var row = {
                            repo: name, branch: branch, from: note.parent, how: how,
                            already: how === 'none',
                            said: (r.body && r.body.message) || null
                        };

                        to[row.already ? 'info' : 'good'](row.already
                            ? 'already up to date with its parent'
                            : 'pulled ' + branch + ' up from ' + note.parent + ' (' + how + ')');

                        done.push(row);
                    } catch (e) {
                        to.warn(e.message);
                        done.push({ repo: name, moved: false, how: null, why: e.message });
                    }
                }

                var moved = done.filter(function (d) { return d.how && d.how !== 'none'; });
                return {
                    repos: done,
                    note: moved.length
                        ? moved.length + ' fork(s) pulled up from their parents. This host is still where it was — '
                            + 'fetch to bring it up to them.'
                        : 'Every fork was already up to date with its parent, or could not be pulled up — see each row.'
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
                    var was = notes[want[i].name] || null;
                    var row = await ask(want[i].name, was);

                    //WHAT SOMEBODY CHOSE IS NOT SOMETHING GITHUB ANSWERED, and
                    //this is the one line that keeps those apart.
                    //
                    //A NOTE HOLDS BOTH: facts from GitHub, and where work is
                    //sent — which is the only setting in this app with somebody
                    //else's name on it. Filing an answer used to be
                    //`notes[repo] = row`, a whole-object replacement, so every
                    //field the answer did not mention was dropped. The success
                    //path carried the choice through by hand and `unasked` — what
                    //EVERY failure branch returns — did not mention it at all.
                    //
                    //So a 403, an expired token, a 404, or a remote that is not
                    //GitHub turned "send work to the fork you are working with"
                    //into "send it to yourself", silently: unset means your own
                    //remote, which looks exactly like working. And the inbox
                    //invites somebody to "ask GitHub about this one", so doing
                    //what it asked was what lost it.
                    //
                    //KEPT HERE RATHER THAN IN EACH BRANCH because the fault was
                    //never a branch being wrong — it was a branch not mentioning
                    //something. A sixth one cannot forget what it is not asked
                    //to remember.
                    //AND IT IS A LIST, BECAUSE THERE IS MORE THAN ONE NOW.
                    //Naming `target` alone was right while it was the only
                    //thing here GitHub had not answered. It is not: `reads`
                    //says which places issues and pull requests are read from,
                    //and `chain` is the walk this app paid for. Both were
                    //dropped by the very next check — a set of reads chosen at
                    //the window survived about eight seconds, which is the same
                    //fault this comment was written for, one field along.
                    //
                    //ANYTHING A PERSON CHOOSES OR THIS APP LEARNS FOR ITSELF
                    //GOES IN THIS LIST. It is the one edit needed when the next
                    //one arrives, and it is here rather than in each branch
                    //because the fault was never a branch being wrong — it was
                    //a branch not mentioning something.
                    var keep = {};
                    ['target', 'reads', 'chain'].forEach(function (field) {
                        keep[field] = (was && was[field]) || null;
                    });
                    row = Object.assign({}, row, keep);

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
            guestPath: settingUp.guestPath,

            //---- AND THE ONE PERMISSION EVERY GATE HAS TO ASK ---------------
            //
            //PUBLISHED RATHER THAN ASSEMBLED TWICE. It is `revising.mayRevise`
            //with this plugin's two answers fed to it -- the open cuts and what
            //is protected -- and ../gitserve needs exactly the same thing.
            //
            //A SECOND ASSEMBLY WOULD BE A SECOND OPINION, and the drill
            //`02-the-refusals/05-one-permission-many-gates` is the record of
            //what that costs: the exception for a branch that is out as a pull
            //request was taught to three gates ONE AT A TIME, and each discovery
            //cost a worker run whose commit the rollback then destroyed. Three
            //tasks that finished exit 0 with nothing on the branch.
            //
            //So the rule lives in ../pr/revising, it is put together here once,
            //and every gate asks THIS.
            mayRevise: mayRevise
        },

        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
