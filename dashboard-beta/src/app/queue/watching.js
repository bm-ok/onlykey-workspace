//---------------------------------------------------------------------------
//whether to go and look at GitHub this tick.
//
//THE HOOK WAS CUT AND NEVER WIRED. ../queue/tick.js has called `watch()` at the
//top of every tick since it was written, with a comment describing exactly the
//GitHub watcher it was for -- and ./server.js never supplied one, so it was the
//no-op default for the whole of that time. `watchGitHub` was a setting with a
//ten-line rationale and no consumer.
//
//---- what this decides, and what it does not ------------------------------
//
//IT DECIDES ONLY WHETHER. The sweep itself is `repositoriesCheck`, which already
//knows how to page, how to stop with room left in the hourly budget, and how to
//say what each place answered. Nothing about GitHub is repeated here.
//
//A TICK IS EVERY FIFTEEN SECONDS AND A SWEEP IS EVERY FIVE MINUTES, and the gap
//between them is the whole reason this is a function rather than a line: the
//tick asks every time, and this says no nineteen times out of twenty. Also no
//while the setting is off, and no while a sweep is still running -- two in
//flight is one that reads the other's half-written notes.
//
//PURE, SO A TEST CAN TICK IT. Time and the setting arrive as functions (the
//setting may answer with a promise, since settings are read from disk); the
//sweep is a callback. Nothing here reads a clock or a file.
//---------------------------------------------------------------------------

var EVERY = 5 * 60 * 1000;

module.exports = function makeWatching(d) {
    var on = d.on;                 // () => boolean | Promise<boolean>   the watchGitHub setting
    var sweep = d.sweep;           // () => Promise                       repositoriesCheck
    var now = d.now || function () { return Date.now(); };
    var every = d.every || EVERY;
    var warn = d.warn || function () {};

    var last = null;
    var running = false;
    var deciding = false;
    //THE LAST THING SAID ABOUT A FAILED SWEEP, so the same sentence is not
    //repeated every five minutes for as long as the app is up. Cleared when a
    //sweep works, so the next failure is heard even if it reads the same.
    var saidLast = null;

    //ANSWERS WITH WHETHER IT STARTED A SWEEP. Fired and let go by the tick,
    //exactly as that file's comment asks: a slow GitHub is not a reason for the
    //queue to stop giving out work.
    function watch() {
        if (running || deciding) return Promise.resolve(false);
        deciding = true;
        return Promise.resolve().then(function () { return on(); }).then(function (isOn) {
            deciding = false;
            if (isOn !== true) return false;
            if (running) return false;
            var t = now();
            if (last != null && t - last < every) return false;

            last = t;
            running = true;
            Promise.resolve().then(function () {
                return Promise.resolve(sweep()).then(function (said) {
                    //A SWEEP THAT WORKED CLEARS WHAT WAS SAID, so a failure that
                    //comes back later is reported rather than remembered as
                    //already mentioned.
                    saidLast = null;
                    return said;
                });
            }).catch(function (e) {
                //THE SAME COMPLAINT EVERY FIVE MINUTES IS NOT INFORMATION.
                //
                //A workspace with no repositories in it refuses this sweep, and
                //will go on refusing it: nothing about the next tick is
                //different. That is two hundred and eighty-eight identical lines
                //a day in a log somebody reads to find out what happened —
                //which is the same as burying it.
                //
                //ONE LINE PER REASON, AND IT SAYS IT AGAIN WHEN THE REASON
                //CHANGES. Not a flag that latches: a sweep that starts failing
                //for a NEW reason is news, and would be swallowed by anything
                //cruder than remembering which sentence was said.
                var why = (e && e.message ? e.message : String(e));
                if (why === saidLast) return;
                saidLast = why;
                warn('the GitHub watch could not sweep: ' + why
                    + ' — said once; it is tried again every ' + Math.round(every / 60000) + ' minutes.');
            }).then(function () { running = false; });
            return true;
        }, function (e) {
            deciding = false;
            warn('the GitHub watch could not read its setting: ' + (e && e.message ? e.message : e));
            return false;
        });
    }

    //FOR A TEST AND FOR A PANE: when it last looked, and whether it is looking.
    watch.state = function () { return { last: last, running: running, every: every }; };

    return watch;
};
