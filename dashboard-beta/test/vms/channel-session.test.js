const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');

const makeSession = require('../../src/app/vms/channel/session');
const makeRoster = require('../../src/app/vms/channel/roster');
const makeJobs = require('../../src/app/vms/channel/jobs');

//---------------------------------------------------------------------------
//one socket, from the first byte to whatever ended it.
//
//THE CLAIM WORTH THE MOST: nothing an unauthenticated socket sends does
//anything except close it. The framing, the roster and the jobs each hold their
//own half of that; this is where the three are actually wired to a socket, and
//a wiring mistake here would pass every one of their tests.
//
//AND THE SECOND: which event came FIRST is the whole diagnosis. Both endings
//once arrived as the same three words — "hung up" — so a machine that rebooted,
//a machine whose network died, and a connection reset by something in between
//were one event with one description.
//---------------------------------------------------------------------------

let roster, jobs, said, tokens, gone, clock;

//A SOCKET THAT IS ONLY WHAT THIS FILE USES OF ONE, so every ending below is
//reachable — including the ones a real machine produces and a test cannot.
const fakeSocket = () => {
    const s = new EventEmitter();
    s.destroyed = false;
    s.wrote = [];
    s.write = (text) => { s.wrote.push(text); return true; };
    s.destroy = () => { s.destroyed = true; s.emit('close'); };
    s.remoteAddress = '192.168.51.70';
    s.remotePort = 51234;

    //WHAT THE FAR END SAID, already unframed.
    s.said = () => s.wrote.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    s.sends = (obj) => s.emit('data', Buffer.from(JSON.stringify(obj) + '\n'));
    s.sendsRaw = (text) => s.emit('data', Buffer.from(text));
    return s;
};

beforeEach(() => {
    said = [];
    gone = [];
    tokens = { runner1: 'a'.repeat(48) };

    const say = (...where) => {
        const put = (kind) => (m) => said.push([kind, where.join('/'), m]);
        return { good: put('good'), warn: put('warn'), info: put('info'), out: put('out'), bad: put('bad') };
    };

    clock = 1000;
    roster = makeRoster({
        say,
        now: () => clock,
        tokenFor: (vm) => tokens[vm] || null,
        onGone: (vm, why) => { gone.push([vm, why]); jobs.abandon(vm, why); }
    });
    jobs = makeJobs({ say, agentFor: (name) => roster.get(name) });
});

const open = (socket) => makeSession(socket, { say: (...w) => {
    const put = (kind) => (m) => said.push([kind, w.join('/'), m]);
    return { good: put('good'), warn: put('warn'), info: put('info'), out: put('out'), bad: put('bad') };
}, roster, jobs });

const hello = (token = tokens.runner1, facts) => ({ type: 'hello', vm: 'runner1', token, facts });

//---- getting in ------------------------------------------------------------

test('a valid hello is answered with hi, and the machine is on the roster', () => {
    const s = fakeSocket();
    open(s);
    s.sends(hello());

    assert.deepEqual(s.said(), [{ type: 'hi' }]);
    assert.equal(roster.connected('runner1'), true);
    assert.equal(s.destroyed, false);
});

test('a wrong token is told why and the socket goes', () => {
    const s = fakeSocket();
    open(s);
    s.sends(hello('c'.repeat(48)));

    //A GUEST THAT IS SIMPLY CUT OFF cannot tell being refused from the network
    //breaking, and the two want very different things done about them.
    assert.deepEqual(s.said(), [{ type: 'bye', why: 'claimed to be "runner1" without the right token' }]);
    assert.equal(s.destroyed, true);
    assert.equal(roster.connected('runner1'), false);
});

test('nothing an unauthenticated socket sends does anything but close it', () => {
    for (const first of [
        { type: 'run', command: 'rm -rf /' },
        { type: 'done', job: '1', code: 0 },
        { type: 'out', job: '1', text: 'x' },
        { type: 'beat' }
    ]) {
        const s = fakeSocket();
        open(s);
        s.sends(first);

        assert.equal(s.destroyed, true, JSON.stringify(first));
        assert.equal(s.said()[0].why, 'said something before hello');
        assert.deepEqual(said.filter(([kind]) => kind === 'out'), [], JSON.stringify(first));
    }
});

test('rubbish that is not JSON closes it too', () => {
    const s = fakeSocket();
    open(s);
    s.sendsRaw('this is not JSON at all\n');

    assert.match(s.said()[0].why, /was not JSON/);
    assert.equal(s.destroyed, true);
});

test('a hello split across two packets still gets in', () => {
    const s = fakeSocket();
    open(s);

    //TCP GIVES YOU BYTES. One write can arrive as three chunks.
    const line = JSON.stringify(hello()) + '\n';
    s.sendsRaw(line.slice(0, 20));
    assert.equal(roster.connected('runner1'), false);
    s.sendsRaw(line.slice(20));

    assert.equal(roster.connected('runner1'), true);
});

//---- talking ---------------------------------------------------------------

test('a command goes out and its answer comes back', async () => {
    const s = fakeSocket();
    open(s);
    s.sends(hello());

    const running = jobs.run('runner1', 'uname -a', { what: 'kernel' });

    const asked = s.said().find((m) => m.type === 'run');
    assert.equal(asked.command, 'uname -a');

    s.sends({ type: 'out', job: asked.job, text: 'Linux runner1' });
    s.sends({ type: 'done', job: asked.job, code: 0, what: 'kernel' });

    assert.deepEqual(await running, { code: 0, output: 'Linux runner1' });
});

test('a beat is answered on the same socket the machine dialled in on', () => {
    const s = fakeSocket();
    open(s);
    s.sends(hello());
    s.sends({ type: 'beat', desktop: true });

    assert.deepEqual(s.said(), [{ type: 'hi' }, { type: 'beat' }]);
    assert.equal(roster.get('runner1').facts.desktop, true);
});

test('a machine busy sending output is not swept up as silent', () => {
    const s = fakeSocket();
    open(s);
    s.sends(hello());

    //A MACHINE MID-BUILD SENDS OUTPUT AND NO BEATS for minutes at a time.
    //Counting only beats as life is how one gets dropped in the middle of the
    //thing it was asked to do.
    clock = 1000 + 60000;
    s.sends({ type: 'say', text: 'still compiling' });

    clock = 1000 + 100000;
    assert.deepEqual(roster.sweep(), []);
    assert.equal(roster.connected('runner1'), true);
});

test('anything else a machine says is written down rather than ignored', () => {
    const s = fakeSocket();
    open(s);
    s.sends(hello());
    s.sends({ type: 'something-new', detail: 'from a newer agent' });

    assert.ok(said.some(([, , m]) => /something-new/.test(String(m))), JSON.stringify(said));
});

test('two messages in one packet are both acted on', () => {
    const s = fakeSocket();
    open(s);
    s.sendsRaw(JSON.stringify(hello()) + '\n' + JSON.stringify({ type: 'beat', desktop: true }) + '\n');

    assert.equal(roster.get('runner1').facts.desktop, true);
});

test('good messages before a fault still count, and then it closes', () => {
    const s = fakeSocket();
    open(s);
    s.sendsRaw(JSON.stringify(hello()) + '\nnot json\n');

    //THEY ARRIVED, AND THEY ARE THE LAST THING THE MACHINE MANAGED TO SAY —
    //usually the interesting part of why it then said something broken.
    assert.equal(roster.connected('runner1'), false);   //dropped, because the socket went
    assert.ok(s.said().some((m) => m.type === 'hi'));
    assert.ok(s.said().some((m) => m.type === 'bye'));
});

//---- why it went -----------------------------------------------------------

test('the machine closing it says so', () => {
    const s = fakeSocket();
    open(s);
    s.sends(hello());

    s.emit('end');
    s.emit('close');

    assert.deepEqual(gone, [['runner1', 'hung up — the machine closed it']]);
});

test('a connection that broke says which error', () => {
    const s = fakeSocket();
    open(s);
    s.sends(hello());

    s.emit('error', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }));

    assert.equal(gone.length, 1);
    assert.match(gone[0][1], /hung up — error: ECONNRESET/);
});

test('and this side closing it is the answer nobody had', () => {
    const s = fakeSocket();
    open(s);
    s.sends(hello());

    //NO `end`, NO `error` — just gone. Which is what it looks like when this
    //side did it, and it used to read identically to the other two.
    s.emit('close');

    assert.match(gone[0][1], /this side closed it, and nothing here said why/);
});

test('whichever came first is the one reported', () => {
    const s = fakeSocket();
    open(s);
    s.sends(hello());

    s.emit('end');
    s.emit('error', Object.assign(new Error('x'), { code: 'ECONNRESET' }));
    s.emit('close');

    //WHICH EVENT CAME FIRST IS THE WHOLE DIAGNOSIS. Both ends reporting the
    //other as having gone is what made this unreadable.
    assert.equal(gone.length, 1);
    assert.match(gone[0][1], /the machine closed it/);
});

test('a socket that never said hello ends without dropping anybody', () => {
    const s = fakeSocket();
    open(s);

    s.emit('end');
    s.emit('close');

    assert.deepEqual(gone, []);
});

test('the old socket closing after a reconnect does not drop the new one', () => {
    const first = fakeSocket();
    open(first);
    first.sends(hello());

    const second = fakeSocket();
    open(second);
    second.sends(hello());

    assert.equal(gone.length, 1);   //the replacement
    gone = [];

    //THE OLD ONE NOW NOTICES IT WAS CLOSED, which happens after every reboot.
    first.emit('close');

    assert.deepEqual(gone, []);
    assert.equal(roster.connected('runner1'), true);
});

test('a machine that goes mid-command is answered rather than left waiting', async () => {
    const s = fakeSocket();
    open(s);
    s.sends(hello());

    const running = jobs.run('runner1', 'a long provision');
    s.emit('end');
    s.emit('close');

    await assert.rejects(() => running, /the machine closed it, so the command was not finished/);
});
