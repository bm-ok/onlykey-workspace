//what ../../test/queue/queue-onetask.test.js has to be able to catch.
//
//THE THREE ENDINGS ARE THE WHOLE FILE. Every break below either confuses two of
//them or removes the thing that brings the machine back — and each one costs a
//machine or a day's work, which is why they get a sweep of their own.
//
//NOT SWEPT HERE: the supervisor wake. It is guarded twice — the call is not
//awaited AND the whole block sits in a try — so no single break reaches the
//test, and each one on its own would report SURVIVED for a reason that is not
//about the test at all. Two layers where one would do is the intent; a sweep
//that cannot see that is better silent than misleading.
module.exports = {
    file: 'src/app/queue/onetask.js',
    test: 'test/queue/queue-onetask.test.js',
    breaks: [
        //---- the ending that leaves a machine up for a person ---------------

        //PUTTING IT AWAY WOULD TAKE AWAY THE THING THAT WAS JUST PREPARED: a
        //machine on the right branch, credentialed, with a workspace, shut down
        //and rolled back a second after saying it was ready.
        ['a task that named no job has its machine put away anyway',
            '                handedOver = true;',
            ''],

        //BORROWED IS WHAT MAKES EVERY OTHER RULE DO THE RIGHT THING. Without it
        //the queue picks the machine up again and hands the branch to a second
        //one, out from under somebody with an editor open.
        ['the handed-over machine is never claimed, so the queue takes it back',
            "                hold(machine, { why: '#' + task.number + ' — set up and waiting for you', at: stamp() });",
            ''],

        //A BRIEF IS NOT SOMETHING TO RUN. Reading one as a job makes a worker
        //the default consequence of choosing nothing.
        ['a task naming no job is given work anyway',
            '            if (!task.job && !task.shell) {',
            '            if (false) {'],

        //---- the ending where this app stopped being able to see -------------

        //ROLLING IT BACK DESTROYS THE ONLY ACCOUNT OF WHAT WENT WRONG. The
        //transcript is on that disk and nowhere else.
        ['a machine that stopped answering is rolled back with the evidence on it',
            "            if (outcome.state === 'unreachable') {",
            '            if (false) {'],

        ['every ending is treated as out of touch, so nothing goes back to the pool',
            '            } else if (outOfTouch) {',
            '            } else if (true) {'],

        ['a machine kept for looking is put away instead',
            '                await putting.keepForLooking(machine, outOfTouch);',
            '                await putting.putAway(machine);'],

        //---- and the machine coming back at all ------------------------------

        //A MACHINE HELD BY A QUEUE THAT HAS STOPPED THINKING ABOUT IT is a
        //machine nothing will ever touch again.
        ['the queue never lets go of the machine',
            '            release(machine);',
            ''],

        //---- a sign-in that could not authenticate ---------------------------

        //THE WORK NEVER STARTED. Marking it done files "we learnt nothing" as
        //an outcome and loses the task: a finished task with an empty branch
        //and no account of why.
        ['a task whose sign-in was dead is marked done rather than re-queued',
            '            if (metered && metered.failedAuthAs) {',
            '            if (false) {'],

        //ONCE. If every sign-in it can be given is failing, putting it back is
        //a loop that spends a machine every fifteen seconds.
        ['it re-queues for ever, spending a machine each time round',
            '        if (!already) {',
            '        if (true) {'],

        ['the attempt is not marked, so the second failure looks like the first',
            '            marked[marked.length - 1] = Object.assign({}, marked[marked.length - 1], { authFailed: who });',
            ''],

        //A RE-QUEUED TASK THAT CARRIES ON RUNNING is marked done a line later,
        //which is the thing the re-queue was for.
        ['it goes back in the queue and is then finished anyway',
            '                if (again) return;',
            ''],

        //---- and whether anything actually arrived ---------------------------

        //THE CONFIDENT WRONG REPORT THIS WHOLE APP IS ARRANGED AGAINST: a run
        //that says it worked and pushed nothing.
        ['where the branch stood before the work is never read',
            '            var stoodAt = await headsOn(task.branch);',
            '            var stoodAt = {};'],

        ['every run is reported as having delivered',
            '            var moved = Object.keys(nowAt).filter(function (r) { return nowAt[r] && nowAt[r] !== stoodAt[r]; });',
            "            var moved = ['something'];"],

        //---- and what a run cost ---------------------------------------------

        //THE TRANSCRIPT LIVES ON THE MACHINE and the rollback takes it, so
        //there is no reading it afterwards — there is nothing to read.
        ['the run is never metered, so what it cost goes with the machine',
            '            var metered = await metering.meterRun(to, machine, started.run, {',
            '            var metered = null; if (false) await metering.meterRun(to, machine, started.run, {'],

        //---- and the things that must never be fatal --------------------------

        //A REPORT THAT COULD NOT BE DELIVERED is worth a line, and is not worth
        //refusing to do the work over.
        ['an undelivered judgement report stops the task',
            '                    to.warn("could not put the judge\'s report on " + machine + \': \' + e.message);',
            '                    throw e;'],

        //THE LOG IS BEST EFFORT; THE VERDICT IS NOT.
        ['a progress log that could not be written loses the verdict',
            "            try { await call('taskProgress', { id: id }); } catch (e) { /* best effort */ }",
            "            await call('taskProgress', { id: id });"],

        //---- and where the time went -------------------------------------------

        //FORTY MINUTES IS A FACT; forty minutes of which thirty-five were
        //bringing a machine up is the one that leads anywhere.
        ['nothing is recorded about where the time went',
            '                return a.run === started.run ? Object.assign({}, a, { spent: spent }) : a;',
            '                return a;']
    ]
};
