const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makePapers = require('../../src/app/queue/papers');

//---------------------------------------------------------------------------
//WHAT A JUDGE SAID, PUT WHERE THE WORKER WILL FIND IT.
//
//THE CLAIM WORTH THE MOST: the report travels as base64. It is arbitrary text
//somebody's model wrote — quotes, backticks, dollar signs, newlines — and
//interpolating that into a shell command is not a risk of a bug, it is the bug.
//
//AND THE SECOND: beside the repositories, never inside one. A report written
//into a repository is a file the worker is liable to commit while doing exactly
//what it was asked, and a judge's report landing in the branch under review is
//the change reviewing itself.
//---------------------------------------------------------------------------

let ran, said, files, texts, judgement;

beforeEach(() => {
    ran = [];
    said = [];
    judgement = { id: 'j1', uid: 'uid-36', ref: 'J36' };
    files = [{ file: 'JUDGEMENT.md' }];
    texts = { 'JUDGEMENT.md': 'it does not hold, and here is why' };
});

function papers(over) {
    return makePapers(Object.assign({
        //ASYNC, LIKE THE REAL STORE. A synchronous stand-in hid a bare call
        //that delivered nothing to any worker, ever.
        judging: { get: async (id) => (judgement && judgement.id === id ? judgement : null) },
        handedBack: () => files,
        readHanded: (uid, file) => ({ text: texts[file] }),
        run: async (machine, command, opts) => { ran.push({ machine, command, opts }); return {}; }
    }, over || {}));
}

const to = { info: (m) => said.push(m), warn: (m) => said.push('WARN ' + m) };

//---- how it travels ---------------------------------------------------------

test('the report goes over as base64 and is decoded on the far side', async () => {
    //INTERPOLATING A MODEL'S PROSE INTO A SHELL COMMAND is the bug.
    await papers().deliver('j1', 'kit-1', to);

    assert.equal(ran.length, 1);
    assert.match(ran[0].command, /printf %s '[A-Za-z0-9+/=]+' \| base64 -d >/);
    assert.equal(ran[0].command.includes('it does not hold'), false,
        'the report itself was in the command line');
});

test('and what arrives is byte-for-byte what the judge wrote', async () => {
    //THE WHOLE POINT OF THE ENCODING. A report a shell had a chance to touch is
    //a report somebody reads a mangled version of.
    texts['JUDGEMENT.md'] = "it's `broken`; $HOME is wrong\nand \"quoted\" — see line 4\\5";

    await papers().deliver('j1', 'kit-1', to);

    const b64 = ran[0].command.match(/printf %s '([A-Za-z0-9+/=]+)'/)[1];
    assert.equal(Buffer.from(b64, 'base64').toString('utf8'), texts['JUDGEMENT.md']);
});

test('a report full of quotes cannot end the command it travels in', async () => {
    texts['JUDGEMENT.md'] = "'; rm -rf ~; echo '";
    await papers().deliver('j1', 'kit-1', to);

    assert.equal(ran[0].command.includes('rm -rf'), false, 'a report closed its own quoting');
    assert.match(ran[0].command, /printf %s '[A-Za-z0-9+/=]+' \|/);
});

//---- where it lands -----------------------------------------------------------

test('beside the repositories, never inside one', async () => {
    //THE FOLDER ROOT IS NOT A GIT REPOSITORY, so nothing here can be committed
    //by accident — and `ls` shows it immediately.
    await papers().deliver('j1', 'kit-1', to);
    assert.match(ran[0].command, /^cd ~\/workspace 2>\/dev\/null \|\| cd ~;/);
});

test('and the name is sanitised, because it becomes a filename on the guest', async () => {
    //WHAT A MODEL CALLED ITS OWN FILE is not something to hand to a shell.
    files = [{ file: '../../etc/passwd' }];
    texts['../../etc/passwd'] = 'x';

    const landed = await papers().deliver('j1', 'kit-1', to);

    //THE DOTS SURVIVE AND THE SLASHES DO NOT, which is the whole of it: `..` is
    //only a way out when something separates it from the next name. What lands
    //is one oddly-named file in the folder it was meant for.
    assert.deepEqual(landed, ['J36-..-..-etc-passwd']);
    assert.equal(landed[0].includes('/'), false, 'a report kept a path separator in its name');
    assert.equal(ran[0].command.includes('../..'), false, 'a report escaped the folder it was put in');
});

test('and a name cannot break out of the quoting it is written into', async () => {
    files = [{ file: 'a"; rm -rf ~; echo "b' }];
    texts['a"; rm -rf ~; echo "b'] = 'x';

    await papers().deliver('j1', 'kit-1', to);
    assert.equal(ran[0].command.includes('rm -rf'), false, 'a filename closed its own quoting');
});

test('the name says which judgement it came from', async () => {
    //A DIRECTORY WITH `JUDGEMENT.md` IN IT says nothing about which reading
    //produced it, and a task can be raised from one of several.
    const landed = await papers().deliver('j1', 'kit-1', to);
    assert.deepEqual(landed, ['J36-JUDGEMENT.md']);
    assert.ok(said.some((m) => /J36 said JUDGEMENT\.md — left on kit-1 as J36-JUDGEMENT\.md/.test(m)),
        said.join(' | '));
});

//---- only the judgement this task came from -------------------------------------

test('one judgement, not the filing cabinet', async () => {
    //THE ONE THAT ESTABLISHED THIS WORK IS REAL is the one the work has to
    //answer.
    let askedFor = null;
    await papers({ handedBack: (uid) => { askedFor = uid; return files; } }).deliver('j1', 'kit-1', to);
    assert.equal(askedFor, 'uid-36');
});

test('a judgement that is not here any more delivers nothing, and does not throw', async () => {
    judgement = null;
    assert.deepEqual(await papers().deliver('j1', 'kit-1', to), []);
    assert.deepEqual(ran, []);
});

//---- and what it will not choke on ------------------------------------------------

test('a file that is not text is skipped, and the rest still arrive', async () => {
    //WHAT IS BEING READ is whatever a model chose to write to disk.
    files = [{ file: 'a.md' }, { file: 'binary.bin' }, { file: 'b.md' }];
    texts = { 'a.md': 'one', 'b.md': 'two' };

    const landed = await papers().deliver('j1', 'kit-1', to);

    assert.deepEqual(landed, ['J36-a.md', 'J36-b.md']);
    assert.equal(ran.length, 2);
});

test('a judgement that handed nothing back delivers nothing', async () => {
    //SAID BY THE CALLER, NOT HERE — ../queue/onetask turns an empty list into
    //the sentence, because what it means is about the TASK.
    files = [];
    assert.deepEqual(await papers().deliver('j1', 'kit-1', to), []);
    assert.deepEqual(said, []);
});

test('every delivery is bounded, because a machine that stopped answering must not hold this open', async () => {
    await papers().deliver('j1', 'kit-1', to);
    assert.ok(ran[0].opts.timeout > 0, 'it asked a machine to do something with no bound on the answer');
    assert.match(ran[0].opts.what, /putting J36's report where the worker will find it/);
});
