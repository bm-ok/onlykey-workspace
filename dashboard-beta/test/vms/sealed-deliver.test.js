const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makeDeliver = require('../../src/app/vms/sealed/deliver');
const makePayload = require('../../src/app/vms/sealed/payload');
const { aPair, openWith, fingerprint } = require('../../src/app/vms/sealed/sealing');

//---------------------------------------------------------------------------
//THE HANDOVER, DRIVEN AGAINST A RECORDER.
//
//THE RUNNER IS AN ARGUMENT, which is what makes the claim checkable rather than
//re-stated: the commands are not composed here, they are composed by the
//shipping code and recorded on the way past. So "nothing sent carries the value"
//is asked of what the real path produced.
//
//THE GUEST IS STOOD IN FOR by a keypair made here — the payload's own half is
//run for real in ./sealed-both-halves.test.js, which is the slower and more
//complete check of the same protocol.
//---------------------------------------------------------------------------

const SECRET = 'sk-ant-oat01-NOTHINGELSEISSHAPEDLIKETHIS-0123456789abcdef';
const CRED = JSON.stringify({ claudeAiOauth: { accessToken: SECRET, refreshToken: SECRET + '-r' } });

let sent, guest, publishes, takes;

beforeEach(() => {
    sent = [];
    guest = aPair();
    publishes = () => guest.pem;
    takes = (sealed) => 'okc-credential-placed ' + fingerprint(openWith(guest.privateKey, sealed));
});

//A MACHINE THAT BEHAVES, and says the things a real one says around them — a
//profile that greets you, a warning from something in the path.
function aMachine() {
    return async (command, opts) => {
        sent.push({ command, opts });

        if (/credential\.js" begin/.test(command)) {
            return { output: 'Welcome to Ubuntu 24.04\n' + publishes() + '\n', code: 0 };
        }

        //WHAT THE GUEST WOULD HAVE BEEN GIVEN, recovered the way the guest half
        //recovers it: base64 on stdin.
        const b64 = command.match(/printf %s '([A-Za-z0-9+/=]+)'/)[1];
        const sealed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
        return { output: 'some noise\n' + takes(sealed) + '\n', code: 0 };
    };
}

const deliver = (over) => makeDeliver(Object.assign({
    guestHalf: () => '// the guest half, which is not a secret\n'
}, over || {}));

//---- the whole point ---------------------------------------------------------

test('nothing that is sent carries the value', async () => {
    //THE ONE CLAIM. The wire was never the hole; the hole was argv on the guest,
    //which `ps` shows to every user on that machine.
    await deliver().toTheMachine({ run: aMachine(), text: CRED });

    assert.ok(sent.length >= 2, 'it did not do two round trips');
    for (const { command } of sent) {
        assert.equal(command.includes(SECRET), false, 'the credential is in a command line');
        assert.equal(command.includes(Buffer.from(SECRET, 'utf8').toString('base64')), false,
            'the credential is in a command line, base64');
    }
});

test('and the machine ends up holding exactly it', async () => {
    //MEASURED THE WAY THE TWO SIDES MEASURE IT: the guest opens what it was sent
    //and reports a fingerprint of what it actually has.
    const done = await deliver().toTheMachine({ run: aMachine(), text: CRED });
    assert.equal(done.fingerprint, fingerprint(CRED));
});

//---- the order, which is the design -------------------------------------------

test('the guest speaks first — nothing is sealed until it has answered', async () => {
    //THERE IS NOTHING TO SEND until there is a key to send it to.
    await deliver().toTheMachine({ run: aMachine(), text: CRED });

    assert.match(sent[0].command, /credential\.js" begin$/);
    assert.match(sent[1].command, /credential\.js" finish/);
});

test('and the guest half is sent with the first command, not installed', async () => {
    //A MACHINE BUILT LAST MONTH would otherwise run last month's half of a
    //protocol changed today, and the failure is a decryption error on a machine
    //at two in the morning.
    await deliver({ guestHalf: () => 'THE-GUEST-HALF' }).toTheMachine({ run: aMachine(), text: CRED });

    const put = Buffer.from(sent[0].command.match(/printf %s '([A-Za-z0-9+/=]+)'/)[1], 'base64').toString('utf8');
    assert.equal(put, 'THE-GUEST-HALF');
    assert.match(sent[0].command, /mkdir -p "\$HOME\/\.okc"/);
});

test('the sealed reply goes on STDIN, not in argv', async () => {
    //IT IS NOT A SECRET AND WOULD COME TO NO HARM IN A COMMAND LINE. Putting it
    //there anyway is how the next thing to be handed over ends up in argv.
    await deliver().toTheMachine({ run: aMachine(), text: CRED });
    assert.match(sent[1].command, /base64 -d \| node "\$HOME\/\.okc\/credential\.js" finish/);
});

test('and whatever the caller wanted done afterwards runs in the same trip', async () => {
    //A SIGN-IN LANDING ON A MACHINE is the moment that machine becomes worth
    //watching, so what does the watching has to be there already.
    await deliver().toTheMachine({ run: aMachine(), text: CRED, andThen: 'start-the-watcher' });
    assert.match(sent[1].command, /start-the-watcher$/);
});

test('every command is bounded, and says what it is for', async () => {
    await deliver().toTheMachine({ run: aMachine(), text: CRED, what: 'lending it a sign-in' });

    assert.equal(sent[0].opts.what, 'lending it a sign-in');
    assert.match(sent[1].opts.what, /sealed to the key it just made/);
    for (const { opts } of sent) assert.ok(opts.timeout > 0, 'a machine was asked with no bound on the answer');
});

//---- and what it will not do ----------------------------------------------------

test('a machine that publishes no key is told so, and nothing is sent', async () => {
    publishes = () => 'bash: node: command not found';

    await assert.rejects(() => deliver().toTheMachine({ run: aMachine(), text: CRED }),
        /would not make a key to receive a credential with, so nothing was sent/);

    assert.equal(sent.length, 1, 'it sent something to a machine that could not receive it');
});

test('and what it actually said is carried, because that is the diagnosis', async () => {
    publishes = () => 'Error: EACCES: permission denied, mkdir /home/okc/.okc';

    await assert.rejects(() => deliver().toTheMachine({ run: aMachine(), text: CRED }),
        /EACCES: permission denied/);
});

test('a machine that does not confirm is a failure, not a success with no fingerprint', async () => {
    //"IT DID NOT TAKE THE CREDENTIAL" and "it took it and I did not check" are
    //the same thing on the wire and opposite things afterwards.
    takes = () => 'something else entirely';

    //AND WHAT IT SAID IS CARRIED WHOLE, shell noise and all — a guest prints
    //things nobody asked for, and the useful part of a failure is usually
    //somewhere in among them.
    await assert.rejects(() => deliver().toTheMachine({ run: aMachine(), text: CRED }),
        /It did not take the credential:[\s\S]*something else entirely/);
});

test('a key from a machine that cannot open what it is sent still fails at the check', async () => {
    //THE SEALING IS TO THE KEY THAT ANSWERED. If the machine that answered is
    //not the machine this reaches, what arrives is bytes that will not open —
    //and the guest half says so rather than writing them.
    const somebodyElse = aPair();
    publishes = () => somebodyElse.pem;
    takes = () => { throw new Error('it could not be opened'); };

    await assert.rejects(() => deliver().toTheMachine({ run: aMachine(), text: CRED }),
        /it could not be opened/);
});

//---- and what it carries back ------------------------------------------------------

test('the exit code comes back, because "it answered no" is not "it never ran"', async () => {
    //ONLY THE NUMBER TELLS THOSE APART, and this is the one place it is known.
    const done = await deliver().toTheMachine({
        run: async (command) => {
            sent.push({ command });
            if (/begin$/.test(command)) return { output: guest.pem, code: 0 };
            const b64 = command.match(/printf %s '([A-Za-z0-9+/=]+)'/)[1];
            const sealed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
            return { output: 'okc-credential-placed ' + fingerprint(openWith(guest.privateKey, sealed)), code: 3 };
        },
        text: CRED
    });

    assert.equal(done.code, 3);
});

test('and a runner that reports none says null rather than nothing', async () => {
    const done = await deliver().toTheMachine({
        run: async (command) => {
            if (/begin$/.test(command)) return { output: guest.pem };
            const b64 = command.match(/printf %s '([A-Za-z0-9+/=]+)'/)[1];
            const sealed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
            return { output: 'okc-credential-placed ' + fingerprint(openWith(guest.privateKey, sealed)) };
        },
        text: CRED
    });

    assert.strictEqual(done.code, null);
});

//---- the payload it is built from ----------------------------------------------------

test('the guest half is read at load, and a missing one is loud', () => {
    //A MISSING PAYLOAD otherwise surfaces as a machine that publishes no key,
    //which points at the guest rather than at this host.
    assert.throws(() => makePayload({ dir: '/nowhere-at-all' }),
        /missing okc-credential\.js.*PAYLOADS list in webpack\.config\.js/s);
});

test('and an empty one is louder, because it would copy and write and do nothing', () => {
    assert.throws(() => makePayload({ read: () => '   ' }),
        /is empty\. A machine would be sent a file that does nothing/);
});

test('the real one is found where the packaging puts it', () => {
    //THE CHECK THAT THIS IS WIRED TO A FILE THAT EXISTS, rather than to a path
    //that is merely well-formed.
    const p = makePayload({ dir: require('node:path').join(__dirname, '..', '..', 'src', 'app', 'vms', 'provision', 'scripts') });

    assert.match(p.guestHalf(), /okc-credential/);
    assert.match(p.guestHalf(), /okc-handover-1/);
});
