const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const statePlugin = require('../../src/app/core/state/main');
const workspacePlugin = require('../../src/app/workspace/server');

//WHICH FOLDER THIS APP IS ABOUT, AND THE DIFFERENCE BETWEEN REMEMBERING ONE AND
//MOVING INTO IT.
//
//`workspaceAdd` used to call the same function `workspaceUse` does, so the
//pane's two buttons were one act wearing two labels: "Remember it" switched the
//entire app to another folder, with no confirm dialog in front of it, because
//somebody filed a path to look at later. Every tab in the window is a statement
//about the open folder, so that is as large a change as this app makes.

function aWorkspace() {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-ws-'));
    const dataDir = { at: (...p) => path.join(home, 'data', ...p) };

    let state = null;
    statePlugin({ dataDir }, async (_e, s) => { state = s.state; });

    //THE ACTION TABLE, RECORDED RATHER THAN RUN. `define` hands back its undo,
    //which the plugin keeps, so the stand-in has to as well.
    const table = {};
    const actions = {
        define(name, spec) { table[name] = spec; return () => { delete table[name]; }; }
    };

    //NOTHING IS LISTENING DOWN THE RELAY, which is the ordinary case here and
    //the one that makes `borrowed()` answer null. Async, because the real one is.
    const okc = { call: async () => { throw new Error('nothing is listening'); } };
    const said = [];
    const log = { on: () => ({
        good: m => said.push(m), info: m => said.push(m),
        warn: m => said.push(m), error: m => said.push(m)
    }) };

    let workspace = null;
    const ready = workspacePlugin(
        { app: { host: { actions } }, okc, state, log },
        async (_e, s) => { workspace = s.workspace; }
    );

    function folder(name, withRepos = 0) {
        const dir = path.join(home, name);
        fs.mkdirSync(dir, { recursive: true });
        for (let i = 0; i < withRepos; i++) {
            fs.mkdirSync(path.join(dir, 'repo' + i, '.git'), { recursive: true });
        }
        return dir;
    }

    return { ready, home, folder, table, said, get workspace() { return workspace; } };
}

test('remembering a folder does not open it', async () => {
    const w = aWorkspace();
    await w.ready;

    const first = w.folder('first', 2);
    const second = w.folder('second', 1);

    await w.table.workspaceUse.run({ dir: first });
    assert.equal(await w.workspace.dir(), first, 'opening one should open it');

    const said = await w.table.workspaceAdd.run({ dir: second });

    assert.equal(await w.workspace.dir(), first,
        'REMEMBERING A FOLDER MOVED THE WHOLE APP INTO IT. Everything on every '
        + 'other tab became a statement about somewhere else because a path was '
        + 'filed for later.');
    assert.equal(said.added, second);
    assert.equal(said.already, false);
    //NOT `open`: the action answers with `all()` merged over this, and
    //`all().open` is a boolean. See ../../src/app/workspace/server.js.
    assert.equal(said.stillOpen, first, 'the answer should say which folder is still open');
    assert.equal(said.open, true, 'and `open` should still mean what it means everywhere else');

    //AND IT IS ON THE LIST, which is the whole point of the act.
    const known = said.known.map(k => k.dir);
    assert.ok(known.includes(second), 'the folder it was asked to remember is not on the list');
    assert.ok(known.includes(first));
    assert.equal(said.known.filter(k => k.current).length, 1);
    assert.equal(said.current.dir, first);
});

test('remembering the same folder twice says so and changes nothing', async () => {
    const w = aWorkspace();
    await w.ready;
    const one = w.folder('one', 1);

    await w.table.workspaceAdd.run({ dir: one });
    const again = await w.table.workspaceAdd.run({ dir: one });

    assert.equal(again.already, true);
    assert.equal(again.known.filter(k => k.dir === one).length, 1,
        'a folder remembered twice should be on the list once');
});

test('a folder that is not there is refused when it is remembered, not when it is opened', async () => {
    const w = aWorkspace();
    await w.ready;

    await assert.rejects(
        () => w.table.workspaceAdd.run({ dir: path.join(w.home, 'nowhere') }),
        /There is no folder at/,
        'a path worth refusing is worth refusing at the moment it is typed');

    const file = path.join(w.home, 'a-file.txt');
    fs.writeFileSync(file, 'not a folder');
    await assert.rejects(() => w.table.workspaceAdd.run({ dir: file }), /is a file, not a folder/);
    await assert.rejects(() => w.table.workspaceAdd.run({ dir: '   ' }), /Which folder\?/);
});

test('opening a remembered folder is the act that switches, and it counts what is in it', async () => {
    const w = aWorkspace();
    await w.ready;

    const empty = w.folder('empty', 0);
    const full = w.folder('full', 3);

    await w.table.workspaceAdd.run({ dir: empty });
    await w.table.workspaceAdd.run({ dir: full });
    const before = await w.table.workspaces.run({});
    assert.equal(before.open, false, 'nothing should be open yet — both were only remembered');

    const after = await w.table.workspaceUse.run({ dir: empty });
    assert.equal(after.open, true);
    assert.equal(after.current.dir, empty);

    //ZERO IS A COUNT, NOT A MISSING ONE. `null` means it could not be read.
    const rows = {};
    after.known.forEach(k => { rows[k.dir] = k; });
    assert.equal(rows[empty].repos, 0, 'an empty workspace should count zero, not read as uncounted');
    assert.equal(rows[full].repos, 3);
    assert.deepEqual(await w.workspace.repos(), [], 'an empty folder holds no repositories, which is not an error');
});
