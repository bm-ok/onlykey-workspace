const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', 'src', 'app');
const ASK = path.join(APP, 'core', 'okc', 'ask.js');

//---------------------------------------------------------------------------
//A PANE MAY ONLY READ WHAT `okc.use` ACTUALLY HANDS BACK.
//
//`okc.use(action, args, everyMs)` returns four things and has returned the same
//four for as long as it has existed. Five call sites across the Repositories tab
//called a fifth, `.now()`, which is not one of them:
//
//    repositories/chassis.js        q.now() after Ask GitHub, and again={q.now}
//    repositories/overview          here.now()
//    repositories/pr/new-pr-cut     blocks.now()
//    repositories/repos             q.now() after a branch move
//
//EVERY ONE OF THEM THREW `now is not a function` AFTER ITS ACTION SUCCEEDED,
//which is the worst place for it: the write landed, the refresh died, and what
//somebody saw was a red error over a change that had in fact been made. "It
//worked though, as it picked one" is exactly how it was reported.
//
//NOTHING COULD HAVE CAUGHT IT. A missing property is `undefined`, calling it is
//a TypeError at the moment of the press, and nothing before that moment — not
//the bundler, not a walk, not a screenshot — knows the difference between a
//method a pane has and one it has invented.
//
//---- what this checks -----------------------------------------------------
//
//THE LIST COMES OUT OF ask.js ITSELF, so it cannot drift from it: add a fifth
//thing to that return and this starts allowing it, and take one away and every
//pane using it fails here rather than in somebody's hands.
//
//IT ONLY FOLLOWS A DIRECT NAME — `var q = okc.use(...)`, then `q.something`.
//A destructured one is already safe, because a name that is not returned
//destructures to undefined and reads as such at the top of the file. This is a
//floor, like every static check in this app, and it is the floor the five call
//sites fell through.
//---------------------------------------------------------------------------

//WHAT ask.js HANDS BACK, read from its own `return` rather than written here.
function whatAskReturns() {
    const text = fs.readFileSync(ASK, 'utf8');

    //THE LAST `return { ... };` IN THE FILE is the hook's own. Taken a line at a
    //time rather than with one pattern over the whole file: the object holds a
    //function, so anything stopping at the first `}` stops inside it — which is
    //what the first version of this did, and it reported that ask.js returns
    //NOTHING, which the inertness check below caught.
    const line = text.split('\n').filter((l) => /^\s*return\s*\{.*\};\s*$/.test(l.trim())).pop();
    assert.ok(line, 'ask.js has no single-line object return — this test cannot know what it hands back');

    //NESTED BRACES REMOVED FIRST, so `again: function () { now.current(); }`
    //contributes `again` and nothing from inside it.
    let flat = line.slice(line.indexOf('{') + 1, line.lastIndexOf('}'));
    let was;
    do { was = flat; flat = flat.replace(/\{[^{}]*\}/g, ''); } while (flat !== was);

    const names = flat.split(',')
        .map((bit) => (bit.split(':')[0] || '').trim())
        .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n));
    return new Set(names);
}

const SKIP = new Set(['vendor', 'tests']);

function windows(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
            if (SKIP.has(e.name)) continue;
            windows(path.join(dir, e.name), out);
            continue;
        }
        if (e.name.endsWith('.js')) out.push(path.join(dir, e.name));
    }
    return out;
}

test('a pane only reads what okc.use hands back', () => {
    const allowed = whatAskReturns();

    //INERTNESS. A list that came back empty would allow everything, silently.
    assert.ok(allowed.size >= 3,
        'only ' + allowed.size + ' name(s) were read out of ask.js — the scan is broken, not the panes');
    assert.ok(allowed.has('again'), 'ask.js no longer returns `again`, which every pane calls');

    const wrong = [];
    let watched = 0;

    for (const file of windows(APP, [])) {
        const text = fs.readFileSync(file, 'utf8');
        const where = path.relative(APP, file).split(path.sep).join('/');

        for (const m of text.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*okc\.use\s*\(/g)) {
            const name = m[1];
            watched++;
            //EVERY READ OF THAT NAME, anywhere in the file. Narrow on purpose:
            //`q.now` and `q.now()` both count, and `q` on its own does not.
            //
            //NOT ONE THAT IS ITSELF A PROPERTY. A pane may name its hook `state`
            //— supervisor/chat.js does — and `talk.state.messages` is then a
            //read of `talk`'s answer, not of `state`'s. Without the lookbehind
            //this reported eleven of those as faults, which would have taught
            //whoever met it to switch the check off.
            for (const use of text.matchAll(new RegExp('(?<![.\\w$])' + name + '\\.([A-Za-z_$][\\w$]*)', 'g'))) {
                if (allowed.has(use[1])) continue;
                wrong.push(where + ': ' + name + '.' + use[1] + '()');
            }
        }
    }

    assert.ok(watched > 20, 'only ' + watched + ' okc.use call(s) were found — the scan is broken, not the panes');

    assert.deepEqual(wrong, [],
        'these read something `okc.use` does not hand back, so they are undefined at the moment of the press '
        + 'and throw AFTER the action they follow has already succeeded. It hands back: '
        + [...allowed].join(', ') + '\n  ' + wrong.join('\n  '));
});
