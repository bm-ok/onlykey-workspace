const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makeReading = require('../../src/app/vms/vbox/reading');
const { names, fields } = require('../../src/app/vms/vbox/reading');

//---------------------------------------------------------------------------
//what VirtualBox says about a machine, and how to wait for it to mean it.
//
//AGAINST TEXT VirtualBox WOULD HAVE PRINTED, which is the only way to test a
//parser without a hypervisor — and against a clock that can be moved, which is
//the only way to test a wait without waiting.
//
//THE CLAIM THAT COST THE MOST: powered off is NOT ready. VirtualBox reports a
//machine as poweroff while it is still holding the session, and the operations
//that need the disk — restoring, snapshotting, deleting a snapshot — are not
//refused in that window so much as RACED. A restore issued into it left a
//machine that started to a black screen and never booted: nothing failed and
//nothing was logged.
//---------------------------------------------------------------------------

let read, asked, answers, clock, slept, said;

beforeEach(() => {
    asked = [];
    answers = {};
    clock = 1000;
    slept = [];
    said = [];

    const run = async (args, how) => {
        //THE OPTIONS TOO, not only the command. Without them the check that
        //reads are asked QUIETLY could not fail: dropping `quiet` changes
        //nothing a stub that ignores it can see.
        asked.push({ args: args.join(' '), quiet: !!(how && how.quiet) });
        const key = args.join(' ');
        const said = answers[key];
        if (said === undefined) throw new Error('VBoxManage: no such thing: ' + key);
        return typeof said === 'function' ? said() : said;
    };

    read = makeReading(run, {
        now: () => clock,
        //TIME PASSES BY BEING ASKED TO, so a three-minute wait is a test that
        //takes no time at all.
        sleep: async (ms) => { slept.push(ms); clock += ms; },
        say: { info: (t) => said.push(t), warn: (t) => said.push(t) }
    });
});

//---------------------------------------------------------------------------
//PARSING WHAT IT PRINTED.
//---------------------------------------------------------------------------

test('a machine list is a name and a uuid per line', () => {
    const out = names('"kit-1" {aaaa-1111}\n"kit-2" {bbbb-2222}\n');

    assert.deepEqual(out, [
        { name: 'kit-1', uuid: 'aaaa-1111' },
        { name: 'kit-2', uuid: 'bbbb-2222' }
    ]);
});

test('a name with a space in it survives, because splitting on whitespace would lose it', () => {
    //AND IT IS EXACTLY THE ONE that would silently stop being listed.
    assert.deepEqual(names('"my machine" {aaaa-1111}'), [{ name: 'my machine', uuid: 'aaaa-1111' }]);
});

test('anything that is not a machine line is not a machine', () => {
    assert.deepEqual(names(''), []);
    assert.deepEqual(names('\n\n'), []);
    assert.deepEqual(names('WARNING: something happened'), []);
});

test('machinereadable output is key and value, with the quotes optional on both', () => {
    const out = fields([
        'name="kit-1"',
        'VMState="poweroff"',
        'SessionState="Unlocked"',
        'memory=2048',
        'CfgFile="C:/vms/kit-1/kit-1.vbox"'
    ].join('\n'));

    assert.equal(out.name, 'kit-1');
    assert.equal(out.VMState, 'poweroff');
    assert.equal(out.memory, '2048');
    assert.equal(out.CfgFile, 'C:/vms/kit-1/kit-1.vbox');
});

//---------------------------------------------------------------------------
//WHAT IT IS DOING.
//---------------------------------------------------------------------------

test('a machine that is not there is missing, which is a state and not a failure', async () => {
    //A MACHINE THAT HAS BEEN DELETED IS THE ORDINARY END OF ONE. Every caller
    //asking "what is it doing" would otherwise have to wrap this in a try.
    assert.equal(await read.state('gone'), 'missing');
    assert.equal(await read.exists('gone').catch(() => 'threw'), 'threw',
        'exists has nothing to list, which is a real failure');
});

test('the states that count as off include the ones nobody chose', async () => {
    for (const s of ['poweroff', 'aborted', 'saved', 'aborted-saved']) {
        answers['showvminfo one --machinereadable'] = 'VMState="' + s + '"';
        assert.equal(await read.isOff('one'), true, s + ' should count as off');
    }

    answers['showvminfo one --machinereadable'] = 'VMState="running"';
    assert.equal(await read.isOff('one'), false);
});

test('a machine that is there is listed, and one that is not is not', async () => {
    answers['list vms'] = '"kit-1" {a}\n"kit-2" {b}';
    assert.equal(await read.exists('kit-1'), true);
    assert.equal(await read.exists('kit-9'), false);
});

//---------------------------------------------------------------------------
//WAITING.
//---------------------------------------------------------------------------

test('a wait returns as soon as the state is what was asked for', async () => {
    answers['showvminfo one --machinereadable'] = 'VMState="running"';

    assert.equal(await read.waitForState('one', (s) => s === 'running'), true);
    assert.deepEqual(slept, [], 'it waited for a state that was already true');
});

test('and gives up on a deadline rather than for ever', async () => {
    answers['showvminfo one --machinereadable'] = 'VMState="running"';

    assert.equal(await read.waitForState('one', (s) => s === 'poweroff', { timeout: 10000 }), false);
    //IT ASKED, WAITED, ASKED AGAIN — rather than returning false at once.
    assert.ok(slept.length >= 2, 'it gave up without waiting: ' + slept.join(', '));
});

test('a machine that goes away while being waited for counts as off', async () => {
    let n = 0;
    answers['showvminfo one --machinereadable'] = () => {
        n++;
        if (n < 3) return 'VMState="running"';
        throw new Error('Could not find a registered machine');
    };

    //WITHOUT THIS, waiting for a machine that was deleted mid-wait runs to the
    //full timeout for no reason.
    assert.equal(await read.waitUntilOff('one'), true);
});

//---------------------------------------------------------------------------
//POWERED OFF IS NOT READY.
//---------------------------------------------------------------------------

test('it waits for the session to unlock, not merely for the machine to be off', async () => {
    let n = 0;
    answers['showvminfo one --machinereadable'] = () => {
        n++;
        //POWEROFF THROUGHOUT. The machine is off the whole time and the session
        //is still held — which is the window a restore gets raced in.
        return 'VMState="poweroff"\nSessionState="' + (n < 3 ? 'Locked' : 'Unlocked') + '"';
    };

    await read.waitUntilUnlocked('one');
    assert.equal(n, 3, 'it stopped at the first poweroff');
    assert.match(said.join(' | '), /waiting for the VirtualBox session to unlock/);
});

test('a session that never unlocks is tried anyway, and says so', async () => {
    answers['showvminfo one --machinereadable'] = 'VMState="poweroff"\nSessionState="Locked"';

    await read.waitUntilUnlocked('one', { timeout: 6000 });

    //WAITING FOR EVER ON A SESSION THAT WILL NOT CLEAR leaves a machine nobody
    //can do anything with. The retry in the gate is the second line of defence,
    //and this says out loud that it is being relied on.
    assert.match(said.join(' | '), /still "Locked" after 6s; trying anyway/);
});

test('a machine that is gone is already unlocked', async () => {
    //ALREADY GONE IS THE OUTCOME THIS WAS WAITING FOR.
    await read.waitUntilUnlocked('gone');
    assert.deepEqual(slept, []);
});

test('a session that is already unlocked waits for nothing', async () => {
    answers['showvminfo one --machinereadable'] = 'VMState="poweroff"\nSessionState="Unlocked"';
    await read.waitUntilUnlocked('one');
    assert.deepEqual(slept, []);
});

test('a machine that reports no session at all is taken as unlocked', async () => {
    //VirtualBox leaves the field out rather than saying "Unlocked" in some
    //states, and treating absent as locked would wait the full minute every
    //time.
    answers['showvminfo one --machinereadable'] = 'VMState="poweroff"';
    await read.waitUntilUnlocked('one');
    assert.deepEqual(slept, []);
});

//---------------------------------------------------------------------------
//AND IT ASKS QUIETLY.
//---------------------------------------------------------------------------

test('reads are asked without narrating, because the window asks constantly', async () => {
    answers['list vms'] = '"kit-1" {a}';
    answers['showvminfo kit-1 --machinereadable'] = 'VMState="poweroff"';

    await read.listAll();
    await read.state('kit-1');

    //EVERY ONE OF THESE RUNS ON A DRAW LOOP. A log line each would BE the log.
    assert.deepEqual(asked, [
        { args: 'list vms', quiet: true },
        { args: 'showvminfo kit-1 --machinereadable', quiet: true }
    ]);
});
