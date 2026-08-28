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
            Promise.resolve().then(sweep).catch(function (e) {
                warn('the GitHub watch could not sweep: ' + (e && e.message ? e.message : e));
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
