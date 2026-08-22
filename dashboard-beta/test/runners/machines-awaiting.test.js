const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makeAwaiting = require('../../src/app/runners/machines/awaiting');
const { howLong } = require('../../src/app/runners/machines/awaiting');

//---------------------------------------------------------------------------
//WAITING FOR A MACHINE TO GET SOMEWHERE.
//
//FOUR WAITS BEHIND ONE NAME, and the claim worth the most is that they are not
//interchangeable. `speaking` is the earliest thing a machine can say — its
//kernel is up and running code — and `connected` is minutes later. Anything
//deciding whether the host is free again wants the first; anything about to
//send a command wants the second.
//
//AND THE SECOND: waiting for a PATTERN is how an unattended install is watched
//at all. Twenty-five minutes with no agent, no network and no channel, and the
//steps are readable one line at a time.
//
//A PATTERN RATHER THAN A LIST OF STAGES, because the stages belong to the
//installer and the distribution. A list here would be a copy of somebody else's
//boot sequence, out of date the moment it is written.
//---------------------------------------------------------------------------

let clock, said, console_, agents, states, spoke, machines;

beforeEach(() => {
    clock = 0;
    said = [];
    console_ = null;             //what the console file holds, or null for not-yet-written
    agents = [];
    states = { off: true, running: false };
    spoke = { spoke: true, took: 3 };
    machines = [{ name: 'kit-1' }];
});

function awaiting(over) {
    return makeAwaiting(Object.assign({
        ours: {
            get: (n) => {
                const vm = machines.filter((v) => v.name === n)[0];
                if (!vm) throw new Error('"' + n + '" is not a virtual machine this app made.');
                return vm;
            }
        },
        vbox: {
            waitUntilOff: async () => { if (!states.off) throw new Error('still running'); },
            waitForState: async (n, is) => { if (!is(states.now)) throw new Error('not there'); }
        },
        channel: { list: () => agents },
        speaking: { untilItSpeaks: async () => spoke },
        consoleFor: (n) => '/serial/' + n + '.log',
        readFile: () => {
            if (console_ === null) throw new Error('ENOENT');
            return console_;
        },
        say: () => ({
            info: (t) => said.push(t), warn: (t) => said.push('WARN ' + t),
            bad: (t) => said.push('BAD ' + t), good: (t) => said.push('GOOD ' + t)
        }),
        now: () => clock,
        sleep: async (ms) => { clock += ms; }
    }, over || {}));
}

//---- how long it waits --------------------------------------------------------

test('five minutes by default, and what somebody asked for within reason', () => {
    assert.equal(howLong(undefined), 300000);
    assert.equal(howLong(60), 60000);
    assert.equal(howLong('90'), 90000);
    assert.equal(howLong(1), 5000, 'it would have given up in under five seconds');
    assert.equal(howLong(99999), 3600000, 'it would have waited a day');
    assert.equal(howLong('nonsense'), 300000);
});

//---- waiting for the console to say something in particular ----------------------

test('a line that matches is found, and handed back without the colour', () => {
    //SO WHATEVER IS WAITING can report WHAT it saw rather than that it saw
    //something. A boot is full of escape sequences.
    //
    //BUILT WITH String.fromCharCode RATHER THAN TYPED. A real escape byte in a
    //source file is the quietest thing there is — invisible in every editor, and
    //it makes later string edits silently miss. ../rules/bytes.test.js exists to
    //catch it, and caught this when it was typed.
    const ESC = String.fromCharCode(27);
    const NEWLINE = String.fromCharCode(10);

    console_ = [
        'Welcome to Ubuntu',
        ESC + '[32m  ok ' + ESC + '[0m Reached target Cloud-init target',
        'login:'
    ].join(NEWLINE);

    return awaiting().until('kit-1', { for: 'console', find: 'cloud-init' }).then((out) => {
        assert.equal(out.was, 'said');

        //WHAT THE APP BEING PORTED FROM ACTUALLY PRODUCES, and it is worth being
        //exact about: the pattern takes off the BRACKET SEQUENCE and leaves the
        //escape byte itself. So a line comes back readable but not clean.
        //
        //Left as it is rather than tightened, because following that app is the
        //rule here and this is what it does. It is written down so that whoever
        //decides to tighten it is deciding, rather than discovering.
        assert.equal(out.line, ESC + '  ok ' + ESC + ' Reached target Cloud-init target');
        assert.equal(out.line.includes('[32m'), false, 'the colour sequence survived');
        assert.match(out.note, /said something matching \/cloud-init\/ on its console after \d+s/);
    });
});

test('the pattern is not case-sensitive, because a boot shouts and whispers', async () => {
    console_ = 'REACHED TARGET MULTI-USER';
    const out = await awaiting().until('kit-1', { for: 'console', find: 'reached target' });
    assert.equal(out.was, 'said');
});

test('a file that has not been written yet is one of the things being waited for', async () => {
    //AN INSTALL WRITES ITS CONSOLE WHEN IT STARTS, and waiting can begin before
    //that. A missing file is not an error here.
    let looks = 0;
    const a = awaiting({
        readFile: () => {
            if (++looks < 3) throw new Error('ENOENT');
            return 'Reached target Cloud-init target';
        }
    });

    const out = await a.until('kit-1', { for: 'console', find: 'cloud-init' });
    assert.equal(out.was, 'said');
    assert.ok(looks >= 3);
});

test('and one that never says it gives up, naming what would show what it DID say', async () => {
    console_ = 'nothing of interest here';

    await assert.rejects(() => awaiting().until('kit-1', { for: 'console', find: 'cloud-init', seconds: 30 }),
        /did not say anything matching \/cloud-init\/ on its console within \d+s/);
    await assert.rejects(() => awaiting().until('kit-1', { for: 'console', find: 'cloud-init', seconds: 30 }),
        /vmLog --name kit-1 --which serial is what it did say/);
});

test('the file is read rather than watched, and not in a tight loop', async () => {
    //THERE IS NO EVENT TO SUBSCRIBE TO — it is written by the VirtualBox process
    //a line at a time. A read of a local file every second and a half costs
    //nothing next to the thing being waited for.
    let looks = 0;
    const a = awaiting({ readFile: () => { looks++; throw new Error('ENOENT'); } });

    await assert.rejects(() => a.until('kit-1', { for: 'console', find: 'x', seconds: 30 }));
    assert.ok(looks > 1 && looks < 40, 'it looked ' + looks + ' times in 30 seconds');
});

//---- or for it to say anything at all ---------------------------------------------

test('speaking is the earliest thing a machine can say', async () => {
    //AND THE MOST USEFUL for anything deciding whether the host is free again.
    const out = await awaiting().until('kit-1', { for: 'speaking' });

    assert.equal(out.was, 'speaking');
    assert.match(out.note, /started talking after \d+s/);
});

test('and `console` is the same wait under the other name', async () => {
    const out = await awaiting().until('kit-1', { for: 'console' });
    assert.equal(out.was, 'speaking');
});

test('silence is a failure, and says what kind of silence it was', async () => {
    spoke = { spoke: false, why: 'no port' };

    await assert.rejects(() => awaiting().until('kit-1', { for: 'speaking' }),
        /said nothing on its console within \d+s \(no port\)/);
});

test('tries turns waiting into supervising, and is off unless asked for', async () => {
    //SILENCE BECOMES A FAILED START rather than patience, and the machine is
    //power-cycled and listened to again. Most callers only want to know.
    let asked = null;
    const a = awaiting({
        speaking: { untilItSpeaks: async (n, to, how) => { asked = how; return spoke; } }
    });

    await a.until('kit-1', { for: 'speaking' });
    assert.equal(asked.tries, 1);

    await a.until('kit-1', { for: 'speaking', tries: 3 });
    assert.equal(asked.tries, 3);

    await a.until('kit-1', { for: 'speaking', tries: '2' });
    assert.equal(asked.tries, 2, 'the command line hands strings');
});

//---- or for the channel ------------------------------------------------------------

test('connected waits for it to dial in', async () => {
    let looks = 0;
    const a = awaiting({
        channel: { list: () => (++looks < 3 ? [] : [{ vm: 'kit-1' }]) }
    });

    const out = await a.until('kit-1', { for: 'connected' });
    assert.equal(out.was, 'connected');
    assert.match(out.note, /was connected after \d+s/);
});

test('and gone waits for it to stop being dialled in', async () => {
    agents = [{ vm: 'kit-1' }];
    let looks = 0;
    const a = awaiting({
        channel: { list: () => (++looks < 3 ? [{ vm: 'kit-1' }] : []) }
    });

    const out = await a.until('kit-1', { for: 'gone' });
    assert.equal(out.was, 'gone');
});

test('one that is already there answers at once', async () => {
    agents = [{ vm: 'kit-1' }];
    const out = await awaiting().until('kit-1', { for: 'connected' });
    assert.equal(out.took, 0);
});

test('and one that never dials in says what tells booting from stuck apart', async () => {
    //A MACHINE THAT IS POWERED ON AND NOT DIALLED IN is either still booting or
    //stuck, and only a photograph tells those apart.
    await assert.rejects(() => awaiting().until('kit-1', { for: 'connected', seconds: 30 }),
        /was not connected after \d+s/);
    await assert.rejects(() => awaiting().until('kit-1', { for: 'connected', seconds: 30 }),
        /still booting or stuck — vmScreenshot is the only thing that tells those apart/);
});

test('another machine dialling in is not this one', async () => {
    agents = [{ vm: 'kit-9' }];
    await assert.rejects(() => awaiting().until('kit-1', { for: 'connected', seconds: 10 }),
        /was not connected/);
});

//---- or for VirtualBox ---------------------------------------------------------------

test('off is asked of VirtualBox, which is the one place allowed to ask', async () => {
    const out = await awaiting().until('kit-1', { for: 'off' });
    assert.equal(out.was, 'off');
    assert.match(out.note, /was off after \d+s/);
});

test('and any other state is asked the same way', async () => {
    states.now = 'running';
    const out = await awaiting().until('kit-1', { for: 'running' });
    assert.equal(out.was, 'running');
});

test('a state it never reaches is a failure naming the state and the wait', async () => {
    states.off = false;
    await assert.rejects(() => awaiting().until('kit-1', { for: 'off', seconds: 20 }),
        /"kit-1" was not off after \d+s/);
});

//---- and what it defaults to ------------------------------------------------------------

test('asked for nothing in particular it waits for the machine to dial in', async () => {
    //WHICH IS WHAT ALMOST EVERY CALLER WANTS: a machine it can send a command
    //to.
    agents = [{ vm: 'kit-1' }];
    const out = await awaiting().until('kit-1', {});
    assert.equal(out.was, 'connected');
});

test('and a machine this app did not make is refused before any waiting', async () => {
    await assert.rejects(() => awaiting().until('somebody-elses', { for: 'connected' }),
        /is not a virtual machine this app made/);
});
