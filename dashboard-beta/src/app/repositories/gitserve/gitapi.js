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
    var whyProtected = d.whyProtected;
    var mayRevise = d.mayRevise;
    var freeEverywhere = d.freeEverywhere;
    var whatIsOn = d.whatIsOn;
    var say = d.say;

    //EVERY RULE THIS DOOR APPLIES, CHECKED THE MOMENT IT IS BUILT.
    //
    //ALL FOUR OF THESE WERE FREE IDENTIFIERS FOR A WHILE, and the app ran. A
    //free identifier is valid syntax: `npm run check` bundled it, the suite was
    //green, the door registered, and a clone worked perfectly — because a clone
    //touches none of them. Only a push did, and by then the error was a
    //ReferenceError inside a `try` that was there to tolerate a rule ANSWERING
    //badly, not a rule that was not there at all.
    //
    //WHAT IT LOOKED LIKE FROM THE OUTSIDE WAS SUCCESS. The push was refused —
    //correctly — by the pre-receive hook, which is the third gate and the one
    //that cannot be edited. Three gates exist so that one of them failing is not
    //a hole, and this is what that redundancy buys. It is not a reason to leave
    //the first two broken: the drill this door is written to says a gate that
    //decides for itself is the same fault, and a gate that silently decides
    //NOTHING is worse, because it looks like agreement.
    //
    //SO IT THROWS HERE, AT REGISTRATION, where the app will not start rather
    //than at a push where it would quietly wave one through.
    ['scopeOf', 'whyProtected', 'mayRevise', 'freeEverywhere', 'whatIsOn'].forEach(function (rule) {
        if (typeof d[rule] !== 'function') {
            throw new Error('the git door was built without "' + rule + '", so it cannot decide who may push. '
                + 'Every rule it applies is asked of the plugin that owns it — see ./server.js.');
        }
    });

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

        if (!serve.SERVICES[service]) {
            return text(at, 400, 'this serves git\'s smart http protocol and nothing else\n');
        }

        var found = await where(at, service);
        if (!found) return;

        //---- A PUSH IS JUDGED AT THE ADVERTISEMENT TOO ---------------------
        //
        //BOTH PHASES ASK, and the same function answers, because a push is two
        //requests: git asks what refs are here, then sends the packfile. Letting
        //the first through and refusing the second means a worker uploads its
        //work before being told no — and the refusal then arrives as a failed
        //POST rather than as the sentence written for it.
        //
        //It also means the two could disagree, which is the fault this whole
        //door is arranged against: the advertisement saying yes and the packfile
        //saying no is a push that half happens.
        if (service === 'git-receive-pack') {
            var env = await mayPush(at, found.repo);
            if (!env) return;
            found.env = env;
        }

        serve.advertise(at.res, found);
    }

    //---- PHASE TWO ---------------------------------------------------------
    async function packs(at) {
        var tail = repoFrom(at.url.pathname).tail;

        var service = tail === '/git-receive-pack' ? 'git-receive-pack'
            : tail === '/git-upload-pack' ? 'git-upload-pack'
                : null;

        if (!service) {
            return text(at, 400, 'this serves git\'s smart http protocol and nothing else\n');
        }

        var found = await where(at, service);
        if (!found) return;

        if (service === 'git-receive-pack') {
            var env = await mayPush(at, found.repo);
            if (!env) return;
            found.env = env;
        }

        serve.rpc(at.req, at.res, found);
    }

    //---- AND WHAT A PUSH HAS TO PASS BEFORE receive-pack IS STARTED ---------
    //
    //Answers the environment the hook is to be given, or null having already
    //refused. Every refusal here ends with the same sentence — NOTHING WAS
    //TAKEN — because the thing a worker needs to know first is whether the hour
    //it just spent is gone, and it is not.
    //
    //ASCII ONLY. Git relays a remote's message as raw bytes and transcodes
    //nothing, so an em-dash arrives in somebody's terminal as mojibake: a
    //message about a refusal, itself looking broken.
    async function mayPush(at, repo) {
        var to = say('git', at.name);
        var branch = at.vm && at.vm.branch;

        //---- A JUDGEMENT READS. IT DOES NOT WRITE. -------------------------
        //
        //A judging machine is set up ON the branch it is reading, because
        //reading code means having it — and being set up on a branch is what
        //every other machine's permission to push is made of. So the checks
        //below would all say yes, and a judge could push to the very line it was
        //asked to pass judgement on: the change somebody is waiting to land
        //would quietly contain the judge's own work.
        //
        //REFUSED HERE RATHER THAN BY GIVING THE JUDGING JOB NO PUSH IN ITS
        //SCRIPT. A script is a thing a job's author writes; this is the host,
        //and it is the only end a guest cannot edit.
        //
        //NAMING THE COMMAND THAT EXISTS. This said `okc-hand-back` in the app
        //this comes from, which is not a thing on any machine — an error telling
        //somebody to run a command that does not exist is worse than one that
        //says nothing, because it costs them the time to find that out.
        //---- A RULE THAT THREW IS NOT A RULE THAT SAID YES -----------------
        //
        //These were `catch (e) { <the permissive answer> }`, which is how all
        //four rules being undefined looked exactly like all four rules allowing
        //the push. A refusal that cannot be evaluated has not been satisfied, so
        //each one below refuses and SAYS which question it could not answer.
        var doing;
        try { doing = await whatIsOn(at.name); }
        catch (e) {
            to.bad('could not find out what ' + at.name + ' is running, so it may not push: ' + e.message);
            text(at, 503,
                'this host could not work out what this machine is doing, so it will not take a push.\n'
                + 'nothing was taken - your commits are still on your own copy.\n');
            return null;
        }

        if (doing && doing.kind === 'judgement') {
            to.warn(at.name + ' is judging ' + (doing.reads || 'a change') + ' and tried to push to ' + repo);
            text(at, 403,
                'refused: this machine is reading a change, not making one.\n'
                + 'a judgement may not push to what it judges - hand your findings back as a file instead:\n'
                + '  okc-artifact <file>\n'
                + 'nothing was taken - your commits are still on your own copy.\n');
            return null;
        }

        //---- NOTHING TO PUSH TO ---------------------------------------------
        //
        //Refused before any of the rest, so the failure is "you have not been
        //set up" rather than a hook talking about a branch nobody chose.
        if (!branch) {
            to.warn(at.name + ' tried to push to ' + repo + ' without being set up on a branch');
            text(at, 403,
                'no branch is recorded for this machine.\n'
                + 'set it up on a branch from the dashboard, then push again.\n'
                + 'nothing was taken - your commits are still on your own copy.\n');
            return null;
        }

        //---- PROTECTED, UNLESS IT IS A CHANGE THAT IS ALREADY OUT -----------
        //
        //CHECKED AT THE PUSH AND NOT ONLY WHEN THE MACHINE WAS SET UP. A machine
        //set up before a rule existed still carries whatever branch it was
        //given, and a branch can BECOME protected afterwards — checking one out
        //on the host is enough. The recorded permission is not evidence on its
        //own; it is re-read against the rule every time it is used.
        //
        //`mayRevise` IS THE WHOLE PERMISSION and is asked, never re-derived. It
        //answers true for a branch nothing protects, false for a repository's
        //default branch whatever else is true of it, and true only for the one
        //case that bends: a line-link that is the source of an open pull request
        //nobody has merged. That branch exists to be revised.
        var guarded;
        try { guarded = await whyProtected(branch); }
        catch (e) {
            to.bad('could not work out whether ' + branch + ' is protected, so it may not be pushed to: ' + e.message);
            text(at, 503,
                'this host could not work out whether that branch is protected, so it will not take a push.\n'
                + 'nothing was taken - your commits are still on your own copy.\n');
            return null;
        }

        if (guarded) {
            var revising;
            try { revising = await mayRevise(branch); }
            catch (e) {
                to.bad('could not work out whether ' + branch + ' may be revised, so it may not: ' + e.message);
                text(at, 503,
                    'this host could not work out whether that branch may be revised, so it will not take a push.\n'
                    + 'nothing was taken - your commits are still on your own copy.\n');
                return null;
            }

            if (!revising) {
                to.warn(at.name + ' tried to push ' + branch + ', which is protected');
                text(at, 403,
                    'refused: ' + branch + ' is protected and cannot be pushed to.\n'
                    + 'nothing was taken - your commits are still on your own copy.\n');
                return null;
            }
            to.info(branch + ' is out as a pull request and not merged - ' + at.name + ' may push to it');
        }

        //---- AND THIS HOST'S OWN CHECKOUT GETS OUT OF THE WAY ---------------
        //
        //Git refuses a push to a branch that is checked out, so a review left
        //open here would fail the machine's push for a reason that has nothing
        //to do with the machine — and say so in terms of a configuration
        //variable. If that checkout is clean it is worth nothing, so this steps
        //off it. If it is NOT, the push is refused naming the work that is in
        //the way, which is the one thing the machine's own error could never
        //have said.
        try {
            var each = (await freeEverywhere(branch)) || [];
            for (var i = 0; i < each.length; i++) {
                var f = each[i];
                if (f.busy) {
                    to.warn(f.why);
                    text(at, 409,
                        'refused: ' + f.why + '\n'
                        + 'nothing was taken - your commits are still on your own copy.\n');
                    return null;
                }
                if (f.freed) {
                    to.info(f.repo + ' was on ' + f.from + ' here; moved it back to ' + f.to
                        + ' so the push can land');
                }
            }
        } catch (e) {
            //NOT FATAL. Failing to clear the way is not the same as the way
            //being blocked: git may well accept the push anyway, and refusing
            //here would turn a tidying step into a gate nobody meant to add.
            to.warn('could not clear the way for ' + branch + ': ' + e.message);
        }

        //---- WHAT THE HOOK IS TOLD ------------------------------------------
        //
        //The refs are in the packfile, but WHO is pushing came from the token on
        //the HTTP request and a hook cannot see that. So the branch is handed
        //over as a fact rather than a name to look up.
        var env = { OKC_ALLOW_BRANCH: branch, OKC_MACHINE: at.name };

        //READ-ONLY WHERE THE BRANCH IS A LINE, and this is the THIRD gate to
        //decide this one permission — the route above, the sign put in the
        //guest's checkout by ../repos/workspace.js, and the fact handed here to
        //the hook that actually refuses.
        //
        //THE PER-REF TEST IN THE HOOK CANNOT CATCH IT, which is exactly why this
        //exists: on a line, the branch being pushed to IS the branch the machine
        //was set up on, so that test says yes. Told here rather than worked out
        //in the hook, because only this side knows what is protected — and told
        //as a FACT rather than a name, so the hook has nothing to look up.
        //ASKED AGAIN RATHER THAN REMEMBERED, and it is the same call: above it
        //decides whether the push happens at all, here it decides what the hook
        //is told. If it threw it has already refused above, so reaching this
        //line means it answered.
        if (!(await mayRevise(branch))) env.OKC_READ_ONLY = '1';

        return env;
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
