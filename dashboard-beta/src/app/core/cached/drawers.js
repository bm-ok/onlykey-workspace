//---------------------------------------------------------------------------
//an answer somebody already worked out, and the rule for when it may be reused.
//
//THE RULE, AND IT IS THE WHOLE FILE: key on something that changes when the
//answer changes. Never on a clock. The app being ported from arrived at this
//three separate times, in three different subjects, and wrote it down each time
//— ../../../../dashboard/actions/shared.js says it best: "there is no window
//during which the file is new and the answer is old."
//
//SO THERE ARE THREE DOORS, NOT ONE, and which one a caller takes says what its
//key is made of. That is the point of having three: a reader can see from the
//call which promise is being made, instead of finding out from a stale panel.
//
//    byContent   the key contains the thing itself — two commit shas, a hash.
//                The answer is a pure function of the key, so it is true for
//                ever, so it is the only kind worth writing to disk.
//
//    byStamp     the key is a file's `mtimeMs:size`. Same promise, but NEVER
//                written down: what this kind holds is derived from a file, and
//                in the app being ported from that file is a sealed credential.
//                A persisted copy of an unsealed secret is a worse bug than
//                every spawn this saves.
//
//    whileFresh  keyed on a clock, because there is nothing else to key on. The
//                only honest use is "no single draw asks twice" — a second, not
//                a minute — and it MUST be dropped when something writes.
//
//WHY THE THIRD ONE EXISTS AT ALL, given the rule it breaks. Reading refs to
//check whether a cached ref read is still good costs exactly what the read
//costs, so there is no content to key on that is cheaper than the answer. What
//is left is to make the window small enough that nothing can happen inside it,
//and to close it by hand on any write. That is a de-duplicator wearing a cache's
//clothes, and calling it `whileFresh` rather than `cache` is the only way to
//keep the difference visible at the call site.
//
//---- what a counter here can and cannot tell you ---------------------------
//
//`stats()` counts hits, misses and shares, and that is worth having — but the
//worst cache failure this codebase has had is invisible to it, so it is worth
//saying which one.
//
//A BOARD IN THE APP BEING PORTED FROM CACHED CORRECTLY AND SAVED NOTHING.
//Building the key cost four git processes per branch, and they ran on a HIT as
//well as a miss — so the heavy call really was skipped, the hit rate really was
//high, and the timing never moved. See ../../repositories/branches/server.js,
//which carries the scar.
//
//NO COUNTER IN HERE COULD HAVE CAUGHT THAT, because everything it measures was
//healthy. What catches it is counting what the caller spawns, from outside. A
//drawer reporting 95% hits is not evidence that anything got faster.
//---------------------------------------------------------------------------

//HOW MANY ANSWERS A DRAWER KEEPS BEFORE IT DROPS THE LOT.
//
//A WIPE RATHER THAN AN LRU, which is what the app being ported from does and is
//worth keeping: nothing in here is expensive to work out ONCE, the bookkeeping
//an LRU needs is per-get rather than per-evict, and a cache that needs a data
//structure to decide what to forget has stopped being the cheap thing it was
//supposed to be. Five hundred is far more than a session reaches.
var KEEP = 500;

module.exports = function Drawers(opts) {
    opts = opts || {};

    //WHERE A `byContent` DRAWER IS WRITTEN DOWN, or null for a process that has
    //nowhere to write. Absent is a real answer here: every drawer still works,
    //it just starts empty on every restart, which is a cache behaving like a
    //cache. See ../state/server.js for why absent must not be pretended away
    //when the thing being kept is a RECORD — this is the other case, and it is
    //exactly the difference between the two.
    var keep = opts.keep || null;
    var limit = opts.limit || KEEP;
    var clock = opts.now || Date.now;

    var all = {};

    //A NAME A DOCUMENT COULD BE CALLED, checked for every kind rather than only
    //for the one that reaches disk. Two reasons: a drawer that changes kind
    //later must not fail at the moment it is first WRITTEN, weeks after it was
    //named; and ../state's own rule refuses a path rather than sanitising one,
    //so the same answer here keeps that rule in one shape.
    function named(name) {
        var clean = String(name == null ? '' : name).trim();
        if (!clean || !/^[a-z0-9][a-z0-9-]*$/i.test(clean)) {
            throw new Error('a drawer is named in letters, digits and dashes — "' + name + '" is not.');
        }
        return clean;
    }

    function drawer(name, how) {
        name = named(name);
        if (all[name]) return all[name];

        var held = {};
        var count = 0;

        //WHAT IS ALREADY BEING WORKED OUT, so two callers asking at once ask
        //the world once.
        //
        //THIS IS NEW HERE AND THE APP BEING PORTED FROM COULD NOT HAVE NEEDED
        //IT: its git reads were `execFileSync`, so a second caller could not
        //arrive mid-answer. These are spawns, and two panes poll the same board
        //on unsynchronised timers — so "not in the drawer yet" happens twice
        //for one answer, routinely, and without this both pay.
        var doing = {};

        var hits = 0, misses = 0, shared = 0, wipes = 0;

        //A MISSING VALUE AND A VALUE OF `undefined` ARE DIFFERENT, which is why
        //this is `in` and not a truth test. `wouldConflict` answers `null` for
        //"could not tell", and that answer is as worth keeping as any other —
        //re-running merge-tree to be told again that it cannot tell is the
        //most expensive way to learn nothing.
        function has(key) { return Object.prototype.hasOwnProperty.call(held, key); }

        function put(key, value) {
            if (count >= limit) { held = {}; count = 0; wipes++; }
            held[key] = value;
            count++;
            if (keep && how.written) keep.dirty(name);
        }

        function fresh(key) {
            if (!has(key)) return false;
            if (!how.ms) return true;
            return (clock() - held[key].at) < how.ms;
        }

        async function get(key, make) {
            if (key == null || key === '') {
                throw new Error('a cached answer is asked for by key, and "' + key + '" is not one');
            }
            key = String(key);

            if (fresh(key)) { hits++; return how.ms ? held[key].value : held[key]; }

            //ALREADY ON ITS WAY. The second caller waits on the first one's
            //promise rather than starting its own.
            if (doing[key]) { shared++; return doing[key]; }

            misses++;

            //`Promise.resolve().then` RATHER THAN CALLING `make` DIRECTLY, so a
            //`make` that throws synchronously becomes a rejected promise like
            //any other and does not escape past the bookkeeping below.
            var run = Promise.resolve().then(make);
            doing[key] = run;

            try {
                var value = await run;
                //A FAILURE IS NEVER KEPT. It is the one answer that is not a
                //function of the key: the network was down, a ref was mid-write,
                //the disk was busy. Keeping it would turn a blink into a fact
                //that outlives the thing that caused it.
                put(key, how.ms ? { at: clock(), value: value } : value);
                return value;
            } finally {
                delete doing[key];
            }
        }

        //WHAT IS IN HERE WITHOUT ASKING FOR IT, for a caller that wants to know
        //rather than to have. Never starts any work.
        function peek(key) {
            key = String(key);
            if (!fresh(key)) return undefined;
            return how.ms ? held[key].value : held[key];
        }

        function forget(key) {
            if (key === undefined) return empty();
            key = String(key);
            if (!has(key)) return false;
            delete held[key];
            count--;
            if (keep && how.written) keep.dirty(name);
            return true;
        }

        function empty() {
            var had = count;
            held = {};
            count = 0;
            if (keep && how.written) keep.dirty(name);
            return had;
        }

        //---- the two halves of being written down --------------------------
        //
        //ONLY `byContent` HAS THESE, and ../server.js is the only caller. A
        //drawer whose key is a clock or a file stamp must not reach disk: the
        //first would come back stale by exactly the window it promises not to
        //have, and the second may be holding what a credential unsealed to.
        function load(rows) {
            if (!how.written || !rows) return 0;
            var keys = Object.keys(rows);
            for (var i = 0; i < keys.length && count < limit; i++) {
                if (has(keys[i])) continue;
                held[keys[i]] = rows[keys[i]];
                count++;
            }
            return count;
        }

        function save() { return how.written ? held : null; }

        var it = {
            name: name,
            kind: how.kind,
            get: get,
            peek: peek,
            forget: forget,
            empty: empty,
            load: load,
            save: save,
            stats: function () {
                return {
                    name: name, kind: how.kind, held: count,
                    hits: hits, misses: misses, shared: shared, wipes: wipes,
                    //SAID AS A COUNT AND NOT AS A RATE, because a rate invites
                    //the reading this file's header exists to warn against. A
                    //hit is not a saving; it is a call that did not run `make`.
                    inFlight: Object.keys(doing).length
                };
            }
        };

        all[name] = it;
        return it;
    }

    return {
        //THE KEY CONTAINS THE THING ITSELF, so the answer cannot go stale — a
        //different answer would have a different key. Written down.
        byContent: function (name) { return drawer(name, { kind: 'content', written: true }); },

        //THE SAME PROMISE, NEVER WRITTEN DOWN. See the header.
        byStamp: function (name) { return drawer(name, { kind: 'stamp', written: false }); },

        //KEYED ON A CLOCK, so it must be dropped when anything writes, and the
        //window must be smaller than the thing it is de-duplicating.
        whileFresh: function (name, ms) {
            if (!(ms > 0)) throw new Error('whileFresh("' + name + '") needs how long is fresh, in milliseconds');
            return drawer(name, { kind: 'clock', ms: ms, written: false });
        },

        //EVERY CLOCK-KEYED DRAWER, EMPTIED — the one call a write door makes.
        //
        //DECIDED HERE RATHER THAN REMEMBERED BY EACH CALLER, which is the whole
        //reason this is one plugin. The app being ported from puts it in a
        //sentence worth keeping: "A cache that has to be invalidated by hand is
        //a cache that is stale exactly where somebody forgot, and the forgetting
        //happens in the change that adds the seventh writer, months later."
        //
        //CONTENT- AND STAMP-KEYED DRAWERS ARE LEFT ALONE, deliberately. A moved
        //ref gives a different key, so there is nothing in them to be wrong;
        //emptying them on every write would throw away exactly the expensive
        //answers this exists to keep.
        stale: function () {
            var dropped = 0;
            Object.keys(all).forEach(function (n) {
                if (all[n].kind === 'clock') dropped += all[n].empty();
            });
            return dropped;
        },

        drawers: function () { return Object.keys(all).map(function (n) { return all[n]; }); },
        about: function () { return Object.keys(all).map(function (n) { return all[n].stats(); }); }
    };
};
