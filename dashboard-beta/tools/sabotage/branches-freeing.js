//what ../../test/repositories/branches-freeing.test.js has to be able to catch.
//
//THE TWO FAILURES THIS FILE SITS BETWEEN: a machine blocked by a checkout on
//this host that nothing explains, and somebody's half-finished work moved out
//from under them to unblock a machine. Every break below causes one or the
//other.
module.exports = {
    file: 'src/app/repositories/branches/freeing.js',
    test: 'test/repositories/branches-freeing.test.js',
    breaks: [
        //---- where a repository belongs ---------------------------------------

        //NOT THE ONE IT IS ON NOW. Reading the current head as the default makes
        //every repository sitting somewhere else look like it is already home —
        //which is precisely the case this exists for, so the bug hides the only
        //situation the code is written for.
        ['the default is read live, so a repository is never in the way',
            '        var all = (await kept.read({})) || {};\n        if (all[repo] && all[repo].default) return all[repo].default;',
            ''],

        ['and it is never recorded, so first sight happens every time',
            "        all[repo] = Object.assign({}, all[repo] || {}, { default: head, notedAt: now() });\n        await kept.write(all);",
            ''],

        //A GUESS WRITTEN DOWN is worse than no answer: it is believed for ever
        //afterwards.
        ['a repository nothing could be read from has a default invented for it',
            '        if (!head) return null;',
            "        if (!head) head = 'master';"],

        //---- whether one is in the way ------------------------------------------

        ['a repository not on the branch is moved anyway',
            '        if (head !== branch) return { repo: repo, freed: false, busy: false };',
            ''],

        //A DIRTY TREE IS SOMEBODY'S WORK, and moving off it to unblock a machine
        //is this app deciding whose work matters more.
        ['anything that did not move is reported as fine',
            '        return { repo: repo, freed: false, busy: true, why: moved.why };',
            '        return { repo: repo, freed: false, busy: false };'],

        ['and a move that failed is reported as having happened',
            '        if (moved.moved) return { repo: repo, freed: true, busy: false, from: branch, to: home };',
            '        if (true) return { repo: repo, freed: true, busy: false, from: branch, to: home };'],

        //WHAT IS IN THE WAY has to travel, or the caller has a refusal with
        //nothing in it.
        ['nothing says what is in the way',
            '        return { repo: repo, freed: false, busy: true, why: moved.why };',
            '        return { repo: repo, freed: false, busy: true };'],

        //A BARE REPOSITORY HAS NO WORKING TREE. Asking it to check out is a
        //failure reported as a machine being blocked by nothing.
        ['a bare repository is asked to move',
            '        if (await bare(repo)) return { repo: repo, freed: false, busy: false };',
            ''],

        //NOWHERE TO SEND IT. A repository at home is not in the way, and one
        //whose default is unknown must not be moved on a guess.
        ['a repository already at home is moved to where it already is',
            '        if (!home || home === branch) return { repo: repo, freed: false, busy: false };',
            ''],

        //I FIRST WROTE THIS OFF AS UNREACHABLE, AND IT IS NOT.
        //
        //The head is read here and read AGAIN inside `defaultOf`, and there is
        //an await between them — so a repository that moves in that window
        //arrives with `head === branch` true and `home` null. It looked dead
        //because the value had been checked a line above; a guard is only dead
        //if nothing can change between the check and the use.
        ['a repository that moved between the two reads is sent nowhere',
            '        if (!home || home === branch) return { repo: repo, freed: false, busy: false };',
            '        if (home === branch) return { repo: repo, freed: false, busy: false };'],

        //---- and every repository at once -----------------------------------------

        //A REPOSITORY THAT WAS NEVER ON THIS BRANCH IS NOT NEWS, and a caller
        //looping over "nothing happened" has to work out what did.
        ['every repository comes back, whether or not anything happened',
            '            if (said.freed || said.busy) out.push(said);',
            '            out.push(said);'],

        ['and nothing comes back at all',
            '            if (said.freed || said.busy) out.push(said);',
            ''],

        //ONE IN THE WAY IS A SENTENCE FOR SOMEBODY, not a reason to leave the
        //other repositories blocking a machine as well.
        ['the first one in the way stops the rest being freed',
            '            if (said.freed || said.busy) out.push(said);',
            '            if (said.busy) { out.push(said); break; }\n            if (said.freed) out.push(said);'],

        ['and only the first repository is looked at',
            '        for (var i = 0; i < found.length; i++) {',
            '        for (var i = 0; i < Math.min(1, found.length); i++) {']
    ]
};
