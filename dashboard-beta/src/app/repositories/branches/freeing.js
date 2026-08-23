//---------------------------------------------------------------------------
//GETTING THE HOST OUT OF THE WAY OF A MACHINE.
//
//A repository on THIS disk with a branch checked out is invisible to the machine
//that wants that branch. The machine's push is refused, and its own error cannot
//say why — it does not know this working tree exists. Met on the machine it is a
//message about a configuration variable; met here it is a sentence about a file
//somebody left open.
//
//SO IT IS ASKED HERE, before a machine is set up on a branch and before it
//pushes one — both moments where a checkout left open would otherwise fail
//something that has nothing to do with it.
//
//---- and a clean checkout is stepped out of, a dirty one is not ------------
//
//A clean working tree is holding nothing and is free to move. One that has been
//EDITED is somebody's work, and moving off it to unblock a machine would be this
//app deciding whose work matters more. So that case is reported instead, naming
//what is in the way.
//
//The refusal is ../../git's, not this file's — see the checkout door there,
//which asks git whether the tree is clean and stops if it is not or if it cannot
//tell. This decides WHICH repositories to ask about; that decides whether the
//answer is yes.
//
//---- the default branch is the one recorded on FIRST SIGHT -----------------
//
//NOT THE ONE IT IS ON NOW, which is the whole point: a repository sitting on
//some other branch is exactly the case this exists for, and reading its current
//head as its default would make every such repository look like it was already
//home.
//
//So the first time this app sees a repository, whatever it is on is written down
//as where it belongs — and nothing moves it afterwards.
//---------------------------------------------------------------------------

module.exports = function freeing(deps) {
    var d = deps || {};

    var repos = d.repos;          //async () -> [{ name }]
    var headOf = d.headOf;        //async (repo) -> branch, or null
    var checkout = d.checkout;    //../../git's gated write
    var bare = d.bare || function () { return false; };

    //WHERE THE RECORD LIVES. A doc rather than a field on anything, because it
    //is a fact about this host's copy of a repository and not about the branch,
    //the line, or the work.
    var kept = d.kept;
    var now = d.now || function () { return new Date().toISOString(); };

    //---- where a repository belongs ---------------------------------------
    async function defaultOf(repo) {
        var all = (await kept.read({})) || {};
        if (all[repo] && all[repo].default) return all[repo].default;

        var head = await headOf(repo);
        if (!head) return null;

        all[repo] = Object.assign({}, all[repo] || {}, { default: head, notedAt: now() });
        await kept.write(all);
        return head;
    }

    //---- and whether one is in the way ------------------------------------
    async function freeIfBusy(repo, branch) {
        //BARE REPOSITORIES ARE SKIPPED. They have no working tree, nothing is
        //checked out in the sense that matters, and git accepts the push
        //regardless.
        if (await bare(repo)) return { repo: repo, freed: false, busy: false };

        var head = await headOf(repo);
        if (head !== branch) return { repo: repo, freed: false, busy: false };

        var home = await defaultOf(repo);

        //NOWHERE TO SEND IT, and there are two ways to get here.
        //
        //`home === branch` is the ordinary one: this branch IS where the
        //repository belongs, so it is not in the way of anything — it is at
        //home, and the machine works around it rather than the other way about.
        //
        //`!home` LOOKS UNREACHABLE AND IS NOT. The head was read a moment ago
        //and matched; `defaultOf` reads it AGAIN when nothing is recorded yet,
        //and between those two awaits the repository can move — somebody in a
        //terminal, another part of this app, a checkout finishing. A repository
        //that has stopped answering between one line and the next is not one to
        //send anywhere on a guess.
        if (!home || home === branch) return { repo: repo, freed: false, busy: false };

        var moved = await checkout(repo, home);
        if (moved.moved) return { repo: repo, freed: true, busy: false, from: branch, to: home };

        //ALREADY THERE cannot happen — `head !== branch` returned above — so
        //anything that did not move is either dirty or a git refusal, and both
        //are somebody's problem to look at rather than this app's to work
        //around.
        return { repo: repo, freed: false, busy: true, why: moved.why };
    }

    //---- the same, for every repository at once ----------------------------
    //
    //ONLY THE ONES THAT MOVED OR ARE IN THE WAY come back. A repository that was
    //never on this branch is not news, and a caller looping over "nothing
    //happened" is a caller that has to work out what did.
    async function freeEverywhere(branch) {
        var found = (await repos()) || [];
        var out = [];

        for (var i = 0; i < found.length; i++) {
            var said = await freeIfBusy(found[i].name || found[i], branch);
            if (said.freed || said.busy) out.push(said);
        }

        return out;
    }

    return { defaultOf: defaultOf, freeIfBusy: freeIfBusy, freeEverywhere: freeEverywhere };
};
