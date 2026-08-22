const { test } = require('node:test');
const assert = require('node:assert');

const { underRevision, mayRevise } = require('../../src/app/repositories/pr/revising');

//---------------------------------------------------------------------------
//WHETHER A WORKER MAY PUSH TO A PROTECTED BRANCH.
//
//THE CLAIM WORTH THE MOST: this is asked in TWO places and written in one. The
//host's pre-receive hook is the rule; the pre-push hook in the guest's checkout
//is the sign that says the same thing where a worker meets it first.
//
//THEY ARE NOT ALLOWED TO BE TWO OPINIONS. The first version of this exception
//went into the host's hook alone, and the sign went on refusing — so the push
//was granted by the rule and stopped by the notice, which made the exception
//DEAD CODE for the exact case it was written for. A run was lost finding that
//out, after another run had been lost finding the first gate.
//
//AND IT IS PURE, which is what lets a drill ask about a merged cut and an open
//one without either existing on this host. A rule that can only be checked
//against whatever the machine happens to be holding is one that gets checked
//once.
//---------------------------------------------------------------------------

const CUT = (pulls) => ({ 'a-cut': { pulls } });

const PROTECTED = (over) => Object.assign({
    'line-a': { branch: 'line-a', asDefault: [], asLine: ['the line'] },
    main: { branch: 'main', asDefault: ['repo-a', 'repo-b'], asLine: [] }
}, over || {});

//---- is the branch the source of a pull request still out --------------------

test('a branch a pull request was opened from is under revision', () => {
    assert.equal(underRevision('work/the-thing', CUT([
        { number: 3, head: 'someone:work/the-thing' }
    ])), true);
});

test('and the head is read as owner:branch, which is what GitHub calls it', () => {
    //THE PART AFTER THE COLON IS THE BRANCH.
    assert.equal(underRevision('work/x', CUT([{ head: 'a-fork-owner:work/x' }])), true);
    assert.equal(underRevision('a-fork-owner', CUT([{ head: 'a-fork-owner:work/x' }])), false,
        'it matched the owner rather than the branch');
});

test('a head with no colon is already just a name', () => {
    assert.equal(underRevision('work/x', CUT([{ head: 'work/x' }])), true);
});

test('one that has MERGED is not, because the branch is history again', () => {
    //ONCE IT LANDS the ordinary rule applies.
    assert.equal(underRevision('work/x', CUT([{ head: 'o:work/x', merged: true }])), false);
});

test('and only `merged === true` counts as merged', () => {
    //A RECORD THAT COULD NOT BE READ says nothing about whether it merged, and
    //reading that as merged would withdraw a permission on a failure to ask.
    assert.equal(underRevision('work/x', CUT([{ head: 'o:work/x', merged: false }])), true);
    assert.equal(underRevision('work/x', CUT([{ head: 'o:work/x', merged: null }])), true);
    assert.equal(underRevision('work/x', CUT([{ head: 'o:work/x' }])), true);
    assert.equal(underRevision('work/x', CUT([{ head: 'o:work/x', merged: 'yes' }])), true,
        'a string was read as merged');
});

test('it looks across every cut, not only the first', () => {
    const cuts = {
        one: { pulls: [{ head: 'o:something-else' }] },
        two: { pulls: [{ head: 'o:work/x' }] }
    };
    assert.equal(underRevision('work/x', cuts), true);
});

test('and a cut with no pull requests, or none at all, is not one', () => {
    assert.equal(underRevision('work/x', { one: {} }), false);
    assert.equal(underRevision('work/x', { one: { pulls: [] } }), false);
    assert.equal(underRevision('work/x', {}), false);
    assert.equal(underRevision('work/x', null), false);
});

test('and no branch is never under revision', () => {
    assert.equal(underRevision(null, CUT([{ head: 'o:work/x' }])), false);
    assert.equal(underRevision('', CUT([{ head: 'o:' }])), false);
});

test('a pull request with an empty head does not match an empty branch', () => {
    //`named && named === branch` — without the first half, a record with no head
    //would grant a permission to anything asking about nothing.
    assert.equal(underRevision('', CUT([{ head: '' }])), false);
    assert.equal(underRevision('', CUT([{ head: 'owner:' }])), false);
});

//---- and the whole permission ------------------------------------------------

test('a branch nothing protects is pushable, and never reaches the exception', () => {
    assert.equal(mayRevise('work/ordinary', {}, PROTECTED()), true);
});

test('a repository default is protected for what it IS, and no pull request changes that', () => {
    //IT IS NOT A LINK IN A LINE, so there is no revision to be under.
    assert.equal(mayRevise('main', CUT([{ head: 'o:main' }]), PROTECTED()), false);
});

test('and one protected only as a link in a line qualifies while its cut is out', () => {
    assert.equal(mayRevise('line-a', CUT([{ head: 'o:line-a' }]), PROTECTED()), true);
});

test('but not once that cut has merged', () => {
    assert.equal(mayRevise('line-a', CUT([{ head: 'o:line-a', merged: true }]), PROTECTED()), false);
});

test('nor when it is a line with no pull request out at all', () => {
    assert.equal(mayRevise('line-a', {}, PROTECTED()), false);
});

test('a branch protected BOTH ways is refused, because the stricter reason stands', () => {
    //PROTECTED AS A DEFAULT is not softened by also being a line. A default
    //branch is protected for what it is.
    const both = PROTECTED({
        'line-a': { branch: 'line-a', asDefault: ['repo-a'], asLine: ['the line'] }
    });
    assert.equal(mayRevise('line-a', CUT([{ head: 'o:line-a' }]), both), false);
});

test('and no branch may never revise', () => {
    assert.equal(mayRevise(null, {}, PROTECTED()), false);
    assert.equal(mayRevise('', {}, PROTECTED()), false);
});

test('nothing known about what is protected means nothing is', () => {
    //A HOST THAT COULD NOT READ ITS LINES must not silently start refusing
    //pushes it would have allowed — that is a permission changing because a read
    //failed, which is the shape this whole file is arranged against.
    assert.equal(mayRevise('line-a', {}, null), true);
    assert.equal(mayRevise('line-a', {}, {}), true);
});

//---- and the two callers ask the same question ---------------------------------

test('the sign and the rule cannot disagree, because there is one function', () => {
    //THE FAILURE THIS EXISTS FOR: the exception went into the host's hook alone
    //and the sign went on refusing, so the push was granted by the rule and
    //stopped by the notice.
    const cuts = CUT([{ head: 'o:line-a' }]);
    const rows = PROTECTED();

    //WHAT THE HOST'S HOOK WOULD ALLOW...
    const rule = mayRevise('line-a', cuts, rows);
    //...AND WHAT THE SIGN IN THE CHECKOUT WOULD SAY. vmWorkspace asks
    //`isProtected(branch) && !mayRevise(branch)` for readOnly, so a branch the
    //rule accepts must not carry a notice saying it will be refused.
    const readOnly = !!rows['line-a'] && !mayRevise('line-a', cuts, rows);

    assert.equal(rule, true);
    assert.equal(readOnly, false, 'the checkout would refuse a push the host would accept');
});
