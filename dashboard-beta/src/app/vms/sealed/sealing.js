//---------------------------------------------------------------------------
//HANDING A CREDENTIAL TO A MACHINE WITHOUT PUTTING IT IN A COMMAND LINE.
//
//What this replaces: the credential was base64'd and sent as
//
//    printf '%s' '<the whole credential>' | base64 -d > ~/.claude/.credentials.json
//
//down an authenticated channel. THE WIRE WAS NEVER THE PROBLEM — that is TLS and
//ssh — and base64 is not encryption. The problem is the three places the value
//exists as itself on the way:
//
//  in argv on the guest    `ps` shows a running command line to every user on
//                          that machine, and the credential is in it
//  in shell history        the command is a shell command, and shells keep them
//  in this host's memory   as a plain string, for the length of the call
//
//SO THE THING THAT ASKED IS THE ONLY THING THAT CAN READ IT. The guest makes a
//keypair, the host makes one, each derives the same shared secret from the
//other's public half, and what crosses is ciphertext. Public keys and ciphertext
//in a command line are not secrets.
//
//X25519 AND AES-256-GCM, both from node's own crypto — this app has no
//dependencies and the guest has node because the agent needs it. GCM rather than
//CBC because it AUTHENTICATES: a ciphertext altered in transit fails to open
//rather than decrypting to something else.
//
//EPHEMERAL ON BOTH SIDES, one pair per handover. The key that could decrypt a
//credential exists for the length of one call and then does not exist anywhere —
//so a recording of the exchange is not something a stolen key opens later.
//
//WHAT THIS IS NOT. It is not authentication: the guest's public key arrives over
//a channel this app already proved is that machine (its own token, its own ssh
//key), and this adds no opinion about who it is talking to. It is about the
//VALUE not existing in places that keep things.
//
//---- and why this plugin is not called `handover` -------------------------
//
//THAT NAME IS TAKEN, by ../../core/handover, which is a different thing
//altogether: what an app plugin hands to its own other half across a reload. The
//app this is ported from calls this file `core/handover.js` and has no such
//collision, so a reader arriving from there should know to look here.
//
//Two things called handover in one graph would resolve to whichever was declared
//— and an unresolved or wrongly-resolved name takes the whole graph down.
//---------------------------------------------------------------------------

var crypto = require('crypto');

//THE ONE SHAPE BOTH SIDES AGREE ON, written here and used by the guest half in
//../provision/scripts/okc-credential.js. A change to either has to be a change
//to both, so the fields are NAMED rather than positional and the version is
//carried.
var VERSION = 'okc-handover-1';

//HKDF RATHER THAN THE RAW SHARED SECRET AS A KEY. X25519 gives 32 bytes with
//structure; a KDF gives 32 bytes without, and binds the key to what it is FOR so
//the same exchange cannot be reused for something else later.
function keyFrom(shared, salt) {
    return Buffer.from(crypto.hkdfSync('sha256', shared, salt, Buffer.from(VERSION, 'utf8'), 32));
}

//THE HOST'S HALF: given what the guest published, produce what only that guest
//can open.
function sealFor(guestPublicPem, text) {
    var guestPublic = crypto.createPublicKey(guestPublicPem);
    var mine = crypto.generateKeyPairSync('x25519');
    var shared = crypto.diffieHellman({ privateKey: mine.privateKey, publicKey: guestPublic });

    //A FRESH SALT AND A FRESH IV PER HANDOVER, sent in the clear beside the
    //ciphertext — neither is secret, and both are what stop two handovers of the
    //same credential looking identical.
    var salt = crypto.randomBytes(16);
    var iv = crypto.randomBytes(12);
    var key = keyFrom(shared, salt);

    var cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    var body = Buffer.concat([cipher.update(Buffer.from(text, 'utf8')), cipher.final()]);

    return {
        v: VERSION,
        //SPKI/PEM, which is what createPublicKey takes on the other side without
        //any encoding conventions of ours in between.
        pub: mine.publicKey.export({ type: 'spki', format: 'pem' }).toString().trim(),
        salt: salt.toString('base64'),
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        body: body.toString('base64')
    };
}

//THE GUEST'S HALF, kept here as well so this host can prove the round trip
//WITHOUT A MACHINE. The guest runs the same steps in
//../provision/scripts/okc-credential.js.
function openWith(guestPrivateKey, sealed) {
    if (!sealed || sealed.v !== VERSION) throw new Error('this is not ' + VERSION);

    var shared = crypto.diffieHellman({
        privateKey: guestPrivateKey,
        publicKey: crypto.createPublicKey(sealed.pub)
    });

    var key = keyFrom(shared, Buffer.from(sealed.salt, 'base64'));
    var decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));

    return Buffer.concat([
        decipher.update(Buffer.from(sealed.body, 'base64')),
        decipher.final()
    ]).toString('utf8');
}

//A PAIR, for whichever side is asking. The guest makes one per handover and
//throws it away; this is also what a drill uses to stand in for a guest.
function aPair() {
    var made = crypto.generateKeyPairSync('x25519');
    return {
        privateKey: made.privateKey,
        publicKey: made.publicKey,
        pem: made.publicKey.export({ type: 'spki', format: 'pem' }).toString().trim()
    };
}

//WHAT THIS HOST WOULD CALL THE SAME TEXT, so a caller can compare without
//hashing it a second way somewhere else.
function fingerprint(text) {
    return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

module.exports = {
    sealFor: sealFor,
    openWith: openWith,
    aPair: aPair,
    fingerprint: fingerprint,
    VERSION: VERSION
};
