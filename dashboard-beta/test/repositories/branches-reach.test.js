const { test } = require('node:test');
const assert = require('node:assert');

const { reachOf, whyNotUsable } = require('../../src/app/repositories/branches/reach');

//---------------------------------------------------------------------------
//WHICH REPOSITORIES A BRANCH IS IN, AND WHICH IT IS MISSING FROM.
//
//THE CLAIM WORTH THE MOST: `missing` is asked of the repositories the branch is
//ABOUT, not of the whole workspace.
//
//A branch cut from a group naming two of three repositories is COMPLETE at two.
//Calling the third missing reads as damage — and is worse than misleading,
//because it is ACTED ON: vmWorkspace refuses to set a machine up on a branch
//with anything missing. A correctly scoped branch would be permanently unusable,
//and the fix on offer would be to extend it into a repository the work has
//nothing to do with.
//
//AND THE SECOND: the union rather than the intersection. Three of four is the
//normal state of a change that touched three; reporting it absent hides the
//work, and reporting it everywhere claims repositories that have nothing on it.
//---------------------------------------------------------------------------

const WHOLE = (over) => Object.assign({
    group: null, repos: ['repo-a', 'repo-b', 'repo-c'], whole: true, gone: []
}, over || {});

const LINE = (over) => Object.assign({
    group: 'the line', repos: ['repo-a', 'repo-b'], whole: false, gone: []
}, over || {});

//---- which repositories it is in --------------------------------------------

test('the union, and each one says what it is missing from', () => {
    const said = reachOf(['repo-a', 'repo-c'], WHOLE());

    assert.deepEqual(said.in, ['repo-a', 'repo-c']);
    assert.deepEqual(said.missing, ['repo-b']);
    assert.deepEqual(said.about, ['repo-a', 'repo-b', 'repo-c']);
});

test('a branch in every repository is missing from none', () => {
    const said = reachOf(['repo-a', 'repo-b', 'repo-c'], WHOLE());
    assert.deepEqual(said.missing, []);
});

//---- and MISSING is about the line, not the workspace --------------------------

test('a branch scoped to two of three is complete at two', () => {
    //THE ONE WITH TEETH. Calling the third missing would make a correctly scoped
    //branch permanently unusable.
    const said = reachOf(['repo-a', 'repo-b'], LINE());

    assert.deepEqual(said.missing, [], 'a repository the line never named was called missing');
    assert.deepEqual(said.about, ['repo-a', 'repo-b']);
    assert.equal(said.group, 'the line');
});

test('and a machine can be set up on it', () => {
    //WHICH IS THE POINT OF THE PARAGRAPH ABOVE: the refusal is real, so the
    //scoping has to be right or it fires on correct branches.
    assert.equal(whyNotUsable('work/x', reachOf(['repo-a', 'repo-b'], LINE())), null);
});

test('a branch that also exists elsewhere does not drag that repository in', () => {
    //SO A NAME REUSED FOR SOMETHING UNRELATED does not become part of this work.
    const said = reachOf(['repo-a', 'repo-b', 'repo-c'], LINE());

    assert.deepEqual(said.in, ['repo-a', 'repo-b']);
    assert.equal(said.in.includes('repo-c'), false);
    assert.deepEqual(said.missing, []);
});

test('but one genuinely missing from its own line is still missing', () => {
    const said = reachOf(['repo-a'], LINE());
    assert.deepEqual(said.missing, ['repo-b']);
});

//---- and gone is a different problem ---------------------------------------------

test('a repository the line named and this workspace no longer has is `gone`', () => {
    //NOTHING CAN EXTEND A BRANCH INTO IT, so offering "cut it there" would be
    //advice that cannot be taken.
    const said = reachOf(['repo-a'], LINE({ repos: ['repo-a'], gone: ['repo-b'] }));

    assert.deepEqual(said.gone, ['repo-b']);
    assert.deepEqual(said.missing, [], 'a repository that is not here was reported as missing');
});

test('and it does not stop a machine being set up', () => {
    //A TASK THAT SPANNED THREE AND CAN NOW REACH TWO is a different task, and
    //that is worth saying — but it is not a reason to refuse the two.
    const reach = reachOf(['repo-a'], LINE({ repos: ['repo-a'], gone: ['repo-b'] }));
    assert.equal(whyNotUsable('work/x', reach), null);
});

//---- and why a machine cannot be set up -------------------------------------------

test('a branch nothing has is refused, and told how to make one properly', () => {
    //WITH A REASON AND A STARTING POINT, both recorded before anything is built
    //on it. Setting a machine up does not create a branch.
    const why = whyNotUsable('work/typo', reachOf([], WHOLE()));

    assert.match(why, /There is no branch called "work\/typo" in repo-a, repo-b, repo-c/);
    assert.match(why, /branchCreate --branch work\/typo --reason "\.\.\." --group "\.\.\."/);
    assert.match(why, /If that name is a typo, this is the refusal that catches it/);
});

test('one missing from some is refused HERE, where the fix is one command', () => {
    //A MACHINE CHECKS IT OUT IN EVERY REPOSITORY IT IS GIVEN, so the one without
    //it fails inside the guest, mid-setup, with git's own words about a
    //pathspec.
    const why = whyNotUsable('work/x', reachOf(['repo-a'], WHOLE()));

    assert.match(why, /"work\/x" is not in repo-b, repo-c, and a machine checks it out in every repository/);
    assert.match(why, /cuts it wherever it is missing and keeps the reason it already has/);
});

test('and a branch about nothing this workspace has says so on its own terms', () => {
    //NOT "there is no branch called x" — there may well be, somewhere that is
    //not here any more. There is nowhere to set a machine up, which is a
    //different sentence.
    const why = whyNotUsable('work/x', reachOf([], LINE({ repos: [], gone: ['repo-a', 'repo-b'] })));

    assert.match(why, /is about nothing this workspace has — there is nowhere to set a machine up/);
});

test('the three refusals are three different sentences', () => {
    //BECAUSE THEY WANT THREE DIFFERENT THINGS DONE: make it, extend it, or look
    //at what happened to the workspace.
    const nowhere = whyNotUsable('x', reachOf([], LINE({ repos: [], gone: ['repo-a'] })));
    const none = whyNotUsable('x', reachOf([], WHOLE()));
    const some = whyNotUsable('x', reachOf(['repo-a'], WHOLE()));

    assert.notEqual(nowhere, none);
    assert.notEqual(none, some);
    assert.notEqual(nowhere, some);
});

//---- and what it does not choke on ---------------------------------------------------

test('nothing carrying it, and no scope at all, are answers rather than throws', () => {
    const said = reachOf(null, null);

    assert.deepEqual(said.in, []);
    assert.deepEqual(said.about, []);
    assert.deepEqual(said.missing, []);
    assert.deepEqual(said.gone, []);
    assert.strictEqual(said.group, null);
});
