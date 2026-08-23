const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

//---------------------------------------------------------------------------
//TWO WIRES, TWO ANSWERS.
//
//The page has a socket to THIS app's server, and this app's server has a local
//socket to the dashboard being ported FROM. `okc:up` reports the second and
//travels over the first, which is why they were reported as one boolean for so
//long without it looking wrong.
//
//IT MATTERED THE DAY THE OLD APP WAS TURNED OFF. The dot in the corner went red
//over a window that was working perfectly, because "the other app is not there"
//and "this app is not there" were the same value — and the first of those is
//now the ORDINARY state and will be permanently.
//
//THE OTHER DIRECTION IS THE DANGEROUS ONE and is already written down in the
//source: a wire that drops emits nothing, so anything driven by `okc:up` alone
//stays true over a page that can no longer ask anything. Both halves are
//asserted here.
//
//DRIVEN, NOT READ, for the reason ./io-reconnect.test.js gives: asserting the
//source contains the right words passes on a handler that does it for the wrong
//reason, or on three copies of it.
//---------------------------------------------------------------------------

const WINDOW_HALF = path.join(__dirname, '..', '..', 'src', 'app', 'core', 'okc', 'window.js');

function aFakeSocket(connected) {
    const handlers = new Map();
    return {
        connected: !!connected,
        sent: [],
        on(name, fn) { handlers.set(name, (handlers.get(name) || []).concat(fn)); },
        emit(name, args, reply) {
            this.sent.push(name);
            //THE SERVER ANSWERS `okc:up?` ONLY IF THIS TEST SAYS IT DOES. Left
            //unanswered it stands in for a server that never replies, which is
            //what a dropped wire actually looks like from here.
            if (this.answers !== undefined && name === 'okc:up?' && typeof reply === 'function') {
                reply(this.answers);
            }
        },
        arrives(name, arg) { (handlers.get(name) || []).forEach((fn) => fn(arg)); }
    };
}

async function anOkc(opts) {
    const o = opts || {};
    const fake = aFakeSocket(o.connected);
    if (o.answers !== undefined) fake.answers = o.answers;

    delete require.cache[require.resolve(WINDOW_HALF)];
    const plugin = require(WINDOW_HALF);

    let services = null;
    await plugin({ io: fake }, async (_e, s) => { services = s; });
    return { fake, okc: services.okc };
}

//---------------------------------------------------------------------------
//WHICH WIRE IS WHICH.
//---------------------------------------------------------------------------

test('the two are separate answers, not one', async () => {
    const { okc } = await anOkc({ connected: true, answers: false });

    //THE STATE THE PORT LIVES IN: this app fine, the old one stopped.
    assert.equal(okc.wire, true, 'this app is connected and it said otherwise');
    assert.equal(okc.connected, false, 'the old app is not there and it said it was');
});

test('both up is both up', async () => {
    const { okc } = await anOkc({ connected: true, answers: true });
    assert.equal(okc.wire, true);
    assert.equal(okc.connected, true);
});

test('a wire that was already open before this plugin loaded is not reported as down', async () => {
    //THE GRAPH REACHES THIS PLUGIN AFTER THE SOCKET IS UP, always. Waiting to be
    //told left the dot wrong over a panel that was plainly working — the same
    //bug the `okc:up?` question was added for, one wire along.
    const { okc } = await anOkc({ connected: true, answers: false });
    assert.equal(okc.wire, true);
});

//---------------------------------------------------------------------------
//AND WHAT HAPPENS WHEN ONE GOES.
//---------------------------------------------------------------------------

test('the wire dropping is reported as the wire dropping', async () => {
    const { fake, okc } = await anOkc({ connected: true, answers: true });
    assert.equal(okc.wire, true);

    fake.arrives('disconnect', 'transport close');
    assert.equal(okc.wire, false, 'the page cannot reach its own server and did not say so');
});

test('and it takes the other answer with it, because nothing can tell us any more', async () => {
    //"WE DO NOT KNOW" HAS TO READ AS "NO" for anything a person might act on. A
    //wire that drops emits nothing, so `connected` left alone would stay true
    //over a page that can no longer ask anything — which is exactly how a green
    //dot sat above a window that answered every outside call with "no page is
    //connected".
    const { fake, okc } = await anOkc({ connected: true, answers: true });
    fake.arrives('disconnect', 'transport close');
    assert.equal(okc.connected, false);
});

test('the other app going down leaves this one alone', async () => {
    const { fake, okc } = await anOkc({ connected: true, answers: true });

    fake.arrives('okc:up', false);
    assert.equal(okc.connected, false, 'the old app stopped and it was not noticed');
    assert.equal(okc.wire, true, 'the old app stopping was reported as THIS app being down');
});

test('coming back asks again rather than assuming', async () => {
    const { fake, okc } = await anOkc({ connected: true, answers: true });
    fake.arrives('disconnect', 'transport close');
    fake.sent.length = 0;

    fake.answers = false;
    fake.arrives('connect');

    assert.equal(okc.wire, true);
    assert.ok(fake.sent.includes('okc:up?'), 'it reconnected and never asked about the other app');
    //THE OTHER APP MAY HAVE GONE WHILE THIS WIRE WAS DOWN, so the answer from
    //before the drop is not an answer.
    assert.equal(okc.connected, false);
});

//---------------------------------------------------------------------------
//SUBSCRIBING, WHICH IS HOW THE DOT ACTUALLY LEARNS ANY OF THIS.
//---------------------------------------------------------------------------

test('a subscriber is told what is true now, not only what changes next', async () => {
    const { okc } = await anOkc({ connected: true, answers: false });

    let wire = null;
    let up = null;
    okc.onWire((v) => { wire = v; });
    okc.onUp((v) => { up = v; });

    //MOUNTED AFTER THE FACT IS THE NORMAL CASE — the shell renders once the whole
    //graph is up, which is after every one of these answers arrived.
    assert.equal(wire, true, 'a subscriber that mounted late was told nothing');
    assert.equal(up, false);
});

test('a subscriber hears the wire change, and unsubscribing stops it', async () => {
    const { fake, okc } = await anOkc({ connected: true, answers: true });

    const seen = [];
    const off = okc.onWire((v) => seen.push(v));
    fake.arrives('disconnect', 'transport close');
    off();
    fake.arrives('connect');

    assert.deepEqual(seen, [true, false], 'either it did not report, or it reported after being let go');
});

test('the same value twice is not two events', async () => {
    //THE DOT TRANSITIONS ITS COLOUR. A repeat announcement would restart that
    //animation for nothing, and a subscriber that counts changes would count
    //ones that did not happen.
    const { fake, okc } = await anOkc({ connected: true, answers: true });

    const seen = [];
    okc.onWire((v) => seen.push(v));
    fake.arrives('disconnect', 'transport close');
    fake.arrives('disconnect', 'ping timeout');

    assert.deepEqual(seen, [true, false]);
});
