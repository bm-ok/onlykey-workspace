//what ../../test/runners/guests-lending.test.js has to be able to catch.
//
//THIS IS THE FILE THAT KEEPS "who said this work holds" SEPARABLE FROM "who
//wrote it". Every break below either collapses two identities into one or lets
//a sign-in reach a machine that must not spend it.
module.exports = {
    file: 'src/app/runners/guests/lending.js',
    test: 'test/runners/guests-lending.test.js',
    breaks: [
        //---- a supervisor sign-in, refused for BEING one ------------------------

        //ASKED FIRST BECAUSE IT IS TRUE OF EVERY MACHINE. Answered by the
        //untagged branch instead, the refusal was correct and gave DANGEROUS
        //ADVICE — "give it the worker tag, and then this can go to it" — which
        //is the one action that must not fix it.
        ['the untagged branch answers first, and invites the fix that must not work',
            "    if (want === 'supervisor' && can.indexOf('supervisor') < 0) {",
            '    if (false) {'],

        ['a supervisor sign-in goes to a runner',
            "    if (want === 'supervisor' && can.indexOf('supervisor') < 0) {",
            "    if (want === 'supervisor' && can.length && can.indexOf('supervisor') < 0) {"],

        //---- a machine that has not said what it is -------------------------------

        //NO TAG IS NOT A DEFAULT, it is an unanswered question. Picking one here
        //means guessing whose identity to put on a machine.
        ['an untagged machine is lent to anyway',
            '    if (!can.length) {',
            '    if (false) {'],

        ['and the refusal does not say what would fix it',
            "            + 'holds a worker\\'s identity or a judge\\'s, and the tag is how it says which — give it the '\n            + '\"worker\" tag or the \"judge\" tag with vmTags, and then \"' + name + '\" can go to it.';",
            "            + 'holds an identity of a kind.';"],

        //---- membership, not equality ----------------------------------------------

        //A MACHINE TAGGED WORKER AND JUDGE SERVES BOTH. Written as equality it
        //silently resolved to whichever tag was checked first, and the other did
        //nothing.
        ['a dual machine resolves to whichever tag comes first',
            '    if (can.indexOf(want) >= 0) return null;',
            '    if (can[0] === want) return null;'],

        //---- and the mismatches that must stay refusals ------------------------------

        //A JUDGE MACHINE SIGNS IN AS ITSELF. A worker sign-in there holds one of
        //the identities the runners draw from and bills that work to a worker.
        ['a worker sign-in goes to a judge machine',
            '    if (can.indexOf(want) >= 0) return null;',
            '    return null;'],

        //---- which of a list could go out right now ------------------------------------

        //A SIGN-IN A MACHINE REPORTED BAD is known bad until a machine says
        //otherwise, and nothing has to spend a machine to find out again.
        ['a paused sign-in is offered as free',
            '            && !shape.paused(g)',
            ''],

        //READ FROM THE FILE RATHER THAN TRUSTED FROM THE RECORD, so one removed
        //by hand says so instead of claiming a token.
        ['a sign-in whose file is gone is offered as free',
            '            && g.has',
            ''],

        //ONE ALREADY OUT IS OUT. Two machines sharing one sign-in are two
        //workers rotating the same credential underneath each other.
        ['a sign-in already on another machine is offered again',
            '            && (!g.holder || g.holder === (machine || null));',
            '            && true;'],

        //AND A MACHINE ALREADY HOLDING ONE IS NOT REFUSED ITS OWN.
        ['a machine is told the sign-in it is holding is taken',
            '            && (!g.holder || g.holder === (machine || null));',
            '            && !g.holder;'],

        ['the role is not checked, so a judge sign-in is offered to a runner',
            '        return g.role === role',
            '        return true'],

        //---- and the ones that would be free but for having failed -----------------------

        //"NO WORKER SIGN-IN IS FREE" AND "THE TWO YOU HAVE ARE BOTH PAUSED" want
        //different things done about them.
        ['the paused ones are not named, so a refusal cannot say which to replace',
            '        return g.role === role && g.has && shape.paused(g);',
            '        return false;'],

        //---- what the queue asks --------------------------------------------------------

        //THE QUEUE READS `.free` OFF THIS. A missing key reads as undefined, and
        //`!undefined` is true — the right answer reached by luck.
        ['a host holding nothing answers with nothing rather than zero',
            "    return ['worker', 'judge'].reduce(function (n, role) {",
            "    if (!(rows || []).length) return {};\n    return ['worker', 'judge'].reduce(function (n, role) {"],

        //A SUPERVISOR SIGN-IN IS NEVER LENT TO A RUNNER, so counting one as
        //available would have the queue dispatch against an identity it can
        //never be given.
        ['a supervisor sign-in is counted as available to the queue',
            "    return ['worker', 'judge'].reduce(function (n, role) {",
            "    return ['worker', 'judge', 'supervisor'].reduce(function (n, role) {"],

        ['the free count includes ones that are out',
            '            free: choosable(rows, role, null).length,',
            '            free: (rows || []).filter(function (g) { return g.role === role; }).length,']
    ]
};
