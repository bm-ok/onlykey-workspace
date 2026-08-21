const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makeFraming = require('../../src/app/vms/channel/framing');

//---------------------------------------------------------------------------
//newline-delimited JSON, and nothing else.
//
//THE CLAIM WORTH THE MOST: a chunk is not a message. TCP gives you bytes — one
//write can arrive as three chunks and three writes as one, and both happen the
//moment a guest is busy. Anything that reads a chunk as a message works
//perfectly until the machine is under load.
//---------------------------------------------------------------------------

let f;
beforeEach(() => { f = makeFraming(); });

test('one message in one chunk', () => {
    assert.deepEqual(f.take('{"type":"hello"}\n'), { messages: [{ type: 'hello' }] });
});

test('three messages arriving as one chunk are three messages', () => {
    const { messages } = f.take('{"n":1}\n{"n":2}\n{"n":3}\n');
    assert.deepEqual(messages.map((m) => m.n), [1, 2, 3]);
});

test('one message arriving as three chunks is one message, and not before', () => {
    //THE FRAMING IS THE NEWLINE, so half a message is a message that has not
    //arrived yet rather than a broken one.
    assert.deepEqual(f.take('{"ty'), { messages: [] });
    assert.deepEqual(f.take('pe":"he'), { messages: [] });
    assert.deepEqual(f.take('llo"}\n'), { messages: [{ type: 'hello' }] });
});

test('a chunk that ends mid-line keeps the remainder for the next one', () => {
    const first = f.take('{"n":1}\n{"n":2');
    assert.deepEqual(first.messages.map((m) => m.n), [1]);
    assert.ok(f.pending() > 0);

    assert.deepEqual(f.take('}\n').messages.map((m) => m.n), [2]);
    assert.equal(f.pending(), 0);
});

test('a newline inside a string is not a frame boundary', () => {
    //JSON.stringify ESCAPES IT, which is what makes the newline usable as the
    //frame at all — a guest reporting a build log sends them constantly.
    const line = f.line({ type: 'out', text: 'first\nsecond' });
    assert.equal(line.split('\n').length, 2);
    assert.deepEqual(f.take(line).messages, [{ type: 'out', text: 'first\nsecond' }]);
});

test('what is written always ends in a newline', () => {
    //A MESSAGE WRITTEN WITHOUT ITS NEWLINE IS ONE THE FAR END WAITS FOR FOREVER,
    //and it looks like a hang rather than like a mistake here.
    assert.ok(f.line({ type: 'hi' }).endsWith('\n'));
});

test('blank lines are not messages', () => {
    assert.deepEqual(f.take('\n\n  \n{"n":1}\n').messages.map((m) => m.n), [1]);
});

//---- what ends a session ---------------------------------------------------

test('something that is not JSON is a fault, and what came before it is kept', () => {
    const { messages, fault } = f.take('{"n":1}\nnot json\n{"n":2}\n');

    //THE GOOD ONE STILL COUNTS. It arrived, it was complete, and dropping it
    //would make the last message before any fault silently disappear.
    assert.deepEqual(messages.map((m) => m.n), [1]);
    assert.match(fault, /was not JSON/);
});

test('valid JSON that is not an object is refused too', () => {
    //`null`, `7` AND `"hi"` ALL PARSE, and every reader downstream would then be
    //taking properties off something that has none — a fault a guest causes by
    //writing one character.
    for (const bad of ['null', '7', '"hi"', 'true', '[1,2]']) {
        const one = makeFraming();
        assert.match(one.take(bad + '\n').fault, /was not a message/, bad);
    }
});

test('a line that never ends is a fault rather than memory filling up', () => {
    const small = makeFraming({ max: 100 });
    assert.equal(small.take('x'.repeat(60)).fault, undefined);
    assert.match(small.take('x'.repeat(60)).fault, /never ended/);
});

test('but a lot of good output quickly is not that fault', () => {
    const small = makeFraming({ max: 100 });

    //MEASURING THE WHOLE BUFFER BEFORE SPLITTING IT counts complete lines
    //towards a limit that is about ONE line — so a machine sending plenty of
    //perfectly good output is hung up on for "sent a line that never ended",
    //which is the one explanation that is not true.
    const many = Array.from({ length: 50 }, (_, n) => JSON.stringify({ n })).join('\n') + '\n';
    assert.ok(many.length > 100, many.length);

    const { messages, fault } = small.take(many);
    assert.equal(fault, undefined);
    assert.equal(messages.length, 50);
});

test('and the limit is on the remainder, so a good chunk leaves nothing behind', () => {
    const small = makeFraming({ max: 100 });
    small.take(Array.from({ length: 50 }, (_, n) => JSON.stringify({ n })).join('\n') + '\n');
    assert.equal(small.pending(), 0);
});

test('each socket frames on its own', () => {
    const a = makeFraming();
    const b = makeFraming();

    a.take('{"n":1');
    //B MUST NOT SEE A's HALF-LINE. One buffer shared between sockets splices two
    //machines' output into one stream of nonsense.
    assert.deepEqual(b.take('{"n":2}\n').messages, [{ n: 2 }]);
    assert.deepEqual(a.take('}\n').messages, [{ n: 1 }]);
});
