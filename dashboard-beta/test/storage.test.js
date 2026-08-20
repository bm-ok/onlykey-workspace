const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

//---------------------------------------------------------------------------
//who is allowed to touch browser storage.
//
//THE RULE THIS PROTECTS. Browser storage may hold WHERE somebody was looking —
//a tab, a pane, the name of the row that was selected — and nothing else. Never
//a token, a key, a password, anything typed into a guarded field, or the
//contents of anything read from the dashboard. Those live in the data
//directory, on the main side, reached only by the process that owns them.
//
//WHY A TEST RATHER THAN A SENTENCE IN A COMMENT. The rule is only worth having
//if there is one place it can be broken, and a pane that reaches localStorage
//directly is a second place — written in good faith, for something small, by
//somebody who never read the comment because it was in a file they had no
//reason to open. Keeping the reach in one plugin means the rule is enforced by
//where the code is, not by whether anybody remembered it.
//
//IT CANNOT CHECK WHAT IS STORED, only who stores it, and that limit is the
//point rather than a weakness: `remember.use('machines', 'picked', ...)` and
//`remember.use('github', 'token', ...)` are indistinguishable to any checker.
//What this buys is that there is exactly one file to read to find out.
//---------------------------------------------------------------------------

const APP = path.join(__dirname, '..', 'src', 'app');

//storage/ IS the wrapper around both stores; remember/ is the only thing built
//on it that keeps anything across restarts.
const MAY = new Set(['storage', 'remember']);

function walk(dir, out = []) {
    for (const name of fs.readdirSync(dir)) {
        if (name.startsWith('_') || name.startsWith('.')) continue;
        //VENDORED CODE IS NOT THIS APP'S. ace and marked happen to touch neither
        //store, which makes this latent rather than live -- and the next library
        //may be less accommodating.
        if (name === 'vendor') continue;
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full, out);
        else if (/\.jsx?$/.test(name)) out.push(full);
    }
    return out;
}

//WHICH PLUGIN A FILE BELONGS TO, AND IT IS NOT rel[0] ANY MORE. Plugins are
//grouped -- src/app/core/storage -- so rel[0] is `core`, and an allow-list keyed
//on it would exempt every plugin in core: http, tray, window, ipc, all of them,
//silently, forever.
//
//THAT IS THE SHAPE OF THIS BUG AND IT IS WHY THE ASSERTION BELOW EXISTS. A guard
//that exempts too much does not fail. It reports an empty list, prints ok, and
//means nothing.
const ENTRY = ['window.js', 'window.jsx', 'server.js', 'main.js'];
function pluginOf(file) {
    let dir = path.dirname(file);
    while (dir.startsWith(APP) && dir !== APP) {
        if (ENTRY.some(n => fs.existsSync(path.join(dir, n)))) return path.basename(dir);
        dir = path.dirname(dir);
    }
    return null;
}

test('only the storage plugins reach localStorage or sessionStorage', () => {
    const wrong = [];
    const seen = new Set();
    for (const file of walk(APP)) {
        const plugin = pluginOf(file);
        if (plugin) seen.add(plugin);
        if (plugin && MAY.has(plugin)) continue;
        const src = fs.readFileSync(file, 'utf8');
        for (const m of src.matchAll(/\b(localStorage|sessionStorage)\b/g)) {
            //A mention inside a comment is somebody explaining the rule, which
            //is the opposite of breaking it.
            const line = src.slice(src.lastIndexOf('\n', m.index) + 1, src.indexOf('\n', m.index));
            if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
            wrong.push(`${path.relative(APP, file)} — ${line.trim()}`);
        }
    }

    //THE EXEMPTION HAS TO HAVE APPLIED TO SOMETHING. If neither name resolved,
    //the allow-list exempted nothing and the empty list below proves nothing.
    for (const name of MAY) {
        assert.ok(seen.has(name),
            'no file under src/app resolved to the "' + name + '" plugin, so this guard exempted nothing and proved nothing');
    }

    assert.deepStrictEqual(wrong, [],
        'these reach browser storage directly, so the rule about what may be kept there has more than one place to be broken:\n  '
        + wrong.join('\n  ')
        + '\n\nUse the `remember` service. It carries the rule.');
});

test('and the plugin that carries the rule is still there', () => {
    //A guard whose subject has been renamed away passes forever and checks
    //nothing. Same reason the class guard asserts its stylesheet exists.
    //FOUND RATHER THAN SPELT OUT. This was a hard-coded src/app/remember path,
    //which makes the check fail when the plugin MOVES -- the one thing it was
    //not asking about.
    const rule = walk(APP).find(f => pluginOf(f) === 'remember' && path.basename(f) === 'window.js');
    assert.ok(rule, 'the remember plugin has no window.js anywhere under src/app — the rule it carries has nowhere to live');
    const src = fs.readFileSync(rule, 'utf8');
    assert.match(src, /ONLY WHERE SOMEBODY WAS LOOKING/,
        'the rule about what may be kept in browser storage is no longer stated in the plugin that enforces it');
});
