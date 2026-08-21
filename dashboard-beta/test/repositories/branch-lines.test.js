const { test } = require('node:test');
const assert = require('node:assert');

const lines = require('../../src/app/repositories/branches/lines');

//---------------------------------------------------------------------------
//what a branch line IS.
//
//NO GIT, NO WORKSPACE, NO DISK, NO PLUGIN GRAPH. Every rule about a line is a
//statement over a record somebody wrote down and a table of where refs are, so
//both arrive here as literals and the whole file runs in milliseconds.
//
//THE SAME CLAIMS USED TO COST FOUR SECONDS EACH. ./lines.test.js built three
//repositories with a bare origin apiece in `beforeEach` — thirty git processes
//per test — to check sentences like "a default branch is protected too, and says
//so as a default". It was twenty-one tests at three to six seconds and it was
//the entire wall time of `npm test`.
//
//WHAT STAYS OVER THERE is what genuinely needs a repository: that where a branch
//is gets worked out rather than stored, and the writes — cutting, deleting,
//catching up. Those are about refs. These are about the concept.
//
//THE STATE NAMES COME FROM ../../src/app/git's `tracked`: same, ahead, behind,
//diverged, different, only here, only on origin.
//---------------------------------------------------------------------------

const THREE = {
    'the-change': {
        why: 'a reason somebody wrote at the time',
        made: '2026-01-01T00:00:00.000Z',
        on: { one: 'work', two: 'work', three: 'work' }
    }
};

//where refs are, per repository — the shape ../../src/app/repositories/refs
//hands over
function at(state, sha) {
    return { local: sha || 'aaa', remote: sha || 'aaa', state: state };
}

const INSTEP = {
    one: { work: at('same') },
    two: { work: at('same') },
    three: { work: at('same') }
};

const HERE = ['one', 'two', 'three'];

test('a line is its parts, with where each one actually is', () => {
    const board = lines.board(THREE, HERE, INSTEP);

    assert.equal(board.length, 1);
    assert.equal(board[0].name, 'the-change');
    assert.equal(board[0].why, 'a reason somebody wrote at the time');
    assert.equal(board[0].on.length, 3);

    const one = board[0].on.filter(p => p.repo === 'one')[0];
    assert.deepEqual(one, {
        repo: 'one', branch: 'work', there: true,
        at: 'aaa', remote: 'aaa', state: 'same', stillHere: true
    });
});

test('a line with every part in step is ok', () => {
    assert.equal(lines.board(THREE, HERE, INSTEP)[0].sync, 'ok');
});

test('one part behind makes the whole line behind, not two-thirds fine', () => {
    const board = lines.board(THREE, HERE, {
        one: { work: at('same') },
        two: { work: at('behind') },
        three: { work: at('same') }
    });

    assert.equal(board[0].sync, 'behind');
    assert.deepEqual(board[0].behind.map(p => p.repo), ['two']);
});

test('one diverged part makes the line a conflict, outranking behind', () => {
    const board = lines.board(THREE, HERE, {
        one: { work: at('behind') },
        two: { work: at('diverged') },
        three: { work: at('same') }
    });

    //THE WORST OF ITS PARTS, NEVER AN AVERAGE. A fast-forward cannot help the
    //diverged one, so the line as a whole needs somebody to decide.
    assert.equal(board[0].sync, 'conflict');
});

test('ahead and different count as out of step too', () => {
    const ahead = lines.board(THREE, HERE, {
        one: { work: at('ahead') }, two: { work: at('same') }, three: { work: at('same') }
    });
    const different = lines.board(THREE, HERE, {
        one: { work: at('different') }, two: { work: at('same') }, three: { work: at('same') }
    });

    assert.equal(ahead[0].sync, 'behind');
    assert.equal(different[0].sync, 'behind');
});

test('a branch deleted out from under a line makes it broken, by name', () => {
    const board = lines.board(THREE, HERE, {
        one: { work: at('same') },
        two: {},
        three: { work: at('same') }
    });

    assert.deepEqual(board[0].broken, ['work is gone from two']);

    const gone = board[0].on.filter(p => p.repo === 'two')[0];
    assert.equal(gone.there, false);
    //NULL, NOT A STALE SHA. A branch that is gone has no honest answer for
    //where it is, and that reads differently from one that has never moved.
    assert.equal(gone.at, null);
    assert.equal(gone.state, null);
});

test('a repository the line does not name is listed as missing, not broken', () => {
    const board = lines.board(THREE, HERE.concat('four'), INSTEP);

    assert.deepEqual(board[0].missing, ['four']);
    //A LINE MADE WHEN THERE WERE THREE REPOSITORIES still describes those three
    //when a fourth arrives. That is not a fault.
    assert.deepEqual(board[0].broken, []);
});

test('a repository that has left the workspace is not counted as broken either', () => {
    const board = lines.board(THREE, ['one', 'two'], {
        one: { work: at('same') }, two: { work: at('same') }, three: {}
    });

    const left = board[0].on.filter(p => p.repo === 'three')[0];
    assert.equal(left.stillHere, false);
    assert.deepEqual(board[0].broken, [],
        'a branch cannot be missing from a repository that is not here');
});

test('lines come back in a stable order rather than however they were written', () => {
    const board = lines.board({
        zeta: { on: { one: 'a' } },
        alpha: { on: { one: 'b' } },
        middle: { on: { one: 'c' } }
    }, ['one'], { one: { a: at('same'), b: at('same'), c: at('same') } });

    assert.deepEqual(board.map(g => g.name), ['alpha', 'middle', 'zeta']);
});

test('no workspace open is not an empty workspace', () => {
    //NULL IN, NULL OUT. An empty list would read as "there are no lines here",
    //which is a different and wrong answer — see ../../src/app/core/state.
    assert.equal(lines.board(null, HERE, INSTEP), null);
    assert.deepEqual(lines.board({}, HERE, INSTEP), []);
});

test('a line proposed for landing carries what was said about it', () => {
    const marked = { at: 'aaa', by: 'somebody', why: 'ready' };
    const board = lines.board({
        'the-change': { on: { one: 'work' }, marked: marked }
    }, ['one'], { one: { work: at('same') } });

    assert.deepEqual(board[0].marked, marked);
    assert.equal(lines.board(THREE, HERE, INSTEP)[0].marked, null);
});

//---- the policy gate -------------------------------------------------------

test('a branch named by a line is protected, and the refusal says which line', () => {
    const board = lines.board(THREE, HERE, INSTEP);
    const guarded = lines.protectedIn(board, [{ repo: 'one', on: 'master' }]);

    assert.deepEqual(guarded['work'].asLine, ['the-change']);
    assert.deepEqual(guarded['work'].asDefault, []);

    const why = lines.whyProtected('work', guarded);
    assert.match(why, /a link in "the-change"/);
    assert.match(why, /Work goes onto its own branch/);
});

test('a default branch is protected too, and says so as a default', () => {
    const guarded = lines.protectedIn([], [
        { repo: 'one', on: 'master' },
        { repo: 'two', on: 'master' },
        { repo: 'three', on: 'main' }
    ]);

    assert.deepEqual(guarded['master'].asDefault, ['one', 'two']);
    assert.deepEqual(guarded['master'].asLine, []);

    assert.match(lines.whyProtected('master', guarded), /the default branch of one, two/);
    assert.match(lines.whyProtected('main', guarded), /the default branch of three/);
});

test('a branch can be protected both ways, and the sentence says both', () => {
    const board = lines.board({ 'the-change': { on: { one: 'master' } } },
        ['one'], { one: { master: at('same') } });
    const guarded = lines.protectedIn(board, [{ repo: 'one', on: 'master' }]);

    const why = lines.whyProtected('master', guarded);
    //BOTH HALVES, because they are undone in different places: one by forgetting
    //a line, the other by the repository itself.
    assert.match(why, /the default branch of one and a link in "the-change"/);
});

test('a branch named by two lines names both, and never twice', () => {
    const board = lines.board({
        'one-line': { on: { one: 'shared', two: 'shared' } },
        'two-line': { on: { one: 'shared' } }
    }, ['one', 'two'], { one: { shared: at('same') }, two: { shared: at('same') } });

    const guarded = lines.protectedIn(board, []);
    assert.deepEqual(guarded['shared'].asLine, ['one-line', 'two-line']);
});

test('a branch nothing names is not protected, and there is no sentence for it', () => {
    const guarded = lines.protectedIn(lines.board(THREE, HERE, INSTEP),
        [{ repo: 'one', on: 'master' }]);

    assert.equal(guarded['fix/something'], undefined);
    //NULL RATHER THAN AN EMPTY SENTENCE, so a caller cannot print a refusal for
    //a branch that was never refused.
    assert.equal(lines.whyProtected('fix/something', guarded), null);
});

test('a repository with no default branch protects nothing by default', () => {
    const guarded = lines.protectedIn([], [{ repo: 'one', on: null }]);
    assert.deepEqual(Object.keys(guarded), []);
});
