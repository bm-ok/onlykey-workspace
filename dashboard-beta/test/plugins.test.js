const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

//THE FOUR PLACES THAT DECIDE WHAT A PLUGIN IS, HELD TO ONE ANSWER.
//
//src/window.js, src/server.js and src/main.prod.js each carry a regex over
//require.context; src/main.js walks the folder itself, because the packaged
//build has no src/ to walk. Four implementations of one sentence -- a plugin is
//a folder one level down, or two -- and three chances to disagree.
//
//WHY THIS TEST EXISTS AT ALL. A plugin the regexes stop matching is not an
//error. It is an absence: the tab is not there, the window renders perfectly
//around the hole, and every other check in this directory still passes, because
//every other check reads files rather than asking what got loaded. The only
//thing that knows is the count, and until now nothing was counting.
//
//IT READS THE REGEX OUT OF THE SOURCE rather than restating it here. A copy
//would be a fifth implementation, and the first one to go stale.

const ROOT = path.join(__dirname, '..', 'src');
const APP = path.join(ROOT, 'app');

const BOOTS = [
    ['window.js', 'window.js'],
    ['server.js', 'server.js'],
    ['main.prod.js', 'main.js']
];

//the same rule src/main.js's `scanned` applies, and for the same reasons
function scanned(name) {
    return name[0] != '_' && name[0] != '.' && name != 'vendor';
}

//EVERY PATH UNDER src/app, KEYED THE WAY webpack KEYS A CONTEXT: './a/b.js',
//forward slashes, whatever the platform separator is. The regexes are written
//against these strings, so the test has to build the same ones.
function keys(dir = APP, out = []) {
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) keys(full, out);
        else out.push('./' + path.relative(APP, full).split(path.sep).join('/'));
    }
    return out;
}

//the truth, walked exactly the way src/main.js walks it
function onDisk(entry, dir = APP, left = 2, out = []) {
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (!fs.statSync(full).isDirectory() || !scanned(name)) continue;
        if (fs.existsSync(path.join(full, entry))) {
            out.push('./' + path.relative(APP, path.join(full, entry)).split(path.sep).join('/'));
        }
        if (left > 1) onDisk(entry, full, left - 1, out);
    }
    return out;
}

//the regex as it is actually written in the boot file, not as remembered here
function regexIn(file) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const m = src.match(/require\.context\('\.\/app',\s*true,\s*(\/.+\/)\)/);
    assert.ok(m, file + ' no longer calls require.context in a shape this test can read');
    return eval(m[1]);
}

test('every boot file selects exactly the plugins that are on disk', () => {
    for (const [boot, entry] of BOOTS) {
        const re = regexIn(boot);
        const got = keys().filter(k => re.test(k)).sort();
        const want = onDisk(entry).sort();
        assert.deepStrictEqual(got, want,
            boot + ' selects a different set of ' + entry + ' than the folder walk does');
    }
});

test('window.js accepts .jsx as well, and nothing else does', () => {
    //A STANDING ASYMMETRY, WRITTEN DOWN SO IT IS A DECISION AND NOT A TYPO.
    const win = regexIn('window.js');
    assert.ok(win.test('./repos/window.jsx'), 'the window bundle should take .jsx');
    assert.ok(!regexIn('server.js').test('./repos/server.jsx'), 'the server bundle should not');
});

test('a folder is a plugin or a group, never both', () => {
    //THE RULE THE GROUPING RESTS ON. A folder with a plugin file AND plugin
    //folders inside it would be matched at both depths and registered twice --
    //two `provides` for one name, or a tab that appears in the row twice.
    const ENTRY = ['window.js', 'window.jsx', 'server.js', 'main.js'];
    const both = [];
    for (const name of fs.readdirSync(APP)) {
        const dir = path.join(APP, name);
        if (!fs.statSync(dir).isDirectory() || !scanned(name)) continue;
        const isPlugin = ENTRY.some(e => fs.existsSync(path.join(dir, e)));
        if (!isPlugin) continue;
        for (const inner of fs.readdirSync(dir)) {
            const sub = path.join(dir, inner);
            if (!fs.statSync(sub).isDirectory() || !scanned(inner)) continue;
            if (ENTRY.some(e => fs.existsSync(path.join(sub, e)))) {
                both.push(name + ' is a plugin and also holds the plugin ' + inner);
            }
        }
    }
    assert.deepStrictEqual(both, [], 'these would be loaded twice');
});

test('vendored code is never taken for a plugin', () => {
    //../src/app/ui/editor/vendor/ace ships dozens of files. None is named
    //window.js today; the depth cap and the lookahead are what keep it that way
    //if one ever is.
    for (const [boot] of BOOTS) {
        const re = regexIn(boot);
        const caught = keys().filter(k => re.test(k) && k.includes('/vendor/'));
        assert.deepStrictEqual(caught, [], boot + ' reaches into a vendor folder');
    }
});

test('and it is not counting nothing', () => {
    //EVERY GUARD IN THIS DIRECTORY HAS ONE OF THESE, and a plugin-counting test
    //that counts zero is the most dangerous file here: it would go green through
    //the exact refactor it was written for.
    assert.ok(onDisk('window.js').length > 30,
        'the walk found almost no window.js plugins, so the comparison above proves nothing');
    assert.ok(onDisk('main.js').length > 5, 'nor any main.js plugins');
});

//---------------------------------------------------------------------------
//AND THE FIFTH READING OF THE SAME SENTENCE.
//
//tools/okc.js walks for `cli.js` — how a plugin's answers print at a command
//line. It is a separate program with no plugin graph in it, so it cannot use any
//of the three require.contexts and has its own walk, which makes it the fifth
//place one rule is written down. A printer that is not found is not an error
//either: the answer prints as JSON, exactly as it did before printers existed,
//which is the quietest way for this to stop working.
//---------------------------------------------------------------------------

const CLI = path.join(__dirname, '..', 'tools', 'okc.js');

test('the command line walks for cli.js the same way everything else walks', () => {
    const src = fs.readFileSync(CLI, 'utf8');

    //the rules as they are actually written there, not as remembered here
    assert.match(src, /const DEPTH = 2/, 'the command line no longer stops at two levels');
    assert.match(src, /name\[0\] !== '_' && name\[0\] !== '\.' && name !== 'vendor'/,
        'the command line no longer skips the same folders the others skip');

    const { cliHalves } = require(CLI);
    const found = cliHalves(APP, 2, []).map(f => './' + path.relative(APP, f).split(path.sep).join('/'));
    assert.deepEqual(found.sort(), onDisk('cli.js').sort());
});

test('a printer is never taken from a vendor folder', () => {
    const { cliHalves } = require(CLI);
    for (const f of cliHalves(APP, 2, [])) {
        assert.ok(!f.split(path.sep).includes('vendor'), f + ' came out of a vendor folder');
    }
});

test('and the printers that exist are loadable and shaped right', () => {
    const { cliHalves } = require(CLI);
    const files = cliHalves(APP, 2, []);
    assert.ok(files.length >= 2, 'no cli halves found at all — this test is asserting nothing');

    for (const f of files) {
        const half = require(f);
        assert.equal(typeof half.print, 'object', f + ' exports no printers');
        for (const [name, fn] of Object.entries(half.print)) {
            assert.equal(typeof fn, 'function', f + ' printer for "' + name + '" is not a function');
        }
    }
});
