const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makeLend = require('../../src/app/runners/guests/lend');
const { whyNotOn } = require('../../src/app/runners/guests/lending');
const shape = require('../../src/app/runners/guests/shape');

//---------------------------------------------------------------------------
//PUTTING A SIGN-IN ON A MACHINE, AND TAKING IT BACK.
//
//THE CLAIM WORTH THE MOST: the ORDER of the checks. ../../src/app/runners/guests/store
//refuses a mismatched pair too — at `lentTo`, which runs AFTER the credential has
//been written onto the machine. A throw there arrives with the token already on a
//disk and nothing on this host recording that it is there: refused, and handed
//over anyway.
//
//AND THE SECOND: taken, not deleted. Ending a run with `rm -f` throws away
//everything the CLI refreshed while the worker ran, and this host goes on handing
//out a token one or more rotations behind — a credential that read as good for
//months while the worker answering with it said "OAuth session expired".
//
//AND THE THIRD: what comes back is read QUIETLY. `cat` of a credential file put
//an access token straight into the live log, which the window draws and a
//screenshot photographs.
//---------------------------------------------------------------------------

const SECRET = 'sk-ant-oat01-NOTHINGELSEISSHAPEDLIKETHIS-0123456789abcdef';
const CRED = JSON.stringify({ claudeAiOauth: { accessToken: SECRET, refreshToken: SECRET + '-r' } });

let said, machines, guest, sent, updated, lent, backedFrom, connected, landed, onTheMachine;

const GUEST = (over) => Object.assign({
    name: 'a-worker', role: 'worker', has: true, holder: null, lastCheck: null
}, over || {});

const VM = (name, tags) => ({ name, tags: tags || ['worker'], baseSnapshot: 'base' });

beforeEach(() => {
    said = [];
    sent = [];
    updated = [];
    lent = [];
    backedFrom = [];
    guest = GUEST();
    machines = [VM('kit-1')];
    connected = true;
    landed = null;              //what the machine reports it ended up with
    onTheMachine = CRED;        //what `cat` would find there
});

function lend(over) {
    return makeLend(Object.assign({
        store: {
            get: (n) => (guest && guest.name === n ? guest : null),
            token: () => CRED,
            lentTo: (n, m, how) => { lent.push({ n, m, how }); },
            backFrom: (n, what) => {
                backedFrom.push({ n, token: what.token });
                const rotated = !!what.token && what.token !== CRED;
                return { rotated, refused: null, fingerprint: 'ffff000011112222' };
            }
        },
        ours: {
            read: () => machines,
            get: (n) => {
                const vm = machines.filter((v) => v.name === n)[0];
                //`get` THROWS FOR A MACHINE THIS APP DID NOT MAKE, which is the
                //behaviour the check order is arranged around.
                if (!vm) throw new Error('There is no machine called "' + n + '".');
                return vm;
            },
            update: (n, patch) => updated.push({ n, patch }),
            kindsOf: (vm) => ((vm && vm.tags) || []).map(String),
            SUPERVISOR: 'supervisor'
        },
        channel: {
            connected: () => connected,
            run: async (m, command, opts) => {
                sent.push({ m, command, opts });
                if (/cat "\$HOME\/\.claude\/\.credentials\.json"/.test(command)) {
                    return { output: 'okc-said\n' + onTheMachine };
                }
                return { output: 'okc-guest-gone' };
            }
        },
        sealed: {
            toTheMachine: async (what) => {
                sent.push({ sealedText: what.text, andThen: what.andThen, what: what.what });
                await what.run('the handover', { what: what.what, timeout: 60000 });
                return { fingerprint: landed === null ? 'the-right-one' : landed, output: '', code: 0 };
            },
            fingerprint: () => 'the-right-one'
        },
        dispatch: {
            RUNS: '$HOME/.okc/runs',
            SUPERVISOR: '$HOME/.okc/turns',
            watcherFor: (box, log) => 'watch ' + box + ' ' + log
        },
        say: (who, m) => ({
            info: (t) => said.push(who + ': ' + t),
            warn: (t) => said.push('WARN ' + who + ': ' + t),
            bad: (t) => said.push('BAD ' + who + ': ' + t),
            good: (t) => said.push('GOOD ' + who + ': ' + t)
        }),
        paused: shape.paused,
        whyNotOn: whyNotOn,
        roleFrom: shape.roleFrom
    }, over || {}));
}

//---- the order of the checks --------------------------------------------------

test('the role is refused BEFORE the credential can reach a disk', async () => {
    //A THROW AT `lentTo` ARRIVES WITH THE TOKEN ALREADY ON A MACHINE.
    guest = GUEST({ name: 'a-super', role: 'supervisor' });

    await assert.rejects(() => lend().toMachine('a-super', 'kit-1'), /No tag changes this/);

    assert.deepEqual(sent, [], 'it talked to a machine it had already decided to refuse');
    assert.deepEqual(lent, []);
});

test('and a supervisor sign-in named against a machine that does not exist is refused for the ROLE', async () => {
    //THE SHAPE A DRILL FOUND IT WITH. `ours.get` throws for an unknown machine,
    //so asking it first would refuse for the MACHINE and never reach the role —
    //and the role is the one that must not be fixable by tagging something.
    guest = GUEST({ name: 'a-super', role: 'supervisor' });

    await assert.rejects(() => lend().toMachine('a-super', 'no-such-machine'),
        /No tag changes this/);
});

test('but an ordinary sign-in against one that does not exist is refused for the MACHINE', async () => {
    await assert.rejects(() => lend().toMachine('a-worker', 'no-such-machine'),
        /There is no machine called "no-such-machine"/);
    assert.deepEqual(sent, []);
});

test('a machine that has not said what it is gets nothing, and is told the fix', async () => {
    machines = [VM('kit-1', [])];
    await assert.rejects(() => lend().toMachine('a-worker', 'kit-1'),
        /has not been told what it is for/);
});

test('and nothing is sent to a machine that is not dialled in', async () => {
    connected = false;
    await assert.rejects(() => lend().toMachine('a-worker', 'kit-1'),
        /is not dialled in\. Start it and wait for it to connect/);
    assert.deepEqual(sent, []);
});

test('a sign-in whose file is gone is refused before anything is read', async () => {
    guest = GUEST({ has: false });
    await assert.rejects(() => lend().toMachine('a-worker', 'kit-1'),
        /has no token file any more/);
});

test('one already out on another machine is refused rather than copied', async () => {
    //TWO MACHINES RUNNING AS THE SAME IDENTITY is the thing being prevented.
    guest = GUEST({ holder: 'kit-9' });

    await assert.rejects(() => lend().toMachine('a-worker', 'kit-1'),
        /is on kit-9\. Take it back first/);
    assert.deepEqual(sent, []);
});

test('but re-lending it to the machine already holding it is allowed', async () => {
    guest = GUEST({ holder: 'kit-1' });
    const out = await lend().toMachine('a-worker', 'kit-1');
    assert.equal(out.machine, 'kit-1');
});

//---- a paused sign-in is lent, and said out loud --------------------------------

test('a sign-in known to be dead is lent by name, and announced', async () => {
    //NOT REFUSED, DELIBERATELY. It is the only way to exercise what happens to
    //work that cannot be given an identity, without breaking a working
    //credential to arrange it.
    guest = GUEST({ lastCheck: { ready: false, on: 'kit-9' } });

    const out = await lend().toMachine('a-worker', 'kit-1');

    assert.equal(out.machine, 'kit-1');
    assert.ok(said.some((l) => /already failed on a machine — kit-9 took it/.test(l)), said.join(' | '));
    assert.ok(said.some((l) => /this is a test unless it was a mistake/.test(l)));
});

//---- the handover itself ----------------------------------------------------------

test('the credential is handed over sealed, never as a command line', async () => {
    await lend().toMachine('a-worker', 'kit-1');

    const handover = sent.filter((s) => s.sealedText)[0];
    assert.ok(handover, 'it did not use the sealed handover');
    assert.equal(handover.sealedText, CRED);

    for (const s of sent) {
        if (!s.command) continue;
        assert.equal(s.command.includes(SECRET), false, 'the credential was in a command');
    }
});

test('and the means to watch it goes over in the same trip', async () => {
    //A SIGN-IN LANDING ON A MACHINE is the moment it becomes worth watching, and
    //the moment the window opens a tab — so what that tab runs has to be there.
    await lend().toMachine('a-worker', 'kit-1');

    const handover = sent.filter((s) => s.sealedText)[0];
    assert.match(handover.andThen, /^watch \$HOME\/\.okc\/runs \$HOME\/\.okc\/runs\/current\/out\.log$/);
});

test('a supervisor machine gets the supervisor box, which is a different directory', async () => {
    //A SUPERVISOR'S TURNS AND A RUNNER'S RUNS are written by different halves of
    //this app, each with its own link to whatever is current.
    guest = GUEST({ name: 'a-super', role: 'supervisor' });
    machines = [VM('sup-1', ['supervisor'])];

    await lend().toMachine('a-super', 'sup-1');

    const handover = sent.filter((s) => s.sealedText)[0];
    assert.match(handover.andThen, /^watch \$HOME\/\.okc\/turns \$HOME\/\.okc\/turns\/current\.log$/);
});

test('what landed is checked against what was sent, and a mismatch records nothing', async () => {
    //ANYTHING ELSE MEANS A HANDOVER THAT REPORTED SUCCESS while placing
    //something else.
    landed = 'a-different-one';

    await assert.rejects(() => lend().toMachine('a-worker', 'kit-1'),
        /wrote a-different-one where "a-worker" is the-right-one/);
    await assert.rejects(() => lend().toMachine('a-worker', 'kit-1'),
        /nothing on this host records it as lent/);

    assert.deepEqual(lent, [], 'it recorded a handover it had just refused');
    assert.deepEqual(updated, []);
});

test('and a good one is recorded on both sides', async () => {
    const out = await lend().toMachine('a-worker', 'kit-1');

    assert.deepEqual(lent, [{ n: 'a-worker', m: 'kit-1', how: { kind: ['worker'] } }]);
    assert.deepEqual(updated, [{ n: 'kit-1', patch: { holdsCredential: true, guest: 'a-worker' } }]);
    assert.match(out.note, /Take it back with guestBack before the machine is snapshotted/);
});

test('and the machine is said to be holding it, because that stops a snapshot', async () => {
    await lend().toMachine('a-worker', 'kit-1');
    assert.ok(said.some((l) => /kit-1 is holding the Claude guest "a-worker" — it cannot be snapshotted/.test(l)),
        said.join(' | '));
});

//---- taking it back ------------------------------------------------------------------

test('what the worker refreshed is kept, not deleted', async () => {
    //THE FAILURE ALREADY ON RECORD: a credential read as good for months while
    //the worker answering with it said "OAuth session expired".
    guest = GUEST({ holder: 'kit-1' });
    onTheMachine = JSON.stringify({ claudeAiOauth: { accessToken: SECRET + '-rotated' } });

    const out = await lend().fromMachine('a-worker', 'kit-1');

    assert.equal(backedFrom[0].token, onTheMachine, 'what came back was thrown away');
    assert.equal(out.rotated, true);
    assert.equal(out.reached, true);
    assert.match(out.note, /was refreshed while it was out, and the newer one is kept/);
});

test('and the credential is cleared off the machine afterwards', async () => {
    guest = GUEST({ holder: 'kit-1' });
    await lend().fromMachine('a-worker', 'kit-1');

    const cleared = sent.filter((s) => s.command && /rm -f/.test(s.command))[0];
    assert.ok(cleared, 'the credential was left on the machine');
    assert.match(cleared.command, /rm -f "\$HOME\/\.claude\/\.credentials\.json"/);
});

test('the read is QUIET, or a credential lands in the live log', async () => {
    //`cat` OF THE CREDENTIAL FILE put an access token and a refresh token
    //straight into the log the window draws and a screenshot photographs.
    guest = GUEST({ holder: 'kit-1' });
    await lend().fromMachine('a-worker', 'kit-1');

    const read = sent.filter((s) => s.command && /cat "\$HOME/.test(s.command))[0];
    assert.equal(read.opts.quiet, true, 'the credential was read into the log');
    assert.match(read.opts.what, /taking the Claude guest "a-worker" back/);
});

test('and nothing the log was told carries the credential', async () => {
    guest = GUEST({ holder: 'kit-1' });
    onTheMachine = JSON.stringify({ claudeAiOauth: { accessToken: SECRET + '-rotated' } });

    await lend().fromMachine('a-worker', 'kit-1');
    for (const l of said) assert.equal(l.includes(SECRET), false, 'a credential is in the log: ' + l);
});

test('this app\'s own framing is not read as part of the credential', async () => {
    //THE FIRST LINE IS THIS APP'S. Keeping it would store a credential with a
    //line of somebody else's text in front of it.
    guest = GUEST({ holder: 'kit-1' });
    await lend().fromMachine('a-worker', 'kit-1');

    assert.equal(backedFrom[0].token, CRED);
    assert.equal(backedFrom[0].token.indexOf('okc-said'), -1);
});

test('a machine that answers with noise instead of a credential keeps nothing', async () => {
    //WHAT IS TAKEN is only something that starts like JSON. A guest shell prints
    //things nobody asked for.
    guest = GUEST({ holder: 'kit-1' });
    onTheMachine = 'cat: /home/okc/.claude/.credentials.json: No such file or directory';

    const out = await lend().fromMachine('a-worker', 'kit-1');

    assert.strictEqual(backedFrom[0].token, null);
    assert.equal(out.reached, false);
});

test('a machine that cannot be reached is still marked as having given it back', async () => {
    //OTHERWISE THE SIGN-IN IS HELD BY A MACHINE NOBODY CAN ASK, for ever.
    guest = GUEST({ holder: 'kit-1' });
    connected = false;

    const out = await lend().fromMachine('a-worker', 'kit-1');

    assert.deepEqual(sent, [], 'it talked to a machine that is not dialled in');
    assert.equal(out.reached, false);
    assert.deepEqual(updated, [{ n: 'kit-1', patch: { holdsCredential: false, guest: null } }]);
    assert.match(out.note, /could not be read.*If that machine had a newer token, it went with the rollback/);
});

test('it can be taken back without naming the machine, from wherever it is', async () => {
    guest = GUEST({ holder: 'kit-1' });
    const out = await lend().fromMachine('a-worker');
    assert.equal(out.machine, 'kit-1');
});

test('and one that is not out anywhere says so', async () => {
    await assert.rejects(() => lend().fromMachine('a-worker'), /is not out on any machine/);
});

test('a credential the store refused is said out loud, and carried back', async () => {
    //../store DOES NOT LOG, and somebody looking for why a sign-in stopped
    //working will be reading this record.
    guest = GUEST({ holder: 'kit-1' });
    const o = lend({
        store: {
            get: () => guest,
            token: () => CRED,
            lentTo: () => {},
            backFrom: () => ({
                rotated: false, fingerprint: 'ffff000011112222',
                refused: '"a-worker" was handed back a credential with no access token in it'
            })
        }
    });

    const out = await o.fromMachine('a-worker', 'kit-1');

    assert.match(out.refused, /no access token/);
    assert.ok(said.some((l) => /BAD keys: .*no access token/.test(l)), said.join(' | '));
    assert.equal(out.note, out.refused, 'the refusal was not what the caller was told');
});

test('and one that came back unchanged says exactly that', async () => {
    guest = GUEST({ holder: 'kit-1' });
    const out = await lend().fromMachine('a-worker', 'kit-1');

    assert.equal(out.rotated, false);
    assert.match(out.note, /came back exactly as it went out/);
    assert.ok(said.some((l) => /came back unchanged/.test(l)));
});
