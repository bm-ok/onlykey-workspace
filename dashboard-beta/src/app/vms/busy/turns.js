//---------------------------------------------------------------------------
//ONE MACHINE COMING UP AT A TIME, ACROSS THE WHOLE HOST.
//
//./doing.js is per machine, and it cannot see the thing that actually goes wrong
//here: two DIFFERENT machines booting at once.
//
//A MACHINE COMING UP IS THE MOST EXPENSIVE MINUTE THIS HOST EVER HAS — a
//snapshot restore, then a cold boot pulling on disk, memory and every core at
//once. Two at the same time do not take twice as long, THEY WEDGE: one sat on
//its splash screen for eleven minutes, ignored its power button, and had to have
//the plug pulled. Nothing was broken with it. There was simply not enough of the
//host to go round, and a whole session went into looking for a fault that was
//never there.
//
//This is the rule the queue already followed and never wrote down — it starts
//the next machine only once the last one has dialled in. Written down here, it
//applies to the paths the queue does not own: somebody pressing Start on two
//machines, a drill borrowing one while another is coming up, re-provisioning.
//
//---- everything waits its turn, and a turn is short ------------------------
//
//IT WAS NOT ALWAYS. An install used to hold this for its whole length and refuse
//everything else, on the reasoning that twelve minutes is too long to wait
//silently. Both halves of that were wrong.
//
//It never actually held anything — starting an installer returns as soon as the
//installer is started, so the hold lasted about four seconds and a second
//install began straight over the top of the first. Proved by doing it,
//deliberately, to see what would happen.
//
//AND REFUSING WAS THE WRONG CORRECTION. What competes is the FIRST MINUTE: a
//snapshot restore and a cold kernel boot, pulling on disk and every core at
//once. After that an install is mostly waiting on a mirror, and two of them
//coexist perfectly well. Blocking the second for twelve minutes would cost most
//of an evening to avoid one minute of contention.
//
//So a turn ends when the machine's console SAYS SOMETHING — its kernel is up and
//running code — which is a fact reported by the machine rather than a guess
//about how long a boot takes.
//---------------------------------------------------------------------------

//A BREATH BETWEEN MACHINES, AFTER THE KERNEL IS UP AND BEFORE THE NEXT STARTS.
//
//The turn ends when a machine's console speaks, which is the kernel alive and
//running code — but "alive" is not "settled". The seconds straight after are the
//heaviest of the whole boot: the initrd is handing over, the disk is being read
//hardest, and udev is bringing devices up. Starting the next machine into
//exactly that is what the turn-taking exists to avoid, and ending the turn on the
//first byte hands it over at the worst possible moment.
//
//Five seconds, and it is a SETTLE rather than a guess about how long a boot
//takes — the waiting was already done by listening to the console. Cheap against
//the minutes a boot costs, and the difference between staggering machines and
//merely offsetting them.
var SETTLE_MS = 5000;

module.exports = function turns(deps) {
    var d = deps || {};

    //THE CLOCK IS INJECTABLE so a test can drive it. A five-second settle and a
    //twelve-minute limit are not things a test may sit through — and a test that
    //sits is a test that HANGS rather than fails when the thing it waits on
    //never comes.
    var after = d.after || function (ms, fn) { return setTimeout(fn, ms); };
    var cancel = d.cancel || function (t) { clearTimeout(t); };
    var settleMs = d.settleMs == null ? SETTLE_MS : d.settleMs;

    var holder = null;   //{ name, kind, depth } — what is coming up right now
    var waiting = [];    //boots that have not had their turn yet

    function booting() {
        return holder;
    }

    function queued() {
        return waiting.map(function (w) { return { name: w.name, kind: w.kind }; });
    }

    function takeTurn(name, kind, waitMs, onWait) {
        return new Promise(function (go, no) {
            if (!holder) {
                holder = { name: name, kind: kind, depth: 1 };
                return go();
            }

            //THE SAME MACHINE, INSIDE ITS OWN TURN. Bringing a machine up holds
            //this for the whole boot and then starts it, which takes a turn as
            //well — so without this the one path that matters most waits for a
            //turn only it could give up, for ever.
            //
            //COUNTED RATHER THAN A FLAG, because the nesting is two deep today
            //and nothing says it stays that way.
            if (holder.name === name) {
                holder.depth++;
                return go();
            }

            if (onWait) onWait(holder.name);

            var mine = { name: name, kind: kind, go: go, no: no, timer: null };

            //ONLY THE WAIT IS BOUNDED. What runs afterwards takes as long as it
            //takes — an install is half an hour by nature, and a timeout around
            //the work itself would be a machine abandoned half-built.
            mine.timer = after(waitMs, function () {
                var at = waiting.indexOf(mine);
                if (at >= 0) waiting.splice(at, 1);
                no(new Error('Waited ' + Math.round(waitMs / 60000) + ' minutes for "'
                    + (holder ? holder.name : 'another machine') + '" to finish coming up before starting "'
                    + name + '". One machine comes up at a time on purpose — two at once wedges this host.'));
            });

            waiting.push(mine);
        });
    }

    function giveUpTurn() {
        //AN INNER TURN ENDING IS NOT THE TURN ENDING. Only the outermost one
        //hands the host to the next machine.
        if (holder && holder.depth > 1) {
            holder.depth--;
            return;
        }

        holder = null;
        var next = waiting.shift();
        if (!next) return;
        cancel(next.timer);

        //HELD BY THE MACHINE THAT IS ABOUT TO START, not left ownerless, or
        //anything arriving during the pause would see a free host and start
        //immediately — which is the race this pause exists to close.
        holder = { name: next.name, kind: next.kind, depth: 1 };
        after(settleMs, function () { next.go(); });
    }

    async function comingUp(name, fn, opts) {
        var it = opts || {};
        await takeTurn(name, it.kind || 'boot', it.waitMs == null ? 12 * 60000 : it.waitMs, it.onWait || null);
        try {
            return await fn();
        } finally {
            giveUpTurn();
        }
    }

    return {
        comingUp: comingUp,
        booting: booting,
        queued: queued,
        SETTLE_MS: settleMs
    };
};

module.exports.SETTLE_MS = SETTLE_MS;
