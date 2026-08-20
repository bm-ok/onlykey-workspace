const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

//every class name the window uses has to exist in the stylesheet.
//
//WHY THIS IS THE ONE TEST WORTH HAVING BEFORE ANY MORE TABS ARE WRITTEN. CSS
//has no undefined-name error. A misspelt class is not a crash, not a warning
//and not a blank screen — it is markup that renders, passes every other check,
//and looks dead. The app this is a port of paid for that already: task cards
//were given `picked` when the stylesheet has `pick` and `on`, and the result
//was a list that worked perfectly and looked broken.
//
//It matters more here than it did there. Over there one person wrote the panes
//one at a time against a vocabulary they were building. Here the vocabulary is
//inherited whole — ninety-odd names carried across from ui.css — and whoever
//writes the next tab is guessing at names somebody else chose.
//
//WHAT IT CANNOT SEE, said plainly so nobody trusts it further than it goes:
//a class assembled at runtime from a value this file cannot read — `kind` on a
//Badge, say — is invisible to it. Only literal text is checked. That is still
//most of it, and the alternative is checking nothing.

const ROOT = path.join(__dirname, '..', 'src');
const SHEET = path.join(ROOT, 'app', 'theme', 'dashboard.scss');

//classes the browser or the framework supplies, which are correctly absent
//from a stylesheet this app wrote
const NOT_OURS = new Set([]);

function walk(dir, out = []) {
    for (const name of fs.readdirSync(dir)) {
        if (name.startsWith('_') || name.startsWith('.')) continue;
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) walk(full, out);
        else if (/\.(jsx?|tsx?)$/.test(name)) out.push(full);
    }
    return out;
}

//every `.thing` in the stylesheet. A superset of what is really defined —
//it would count a class named inside a comment — which errs toward letting
//something through rather than failing a name that is genuinely there.
function defined() {
    const css = fs.readFileSync(SHEET, 'utf8');
    const found = new Set();
    for (const m of css.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) found.add(m[1]);
    return found;
}

//`className="a b"` and `className={ anything }` — from the second, every
//string literal inside it, because that is the part a person typed.
function used(file) {
    const src = fs.readFileSync(file, 'utf8');
    const out = new Map();

    const add = (text, where) => {
        for (const word of String(text).split(/\s+/)) {
            const name = word.trim();
            if (!name || NOT_OURS.has(name)) continue;
            if (!/^-?[A-Za-z_][\w-]*$/.test(name)) continue;//an interpolated fragment
            if (!out.has(name)) out.set(name, where);
        }
    };

    for (const m of src.matchAll(/className\s*=\s*"([^"]*)"/g)) add(m[1], file);

    //className={ ... } — take the braces' contents and pull the literals out
    for (const m of src.matchAll(/className\s*=\s*\{/g)) {
        let i = m.index + m[0].length;
        let depth = 1;
        const start = i;
        while (i < src.length && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            i++;
        }
        const expr = src.slice(start, i - 1);
        for (const lit of expr.matchAll(/'([^']*)'|"([^"]*)"|`([^`$]*)`/g)) {
            add(lit[1] ?? lit[2] ?? lit[3], file);
        }
    }

    return out;
}

test('every class the window uses exists in the stylesheet', () => {
    const have = defined();
    const missing = [];

    for (const file of walk(path.join(ROOT, 'app'))) {
        for (const [name, where] of used(file)) {
            if (!have.has(name)) {
                missing.push(`"${name}" in ${path.relative(ROOT, where)}`);
            }
        }
    }

    assert.deepStrictEqual(missing, [],
        'these class names are used and are not in dashboard.scss, so they will render as nothing:\n  ' +
        missing.join('\n  ') +
        '\n\nCSS has no undefined-name error — markup with a misspelt class works and looks dead.');
});

//---- a class that exists and still shows nothing ---------------------------
//
//THE CHECK ABOVE CANNOT SEE THIS ONE, and it cost an evening. `.pane` is
//`display: none`, and `.pane.active` is `display: block` — so markup that says
//`className="pane"` is correctly spelt, passes every check, and is invisible.
//Ten tabs were built that way before anybody looked at the screen.
//
//It is the same family as a misspelt class and worse to find: a wrong name at
//least looks wrong when you read it. A right name that hides itself reads as
//correct, so the eye slides over it and the search is for a bug in the data.
//
//WHAT IT LOOKS FOR: a class the stylesheet hides on its own and un-hides only
//when paired with a modifier. Using the bare one is then almost certainly a
//mistake, and the failure names the modifier that was meant.
function hidesItself(css) {
    const out = new Map();
    //`.x { ... display: none ... }` — one class, on its own
    for (const m of css.matchAll(/(^|\})\s*\.(-?[A-Za-z_][\w-]*)\s*\{([^}]*)\}/g)) {
        if (/display:\s*none/.test(m[3])) out.set(m[2], new Set());
    }
    //`.x.y { ... display: something-else ... }` — y is what brings x back
    for (const m of css.matchAll(/(^|\})\s*\.(-?[A-Za-z_][\w-]*)\.(-?[A-Za-z_][\w-]*)\s*\{([^}]*)\}/g)) {
        if (!out.has(m[2])) continue;
        if (/display:\s*(?!none)/.test(m[4])) out.get(m[2]).add(m[3]);
    }
    //only the ones that can actually be brought back
    for (const [name, mods] of out) if (!mods.size) out.delete(name);
    return out;
}

test('a class that hides itself is never used without what un-hides it', () => {
    const css = fs.readFileSync(SHEET, 'utf8');
    const hidden = hidesItself(css);
    assert.ok(hidden.size, 'no self-hiding classes were found at all, so this check is inert');

    const wrong = [];
    for (const file of walk(path.join(ROOT, 'app'))) {
        const src = fs.readFileSync(file, 'utf8');
        //ONLY THE PLAIN `className="a b"` FORM. In `className={...}` the pieces
        //are assembled from separate literals and this cannot tell which end up
        //on the same element — claiming otherwise would be a check that reports
        //on something it did not read.
        for (const m of src.matchAll(/className\s*=\s*"([^"]*)"/g)) {
            const words = new Set(String(m[1]).split(/\s+/).filter(Boolean));
            for (const word of words) {
                const mods = hidden.get(word);
                if (!mods) continue;
                if ([...mods].some(mod => words.has(mod))) continue;
                wrong.push(`"${m[1]}" in ${path.relative(ROOT, file)} — "${word}" is display:none on its own; add ${[...mods].map(x => '"' + x + '"').join(' or ')}`);
            }
        }
    }

    assert.deepStrictEqual(wrong, [],
        'these render nothing, despite every class name in them existing:\n  ' + wrong.join('\n  '));
});

test('and the stylesheet it checks against is actually there', () => {
    //A GUARD THAT CANNOT FIND THE STYLESHEET WOULD PASS EVERYTHING. `defined()`
    //returning an empty set makes every class missing, which fails loudly — but
    //a future version that skipped the check on a missing file would go quiet
    //and stay quiet. This says the ground is where it is expected.
    assert.ok(fs.existsSync(SHEET), 'the stylesheet this checks against is missing: ' + SHEET);
    assert.ok(defined().size > 50, 'the stylesheet parsed to fewer classes than it should have — the check would be toothless');
});
