//---------------------------------------------------------------------------
//WHAT IS DUE, WHAT IS RUNNING, AND WHAT HAPPENED LAST TIME.
//
//ALL THE RULES AND NONE OF THE CLOCK. Every decision a repeating job needs —
//is it due, may it start, what does a failure mean, what does a save do to it —
//is made here against a number somebody passes in. ./main.js owns the one real
//timer and does nothing except hand this the time.
//
//That split is what makes any of this checkable: a rule about "every fifteen
//minutes" tested against a real clock is a test that takes fifteen minutes, so
//in practice it is a rule nobody tests.
//---------------------------------------------------------------------------

//---- the two states a job can be in, and why they are different ------------
//
//ARMED is whether anything is registered to DO the work. The bundle that holds
//the doing is rebuilt on every save, so there is a moment after each one where
//a job is running with nothing to run.
//
//RUNNING is whether the clock is turning for it.
//
//A board that collapsed the two would say "off" about a job that is switched on
//and has quietly had nothing behind it since the last save.

module.exports = function schedule(deps) {
    var d = deps || {};
    var say = d.say || function () { return { good: function () {}, warn: function () {}, bad: function () {}, info: function () {} }; };

    //HOW MANY RUNS ARE REMEMBERED PER JOB. Enough to see a pattern — a job that
    //fails every third time is the interesting case and one entry cannot show
    //it — and bounded, because this is in memory for as long as the app runs.
    var KEEP = d.keep || 20;

    var jobs = {};

    //---- registering -------------------------------------------------------
    //
    //CALLED AGAIN ON EVERY SAVE, and that is the case this has to get right.
    //The plugin that owns a job lives in the bundle that reloads, so it
    //re-registers every few minutes while somebody is working.
    //
    //SO RE-ADDING A NAME KEEPS ITS HISTORY AND ITS SWITCH. A save that reset
    //"running" would silently switch the queue off — or, worse, on — and the
    //whole reason this lives in main is that a save must not do that.
    function add(spec) {
        var it = spec || {};
        var name = String(it.name || '').trim();
        if (!name) throw new Error('A scheduled job needs a name.');

        var every = Number(it.every);
        if (!(every > 0)) throw new Error('"' + name + '" needs an interval in milliseconds.');

        var had = jobs[name];
        if (had) {
            //WHAT THE NEW BUNDLE SAYS ABOUT THE SHAPE OF THE JOB WINS — the
            //interval and the description are code, and code is what just
            //changed. What it must NOT touch is anything that happened.
            had.every = every;
            had.about = it.about || had.about;
            had.firstRun = it.firstRun || had.firstRun;
            had.humanOnly = it.humanOnly || had.humanOnly;
            return had;
        }

        jobs[name] = {
            name: name,
            about: it.about || '',
            every: every,

            //WHETHER IT COMES UP RUNNING, DECLARED IN CODE AND NOT A SETTING.
            //
            //The queue's job is `false` and that is not a default anybody may
            //override: it is the piece that rolls a real machine back to its
            //base snapshot, hands it a credential, and runs somebody's
            //instructions on it unattended. A thing that does that is STARTED by
            //a person, every time, rather than found already running by whoever
            //opened the app.
            //
            //A job that only READS something — asking github what changed,
            //asking VirtualBox what is powered on — has no such argument against
            //it and says so by asking for `true`.
            autoStart: it.autoStart === true,

            //AND WHETHER A MODEL MAY WORK THE SWITCH, declared by the job and
            //carrying its own reason.
            //
            //WITHOUT THIS, THIS PLUGIN IS A WAY ROUND A REFUSAL THAT ALREADY
            //EXISTS. `queueStart` refuses over the wire, in those words, because
            //starting the queue gives real machines real work. A generic
            //"cronStart <name>" that did not ask would be the same act under a
            //name nobody had thought to guard — which is how a gate gets left
            //behind by the thing built next to it.
            //
            //The REASON rather than a flag, because whoever is refused should be
            //told what this particular job is, not that a boolean was false.
            humanOnly: it.humanOnly || null,

            //WAITS A FULL INTERVAL BEFORE THE FIRST RUN, unless it says
            //otherwise. A tick on the same turn as the press gives nobody a
            //chance to press stop again.
            firstRun: it.firstRun || 'after',

            run: null,
            running: false,
            startedBy: null,
            startedAt: null,
            lastDueAt: null,

            inFlight: false,
            saidNothingBehindIt: false,

            runs: 0,
            failures: 0,
            history: []
        };

        if (jobs[name].autoStart) start(name, 'the app');
        return jobs[name];
    }

    function forget(name) { return delete jobs[name]; }

    //---- the slot ----------------------------------------------------------
    //
    //THE WORK IS PUT IN, NOT HELD. If this kept a reference to a function from
    //the bundle, a save would leave the clock calling into a bundle that has
    //been torn down — the plugins destroyed, the services gone, and a closure
    //keeping all of it alive. From outside, that looks like work being done by
    //code that no longer exists.
    function does(name, fn) {
        var job = jobs[name];
        if (!job) throw new Error('There is no scheduled job called "' + name + '".');

        job.run = fn || null;
        job.saidNothingBehindIt = false;

        return function () { if (job.run === fn) job.run = null; };
    }

    //---- the switch --------------------------------------------------------

    function start(name, by) {
        var job = jobs[name];
        if (!job || job.running) return false;

        job.running = true;
        job.startedBy = by || 'somebody';
        job.startedAt = at();

        //THE INTERVAL IS COUNTED FROM THE PRESS, so `firstRun: 'after'` means a
        //whole interval of quiet rather than "whenever the heartbeat next
        //happens to line up".
        //
        //`nowMs()` AND NOT `at()`. This is a number that gets added to; `at()` is
        //a sentence for somebody to read. The first version of this line used
        //`at()`, which made every comparison below `now >= "2026-08-21T..." +
        //15000` — NaN, false, and a scheduler where nothing was ever due. It
        //logged "running", it reported a countdown of NaN, and it did nothing.
        job.lastDueAt = job.firstRun === 'now' ? null : nowMs();

        say('cron', name).good(name + ' is running — started by ' + job.startedBy
            + ', first look ' + (job.firstRun === 'now' ? 'immediately' : 'in ' + Math.round(job.every / 1000) + 's'));
        return true;
    }

    //STOPPING DOES NOT ABANDON WHAT IS ALREADY RUNNING. It stops the next one
    //being picked up; a run already in flight carries on to its end.
    function stop(name, why) {
        var job = jobs[name];
        if (!job || !job.running) return false;

        job.running = false;
        job.startedBy = null;
        job.startedAt = null;
        job.lastDueAt = null;

        say('cron', name).warn(name + ' is stopped' + (why ? ' — ' + why : '')
            + (job.inFlight ? '. A run is still in flight and is not interrupted.' : ''));
        return true;
    }

    //---- what is due -------------------------------------------------------

    function dueAt(job) {
        if (!job.running) return null;
        if (job.lastDueAt === null) return 0;      //`firstRun: 'now'`, and it has not yet
        return job.lastDueAt + job.every;
    }

    function due(now) {
        return Object.keys(jobs).filter(function (name) {
            var job = jobs[name];
            if (!job.running || job.inFlight) return false;
            var when = dueAt(job);
            return when !== null && now >= when;
        });
    }

    //---- running one -------------------------------------------------------
    //
    //ONE AT A TIME, WHATEVER THE CLOCK SAYS. A run can take longer than the
    //interval whenever anything is actually happening — the queue's brings
    //machines up and waits on them — and two overlapping runs would both see the
    //same world and both act on it.
    async function fire(name, now) {
        var job = jobs[name];
        if (!job || job.inFlight) return null;

        //COUNTED FROM WHEN IT STARTED, not from when it finished. A job that
        //takes eleven seconds on a fifteen-second interval should still run
        //every fifteen, not every twenty-six.
        job.lastDueAt = now;

        if (!job.run) {
            //A SAVE LANDED AND THE NEW BUNDLE HAS NOT PUT ITS WORK BACK, or
            //there never was any. SAID ONCE — the alternative is a line every
            //interval, and the alternative to that is silence about a job that
            //has quietly stopped doing anything.
            if (!job.saidNothingBehindIt) {
                job.saidNothingBehindIt = true;
                say('cron', name).warn(name + ' is running but nothing is registered to do it — '
                    + 'it will do nothing until something is');
            }
            return null;
        }
        job.saidNothingBehindIt = false;

        job.inFlight = true;
        job.runs++;

        var started = now;
        var ok = true;
        var said = null;

        try {
            await job.run();
        } catch (e) {
            //A RUN THAT THREW MUST NOT STOP THE CLOCK. The next one may well
            //work — a machine that was unreachable comes back, a network that
            //was down is up — and a job that switches itself off on one bad
            //minute is one somebody finds stopped hours later with no idea when.
            ok = false;
            job.failures++;
            said = (e && e.message) ? e.message : String(e);
            say('cron', name).bad(name + ' failed: ' + said);
        } finally {
            job.inFlight = false;
        }

        remember(job, { at: at(), ms: nowMs() - started, ok: ok, said: said });
        return ok;
    }

    function remember(job, entry) {
        job.history.unshift(entry);
        if (job.history.length > KEEP) job.history.length = KEEP;
    }

    //THE HEARTBEAT. Everything due, one pass, and nothing else — ./main.js has
    //no decisions in it at all.
    async function beat(now) {
        var ran = due(now);
        for (var i = 0; i < ran.length; i++) await fire(ran[i], now);
        return ran;
    }

    //---- what somebody looks at --------------------------------------------
    function list(now) {
        return Object.keys(jobs).sort().map(function (name) {
            var job = jobs[name];
            var last = job.history[0] || null;

            return {
                name: job.name,
                about: job.about,
                every: job.every,

                //THE TWO STATES, KEPT APART. See the header.
                running: job.running,
                armed: !!job.run,
                inFlight: job.inFlight,
                autoStart: job.autoStart,
                humanOnly: job.humanOnly,

                since: job.running ? { by: job.startedBy, at: job.startedAt } : null,
                dueIn: job.running ? Math.max(0, (dueAt(job) || 0) - (now === undefined ? nowMs() : now)) : null,

                runs: job.runs,
                failures: job.failures,
                last: last,
                history: job.history.slice()
            };
        });
    }

    function get(name) { return jobs[name] || null; }

    //TIME IS ASKED FOR, NEVER TAKEN. Two ways, because one is for arithmetic and
    //the other is for somebody to read, and mixing them is how a duration ends
    //up being a difference between two strings.
    function nowMs() { return d.now ? d.now() : Date.now(); }
    function at() { return d.at ? d.at() : new Date().toISOString(); }

    return {
        add: add, forget: forget, does: does,
        start: start, stop: stop,
        due: due, fire: fire, beat: beat,
        list: list, get: get,
        KEEP: KEEP
    };
};
