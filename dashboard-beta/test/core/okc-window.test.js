const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

//---------------------------------------------------------------------------
//ONE WIRE: WHETHER THE PAGE CAN REACH ITS OWN SERVER.
//
//THERE WERE TWO. This app's server also held a local socket to the dashboard
//being ported FROM, reported as `okc:up` and travelling over this one — which
//is why the two were reported as a single boolean for so long without it
//looking wrong, until the day the old app was turned off and the dot went red
//over a window that was working perfectly. That second socket is gone, and the
//tests that told the two apart went with it.
//
//WHAT IS LEFT IS THE DANGEROUS DIRECTION, and it is the reason this file
//exists: a wire that drops emits nothing, so anything that assumes silence
//means "still fine" stays true over a page that can no longer ask anything.
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
        emit(name) { this.sent.push(name); },
        arrives(name, arg) { (handlers.get(name) || []).forEach((fn) => fn(arg)); }
    };
}

async function anOkc(opts) {
    const o = opts || {};
    const fake = aFakeSocket(o.connected);

    delete require.cache[require.resolve(WINDOW_HALF)];
    const plugin = require(WINDOW_HALF);

    let services = null;
    await plugin({ io: fake }, async (_e, s) => { services = s; });
    return { fake, okc: services.okc };
}

//---------------------------------------------------------------------------
//WHAT IS TRUE THE MOMENT THIS PLUGIN LOADS.
//---------------------------------------------------------------------------

test('a wire that was already open before this plugin loaded is not reported as down', async () => {
    //THE GRAPH REACHES THIS PLUGIN AFTER THE SOCKET IS UP, always. Waiting to be
    //told left the dot wrong over a panel that was plainly working.
    const { okc } = await anOkc({ connected: true });
    assert.equal(okc.wire, true);
});

//---------------------------------------------------------------------------
//AND WHAT HAPPENS WHEN ONE GOES.
//---------------------------------------------------------------------------

test('the wire dropping is reported as the wire dropping', async () => {
    const { fake, okc } = await anOkc({ connected: true });
    assert.equal(okc.wire, true);

    fake.arrives('disconnect', 'transport close');
    assert.equal(okc.wire, false, 'the page cannot reach its own server and did not say so');
});

test('and coming back is reported too', async () => {
    const { fake, okc } = await anOkc({ connected: true });
    fake.arrives('disconnect', 'transport close');
    assert.equal(okc.wire, false);

    fake.arrives('connect');
    assert.equal(okc.wire, true, 'the wire came back and the page did not notice');
});

//---------------------------------------------------------------------------
//SUBSCRIBING, WHICH IS HOW THE DOT ACTUALLY LEARNS ANY OF THIS.
//---------------------------------------------------------------------------

test('a subscriber is told what is true now, not only what changes next', async () => {
    const { okc } = await anOkc({ connected: true });

    let wire = null;
    okc.onWire((v) => { wire = v; });

    //MOUNTED AFTER THE FACT IS THE NORMAL CASE — the shell renders once the whole
    //graph is up, which is after the answer arrived.
    assert.equal(wire, true, 'a subscriber that mounted late was told nothing');
});

test('a subscriber hears the wire change, and unsubscribing stops it', async () => {
    const { fake, okc } = await anOkc({ connected: true });

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
    const { fake, okc } = await anOkc({ connected: true });

    const seen = [];
    okc.onWire((v) => seen.push(v));
    fake.arrives('disconnect', 'transport close');
    fake.arrives('disconnect', 'ping timeout');

    assert.deepEqual(seen, [true, false]);
});
