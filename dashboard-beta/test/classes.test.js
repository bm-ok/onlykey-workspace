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
const APP = path.join(ROOT, 'app');
const SHEET = path.join(APP, 'theme', 'dashboard.scss');

//AND NOW THERE IS MORE THAN ONE STYLESHEET, which changes what this can check
//into something better.
//
//A pane's own furniture lives in <plugin>/<plugin>.scss and the shared kit lives
//in theme/dashboard.scss. So the question is no longer "does this name exist
//anywhere" but "is this pane allowed to use it" — a pane may reach the shared
//vocabulary and its OWN sheet, and nothing else. Reaching into another pane's
//stylesheet is the leak that makes `theme` unswappable one class at a time, and
//it is invisible to a check that pools every sheet together.
//WHICH PLUGIN A FILE BELONGS TO. The folder holding its window.js, found by
//walking up -- which is the same boundary the three boot files draw, and the
//only one that stays right now that a plugin may be one level down or two.
const ENTRY = ['window.js', 'window.jsx', 'server.js', 'main.js'];
function pluginRootOf(file) {
    let dir = path.dirname(file);
    while (dir.startsWith(APP) && dir !== APP) {
        if (ENTRY.some(n => fs.existsSync(path.join(dir, n)))) return dir;
        dir = path.dirname(dir);
    }
    return null;
}

//A PANE'S OWN SHEET IS <plugin>/<plugin>.scss, AND THE PLUGIN IS NOT rel[0].
//Once the folders are grouped, rel[0] is `repositories` -- and there is no
//repositories.scss, so the old line found nothing and every class in
//changes.scss read as missing.
//
//BUT THE DANGEROUS FIX IS THE ONE THAT KEEPS rel[0] AND POINTS IT AT THE GROUP.
//The rule here is that a pane may reach the shared theme and its OWN sheet,
//nothing else. Key it on the group and the moment a repositories.scss exists,
//every pane in the group may use every sibling's classes -- and this check goes
//on passing while asserting the opposite of what it says.
//
//So walk UP from the file, and stop at the plugin. A helper inside a plugin gets
//its plugin's sheet; nothing gets its group's.
function sheetFor(file) {
    const root = pluginRootOf(file);
    if (!root) return null;
    for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
        const own = path.join(dir, path.basename(dir) + '.scss');
        if (fs.existsSync(own)) return own;
        if (dir === root) return null;
    }
}

//classes the browser or the framework supplies, which are correctly absent
//from a stylesheet this app wrote
const NOT_OURS = new Set([]);

function walk(dir, out = []) {
    for (const name of fs.readdirSync(dir)) {
        if (name.startsWith('_') || name.startsWith('.')) continue;
        //VENDORED CODE IS NOT THIS APP'S MARKUP. A plugin may keep a library it
        //owns in `vendor/` beside its own files — ../src/app/editor/vendor/ace
        //is 900KB of somebody else's, and it names forty classes of its own that
        //ace's own stylesheet defines at run time. Demanding they appear in this
        //app's stylesheet is asking a third party to obey a rule written for
        //panes, and the only way to satisfy it would be to copy forty names into
        //dashboard.scss that nothing here ever writes.
        //
        //The rule this check exists for is "a pane must not invent a class", and
        //a pane is a file this repository wrote. Vendored code is not one.
        if (name === 'vendor') continue;
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
function classesIn(sheet) {
    const css = fs.readFileSync(sheet, 'utf8');
    const found = new Set();
    for (const m of css.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) found.add(m[1]);
    return found;
}
function defined() { return classesIn(SHEET); }

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

    for (const file of walk(APP)) {
        const own = sheetFor(file);
        const mine = own ? classesIn(own) : null;
        for (const [name, where] of used(file)) {
            if (have.has(name)) continue;
            if (mine && mine.has(name)) continue;
            missing.push(`"${name}" in ${path.relative(ROOT, where)}`
                + (own
                    ? ` — not in the theme, and not in ${path.basename(own)} either`
                    : ' — not in the theme, and this plugin has no stylesheet of its own'));
        }
    }

    assert.deepStrictEqual(missing, [],
        'these class names are used and are defined nowhere this plugin may reach, so they will render as nothing:\n  ' +
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
    for (const file of walk(APP)) {
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

//---- a modifier that belongs to a different base -------------------------
//
//THE FAILURE THIS WAS WRITTEN FOR, and it survived every other check here for
//days: the topbar rendered `className="tab on"` while the stylesheet defines
//`.tab.active`. So the tab bar had no current tab — eleven tabs, none of them
//looking chosen — through a dozen screenshots.
//
//Neither existing check could see it. The name check passes because `on` IS a
//class: `.card.on`, `.chip.on`. The self-hiding check passes because `.tab` is
//not display:none on its own. It is a wrong name that happens to be somebody
//else's right name, which is the quietest version of the quietest failure
//available in CSS.
//
//WHAT THIS LOOKS FOR. If the stylesheet ever writes `.base.modifier`, then the
//set of modifiers that mean anything on `.base` is known — so markup putting
//some OTHER known class beside `.base` is almost certainly reaching for one of
//them and missing. `.card pick` is fine because `.card.pick` exists; `.tab on`
//is not, because `.tab.on` does not.
//
//DELIBERATELY NARROW. It says nothing about a base that has no modifiers at
//all, and nothing about a word that is not a class anywhere — the first check
//already covers that. It only speaks where the stylesheet has shown what the
//modifiers on this base are.
function modifiersFor(css) {
    //A BASE IS SOMETHING THE STYLESHEET DRESSES ON ITS OWN. `.tab { ... }`
    //exists, so `.tab.active` is `tab` wearing a modifier. Without that
    //requirement every compound anywhere counts, and `.why.muted` — one rule
    //inside a chat pane — makes `why` a modifier of `muted`, which then fails
    //every `note muted` in the app. That was the first version of this and it
    //reported eighteen faults, none of them real.
    const standalone = new Set();
    for (const m of css.matchAll(/(^|\})\s*\.(-?[A-Za-z_][\w-]*)\s*[{,]/g)) standalone.add(m[2]);

    //FORWARD ONLY. In `.a.b` the base is `a` and the modifier is `b`, and
    //reading it both ways is what made the pairs symmetric and useless.
    const out = new Map();
    for (const m of css.matchAll(/(^|[\s,>~+])\.(-?[A-Za-z_][\w-]*)\.(-?[A-Za-z_][\w-]*)/g)) {
        if (!standalone.has(m[2])) continue;
        if (!out.has(m[2])) out.set(m[2], new Set());
        out.get(m[2]).add(m[3]);
    }
    return out;
}

test('a modifier used on a base is one the stylesheet gives that base', () => {
    //Every sheet, because a pane may modify a shared base from its own file —
    //`.card.snap` lives in machines.scss and `.card` in the theme.
    //EVERY SHEET UNDER src/app, AT WHATEVER DEPTH. This read the top level and
    //joined <name>/<name>.scss, which after the grouping finds exactly nothing:
    //the top level is core, ui, repositories, runners, and none of them has a
    //stylesheet. An empty pool makes `mods` empty and this check inert.
    const sheets = [SHEET];
    (function under(dir) {
        for (const name of fs.readdirSync(dir)) {
            if (name.startsWith('_') || name.startsWith('.') || name === 'vendor') continue;
            const full = path.join(dir, name);
            if (fs.statSync(full).isDirectory()) under(full);
            else if (name.endsWith('.scss') && full !== SHEET) sheets.push(full);
        }
    })(APP);
    assert.ok(sheets.length >= 7,
        'fewer stylesheets were found than there are on disk, so the scan is not reaching into the groups');
    const css = sheets.map(f => fs.readFileSync(f, 'utf8')).join('\n');
    const mods = modifiersFor(css);
    const known = classesIn(SHEET);
    for (const s of sheets) for (const c of classesIn(s)) known.add(c);

    assert.ok(mods.size > 5, 'no compound selectors were found at all, so this check is inert');

    const wrong = [];
    for (const file of walk(APP)) {
        const src = fs.readFileSync(file, 'utf8');
        //ONLY THE PLAIN `className="a b"` FORM, for the same reason the
        //self-hiding check limits itself to it: in `className={...}` the pieces
        //come from separate literals and nothing here can tell which of them
        //end up on one element.
        for (const m of src.matchAll(/className\s*=\s*"([^"]*)"/g)) {
            const words = String(m[1]).split(/\s+/).filter(Boolean);
            if (words.length < 2) continue;
            for (const base of words) {
                const allowed = mods.get(base);
                if (!allowed) continue;
                for (const other of words) {
                    if (other === base) continue;
                    if (allowed.has(other)) continue;
                    //Not a class anywhere, so it is the first check's business.
                    if (!known.has(other)) continue;
                    //Something that is itself a base with its own modifiers is
                    //a second thing on the element, not a modifier of the first.
                    if (mods.has(other)) continue;
                    wrong.push(`"${m[1]}" in ${path.relative(ROOT, file)} — "${other}" is not a modifier of "${base}"; it gives ${[...allowed].map(x => '"' + x + '"').join(', ')}`);
                }
            }
        }
    }

    assert.deepStrictEqual(wrong, [],
        'these pair a base class with a modifier that belongs to something else, so the modifier does nothing:\n  ' + wrong.join('\n  '));
});
