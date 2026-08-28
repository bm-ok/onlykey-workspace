const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const child = require('node:child_process');

const actionsPlugin = require('../../src/app/core/actions/main');
const statePlugin = require('../../src/app/core/state/main');
const gitPlugin = require('../../src/app/git/server');
const linesPlugin = require('../../src/app/repositories/branches/server');
const { refsFor } = require('../../tools/test-parts');

//---------------------------------------------------------------------------
//a line: one branch per repository, named, so it can be talked about as one
//thing.
//
//THE CLAIM THIS FILE IS FOR: a line's state is the WORST of its parts and never
//an average. "Two of three are in step" is the one answer a line must not give,
//because the entire point of naming one is that the three move together — and
//one part being behind is not visible from any single repository.
//
//THREE REAL REPOSITORIES against a local bare origin, so a part can genuinely be
//behind, ahead or diverged without a network.
//---------------------------------------------------------------------------

let work;

const git = (args, cwd) => child.execFileSync('git', [
    '-c', 'user.email=drill@example.invalid',
    '-c', 'user.name=drill',
    '-c', 'commit.gpgsign=false'
].concat(args), { cwd: cwd, stdio: 'pipe' }).toString();

//a repository with an origin on this disk, one commit, and a branch `work`
function aRepo(name) {
    const bare = path.join(work, name + '.git');
    fs.mkdirSync(bare);
    git(['init', '-q', '--bare', '-b', 'master'], bare);

    const at = path.join(work, name);
    fs.mkdirSync(at);
    git(['init', '-q', '-b', 'master'], at);
    //A RELATIVE REMOTE, so the whole workspace can be COPIED rather than rebuilt.
    //An absolute path here would leave every copy pushing into the template's
    //bare repository, which is the cross-test contamination the fresh workspace
    //exists to prevent. Relative, each copy pushes to its own.
    git(['remote', 'add', 'origin', '../' + name + '.git'], at);
    fs.writeFileSync(path.join(at, 'readme.md'), 'one\n');
    git(['add', '.'], at);
    git(['commit', '-q', '-m', 'first'], at);
    git(['push', '-q', 'origin', 'master'], at);

    git(['checkout', '-q', '-b', 'work'], at);
    git(['push', '-q', 'origin', 'work'], at);
    //BACK ONTO master, because the default branch is "whatever was checked out
    //when this first looked" — leaving `work` out made it the default AND a link
    //in the line, so the protection test could not tell the two apart.
    git(['checkout', '-q', 'master'], at);
    git(['fetch', '-q', 'origin'], at);
    return at;
}

//A FRESH WORKSPACE PER TEST, because half of these WRITE. Sharing one made the
//order of the file part of what it asserts: a branch cut in one test was still
//there in the next, and a ref moved by a sync changed what a later read saw.
//Three repositories cost about half a second to build; a test that depends on
//the one before it costs an afternoon the first time it fails.
let holder, template;

//BUILT ONCE AND COPIED, NOT REBUILT THIRTY TIMES.
//
//`aRepo` is ten git processes and there are three of them, so rebuilding per
//test was thirty processes before a single assertion — three to six seconds
//each, twenty-one times, which was the whole wall time of `npm test`.
//
//THE GUARANTEE IS UNCHANGED, and it is the one that matters: every test still
//gets a workspace nothing else has touched. What changed is how it is made.
//A directory copy is one bulk filesystem operation; the remotes are relative,
//so each copy talks to its own bare repositories and never the template's.
before(() => {
    holder = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-lines-'));
    template = path.join(holder, 'template');
    fs.mkdirSync(template);

    work = template;
    aRepo('one');
    aRepo('two');
    aRepo('three');
});

beforeEach(() => {
    work = fs.mkdtempSync(path.join(holder, 'w-'));
    fs.cpSync(template, work, { recursive: true });
});

after(() => {
    try { fs.rmSync(holder, { recursive: true, force: true }); } catch { /* windows may hold a handle */ }
});

async function anApp(stored) {
    let actions = null;
    await actionsPlugin({}, async (_e, s) => { actions = s.actions; });

    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-lines-data-'));
    let state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dataDir, ...p) } }, async (_e, s) => { state = s.state; });

    let where = work;
    state.follow(async () => where);
    if (stored) (await state.here.doc('lines')).write(stored);

    const said = [];
    const logger = { good: (t) => said.push(t), warn: (t) => said.push(t), bad: () => {}, info: () => {} };
    const workspace = {
        dir: async () => where,
        folderOf: async (name) => {
            const at = path.join(where, name);
            if (!fs.existsSync(path.join(at, '.git'))) throw new Error('there is no repository called "' + name + '"');
            return at;
        },
        repos: async () => (where ? fs.readdirSync(where)
            .filter((n) => !n.endsWith('.git') && fs.existsSync(path.join(where, n, '.git')))
            .map((n) => ({ name: n })) : [])
    };

    let git_ = null;
    await gitPlugin({ app: { host: {} }, log: { on: () => logger }, workspace }, async (_e, s) => { git_ = s.git; });

    //THE REAL ../../src/app/repositories/refs. The pane reads refs now, so a
    //stand-in here would check the stand-in.
    const { refs, stop } = await refsFor({ git: git_, workspace, log: { on: () => logger } });

    let lines = null;
    await linesPlugin({
        app: { host: { actions } }, log: { on: () => logger },
        git: git_, workspace, state, refs
    }, async (_e, s) => { lines = s.lines; });

    return { actions, lines, said, state, refs, stop, go: (to) => { where = to; } };
}

//where a branch is, in a named repository
const at = (repo, ref) => git(['rev-parse', ref], path.join(work, repo)).trim();

const THREE = {
    'the-change': {
        why: 'one change across three repositories',
        made: '2026-08-01T00:00:00.000Z',
        on: { one: 'work', two: 'work', three: 'work' }
    }
};

//---------------------------------------------------------------------------
//THE RULE.
//---------------------------------------------------------------------------

test('a line with every part in step is ok', async () => {
    const { actions } = await anApp(THREE);
    const g = (await actions.call('lines', {})).lines[0];

    assert.equal(g.name, 'the-change');
    assert.equal(g.on.length, 3);
    assert.equal(g.sync, 'ok');
    assert.deepEqual(g.behind, []);
    assert.deepEqual(g.broken, []);
});

//ONE PART BEHIND IS THE WHOLE LINE BEHIND. This is not visible from any single
//repository, and averaging it is the answer a line must never give.
test('one part behind makes the whole line behind, not two-thirds fine', async () => {
    const { actions } = await anApp(THREE);

    //move origin's copy of `work` in ONE repository only
    const two = path.join(work, 'two');
    const other = path.join(work, 'two-elsewhere');
    git(['clone', '-q', path.join(work, 'two.git'), other], work);
    git(['checkout', '-q', 'work'], other);
    fs.writeFileSync(path.join(other, 'more.txt'), 'moved on\n');
    git(['add', '.'], other);
    git(['commit', '-q', '-m', 'origin moved'], other);
    git(['push', '-q', 'origin', 'work'], other);
    git(['fetch', '-q', 'origin'], two);

    const g = (await actions.call('lines', {})).lines[0];
    assert.equal(g.sync, 'behind', 'a line with a part behind did not read as behind');
    assert.deepEqual(g.behind.map((p) => p.repo), ['two'], 'it did not name which part');
    assert.equal(g.on.filter((p) => p.state === 'same').length, 2, 'the other two are not in step');

    fs.rmSync(other, { recursive: true, force: true });
});

//A PART THAT MOVED ON BOTH SIDES IS A CONFLICT, and a fast-forward cannot help.
//That has to beat `behind` rather than being averaged with it.
test('one diverged part makes the line a conflict, outranking behind', async () => {
    const { actions } = await anApp(THREE);

    const three = path.join(work, 'three');
    const other = path.join(work, 'three-elsewhere');
    git(['clone', '-q', path.join(work, 'three.git'), other], work);
    git(['checkout', '-q', 'work'], other);
    fs.writeFileSync(path.join(other, 'theirs.txt'), 'them\n');
    git(['add', '.'], other);
    git(['commit', '-q', '-m', 'theirs'], other);
    git(['push', '-q', 'origin', 'work'], other);

    //AND THIS SIDE MOVES TOO — on `work`, which is not what is checked out.
    //Committing without saying which branch put it on master and the line did
    //not diverge at all, so this read as `behind` and the test was measuring
    //nothing.
    const tree = git(['rev-parse', 'work^{tree}'], three).trim();
    const mine = git(['commit-tree', tree, '-p', 'work', '-m', 'ours'], three).trim();
    git(['update-ref', 'refs/heads/work', mine], three);
    git(['fetch', '-q', 'origin'], three);

    const g = (await actions.call('lines', {})).lines[0];
    assert.equal(g.sync, 'conflict', 'a diverged part did not outrank the rest');
    assert.ok(g.behind.some((p) => p.repo === 'three'));

    fs.rmSync(other, { recursive: true, force: true });
});

//---------------------------------------------------------------------------
//WHAT IS STORED AND WHAT IS WORKED OUT.
//---------------------------------------------------------------------------

test('where each branch actually is is worked out, not stored', async () => {
    const { actions, state } = await anApp(THREE);
    const g = (await actions.call('lines', {})).lines[0];

    for (const p of g.on) {
        assert.match(p.at, /^[0-9a-f]{7,}$/, p.repo + ' has no commit recorded');
        assert.equal(p.there, true);
        assert.equal(p.stillHere, true);
    }

    //NOTHING ABOUT A REPOSITORY IS IN THE DOCUMENT. Storing a sha would be
    //storing a claim that changes underneath it.
    const raw = (await state.here.doc('lines')).read({});
    assert.deepEqual(Object.keys(raw['the-change']).sort(), ['made', 'on', 'why']);
    assert.deepEqual(raw['the-change'].on, { one: 'work', two: 'work', three: 'work' });
});

//A BRANCH THAT IS GONE IS THE ONE CASE WITH NO HONEST ANSWER, and it reads
//differently from a branch that is there and has never moved.
test('a branch deleted out from under a line makes it broken, by name', async () => {
    const { actions } = await anApp(THREE);
    const one = path.join(work, 'one');
    git(['checkout', '-q', 'master'], one);
    git(['branch', '-D', 'work'], one);
    git(['push', '-q', 'origin', '--delete', 'work'], one);
    git(['fetch', '-q', '--prune', 'origin'], one);

    const g = (await actions.call('lines', {})).lines[0];
    assert.deepEqual(g.broken, ['work is gone from one'], 'a missing branch was not reported by name');
    assert.equal(g.on.find((p) => p.repo === 'one').there, false);
    assert.equal(g.on.find((p) => p.repo === 'one').at, null, 'a gone branch was given a commit');

    //put it back for whatever runs next
    git(['checkout', '-q', '-b', 'work'], one);
    git(['push', '-q', 'origin', 'work'], one);
    git(['fetch', '-q', 'origin'], one);
});

//MISSING REPOSITORIES ARE NOT A FAULT: a line made when there were three still
//describes those three when a fourth arrives.
test('a repository the line does not name is listed as missing, not broken', async () => {
    const { actions } = await anApp({
        'partial': { why: null, made: null, on: { one: 'work' } }
    });

    const g = (await actions.call('lines', {})).lines[0];
    assert.deepEqual(g.missing.sort(), ['three', 'two']);
    assert.deepEqual(g.broken, [], 'a repository that was never named read as broken');
});

//---------------------------------------------------------------------------
//WITHDRAWING A PROPOSAL.
//---------------------------------------------------------------------------

test('withdrawing clears the proposal and says the branches stay protected', async () => {
    const { actions, said } = await anApp({
        'the-change': {
            on: { one: 'work' },
            marked: { at: '2026-08-01T00:00:00.000Z', by: 'the window', why: 'ready' }
        }
    });

    assert.ok((await actions.call('lines', {})).lines[0].marked, 'the fixture is not proposed, so this proves nothing');

    const said2 = await actions.call('lineWithdraw', { name: 'the-change' });
    assert.equal(said2.marked, null);
    //THE SENTENCE IS THE POINT: withdrawing a proposal is not un-protecting the
    //work, and somebody who wanted the second thing must be told they have not
    //got it.
    assert.match(said2.note, /stay protected/);
    assert.match(said2.note, /forget the line/);

    assert.equal((await actions.call('lines', {})).lines[0].marked, null);
    assert.ok(said.some((l) => /no longer proposed/.test(l)), 'nothing was recorded');
});

test('withdrawing a line that is not there is refused, and says what is', async () => {
    const { actions } = await anApp(THREE);
    await assert.rejects(() => actions.call('lineWithdraw', { name: 'nope' }), /no line called "nope"/);
    await assert.rejects(() => actions.call('lineWithdraw', { name: 'nope' }), /the-change/);
    await assert.rejects(() => actions.call('lineWithdraw', {}), /Say which line/);
});

//---------------------------------------------------------------------------
//AND IT IS READ SEVERAL TIMES PER DRAW.
//
//The app being ported from asked git for a repository's branches inside the
//per-part loop: three lines across three repositories was nine processes for
//three answers, and a trace found 39% of the window's samples inside `spawn`
//with the window idle.
//---------------------------------------------------------------------------
test('each repository is asked once, however many lines name it', async () => {
    let actions = null;
    await actionsPlugin({}, async (_e, s) => { actions = s.actions; });

    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-lines-count-'));
    let state = null;
    await statePlugin({ dataDir: { at: (...p) => path.join(dataDir, ...p) } }, async (_e, s) => { state = s.state; });
    state.follow(async () => work);

    //THREE LINES, EACH NAMING ALL THREE REPOSITORIES. Asked per part, that is
    //nine calls for three answers.
    (await state.here.doc('lines')).write({
        a: { on: { one: 'work', two: 'work', three: 'work' } },
        b: { on: { one: 'work', two: 'work', three: 'work' } },
        c: { on: { one: 'work', two: 'work', three: 'work' } }
    });

    const logger = { good() {}, warn() {}, bad() {}, info() {} };
    const workspace = {
        dir: async () => work,
        folderOf: async (n) => path.join(work, n),
        repos: async () => [{ name: 'one' }, { name: 'two' }, { name: 'three' }]
    };

    let real = null;
    await gitPlugin({ app: { host: {} }, log: { on: () => logger }, workspace }, async (_e, s) => { real = s.git; });

    //THE REAL GIT, COUNTED. Wrapping rather than faking, so what is measured is
    //how often the plugin reaches for it and not how well a stand-in behaves.
    const asked = [];
    const counting = Object.assign({}, real, {
        tracked: (repo) => { asked.push(repo); return real.tracked(repo); }
    });

    const { refs } = await refsFor({ git: counting, workspace, log: { on: () => logger } });

    await linesPlugin({
        app: { host: { actions } }, log: { on: () => logger },
        git: counting, workspace, state, refs
    }, async () => {});

    const said = await actions.call('lines', {});
    assert.equal(said.lines.length, 3, 'the fixture did not make three lines');

    assert.equal(asked.length, 3,
        'asked ' + asked.length + ' times for three repositories — it is asking per part, which is what cost 39% of the window in the app being ported from');
    assert.deepEqual(asked.slice().sort(), ['one', 'three', 'two']);
});

//---------------------------------------------------------------------------
//THE POLICY GATE.
//
//git knows what git will accept; this knows what the app is FOR. The rule: work
//goes onto its own branch and is merged into a line afterwards, so nothing is
//built directly on a protected one — a default, or a link in a line.
//---------------------------------------------------------------------------

test('a branch named by a line is protected, and the refusal says which line', async () => {
    const { actions } = await anApp(THREE);

    await assert.rejects(() => actions.call('branchDelete', { branch: 'work' }), /is a link in "the-change"/);
    //THE SENTENCE, NOT A BOOLEAN. Being a link in a line and being a default are
    //different situations, undone in different places.
    await assert.rejects(() => actions.call('branchDelete', { branch: 'work' }), /merged here afterwards/);

    //and it still exists everywhere
    for (const r of ['one', 'two', 'three']) {
        assert.ok(fs.existsSync(path.join(work, r, '.git', 'refs', 'heads', 'work')), 'it was deleted from ' + r);
    }
});

test('a default branch is protected too, and says so as a default', async () => {
    const { actions } = await anApp({});
    await assert.rejects(() => actions.call('branchDelete', { branch: 'master' }), /the default branch of/);
});

test('cutting ONTO a protected name is refused by the same rule', async () => {
    const { actions } = await anApp(THREE);
    await assert.rejects(
        () => actions.call('branchCreate', { branch: 'work', reason: 'because', from: 'master' }),
        /is a link in "the-change"/);
});

//---------------------------------------------------------------------------
//CUTTING.
//---------------------------------------------------------------------------

test('a cut needs a reason and a named starting point', async () => {
    const { actions } = await anApp(THREE);
    await assert.rejects(() => actions.call('branchCreate', { branch: 'x' }), /Say what "x" is for/);
    await assert.rejects(() => actions.call('branchCreate', { branch: 'x', reason: 'r' }), /Say where "x" is cut from/);
    await assert.rejects(
        () => actions.call('branchCreate', { branch: 'x', reason: 'r', from: 'master', group: 'the-change' }),
        /not both/);
    await assert.rejects(() => actions.call('branchCreate', { branch: 'x', reason: 'r', from: 'x' }), /cannot be cut from itself/);
});

test('a cut from a line starts each repository from that line, and is recorded once', async () => {
    const { actions, state } = await anApp(THREE);

    const said = await actions.call('branchCreate', {
        branch: 'fix/the-thing', reason: 'issue #4 says the header wraps', group: 'the-change'
    });
    assert.equal(said.created, 3);
    for (const r of ['one', 'two', 'three']) {
        assert.equal(at(r, 'fix/the-thing'), at(r, 'work'), 'it did not start from the line in ' + r);
    }

    //WHAT IT WAS CUT FROM IS ONLY KNOWABLE IF IT WAS WRITTEN DOWN — git stops
    //being able to say the moment anything is merged in.
    const note = (await state.here.doc('cuts')).read({})['fix/the-thing'];
    assert.equal(note.group, 'the-change');
    assert.equal(note.by, 'the window');
    assert.match(note.reason, /header wraps/);
    assert.deepEqual(note.cutIn.sort(), ['one', 'three', 'two']);
    assert.deepEqual(note.from, { one: 'work', two: 'work', three: 'work' });

    //CUTTING THE SAME NAME AGAIN MUST NOT REWRITE WHY IT WAS CUT THE FIRST TIME.
    await actions.call('branchCreate', { branch: 'fix/the-thing', reason: 'a different reason', group: 'the-change' });
    assert.match((await state.here.doc('cuts')).read({})['fix/the-thing'].reason, /header wraps/,
        'cutting it again rewrote the record of why');
});

test('a cut from a branch goes wherever that branch is, and nowhere else', async () => {
    const { actions } = await anApp(THREE);
    //a branch that exists in one repository only
    git(['branch', 'just-here', 'master'], path.join(work, 'two'));

    const said = await actions.call('branchCreate', { branch: 'from-one', reason: 'r', from: 'just-here' });
    assert.deepEqual(said.on.map((o) => o.repo), ['two']);
    assert.equal(said.created, 1);

    await assert.rejects(
        () => actions.call('branchCreate', { branch: 'nowhere', reason: 'r', from: 'no-such-branch' }),
        /no branch called "no-such-branch" in any repository/);
});

//---------------------------------------------------------------------------
//DELETING.
//---------------------------------------------------------------------------

test('deleting takes it from every repository that has it, and keeps the note until the last', async () => {
    const { actions, state } = await anApp(THREE);
    await actions.call('branchCreate', { branch: 'fix/gone', reason: 'r', group: 'the-change' });
    assert.ok((await state.here.doc('cuts')).read({})['fix/gone'], 'nothing was recorded');

    const said = await actions.call('branchDelete', { branch: 'fix/gone' });
    assert.equal(said.removed, 3);
    assert.equal((await state.here.doc('cuts')).read({})['fix/gone'], undefined,
        'the note outlived the last copy of the branch');
});

test('a branch carrying work is refused, and force is named as what it costs', async () => {
    const { actions } = await anApp(THREE);
    await actions.call('branchCreate', { branch: 'fix/carries', reason: 'r', group: 'the-change' });

    //put a commit on it in one repository, without checking it out
    const one = path.join(work, 'one');
    const tree = git(['rev-parse', 'work^{tree}'], one).trim();
    const made = git(['commit-tree', tree, '-p', 'work', '-m', 'only here'], one).trim();
    git(['update-ref', 'refs/heads/fix/carries', made], one);

    const said = await actions.call('branchDelete', { branch: 'fix/carries' });
    assert.equal(said.unmerged, true, 'it did not report that a branch carries work');
    assert.match(said.note, /force/);
    assert.ok(fs.existsSync(path.join(one, '.git', 'refs', 'heads', 'fix', 'carries')), 'it was deleted anyway');

    const forced = await actions.call('branchDelete', { branch: 'fix/carries', force: true });
    assert.equal(forced.removed, 1);
});

test('deleting one nothing has is refused, rather than reported as done', async () => {
    const { actions } = await anApp(THREE);
    await assert.rejects(() => actions.call('branchDelete', { branch: 'never-existed' }), /No repository here has a branch/);
});

//---------------------------------------------------------------------------
//SYNCING A LINE — one act across several repositories, only ever forward.
//---------------------------------------------------------------------------

test('a line catches up where it can and reports the part it cannot', async () => {
    const { actions } = await anApp(THREE);

    //origin moves in `two` only
    const other = path.join(work, 'two-elsewhere');
    git(['clone', '-q', path.join(work, 'two.git'), other], work);
    git(['checkout', '-q', 'work'], other);
    fs.writeFileSync(path.join(other, 'moved.txt'), 'on\n');
    git(['add', '.'], other);
    git(['commit', '-q', '-m', 'origin moved'], other);
    git(['push', '-q', 'origin', 'work'], other);

    const said = await actions.call('lineSync', { name: 'the-change' });
    assert.equal(said.moved, 1, 'the part that was behind did not move');
    assert.equal(at('two', 'work'), git(['rev-parse', 'work'], other).trim());

    //the other two had nothing to do, and that is not a failure
    assert.equal(said.stuck, 0, 'a branch already level was reported as stuck');

    fs.rmSync(other, { recursive: true, force: true });
});

test('a part that moved on both sides is reported and left alone', async () => {
    const { actions } = await anApp(THREE);
    const three = path.join(work, 'three');
    const other = path.join(work, 'three-elsewhere');
    git(['clone', '-q', path.join(work, 'three.git'), other], work);
    git(['checkout', '-q', 'work'], other);
    fs.writeFileSync(path.join(other, 'theirs.txt'), 'x\n');
    git(['add', '.'], other);
    git(['commit', '-q', '-m', 'theirs'], other);
    git(['push', '-q', 'origin', 'work'], other);

    const tree = git(['rev-parse', 'work^{tree}'], three).trim();
    const mine = git(['commit-tree', tree, '-p', 'work', '-m', 'ours'], three).trim();
    git(['update-ref', 'refs/heads/work', mine], three);

    const said = await actions.call('lineSync', { name: 'the-change' });
    const row = said.on.find((o) => o.repo === 'three');
    assert.equal(row.moved, false);
    assert.match(row.why, /not a fast-forward/);
    assert.equal(at('three', 'work'), mine, 'the commit here was overwritten');

    fs.rmSync(other, { recursive: true, force: true });
});

test('with no workspace open there are no lines, and it does not throw', async () => {
    const { actions, go } = await anApp(THREE);
    go(null);
    const said = await actions.call('lines', {});
    assert.deepEqual(said.lines, []);
    assert.match(said.note, /No workspace is open/);
});

//---------------------------------------------------------------------------
//WHICH ISSUE A CUT IS FOR.
//
//THE CUT NOTE IS THE ONE RECORD THAT SURVIVES TO THE PULL REQUEST, so it is
//where the issue has to ride -- the task does not reach that moment and a line
//carries no extras. ../pr/server.js writes "Closes owner/repo#N" from it.
//---------------------------------------------------------------------------

test('a cut records the issue it is for, and a later cut may fill a missing one', async () => {
    const { actions, state } = await anApp(THREE);

    await actions.call('branchCreate', {
        branch: 'fix/for-17', reason: 'the header wraps', group: 'the-change',
        issue: { on: 'someone/their-repo', number: 17 }
    });
    const note = (await state.here.doc('cuts')).read({})['fix/for-17'];
    assert.deepEqual(note.issue, { on: 'someone/their-repo', number: 17 });
    //NOT CALLED `from`. That key is the per-repository base ref and is already
    //on the same record; the two must never be confused.
    assert.deepEqual(note.from, { one: 'work', two: 'work', three: 'work' });

    //A BRANCH CUT BY HAND, THEN WRITTEN A TASK ON FROM AN ISSUE. The reason
    //stays as first written; the issue is the one field a later cut may fill.
    await actions.call('branchCreate', { branch: 'fix/by-hand', reason: 'first reason', group: 'the-change' });
    await actions.call('branchCreate', {
        branch: 'fix/by-hand', reason: 'a different reason', group: 'the-change',
        issue: { on: 'a/b', number: 4 }
    });
    const later = (await state.here.doc('cuts')).read({})['fix/by-hand'];
    assert.match(later.reason, /first reason/, 'cutting it again rewrote why');
    assert.deepEqual(later.issue, { on: 'a/b', number: 4 }, 'the later cut did not fill the missing issue');

    //BUT NOT REPLACE ONE. Two issues for one branch is a different branch.
    await actions.call('branchCreate', {
        branch: 'fix/by-hand', reason: 'x', group: 'the-change', issue: { on: 'a/b', number: 5 }
    });
    assert.deepEqual((await state.here.doc('cuts')).read({})['fix/by-hand'].issue, { on: 'a/b', number: 4 });
});

test('the command line spells an issue owner/name#N, and a malformed one is refused', async () => {
    const { actions, state } = await anApp(THREE);

    await actions.call('branchCreate', {
        branch: 'fix/typed', reason: 'r', group: 'the-change', issue: 'someone/their-repo#9'
    });
    assert.deepEqual((await state.here.doc('cuts')).read({})['fix/typed'].issue, { on: 'someone/their-repo', number: 9 });

    //REFUSED RATHER THAN DROPPED. A caller that thought it named an issue and
    //did not would otherwise get a pull request that closes nothing, silently.
    for (const bad of ['17', 'their-repo#17', 'a/b#0', { on: 'a', number: 1 }, { on: 'a/b' }]) {
        await assert.rejects(
            () => actions.call('branchCreate', { branch: 'fix/bad', reason: 'r', group: 'the-change', issue: bad }),
            /is not one/,
            'accepted a malformed issue: ' + JSON.stringify(bad));
    }
});
