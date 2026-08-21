const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

//THE PAGE MUST COME BACK BY ITSELF WHEN THE NODE HALF RELOADS.
//
//core/io/server.js drops every client on reload, and socket.io-client treats a
//disconnect the server ASKED for as final — so without a reconnect here the page
//is orphaned. It does not look orphaned: it stays rendered and reads as healthy
//until you touch something that needs the socket, which is why it presents as an
//intermittent fault when it is in fact every reload, every time.
//
//DRIVEN, NOT READ. Asserting the source contains the right words would pass on a
//handler that reconnects for the wrong reason, or on three copies of it. This
//stands a fake socket in for the real client and watches what the plugin does.

const WINDOW_HALF = path.join(__dirname, '..', '..', 'src', 'app', 'core', 'io', 'window.js');

function aFakeSocket() {
    const handlers = new Map();
    return {
        connects: 0,
        on(name, fn) { handlers.set(name, (handlers.get(name) || []).concat(fn)); },
        once(name, fn) { this.on(name, fn); },
        connect() { this.connects++; },
        //what the client would report, from the outside
        arrives(name, arg) { (handlers.get(name) || []).forEach((fn) => fn(arg)); },
        listeners(name) { return (handlers.get(name) || []).length; }
    };
}

async function aWindow() {
    const fake = aFakeSocket();

    //the page's globals, and socket.io-client stood in for. loaded fresh each
    //time so the stub is the one this run put there.
    global.location = { search: '', origin: 'http://localhost:7317' };
    require.cache[require.resolve('socket.io-client')] = {
        id: 'socket.io-client', filename: 'socket.io-client', loaded: true,
        exports: { io: () => fake }
    };
    delete require.cache[require.resolve(WINDOW_HALF)];
    const plugin = require(WINDOW_HALF);

    let services = null;
    const running = plugin({}, async (_e, s) => { services = s; });
    //the plugin waits for the server to say what the app is
    fake.arrives('app', { title: 'test', name: 'test', version: '0.0.0' });
    await running;

    return { fake, services };
}

test('a disconnect the server asked for is reconnected, because the client will not', async () => {
    const { fake } = await aWindow();
    assert.equal(fake.connects, 0, 'it reconnected before anything went wrong');

    fake.arrives('disconnect', 'io server disconnect');
    assert.equal(fake.connects, 1, 'the page was left orphaned — this is the whole bug');
});

//THE OTHER REASONS ARE THE CLIENT'S OWN JOB, and reconnecting over the top of its
//backoff is how one dropped wire becomes a connection storm.
test('a connection that died under it is left to the client to retry', async () => {
    const { fake } = await aWindow();

    fake.arrives('disconnect', 'transport close');
    fake.arrives('disconnect', 'ping timeout');
    assert.equal(fake.connects, 0, 'it reconnected on top of the client\'s own retry');
});

//REGISTERED EXACTLY ONCE. This fix has been applied twice in one file before —
//interrupted mid-edit and re-applied — and three copies still "work", which is
//how it goes unnoticed: three connect() calls per drop.
test('there is one handler, not a pile of them', async () => {
    const { fake } = await aWindow();
    assert.equal(fake.listeners('disconnect'), 1);

    fake.arrives('disconnect', 'io server disconnect');
    assert.equal(fake.connects, 1, 'more than one copy of the handler is registered');
});
