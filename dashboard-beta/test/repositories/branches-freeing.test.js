const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makeFreeing = require('../../src/app/repositories/branches/freeing');

//---------------------------------------------------------------------------
//GETTING THE HOST OUT OF THE WAY OF A MACHINE.
//
//THE CLAIM WORTH THE MOST: the default branch is the one recorded on FIRST
//SIGHT, not the one a repository is on now. Reading the current head as the
//default makes every repository sitting somewhere else look like it is already
//home — which is precisely the case this exists for, so the bug would hide the
//only situation the code is written for.
//
//AND THE SECOND: a clean checkout is stepped out of, a dirty one is not. A clean
//tree is holding nothing; an edited one is somebody's work, and moving off it to
//unblock a machine would be this app deciding whose work matters more.
//
//THE REFUSAL ITSELF IS ../../src/app/git's — see its checkout door, which asks
//git whether the tree is clean. This decides WHICH repositories to ask about.
//---------------------------------------------------------------------------

let heads, moves, record, bareOnes, clock;

beforeEach(() => {
    heads = { 'repo-a': 'master', 'repo-b': 'master' };
    moves = [];
    record = {};
    bareOnes = {};
    clock = 0;
});

function freeing(over) {
    return makeFreeing(Object.assign({
        repos: async () => Object.keys(heads).map((name) => ({ name })),
        headOf: async (r) => (r in heads ? heads[r] : null),
        bare: async (r) => !!bareOnes[r],
        checkout: async (r, to) => {
            moves.push({ r, to });
            //THE REAL DOOR REFUSES A DIRTY TREE. Here that is whatever the test
            //set up as `dirty`.
            if (heads[r + ':dirty']) {
                return { moved: false, clean: false, why: r + ' has uncommitted changes' };
            }
            heads[r] = to;
            return { moved: true, clean: true, from: r, to: to };
        },
        kept: {
            read: async (fallback) => (Object.keys(record).length ? record : fallback),
            write: async (all) => { record = all; return all; }
        },
        now: () => '2026-08-2' + (clock++) + 'T00:00:00Z'
    }, over || {}));
}

//---- where a repository belongs -----------------------------------------------

test('the default is whatever it was on the first time this app looked', () => {
    return freeing().defaultOf('repo-a').then((home) => {
        assert.equal(home, 'master');
        assert.equal(record['repo-a'].default, 'master');
        assert.ok(record['repo-a'].notedAt);
    });
});

test('and it does not move when the repository does', async () => {
    //THE WHOLE POINT. A repository sitting somewhere else is the case this
    //exists for, and reading its current head as its default would make it look
    //like it was already home.
    const f = freeing();
    await f.defaultOf('repo-a');

    heads['repo-a'] = 'somebody/review';
    assert.equal(await f.defaultOf('repo-a'), 'master');
});

test('a repository nothing can be read from has no default, and none is recorded', () => {
    //A GUESS WRITTEN DOWN IS WORSE THAN NO ANSWER: it would be believed for ever
    //afterwards.
    return freeing().defaultOf('no-such-repo').then((home) => {
        assert.equal(home, null);
        assert.deepEqual(record, {});
    });
});

test('and what is already recorded is never asked again', async () => {
    let asked = 0;
    const f = freeing({ headOf: async (r) => { asked++; return heads[r]; } });

    await f.defaultOf('repo-a');
    await f.defaultOf('repo-a');
    await f.defaultOf('repo-a');

    assert.equal(asked, 1);
});

//---- and whether a repository is in the way -------------------------------------

test('one sitting on the branch a machine wants is stepped off it', () => {
    heads['repo-a'] = 'work/the-thing';
    record['repo-a'] = { default: 'master' };

    return freeing().freeIfBusy('repo-a', 'work/the-thing').then((said) => {
        assert.deepEqual(said, { repo: 'repo-a', freed: true, busy: false, from: 'work/the-thing', to: 'master' });
        assert.deepEqual(moves, [{ r: 'repo-a', to: 'master' }]);
    });
});

test('one that is not on it is left entirely alone', async () => {
    const said = await freeing().freeIfBusy('repo-a', 'work/the-thing');

    assert.deepEqual(said, { repo: 'repo-a', freed: false, busy: false });
    assert.deepEqual(moves, [], 'it moved a repository that was not in the way');
});

test('a DIRTY one is reported rather than moved, and says what is in the way', async () => {
    //MOVING OFF IT would be this app deciding whose work matters more.
    heads['repo-a'] = 'work/the-thing';
    heads['repo-a:dirty'] = true;
    record['repo-a'] = { default: 'master' };

    const said = await freeing().freeIfBusy('repo-a', 'work/the-thing');

    assert.equal(said.freed, false);
    assert.equal(said.busy, true);
    assert.match(said.why, /repo-a has uncommitted changes/);
    assert.equal(heads['repo-a'], 'work/the-thing', 'it moved a tree it had just called busy');
});

test('and a git refusal is busy too, because both are somebody to look at', async () => {
    //ANYTHING THAT DID NOT MOVE is either dirty or a git refusal, and neither is
    //this app's to work around.
    heads['repo-a'] = 'work/the-thing';
    record['repo-a'] = { default: 'master' };

    const said = await freeing({
        checkout: async () => ({ moved: false, clean: true, why: 'git would not say why' })
    }).freeIfBusy('repo-a', 'work/the-thing');

    assert.equal(said.busy, true);
    assert.equal(said.why, 'git would not say why');
});

test('a bare repository is skipped, because nothing is checked out in it', async () => {
    //NO WORKING TREE, nothing checked out in the sense that matters, and git
    //accepts the push regardless.
    //
    //SET UP SO THE SKIP IS THE ONLY REASON. It needs a recorded default that
    //DIFFERS from the branch — otherwise the `home === branch` check further
    //down answers the same way and the bare guard could be deleted with nothing
    //noticing. A sweep found exactly that.
    heads['repo-a'] = 'work/the-thing';
    record['repo-a'] = { default: 'master' };
    bareOnes['repo-a'] = true;

    const said = await freeing().freeIfBusy('repo-a', 'work/the-thing');

    assert.deepEqual(said, { repo: 'repo-a', freed: false, busy: false });
    assert.deepEqual(moves, [], 'it asked a repository with no working tree to check something out');
});

test('and one sitting on its OWN default is not in the way of anything', async () => {
    //IT IS AT HOME. There is nowhere to send it, and the machine works around it
    //rather than the other way about.
    heads['repo-a'] = 'master';
    record['repo-a'] = { default: 'master' };

    const said = await freeing().freeIfBusy('repo-a', 'master');

    assert.deepEqual(said, { repo: 'repo-a', freed: false, busy: false });
    assert.deepEqual(moves, []);
});

test('nor is one nothing can be read from at all', async () => {
    //A REPOSITORY THAT WILL NOT SAY WHERE ITS HEAD IS is not on this branch as
    //far as anything here can tell, and nothing is attempted on a guess.
    const said = await freeing({ headOf: async () => null }).freeIfBusy('repo-a', 'work/the-thing');

    assert.equal(said.freed, false);
    assert.equal(said.busy, false);
    assert.deepEqual(moves, []);
});

//---- and every repository at once ------------------------------------------------

test('only the ones that moved or are in the way come back', async () => {
    //A REPOSITORY THAT WAS NEVER ON THIS BRANCH IS NOT NEWS, and a caller
    //looping over "nothing happened" is one that has to work out what did.
    heads = { 'repo-a': 'work/x', 'repo-b': 'master', 'repo-c': 'work/x' };
    heads['repo-c:dirty'] = true;
    record = { 'repo-a': { default: 'master' }, 'repo-c': { default: 'main' } };

    const said = await freeing().freeEverywhere('work/x');

    assert.equal(said.length, 2);
    assert.deepEqual(said.filter((r) => r.freed).map((r) => r.repo), ['repo-a']);
    assert.deepEqual(said.filter((r) => r.busy).map((r) => r.repo), ['repo-c']);
});

test('a workspace where nothing is in the way answers with nothing', async () => {
    assert.deepEqual(await freeing().freeEverywhere('work/nobody-is-on-this'), []);
});

test('and it asks every repository, not only until the first that moved', async () => {
    heads = { 'repo-a': 'work/x', 'repo-b': 'work/x' };
    record = { 'repo-a': { default: 'master' }, 'repo-b': { default: 'master' } };

    const said = await freeing().freeEverywhere('work/x');

    assert.deepEqual(said.map((r) => r.repo), ['repo-a', 'repo-b']);
    assert.equal(moves.length, 2);
});

test('one in the way does not stop the rest being freed', async () => {
    //THE DIRTY ONE IS A SENTENCE FOR SOMEBODY, not a reason to leave the other
    //repositories blocking a machine as well.
    heads = { 'repo-a': 'work/x', 'repo-b': 'work/x' };
    heads['repo-a:dirty'] = true;
    record = { 'repo-a': { default: 'master' }, 'repo-b': { default: 'master' } };

    const said = await freeing().freeEverywhere('work/x');

    assert.equal(said.filter((r) => r.busy).length, 1);
    assert.equal(said.filter((r) => r.freed).length, 1);
    assert.equal(heads['repo-b'], 'master');
});

test('and a workspace that could not be listed is not an error', async () => {
    assert.deepEqual(await freeing({ repos: async () => null }).freeEverywhere('work/x'), []);
});
