const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makeSettingUp = require('../../src/app/repositories/repos/setting-up');
const { guestPath } = require('../../src/app/repositories/repos/setting-up');
const reach = require('../../src/app/repositories/branches/reach');

//---------------------------------------------------------------------------
//DECIDING WHETHER A MACHINE CAN BE SET UP, AND ON WHAT.
//
//THE CLAIM WORTH THE MOST: what is knowable without a machine is checked without
//one. A branch that does not exist is a mistake whether or not anything is
//running, and it used to be found AFTER starting a machine and waiting for it to
//dial in — so the answer to a typo was five minutes away and arrived as though
//the machine were the problem.
//
//AND THE TWO THAT KEEP WORK FROM VANISHING, which are the same failure from
//opposite sides:
//
//  a machine stays on its branch    switching leaves commits on a machine, on a
//                                   branch it may no longer push, with nothing
//                                   saying so
//  one machine per branch           two push the same ref; the second is refused
//                                   as a non-fast-forward and its commits strand
//
//Both end in work that is neither finished nor lost, which is the state that
//gets discovered weeks later.
//---------------------------------------------------------------------------

let machines, here, carriers, scope, heads, dialled, names, protectedRows, revisable, defaults;

const VM = (over) => Object.assign({ name: 'kit-1', spec: {} }, over || {});

beforeEach(() => {
    machines = [VM()];
    here = ['repo-a', 'repo-b'];
    carriers = ['repo-a', 'repo-b'];
    scope = { group: null, repos: ['repo-a', 'repo-b'], whole: true, gone: [] };
    heads = { 'repo-a': { 'pull/13': 'abc1234' } };
    dialled = true;
    names = true;
    protectedRows = {};
    revisable = true;
    defaults = { 'repo-a': 'master', 'repo-b': 'main' };
});

function settingUp(over) {
    return makeSettingUp(Object.assign({
        ours: {
            get: (n) => {
                const vm = machines.filter((v) => v.name === n)[0];
                if (!vm) throw new Error('"' + n + '" is not a virtual machine this app made.');
                return vm;
            },
            read: () => machines
        },
        repos: async () => here.map((name) => ({ name })),
        carriersOf: async () => carriers,
        scopeOf: async () => scope,
        headIn: async (repo, branch) => ((heads[repo] || {})[branch] || null),
        connected: () => dialled,
        nameIsOk: async () => names,
        defaultOf: async (repo) => defaults[repo] || null,
        protectedOf: async () => protectedRows,
        mayRevise: async () => revisable,
        reach
    }, over || {}));
}

const plan = (want, over) => settingUp(over).plan('kit-1', want || { branch: 'work/the-thing' });

//---- a path on the machine, not on this host ---------------------------------

test('a Windows path where a guest path belongs is refused, with the fix', () => {
    //GIT BASH REWRITES IT ON THE WAY THROUGH: type /home/okc/work and what
    //arrives is C:/Program Files/Git/home/okc/work — a real path, on the wrong
    //computer, which the guest then makes as a directory with spaces in it.
    assert.throws(() => guestPath('C:/Program Files/Git/home/okc', '--folder'),
        /is a path on this host, not on the machine/);
    assert.throws(() => guestPath('C:/x', '--folder'), /MSYS_NO_PATHCONV=1 okc\.js/);
    assert.throws(() => guestPath('a\\b', '--folder'), /is a path on this host/);
});

test('and a guest path is handed straight back', () => {
    assert.equal(guestPath('/home/okc/work', '--folder'), '/home/okc/work');
    assert.equal(guestPath('$HOME/workspace', '--folder'), '$HOME/workspace');
    assert.equal(guestPath(null, '--folder'), null);
    assert.equal(guestPath('', '--folder'), '');
});

test('it is asked before anything else touches the machine', async () => {
    await assert.rejects(() => plan({ branch: 'work/the-thing', folder: 'C:/somewhere' }),
        /is a path on this host/);
});

//---- what is knowable without a machine ---------------------------------------

test('a branch nothing has is refused before the machine is even asked about', async () => {
    carriers = [];
    let asked = false;

    await assert.rejects(() => plan({ branch: 'work/typo' }, { connected: () => { asked = true; return true; } }),
        /There is no branch called "work\/typo"/);
    assert.equal(asked, false, 'it asked whether a machine was dialled in before checking the branch');
});

test('and one missing from part of its line, with what extends it', async () => {
    carriers = ['repo-a'];
    await assert.rejects(() => plan(), /is not in repo-b, and a machine checks it out in every repository/);
});

test('saying no branch at all is refused rather than guessed', async () => {
    await assert.rejects(() => plan({}), /Say which branch "kit-1" is to work on/);
});

test('but a machine already on one does not have to be told again', async () => {
    machines = [VM({ branch: 'work/the-thing' })];
    const said = await plan({});
    assert.equal(said.branch, 'work/the-thing');
});

test('a machine that is not dialled in is refused', async () => {
    dialled = false;
    await assert.rejects(() => plan(), /is not dialled in\. Start it and wait for it to connect/);
});

test('and a name git will not accept', async () => {
    names = false;
    await assert.rejects(() => plan(), /is not a name git will accept for a branch/);
});

test('and a machine this app did not make', async () => {
    await assert.rejects(() => settingUp().plan('somebody-elses', { branch: 'work/x' }),
        /is not a virtual machine this app made/);
});

//---- a machine stays on its branch until it is clean ----------------------------

test('moving one to another branch is refused, and says the only way off', async () => {
    //SWITCHING IS HOW HALF-FINISHED WORK STOPS BEING ANYWHERE: the commits stay
    //on the machine, on a branch it may no longer push, with nothing saying so.
    machines = [VM({ branch: 'work/the-thing' })];

    await assert.rejects(() => plan({ branch: 'work/something-else' }),
        /"kit-1" is set up on work\/the-thing and stays there until it is clean/);
    await assert.rejects(() => plan({ branch: 'work/something-else' }),
        /go back to a snapshot taken before that branch/);
});

test('and setting it up again on the SAME branch is not moving it', async () => {
    machines = [VM({ branch: 'work/the-thing' })];
    const said = await plan({ branch: 'work/the-thing' });
    assert.equal(said.branch, 'work/the-thing');
});

//---- one machine per branch ------------------------------------------------------

test('a branch another machine holds is refused, and names it', async () => {
    //TWO MACHINES PUSH THE SAME REF, so the second to finish is refused as a
    //non-fast-forward and its commits strand.
    machines = [VM(), VM({ name: 'kit-2', branch: 'work/the-thing' })];

    await assert.rejects(() => plan(), /already being worked on by "kit-2"/);
    await assert.rejects(() => plan(), /the loser's commits strand/);
    await assert.rejects(() => plan(), /roll "kit-2" back to a point before it/);
});

test('and a machine does not collide with itself', async () => {
    machines = [VM({ branch: 'work/the-thing' })];
    assert.equal((await plan({ branch: 'work/the-thing' })).branch, 'work/the-thing');
});

//---- only the repositories the branch is about --------------------------------------

test('a machine gets the line, not the whole workspace', async () => {
    //EVERY CHECKOUT ON IT is something a worker can read, change and push — so a
    //change concerning two repositories granted four, and the extra two are the
    //ones nobody reviews afterwards.
    here = ['repo-a', 'repo-b', 'repo-c'];
    carriers = ['repo-a', 'repo-b'];
    scope = { group: 'the line', repos: ['repo-a', 'repo-b'], gone: [] };

    const said = await plan();

    assert.deepEqual(said.repos, ['repo-a', 'repo-b']);
    assert.equal(said.group, 'the line');
});

test('a line that named a repository this workspace no longer has still goes ahead', async () => {
    //A TASK THAT SPANNED TWO AND CAN NOW REACH ONE is a different task, not a
    //broken one — and nothing can extend a branch into a repository that is not
    //here, so refusing would be a refusal with no way out of it.
    here = ['repo-a'];
    carriers = ['repo-a'];
    scope = { group: 'the line', repos: ['repo-a'], gone: ['repo-b'] };

    const said = await plan();

    assert.deepEqual(said.repos, ['repo-a']);
    assert.deepEqual(said.gone, ['repo-b'], 'nothing said the line had lost a repository');
});

test('a workspace with no repositories at all is refused', async () => {
    here = [];
    carriers = [];
    scope = { group: null, repos: [], whole: true, gone: [] };

    await assert.rejects(() => plan(), /is about nothing this workspace has/);
});

//---- and what the machine may push ----------------------------------------------------

test('an ordinary branch is not read-only, and is claimed', async () => {
    const said = await plan();

    assert.equal(said.readOnly, false);
    assert.equal(said.claims, 'work/the-thing');
});

test('a protected branch that may be revised is NOT marked read-only', async () => {
    //THE SIGN AGREES WITH THE RULE. A branch the host's hook would accept a push
    //to must not carry a notice saying it will refuse one — it did, and the run
    //that found out was thrown away.
    protectedRows = { 'work/the-thing': { branch: 'work/the-thing', asDefault: [], asLine: ['a line'] } };
    revisable = true;

    assert.equal((await plan()).readOnly, false);
});

test('and one that may not IS', async () => {
    protectedRows = { 'work/the-thing': { branch: 'work/the-thing', asDefault: ['repo-a'], asLine: [] } };
    revisable = false;

    assert.equal((await plan()).readOnly, true);
});

//---- set up to READ, which is not set up to work ----------------------------------------

test('a reading machine gets every repository, not just the one with the change', async () => {
    //THE REASON READING EXISTS: a judge that can only see the repository a change
    //is in cannot say whether another one needed changing too.
    here = ['repo-a', 'repo-b', 'repo-c'];
    scope = { group: 'a line', repos: ['repo-a'], gone: [] };

    const said = await plan({ reading: { repo: 'repo-a', branch: 'pull/13' } });

    assert.deepEqual(said.repos, ['repo-a', 'repo-b', 'repo-c']);
});

test('the change is on its branch, and everything else on its own default', async () => {
    here = ['repo-a', 'repo-b'];
    const said = await plan({ reading: { repo: 'repo-a', branch: 'pull/13' } });

    assert.deepEqual(said.on, { 'repo-a': 'pull/13', 'repo-b': 'main' });
    assert.equal(said.branch, 'pull/13');
    assert.equal(said.reading.head, 'abc1234');
});

test('a reading machine is ALWAYS read-only, whatever the branch is', async () => {
    //NOT NEGOTIABLE. A judge may not push anywhere.
    protectedRows = {};
    revisable = true;

    assert.equal((await plan({ reading: { repo: 'repo-a', branch: 'pull/13' } })).readOnly, true);
});

test('and it claims NOTHING, which is the record saying so', async () => {
    //BEING SET UP ON A BRANCH is what every other machine's permission to push is
    //MADE of, so recording it would hand a judge the right to write to the very
    //thing it is judging.
    assert.strictEqual((await plan({ reading: { repo: 'repo-a', branch: 'pull/13' } })).claims, null);
});

test('a reading machine does not collide with one working the same name', async () => {
    //NOTHING IS CLAIMED, so there is no ref for two machines to race for.
    machines = [VM(), VM({ name: 'kit-2', branch: 'pull/13' })];

    const said = await plan({ reading: { repo: 'repo-a', branch: 'pull/13' } });
    assert.equal(said.branch, 'pull/13');
});

test('nor is it measured against the branches this workspace cut', async () => {
    //THE BRANCH IT READS came from somebody else and exists in exactly one
    //repository, on purpose. "Missing from the others" is not a fault.
    carriers = [];
    const said = await plan({ reading: { repo: 'repo-a', branch: 'pull/13' } });
    assert.equal(said.branch, 'pull/13');
});

test('and a machine already on a branch is not stopped from reading', async () => {
    machines = [VM({ branch: 'work/the-thing' })];
    const said = await plan({ reading: { repo: 'repo-a', branch: 'pull/13' } });
    assert.equal(said.branch, 'pull/13');
});

//---- and what reading refuses ------------------------------------------------------------

test('a pull request not brought here yet is refused, naming what brings it', async () => {
    await assert.rejects(() => plan({ reading: { repo: 'repo-a', branch: 'pull/99' } }),
        /has no branch called "pull\/99", so there is nothing on it to read\. Bring the pull request here first — prFetch/);
});

test('a repository this workspace does not have is named, not guessed at', async () => {
    await assert.rejects(() => plan({ reading: { repo: 'someone-elses', branch: 'pull/13' } }),
        /There is no repository called "someone-elses" in this workspace/);
});

test('and half a reading is refused rather than half applied', async () => {
    await assert.rejects(() => plan({ reading: { repo: 'repo-a' } }),
        /Reading takes both a repository and the branch in it that carries the change/);
    await assert.rejects(() => plan({ reading: { branch: 'pull/13' } }),
        /Reading takes both a repository and the branch/);
});
