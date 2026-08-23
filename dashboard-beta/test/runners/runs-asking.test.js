const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', 'src', 'app');
const makeAsking = require(path.join(APP, 'runners', 'runs', 'asking.js'));
const { outcomeOf, MARKERS } = makeAsking;

//---------------------------------------------------------------------------
//1. THE TWO GATES, AND THE ORDER THEY ARE IN.
//---------------------------------------------------------------------------

function askingFor(opts) {
    const o = opts || {};
    const asked = [];
    const asking = makeAsking({
        ours: {
            get: (name) => {
                asked.push(name);
                if (o.notOurs) throw new Error('There is no machine called "' + name + '" here.');
                return { name };
            }
        },
        connected: () => o.connected !== false
    });
    return { asking, asked };
}

test('a machine this app did not make is refused before anything is asked of it', () => {
    const { asking, asked } = askingFor({ notOurs: true, connected: true });
    assert.throws(() => asking.reachable('somebody-elses-vm', 'its runs cannot be read'),
        /no machine called/);
    //IT WAS ASKED OF THE REGISTRY, which is the point — the refusal comes from
    //there and not from a list kept here.
    assert.deepEqual(asked, ['somebody-elses-vm']);
});

test('the registry is asked FIRST, so being off never leaks that a machine exists', () => {
    //Not ours AND not dialled in. If the connected check ran first the refusal
    //would say "is not dialled in", which is a statement about a machine this
    //app has no business describing.
    const { asking } = askingFor({ notOurs: true, connected: false });
    assert.throws(() => asking.reachable('somebody-elses-vm', 'its runs cannot be read'),
        (e) => /no machine called/.test(e.message) && !/dialled in/.test(e.message));
});

test('a machine that is ours but off is refused by name, not attempted', () => {
    const { asking } = askingFor({ connected: false });
    assert.throws(() => asking.reachable('kit-1', 'its runs cannot be read'),
        /"kit-1" is not dialled in, so its runs cannot be read\./);
});

test('the refusal carries what was being attempted, because that decides what to do next', () => {
    const { asking } = askingFor({ connected: false });
    assert.throws(() => asking.reachable('kit-1', 'it cannot be given work'),
        /it cannot be given work/);
    assert.throws(() => asking.reachable('kit-1', 'its runs cannot be read'),
        /its runs cannot be read/);
});

test('a machine that is ours and dialled in passes both', () => {
    const { asking } = askingFor({ connected: true });
    assert.doesNotThrow(() => asking.reachable('kit-1', 'anything'));
});

//---------------------------------------------------------------------------
//2. WHICH RUN, ASKED SEPARATELY.
//---------------------------------------------------------------------------

test('no run named is its own refusal, not folded into the machine check', () => {
    const { asking } = askingFor({ connected: true });
    for (const empty of [undefined, null, '', '   ']) {
        assert.throws(() => asking.whichRun(empty), /Say which run\./);
    }
});

test('a run id is trimmed, and a number is taken as one', () => {
    const { asking } = askingFor({ connected: true });
    assert.equal(asking.whichRun('  r-123  '), 'r-123');
    assert.equal(asking.whichRun(7), '7');
});

//---------------------------------------------------------------------------
//3. WHAT THE MACHINE SAID WHEN ASKED TO STOP.
//---------------------------------------------------------------------------

test('each marker the guest can print has one reading', () => {
    assert.deepEqual(outcomeOf('okc-stop-done'), { how: 'stopped', bad: false });
    assert.deepEqual(outcomeOf('okc-stop-gone'), { how: 'was already over', bad: false });
    assert.deepEqual(outcomeOf('okc-stop-nopid'),
        { how: 'never recorded a pid, so nothing could be signalled', bad: false });
    assert.deepEqual(outcomeOf('okc-stop-refused'), { how: 'would not die', bad: true });
});

test('silence is a fault rather than a success', () => {
    //THE ONE THAT MATTERS. Everything downstream reads "stopped" as "the machine
    //is free now"; a machine still running work nobody is watching must never be
    //reported as free. So no-answer is bad, not neutral.
    for (const said of ['', null, undefined, 'some unrelated output']) {
        assert.deepEqual(outcomeOf(said), { how: 'did not answer', bad: true });
    }
});

test('a marker is found in real output, not only on its own line', () => {
    const said = 'stopping r-9\nkilled 3 children\nokc-stop-done\n';
    assert.equal(outcomeOf(said).how, 'stopped');
});

test('being already over is NOT a fault, and neither is a thin record', () => {
    //Refusing these would mean a machine that finished its work on time cannot
    //be handed back — the queue calls stop on the way to putting one away.
    assert.equal(outcomeOf('okc-stop-gone').bad, false);
    assert.equal(outcomeOf('okc-stop-nopid').bad, false);
});

test('every marker is distinct, and every reading is', () => {
    //INERTNESS. A copy-paste that gave two markers the same sentence would make
    //two different outcomes indistinguishable on the board, and every assertion
    //above would still pass.
    assert.equal(new Set(MARKERS.map(m => m[0])).size, MARKERS.length);
    assert.equal(new Set(MARKERS.map(m => m[1])).size, MARKERS.length);
    assert.ok(MARKERS.length >= 4, 'the marker table has been emptied');
});
