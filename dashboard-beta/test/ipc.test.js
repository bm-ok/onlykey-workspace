const { test } = require('node:test');
const assert = require('node:assert');

const wire = require('../src/app/core/ipc/wire');

//the control socket's greeting. a local socket is unreachable from another
//machine and reachable by everything on this one — a named pipe's default ACL
//grants any account logged in, /tmp is world-readable — and whoever gets through
//drives every machine, every credential and every disk. so: a shared secret,
//before anything else is listened to.

const TOKEN = 'a'.repeat(64);
const REFUSED = 'This needs the token. It is in <somewhere>.';

function aConnection(token) {
    const socket = {
        said: [],
        ended: false,
        write(s) { this.said.push(JSON.parse(s)); },
        end() { this.ended = true; }
    };
    const ran = [];
    const one = wire.connection(socket, {
        token: token === undefined ? TOKEN : token,
        refused: REFUSED,
        run: (line) => ran.push(line)
    });
    return { socket, one, ran };
}

const line = (o) => JSON.stringify(o) + '\n';

//THE ONE THAT TAKES THE APP DOWN. crypto.timingSafeEqual THROWS on a length
//mismatch rather than answering false, so a three-character greeting is not a
//failed comparison — it is an exception on the connection handler.
test('a token of the wrong length is false, and never an exception', () => {
    assert.doesNotThrow(() => wire.sameSecret('abc', TOKEN));
    assert.equal(wire.sameSecret('abc', TOKEN), false);

    assert.doesNotThrow(() => wire.sameSecret('', TOKEN));
    assert.equal(wire.sameSecret('', TOKEN), false);

    assert.doesNotThrow(() => wire.sameSecret(undefined, TOKEN));
    assert.doesNotThrow(() => wire.sameSecret(null, TOKEN));
    assert.doesNotThrow(() => wire.sameSecret({ a: 1 }, TOKEN));
    assert.doesNotThrow(() => wire.sameSecret('x'.repeat(5000), TOKEN));
});

test('the right token is accepted and a wrong one of the same length is not', () => {
    assert.equal(wire.sameSecret(TOKEN, TOKEN), true);
    assert.equal(wire.sameSecret('b'.repeat(64), TOKEN), false, 'any 64 characters were accepted');
    assert.equal(wire.sameSecret('a'.repeat(63) + 'b', TOKEN), false, 'it stopped comparing early');
});

//---------------------------------------------------------------------------
//NOTHING REACHES THE TABLE UNTIL THE GREETING IS ACCEPTED.
//---------------------------------------------------------------------------

const badGreetings = [
    ['no auth at all — straight to a command', line({ id: 1, action: 'vmRemove', args: { name: 'runner1' } })],
    ['a wrong token of the right length', line({ id: 0, auth: 'b'.repeat(64) })],
    ['a short token', line({ id: 0, auth: 'abc' })],
    ['an empty token', line({ id: 0, auth: '' })],
    ['no auth field in the greeting', line({ id: 0 })],
    ['not JSON at all', 'hello there\n']
];

badGreetings.forEach(([what, sent]) => {
    test('refused, and the connection closed: ' + what, () => {
        const { socket, one, ran } = aConnection();
        assert.doesNotThrow(() => one.data(sent));

        assert.equal(ran.length, 0, 'it reached the action table');
        assert.equal(one.trusted, false);
        assert.equal(socket.ended, true, 'the connection was left open to be guessed at');
        assert.equal(socket.said.length, 1, 'it said more than the one sentence');
        assert.equal(socket.said[0].ok, false);
        assert.equal(socket.said[0].error, REFUSED, 'the refusals are not identical — the difference is a hint');
    });
});

//OUR OWN CLIENT PIPELINES ITS COMMAND BEHIND ITS GREETING, so by the time a bad
//greeting is read the command is already in the buffer. Running it would make
//the refusal decorative.
test('a command already in the buffer behind a bad greeting is not run', () => {
    const { socket, one, ran } = aConnection();
    one.data(line({ id: 0, auth: 'b'.repeat(64) }) + line({ id: 1, action: 'vmRemove' }));

    assert.equal(ran.length, 0, 'the pipelined command ran anyway');
    assert.equal(socket.said.length, 1, 'it answered the command it refused to run');
});

test('a good greeting is answered, and then the table is reachable', () => {
    const { socket, one, ran } = aConnection();

    one.data(line({ id: 0, auth: TOKEN }));
    assert.equal(one.trusted, true);
    assert.deepEqual(socket.said[0], { id: 0, ok: true, result: { authed: true } });
    assert.equal(socket.ended, false);

    one.data(line({ id: 1, action: 'status' }));
    assert.equal(ran.length, 1);
    assert.match(ran[0], /"action":"status"/);
});

//SPLIT ACROSS PACKETS IS THE ORDINARY CASE on a socket, and a greeting that only
//works when it arrives whole is one that fails under load rather than never.
test('a greeting split across writes is still one greeting', () => {
    const { one, ran } = aConnection();
    const whole = line({ id: 0, auth: TOKEN }) + line({ id: 1, action: 'status' });

    one.data(whole.slice(0, 20));
    assert.equal(one.trusted, false, 'it trusted half a greeting');
    one.data(whole.slice(20));

    assert.equal(one.trusted, true);
    assert.equal(ran.length, 1);
});

//A TOKEN THE APP NEVER SET is not a reason to let everybody in. Nothing should
//construct this without one, and if something does, the answer is no.
test('a connection with no token to check against accepts nothing', () => {
    const { socket, one, ran } = aConnection('');
    one.data(line({ id: 0, auth: '' }));

    assert.equal(one.trusted, false, 'an empty token opened the socket to everyone');
    assert.equal(ran.length, 0);
    assert.equal(socket.ended, true);
});
