//what ../../test/repositories/pr-revising.test.js has to be able to catch.
//
//THIS IS A PERMISSION. Every break below either grants a push that should be
//refused, or refuses one that should be granted — and the second is not the safe
//direction: the exception this file exists for was dead code once already,
//because the rule allowed a push and the sign refused it.
module.exports = {
    file: 'src/app/repositories/pr/revising.js',
    test: 'test/repositories/pr-revising.test.js',
    breaks: [
        //---- what counts as still out -------------------------------------------

        //ONCE IT LANDS the branch is history again and the ordinary rule
        //applies. A merged cut granting a permission for ever is the failure the
        //record-learning half of the app was built to prevent.
        ['a merged pull request goes on granting the permission',
            '            if (p.merged === true) continue;',
            ''],

        //AND ONLY `=== true` COUNTS. A record that could not be read says nothing
        //about whether it merged, and reading that as merged withdraws a
        //permission on a failure to ask.
        ['anything truthy counts as merged, so a failed read withdraws a permission',
            '            if (p.merged === true) continue;',
            '            if (p.merged) continue;'],

        //THE PART AFTER THE COLON IS THE BRANCH.
        ['the whole head is compared, so a fork owner makes the branch not match',
            "            var named = head.indexOf(':') >= 0 ? head.slice(head.indexOf(':') + 1) : head;",
            '            var named = head;'],

        ['and the owner is compared instead of the branch',
            "            var named = head.indexOf(':') >= 0 ? head.slice(head.indexOf(':') + 1) : head;",
            "            var named = head.indexOf(':') >= 0 ? head.slice(0, head.indexOf(':')) : head;"],

        //NOT SWEPT: the `named &&` half of `if (named && named === branch)`.
        //
        //IT IS UNREACHABLE, and that is worth knowing rather than deleting. The
        //only way an empty `named` could match is an empty `branch`, and the
        //`if (!branch) return false` at the top has already returned by then —
        //so removing it changes no answer and a sweep reports it SURVIVED.
        //
        //LEFT AS THE APP BEING PORTED FROM HAS IT. It is a guard behind a guard,
        //and the cost of keeping it is nothing; the cost of removing it is that
        //whoever later moves the early return has no second line holding.

        //IT LOOKS ACROSS EVERY CUT. Stopping at the first is a permission that
        //depends on the order of a record.
        ['only the first cut is looked at',
            '    for (var i = 0; i < names.length; i++) {',
            '    for (var i = 0; i < Math.min(1, names.length); i++) {'],

        //---- and the whole permission -------------------------------------------

        //A REPOSITORY'S DEFAULT IS PROTECTED FOR WHAT IT IS. No pull request
        //makes it a link in a line.
        ['a default branch can be pushed to by opening a pull request from it',
            '    if ((p.asDefault || []).length) return false;',
            ''],

        //AND THE STRICTER REASON STANDS when a branch is protected both ways.
        ['being a line softens being a default',
            '    if ((p.asDefault || []).length) return false;',
            '    if ((p.asDefault || []).length && !(p.asLine || []).length) return false;'],

        //A BRANCH NOTHING PROTECTS is pushable by the ordinary rule.
        ['a branch nothing protects is refused',
            '    if (!p) return true;',
            '    if (!p) return false;'],

        //AND A HOST THAT COULD NOT READ ITS LINES must not silently start
        //refusing pushes it would have allowed.
        ['a host that could not read its lines refuses everything',
            '    var p = (protectedRows || {})[branch];',
            '    var p = protectedRows ? protectedRows[branch] : { branch: branch, asDefault: [branch] };'],

        //---- and the exception itself ---------------------------------------------

        //THE ONE THAT WAS DEAD CODE ONCE. The rule allowed the push and the sign
        //refused it, so the exception never applied to the case it was written
        //for.
        ['the exception does nothing, so a line under revision is still refused',
            '    return underRevision(branch, cuts);',
            '    return false;'],

        ['or it applies to everything, so any protected branch is pushable',
            '    return underRevision(branch, cuts);',
            '    return true;'],

        ['and no branch at all is granted',
            '    if (!branch) return false;\n\n    var p = (protectedRows || {})[branch];',
            '    var p = (protectedRows || {})[branch];']
    ]
};
