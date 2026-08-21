const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const http = require('node:http');

const express = require('express');
const webpack = require('webpack');
const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');

//builds the real server entry and runs it against a real express + socket.io,
//which is the half nothing else exercises outside nw. the window half needs a
//dom, so it is covered by the app itself, not from here.

const serverConfig = require('../../webpack.config.js')({}, { mode: 'development' })
    .find((c) => c.name == 'server');

let server, ioServer, loaded, url, router;

before(async () => {
    const stats = await new Promise((resolve, reject) => {
        webpack(serverConfig).run((err, s) => (err ? reject(err) : resolve(s)));
    });
    assert.ok(!stats.hasErrors(), stats.toString({ all: false, errors: true }));

    const app = express();
    router = express.Router();
    app.use((req, res, next) => router(req, res, next));

    server = http.createServer(app);
    ioServer = new Server(server);

    const bundle = path.join(serverConfig.output.path, serverConfig.output.filename);
    delete require.cache[require.resolve(bundle)];

    loaded = await require(bundle)({
        express,
        router,
        httpServer: server,
        io: ioServer,
        appPackage: { title: 'Test App', name: 'test-app', version: '9.9.9' }
        //no window and no tray: the plain node case, which is what this test is
    });

    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    url = 'http://127.0.0.1:' + server.address().port;
}, { timeout: 120000 });

after(() => {
    try { ioServer.close(); } catch (e) { /* already gone */ }
    try { server.close(); } catch (e) { /* already gone */ }
});

test('the plugin graph resolves on the server side', () => {
    const services = loaded.app.services;
    for (const name of ['app', 'io', 'appPackage', 'window', 'tray'])
        assert.ok(name in services, 'missing service: ' + name);
});

test('the window half is not in this bundle at all', () => {
    const services = loaded.app.services;
    //react, theme and storage are window.js files, so they are not here to stub
    for (const name of ['react', 'theme', 'session', 'config'])
        assert.ok(!(name in services), name + ' leaked into the server bundle');
});

test('nw services are absent without nw.js, rather than half present', () => {
    const services = loaded.app.services;
    assert.equal(services.window, undefined);
    assert.equal(services.tray, undefined);
});

test('what is mounted on the swappable router is what the app serves', async () => {
    //THIS USED TO ASK THE EXAMPLE PLUGIN FOR /api/hello — the plugin the
    //scaffold's own README says to delete. A test that passes only while a
    //disposable folder is still there is one that breaks the first time
    //somebody follows the instructions, and it broke exactly then.
    //
    //The property is the ROUTER's and not any plugin's: the express app defers
    //to a router held in a variable, so a server half can mount on it and a
    //reload can throw the whole set away rather than stacking another copy of
    //every route on top. That is worth proving whether or not anything happens
    //to be mounting today — and right now nothing is, because the plugin that
    //talks to the dashboard uses socket.io rather than routes.
    router.get('/api/probe', (req, res) => res.json({ mounted: true }));

    const res = await fetch(url + '/api/probe');
    assert.equal(res.status, 200);
    assert.deepStrictEqual(await res.json(), { mounted: true });

    //AND A FRESH ROUTER TAKES THE OLD ONES AWAY, which is the half that
    //actually matters on reload. Without it every save would leave another
    //copy of every route behind, answering in the order they were added.
    router = express.Router();
    assert.equal((await fetch(url + '/api/probe')).status, 404,
        'a route survived the router being swapped, so a reload would stack routes rather than replace them');
});

test('socket.io answers the handshake and the ping', async () => {
    const socket = connect(url, { transports: ['websocket'] });
    try {
        const appPackage = await new Promise((resolve, reject) => {
            socket.once('app', resolve);
            socket.once('connect_error', reject);
        });
        assert.equal(appPackage.title, 'Test App');
        assert.equal(appPackage.version, '9.9.9');

        const reply = await new Promise((resolve) => socket.emit('ping', {}, resolve));
        assert.equal(reply.pong, true);
    } finally {
        socket.close();
    }
});

test('destroy() unhooks the server half so a reload cannot double register', async () => {
    await loaded.destroy();

    const socket = connect(url, { transports: ['websocket'] });
    try {
        const sawApp = await Promise.race([
            new Promise((resolve) => socket.once('app', () => resolve(true))),
            new Promise((resolve) => setTimeout(() => resolve(false), 1500))
        ]);
        assert.equal(sawApp, false, 'handlers survived destroy(), a reload would stack them');
    } finally {
        socket.close();
    }
});
