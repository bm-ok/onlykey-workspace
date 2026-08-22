//what ../../test/core/cron-schedule.test.js has to be able to catch.
module.exports = {
    file: 'src/app/core/cron/schedule.js',
    test: 'test/core/cron-schedule.test.js',
    breaks: [
        //THE CASE THIS HAS TO GET RIGHT: the plugin owning a job re-registers on
        //every save, and a save must not undo a decision somebody made.
        ['a save resets whether a job is running',
            '        var had = jobs[name];\n        if (had) {',
            '        var had = null;\n        if (had) {'],

        ['a save restarts an auto-start job somebody stopped',
            "        if (jobs[name].autoStart) start(name, 'the app');",
            "        if (jobs[name].autoStart || true) start(name, 'the app');"],

        ['a save throws away what has run so far',
            '            had.every = every;',
            '            had.runs = 0;\n            had.history = [];\n            had.every = every;'],

        ['a save leaves the old interval in place',
            '            had.every = every;',
            ''],

        //THE PIECE THAT GIVES REAL MACHINES REAL WORK is started by a person.
        ['every job comes up running',
            '            autoStart: it.autoStart === true,',
            '            autoStart: true,'],

        ['a job that asked to come up running does not',
            "        if (jobs[name].autoStart) start(name, 'the app');",
            ''],

        //A tick on the same turn as the press gives nobody a chance to stop it.
        ['a job runs the moment it is started',
            "        job.lastDueAt = job.firstRun === 'now' ? null : nowMs();",
            '        job.lastDueAt = null;'],

        ['a job that asked to run immediately waits an interval',
            "        job.lastDueAt = job.firstRun === 'now' ? null : nowMs();",
            '        job.lastDueAt = nowMs();'],

        //The one that actually happened: a number that gets added to, and a
        //sentence for somebody to read, are not the same thing.
        ['the due time is a stamp rather than a number',
            "        job.lastDueAt = job.firstRun === 'now' ? null : nowMs();",
            "        job.lastDueAt = job.firstRun === 'now' ? null : at();"],

        //A job that takes eleven seconds on a fifteen-second interval should
        //still run every fifteen.
        ['the interval is counted from when a run FINISHED',
            '        job.lastDueAt = now;\n\n        if (!job.run) {',
            '        if (!job.run) {'],

        //FOUR NOT-BREAKS, AND THEY ARE ALL THE SAME SHAPE. Each of these lines
        //has a second one behind it, so removing either alone changes nothing
        //observable — the sabotage "survives" without having broken anything:
        //
        //  dueAt's `if (!job.running) return null`  due() and list() both ask
        //                                           again before using it
        //  due()'s `|| job.inFlight`                fire() refuses as well
        //  the `finally` around inFlight = false    the catch swallows, so the
        //                                           next line is reached anyway
        //  does() clearing saidNothingBehindIt      fire() clears it too
        //
        //ALL FOUR STAY. Each is the natural place for its check, and each is
        //only redundant BECAUSE the other one is there. What it means is that
        //this file cannot hold them up — and a sabotage that does nothing,
        //reported as a survivor, is worse than saying so here.

        ['a job is due before its interval has passed',
            '        return job.lastDueAt + job.every;',
            '        return job.lastDueAt;'],



        //A job that switches itself off on one bad minute is one somebody finds
        //stopped hours later with no idea when.
        ['a run that threw stops the clock',
            '            ok = false;\n            job.failures++;',
            '            ok = false;\n            job.running = false;\n            job.failures++;'],

        ['a run that threw is recorded as having worked',
            '        remember(job, { at: at(), ms: nowMs() - started, ok: ok, said: said });',
            '        remember(job, { at: at(), ms: nowMs() - started, ok: true, said: said });'],

        ['what a failure said is thrown away',
            "            said = (e && e.message) ? e.message : String(e);",
            "            said = null;"],

        ['something thrown that is not an Error says nothing at all',
            "            said = (e && e.message) ? e.message : String(e);",
            '            said = e.message || null;'],

        //Said once, or the alternative is a line every interval.
        ['a job with nothing behind it says so every single interval',
            '            if (!job.saidNothingBehindIt) {\n                job.saidNothingBehindIt = true;',
            '            if (true) {'],


        //A save puts the new bundle's work in, then the old one removes its own.
        ['taking the work out removes whatever is there, including the new one',
            '        return function () { if (job.run === fn) job.run = null; };',
            '        return function () { job.run = null; };'],

        //Stopping stops the next one; it does not reach into a run already given out.
        ['stopping interrupts a run already in flight',
            '        job.running = false;\n        job.startedBy = null;',
            '        job.running = false;\n        job.inFlight = false;\n        job.startedBy = null;'],

        ['stopping does not say a run is still going',
            "            + (job.inFlight ? '. A run is still in flight and is not interrupted.' : ''));",
            '            );'],

        ['starting one that is already running takes it over',
            '        if (!job || job.running) return false;',
            '        if (!job) return false;'],

        //What somebody looks at.
        ['running and armed are collapsed into one answer',
            '                armed: !!job.run,',
            '                armed: job.running,'],

        ['an overdue job counts down through zero',
            '                dueIn: job.running ? Math.max(0, (dueAt(job) || 0) - (now === undefined ? nowMs() : now)) : null,',
            '                dueIn: job.running ? (dueAt(job) || 0) - (now === undefined ? nowMs() : now) : null,'],

        ['the history grows forever',
            '        if (job.history.length > KEEP) job.history.length = KEEP;',
            ''],

        ['the oldest run is reported as the most recent',
            '        job.history.unshift(entry);',
            '        job.history.push(entry);'],

        //The list is drawn in the window and photographed by `capture`.
        ['the list hands out the function, and the bundle it closes over',
            '                history: job.history.slice()',
            '                history: job.history.slice(),\n                run: job.run'],

        ['putting work in for a job nobody registered is silently ignored',
            '        if (!job) throw new Error(\'There is no scheduled job called "\' + name + \'".\');',
            '        if (!job) return function () {};'],

        //And the gate, which is the reason this plugin is not a way round one.
        ['a job cannot say that only a person may work its switch',
            '            humanOnly: it.humanOnly || null,',
            '            humanOnly: null,'],

        ['a save drops the gate a job declared',
            '            had.humanOnly = it.humanOnly || had.humanOnly;',
            '            had.humanOnly = it.humanOnly || null;']
    ]
};
