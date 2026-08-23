const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', 'src', 'app');
const makeBriefing = require(path.join(APP, 'runners', 'runs', 'briefing.js'));
const { briefWith } = makeBriefing;

function briefingWith(files) {
    const on = files || {};
    return makeBriefing({
        readFile: (at) => {
            if (!(at in on)) throw new Error('no such file');
            return on[at];
        },
        exists: (at) => at in on,
        resolve: (p) => '/abs/' + String(p).replace(/^\/+/, ''),
        basename: (p) => String(p).split('/').pop()
    }).rulesFor;
}

//---------------------------------------------------------------------------
//1. TWO DOORS, AND NEVER BOTH.
//---------------------------------------------------------------------------

test('a contract file is read from this host and carried with the task', () => {
    const rulesFor = briefingWith({ '/abs/rules.md': 'be careful' });
    const out = rulesFor({ contract: 'rules.md' });
    assert.equal(out.rules, 'be careful');
    assert.equal(out.named, 'rules.md');
    assert.equal(out.at, '/abs/rules.md');
});

test('the rules themselves are taken as given, and named by what asked', () => {
    const rulesFor = briefingWith({});
    const out = rulesFor({ rules: 'be careful', contractName: 'house rules' });
    assert.equal(out.rules, 'be careful');
    assert.equal(out.named, 'house rules');
    assert.equal(out.at, null);
});

test('both at once is refused rather than one silently winning', () => {
    //WHICH RULES WAS THIS RUN UNDER is the exact question the arrangement exists
    //to answer, and preferring one silently makes the answer depend on which
    //line of code read it first.
    const rulesFor = briefingWith({ '/abs/rules.md': 'from the file' });
    assert.throws(() => rulesFor({ contract: 'rules.md', rules: 'from the text' }),
        /either a contract file or the rules themselves, not both/);
});

test('no rules at all is allowed, and says so plainly', () => {
    //The dangerous one AND the silent one: a run without a contract looks
    //exactly like a run with one from everywhere except here.
    const out = briefingWith({})({});
    assert.equal(out.rules, null);
    assert.equal(out.named, null);
});

//---------------------------------------------------------------------------
//2. EMPTY IS WORSE THAN NONE, AND THE THREE CASES HAVE THREE FIXES.
//---------------------------------------------------------------------------

test('a contract that is not there is refused by its resolved path', () => {
    //By the ABSOLUTE path, because "rules.md" is relative to a working directory
    //the reader may not be in — which is the mistake being reported.
    assert.throws(() => briefingWith({})({ contract: 'rules.md' }),
        /There is no contract at \/abs\/rules\.md.*not from the machine/s);
});

test('a contract file that is empty is refused, and says why that is worse', () => {
    const rulesFor = briefingWith({ '/abs/rules.md': '   \n  ' });
    assert.throws(() => rulesFor({ contract: 'rules.md' }),
        /empty contract is worse than none.*as though rules were applied/s);
});

test('rules given as empty text are refused separately, with their own sentence', () => {
    //A different fix from the two above: nothing is missing from the disk, the
    //caller passed nothing.
    assert.throws(() => briefingWith({})({ rules: '   ' }),
        /The rules are empty.*reports that a contract was applied/s);
});

test('the three refusals are three different sentences', () => {
    //INERTNESS. Collapsing them into one message would pass every assertion
    //above that only checks a throw, while costing the reader the one thing the
    //message is for.
    const said = [];
    const rulesFor = briefingWith({ '/abs/empty.md': '' });
    for (const [what, fixture] of [
        ['missing', { contract: 'gone.md' }],
        ['empty file', { contract: 'empty.md' }],
        ['empty text', { rules: '' }]
    ]) {
        try { rulesFor(fixture); assert.fail(what + ' was not refused'); }
        catch (e) { said.push(e.message); }
    }
    assert.equal(new Set(said).size, 3, 'two refusals say the same thing: ' + said.join(' | '));
});

test('an empty string for the contract is "none", not "a file called nothing"', () => {
    const out = briefingWith({})({ contract: '' });
    assert.equal(out.rules, null);
});

//---------------------------------------------------------------------------
//3. WHAT GOES IN FRONT OF THE TASK.
//---------------------------------------------------------------------------

test('with nothing to announce, the brief is the task and nothing else', () => {
    assert.equal(briefWith(null, 'do the thing'), 'do the thing');
    assert.equal(briefWith('', 'do the thing'), 'do the thing');
});

test('an announcement goes in FRONT, with the task named as the task', () => {
    //So a worker cannot read the warning as part of the brief it is being given.
    const out = briefWith('BEFORE ANYTHING ELSE', 'do the thing');
    assert.ok(out.startsWith('BEFORE ANYTHING ELSE'));
    assert.match(out, /--- the task ---/);
    assert.ok(out.endsWith('do the thing'));
    assert.ok(out.indexOf('--- the task ---') < out.indexOf('do the thing'));
});

test('a task that is not a string is still carried, rather than becoming "undefined"', () => {
    assert.equal(briefWith(null, null), '');
    assert.equal(briefWith(null, 42), '42');
});
