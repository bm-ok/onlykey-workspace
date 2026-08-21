const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makeRoster = require('../../src/app/vms/channel/roster');
const { addressOf, sameToken } = require('../../src/app/vms/channel/roster');

//---------------------------------------------------------------------------
//who is dialled in, and what it took to get in.
//
//THE CLAIM WORTH THE MOST: nothing is accepted before a valid hello, so an
//unauthenticated socket can do exactly one thing — be closed.
//
//AND THE SECOND: a machine that stops answering has to be noticed HERE. TCP
//will not do it; one killed mid-sentence leaves a socket on this side that
//looks perfectly healthy, forever.
//---------------------------------------------------------------------------

let roster, said, tokens, arrivals, departures, clock;

const socket = (from) => {
    const s = { from, wrote: [], closed: 0 };
    s.write = (m) => s.wrote.push(m);
    s.close = () => { s.closed++; };
    return s;
};

const helloFrom = (vm, token, facts) => ({ type: 'hello', vm, token, facts });

beforeEach(() => {
    said = [];
    tokens = { runner1: 'a'.repeat(48), runner2: 'b'.repeat(48) };
    arrivals = [];
    departures = [];
    clock = 1000;

    roster = makeRoster({
        say: (...where) => {
            const put = (kind) => (m) => said.push([kind, where.join('/'), m]);
            return { good: put('good'), warn: put('warn'), info: put('info') };
        },
        now: () => clock,
        stamp: () => 'a-time',
        tokenFor: (vm) => tokens[vm] || null,
        onHello: (vm, facts) => arrivals.push([vm, facts]),
        onGone: (vm, why) => departures.push([vm, why])
    });
});

//---- getting in ------------------------------------------------------------

test('a machine with the right token is in', () => {
    const s = socket('192.168.51.70:51234');
    const out = roster.hello(helloFrom('runner1', tokens.runner1), s);

    assert.deepEqual(out, { vm: 'runner1' });
    assert.equal(roster.connected('runner1'), true);
});

test('anything before hello is a fault, whatever it says', () => {
    for (const first of [{ type: 'beat' }, { type: 'run', command: 'rm -rf /' }, { type: 'out', text: 'x' }, {}]) {
        const one = makeRoster({ tokenFor: () => 'a'.repeat(48) });
        assert.match(one.hello(first, socket('x')).fault, /said something before hello/,
            JSON.stringify(first));
    }
});

test('a wrong token is refused, and so is no token', () => {
    for (const token of ['c'.repeat(48), '', null, undefined, 42, tokens.runner2]) {
        const out = roster.hello(helloFrom('runner1', token), socket('x'));
        assert.match(out.fault, /without the right token/, String(token));
    }
    assert.equal(roster.connected('runner1'), false);
});

test('a machine this app never made is refused the same way as a wrong token', () => {
    //SAYING WHICH WOULD TELL ANYTHING THAT CAN OPEN A SOCKET whether a name is
    //one of ours.
    const unknown = roster.hello(helloFrom('somebody-elses-vm', 'a'.repeat(48)), socket('x'));
    const wrong = roster.hello(helloFrom('runner1', 'c'.repeat(48)), socket('x'));

    assert.match(unknown.fault, /without the right token/);
    assert.equal(unknown.fault.replace('somebody-elses-vm', 'runner1'), wrong.fault);
});

test('a token is compared in constant time, and length alone never matches', () => {
    assert.equal(sameToken('a'.repeat(48), 'a'.repeat(48)), true);
    assert.equal(sameToken('a'.repeat(48), 'a'.repeat(47) + 'b'), false);
    assert.equal(sameToken('a'.repeat(47), 'a'.repeat(48)), false);
    //AN EMPTY EXPECTED TOKEN IS NOT A PASSWORD OF "". A machine with no token
    //recorded must not be let in by sending nothing.
    assert.equal(sameToken('', ''), false);
    assert.equal(sameToken(null, null), false);
});

test('reconnecting after a reboot replaces the old connection', () => {
    const first = socket('192.168.51.70:51234');
    roster.hello(helloFrom('runner1', tokens.runner1), first);

    const second = socket('192.168.51.70:51999');
    roster.hello(helloFrom('runner1', tokens.runner1), second);

    //THE ORDINARY CASE RATHER THAN THE EXCEPTION.
    assert.equal(roster.connected('runner1'), true);
    assert.equal(first.closed, 1);
    assert.equal(second.closed, 0);
    assert.equal(roster.get('runner1').from, '192.168.51.70:51999');
    //AND WHOEVER WAS WAITING ON THE OLD ONE WAS TOLD.
    assert.deepEqual(departures, [['runner1', 'was replaced by a new connection']]);
});

test('a machine arriving is told about once, with where it actually is', () => {
    //THE MACHINE SAYS IT IS AT 172.17.0.1, which is the docker bridge: real
    //inside it, unreachable from here, and the first address it lists. A packet
    //has already come back along the other one.
    roster.hello(
        helloFrom('runner1', tokens.runner1, { user: 'okc', address: '172.17.0.1' }),
        socket('::ffff:192.168.51.70:51234')
    );

    //THE SOCKET'S FAR END, NOT WHAT THE MACHINE SAYS ABOUT ITSELF.
    assert.deepEqual(arrivals, [['runner1', { address: '192.168.51.70', user: 'okc' }]]);
});

test('an arrival handler that throws does not take the session with it', () => {
    const one = makeRoster({
        say: (...where) => ({ good() {}, info() {}, warn: (m) => said.push(['warn', where.join('/'), m]) }),
        tokenFor: () => tokens.runner1,
        onHello: () => { throw new TypeError('cannot read properties of null'); }
    });

    assert.deepEqual(one.hello(helloFrom('runner1', tokens.runner1), socket('x')), { vm: 'runner1' });
    assert.equal(one.connected('runner1'), true);

    //AND IT IS A SENTENCE SOMEBODY CAN READ. This once swallowed silently, so
    //for every machine older than its first boot the rest of what happens when
    //one dials in simply did not happen, and no line anywhere said so.
    assert.ok(said.some(([, , m]) => /went wrong handling its arrival/.test(m)), JSON.stringify(said));
});

test('the address the far end is at, in the shapes it arrives in', () => {
    assert.equal(addressOf('::ffff:192.168.51.70:51234'), '192.168.51.70');
    assert.equal(addressOf('192.168.51.70:51234'), '192.168.51.70');
    assert.equal(addressOf(null), '');
});

//---- staying in ------------------------------------------------------------

test('a beat is answered, because a one-way heartbeat proves nothing', () => {
    const s = socket('x');
    roster.hello(helloFrom('runner1', tokens.runner1), s);
    roster.beat('runner1', { type: 'beat' });

    //THE MACHINE CANNOT TELL A WORKING CONNECTION FROM A SEVERED ONE BY SENDING:
    //the data sits in its kernel's buffer being retransmitted for a quarter of
    //an hour and every send succeeds. What it can measure is silence FROM HERE.
    assert.deepEqual(s.wrote, [{ type: 'beat' }]);
});

test('a desktop appearing is noticed on the beat, not only at hello', () => {
    const s = socket('x');
    roster.hello(helloFrom('runner1', tokens.runner1, { desktop: false }), s);

    roster.beat('runner1', { desktop: true });

    //IT IS FALSE WHEN A MACHINE FIRST CONNECTS and becomes true a minute or two
    //later. Recorded at hello only, it would say "no desktop" for the rest of
    //the machine's life.
    assert.equal(roster.get('runner1').facts.desktop, true);
    assert.ok(said.some(([, , m]) => /desktop session is up/.test(m)), JSON.stringify(said));
});

test('and only when it changes, so a beat every twenty seconds is not a log', () => {
    roster.hello(helloFrom('runner1', tokens.runner1, { desktop: false }), socket('x'));
    said = [];

    roster.beat('runner1', { desktop: false });
    roster.beat('runner1', { desktop: false });

    assert.deepEqual(said.filter(([, , m]) => /desktop/.test(m)), []);
});

test('what it is using is kept quietly, because it changes constantly', () => {
    roster.hello(helloFrom('runner1', tokens.runner1), socket('x'));
    said = [];

    roster.beat('runner1', { memoryUsedMB: 812, memoryTotalMB: 4096 });

    //A FACT TO LOOK AT, NOT AN EVENT. A line per beat would bury everything else.
    assert.equal(roster.get('runner1').facts.memoryUsedMB, 812);
    assert.equal(roster.get('runner1').facts.memoryTotalMB, 4096);
    assert.deepEqual(said, []);
});

test('a beat for a machine that is not dialled in is not an arrival', () => {
    assert.equal(roster.beat('runner1', { desktop: true }), false);
    assert.equal(roster.connected('runner1'), false);
});

test('anything at all counts as a sign of life, not only a beat', () => {
    roster.hello(helloFrom('runner1', tokens.runner1), socket('x'));

    clock = 50000;
    roster.seen('runner1');
    clock = 100000;

    //50s SINCE IT WAS LAST HEARD FROM, which is inside the window.
    assert.deepEqual(roster.sweep(), []);
    assert.equal(roster.connected('runner1'), true);
});

//---- going -----------------------------------------------------------------

test('a machine that says nothing for long enough is treated as gone', () => {
    roster.hello(helloFrom('runner1', tokens.runner1), socket('x'));

    clock = 1000 + 71000;
    assert.deepEqual(roster.sweep(), ['runner1']);

    //TCP WILL NOT NOTICE FOR US: one killed mid-sentence leaves a socket that
    //looks perfectly healthy.
    assert.equal(roster.connected('runner1'), false);
    assert.match(departures[0][1], /said nothing for 71s/);
});

test('three missed beats, and not two', () => {
    roster.hello(helloFrom('runner1', tokens.runner1), socket('x'));

    //THE AGENT BEATS EVERY TWENTY SECONDS. A machine that is merely slow must
    //not be thrown away.
    clock = 1000 + 69000;
    assert.deepEqual(roster.sweep(), []);
    assert.equal(roster.connected('runner1'), true);
});

test('dropping tells whoever was waiting, rather than leaving them to time out', () => {
    const s = socket('x');
    roster.hello(helloFrom('runner1', tokens.runner1), s);

    assert.equal(roster.drop('runner1', 'hung up — the machine closed it'), true);

    //A JOB WHOSE MACHINE HAS GONE WILL NEVER BE ANSWERED. Without this it sat
    //until its timeout, so asking a destroyed machine to do something appeared
    //to HANG rather than to fail.
    assert.deepEqual(departures, [['runner1', 'hung up — the machine closed it']]);
    assert.equal(s.closed, 1);
    assert.equal(roster.connected('runner1'), false);
});

test('dropping one that is not there changes nothing and tells nobody', () => {
    assert.equal(roster.drop('runner1', 'why'), false);
    assert.deepEqual(departures, []);
});

test('dropping is idempotent, so a socket closing twice is one departure', () => {
    roster.hello(helloFrom('runner1', tokens.runner1), socket('x'));

    roster.drop('runner1', 'hung up');
    roster.drop('runner1', 'hung up');

    assert.equal(departures.length, 1);
});

test('shutting down drops everything, and each one is told', () => {
    roster.hello(helloFrom('runner1', tokens.runner1), socket('x'));
    roster.hello(helloFrom('runner2', tokens.runner2), socket('y'));

    roster.dropAll('this host is shutting down');

    assert.deepEqual(roster.list(), []);
    assert.deepEqual(departures.map(([vm]) => vm).sort(), ['runner1', 'runner2']);
});

//---- what is drawn ---------------------------------------------------------

test('the list carries no socket and no token, because it is photographed', () => {
    roster.hello(helloFrom('runner1', tokens.runner1, { desktop: true, user: 'okc' }), socket('10.0.0.4:51234'));

    const [one] = roster.list();

    //`capture` WRITES THE WHOLE RENDERED DOM to a file with no redaction.
    assert.deepEqual(Object.keys(one).sort(), ['facts', 'from', 'since', 'vm']);
    assert.equal(JSON.stringify(one).includes(tokens.runner1), false);
    assert.equal(one.facts.desktop, true);
});
