const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

//---------------------------------------------------------------------------
//A ROW THAT SAYS WHERE TO GO HAS TO NAME SOMEWHERE THAT EXISTS.
//
//Every item on the list of things waiting on a person carries a `where`, and
//the pane draws a "Go to X" button from it. An item that cannot say where it is
//is an item somebody has to go and find, which is most of the work the list
//exists to save — and one that names the WRONG place is worse, because it looks
//like it knows.
//
//---- what this is here for ------------------------------------------------
//
//The server used to speak the view ids of the app being ported from — `chat`,
//`repos`, `tasks` — and the window translated them through a table on the way
//to the screen. One entry in that table was `actions: 'Actions'`, a tab this app
//has never had: over there one library serves both workers and judges, here it
//is split across Worker and Judge.
//
//SO EVERY ROW OF THAT KIND DREW A BUTTON THAT DID NOTHING. `shell.go` handed
//`asked` a null reply, and every refusal it makes is `reply && reply(...)`, so a
//tab that does not exist produced no move, no message and no line in the
//console. Two silences stacked on each other, and nothing failed.
//
//BOTH ENDS ARE FIXED — the shell says so now, and the sources name this app's
//tabs directly — and this is what stops the next one. It reads the tab names out
//of the `shell.tab({...})` calls that register them, so it cannot drift from the
//row on the screen.
//
//---- and what it does NOT check -------------------------------------------
//
//THE PANE NAME, because it is not always a literal: ../../src/app/library builds
//it as `capital(type) + 's'`. Checking the half that can be read is worth more
//than checking neither, and the half that cannot is said here rather than
//quietly skipped. `shell.go` refusing out loud is what covers it at run time.
//---------------------------------------------------------------------------

const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'src', 'app');

function walk(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('_') || e.name.startsWith('.') || e.name === 'vendor') continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(full));
        else if (e.name.endsWith('.js') || e.name.endsWith('.jsx')) out.push(full);
    }
    return out;
}

//TWO WAYS A TAB IS REGISTERED, AND READING ONLY ONE MADE A CORRECT ROW LOOK
//WRONG. Most say `shell.tab({ name: 'Queue', ... })` inline; ../../src/app/tests
//builds the object first and passes the variable, because it keeps a reference
//to it. This read the inline form only, found no tab called "Test", and reported
//a destination that has always been right.
//
//A SCAN THAT UNDER-COLLECTS IS WORSE THAN NO SCAN, because it fails on correct
//code and the fix somebody reaches for is to change the code.
function tabNames() {
    const names = new Set();
    for (const file of walk(APP)) {
        const src = fs.readFileSync(file, 'utf8');

        for (const m of src.matchAll(/shell\.tab\(\{[^}]*name:\s*'([^']+)'/g)) names.add(m[1]);

        //`shell.tab(x)` — find what `x` was built from, in the same file.
        for (const m of src.matchAll(/shell\.tab\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
            const built = new RegExp('\\b(?:var|let|const)\\s+' + m[1] + '\\s*=\\s*\\{[^}]*name:\\s*\'([^\']+)\'');
            const found = built.exec(src);
            if (found) names.add(found[1]);
        }
    }
    return names;
}

//EVERY PLACE A SOURCE SAYS "GO HERE". The first argument to `inbox.at(...)` is
//the tab; a ternary between two literals is two answers and both are checked.
function viewsNamed() {
    const found = [];
    for (const file of walk(APP)) {
        const src = fs.readFileSync(file, 'utf8');
        for (const m of src.matchAll(/\binbox\.at\(([^)]*)\)/g)) {
            const first = m[1].split(',')[0];
            for (const q of first.matchAll(/'([^']*)'/g)) {
                found.push({ file: path.relative(ROOT, file), view: q[1] });
            }
        }
    }
    return found;
}

test('every tab an inbox item points at is a tab this app has', () => {
    const tabs = tabNames();
    const named = viewsNamed();

    //TWO WAYS TO FIND NOTHING AND PASS, so both are closed.
    assert.ok(tabs.size >= 10,
        'only ' + tabs.size + ' tabs were read out of the shell.tab calls, so this check is inert');
    assert.ok(named.length > 0,
        'no inbox destinations were found at all, so this check is inert');

    const wrong = named
        .filter((n) => !tabs.has(n.view))
        .map((n) => n.file + ' sends somebody to "' + n.view + '", and the tabs are: '
            + [...tabs].sort().join(', '));

    assert.deepStrictEqual(wrong, [],
        'these draw a "Go to" button for a tab that does not exist:\n  ' + wrong.join('\n  '));
});
