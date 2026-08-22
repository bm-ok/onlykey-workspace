//what ../../test/queue/queue-tick.test.js has to be able to catch.
//
//THE DECISION IS NOT IN THIS FILE — ./policy.plan makes it and has its own
//sweep. What is broken here is everything AROUND it: the guards, the claim, and
//the place a failure lands.
module.exports = {
    file: 'src/app/queue/tick.js',
    test: 'test/queue/queue-tick.test.js',
    breaks: [
        //---- whether a tick should happen at all ------------------------------

        //"NO WORK" AND "NO WORKSPACE" ARE DIFFERENT SENTENCES. A queue that
        //cannot tell them apart would dispatch the moment a stale file answered.
        ['it dispatches with nowhere to deliver',
            '        if (!workspaceOpen()) {',
            '        if (false) {'],

        //A HEARTBEAT EVERY FIFTEEN SECONDS saying nothing is happening is how a
        //log stops being read.
        ['the idle line is said on every tick',
            '            if (!idleSaid) {',
            '            if (true) {'],

        ['and once said, it is never said again however long the app runs',
            '        idleSaid = false;',
            ''],

        //EVERYTHING READ BEFORE THE CLAIM WOULD BE READ TWICE, and the second
        //read would be of a board the first had already changed.
        ['two ticks run inside each other',
            "        if (running) return { skipped: 'a tick is already running' };",
            ''],

        //A GUARD LEFT SET IS A QUEUE THAT NEVER TICKS AGAIN, and nothing says so.
        ['one failed tick stops the queue for ever',
            '        } finally {\n            running = false;\n        }',
            '        } finally {\n        }\n        running = false;'],

        //---- what the queue will not touch -------------------------------------

        //DISPATCHING ONE ROLLS A MACHINE BACK TO A SNAPSHOT and runs Claude over
        //the top of it, with somebody's editor open on it.
        ['a task somebody is doing themselves is given to a worker',
            "                .filter(function (t) { return t.state === 'queued' && t.worker !== 'person'; })",
            "                .filter(function (t) { return t.state === 'queued'; })"],

        ['a judgement somebody is reading themselves is given to a machine',
            "            .filter(function (j) { return j.state === 'queued' && j.by !== 'person' && j.job; })",
            "            .filter(function (j) { return j.state === 'queued' && j.job; })"],

        //A JUDGEMENT WITH NO JOB NEVER REACHES THE QUEUE, which is why
        //./onejudgement has two endings rather than three.
        ['a judgement with nothing to run is dispatched anyway',
            "            .filter(function (j) { return j.state === 'queued' && j.by !== 'person' && j.job; })",
            "            .filter(function (j) { return j.state === 'queued' && j.by !== 'person'; })"],

        ['work that is not waiting is dispatched again',
            "                .filter(function (t) { return t.state === 'queued' && t.worker !== 'person'; })",
            "                .filter(function (t) { return t.worker !== 'person'; })"],

        //---- the claim ----------------------------------------------------------

        //TWO TICKS THAT BOTH READ A FREE MACHINE and then both dispatch is two
        //workers rolling one machine back underneath each other.
        ['the machine is claimed after the work has been started',
            '                claim(go.machine, go.ref);',
            ''],

        //---- and what is said about waiting --------------------------------------

        ['every wait is said again on every tick',
            '        if (waitingSaid.get(ref) === message) return;',
            ''],

        ['nothing is ever said about why something waits',
            '            said.waiting.forEach(function (w) { sayWaiting(w.ref, w.why); });',
            ''],

        //KEYED ON THE REASON, NOT ON THE WORK. A task that starts waiting for a
        //different reason has to say so.
        ['a new reason for waiting is silenced by the old one',
            '        waitingSaid.set(ref, message);',
            "        waitingSaid.set(ref, 'said');"],

        ['being dispatched does not clear the wait, so the next one is silent',
            '                waitingSaid.delete(go.ref);',
            ''],

        //---- anything that arrived from outside -----------------------------------

        //A SLOW GITHUB IS NOT A REASON FOR THE QUEUE TO STOP GIVING OUT WORK.
        ['a slow watch holds up the dispatch',
            '            watch();',
            '            await watch();'],

        ['nothing ever looks for what arrived from outside',
            '            watch();',
            ''],

        //---- and where a failure lands ---------------------------------------------

        //IT STAYED IN `given` FOR EVER: not queued, so nothing would pick it up;
        //not done, so the board showed it working with no worker anywhere.
        ['a task that threw on the way up lands nowhere',
            "                await call('taskUpdate', {",
            "                if (false) await call('taskUpdate', {"],

        ['and it is re-queued onto the machine that just failed to boot',
            '            var nothingToGiveIt = !!(e && e.noIdentity);',
            '            var nothingToGiveIt = true;'],

        //NOTHING WAS READ, NOTHING WAS WRITTEN, and no code was even fetched, so
        //`done` would file "we learnt nothing" as the outcome of a task that
        //never started.
        ['a task that never got an identity is filed as having been done',
            '            var nothingToGiveIt = !!(e && e.noIdentity);',
            '            var nothingToGiveIt = false;'],

        ['a judgement that threw on the way up lands nowhere',
            '                    judging.update(entry.id, {',
            '                    if (false) judging.update(entry.id, {'],

        //---- and a landing that itself fails ---------------------------------------

        //WHAT MUST NOT HAPPEN is an unhandled rejection killing the process the
        //queue runs in.
        ['a store that is gone takes the tick with it',
            '            } catch (err) { /* the log already carries it */ }\n        });\n    }\n\n    return { once: once, whatIsWaiting: whatIsWaiting };',
            '            } finally { /* nothing */ }\n        });\n    }\n\n    return { once: once, whatIsWaiting: whatIsWaiting };']
    ]
};
