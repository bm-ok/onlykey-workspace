const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const { sealFor, openWith, aPair, fingerprint, VERSION } =
    require('../../src/app/vms/sealed/sealing');

//---------------------------------------------------------------------------
//SEALING A CREDENTIAL TO THE MACHINE THAT ASKED FOR IT.
//
//THE CLAIM WORTH THE MOST, and it is the only one that matters: what crosses
//carries the value nowhere. The wire was never the hole — that is TLS and ssh —
//and the file at rest was never the hole either. The hole was the middle: a
//shell ARGUMENT, which is `ps` output to every user on that machine and a line
//in its history.
//
//SO THE TEST IS NOT "does it round trip". It is "does the value appear anywhere
//in what would be sent", asked of the actual bytes.
//
//AND THIS IS ASKABLE WITHOUT A MACHINE, which is the point of the guest's half
//living here too — the drill that watches a real machine is a different and
//slower check of the same thing.
//---------------------------------------------------------------------------

//A VALUE WITH NOTHING ELSE LIKE IT ANYWHERE, so "does this appear in what was
//sent" cannot be answered accidentally. Shaped like the real thing, because the
//real thing is JSON and a handover that only works on short strings is a
//handover that has not been tested.
const SECRET = 'sk-ant-oat01-NOTHINGELSEISSHAPEDLIKETHIS-0123456789abcdef';
const CRED = JSON.stringify({
    claudeAiOauth: { accessToken: SECRET, refreshToken: SECRET + '-r', subscriptionType: 'max' }
});

//---- the round trip ---------------------------------------------------------

test('what the host seals, the machine that asked can open', () => {
    const guest = aPair();
    const sealed = sealFor(guest.pem, CRED);

    assert.equal(openWith(guest.privateKey, sealed), CRED);
});

test('and it works on something long, because a credential is not a word', () => {
    const guest = aPair();
    const big = JSON.stringify({ claudeAiOauth: { accessToken: 'x'.repeat(20000) } });

    assert.equal(openWith(guest.privateKey, sealFor(guest.pem, big)), big);
});

test('and on the characters a shell would have opinions about', () => {
    const guest = aPair();
    const awkward = 'quotes \' and " and `backticks` and $HOME and \\ and a newline\nand a tab\there';

    assert.equal(openWith(guest.privateKey, sealFor(guest.pem, awkward)), awkward);
});

//---- and nothing else can ------------------------------------------------------

test('a different machine cannot open it, whatever else it knows', () => {
    //THE THING THAT ASKED IS THE ONLY THING THAT CAN READ IT.
    const asked = aPair();
    const somebodyElse = aPair();
    const sealed = sealFor(asked.pem, CRED);

    assert.throws(() => openWith(somebodyElse.privateKey, sealed));
});

test('a ciphertext altered in transit fails to open rather than opening to something else', () => {
    //GCM RATHER THAN CBC, because it authenticates. This is that difference,
    //asked directly.
    const guest = aPair();
    const sealed = sealFor(guest.pem, CRED);

    const body = Buffer.from(sealed.body, 'base64');
    body[0] = body[0] ^ 0xff;
    const tampered = Object.assign({}, sealed, { body: body.toString('base64') });

    assert.throws(() => openWith(guest.privateKey, tampered),
        undefined, 'an altered ciphertext decrypted to something');
});

test('and so does one whose tag was replaced', () => {
    const guest = aPair();
    const sealed = sealFor(guest.pem, CRED);
    const tampered = Object.assign({}, sealed, { tag: crypto.randomBytes(16).toString('base64') });

    assert.throws(() => openWith(guest.privateKey, tampered));
});

test('a reply from another exchange does not open this one', () => {
    //THE SALT AND THE IV ARE FRESH PER HANDOVER, which is what makes this true.
    const guest = aPair();
    const one = sealFor(guest.pem, CRED);
    const two = sealFor(guest.pem, CRED);

    assert.throws(() => openWith(guest.privateKey, Object.assign({}, one, { body: two.body })));
});

//---- the version, which both halves carry ---------------------------------------

test('a reply that is not this version is refused rather than guessed at', () => {
    //THE GUEST HALF IS SENT RATHER THAN INSTALLED for this reason — but the
    //check exists anyway, because a version skew that decrypts to nonsense is
    //worse than one that says so.
    const guest = aPair();
    const sealed = sealFor(guest.pem, CRED);

    assert.throws(() => openWith(guest.privateKey, Object.assign({}, sealed, { v: 'okc-handover-9' })),
        /this is not okc-handover-1/);
    assert.throws(() => openWith(guest.privateKey, null), /this is not okc-handover-1/);
});

test('and what is sealed says which version it is', () => {
    assert.equal(sealFor(aPair().pem, CRED).v, VERSION);
});

//---- and the whole point ----------------------------------------------------------

test('nothing that would be sent carries the value', () => {
    //THE ONE CLAIM. Everything above could hold while the credential travelled
    //in the clear beside it.
    const guest = aPair();
    const sealed = sealFor(guest.pem, CRED);

    const wire = JSON.stringify(sealed);
    assert.equal(wire.includes(SECRET), false, 'the credential is in what would be sent');

    //AND NOT IN A DIFFERENT ENCODING OF ITSELF EITHER, which is the way a check
    //like this passes while being wrong.
    assert.equal(wire.includes(Buffer.from(SECRET, 'utf8').toString('base64')), false,
        'the credential is in what would be sent, base64');
    assert.equal(wire.includes(Buffer.from(SECRET, 'utf8').toString('hex')), false);

    //AND THE PUBLIC HALF IS PUBLIC. What is in the clear is a key and two
    //nonces, which is what the design says should be.
    assert.match(sealed.pub, /^-----BEGIN PUBLIC KEY-----/);
    assert.ok(sealed.salt && sealed.iv && sealed.tag);
});

test('and two handovers of one credential do not look alike', () => {
    //OTHERWISE ANYBODY WATCHING knows the credential did not change, which is
    //a fact about a secret.
    const guest = aPair();
    const one = sealFor(guest.pem, CRED);
    const two = sealFor(guest.pem, CRED);

    assert.notEqual(one.body, two.body);
    assert.notEqual(one.salt, two.salt);
    assert.notEqual(one.iv, two.iv);
    assert.notEqual(one.pub, two.pub, 'the host reused its keypair between handovers');
});

//---- and what the two sides compare without printing anything ----------------------

test('the fingerprint says "the same one" without either side showing it', () => {
    assert.equal(fingerprint(CRED), fingerprint(CRED));
    assert.notEqual(fingerprint(CRED), fingerprint(CRED + ' '));

    const f = fingerprint(CRED);
    assert.match(f, /^[0-9a-f]{16}$/);
    assert.equal(f.includes(SECRET.slice(0, 8)), false);
});
