const { test } = require('node:test');
const assert = require('node:assert');

const Watching = require('../../src/app/core/okc/watching');

//---------------------------------------------------------------------------
//the bookkeeping behind "tell me only when it changes".
//
//WHAT IS ACTUALLY BEING CLAIMED, and each of these is a way for a push model to
//be quietly worse than the polling it replaced:
//
//  * an unchanged answer sends nothing. That is the whole point, and it is the
//    one thing that is invisible when it breaks — a watch that sends every time
//    behaves exactly like the polling it replaced, only now the server is
//    paying for the timer as well.
//  * a slow action does not pile up. Three seconds of work on a two-second
//    cadence, dispatched every two seconds, is a queue that becomes the app.
//  * a socket that goes away takes its watches with it. This page reloads on
//    every hot update, so sockets come and go constantly.
//  * a failure does not overwrite the last good fingerprint, or the pane is
//    never told that the thing recovered.
//---------------------------------------------------------------------------

//A CLOCK THAT ONLY MOVES WHEN A TEST SAYS SO. Timing tested against a real one
//is timing tested slowly and flakily.
function clock(start) {
    let t = start || 1000;
    return { now: () => t, tick: (ms) => { t += ms; return t; } };
}

function aWatch(over) {
    return Object.assign({ id: 'pane-1', action: 'prCuts', args: {}, everyMs: 5000 }, over || {});
}

test('a watch is of a named action, asked for by an id of the asker\'s own', () => {
    const w = Watching();
    assert.throws(() => w.add('sock', { id: 'x' }), /none was named/);
    assert.throws(() => w.add('sock', { action: 'prCuts' }), /needs an id/);
});

test('too fast is slowed down rather than refused', () => {
    //A PANE ASKING FOR FIFTY MILLISECONDS IS ASKING FOR SOMETHING REASONABLE TOO
    //EAGERLY. Dropping the watch would leave it with no data at all.
    const w = Watching({ floor: 1000 });
    assert.equal(w.add('s', aWatch({ everyMs: 50 })).everyMs, 1000);
    assert.equal(w.add('s', aWatch({ id: 'b', everyMs: 0 })).everyMs, 5000, 'no cadence should fall back to the usual one');
    assert.equal(w.add('s', aWatch({ id: 'c', everyMs: 20000 })).everyMs, 20000, 'a slow cadence was overridden');
});

//---------------------------------------------------------------------------
//THE FIRST CHECK IS ONE CADENCE AWAY, NOT IMMEDIATELY.
//
//The pane has just read the answer itself — that is what it is watching FROM.
//Starting due means every mount costs an extra call for something the page
//already has, and with forty panes that is forty calls on every tab switch.
//---------------------------------------------------------------------------
test('a new watch is not due the moment it is made', () => {
    const c = clock();
    const w = Watching({ now: c.now });
    w.add('s', aWatch({ everyMs: 5000 }));

    assert.equal(w.due().length, 0, 'it asked immediately for an answer the pane had just read');
    c.tick(4999);
    assert.equal(w.due().length, 0);
    c.tick(1);
    assert.equal(w.due().length, 1, 'it never came due');
});

//---------------------------------------------------------------------------
//THE CLAIM THE WHOLE THING RESTS ON.
//---------------------------------------------------------------------------
test('the same answer twice sends nothing the second time', () => {
    const c = clock();
    const w = Watching({ now: c.now });
    const it = w.add('s', aWatch());

    const answer = { cuts: [{ source: 'a', landed: true }], note: '26 cuts' };

    c.tick(5000);
    assert.equal(w.answered(it, answer).changed, true, 'the first answer was not treated as news');
    assert.equal(w.answered(it, answer).changed, false, 'an identical answer was sent again — this is polling with extra steps');
    assert.equal(w.answered(it, JSON.parse(JSON.stringify(answer))).changed, false,
        'an equal answer built separately read as different, so nothing would ever be quiet');
});

test('a pane that says what it already has is not told it again', () => {
    const c = clock();
    const w = Watching({ now: c.now });
    const answer = { cuts: [], note: 'nothing' };

    //THE PANE READ IT ITSELF AND HANDS OVER THE FINGERPRINT, so the first check
    //is silent. Without this every pane gets one pointless update on mount.
    const it = w.add('s', aWatch({ hash: Watching().hashOf(answer) }));
    assert.equal(w.answered(it, answer).changed, false, 'the first check told the pane what it already had');
});

test('a changed answer is news, and so is going back to the old one', () => {
    const w = Watching();
    const it = w.add('s', aWatch({ hash: Watching().hashOf({ n: 1 }) }));

    assert.equal(w.answered(it, { n: 1 }).changed, false);
    assert.equal(w.answered(it, { n: 2 }).changed, true);
    assert.equal(w.answered(it, { n: 2 }).changed, false);
    assert.equal(w.answered(it, { n: 1 }).changed, true, 'going back to a previous answer is still a change to whoever is looking');
});

test('null, undefined and missing are three different answers', () => {
    const h = Watching().hashOf;
    assert.notEqual(h(null), h(undefined));
    assert.notEqual(h(undefined), h(''));
    assert.notEqual(h(null), h({}));
    assert.equal(h(null), h(null));
});

//---------------------------------------------------------------------------
//A SLOW ACTION MUST NOT PILE UP.
//---------------------------------------------------------------------------
test('a watch that is already out is not dispatched again', () => {
    const c = clock();
    const w = Watching({ now: c.now });
    const it = w.add('s', aWatch({ everyMs: 2000 }));

    c.tick(2000);
    assert.equal(w.due().length, 1);
    w.started(it, c.now());

    //THREE MORE CADENCES GO BY WHILE IT IS STILL OUT.
    c.tick(2000); assert.equal(w.due().length, 0, 'it dispatched a second copy while the first was still in flight');
    c.tick(2000); assert.equal(w.due().length, 0);
    c.tick(2000); assert.equal(w.due().length, 0);

    w.answered(it, { a: 1 }, c.now());
    assert.equal(w.due().length, 0, 'it came due the instant it answered, with no cadence in between');
    c.tick(2000);
    assert.equal(w.due().length, 1, 'having answered, it never became due again');
});

test('a failure lets it be asked again, and keeps the last good fingerprint', () => {
    const c = clock();
    const w = Watching({ now: c.now });
    const it = w.add('s', aWatch({ everyMs: 2000, hash: Watching().hashOf({ ok: true }) }));

    c.tick(2000);
    w.started(it, c.now());
    w.failed(it, c.now());

    c.tick(2000);
    assert.equal(w.due().length, 1, 'a watch whose action failed was never asked again');

    //AND THE RECOVERY IS NEWS ONLY IF IT DIFFERS FROM THE LAST GOOD ANSWER.
    assert.equal(w.answered(it, { ok: true }).changed, false,
        'the failure overwrote the fingerprint, so the pane was sent an answer it already had');
});

//---------------------------------------------------------------------------
//SOCKETS COME AND GO CONSTANTLY HERE — the page reloads on every hot update.
//---------------------------------------------------------------------------
test('a socket going away takes its watches and nobody else\'s', () => {
    const w = Watching();
    w.add('sock-a', aWatch({ id: '1' }));
    w.add('sock-a', aWatch({ id: '2' }));
    w.add('sock-b', aWatch({ id: '1' }));
    assert.equal(w.count(), 3);

    assert.equal(w.dropAll('sock-a'), 2);
    assert.equal(w.count(), 1, 'it took a watch belonging to another window');
    assert.equal(w.dropAll('nobody'), 0);
});

test('two windows watching the same thing are two watches', () => {
    const w = Watching();
    w.add('sock-a', aWatch({ id: 'pane-1' }));
    w.add('sock-b', aWatch({ id: 'pane-1' }));
    assert.equal(w.count(), 2, 'one window\'s watch stood in for another\'s, so only one of them would ever be told');
});

test('the same pane asking again replaces its watch rather than adding one', () => {
    const w = Watching();
    w.add('s', aWatch({ id: 'pane-1', args: { repo: 'one' } }));
    w.add('s', aWatch({ id: 'pane-1', args: { repo: 'two' } }));
    assert.equal(w.count(), 1, 'a re-mounted pane left its old watch running');
});

test('a re-asked watch does not keep the old question\'s fingerprint', () => {
    const w = Watching();
    const first = w.add('s', aWatch({ id: 'p', args: { repo: 'one' } }));
    w.answered(first, { repo: 'one', branches: 3 });

    //THE PANE NOW WATCHES A DIFFERENT REPOSITORY. If the old hash survived, an
    //answer that happens to differ from the WRONG question's answer decides
    //whether this one is sent.
    const second = w.add('s', aWatch({ id: 'p', args: { repo: 'two' } }));
    assert.equal(w.answered(second, { repo: 'two', branches: 9 }).changed, true);
});

test('dropping one leaves the rest', () => {
    const w = Watching();
    w.add('s', aWatch({ id: '1' }));
    w.add('s', aWatch({ id: '2' }));
    assert.equal(w.drop('s', '1'), true);
    assert.equal(w.drop('s', '1'), false, 'dropping the same watch twice reported doing something');
    assert.equal(w.count(), 1);
});

//---------------------------------------------------------------------------
//AN ANSWER FOR A PANE THAT HAS GONE.
//
//Ordinary: somebody changed tab while the answer was in flight.
//---------------------------------------------------------------------------
test('an answer arriving after the pane went away is nobody\'s to send', () => {
    const w = Watching();
    const it = w.add('s', aWatch());
    w.drop('s', 'pane-1');

    const said = w.answered(it, { a: 1 });
    assert.equal(said.gone, true);
    assert.equal(said.changed, false, 'it wanted to send an answer to a pane that is not there');
    assert.equal(w.failed(it).gone, true);
});

//---------------------------------------------------------------------------
//AND THE COUNTER THAT SAYS WHETHER ANY OF THIS IS WORKING.
//
//Nine hundred checks and four sends is this doing its job. Nine hundred and nine
//hundred is a watch on something that is never the same twice — which is worth
//finding, and is invisible from anywhere else.
//---------------------------------------------------------------------------
test('checks and sends are counted apart, because the gap between them is the point', () => {
    const w = Watching();
    const it = w.add('s', aWatch({ hash: Watching().hashOf({ n: 1 }) }));

    w.answered(it, { n: 1 });
    w.answered(it, { n: 1 });
    w.answered(it, { n: 2 });
    w.answered(it, { n: 2 });

    const row = w.about()[0];
    assert.equal(row.checks, 4);
    assert.equal(row.sent, 1, 'it sent ' + row.sent + ' of 4 — an unchanging board is not staying quiet');
    assert.equal(row.action, 'prCuts');
});
