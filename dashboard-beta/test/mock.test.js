const { test } = require('node:test');
const assert = require('node:assert');

const mockPair = require('../src/app/io/mock');

//the mock is what lets the browser run a plugin's server half with nothing on
//the wire, so it has to behave like the socket.io it stands in for.

test('io.on("connection") hands over a socket', async () => {
    const { io } = mockPair();
    const socket = await new Promise((resolve) => io.on('connection', resolve));
    assert.equal(typeof socket.emit, 'function');
    assert.equal(typeof socket.on, 'function');
});

test('emits cross from the server side to the client side', async () => {
    const { io, socket } = mockPair();
    io.on('connection', (s) => s.emit('app', { title: 'mock' }));
    const app = await new Promise((resolve) => socket.once('app', resolve));
    assert.deepEqual(app, { title: 'mock' });
});

test('a client emit reaches a handler registered on the server side', async () => {
    const { io, socket } = mockPair();
    io.on('connection', (s) => s.on('ping', (data, ack) => ack({ pong: true, saw: data })));

    const reply = await new Promise((resolve) => socket.emit('ping', { n: 1 }, resolve));
    assert.deepEqual(reply, { pong: true, saw: { n: 1 } });
});

test('once() only fires once, off() removes a handler', async () => {
    const { io, socket } = mockPair();
    let onceCount = 0, offCount = 0;
    const offHandler = () => offCount++;

    io.on('connection', (s) => {
        socket.once('tick', () => onceCount++);
        socket.on('tick', offHandler);
        s.emit('tick');
        setTimeout(() => { socket.off('tick', offHandler); s.emit('tick'); }, 10);
    });

    await new Promise((r) => setTimeout(r, 60));
    assert.equal(onceCount, 1, 'once fired more than once');
    assert.equal(offCount, 1, 'off did not remove the handler');
});
