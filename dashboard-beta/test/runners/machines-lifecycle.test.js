const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makeLifecycle = require('../../src/app/runners/machines/lifecycle');
const { howLong, isPull } = require('../../src/app/runners/machines/lifecycle');
const makeSpeaking = require('../../src/app/runners/machines/speaking');

//---------------------------------------------------------------------------
//STARTING A MACHINE, AND SHUTTING ONE DOWN.
//
//THE CLAIM WORTH THE MOST: one supervisor runs at a time, and it is a rule about
//what they ARE. A supervisor decides what work there is; two of them running is
//two things deciding with no idea of each other — the same issue picked up
//twice, two branches cut for one piece of work. Nothing fails; the board just
//fills with work nobody asked for twice.
//
//AND THE SECOND: the turn ends when the KERNEL is up, not when VBoxManage
//returns. Ending it on that reply makes "one machine at a time" hold for about a
//second, while the machine pulls on the disk and every core for the next minute.
//
//AND THE THIRD: pressing the power button is a REQUEST. A guest that is wedged,
//still on its splash, or has no acpid ignores it — and a stop that did nothing
//was indistinguishable from one that worked.
//---------------------------------------------------------------------------

let said, machines, off, started, stopped, dropped, turns, clock, waitFails;

const VM = (name, tags) => ({ name, tags: tags || ['worker'] });

beforeEach(() => {
    said = [];
    started = [];
    stopped = [];
    dropped = [];
    turns = [];
    clock = 0;
    waitFails = false;
    machines = [VM('kit-1')];
    off = {};
});

function lifecycle(over) {
    return makeLifecycle(Object.assign({
        ours: {
            get: (n) => {
                const vm = machines.filter((v) => v.name === n)[0];
                if (!vm) throw new Error('There is no machine called "' + n + '".');
                return vm;
            },
            read: () => machines,
            SUPERVISOR: 'supervisor'
        },
        vbox: {
            start: async (n, type) => { started.push({ n, type }); return { started: true }; },
            stop: async (n, pull) => { stopped.push({ n, pull }); },
            isOff: async (n) => !!off[n],
            waitUntilOff: async () => { if (waitFails) throw new Error('still running'); }
        },
        busy: {
            during: async (n, what, fn) => { turns.push('during:' + what); return await fn(); },
            comingUp: async (n, fn) => { turns.push('comingUp'); return await fn(); }
        },
        channel: { drop: (n, why) => dropped.push({ n, why }) },
        speaking: { untilItSpeaks: async () => { turns.push('spoke'); return { spoke: true }; } },
        say: () => ({
            info: (t) => said.push(t), warn: (t) => said.push('WARN ' + t),
            bad: (t) => said.push('BAD ' + t), good: (t) => said.push('GOOD ' + t)
        }),
        now: () => (clock += 3000)
    }, over || {}));
}

//---- one supervisor at a time ------------------------------------------------

test('a second supervisor is refused, and the one already running is named', async () => {
    //"STOP THAT ONE FIRST" is the only thing to do about it.
    machines = [VM('sup-1', ['supervisor']), VM('sup-2', ['supervisor'])];
    off = { 'sup-2': false };

    await assert.rejects(() => lifecycle().start('sup-1'),
        /"sup-2" is already running, and one supervisor runs at a time/);
    await assert.rejects(() => lifecycle().start('sup-1'),
        /the same issue picked up twice, two branches cut for one piece of work\. Stop "sup-2" first/);

    assert.deepEqual(started, [], 'it started a second supervisor');
});

test('but one whose only sibling is off starts', async () => {
    machines = [VM('sup-1', ['supervisor']), VM('sup-2', ['supervisor'])];
    off = { 'sup-2': true };

    await lifecycle().start('sup-1');
    assert.equal(started.length, 1);
});

test('and a machine VirtualBox cannot be asked about is treated as off', async () => {
    //A SUPERVISOR THAT CANNOT BE ASKED must not stop this host bringing one up
    //for ever. The refusal is for a supervisor known to be running.
    machines = [VM('sup-1', ['supervisor']), VM('sup-2', ['supervisor'])];

    await lifecycle({
        vbox: {
            start: async () => ({}), stop: async () => {},
            isOff: async () => { throw new Error('VBoxManage is not here'); },
            waitUntilOff: async () => {}
        }
    }).start('sup-1');

    assert.ok(true, 'it refused to start on a question it could not ask');
});

test('a runner tagged worker is not affected, whatever else is running', async () => {
    //TWO, FOUR, TEN OF THOSE AT ONCE is the point of the queue — they are told
    //what to do and cannot decide anything.
    //
    //A RUNNER IS A VIRTUAL MACHINE IN THE POOL, and the tag says what it is for.
    //Supervisors are runners too — runners tagged supervisor — so the rule above
    //is about the TAG rather than about machines in general.
    machines = [VM('kit-1'), VM('kit-2')];
    off = { 'kit-2': false };

    await lifecycle().start('kit-1');
    assert.equal(started.length, 1);
});

test('and the tag is read whatever case it was written in', async () => {
    machines = [VM('sup-1', ['Supervisor']), VM('sup-2', ['SUPERVISOR'])];
    off = { 'sup-2': false };

    await assert.rejects(() => lifecycle().start('sup-1'), /one supervisor runs at a time/);
});

//---- the turn ends when the kernel is up ---------------------------------------

test('starting takes a turn, and holds it until the machine speaks', async () => {
    //ENDING THE TURN ON VBoxManage's REPLY makes "one machine at a time" hold
    //for about a second, while the machine is at its heaviest.
    await lifecycle().start('kit-1');

    assert.deepEqual(turns, ['during:being started', 'comingUp', 'spoke']);
});

test('and its own silence is not a failed start', async () => {
    //A MACHINE WITH NO CONSOLE CAPTURE cannot say anything, and that is worth
    //knowing rather than treating as an error.
    const out = await lifecycle({
        speaking: { untilItSpeaks: async () => { throw new Error('nothing is listening'); } }
    }).start('kit-1');

    assert.ok(out, 'a machine that said nothing was reported as having failed to start');
    assert.equal(started.length, 1);
});

test('headless is asked for when it is asked for, and gui otherwise', async () => {
    await lifecycle().start('kit-1', 'headless');
    await lifecycle().start('kit-1', 'gui');
    await lifecycle().start('kit-1');

    assert.deepEqual(started.map((s) => s.type), ['headless', 'gui', 'gui']);
});

test('a machine this app did not make is refused before anything happens', async () => {
    await assert.rejects(() => lifecycle().start('somebody-elses'),
        /There is no machine called "somebody-elses"/);
    assert.deepEqual(turns, []);
});

//---- shutting one down -----------------------------------------------------------

test('already off is the state that was wanted, not an error', async () => {
    //VirtualBox ANSWERS "Machine 'x' is not currently running", which reads as a
    //failure and stops whatever asked — and stopping a machine that is already
    //stopped is the most ordinary thing in the world.
    off = { 'kit-1': true };

    const out = await lifecycle().stop('kit-1');

    assert.deepEqual(out, { name: 'kit-1', off: true, how: 'already', took: 0, note: '"kit-1" was already off.' });
    assert.deepEqual(stopped, []);
    assert.deepEqual(dropped, [], 'it dropped the channel of a machine it did not touch');
});

test('the channel is dropped BEFORE the stop, not after', async () => {
    //A MACHINE WHOSE POWER IS PULLED SENDS NO FIN, so its socket looks healthy
    //for seventy seconds — and in that window it is listed as connected and
    //commands hang. After the stop is a race with how long VirtualBox takes.
    await lifecycle().stop('kit-1');

    assert.equal(dropped.length, 1);
    assert.equal(stopped.length, 1);
    assert.match(dropped[0].why, /was asked to shut down/);
});

test('and it says which of the two happened', async () => {
    await lifecycle().stop('kit-1', { force: true });
    assert.match(dropped[0].why, /had its power pulled/);
});

test('a machine that answers the button is said to be off, with how long it took', async () => {
    const out = await lifecycle().stop('kit-1');

    assert.equal(out.off, true);
    assert.equal(out.how, 'asked');
    assert.ok(out.took > 0);
    assert.ok(said.some((l) => /GOOD shut down after \d+s/.test(l)), said.join(' | '));
});

test('one that IGNORES it is said so, and told what tells the cases apart', async () => {
    //A STOP THAT DID NOTHING was indistinguishable from one that worked, and the
    //next thing to look at the machine found it still running with no record of
    //why. Found by a drill on a machine hung at its splash screen.
    waitFails = true;

    const out = await lifecycle().stop('kit-1');

    assert.equal(out.off, false);
    assert.equal(out.how, 'asked');
    assert.match(out.note, /did not answer the power button within \d+s/);
    assert.match(out.note, /wedged, still booting, or has no acpid — vmScreenshot is the only thing that tells those apart/);
    assert.match(out.note, /Pull its power with force=true when you have looked/);
    assert.ok(said.some((l) => /WARN did not go off within/.test(l)));
});

test('and it does NOT pull the power on its own', async () => {
    //A DIFFERENT ACT WITH A DIFFERENT COST — an unclean shutdown, mid-write —
    //and choosing it is the operator's.
    waitFails = true;
    await lifecycle().stop('kit-1');

    assert.deepEqual(stopped.map((s) => s.pull), [false]);
});

test('a pull that VirtualBox itself will not honour is named as VirtualBox\'s', async () => {
    //THAT IS A DIFFERENT FAULT from a guest ignoring a request, and the advice
    //for it is different.
    waitFails = true;

    const out = await lifecycle().stop('kit-1', { force: true });

    assert.match(out.note, /VirtualBox still reports it running/);
    assert.match(out.note, /VirtualBox itself being stuck rather than the guest/);
    assert.ok(said.some((l) => /WARN power pulled/.test(l)) === false, 'it said the power pull worked');
});

test('stopping takes a turn too, so it does not race a start', async () => {
    await lifecycle().stop('kit-1');
    assert.deepEqual(turns, ['during:being shut down']);
});

//---- how long it waits ------------------------------------------------------------

test('generous for a request, brief for a pull', () => {
    //A GUEST SHUTTING DOWN TIDILY takes as long as its services take; a power
    //cut is immediate.
    assert.equal(howLong(undefined, false), 120000);
    assert.equal(howLong(undefined, true), 30000);
});

test('and what somebody asked for, within reason', () => {
    assert.equal(howLong(60, false), 60000);
    assert.equal(howLong(1, false), 5000, 'it would have waited less than five seconds');
    assert.equal(howLong(99999, false), 900000, 'it would have waited a day');
    assert.equal(howLong('45', false), 45000);
    assert.equal(howLong('nonsense', false), 120000);
});

test('force is what somebody typed as well as what somebody meant', () => {
    //THE COMMAND LINE HANDS STRINGS, and `force=true` from a shell is the four
    //characters. Read as false it would ask politely and report a machine that
    //ignored it.
    assert.equal(isPull(true), true);
    assert.equal(isPull('true'), true);
    assert.equal(isPull(false), false);
    assert.equal(isPull('false'), false);
    assert.equal(isPull(undefined), false);
});

//---- and waiting for a kernel ---------------------------------------------------------

test('a console that grows means the kernel is up', async () => {
    let size = 100;
    const s = makeSpeaking({
        serialFor: () => 'the-console.log',
        sizeOf: () => size,
        portOf: async () => '/some/pipe',
        vbox: {},
        now: (() => { let t = 0; return () => (t += 500); })(),
        sleep: async () => { size += 10; }
    });

    const out = await s.untilItSpeaks('kit-1', { info: () => {}, good: () => said.push('spoke'), warn: () => {}, bad: () => {} });

    assert.equal(out.spoke, true);
    assert.ok(said.includes('spoke'));
});

test('a machine with no console capture says nothing, and that is not a failure', async () => {
    const s = makeSpeaking({ serialFor: () => null, sizeOf: () => 0, portOf: async () => null, vbox: {} });
    const out = await s.untilItSpeaks('kit-1', { info: (t) => said.push(t), good: () => {}, warn: () => {}, bad: () => {} });

    assert.deepEqual(out, { spoke: false, why: 'no console' });
    assert.ok(said.some((l) => /vmSerial turns that on/.test(l)));
});

test('and one with no serial PORT is the case that pulled the power three times', async () => {
    //THE REGISTER SAYING "captured" is a statement about a file on THIS host;
    //whether anything is WRITING to it is a fact about the VirtualBox machine. A
    //rebuild makes a new machine with no port, leaving a file that will never
    //grow again — and silence from that read as "the kernel never came up", so a
    //healthy install got its power pulled three times, mid-install.
    const s = makeSpeaking({
        serialFor: () => 'the-console.log',
        sizeOf: () => 0,
        portOf: async () => 'off',
        vbox: { stop: async () => { throw new Error('it must not come to this'); } }
    });

    const out = await s.untilItSpeaks('kit-1', { info: (t) => said.push(t), good: () => {}, warn: () => {}, bad: () => {} });

    assert.deepEqual(out, { spoke: false, why: 'no port' });
    assert.ok(said.some((l) => /its silence says nothing — not treating that as a failed start/.test(l)));
});

test('a machine that stays silent has its power pulled and is started again', async () => {
    //A MACHINE THAT HAS NOT REACHED A KERNEL has nothing to answer an ACPI
    //button with, so asking politely is a minute spent proving what its silence
    //already said.
    const pulls = [];
    let t = 0;

    const s = makeSpeaking({
        serialFor: () => 'the-console.log',
        sizeOf: () => 0,
        portOf: async () => '/some/pipe',
        vbox: {
            stop: async (n, pull) => pulls.push({ n, pull }),
            waitUntilOff: async () => {},
            waitUntilUnlocked: async () => {},
            start: async () => {}
        },
        now: () => (t += 20000),
        sleep: async () => {}
    });

    const out = await s.untilItSpeaks('kit-1',
        { info: () => {}, good: () => {}, warn: (l) => said.push(l), bad: (l) => said.push('BAD ' + l) },
        { capMs: 60000, tries: 3 });

    assert.equal(out.spoke, false);
    assert.equal(pulls.length, 2, 'it did not try again the number of times it was asked to');
    assert.deepEqual(pulls.map((p) => p.pull), [true, true], 'it asked politely a machine with no kernel');
    assert.ok(said.some((l) => /BAD.*said nothing on its console after 3 start\(s\)/.test(l)), said.join(' | '));
});
