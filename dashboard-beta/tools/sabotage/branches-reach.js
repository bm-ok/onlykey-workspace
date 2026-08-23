//what ../../test/repositories/branches-reach.test.js has to be able to catch.
//
//THE BREAK THAT MATTERS MOST does not look dangerous: asking `missing` of the
//whole workspace rather than of the line. It makes a correctly scoped branch
//permanently unusable, and the fix it then offers is to extend that branch into
//a repository the work has nothing to do with.
module.exports = {
    file: 'src/app/repositories/branches/reach.js',
    test: 'test/repositories/branches-reach.test.js',
    breaks: [
        //---- which repositories it is in ---------------------------------------

        //ONLY THE ONES IN SCOPE, so a branch that also exists elsewhere for
        //unrelated reasons does not drag them into this work.
        ['a branch reused elsewhere drags that repository into the work',
            "        in: has.filter(function (n) { return about.indexOf(n) >= 0; }),",
            '        in: has,'],

        //---- and MISSING is about the line -------------------------------------

        //THE ONE WITH TEETH.
        ['missing is asked of the whole workspace, so a scoped branch never works',
            '        missing: about.filter(function (n) { return has.indexOf(n) < 0; }),',
            '        missing: (carriers || []).length ? [] : about,'],

        ['and a branch genuinely missing from its own line is not noticed',
            '        missing: about.filter(function (n) { return has.indexOf(n) < 0; }),',
            '        missing: [],'],

        //---- gone is a different problem ----------------------------------------

        //NOTHING CAN EXTEND A BRANCH INTO A REPOSITORY THAT IS NOT HERE, so
        //offering "cut it there" is advice that cannot be taken.
        ['a repository that is gone is reported as missing',
            '        gone: (scope && scope.gone) || [],',
            '        gone: [],'],

        //---- and why a machine cannot be set up ---------------------------------

        ['a branch missing from some repositories is set up on anyway',
            '    if (reach.missing.length) {',
            '    if (false) {'],

        ['and one no repository has at all',
            '    if (!reach.in.length) {',
            '    if (false) {'],

        ['and one about nothing this workspace has',
            '    if (!reach.about.length) {',
            '    if (false) {'],

        //THE THREE REFUSALS WANT THREE DIFFERENT THINGS DONE: make it, extend
        //it, or look at what happened to the workspace. One sentence for all
        //three sends somebody to do the wrong one.
        ['a branch nothing has is told to EXTEND one that does not exist',
            '    if (!reach.in.length) {\n        return \'There is no branch called "\' + branch + \'" in \' + reach.about.join(\', \') + \'. Make it \'',
            '    if (false) {\n        return \'There is no branch called "\' + branch + \'" in \' + reach.about.join(\', \') + \'. Make it \''],

        //AND THE REFUSAL NAMES WHERE. "It is missing somewhere" is not something
        //anybody can act on.
        ['the refusal does not say which repositories are missing it',
            "        return '\"' + branch + '\" is not in ' + reach.missing.join(', ') + ', and a machine checks it out '",
            "        return '\"' + branch + '\" is not in some repositories, and a machine checks it out '"],

        ['nor which ones it looked in',
            "        return 'There is no branch called \"' + branch + '\" in ' + reach.about.join(', ') + '. Make it '",
            "        return 'There is no branch called \"' + branch + '\". Make it '"],

        //AND A USABLE BRANCH IS NOT REFUSED. A gate that fires on the correct
        //case is worse than no gate: it teaches people to work around it.
        ['every branch is refused, whatever it is in',
            '    return null;\n}',
            "    return 'no';\n}"]
    ]
};
