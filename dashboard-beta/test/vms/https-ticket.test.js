const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const makeAsking = require(path.join(__dirname, '..', '..', 'src', 'app', 'vms', 'https', 'asking.js'));

//---------------------------------------------------------------------------
//PROVING WHICH MACHINE IS ASKING, IN BOTH HALVES OF A MACHINE'S LIFE.
//
//THE CLAIM THIS FILE IS FOR, and it cost two installs to find:
//
//    A MACHINE BEING BUILT HAS NO TOKEN, because the script it is fetching is
//    where its token comes from.
//
//So an install carries a TICKET, put on the installer's command line — the one
//channel that reaches a machine with nothing on it. That half was not ported.
//Every installing guest got 401 from `/provision/first-boot.sh`, ten times over
//its retry loop, and the post-install command exited 1 — which subiquity reports
//as the whole install failing, with the cause ten scrollbacks above the part
//anybody reads.
//
//AND A TICKET IS NOT A SECOND TOKEN. It opens ONE machine's setup, it is checked
//against the name in the query, and it dies the moment that machine dials in —
//because the command line OUTLIVES the install, sitting in `vboxpostinstall.sh`
//in the machine's folder for as long as the machine exists.
//---------------------------------------------------------------------------

const BUILT = { name: 'built-1', spec: { token: 'a-real-token' } };
const BUILDING = { name: 'building-1', spec: {}, installTicket: 'a-live-ticket' };

let asking, register;

beforeEach(() => {
    register = [
        Object.assign({}, BUILT),
        Object.assign({}, BUILDING)
    ];
    asking = makeAsking({
        ours: {
            has: (n) => register.some(v => v.name === n),
            get: (n) => register.find(v => v.name === n)
        }
    });
});

//THE TWO THINGS A REQUEST CARRIES, which is all this decides from.
const who = (query, auth) => {
    const headers = {};
    if (auth) headers.authorization = 'Basic ' + Buffer.from(auth).toString('base64');
    return asking.whoIsAsking(headers, new URLSearchParams(query));
};

const nameOf = (vm) => (vm ? vm.name : null);

//---------------------------------------------------------------------------
//1. A MACHINE STILL BEING BUILT.
//---------------------------------------------------------------------------

test('a live install ticket names the machine it was made for', () => {
    assert.equal(nameOf(who('vm=building-1&ticket=a-live-ticket')), 'building-1');
});

test('no ticket and no token is nobody', () => {
    //THIS WAS THE BUG. Before the ticket path existed, every installing guest
    //landed here — and an install cannot carry a token, because the script it is
    //fetching is what delivers one.
    assert.equal(who('vm=building-1'), null);
});

test('a wrong ticket is nobody', () => {
    assert.equal(who('vm=building-1&ticket=not-the-ticket'), null);
});

test('a ticket that has been spent opens nothing', () => {
    //IT DIES WHEN THE MACHINE DIALS IN — vms/provision clears it in onHello —
    //because the command line carrying it sits in the machine's folder for as
    //long as the machine exists.
    register.find(v => v.name === 'building-1').installTicket = null;
    assert.equal(who('vm=building-1&ticket=a-live-ticket'), null);
});

test("one machine's ticket does not open another machine's setup", () => {
    //NAMED FOR A MACHINE, ALWAYS. "Is this a machine we know" is not the
    //question; "is this THAT machine" is.
    assert.equal(who('vm=built-1&ticket=a-live-ticket'), null);
});

test('an empty ticket does not match an empty record', () => {
    //A machine with no ticket and a caller offering none must not agree that
    //they match — which is what a bare equality check would have done.
    register.find(v => v.name === 'building-1').installTicket = '';
    assert.equal(who('vm=building-1&ticket='), null);
    assert.equal(who('vm=building-1'), null);
});

//---------------------------------------------------------------------------
//2. A MACHINE THAT HAS BEEN BUILT.
//---------------------------------------------------------------------------

test('its own token names it', () => {
    assert.equal(nameOf(who('vm=built-1', 'built-1:a-real-token')), 'built-1');
});

test('a valid token for ANOTHER machine is not an answer about this one', () => {
    //Answering the looser question is how one machine could read another's.
    assert.equal(who('vm=building-1', 'built-1:a-real-token'), null);
});

test('a wrong token is nobody', () => {
    assert.equal(who('vm=built-1', 'built-1:not-the-token'), null);
});

test('a machine this app never made is nobody, ticket or token', () => {
    assert.equal(who('vm=stranger&ticket=a-live-ticket'), null);
    assert.equal(who('vm=stranger', 'stranger:anything'), null);
});

//---------------------------------------------------------------------------
//3. THE ROUTES THAT NAME NO MACHINE.
//---------------------------------------------------------------------------

test('with no machine named, the token is the whole answer', () => {
    //`/git/*` and `/supervisor` are reached with a token and nothing else — the
    //machine is whoever the token belongs to. Requiring a `?vm=` here would have
    //broken both while fixing the install.
    assert.equal(nameOf(who('', 'built-1:a-real-token')), 'built-1');
    assert.equal(who(''), null);
});

test('and a ticket alone opens nothing when no machine is named', () => {
    //A ticket is only ever an answer about the machine it names.
    assert.equal(who('ticket=a-live-ticket'), null);
});

//---------------------------------------------------------------------------
//4. THE SHAPES THAT ARE NOT CREDENTIALS.
//---------------------------------------------------------------------------

test('rubbish in the authorization header is nobody, not an exception', () => {
    for (const said of ['', 'Bearer something', 'Basic', 'Basic !!!not-base64!!!', 'Basic ' + Buffer.from('nocolon').toString('base64')]) {
        assert.doesNotThrow(() => asking.whoIsAsking({ authorization: said }, new URLSearchParams('')));
        assert.equal(asking.whoIsAsking({ authorization: said }, new URLSearchParams('')), null);
    }
});

test('a name with no token, or a token with no name, is nobody', () => {
    assert.equal(who('', 'built-1:'), null);
    assert.equal(who('', ':a-real-token'), null);
});

test('a machine on the register with no token cannot be impersonated', () => {
    //`building-1` has no token at all. An empty token offered against an empty
    //record must not match.
    assert.equal(who('', 'building-1:'), null);
    assert.equal(who('vm=building-1', 'building-1:'), null);
});
