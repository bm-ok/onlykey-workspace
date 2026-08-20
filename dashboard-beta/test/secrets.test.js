const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

//---------------------------------------------------------------------------
//what a capture must never carry.
//
//`capture` writes the whole rendered DOM and a picture of the window to /shots,
//with no redaction of any kind. That is unlike every other route to disk in this
//app: the live log stays in memory precisely because command output carries
//sign-in URLs and tokens, and core/events keeps an allowlist of tags and scrubs
//inside them. This one keeps whatever was on screen, verbatim.
//
//TWO THINGS KEEP IT SAFE AND NEITHER IS A DECISION THIS APP MADE.
//
//  1. React sets `value` as a PROPERTY, and `outerHTML` serialises ATTRIBUTES —
//     so a typed value is not in the markup. Measured with a canary typed into a
//     field: zero occurrences in the file. It stops being true for an
//     uncontrolled input or a `defaultValue`, where the attribute IS the value.
//
//  2. The one field a secret is typed into is `type="password"`, so it
//     photographs as dots.
//
//Both are one edit away from silently ending, and the capture that carries the
//token afterwards looks exactly like the ones before it. So they are checked
//here rather than trusted.
//---------------------------------------------------------------------------

const APP = path.join(__dirname, '..', 'src', 'app');

function sources(dir = APP, out = []) {
    for (const name of fs.readdirSync(dir)) {
        if (name === 'vendor' || name.startsWith('.')) continue;
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) sources(full, out);
        else if (/\.jsx?$/.test(name)) out.push(full);
    }
    return out;
}

const rel = (f) => path.relative(APP, f).split(path.sep).join('/');

//COMMENTS ARE NOT CODE, and this file is about what the app DOES. The first
//version of this fired on `debug-snapshot/server.js`, which names `defaultValue`
//in the paragraph explaining why nothing may use one — a guard that cannot tell
//a rule from its own explanation is one somebody switches off.
const code = (f) => fs.readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

//AN UNCONTROLLED INPUT IS WHERE THE VALUE BECOMES AN ATTRIBUTE, which is the one
//shape that puts what somebody typed into every capture from then on.
test('nothing uses defaultValue, which would serialise into a capture', () => {
    const guilty = sources().filter((f) => /\bdefaultValue\b/.test(code(f))).map(rel);

    assert.deepEqual(guilty, [],
        'these make an uncontrolled input, so what is typed becomes an attribute and lands in `capture`');
});

//THE FIELD A SECRET IS TYPED INTO, held to both marks. `password` is what keeps
//it out of the picture; `protect` is what keeps it out of windowFill. They are
//different protections against different things and it needs both.
test('the GitHub token is typed into a password field, and a guarded one', () => {
    const src = fs.readFileSync(path.join(APP, 'github', 'github.js'), 'utf8');

    const field = src.split('\n').find((l) => /name:\s*'token'/.test(l));
    assert.ok(field, 'the token field is gone or renamed — this test is asserting nothing');

    assert.match(field, /type:\s*'password'/,
        'the token field stopped being a password field, so `capture` now photographs it');
    assert.match(field, /protect:\s*true/,
        'the token field stopped being guarded, so windowFill can write a credential into it');
});

//A CAPTURE IS UNPUBLISHED, NOT PROTECTED. It sits in the working tree in
//cleartext; what stops it reaching a commit is one line of .gitignore.
test('captures cannot be committed by accident', () => {
    const ignored = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
    assert.match(ignored, /^\/shots$/m, '/shots is no longer ignored, so captures can be committed');
});
