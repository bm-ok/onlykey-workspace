const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

//THE FOLDER IS HANDED IN BY ENVIRONMENT, before the plugin is loaded, because
//that is the one way the real app takes it too (OKC_DOCS_DIR).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-docs-'));
process.env.OKC_DOCS_DIR = dir;

const actionsPlugin = require('../../src/app/core/actions/main');
const docsPlugin = require('../../src/app/docs/server');

//---------------------------------------------------------------------------
//A WIKI MADE OF FILES. Two writers -- a person at the window and the model at
//the command line -- on the same pages, kept by git.
//---------------------------------------------------------------------------

async function anApp() {
    let actions = null;
    await actionsPlugin({}, async (_e, s) => { actions = s.actions; });
    const said = [];
    const logger = { good: (t) => said.push(t), warn: (t) => said.push('WARN ' + t), info: () => {}, bad: () => {} };
    await docsPlugin({ app: { host: { actions } }, log: { on: () => logger } }, async () => {});
    return { actions, said };
}

test('a page is written, listed with its title, and read back whole', async () => {
    const { actions } = await anApp();
    const wrote = await actions.call('docWrite', { name: 'guide/setup', text: '# Setting up\n\nplug it in\n' });
    assert.equal(wrote.name, 'guide/setup.md', 'the .md was not added');
    assert.equal(wrote.made, true);
    assert.ok(fs.existsSync(path.join(dir, 'guide', 'setup.md')), 'the folder was not made');

    const list = await actions.call('docs', {});
    assert.equal(list.dir, dir);
    const row = list.docs.find((d) => d.name === 'guide/setup.md');
    assert.ok(row, 'the page is not listed');
    assert.equal(row.title, 'Setting up', 'the title is the first heading');

    const page = await actions.call('docRead', { name: 'guide/setup.md' });
    assert.equal(page.text, '# Setting up\n\nplug it in\n');
    assert.equal(page.modified, row.modified);
});

test('a page somebody else changed since it was read is refused, not written over', async () => {
    const { actions } = await anApp();
    await actions.call('docWrite', { name: 'shared', text: 'one\n' });
    const mine = await actions.call('docRead', { name: 'shared' });

    //THE OTHER WRITER, with a stamp that is certainly different.
    const full = path.join(dir, 'shared.md');
    fs.writeFileSync(full, 'two\n');
    const later = new Date(new Date(mine.modified).getTime() + 5000);
    fs.utimesSync(full, later, later);

    await assert.rejects(
        () => actions.call('docWrite', { name: 'shared', text: 'mine\n', was: mine.modified }),
        /changed since you read it/
    );
    assert.equal(fs.readFileSync(full, 'utf8'), 'two\n', 'their write was dropped');

    //READ AGAIN, CARRY IT OVER, AND IT GOES.
    const fresh = await actions.call('docRead', { name: 'shared' });
    const wrote = await actions.call('docWrite', { name: 'shared', text: 'two, and mine\n', was: fresh.modified });
    assert.equal(wrote.wrote, true);
});

test('a name cannot leave the folder, and nothing but markdown is a page', async () => {
    const { actions } = await anApp();
    for (const bad of ['../outside', '/etc/passwd', 'C:/x', 'a/../../b']) {
        await assert.rejects(() => actions.call('docWrite', { name: bad, text: 'x' }), /docs folder|page name/, bad);
    }
    await assert.rejects(() => actions.call('docWrite', { name: 'a$b', text: 'x' }), /not a page name/);
    await assert.rejects(() => actions.call('docRead', { name: 'nowhere' }), /no page called/);
    //AND NO NAME IS NO PAGE, not an error: a pane asks this before anything is picked.
    const none = await actions.call('docRead', {});
    assert.equal(none.name, null);
});

test('a search finds the word in titles and bodies, says which lines, and leaves the rest out', async () => {
    const { actions } = await anApp();
    await actions.call('docWrite', { name: 'find/one', text: '# Merge rules\n\nthe person merges.\nnobody else merges.\n' });
    await actions.call('docWrite', { name: 'find/two', text: '# Elsewhere\n\nnothing here.\n' });
    await actions.call('docWrite', { name: 'find/three', text: '# Three\n\nwho may MERGE what\n' });

    const said = await actions.call('docs', { q: 'merge' });
    const names = said.docs.map((d) => d.name);
    assert.ok(names.includes('find/one.md') && names.includes('find/three.md'), names.join());
    assert.ok(!names.includes('find/two.md'), 'a page that does not say it was listed');
    const one = said.docs.find((d) => d.name === 'find/one.md');
    assert.equal(one.inTitle, true);
    assert.equal(one.matches, 4, 'the title, and three lines including the heading');
    assert.deepEqual(one.hits.map((h) => h.line), [1, 3, 4]);
    assert.match(one.hits[1].text, /the person merges/);
    //MOST SAID FIRST.
    assert.equal(said.docs[0].name, 'find/one.md');
    assert.match(said.note, /2 page\(s\) say "merge"/);
});

test('deleting is a person\'s press, and it is refused down the pipe', async () => {
    const { actions } = await anApp();
    await actions.call('docWrite', { name: 'gone', text: 'x' });
    for (const mark of ['_overTheWire', '_driven']) {
        await assert.rejects(() => actions.call('docRemove', { name: 'gone', [mark]: true }), /done in the window/, mark);
    }
    assert.ok(fs.existsSync(path.join(dir, 'gone.md')));
    const said = await actions.call('docRemove', { name: 'gone' });
    assert.equal(said.removed, true);
    assert.ok(!fs.existsSync(path.join(dir, 'gone.md')));
});

test('the name rule, on its own', () => {
    assert.equal(docsPlugin.nameOf('readme'), 'readme.md');
    assert.equal(docsPlugin.nameOf('a\\b\\c.md'), 'a/b/c.md');
    assert.equal(docsPlugin.nameOf('./x/./y'), 'x/y.md');
    assert.throws(() => docsPlugin.nameOf(''), /Say which page/);
    assert.equal(docsPlugin.titleOf('intro\n# The Title\nmore', 'x/y.md'), 'The Title');
    assert.equal(docsPlugin.titleOf('no heading', 'x/y.md'), 'y');
});
