const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makeStarting = require('../../src/app/queue/starting');

//---------------------------------------------------------------------------
//GETTING A MACHINE UP, CLEAN, AND READY TO BE TALKED TO.
//
//THE CLAIM WORTH THE MOST: the host's turn covers the boot and NOT the dial-in.
//What two machines fight over is the snapshot restore and the cold kernel boot;
//after that a machine is waiting on services and a network, and the next one can
//start into that quite happily. On a queue giving work to several machines that
//is one a minute rather than one every three.
//
//AND THE SECOND: a machine already sitting on its base snapshot is not restored
//again. Doing it twice back to back, on a machine VirtualBox had only just
//finished restoring, is the shape of a race — and it produced one: a machine
//that started to a black screen and never booted.
//---------------------------------------------------------------------------

let asked, said, to, vm, turns, held;

beforeEach(() => {
    asked = [];
    said = [];
    turns = [];
    held = null;

    vm = { name: 'kit-1', running: false, connected: true, baseSnapshot: 'base' };

    to = {
        info: (m) => said.push(m), warn: (m) => said.push('WARN ' + m),
        bad: (m) => said.push('BAD ' + m), good: (m) => said.push(m)
    };
});

function starting(over) {
    return makeStarting(Object.assign({
        call: async (what, args) => {
            asked.push(what);
            if (what === 'vmList') return { vms: vm ? [vm] : [] };
            if (what === 'vmSnapshots') return { current: vm && vm.current !== undefined ? vm.current : 'base' };
            return { ok: true };
        },
        //THE TURN, RECORDED RATHER THAN TAKEN. What is inside it is the whole
        //claim of this file.
        busy: {
            comingUp: async (name, fn, opts) => {
                held = { name, opts };
                turns.push('turn opened');
                try { return await fn(); } finally { turns.push('turn closed'); }
            }
        },
        //`settle` RECORDS WHAT IT WAS ASKED TO WAIT FOR and answers at once —
        //what it does with a clock is test/queue/queue-waiting.test.js's job.
        settle: async (spec) => {
            turns.push('waited for ' + spec.what);
            asked.push('settle:' + spec.what);
            return vm;
        }
    }, over || {}));
}

//---- what the turn covers ------------------------------------------------------

test('the boot is inside the turn and the dial-in is outside it', async () => {
    await starting().bringUp(to, 'kit-1');

    //THE HOST IS HANDED ON AS SOON AS THE CONSOLE SPEAKS. Waiting for the
    //dial-in inside the turn is what made it one machine every three minutes.
    const open = turns.indexOf('turn opened');
    const close = turns.indexOf('turn closed');
    const dial = turns.indexOf('waited for it to dial in');

    assert.ok(open >= 0 && close > open, turns.join(' | '));
    assert.ok(dial > close, 'the dial-in was waited for inside the turn: ' + turns.join(' | '));
});

test('and the console is what ends the turn', async () => {
    await starting().bringUp(to, 'kit-1');

    const inTurn = asked.slice(asked.indexOf('vmStart'), asked.indexOf('settle:it to dial in'));
    assert.ok(inTurn.includes('vmAwait'), asked.join(' | '));
});

test('a machine that cannot say anything does not hold the host', async () => {
    //A MACHINE WITH NO CONSOLE CAPTURE cannot speak, which vmAwait reports and
    //does not treat as an error. Holding the host for one that will never answer
    //is worse than handing it on.
    const s = starting({
        call: async (what) => {
            asked.push(what);
            if (what === 'vmAwait') throw new Error('it has no console. Give it one with vmSerial');
            if (what === 'vmList') return { vms: [vm] };
            if (what === 'vmSnapshots') return { current: 'base' };
            return {};
        }
    });

    await s.bringUp(to, 'kit-1');
    assert.ok(said.some((m) => /handing the host on anyway/.test(m)), said.join(' | '));
    assert.ok(turns.includes('turn closed'));
});

test('a machine waiting its turn is told what it is waiting for', async () => {
    await starting().bringUp(to, 'kit-1');
    held.opts.onWait('kit-2');
    assert.ok(said.some((m) => /waiting for "kit-2" to get its kernel up/.test(m)), said.join(' | '));
});

//---- clean before it starts -------------------------------------------------------

test('a machine already on its base snapshot is not restored again', async () => {
    vm.current = 'base';
    await starting().startItUp(to, 'kit-1');

    //THE SAME OPERATION TWICE, BACK TO BACK, on a machine VirtualBox had only
    //just finished restoring. It produced a black screen that never booted.
    assert.equal(asked.includes('vmSnapshotRestore'), false, asked.join(' | '));
    assert.ok(said.some((m) => /already clean at "base"/.test(m)), said.join(' | '));
    assert.ok(asked.includes('vmStart'));
});

test('and one that is not is rolled back, keeping its borrow', async () => {
    vm.current = 'something-else';
    let sent = null;
    await starting({
        call: async (what, args) => {
            asked.push(what);
            if (what === 'vmSnapshotRestore') sent = args;
            if (what === 'vmList') return { vms: [vm] };
            if (what === 'vmSnapshots') return { current: 'something-else' };
            return {};
        }
    }).startItUp(to, 'kit-1');

    //WITHOUT keepBorrow, borrowing a machine that happens to be RUNNING
    //un-borrows it on the way up — and the queue then sees a machine somebody is
    //using as free.
    assert.deepEqual(sent, { name: 'kit-1', title: 'base', keepBorrow: true });
});

test('a running machine is stopped, waited for, and only then rolled back', async () => {
    vm.running = true;
    vm.current = 'base';

    await starting().startItUp(to, 'kit-1');

    const at = (w) => { const i = asked.indexOf(w); assert.ok(i >= 0, w + ' never happened: ' + asked.join(' | ')); return i; };
    assert.ok(at('vmStop') < at('settle:it to stop'));
    assert.ok(at('settle:it to stop') < at('vmStart'));

    //AND IT IS ROLLED BACK EVEN THOUGH IT IS ALREADY AT BASE, because it was
    //running: what a running machine has in memory is not what the snapshot has.
    assert.ok(asked.includes('vmSnapshotRestore'), asked.join(' | '));
});

test('a machine that is off and already clean is neither stopped nor restored', async () => {
    vm.running = false;
    vm.current = 'base';

    await starting().startItUp(to, 'kit-1');

    assert.equal(asked.includes('vmStop'), false);
    assert.equal(asked.includes('vmSnapshotRestore'), false);
    assert.deepEqual(asked.filter((a) => a === 'vmStart'), ['vmStart']);
});

test('a machine that is gone is said plainly, before anything is done to it', async () => {
    vm = null;
    await assert.rejects(() => starting().startItUp(to, 'kit-1'), /"kit-1" is gone/);
    assert.deepEqual(asked, ['vmList'], asked.join(' | '));
});

//---- and it all goes through the actions --------------------------------------------

test('nothing reaches VirtualBox except through an action', async () => {
    await starting().bringUp(to, 'kit-1');

    //EVERY REFUSAL THOSE ACTIONS CARRY applies to the queue exactly as it
    //applies to a person pressing the button. A second way in is a second set of
    //rules, and the second set is always the one that turns out to be wrong.
    const verbs = asked.filter((a) => !a.startsWith('settle:'));
    assert.ok(verbs.every((v) => /^vm[A-Z]/.test(v)), 'something bypassed the actions: ' + verbs.join(', '));
});
