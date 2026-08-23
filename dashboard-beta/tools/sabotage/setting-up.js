//what ../../test/repositories/setting-up.test.js has to be able to catch.
//
//EVERY BREAK BELOW EITHER SPENDS A MACHINE ON A MISTAKE THAT WAS KNOWABLE
//WITHOUT ONE, or leaves work that is neither finished nor lost — commits on a
//machine, on a branch it may no longer push, with nothing saying so.
module.exports = {
    file: 'src/app/repositories/repos/setting-up.js',
    test: 'test/repositories/setting-up.test.js',
    breaks: [
        //---- a path on the machine, not on this host ---------------------------

        //GIT BASH REWRITES IT ON THE WAY THROUGH, so `/home/okc/work` arrives as
        //a real path on the wrong computer and the guest makes a directory with
        //spaces in it.
        ['a path on this host is sent to the machine as a folder',
            "        guestPath(it.folder, '--folder');",
            ''],

        ['and the refusal does not say what caused it',
            "        throw new Error('\"' + p + '\" is a path on this host, not on the machine. If you are in Git Bash '",
            "        throw new Error('\"' + p + '\" is not a path on the machine. '"],

        //---- what is knowable without a machine --------------------------------

        //THE ANSWER TO A TYPO USED TO BE FIVE MINUTES AWAY, and arrived as though
        //the machine were the problem.
        ['a branch that does not exist is discovered on the machine instead',
            '            var why = reach.whyNotUsable(wanted, found);\n            if (why) throw new Error(why);',
            ''],

        ['and the machine is asked about before the branch is',
            "        if (!connected(name)) {\n            throw new Error('\"' + name + '\" is not dialled in. Start it and wait for it to connect.');\n        }",
            ''],

        ['a machine that is not dialled in is set up anyway',
            '        if (!connected(name)) {',
            '        if (false) {'],

        ['and a name git will not accept is used',
            '        if (!(await nameIsOk(on))) {',
            '        if (false) {'],

        ['saying no branch at all is taken as a branch called nothing',
            "        if (!wanted) throw new Error('Say which branch \"' + name + '\" is to work on.');",
            ''],

        //---- a machine stays on its branch until it is clean ---------------------

        //SWITCHING IS HOW HALF-FINISHED WORK STOPS BEING ANYWHERE. The commits
        //stay on the machine, on a branch it may no longer push, and nothing
        //says so.
        ['a machine is moved to another branch, leaving its commits behind',
            '        if (!reads && vm.branch && asked && asked !== vm.branch) {',
            '        if (false) {'],

        ['and setting one up again where it already is is refused as a move',
            '        if (!reads && vm.branch && asked && asked !== vm.branch) {',
            '        if (!reads && vm.branch && asked) {'],

        //---- one machine per branch ----------------------------------------------

        //TWO MACHINES PUSH THE SAME REF; the second is refused as a
        //non-fast-forward and its commits strand.
        ['two machines are set up on one branch',
            '            if (held) {',
            '            if (false) {'],

        ['and a machine collides with itself',
            '                return v.name !== name && v.branch === on;',
            '                return v.branch === on;'],

        //---- only the repositories the branch is about -----------------------------

        //EVERY CHECKOUT IS SOMETHING A WORKER CAN READ, CHANGE AND PUSH, so a
        //change concerning two repositories granted four — and the extra two are
        //the ones nobody reviews afterwards.
        ['a machine is handed the whole workspace whatever the work is',
            '        var mine = names.filter(function (n) { return scope.repos.indexOf(n) >= 0; });',
            '        var mine = names;'],

        //---- and what the machine may push ------------------------------------------

        //A BRANCH THE HOOK WOULD ACCEPT A PUSH TO must not carry a notice saying
        //it will refuse one. It did, and the run that found out was thrown away.
        ['a protected branch that may be revised is marked read-only anyway',
            '        return !(await mayRevise(branch));',
            '        return true;'],

        ['and one that may not is left writable',
            '        return !(await mayRevise(branch));',
            '        return false;'],

        //THE `isProtected(on) &&` THAT USED TO BE HERE IS GONE. It duplicated
        //`mayRevise`'s own first check, and a second copy of "is this protected"
        //is precisely how the two answers came to disagree once already. What
        //holds instead is mayRevise's contract, pinned in
        //../../test/repositories/pr-revising.test.js — so breaking it there is
        //what keeps this honest.

        //---- set up to READ, which is not set up to work -------------------------------

        //A JUDGE MAY NOT PUSH ANYWHERE and that is not negotiable.
        ['a reading machine is only read-only when the branch happens to be protected',
            '            readOnly: reads ? true : await readOnlyOn(on),',
            '            readOnly: await readOnlyOn(on),'],

        //BEING SET UP ON A BRANCH is what every other machine's permission to
        //push is MADE of, so recording it hands a judge the right to write to the
        //very thing it is judging.
        ['a reading machine claims the branch it is judging',
            '            claims: reads ? null : on',
            '            claims: on'],

        //THE REASON READING EXISTS: a judge that can only see the repository a
        //change is in cannot say whether another one needed changing too.
        ['a reading machine gets only the repository the change is in',
            "            ? { group: null, repos: names, whole: true, gone: [] }",
            '            ? { group: null, repos: [reads.repo], whole: false, gone: [] }'],

        //THE REST OF THE WORKSPACE AS IT STANDS. Putting every repository on the
        //pull request's branch would be reading a change against itself.
        ['every repository is put on the pull request branch',
            "                perRepo[mine[i]] = mine[i] === reads.repo\n                    ? reads.branch\n                    : ((await defaultOf(mine[i])) || on);",
            '                perRepo[mine[i]] = reads.branch;'],

        //AN ARRIVED PULL REQUEST IS NOT A BRANCH HERE until it is brought here.
        ['a pull request nobody fetched is read anyway',
            '        var at = await headIn(where, what);\n        if (!at) {',
            '        var at = await headIn(where, what);\n        if (false) {'],

        ['and half a reading is half applied',
            '        if (!where || !what) {',
            '        if (false) {']
    ]
};
