const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', 'src', 'app');

//---------------------------------------------------------------------------
//A PANE MAY NOT ASK FOR AN ACTION THIS APP DOES NOT HAVE.
//
//`actions.call` tries this app's table first and the pipe to the app being
//ported from second, and that fallback is the whole migration path: a moved
//action takes over the moment it is defined, and everything not yet moved goes
//on working. It is right, and it is why the port can be done a pane at a time.
//
//WHAT IT DOES NOT DO IS REFUSE. An action nobody has ported is not an error
//here — it TRAVELS. So a button wired to a name this app never defined does one
//of two things, and neither of them is nothing:
//
//  the other app is down    "Nothing here answers X", in red, on a press that
//                           looked ordinary
//  the other app is up      it happens. Over there. To the real machines, the
//                           real credentials and the real conversation — under
//                           a dialog naming this app's.
//
//THE SUPERVISOR'S CHAT PANE HAD FOUR OF THEM and every check available was
//green. `chatClear` on a Clear button styled danger and gated behind a protect;
//`chatFrom`, which the old Clear actually calls, missing entirely; `supervisorUp`
//and `supervisorDown` behind Start it and Put it away — one of which starts a
//machine and hands it a credential. A code comment beside two of them said
//"both already exist here", which was written from memory and never checked.
//The pane compiled, drew, walked and photographed perfectly throughout.
//
//---- what this checks -----------------------------------------------------
//
//Every action name a window half asks for by literal — `okc.call('X')` or
//`okc.use('X')` — is defined by some server half in this app.
//
//STATICALLY, AND ON PURPOSE. The running app cannot answer this: ask it for its
//action list with the other app up and the relayed ones are all present, which
//is exactly the state in which the mistake is invisible. The source is the only
//place "this app defines it" and "something answers it" are different questions.
//
//A LITERAL, WHICH IS WHAT MAKES IT CHEAP AND WHAT LIMITS IT. A name assembled
//from a variable is not seen. That is a fair trade — nearly every call site is a
//literal, and the ones that are not are loops over a list of names that are
//themselves literals somewhere — but it means this is a floor rather than a
//proof.
//
//IF SOMETHING HERE GENUINELY SHOULD STILL RELAY, add it to STILL_RELAYED below
//with the reason. An empty list is not a target to protect: it is where the port
//happens to be, and a pane that must call something not yet moved is allowed to
//say so out loud.
//---------------------------------------------------------------------------

//Actions a pane deliberately asks for that this app does not define, each with
//why. Empty today: everything the window asks for is answered here.
const STILL_RELAYED = {};

const SKIP = new Set(['vendor', 'suites']);

function sources(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
            if (SKIP.has(e.name)) continue;
            sources(path.join(dir, e.name), out);
            continue;
        }
        if (e.name.endsWith('.js')) out.push(path.join(dir, e.name));
    }
    return out;
}

function scan() {
    const defined = new Set();
    const asked = new Map();

    for (const file of sources(APP, [])) {
        const text = fs.readFileSync(file, 'utf8');
        const where = path.relative(APP, file).split(path.sep).join('/');

        for (const m of text.matchAll(/actions\.define\(\s*'([A-Za-z0-9_]+)'/g)) defined.add(m[1]);

        //`okc` IS THE WINDOW'S ONE DOOR. A pane consumes it and asks through it;
        //`okc.use` is the polling read and `okc.call` the press, and there is no
        //third way to reach an action from a window half.
        for (const m of text.matchAll(/okc\.(?:call|use)\(\s*'([A-Za-z0-9_]+)'/g)) {
            if (!asked.has(m[1])) asked.set(m[1], new Set());
            asked.get(m[1]).add(where);
        }
    }
    return { defined, asked };
}

test('every action a pane asks for is defined in this app', () => {
    const { defined, asked } = scan();

    //INERTNESS FIRST. A scan that found nothing passes this check while proving
    //nothing at all, and it is the most likely way for it to break: a rename of
    //`actions.define` or of `okc.call` would empty both sets silently.
    assert.ok(defined.size > 100, `only ${defined.size} actions were found defined — the scan is broken, not the app`);
    assert.ok(asked.size > 50, `only ${asked.size} actions were found asked for — the scan is broken, not the app`);

    const travelling = [...asked.keys()]
        .filter((name) => !defined.has(name))
        .filter((name) => !Object.prototype.hasOwnProperty.call(STILL_RELAYED, name))
        .sort();

    assert.deepEqual(travelling, [],
        'these are asked for by a pane and defined nowhere in this app, so the press is relayed to the '
        + 'app being ported from and lands on ITS machines, credentials and records:\n'
        + travelling.map((n) => `  ${n} — ${[...asked.get(n)].join(', ')}`).join('\n'));
});

test('and nothing sits on the relay list that has since been ported', () => {
    //THE LIST IS AN ADMISSION, not a permanent exemption. A name left on it
    //after the action lands here means the next reader believes a press still
    //travels when it does not — and the one after that adds a second entry on
    //the same reasoning.
    const { defined } = scan();
    const stale = Object.keys(STILL_RELAYED).filter((name) => defined.has(name));
    assert.deepEqual(stale, [], 'these are on the relay list and are defined here now — take them off it');
});
