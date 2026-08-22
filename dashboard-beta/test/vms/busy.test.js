const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makeDoing = require('../../src/app/vms/busy/doing');
const makeTurns = require('../../src/app/vms/busy/turns');

//---------------------------------------------------------------------------
//NOT DOING TWO OF THESE AT ONCE, at two scopes.
//
//PER MACHINE: snapshot, install and restore each leave a machine half-way in
//between, and VirtualBox answers the second with a wall of COM text about a
//session lock. Refused here, where the refusal can name the machine and the job.
//
//ACROSS THE HOST: two DIFFERENT machines booting at once do not take twice as
//long, they WEDGE. One sat on its splash screen for eleven minutes, ignored its
//power button, and had to have the plug pulled — with nothing wrong with it.
//
//NOTHING HERE SLEEPS. Every timer is injected, so a five-second settle and a
//twelve-minute limit are things a test SAYS rather than sits through — and a
//test that sits is one that hangs instead of failing.
//---------------------------------------------------------------------------

//A BOUND ON EVERY WAIT. An unsettled promise hangs rather than fails, and a hang
//cannot be reported.
function within(what, p) {
    return Promise.race([
        p,
        new Promise((_, no) => setTimeout(
            () => no(new Error(what + ' never settled')), 5000).unref())
    ]);
}

//---- one long thing at a time, per machine -----------------------------------

let doing;
beforeEach(() => { doing = makeDoing(); });

test('it holds nothing to begin with', () => {
    //THE STARTING STATE IS THE ONE EVERY OTHER CLAIM HERE IS MEASURED FROM, and
    //a record that came up believing a machine was busy would refuse the first
    //piece of work this host was ever asked to do.
    assert.deepEqual(doing.all(), []);
    assert.equal(doing.what('one'), null);
});

test('a machine in the middle of something refuses the second thing, by name', () => {
    doing.claim('runner1', 'being installed');

    //"IT IS BUSY" IS NOT ACTIONABLE. "runner1 is being installed" is.
    assert.throws(() => doing.claim('runner1', 'being snapshotted'), (e) => {
        assert.match(e.message, /"runner1" is already being installed/);
        assert.match(e.message, /session lock/);
        return true;
    });
});

test('and it refuses rather than waiting', () => {
    //WAITING WOULD MEAN A COMMAND THAT APPEARS TO HANG FOR TWENTY-FIVE MINUTES.
    //The honest answer to "start this machine" while it is being installed is
    //no, not later — so this is synchronous and throws.
    doing.claim('one', 'being installed');
    assert.throws(() => doing.claim('one', 'x'));
});

test('a different machine is not blocked by it', () => {
    doing.claim('one', 'being installed');
    assert.doesNotThrow(() => doing.claim('two', 'being snapshotted'));
});

test('what it is doing can be asked, and a free machine answers null', () => {
    assert.equal(doing.what('one'), null);
    doing.claim('one', 'being restored');
    assert.equal(doing.what('one'), 'being restored');
});

test('a machine named like a thing on Object.prototype is still free', () => {
    //`doing.get(name) || null` OVER A PLAIN OBJECT would answer with a function
    //for a machine called "constructor" — and every claim on it would be refused
    //with a message about a job nobody started.
    assert.equal(doing.what('constructor'), null);
    assert.equal(doing.what('toString'), null);
    assert.doesNotThrow(() => doing.claim('constructor', 'being installed'));
});

test('during() lets go whatever happens, including when the job throws', async () => {
    //ONE FAILURE MUST NOT LEAVE A MACHINE PERMANENTLY UNUSABLE with nothing
    //running on it, refused in the name of a job that finished long ago.
    await assert.rejects(() => doing.during('one', 'being installed', async () => {
        throw new Error('the installer fell over');
    }), /the installer fell over/);

    assert.equal(doing.what('one'), null);
    assert.doesNotThrow(() => doing.claim('one', 'being installed'));
});

test('during() holds the machine for as long as the job runs', async () => {
    let inside = null;
    await within('during()', doing.during('one', 'being snapshotted', async () => {
        inside = doing.what('one');
        //AND A SECOND ONE IS REFUSED WHILE IT RUNS, which is the whole point.
        assert.throws(() => doing.claim('one', 'being installed'));
        return 'done';
    }));

    assert.equal(inside, 'being snapshotted');
    assert.equal(doing.what('one'), null);
});

test('everything in flight can be listed, for a pane that says what is going on', () => {
    doing.claim('one', 'being installed');
    doing.claim('two', 'being snapshotted');

    assert.deepEqual(doing.all().sort((a, b) => a.name.localeCompare(b.name)),
        [{ name: 'one', job: 'being installed' }, { name: 'two', job: 'being snapshotted' }]);
});

test('releasing something that was never claimed is not an error', () => {
    assert.equal(doing.release('nobody'), false);
});

//---- one machine coming up at a time, across the host -------------------------

let turns, clock;

//A HAND-DRIVEN CLOCK. Every timer is recorded rather than run, so the test says
//when five seconds and twelve minutes pass.
function newClock() {
    const timers = [];
    return {
        timers,
        after(ms, fn) { const t = { ms, fn, live: true }; timers.push(t); return t; },
        cancel(t) { if (t) t.live = false; },
        //Fire the earliest live timer of exactly this length.
        fire(ms) {
            const t = timers.find((x) => x.live && x.ms === ms);
            assert.ok(t, 'nothing was waiting ' + ms + 'ms: ' + timers.map((x) => x.ms + (x.live ? '' : ' (dead)')).join(', '));
            t.live = false;
            t.fn();
        },
        pending(ms) { return timers.filter((x) => x.live && x.ms === ms).length; }
    };
}

beforeEach(() => {
    clock = newClock();
    turns = makeTurns({ after: clock.after, cancel: clock.cancel, settleMs: 5000 });
});

//A turn that is held until the test says to let go.
function hold(name, opts) {
    let letGo;
    const held = new Promise((r) => { letGo = r; });
    const ran = turns.comingUp(name, () => held, opts);
    return { ran, letGo };
}

test('the first machine to ask comes up immediately', async () => {
    const a = hold('one');
    await within('the first turn', Promise.resolve());

    assert.deepEqual(turns.booting(), { name: 'one', kind: 'boot', depth: 1 });
    a.letGo();
    await within('a', a.ran);
});

test('a second machine waits rather than booting into the first', async () => {
    const a = hold('one');
    await null;

    let started = false;
    const b = turns.comingUp('two', async () => { started = true; });

    await null; await null;
    //TWO AT ONCE DO NOT TAKE TWICE AS LONG, THEY WEDGE.
    assert.equal(started, false, 'the second machine started while the first was coming up');
    assert.deepEqual(turns.queued(), [{ name: 'two', kind: 'boot' }]);

    a.letGo();
    await within('the first turn ending', a.ran);

    //AND IT IS NOT HANDED OVER ON THE FIRST BYTE. The seconds after the kernel
    //is up are the heaviest of the whole boot — the initrd is handing over and
    //udev is bringing devices up — so there is a settle in between.
    assert.equal(started, false, 'the next machine started with no settle at all');
    assert.equal(clock.pending(5000), 1, 'nothing was waiting out the settle');

    clock.fire(5000);
    await within('the second turn', b);
    assert.equal(started, true);
});

test('the host is held through the settle, not left ownerless', async () => {
    const a = hold('one');
    await null;
    const b = turns.comingUp('two', async () => {});
    await null;

    a.letGo();
    await within('the first turn ending', a.ran);

    //ANYTHING ARRIVING DURING THE PAUSE WOULD SEE A FREE HOST and start
    //immediately, which is the race this pause exists to close.
    assert.deepEqual(turns.booting(), { name: 'two', kind: 'boot', depth: 1 });

    clock.fire(5000);
    await within('b', b);
});

test('the same machine taking its own turn again does not wait for itself', async () => {
    //BRINGING A MACHINE UP HOLDS THIS FOR THE WHOLE BOOT and then starts it,
    //which takes a turn as well — so without this the one path that matters most
    //waits for a turn only it could give up, for ever.
    let inner = false;
    await within('the nested turn', turns.comingUp('one', async () => {
        await turns.comingUp('one', async () => { inner = true; });
        //AND THE INNER ONE ENDING IS NOT THE TURN ENDING.
        assert.deepEqual(turns.booting(), { name: 'one', kind: 'boot', depth: 1 });
    }));

    assert.equal(inner, true);
    assert.equal(turns.booting(), null);
});

test('the nesting is counted, not a flag, so three deep still unwinds once', async () => {
    await within('three deep', turns.comingUp('one', async () => {
        await turns.comingUp('one', async () => {
            await turns.comingUp('one', async () => {
                assert.equal(turns.booting().depth, 3);
            });
            assert.equal(turns.booting().depth, 2);
        });
        assert.equal(turns.booting().depth, 1);
    }));
    assert.equal(turns.booting(), null);
});

test('a machine that waited too long is refused, and names what it waited for', async () => {
    const a = hold('one');
    await null;

    const b = turns.comingUp('two', async () => {}, { waitMs: 12 * 60000 });
    await null;

    clock.fire(12 * 60000);
    await assert.rejects(() => within('the refusal', b), (e) => {
        assert.match(e.message, /Waited 12 minutes for "one"/);
        assert.match(e.message, /two at once wedges this host/);
        return true;
    });

    //AND IT IS OFF THE QUEUE, so the machine ahead of it does not later hand the
    //host to something that already gave up.
    assert.deepEqual(turns.queued(), []);

    a.letGo();
    await within('a', a.ran);
    assert.equal(turns.booting(), null, 'the host was handed to a boot that had already been refused');
});

test('only the wait is bounded — the work itself takes as long as it takes', async () => {
    //AN INSTALL IS HALF AN HOUR BY NATURE, and a timeout around the work would
    //be a machine abandoned half-built.
    const a = hold('one', { waitMs: 1000 });
    await null;

    assert.equal(clock.pending(1000), 0, 'it put a timer around the work rather than the wait');
    a.letGo();
    await within('a', a.ran);
});

test('a waiting machine is told what it is waiting for', async () => {
    const a = hold('one');
    await null;

    const told = [];
    const b = turns.comingUp('two', async () => {}, { onWait: (who) => told.push(who) });
    await null;

    assert.deepEqual(told, ['one']);

    a.letGo();
    await within('a', a.ran);
    clock.fire(5000);
    await within('b', b);
});

test('a turn is given up even when the boot throws', async () => {
    await assert.rejects(() => turns.comingUp('one', async () => { throw new Error('it never came up'); }),
        /it never came up/);

    //OTHERWISE ONE FAILED BOOT STOPS EVERY MACHINE ON THE HOST, for ever.
    assert.equal(turns.booting(), null);
});

test('machines take their turns in the order they asked', async () => {
    const a = hold('one');
    await null;

    const order = [];
    const b = turns.comingUp('two', async () => { order.push('two'); });
    await null;
    const c = turns.comingUp('three', async () => { order.push('three'); });
    await null;

    a.letGo();
    await within('a', a.ran);
    clock.fire(5000);
    await within('b', b);

    clock.fire(5000);
    await within('c', c);

    assert.deepEqual(order, ['two', 'three']);
});
