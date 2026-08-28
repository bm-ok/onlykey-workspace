const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const allowed = require('../../src/app/supervisor/allowed');

//---------------------------------------------------------------------------
//EVERY VERB A SUPERVISOR IS OFFERED, AGAINST EVERY VERB THIS APP ANSWERS.
//
//THE ALLOWLIST IS NOT A LIST OF PERMISSIONS. It is the supervisor's whole tool
//list: ../../src/app/vms/provision/scripts/okc-mcp.js builds one MCP tool per
//name on it, so a name here is a tool in front of the model whether or not
//anything implements it.
//
//AND IT WAS CARRIED OVER FROM THE APP BEING PORTED FROM, verb for verb, while
//the verbs themselves were being renamed and split -- `tasks` and `judge` over
//there became `queue`, `worker` and `judge` here. So the list went on offering
//names that were true in the old app and answer nothing in this one.
//
//THE FAILURE IS NOT A REFUSAL, WHICH WOULD BE FINE. `actions.call` tries this
//app and then relays to the old one, so an unported verb fails with "the
//dashboard this relays to is not running" -- a sentence about another program,
//to a model that has no idea another program was ever involved.
//
//FOUND BY A SUPERVISOR PROPOSING A CHANGE TO ITS OWN INSTRUCTIONS. It read its
//tool list, saw `judgementLog`, and wrote a section telling itself to read that
//before concluding anything about an empty judgement -- correct advice, naming
//a tool that answers nothing here. Its check could not have caught it: the tool
//list IS the allowlist, so "no tool it names is missing" was true and useless.
//---------------------------------------------------------------------------

//WHAT THIS APP ANSWERS, read out of the source rather than off a running app,
//so this is a test rather than a probe.
function defined() {
    const APP = path.join(__dirname, '..', '..', 'src', 'app');
    const found = new Set();

    (function walk(at) {
        for (const e of fs.readdirSync(at, { withFileTypes: true })) {
            const here = path.join(at, e.name);
            if (e.isDirectory()) { if (e.name !== 'vendor') walk(here); continue; }
            if (!/\.js$/.test(e.name)) continue;
            const src = fs.readFileSync(here, 'utf8');
            //`actions.define('name'` IS THE ONE WAY A DOOR IS MADE in this app,
            //so one pattern finds all of them.
            src.replace(/actions\.define\(\s*'([a-zA-Z][a-zA-Z0-9]*)'/g, (whole, name) => {
                found.add(name);
                return whole;
            });
            //AND THE ONES BUILT FROM A KIND, which `doors(what, ...)` makes for
            //each of job, prompt and contract.
            src.replace(/actions\.define\(what \+ '([A-Z][a-zA-Z0-9]*)'/g, (whole, tail) => {
                ['job', 'prompt', 'contract'].forEach((k) => found.add(k + tail));
                return whole;
            });
        }
    })(APP);

    return found;
}

function offered() {
    const text = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'supervisor', 'allowed.js'), 'utf8');
    const names = [];
    text.replace(/^ {2}([a-zA-Z]+):/gm, (whole, name) => { names.push(name); return whole; });
    return names;
}

test('the two lists are read at all, so this cannot pass by finding nothing', () => {
    assert.ok(defined().size > 100, 'found ' + defined().size + ' actions in the source');
    assert.ok(offered().length > 40, 'found ' + offered().length + ' verbs on the allowlist');
});

test('every verb a supervisor is offered is one this app answers', () => {
    const here = defined();
    const missing = offered().filter((v) => !here.has(v));

    //A NAME ON THIS LIST IS A TOOL IN THE MODEL'S HANDS. One that answers
    //nothing is worse than one that is absent: absent, it works around it;
    //present, it plans on it, and finds out at the moment it matters.
    assert.deepEqual(missing, [],
        'the supervisor is offered ' + missing.length + ' tool(s) nothing here answers: ' + missing.join(', '));
});

test('and every verb it may call is spelled the way this app spells it', () => {
    //THE TWO THAT WERE RENAMED RATHER THAN LOST, kept as named assertions
    //because the general check above cannot say WHY something is missing —
    //`judgements` became `judgementsFor` and `prComment` became `judgementSay`
    //when the old app's tasks-and-judge split into queue, worker and judge.
    const here = defined();
    assert.ok(here.has('judgementsFor'), 'judgementsFor is what `judgements` became');
    assert.ok(here.has('judgementSay'), 'judgementSay is what `prComment` became');

    assert.equal(allowed.may('judgementsFor'), true);
    assert.equal(allowed.may('judgementSay'), true);
});
