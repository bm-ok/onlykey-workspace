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

//---------------------------------------------------------------------------
//A FOLDER MAY BE A PLUGIN *AND* A GROUP, AND THIS IS WHAT MAKES THAT SAFE.
//
//THE RULE THIS REPLACES SAID IT MAY NOT, and gave a reason that does not hold:
//"a folder with a plugin file AND plugin folders inside it would be matched at
//both depths and registered twice". It would not. `./a/window.js` and
//`./a/b/window.js` are two different keys, each yielded once by
//require.context, and neither can match the other's branch of the pattern —
//`[^/]*` cannot cross a slash, so the one-level branch cannot reach a file two
//levels down.
//
//WHAT THE RULE WAS ACTUALLY PROTECTING was a moment when the boundary between
//`core` and the platform underneath it had not been worked out, and banning the
//shape was cheaper than being sure about it. That is settled now, so the ban
//goes and the PROPERTY it was standing in for is asserted directly.
//
//WHICH IS THE STRONGER TEST ANYWAY. The old one banned a shape; this one checks
//the thing that would actually hurt — that no file is selected twice, by any of
//the loaders, whatever the shape. It would catch a real double-registration
//arriving by a route nobody predicted, which is the only kind that turns up.
//---------------------------------------------------------------------------
test('a group that is also a plugin loads each of its files exactly once', () => {
    const all = keys();

    for (const [boot, entry] of BOOTS) {
        const re = regexIn(boot);
        const hit = all.filter(k => re.test(k));

        //NO KEY TWICE. `keys()` walks the disk, so a repeated entry here would
        //mean one FILE selected under two names — the failure the old rule
        //named, checked rather than assumed.
        assert.deepStrictEqual(hit.filter((k, i) => hit.indexOf(k) !== i), [],
            boot + ' selects the same file more than once');

        //AND NO TWO KEYS THAT ARE THE SAME PLUGIN. A folder holding both
        //`window.js` and `nested/window.js` is fine; the same plugin reachable
        //as `./a/window.js` and `./a/./window.js` would not be.
        const seen = hit.map(k => k.replace(/\/+/g, '/'));
        assert.deepStrictEqual(seen.filter((k, i) => seen.indexOf(k) !== i), [],
            boot + ' has two spellings of one path');

        assert.ok(hit.length > 0, boot + ' selected nothing at all, so this proves nothing');
        //the entry file is the one being looked for, and nothing else
        for (const k of hit) {
            assert.ok(k.endsWith('/' + entry) || k.endsWith('/window.jsx'),
                boot + ' selected ' + k + ', which is not a ' + entry);
        }
    }
});

//AND THE SHAPE IS NOW LEGAL, said out loud so that removing it again is a
//decision rather than a tidy-up. `repositories` is the first: it registers the
//tab and owns the furniture its panes share, and the panes are folders inside.
test('a folder that is both is loaded as both', () => {
    const ENTRY = ['window.js', 'window.jsx', 'server.js', 'main.js'];
    const both = [];
    for (const name of fs.readdirSync(APP)) {
        const dir = path.join(APP, name);
        if (!fs.statSync(dir).isDirectory() || !scanned(name)) continue;
        if (!ENTRY.some(e => fs.existsSync(path.join(dir, e)))) continue;
        for (const inner of fs.readdirSync(dir)) {
            const sub = path.join(dir, inner);
            if (!fs.statSync(sub).isDirectory() || !scanned(inner)) continue;
            if (ENTRY.some(e => fs.existsSync(path.join(sub, e)))) both.push(name + '/' + inner);
        }
    }

    //Nothing is asserted about how many there are — none is a fine answer. What
    //is asserted is that each one the regexes can see, they DO see: a folder
    //that is both must not lose its own entry file to its children.
    const win = regexIn('window.js');
    for (const pair of both) {
        const parent = pair.split('/')[0];
        const at = path.join(APP, parent);
        for (const e of ['window.js', 'window.jsx']) {
            if (!fs.existsSync(path.join(at, e))) continue;
            assert.ok(win.test('./' + parent + '/' + e),
                parent + ' is a plugin holding plugins, and its own ' + e + ' is not selected');
        }
    }
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
