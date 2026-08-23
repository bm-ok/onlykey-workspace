const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', 'src', 'app');
const makeFolder = require(path.join(APP, 'runners', 'runs', 'folder.js'));
const { resolveHome, stillUnexpanded } = makeFolder;

//---------------------------------------------------------------------------
//1. THE EXPANSION, WHICH NOTHING ON THE WAY TO A MACHINE DOES.
//---------------------------------------------------------------------------

test('the default folder resolves against the home the machine reported', () => {
    //THE WHOLE POINT. `cd '$HOME/workspace'` fails and falls back to `cd $HOME`,
    //so the workspace is laid out in one place and the work happens in another.
    assert.equal(resolveHome('$HOME/workspace', '/home/okc'), '/home/okc/workspace');
    assert.equal(resolveHome('~/workspace', '/home/okc'), '/home/okc/workspace');
});

test('a home with a trailing slash does not produce a doubled one', () => {
    assert.equal(resolveHome('$HOME/workspace', '/home/okc/'), '/home/okc/workspace');
});

test('$HOME and ~ on their own are the home directory', () => {
    assert.equal(resolveHome('$HOME', '/home/okc'), '/home/okc');
    assert.equal(resolveHome('~', '/home/okc'), '/home/okc');
});

test('an absolute path is left exactly as it is', () => {
    assert.equal(resolveHome('/srv/work', '/home/okc'), '/srv/work');
});

test('only the FRONT is expanded, and only on a boundary', () => {
    //A shell's job on text this does not own. A directory legitimately called
    //`back~up` is not a home directory reference, and `$HOMEWORK` is not $HOME.
    assert.equal(resolveHome('/srv/back~up', '/home/okc'), '/srv/back~up');
    assert.equal(resolveHome('$HOMEWORK/x', '/home/okc'), '$HOMEWORK/x');
    assert.equal(resolveHome('/a/$HOME/b', '/home/okc'), '/a/$HOME/b');
});

test('with no home reported, nothing is invented', () => {
    //Better to send what was asked for and have `cd` fail than to guess at
    //somebody else's home directory.
    assert.equal(resolveHome('$HOME/workspace', ''), '$HOME/workspace');
    assert.equal(resolveHome('$HOME/workspace', null), '$HOME/workspace');
});

//---------------------------------------------------------------------------
//2. WHAT IS STILL AN EXPANSION AFTERWARDS.
//---------------------------------------------------------------------------

test('a path with nothing left to expand is clean', () => {
    assert.equal(stillUnexpanded('/home/okc/workspace'), null);
    assert.equal(stillUnexpanded(''), null);
    assert.equal(stillUnexpanded(null), null);
});

test('a spelling this does not resolve is NAMED, not guessed at', () => {
    //Sending it would reproduce the silent fallback with a different spelling,
    //and the message has to say which part nothing will expand.
    assert.equal(stillUnexpanded('${HOME}/work'), '${HOME}');
    assert.equal(stillUnexpanded('$WORKSPACE/x'), '$WORKSPACE');
    assert.equal(stillUnexpanded('/srv/$USER/work'), '$USER');
});

//---------------------------------------------------------------------------
//3. ASKED OF THE MACHINE, EVERY TIME.
//---------------------------------------------------------------------------

function folderFor(opts) {
    const o = opts || {};
    const asked = [];
    const made = makeFolder({
        homeOf: async (m) => { asked.push(m); return o.home === undefined ? '/home/okc' : o.home; },
        defaultFor: () => o.default || '$HOME/workspace'
    });
    return { on: made.on, asked };
}

test('what was asked for wins over the default', async () => {
    const { on } = folderFor({});
    assert.equal(await on('kit-1', '/srv/elsewhere'), '/srv/elsewhere');
});

test('the default is used when nothing was asked for, and is resolved too', async () => {
    const { on } = folderFor({});
    assert.equal(await on('kit-1', null), '/home/okc/workspace');
    assert.equal(await on('kit-1', ''), '/home/okc/workspace');
});

test('the machine is asked its own home rather than one being assumed', async () => {
    //Hard-coding /home/okc would be this host deciding something about somebody
    //else's computer, and wrong the first time a machine is built with another
    //user.
    const { on, asked } = folderFor({ home: '/root' });
    assert.equal(await on('kit-1', null), '/root/workspace');
    assert.deepEqual(asked, ['kit-1']);
});

test('it is asked every run, not held from the first one', async () => {
    //A machine can be rebuilt under this app with a different user, and a cached
    //home would send work into a directory that no longer exists — which the
    //`|| cd "$HOME"` fallback would hide all over again.
    const { on, asked } = folderFor({});
    await on('kit-1', null);
    await on('kit-1', null);
    assert.equal(asked.length, 2);
});

test('a folder nothing can expand is refused, and the refusal says why', async () => {
    const { on } = folderFor({ default: '${HOME}/workspace' });
    await assert.rejects(() => on('kit-1', null),
        (e) => /\$\{HOME\}/.test(e.message) && /silently run in the home directory/.test(e.message));
});

test('a machine that reports no home still refuses rather than sending an expansion', async () => {
    //The two halves together: nothing is invented, and what is left unexpanded
    //is refused instead of being sent to fail quietly.
    const { on } = folderFor({ home: '' });
    await assert.rejects(() => on('kit-1', null), /\$HOME/);
});
