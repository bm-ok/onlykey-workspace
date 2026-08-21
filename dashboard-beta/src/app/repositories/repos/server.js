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

plugin.consumes = ['app', 'log', 'git', 'github', 'workspace', 'state'];
plugin.provides = ['repositories'];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log;
    var git = imports.git;
    var github = imports.github;
    var workspace = imports.workspace;
    var state = imports.state;

    //IN THE WORKSPACE'S DRAWER, NOT THE HOST'S. What GitHub says about
    //`local-repo-a` is a fact about the folder of repositories that is open —
    //open a different workspace and it is a different `local-repo-a`, or none.
    //This is the second caller of `state.here`, and the app being ported from
    //keeps the same file per workspace for the same reason.
    async function kept() { return state.here.doc('repositories'); }

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

    //---- one repository, asked ---------------------------------------------
    async function ask(name) {
        var remote = null;
        try { remote = await git.origin(name); }
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

        return {
            repo: name,
            remote: remote,
            reachable: true,
            defaultBranch: r.body.default_branch || null,
            //WHERE A PULL REQUEST WOULD ACTUALLY GO. A fork is not a detail
            //about a repository, it is the answer to that question — a pull
            //request from a fork is created IN THE PARENT.
            fork: !!r.body.fork,
            parent: r.body.parent && r.body.parent.full_name ? r.body.parent.full_name : null,
            openPulls: canReadPulls && Array.isArray(pulls.body) ? pulls.body.length : null,
            may: { code: canReadCode, pulls: canReadPulls },
            why: missing.length
                ? 'the token cannot use its ' + missing.join(' or ') + ' — add that permission where the token was made'
                : null,
            at: new Date().toISOString()
        };
    }

    var undo = [];
    if (actions) {
        //---- THE READ IS NOT DEFINED HERE YET, AND THAT IS DELIBERATE -------
        //
        //`repositories` is what the pane draws, and its rows carry more than
        //twenty fields: the local half (path, default branch, head, how many
        //branches), the remembered GitHub half, a per-repository TARGET setting
        //that says where a pull request would go, the issues, and derived
        //answers like `inStep` and `stale`.
        //
        //DEFINING A THINNER ONE HERE WOULD SHADOW THE RELAYED ONE and the pane
        //would quietly lose two thirds of what it shows — every missing field
        //arriving as `undefined`, which renders as nothing rather than as an
        //error. That is the worst available failure for a port: it looks like it
        //worked.
        //
        //So the read stays relayed until the rest of the row can come with it,
        //and ./server.js provides `repositories.read()` for whatever ports next.
        //The check below is what proves the layering, and it says out loud which
        //half of the pane it is answering.
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
                    var row = await ask(want[i].name);
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
                        //SAID OUT LOUD, because this half has moved and the half
                        //below it on the pane has not. Somebody pressing Check
                        //and seeing unchanged rows should be told why rather than
                        //left to conclude the button is broken.
                        + ' — asked by this app, through its own token. The rows below still come from the dashboard until the reading half is ported.'
                };
            }
        }));
    }

    await register(null, {
        repositories: {
            ask: ask,
            read: read
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
