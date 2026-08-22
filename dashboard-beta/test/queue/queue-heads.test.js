const { test } = require('node:test');
const assert = require('node:assert');

const makeHeads = require('../../src/app/queue/heads');

//---------------------------------------------------------------------------
//WHERE A BRANCH STANDS, IN EVERY REPOSITORY THAT HAS IT.
//
//THE CLAIM WORTH THE MOST: a repository without the branch is `null`, not
//absent. ../../src/app/queue/onetask compares the two reads key by key, so a
//repository that answers with a missing key on one side and a value on the other
//reads as having moved — which is the "and nothing new arrived" sentence
//inverted, about a repository nothing touched.
//
//AND THE SECOND: every repository, not the first one found. A true number about
//the wrong repository reads as a fact and is worse than no number.
//---------------------------------------------------------------------------

const heads = (all) => makeHeads({ all: async () => all });

test('the branch, in every repository that has it', async () => {
    const said = await heads({
        'repo-a': { main: 'aaa', 'a-branch': 'bbb' },
        'repo-b': { main: 'ccc', 'a-branch': 'ddd' }
    }).on('a-branch');

    assert.deepEqual(said, { 'repo-a': 'bbb', 'repo-b': 'ddd' });
});

test('and one that does not have it is null, not missing', async () => {
    //A MISSING KEY ON ONE SIDE AND A VALUE ON THE OTHER reads as having moved.
    const said = await heads({
        'repo-a': { 'a-branch': 'bbb' },
        'repo-b': { main: 'ccc' }
    }).on('a-branch');

    assert.deepEqual(Object.keys(said).sort(), ['repo-a', 'repo-b']);
    assert.strictEqual(said['repo-b'], null);
});

test('so two reads of an untouched host compare equal', async () => {
    //THE WHOLE REASON THE SHAPE MATTERS. This is exactly what onetask does with
    //the two answers.
    const world = { 'repo-a': { 'a-branch': 'bbb' }, 'repo-b': { main: 'ccc' } };

    const before = await heads(world).on('a-branch');
    const after = await heads(world).on('a-branch');

    const moved = Object.keys(after).filter((r) => after[r] && after[r] !== before[r]);
    assert.deepEqual(moved, [], 'a repository nothing touched read as having moved');
});

test('and one that DID move is the only one named', async () => {
    const before = await heads({
        'repo-a': { 'a-branch': 'bbb' }, 'repo-b': { 'a-branch': 'ccc' }
    }).on('a-branch');

    const after = await heads({
        'repo-a': { 'a-branch': 'bbb' }, 'repo-b': { 'a-branch': 'ddd' }
    }).on('a-branch');

    const moved = Object.keys(after).filter((r) => after[r] && after[r] !== before[r]);
    assert.deepEqual(moved, ['repo-b']);
});

test('a branch that arrives where there was none counts as movement', async () => {
    //THE ORDINARY SHAPE OF A TASK THAT DELIVERED: the worker cut the branch and
    //pushed it, so before is null and after is a commit.
    const before = await heads({ 'repo-a': { main: 'aaa' } }).on('a-branch');
    const after = await heads({ 'repo-a': { main: 'aaa', 'a-branch': 'bbb' } }).on('a-branch');

    const moved = Object.keys(after).filter((r) => after[r] && after[r] !== before[r]);
    assert.deepEqual(moved, ['repo-a']);
});

//---- and what it will not choke on ----------------------------------------

test('no branch to ask about is an empty answer, not every branch', async () => {
    assert.deepEqual(await heads({ 'repo-a': { main: 'aaa' } }).on(null), {});
    assert.deepEqual(await heads({ 'repo-a': { main: 'aaa' } }).on(''), {});
});

test('a repository with no refs yet answers null rather than breaking the read', async () => {
    const said = await heads({ 'repo-a': null, 'repo-b': {} }).on('a-branch');
    assert.deepEqual(said, { 'repo-a': null, 'repo-b': null });
});

test('a workspace that could not be read is empty, and is not fatal', async () => {
    //THIS IS READ ON THE PATH THAT FINISHES A TASK. A repository list that could
    //not be fetched must not lose the run — the report degrades to "nothing new
    //arrived", which is the cautious direction.
    const said = await makeHeads({ all: async () => { throw new Error('the workspace is gone'); } })
        .on('a-branch');

    assert.deepEqual(said, {});
});

test('and no repositories at all is empty', async () => {
    assert.deepEqual(await heads({}).on('a-branch'), {});
    assert.deepEqual(await heads(null).on('a-branch'), {});
});
