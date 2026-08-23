const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const makeMeter = require('../../src/app/meter/ledger');
const { fromResult, tallyOf, MOST_ROWS } = require('../../src/app/meter/ledger');

//---------------------------------------------------------------------------
//WHAT HAS BEEN SPENT, AND ON WHOSE SIGN-IN.
//
//THE CLAIM WORTH THE MOST: a row per run, never a running total. Totals are
//computed on the way out, so a row recorded wrongly can be removed and the
//totals are simply right afterwards. A stored total is a number nothing can
//check.
//
//AND THE SECOND: a run with no sign-in on it is still recorded. Losing the SPEND
//is worse than losing the attribution, and it shows as not attributed rather
//than being quietly folded into somebody's total.
//
//AND THE THIRD: nothing here prices anything. `cost` is what the model's own
//result line said, carried through unchanged and null when it did not say — a
//number this app invented would be indistinguishable from one it was told.
//---------------------------------------------------------------------------

const RESULT = (over) => Object.assign({
    type: 'result', num_turns: 12, total_cost_usd: 0.42, duration_ms: 90000,
    usage: {
        input_tokens: 100, output_tokens: 200,
        cache_read_input_tokens: 9000, cache_creation_input_tokens: 50
    }
}, over || {});

let home, clock;

beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'meter-'));
    clock = 0;
});

afterEach(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch (e) { /* gone */ } });

const meter = () => makeMeter({
    file: () => path.join(home, 'state', 'meter.json'),
    now: () => '2026-08-2' + (clock++) + 'T00:00:00Z'
});

//---- what a result line says ------------------------------------------------

test('the CLI\'s field names are known in exactly one place', () => {
    //THE DAY IT RENAMES ONE, this is the only file that is wrong.
    assert.deepEqual(fromResult(RESULT()), {
        turns: 12, cost: 0.42, ms: 90000,
        input: 100, output: 200, cacheRead: 9000, cacheWrite: 50,
        trouble: false
    });
});

test('usage is four numbers, not one', () => {
    //CACHED READS ARE THE BULK OF A LONG BRIEF and are charged differently from
    //fresh input. Added together they make a number that looks like context size
    //and is comparable to nothing.
    const said = fromResult(RESULT());
    assert.equal(said.input, 100);
    assert.equal(said.cacheRead, 9000);
    assert.notEqual(said.input, said.input + said.cacheRead);
});

test('a run that said it went wrong is recorded and marked, not dropped', () => {
    //IT STILL SPENT WHAT IT SPENT.
    assert.equal(fromResult(RESULT({ is_error: true })).trouble, true);
    assert.equal(fromResult(RESULT({ subtype: 'error_during_execution' })).trouble, true);
    assert.equal(fromResult(RESULT()).trouble, false);
});

test('a field the run did not say is null, not zero', () => {
    //ZERO IS A MEASUREMENT and null is the absence of one. A run that reported
    //no cost is not a free run.
    const said = fromResult({ type: 'result' });
    assert.strictEqual(said.cost, null);
    assert.strictEqual(said.turns, null);
    assert.strictEqual(said.input, null);
});

test('and nothing to read is null rather than a row of blanks', () => {
    assert.strictEqual(fromResult(null), null);
    assert.strictEqual(fromResult('a string'), null);
});

//---- one run, one row --------------------------------------------------------

test('a run is recorded against the sign-in it was spent on', () => {
    const m = meter();
    const row = m.record({ key: 'a-worker', machine: 'kit-1', kind: 'task', ref: '#7', result: RESULT() });

    assert.equal(row.key, 'a-worker');
    assert.equal(row.machine, 'kit-1');
    assert.equal(row.kind, 'task');
    assert.equal(row.ref, '#7');
    assert.equal(row.cost, 0.42);
    assert.deepEqual(m.read().length, 1);
});

test('and one with no sign-in is still recorded, showing as not attributed', () => {
    //LOSING THE SPEND IS WORSE THAN LOSING THE ATTRIBUTION.
    const m = meter();
    const row = m.record({ machine: 'kit-1', kind: 'task', result: RESULT() });

    assert.strictEqual(row.key, null);
    assert.equal(row.cost, 0.42);
    assert.equal(m.total().cost, 0.42, 'the spend was lost with the attribution');
    assert.deepEqual(m.byKey().map((k) => k.key), [null]);
});

test('a run with no result line is a row with no numbers, not no row', () => {
    //A RUN THAT COULD NOT AUTHENTICATE often has no result line at all, and the
    //fact that it happened is worth keeping.
    const m = meter();
    const row = m.record({ key: 'a-worker', kind: 'task' });

    assert.strictEqual(row.cost, null);
    assert.strictEqual(row.turns, null);
    assert.equal(m.read().length, 1);
});

test('what a run was about is kept short, because it is somebody\'s title', () => {
    const m = meter();
    const row = m.record({ key: 'a', kind: 'task', about: 'x'.repeat(500) });
    assert.equal(row.about.length, 200);
});

test('the kind is a plain string, because a third one will arrive', () => {
    const m = meter();
    assert.equal(m.record({ kind: 'supervisor' }).kind, 'supervisor');
    assert.equal(m.record({ kind: 'a-new-thing' }).kind, 'a-new-thing');
    assert.equal(m.record({}).kind, 'run');
});

//---- totals, computed on the way out -----------------------------------------

test('a total is added up from the rows, never stored', () => {
    //A ROW RECORDED WRONGLY CAN BE REMOVED and the totals are simply right
    //afterwards. A stored total is a number nothing can check.
    const m = meter();
    m.record({ key: 'a', kind: 'task', result: RESULT({ total_cost_usd: 1 }) });
    m.record({ key: 'a', kind: 'task', result: RESULT({ total_cost_usd: 2 }) });

    assert.equal(m.total().cost, 3);
    assert.equal(m.total().runs, 2);

    //NOTHING ON DISK IS A TOTAL.
    const raw = JSON.parse(fs.readFileSync(path.join(home, 'state', 'meter.json'), 'utf8'));
    assert.equal(Array.isArray(raw), true);
    assert.equal(raw.length, 2);
});

test('by key and the total come from one function, so they cannot disagree', () => {
    //THE ONE BUG A SUMMARY SCREEN ALWAYS HAS.
    const m = meter();
    m.record({ key: 'a', kind: 'task', result: RESULT({ total_cost_usd: 1 }) });
    m.record({ key: 'b', kind: 'task', result: RESULT({ total_cost_usd: 2 }) });
    m.record({ key: 'a', kind: 'task', result: RESULT({ total_cost_usd: 4 }) });

    const rows = m.byKey();
    assert.deepEqual(rows.map((r) => r.key), ['a', 'b'], 'the biggest spender is not first');
    assert.equal(rows[0].cost, 5);
    assert.equal(rows[1].cost, 2);
    assert.equal(rows.reduce((n, r) => n + r.cost, 0), m.total().cost);
    assert.equal(rows.reduce((n, r) => n + r.runs, 0), m.total().runs);
});

test('a total of nothing is a shape, not a crash', () => {
    const m = meter();
    assert.deepEqual(m.total().runs, 0);
    assert.strictEqual(m.total().cost, null, 'no runs was reported as having cost zero');
    assert.deepEqual(m.byKey(), []);
});

test('and null costs do not become zeros in a total', () => {
    //"IT SPENT NOTHING" AND "IT DID NOT SAY" are different, and only the second
    //is what a row with no result line means.
    assert.strictEqual(tallyOf([{ at: 'x', cost: null }, { at: 'y', cost: null }]).cost, null);
    assert.equal(tallyOf([{ at: 'x', cost: null }, { at: 'y', cost: 2 }]).cost, 2);
});

test('the total says when the rows it was computed from start and end', () => {
    const m = meter();
    m.record({ key: 'a', kind: 'task' });
    m.record({ key: 'a', kind: 'task' });

    const t = m.total();
    assert.equal(t.first, '2026-08-20T00:00:00Z');
    assert.equal(t.last, '2026-08-21T00:00:00Z');
});

test('and how many of them went wrong', () => {
    const m = meter();
    m.record({ key: 'a', kind: 'task', result: RESULT() });
    m.record({ key: 'a', kind: 'task', result: RESULT({ is_error: true }) });

    assert.equal(m.total().trouble, 1);
    assert.equal(m.total().runs, 2, 'a run that went wrong was not counted as a run');
});

//---- and what it does not lose -------------------------------------------------

test('the newest is first when the whole ledger is read', () => {
    const m = meter();
    m.record({ key: 'first', kind: 'task' });
    m.record({ key: 'second', kind: 'task' });

    assert.deepEqual(m.all().map((r) => r.key), ['second', 'first']);
});

test('a ledger that cannot be read is empty, and the run is still recorded', () => {
    //A METER THAT THROWS would take the run with it — see ./metering, which is
    //built so that bookkeeping never costs work.
    fs.mkdirSync(path.join(home, 'state'), { recursive: true });
    fs.writeFileSync(path.join(home, 'state', 'meter.json'), 'not json at all', 'utf8');

    const m = meter();
    assert.deepEqual(m.read(), []);
    assert.equal(m.record({ key: 'a', kind: 'task' }).key, 'a');
    assert.equal(m.read().length, 1);
});

test('a byte order mark at the front is not a broken ledger', () => {
    //POWERSHELL WRITES ONE, and a whole spending record read as empty because
    //of three bytes is a record silently starting again.
    fs.mkdirSync(path.join(home, 'state'), { recursive: true });
    fs.writeFileSync(path.join(home, 'state', 'meter.json'),
        String.fromCharCode(0xFEFF) + JSON.stringify([{ at: 'x', key: 'a', cost: 1 }]), 'utf8');

    assert.equal(meter().read().length, 1);
});

test('the oldest go first when it is full, and the total says how many it read', () => {
    //TRIMMED FROM THE FRONT, so what is lost is the oldest — and a trim is
    //visible in the count rather than silent.
    const m = meter();
    const many = [];
    for (let i = 0; i < MOST_ROWS + 5; i++) many.push({ at: 'a' + i, key: 'k', cost: 1 });
    fs.mkdirSync(path.join(home, 'state'), { recursive: true });
    fs.writeFileSync(path.join(home, 'state', 'meter.json'), JSON.stringify(many), 'utf8');

    m.record({ key: 'k', kind: 'task' });

    assert.equal(m.read().length, MOST_ROWS);
    assert.equal(m.read()[m.read().length - 1].kind, 'task', 'the newest row was the one trimmed');
});

test('and nothing here ever invents a price', () => {
    //THIS APP DOES NOT KNOW ANYBODY'S RATES, and a number it invented would be
    //indistinguishable from one it was told.
    const m = meter();
    const row = m.record({
        key: 'a', kind: 'task',
        result: RESULT({ total_cost_usd: undefined, usage: { input_tokens: 1000000 } })
    });

    assert.strictEqual(row.cost, null, 'it priced a run from its token count');
});
