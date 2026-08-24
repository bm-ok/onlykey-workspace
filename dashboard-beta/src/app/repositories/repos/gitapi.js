//---------------------------------------------------------------------------
//THE GIT DOOR A MACHINE CLONES THROUGH.
//
//../../vms/https has already decided WHO is asking by the time anything here
//runs — a token, matched against the register — and has already asked `may`
//below. What is left is the two questions this door owns: which repository, and
//is it one this machine's work is about.
//
//---- ONLY THE REPOSITORIES ITS BRANCH IS ABOUT ---------------------------
//
//Being a machine this app made was once the whole of the authorization: any
//token reached any repository in the workspace. So the scope enforced when the
//workspace was BUILT — two repositories out of three — was a decision about what
//got checked out, and nothing stopped a worker cloning the third itself. A limit
//that only holds while nobody tries is not a limit.
//
//READ FROM THE BRANCH EVERY TIME rather than recorded against the machine. A
//recorded permission is not evidence, it is a copy of a decision that may have
//changed since — a line can gain a repository, and the machine's record would
//still say what it said when it was set up.
//
//A MACHINE WITH NO BRANCH YET IS NOT REFUSED HERE. It has not been set up, and
//"you have not been set up" is a better answer than one about repositories —
//but it is also not this door's to give, because the thing that sets a machine
//up is the thing that is about to clone. So no branch means no scope to check,
//and the read is allowed: it is the setup itself.
//
//---- ASCII ONLY IN ANYTHING THAT CROSSES TO A GIT CLIENT -----------------
//
//And that is not fussiness. Git relays a remote's message as raw bytes and
//transcodes nothing, so an em-dash in a refusal reaches the operator's terminal
//as mojibake — a message about a refusal, itself looking broken. The live log is
//this app's and keeps its punctuation; every string that goes out in a response
//body below is plain ASCII.
//---------------------------------------------------------------------------

module.exports = function gitApi(d) {
    var serve = d.serve;
    var scopeOf = d.scopeOf;
    var say = d.say;

    function text(at, code, body) {
        at.res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
        at.res.end(body);
    }

    //`<name>` AND `<name>.git` ARE BOTH SPELLED BY GIT CLIENTS, and the same
    //repository answers to either.
    function repoFrom(pathname) {
        var rest = pathname.slice('/git/'.length);
        var cut = rest.indexOf('/');
        var repo = (cut === -1 ? rest : rest.slice(0, cut)).replace(/\.git$/, '');
        return { repo: repo, tail: cut === -1 ? '' : rest.slice(cut) };
    }

    //---- WHAT BOTH PHASES HAVE TO ESTABLISH FIRST -------------------------
    //
    //Written once because the two routes must not be able to disagree about it.
    //The advertisement saying yes and the packfile saying no is a clone that
    //half happens, and the client reports it as a protocol error.
    async function where(at, service) {
        var it = repoFrom(at.url.pathname);
        var repo = it.repo;

        var dir = await serve.gitDirOf(repo);
        if (!dir) {
            text(at, 404, 'no repository called "' + repo + '" in the workspace\n');
            return null;
        }

        //THE SCOPE, AND IT IS THE ONLY RULE A READ HAS.
        var branch = at.vm && at.vm.branch;
        if (branch) {
            var scope = null;
            try { scope = await scopeOf(branch); }
            catch (e) { scope = null; }

            //A SCOPE THAT COULD NOT BE READ IS NOT AN EMPTY SCOPE, and it is not
            //a free pass either. It is this host failing to answer a question it
            //must answer before handing code over, so it refuses and says which
            //question — the one direction that is safe to be wrong in.
            if (!scope || !Array.isArray(scope.repos)) {
                say('git', at.name).bad('could not work out what "' + branch + '" is about, so '
                    + at.name + ' was refused ' + repo);
                text(at, 503, 'this host could not work out which repositories your work is about.\n'
                    + 'nothing was taken - try again, and tell somebody if it keeps happening.\n');
                return null;
            }

            if (scope.repos.indexOf(repo) === -1) {
                say('git', at.name).warn(at.name + ' asked for ' + repo
                    + ', which is not part of "' + branch + '"');
                text(at, 403, 'refused: ' + repo + ' is not part of the work you were given.\n'
                    + '"' + branch + '" is about ' + scope.repos.join(', ') + '.\n');
                return null;
            }
        }

        return { dir: dir, repo: repo, service: service };
    }

    //---- ONE ROUTE PER METHOD, AND THE TAIL DECIDES -----------------------
    //
    //`/git/<repo>/info/refs` cannot be a route. ../../vms/https/registry only
    //understands a star at the END of a path — everything else is compared
    //exactly — so a middle one would be matched as the literal characters and
    //nothing would ever reach it. Not an error either: an unmatched path is the
    //same 401 a stranger gets, on purpose, so this would have failed as "that
    //machine may not ask for that" and pointed at the register.
    //
    //THE APP THIS COMES FROM IS THE SAME SHAPE — one `/git/` prefix and a switch
    //on the tail — which is worth noticing before inventing a pattern language
    //for one caller.
    //---- PHASE ONE ---------------------------------------------------------
    async function refs(at) {
        if (repoFrom(at.url.pathname).tail !== '/info/refs') {
            return text(at, 400, 'this serves git\'s smart http protocol and nothing else\n');
        }

        var service = at.url.searchParams.get('service');

        //PUSHING IS REFUSED IN WORDS, not left to fail as an unknown service.
        //
        //`receive-pack` is not served here yet — see ./serve.js for what a push
        //carries that a read does not, and why shipping three of its four checks
        //would be the more dangerous kind of half-finished. A machine that tries
        //should be told that, once, at the first request, rather than getting a
        //protocol error at the end of a push it thought was working.
        if (service === 'git-receive-pack') {
            say('git', at.name).warn(at.name + ' tried to push to ' + repoFrom(at.url.pathname).repo
                + ', and pushing is not served by this host yet');
            return text(at, 403,
                'refused: this host serves clones and fetches, not pushes, for now.\n'
                + 'nothing was taken - your commits are still on your own copy.\n');
        }

        if (!serve.SERVICES[service]) {
            return text(at, 400, 'this serves git\'s smart http protocol and nothing else\n');
        }

        var found = await where(at, service);
        if (!found) return;
        serve.advertise(at.res, found);
    }

    //---- PHASE TWO ---------------------------------------------------------
    async function packs(at) {
        var tail = repoFrom(at.url.pathname).tail;

        if (tail === '/git-receive-pack') return pushed(at);
        if (tail !== '/git-upload-pack') {
            return text(at, 400, 'this serves git\'s smart http protocol and nothing else\n');
        }

        var found = await where(at, 'git-upload-pack');
        if (!found) return;
        serve.rpc(at.req, at.res, found);
    }

    function pushed(at) {
        say('git', at.name).warn(at.name + ' tried to push to ' + repoFrom(at.url.pathname).repo
            + ', and pushing is not served by this host yet');
        text(at, 403,
            'refused: this host serves clones and fetches, not pushes, for now.\n'
            + 'nothing was taken - your commits are still on your own copy.\n');
    }

    return {
        name: 'git',
        about: 'The workspace repositories, so a machine can clone the work it was given',

        //---- WHO MAY REACH IT -------------------------------------------
        //
        //ANY MACHINE THIS APP MADE THAT IS NOT A SUPERVISOR. A supervisor holds
        //no repositories and runs no task or judgement — it decides, through the
        //supervisor door, and never has code in front of it. Refused here so the
        //fence is stated where the verbs are; the same 401 as a stranger gets,
        //because from this door it IS one.
        may: function (vm) {
            return !!(vm && vm.name && !(vm.tags || []).some(function (t) {
                return String(t).toLowerCase() === 'supervisor';
            }));
        },

        //A TRAILING STAR AND NOTHING ELSE — see the block above `refs`. The
        //POST route carries the push too, so that a machine doing something this
        //host does not do YET is told that, rather than getting the 401 a
        //stranger gets and being pointed at the register.
        routes: [
            { method: 'GET', path: '/git/*', about: 'what refs a repository has', run: refs },
            { method: 'POST', path: '/git/*', about: 'send the packfile being cloned', run: packs }
        ]
    };
};
