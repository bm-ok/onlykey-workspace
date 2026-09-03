const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const makeDoc = require('../../src/app/workstrap/doc');

//---------------------------------------------------------------------------
//THE WORKSPACE'S OWN NOTES.
//
//WHAT THIS FILE IS FOR. A machine opens `~/workspace`, finds the repositories,
//and is told nothing about them — so every worker and every judge works out how
//to finalise, build, test and run the project again from the source. One judge
//spent its opening turns building a virtualenv before it could start on the
//question it had been sent to answer.
//
//THE ONE DISTINCTION EVERYTHING HERE TURNS ON is whether the answer is what
//somebody wrote about THIS project or the starter every empty workspace gets.
//Once both are just text they are indistinguishable, and the difference decides
//whether a machine should believe what it is reading — and whether ../bootstrap
//ships one project's notes into every workspace made from its bundle.
//---------------------------------------------------------------------------

const STARTER = '# This workspace\n\nstarter text\n';

function aDoc(files, dir) {
    const at = dir === undefined ? '/ws/.okc' : dir;
    const kept = Object.assign({}, files);

    return {
        doc: makeDoc({
            dirNow: async () => at,
            starter: () => STARTER,
            there: (p) => Object.prototype.hasOwnProperty.call(kept, p),
            readFile: (p) => {
                if (kept[p] instanceof Error) throw kept[p];
                return kept[p];
            },
            writeFile: (p, text) => { kept[p] = text; }
        }),
        kept
    };
}

const AT = path.join('/ws/.okc', 'workspace_claude.md');

test('a workspace that has written its own notes is given them', async () => {
    const { doc } = aDoc({ [AT]: '# Ours\n\nrun the tests with `make check`\n' });
    const got = await doc.read();

    assert.match(got.text, /make check/);
    assert.equal(got.mine, true, 'a workspace\'s own notes were reported as the starter');
    assert.equal(got.at, AT);
});

test('and one that has not is given the starter, marked as not its own', async () => {
    //THE STARTER IS AN ANSWER, NOT A FAILURE. A workspace nobody has written up
    //still has a machine opening it in a minute's time, and handing that machine
    //nothing teaches it nothing — the starter at least says what the file is and
    //asks for it to be filled in.
    const { doc } = aDoc({});
    const got = await doc.read();

    assert.equal(got.text, STARTER);
    assert.equal(got.mine, false,
        'the starter was reported as something this workspace wrote about itself');
});

test('an unreadable file is not quietly reported as an empty workspace', async () => {
    //THE ONE FAILURE THAT MUST NOT FALL BACK. "Nobody has written this up" and
    //"what was written cannot be read" are opposite facts, and the second
    //arriving as the first is how a permission problem or a half-written file
    //becomes a project that looks like it has nothing to say about itself —
    //quietly, on every machine, until somebody wonders where the notes went.
    const { doc } = aDoc({ [AT]: new Error('EACCES: permission denied') });

    await assert.rejects(() => doc.read(), /EACCES/,
        'an unreadable file was answered with the starter');
});

test('with no workspace open it still answers, and refuses to write', async () => {
    //READING AND WRITING DIFFER HERE ON PURPOSE. Something may ask what a
    //machine would be told before any workspace is open — ../bootstrap does,
    //when it builds a bundle — and the honest answer is the starter. Writing has
    //nowhere to go, and saying so is the only useful thing it can do.
    const { doc } = aDoc({}, null);

    const got = await doc.read();
    assert.equal(got.mine, false);
    assert.equal(got.at, null);

    await assert.rejects(() => doc.write('anything'), /No workspace is open/);
});

test('writing makes the notes this workspace\'s own', async () => {
    const { doc } = aDoc({});

    assert.equal((await doc.read()).mine, false);
    await doc.write('# Ours\n\nhow to run it\n');

    const now = await doc.read();
    assert.equal(now.mine, true);
    assert.match(now.text, /how to run it/);
});

test('the notes sit at the root of the drawer, never in provision/', async () => {
    //NOT A PREFERENCE ABOUT TIDINESS. ../vms/provision serves ANY file in the
    //folders on its search path to any guest that names it, and `.okc/provision`
    //is one of those folders. Keeping this file at the root is what makes it
    //safe to serve through one route of its own — and what stops anybody being
    //tempted to add the drawer's root to that search path, which would serve
    //machines.json and every contract along with it.
    const { doc } = aDoc({});
    const at = await doc.at();

    assert.equal(path.basename(at), 'workspace_claude.md');
    assert.equal(path.basename(path.dirname(at)), '.okc',
        'the notes moved into a subfolder of the drawer');
    assert.ok(!/provision/.test(at), 'the notes are inside the provisioning folder');
});

test('it refuses to be built without the pieces it cannot work without', async () => {
    //A STARTER THAT IS MISSING WOULD ONLY SHOW UP on a workspace that has no
    //notes — which is the first run of every new workspace, and the one time
    //nobody is watching a machine boot.
    assert.throws(() => makeDoc({ dirNow: async () => '/ws/.okc' }), /starter/);
    assert.throws(() => makeDoc({ starter: () => STARTER }), /where the workspace drawer is/);
});
