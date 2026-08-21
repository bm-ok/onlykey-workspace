const { test, mock } = require('node:test');
const assert = require('node:assert');

const clockPlugin = require('../src/app/queue/main');

//---------------------------------------------------------------------------
//the clock, and what is in flight.
//
//THE CLAIM THIS FILE IS FOR: a machine is given one piece of work at a time, and
//the record of that survives everything except the process itself.
//
//The node bundle is rebuilt on every save and this app is developed by saving
//files constantly. A queue that forgot in-flight on a save would hand a machine
//a second task on top of a worker still running in a repository it is still
//writing to — so the record lives in main.js, and what to DO with it lives in
//the half that reloads.
//
//AND THE SECOND CLAIM: it comes up stopped, every time, with no way to arrange
//otherwise. Starting it means this host rolls machines back and runs somebody's
//instructions on them unattended. That is a thing somebody switches on, not a
//thing they find already on.
//---------------------------------------------------------------------------

async function aClock() {
    const said = [];
    const logger = {
        good: (t) => said.push(['good', t]),
        warn: (t) => said.push(['warn', t]),
        bad: (t) => said.push(['bad', t]),
        info: (t) => said.push(['info', t])
    };
    let queue = null;
    await clockPlugin({ log: { on: () => logger } }, async (_e, s) => { queue = s.queue; });
    return { queue, said };
}

//---------------------------------------------------------------------------
//THE SWITCH.
//---------------------------------------------------------------------------

test('it comes up stopped, and with nothing registered to dispatch', async () => {
    const { queue } = await aClock();

    assert.equal(queue.running(), false);
    assert.equal(queue.armed(), false);
    assert.equal(queue.since(), null);
    assert.deepEqual(queue.inFlight(), []);
});

test('running and armed are different questions', async () => {
    const { queue } = await aClock();
    mock.timers.enable({ apis: ['setInterval'] });

    try {
        //ARMED AND OFF is what every start of this app looks like: the tick is
        //registered and the switch is not thrown. A board collapsing the two
        //would say "the queue is off" about a host that has no queue at all.
        queue.does(() => {});
        assert.equal(queue.armed(), true);
        assert.equal(queue.running(), false);

        queue.start('a person');
        assert.equal(queue.running(), true);
        assert.equal(queue.since().by, 'a person');
    } finally {
        queue.stop();
        mock.timers.reset();
    }
});

test('who started it is recorded, and forgotten when it stops', async () => {
    const { queue } = await aClock();
    mock.timers.enable({ apis: ['setInterval'] });

    try {
        //"why is this host handing out work" is a question somebody asks after
        //finding out that it is.
        queue.start('bmatusiak at the window');
        assert.equal(queue.since().by, 'bmatusiak at the window');
        assert.match(queue.since().at, /^\d{4}-/);

        queue.stop();
        assert.equal(queue.since(), null);
    } finally {
        mock.timers.reset();
    }
});

test('starting twice does not start a second clock', async () => {
    const { queue } = await aClock();
    mock.timers.enable({ apis: ['setInterval'] });

    try {
        let ticks = 0;
        queue.does(() => { ticks += 1; });

        assert.equal(queue.start('one'), true);
        assert.equal(queue.start('two'), false, 'the second press is not a second timer');

        mock.timers.tick(15000);
        await Promise.resolve();
        assert.equal(ticks, 1, 'two timers would tick twice and dispatch the same machine twice');
    } finally {
        queue.stop();
        mock.timers.reset();
    }
});

//---------------------------------------------------------------------------
//ONE PIECE OF WORK PER MACHINE.
//---------------------------------------------------------------------------

test('a machine already holding something cannot be claimed again', async () => {
    const { queue } = await aClock();

    assert.equal(queue.claim('runner-1', 'task #4'), true);
    //THE ONE PLACE THAT DECIDES A MACHINE IS TAKEN, so the one place that can
    //say no. A caller that checked "is it free" and then claimed would have a
    //gap between the two.
    assert.equal(queue.claim('runner-1', 'task #5'), false);
    assert.equal(queue.held('runner-1'), 'task #4', 'the first claim is not overwritten by the refused one');
});

test('releasing frees it, and releasing what was never held is not an error', async () => {
    const { queue } = await aClock();

    queue.claim('runner-1', 'task #4');
    assert.equal(queue.release('runner-1'), true);
    assert.equal(queue.held('runner-1'), null);
    assert.equal(queue.claim('runner-1', 'task #5'), true);
    assert.equal(queue.release('nobody'), false);
});

test('stopping the queue does not drop what machines are holding', async () => {
    const { queue } = await aClock();
    mock.timers.enable({ apis: ['setInterval'] });

    try {
        queue.start('a person');
        queue.claim('runner-1', 'task #4');
        queue.stop('the drill is over');

        //A STOP THAT DROPPED THE RECORD would leave a machine holding a task
        //nothing knows about. Stopping ends new work being picked up; it does
        //not reach the machines already working.
        assert.deepEqual(queue.inFlight(), [{ machine: 'runner-1', doing: 'task #4' }]);
        assert.equal(queue.claim('runner-1', 'task #5'), false, 'still held, stopped or not');
    } finally {
        mock.timers.reset();
    }
});

//---------------------------------------------------------------------------
//THE TICK IS A SLOT, NOT A FUNCTION THE CLOCK HOLDS.
//---------------------------------------------------------------------------

test('a tick taken out again is not called, and the clock says so once', async () => {
    const { queue, said } = await aClock();
    mock.timers.enable({ apis: ['setInterval'] });

    try {
        let ticks = 0;
        const off = queue.does(() => { ticks += 1; });
        queue.start('a person');

        mock.timers.tick(15000);
        await Promise.resolve();
        assert.equal(ticks, 1);

        //A SAVE. The bundle that registered this tick is torn down and takes its
        //tick with it — if the clock kept calling it, work would be dispatched by
        //code that no longer exists.
        off();
        mock.timers.tick(15000);
        mock.timers.tick(15000);
        await Promise.resolve();

        assert.equal(ticks, 1, 'the destroyed bundle is never called again');

        const warned = said.filter(([kind, t]) => kind === 'warn' && /nothing is registered to do a tick/.test(t));
        assert.equal(warned.length, 1, 'said once, not every fifteen seconds and not never');
    } finally {
        queue.stop();
        mock.timers.reset();
    }
});

test('a tick that throws does not stop the clock', async () => {
    const { queue, said } = await aClock();
    mock.timers.enable({ apis: ['setInterval'] });

    try {
        let ticks = 0;
        queue.does(() => {
            ticks += 1;
            if (ticks === 1) throw new Error('a machine was unreachable');
        });
        queue.start('a person');

        mock.timers.tick(15000);
        await Promise.resolve();
        await Promise.resolve();

        mock.timers.tick(15000);
        await Promise.resolve();

        //THE NEXT ONE MAY WELL WORK — a machine that was unreachable comes back.
        //A queue that switches itself off on one bad minute is a queue somebody
        //finds stopped hours later with no idea when.
        assert.equal(queue.running(), true);
        assert.equal(ticks, 2);
        assert.ok(said.some(([kind, t]) => kind === 'bad' && /a machine was unreachable/.test(t)));
    } finally {
        queue.stop();
        mock.timers.reset();
    }
});

test('two ticks never overlap, however long one takes', async () => {
    const { queue } = await aClock();
    mock.timers.enable({ apis: ['setInterval'] });

    try {
        let started = 0;
        let release = null;
        queue.does(() => {
            started += 1;
            return new Promise((r) => { release = r; });
        });
        queue.start('a person');

        mock.timers.tick(15000);
        await Promise.resolve();
        assert.equal(started, 1);

        //A tick brings machines up and waits on them, which takes longer than
        //the interval whenever anything is actually happening. Two overlapping
        //ticks would both see the same machine free and both give it something.
        mock.timers.tick(15000);
        mock.timers.tick(15000);
        await Promise.resolve();
        assert.equal(started, 1, 'the clock kept firing and the queue did not re-enter');

        release();
        await Promise.resolve();
        await Promise.resolve();

        mock.timers.tick(15000);
        await Promise.resolve();
        assert.equal(started, 2, 'and it picks up again once the slow one finishes');
    } finally {
        queue.stop();
        mock.timers.reset();
    }
});

test('the clock does not tick the moment it is started', async () => {
    const { queue } = await aClock();
    mock.timers.enable({ apis: ['setInterval'] });

    try {
        let ticks = 0;
        queue.does(() => { ticks += 1; });
        queue.start('a person');

        //A tick on the same turn as the press gives no chance to press stop
        //again, and starting the queue is the one act here that reaches a
        //machine.
        await Promise.resolve();
        assert.equal(ticks, 0);
    } finally {
        queue.stop();
        mock.timers.reset();
    }
});
