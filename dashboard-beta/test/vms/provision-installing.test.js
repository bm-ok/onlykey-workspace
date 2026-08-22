const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makeInstalling = require('../../src/app/vms/provision/installing');

//---------------------------------------------------------------------------
//GETTING AN OPERATING SYSTEM ONTO A MACHINE, which is an ORDER rather than a set
//of commands. Almost every step delegates; what is checked here is the sequence,
//because the sequence is the part that has actually been wrong.
//
//THE CLAIM WORTH THE MOST: a machine is built from NOTHING. Installing used to
//keep the machine and replace only its disk, and everything else came along —
//including snapshots that were points on a disk which no longer existed. Nothing
//failed. The queue would have taken that machine, worked on it, and found out at
//the moment it tried to put it away.
//
//AND THE SECOND: the password never reaches the log. VBoxManage echoes back
//every value it was given, and the log is kept and read later — so a secret that
//reaches it is a secret permanently written down.
//---------------------------------------------------------------------------

let deal, vbox, ours, record, asked, said, out, dropped, tickets, filled, built, blanked, ranArgs, runFails;

beforeEach(() => {
    asked = [];
    said = [];
    out = [];
    dropped = [];
    tickets = 0;
    built = [];
    blanked = [];
    ranArgs = null;
    runFails = null;
    filled = { file: 'C:/tmp/okc-autoinstall-one.yaml', why: null, lost: null };

    record = {
        name: 'one',
        spec: {
            name: 'one', iso: 'ubuntu', user: 'okc', password: 'a-long-password',
            fullName: 'OKC', hostname: 'one', locale: 'en_US', timeZone: 'UTC',
            sshKey: 'ssh-ed25519 AAAA'
        },
        baseSnapshot: 'base', snapshots: { base: null }, branch: 'a-branch', borrowed: 'somebody',
        serial: 'C:/data/serial/one.log'
    };

    vbox = {
        exists: async () => vbox._exists,
        _exists: true,
        isOff: async () => vbox._off,
        _off: true,
        destroy: async (n) => { asked.push('destroy ' + n); },
        hostAddress: async () => '192.168.51.63',
        run: async (args) => {
            ranArgs = args;
            asked.push('unattended');
            if (runFails) throw new Error(runFails);

            //SHAPED LIKE WHAT VBoxManage ACTUALLY ECHOES: the password on its
            //own field line, the password loose in another line, AND two names
            //that merely BEGIN with "okc". Those last two are the whole reason
            //a short password is not blanked everywhere, so the output has to
            //contain them or the test cannot tell the two behaviours apart —
            //which it could not, until a sabotage walked straight through it.
            return [
                'Machine: one',
                'password = ' + record.spec.password,
                'using ' + record.spec.password + ' to seed the installer',
                'fetching okc-bootstrap.sh',
                'hostname okc-flow.local'
            ].join('\n') + '\n';
        }
    };

    ours = {
        get: () => record,
        update: (n, patch) => { Object.assign(record, patch); asked.push('update ' + Object.keys(patch).join(',')); return record; }
    };

    deal = makeInstalling({
        vbox,
        ours,
        channel: {
            drop: (n, why) => { dropped.push(n + ': ' + why); asked.push('drop'); },
            newToken: () => 'ticket-' + (++tickets)
        },
        tls: { ensure: () => ({ fingerprint: 'aabbcc00112233445566778899aabbccddeeff00112233445566778899aabbcc' }) },
        build: {
            resolveISO: async () => 'C:/isos/ubuntu.iso',
            buildInVbox: async (spec) => {
                built.push(spec.name);
                asked.push('buildInVbox');
                return { iso: 'C:/isos/ubuntu.iso', bridge: 'Realtek', disk: 'C:/vms/one.vdi', serial: 'C:/data/serial/one.log' };
            },
            blankTheDisk: async (n) => { blanked.push(n); asked.push('blankTheDisk'); }
        },
        template: { fill: () => filled },
        say: () => {
            const to = {
                good: (m) => said.push(m), warn: (m) => said.push('WARN ' + m),
                info: (m) => said.push(m), bad: (m) => said.push('BAD ' + m),
                out: (m) => out.push(m), on: () => to
            };
            return to;
        }
    });
});

const run = () => deal.install('one', { port: 7317, caPort: 7318 });
const at = (w) => {
    const i = asked.indexOf(w);
    assert.ok(i >= 0, w + ' never happened: ' + asked.join(' | '));
    return i;
};

//---- the refusals -------------------------------------------------------------

test('a machine with no installer image is refused before anything is destroyed', async () => {
    record.spec.iso = '';
    await assert.rejects(run, /no installer image/);
    assert.deepEqual(asked, []);
});

test('a running machine is refused rather than rebuilt underneath itself', async () => {
    vbox._off = false;
    await assert.rejects(run, /is running. Shut it down/);
    assert.deepEqual(asked, [], 'it began destroying a machine that was running');
});

//---- from nothing -------------------------------------------------------------

test('an existing build is destroyed and made again, and the channel is dropped first', async () => {
    await run();

    //A FORCE-STOP SENDS NO FIN, so a machine reads as connected for another
    //seventy seconds — and this is about to destroy it.
    assert.ok(at('drop') < at('destroy one'), 'it destroyed the machine while still holding its channel open');
    assert.ok(at('destroy one') < at('buildInVbox'), asked.join(' | '));
    assert.deepEqual(dropped, ['one: is being rebuilt']);
});

test('what the old build carried does not survive it', async () => {
    await run();

    //SNAPSHOTS ARE POINTS ON A DISK THAT NO LONGER EXISTS. Keeping them produced
    //a machine with a fresh OS and a base snapshot from an hour earlier, and
    //nothing failed until the queue tried to put it away.
    assert.equal(record.baseSnapshot, null);
    assert.deepEqual(record.snapshots, {});
    assert.equal(record.branch, null);
    assert.equal(record.borrowed, null);
});

test('the console comes back with the new build, from what the build decided', async () => {
    record.serial = null;
    await run();

    //THE SERIAL PORT IS CONFIGURATION ON THE VirtualBox MACHINE, so destroying
    //the build destroyed it — while the record still said the console was being
    //captured. A terminal open on a file that will never grow again is the worst
    //kind of instrument.
    assert.equal(record.serial, 'C:/data/serial/one.log');
});

test('a machine that does not exist yet is not destroyed, and gets a blank disk', async () => {
    vbox._exists = false;
    await run();

    assert.equal(asked.indexOf('destroy one'), -1, 'it destroyed a machine that was not there');
    assert.deepEqual(blanked, ['one']);
});

test('and one that was just rebuilt is not blanked again', async () => {
    await run();
    //A REBUILD HAS ALREADY MADE A DISK THAT NEVER HELD ANYTHING. Blanking it
    //again deletes and recreates a file one minute old.
    assert.deepEqual(blanked, []);
});

//---- the ticket ---------------------------------------------------------------

test('every install gets its own ticket, and it is on the command line', async () => {
    const r = await run();

    //DEAD THE MOMENT THE MACHINE DIALS IN, which is the moment it has a token
    //instead. The command line outlives the install — VirtualBox writes it into
    //vboxpostinstall.sh in the machine's folder — so a token there would be a
    //live secret in a plain file.
    assert.equal(record.installTicket, 'ticket-1');
    assert.match(r.url, /ticket=ticket-1/);

    await run();
    assert.equal(record.installTicket, 'ticket-2', 'the same ticket was reused for a second install');
});

test('the bootstrap line goes in through bash -c, as one plain argument', async () => {
    await run();

    const i = ranArgs.indexOf('--post-install-command');
    assert.ok(i >= 0, ranArgs.join(' '));
    const cmd = ranArgs[i + 1];

    //VirtualBox PASTES THIS INTO ITS OWN TEMPLATE as an unquoted argument, so
    //anything compound has to go inside bash -c.
    assert.match(cmd, /^bash -c "/);
    assert.equal(cmd.indexOf('$'), -1, 'a $ reached the command line and the outer shell will expand it');
    assert.ok(cmd.includes('ticket-1'), 'the machine is never told its ticket');
});

//---- what it says while it goes ------------------------------------------------

test('the password never reaches the log, on the field line or anywhere else', async () => {
    await run();

    //VBoxManage ECHOES BACK EVERY VALUE IT WAS GIVEN, and the log is kept and
    //read later.
    const all = out.concat(said).join('\n');
    assert.equal(all.indexOf('a-long-password'), -1, all);
    assert.ok(out.some((l) => /password\s*=\s*<hidden>/.test(l)), out.join(' | '));
    assert.ok(out.some((l) => l.includes('<hidden>')), out.join(' | '));
});

test('a short password is not blanked everywhere, because it makes the log lie about names', async () => {
    record.spec.password = 'okc';
    await run();

    //THE FIELD LINE IS STILL REDACTED, which is where it actually appears.
    assert.ok(out.some((l) => /password\s*=\s*<hidden>/.test(l)), out.join(' | '));

    //AND NOTHING ELSE IS. "okc" turned okc-flow.local into <hidden>-flow.local
    //and okc-bootstrap.sh into <hidden>-bootstrap.sh — a log that lies about
    //names, for no security gain, because a three-letter password is not
    //distinctive enough to find safely.
    assert.ok(out.includes('fetching okc-bootstrap.sh'),
        'a filename was mangled by a password too short to be found safely: ' + out.join(' | '));
    assert.ok(out.includes('hostname okc-flow.local'),
        'a hostname was mangled by a password too short to be found safely: ' + out.join(' | '));
});

test('a failure takes the installing flag back off', async () => {
    runFails = 'VBoxManage: error: something with a-long-password in it';

    //A MACHINE LEFT MARKED "installing" IS ONE NOTHING WILL START, install or
    //pick up, while the tab says it is busy doing something that stopped.
    await assert.rejects(run, (e) => {
        assert.equal(e.message.indexOf('a-long-password'), -1, 'the failure carried the password: ' + e.message);
        assert.match(e.message, /<hidden>/);
        return true;
    });
    assert.equal(record.installing, null);
});

test('it is marked installing before VirtualBox is asked, not after', async () => {
    runFails = 'nope';
    await assert.rejects(run);
    //IF IT WERE MARKED AFTERWARDS, a 25-minute unattended install would run with
    //the register saying nothing was happening.
    assert.ok(at('update installing,reported') < at('unattended'), asked.join(' | '));
});

//---- watching it ----------------------------------------------------------------

test('a template that could not be built installs anyway, and says what was lost', async () => {
    filled = { file: null, why: 'there is no "autoinstall" anywhere', lost: null };
    await run();

    //BEING UNABLE TO WATCH IS WORSE THAN NOT INSTALLING, BUT ONLY SLIGHTLY.
    assert.equal(ranArgs.indexOf('--script-template'), -1);
    assert.ok(said.some((m) => /will not be watchable/.test(m)), said.join(' | '));
    assert.ok(asked.includes('unattended'), 'it refused to install over a logging convenience');
});

test('a template that lost only its ssh half says so and is still used', async () => {
    filled = { file: 'C:/tmp/x.yaml', why: null, lost: 'no ssh key, so the installer cannot be logged into' };
    await run();

    assert.ok(ranArgs.includes('--script-template'), ranArgs.join(' '));
    assert.ok(said.some((m) => /installer cannot be logged into/.test(m)), said.join(' | '));
});
