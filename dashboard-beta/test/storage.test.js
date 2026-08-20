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
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full, out);
        else if (/\.jsx?$/.test(name)) out.push(full);
    }
    return out;
}

test('only the storage plugins reach localStorage or sessionStorage', () => {
    const wrong = [];
    for (const file of walk(APP)) {
        const plugin = path.relative(APP, file).split(path.sep)[0];
        if (MAY.has(plugin)) continue;
        const src = fs.readFileSync(file, 'utf8');
        for (const m of src.matchAll(/\b(localStorage|sessionStorage)\b/g)) {
            //A mention inside a comment is somebody explaining the rule, which
            //is the opposite of breaking it.
            const line = src.slice(src.lastIndexOf('\n', m.index) + 1, src.indexOf('\n', m.index));
            if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
            wrong.push(`${path.relative(APP, file)} — ${line.trim()}`);
        }
    }

    assert.deepStrictEqual(wrong, [],
        'these reach browser storage directly, so the rule about what may be kept there has more than one place to be broken:\n  '
        + wrong.join('\n  ')
        + '\n\nUse the `remember` service. It carries the rule.');
});

test('and the plugin that carries the rule is still there', () => {
    //A guard whose subject has been renamed away passes forever and checks
    //nothing. Same reason the class guard asserts its stylesheet exists.
    const rule = path.join(APP, 'remember', 'window.js');
    assert.ok(fs.existsSync(rule), 'src/app/remember/window.js is missing — the rule it carries has nowhere to live');
    const src = fs.readFileSync(rule, 'utf8');
    assert.match(src, /ONLY WHERE SOMEBODY WAS LOOKING/,
        'the rule about what may be kept in browser storage is no longer stated in the plugin that enforces it');
});
