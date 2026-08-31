const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const babel = require('@babel/core');

//---------------------------------------------------------------------------
//THE "What this does" BLOCK, RENDERED RATHER THAN READ.
//
//IT IS UNDER EVERY DIALOG IN THE APP. `ask()` is how this app gates anything
//irreversible, and `plain` is the part that says what the press will do — so a
//mistake here is not one pane being wrong, it is every confirmation in the
//window at once.
//
//AND NO DIALOG CAN BE OPENED FROM THE COMMAND LINE. `windowClick` refuses
//unless the drills are on, and the drills are off for a workspace anybody minds
//— which is the one this is developed against. `okc.js capture` photographs
//what is on screen and cannot put a dialog there. So the choice was between
//rendering this in a test and shipping it read-but-never-run.
//
//THE SOURCE IS JSX, so it is put through babel with the same react preset the
//bundle uses and evaluated as a module. That is the first render test here; the
//rest of the UI is checked by photographing the window, which works for
//everything that a person does not have to press first.
//---------------------------------------------------------------------------

const APP = path.join(__dirname, '..', '..', 'src', 'app');
const AT = path.join(APP, 'ui', 'theme', 'dialog.js');

//THE HOOK COVERS EVERYTHING UNDER src/app, not just the one file: `dialog.js`
//requires `bits.js`, which is JSX as well, and a loader that transforms only
//what it was pointed at fails on the first thing that file imports.
//
//PUT BACK IMMEDIATELY. `npm test` may run these files in one process, and a
//require hook left installed would quietly change how every test after this one
//loads the app.
function load(at) {
    const was = Module._extensions['.js'];
    Module._extensions['.js'] = function (m, filename) {
        if (!filename.startsWith(APP)) return was(m, filename);
        const out = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
            filename: filename,
            babelrc: false,
            configFile: false,
            presets: [['@babel/preset-react', { runtime: 'classic' }]]
        }).code;
        m._compile(out, filename);
    };
    try { return require(at); }
    finally { Module._extensions['.js'] = was; }
}

const { Plain } = load(AT);
const html = (items) => renderToStaticMarkup(React.createElement(Plain, { items }));

test('a list of sentences is still one list of bullets', () => {
    const out = html(['first thing', 'second thing']);
    assert.match(out, /What this does/);
    assert.equal((out.match(/<ul>/g) || []).length, 1, 'the bullets were split across more than one list');
    assert.match(out, /<li>first thing<\/li><li>second thing<\/li>/);
    assert.ok(!/dlg-heading">(?!What this does)/.test(out), 'a heading appeared that nobody asked for');
});

test('a node is a wide bullet, and is never mistaken for a section', () => {
    //THE TRAP THIS TEST EXISTS FOR. A React element IS an object, so a section
    //test written as `typeof p === 'object'` turns every table already being
    //passed as a `plain` entry into an empty heading — silently, because an
    //element with no `heading` renders as nothing at all.
    const table = React.createElement('table', { className: 'kv' },
        React.createElement('tbody', null,
            React.createElement('tr', null, React.createElement('td', null, 'a row'))));

    const out = html(['a sentence', table]);
    assert.match(out, /<li class="wide"><table/, 'the node did not render as a wide bullet');
    assert.match(out, /a row/, 'the contents of the node were dropped');
    assert.equal((out.match(/dlg-heading/g) || []).length, 1, 'the element was treated as a section');
});

test('a section breaks the list, writes its heading, and puts its body under it', () => {
    const out = html([
        'the ordering sentence',
        { heading: 'GitHub: fork sync', body: React.createElement('p', null, 'four forks move') },
        { heading: 'Remote → local', body: React.createElement('p', null, 'six branches fetched') }
    ]);

    assert.match(out, /GitHub: fork sync/);
    assert.match(out, /Remote → local/);
    assert.match(out, /four forks move/);
    assert.match(out, /six branches fetched/);

    //IN THE ORDER THEY WERE GIVEN, which is the whole point of sections: the
    //press does GitHub first and this host second, and a dialog that lists them
    //the other way round describes a sequence that would be wrong to run.
    assert.ok(out.indexOf('GitHub: fork sync') < out.indexOf('Remote'),
        'the sections came out in the wrong order');
    assert.ok(out.indexOf('the ordering sentence') < out.indexOf('GitHub: fork sync'),
        'the bullet that precedes the sections was moved below them');
});

test('a section with no body is a heading and nothing else', () => {
    const out = html([{ heading: 'Nothing to do' }]);
    assert.match(out, /Nothing to do/);
    assert.ok(!/<ul>/.test(out), 'an empty list was left behind where the bullets would have been');
});

test('sentences after a section start a new list rather than rejoining the first', () => {
    const out = html(['before', { heading: 'A section' }, 'after']);
    assert.equal((out.match(/<ul>/g) || []).length, 2,
        'the sentence after the section was folded back into the list above it');
    assert.ok(out.indexOf('before') < out.indexOf('A section'), 'the first bullet moved');
    assert.ok(out.indexOf('A section') < out.indexOf('after'), 'the last bullet moved above its heading');
});
