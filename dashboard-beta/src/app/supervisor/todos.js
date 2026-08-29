//---------------------------------------------------------------------------
//A LIST OF THINGS TO DO, kept by this host for the supervisor and the person
//together.
//
//`todos.js` IS THE STORE AND `todo.js` IS THE PANE, which is a distinction one
//letter wide and worth reading twice. The plural is what the list is called
//everywhere else too — the action that reads it is `todos` — so the file is
//named after the thing rather than after being "the other one".
//
//NOT THE TASK BOARD. A task is an occasion on which a machine runs a job on a
//branch: it costs a boot, it has a contract, and it is refused unless a
//judgement stands behind it. Most of what needs doing is not that — "ask about
//the coercion in #13 before recommending anything else", "the fork is behind its
//parent again" — and those have nowhere to live, so they live in a conversation
//and are lost the moment the conversation is long.
//
//NOT TRIAGE EITHER, and the difference is why this is its own list. Triage says
//where something ALREADY IS, keyed by a task or an issue that exists elsewhere
//and can be read from its own store. A todo exists NOWHERE ELSE: throw this file
//away and every task and judgement is still there, and only the intention is
//gone.
//
//WHICH IS WHY THE TWO ENDS ARE DIFFERENT. A supervisor may add, change and mark
//done; only a person may DELETE. That is not distrust about deleting — it is
//that "done" and "gone" are different claims, and a list the thing doing the work
//can also make disappear is a list nobody can use to check up on it. The refusal
//itself is in ./server.js, because this is a store and a store that decides who
//may call it is a store with two jobs.
//
//KEPT FOR THIS COMPUTER rather than per workspace: what somebody is carrying
//spans whatever they were looking at.
//
//AND IT STARTS EMPTY HERE. This is a port; the list the dashboard has is in the
//dashboard's own folder and is not read from this one. Nothing is lost — that
//list is still there, still readable from `okc.js todos` against that app — but
//this app's list begins on the day it is first written to.
//---------------------------------------------------------------------------

//Long enough for a sentence somebody reads at a glance; long enough in the why
//for the paragraph that stops it being reopened in a week and misunderstood. Not
//long enough to become the place a model writes its reasoning, which belongs in
//what it says to the person.
var MOST_WHAT = 200;
var MOST_WHY = 2000;
var MOST_ROWS = 500;

//THREE STATES AND THEY ARE FIXED. One thing is either waiting, being done, or
//finished; a free-text state here would only ever be a worse version of `why`.
var STATES = ['open', 'doing', 'done'];

function clean(s, most) {
    return String(s == null ? '' : s)
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .trim()
        .slice(0, most);
}

//COUNTED, NOT RANDOM. A number a person can say out loud is the whole point of a
//reference — "do T4 next" works in a sentence and a uuid does not.
//
//AND IT IS NEVER HANDED OUT TWICE, WHICH THE DASHBOARD'S OWN COPY DOES NOT
//MANAGE. Over there the next number is the highest of the rows that are STILL
//THERE, and its comment says that is "the highest ever used" — which it is,
//right up until somebody removes the newest one. Then the next thing written
//takes its number, and a sentence saying "do T2 next" now points at something
//else. A ref is only worth having because it can be said out loud, so a ref that
//quietly changes meaning is worse than a uuid.
//
//So the count is kept rather than derived. A file that is only a list — one
//written by hand, or by that other app — still reads, and falls back to the old
//answer, because a list with no counter in it is better than no list.
function nextNumber(kept) {
    var fromRows = kept.rows.reduce(function (n, r) { return Math.max(n, Number(r.number) || 0); }, 0);
    return Math.max(Number(kept.next) || 0, fromRows) + 1;
}

function withRef(r) {
    return Object.assign({}, r, { ref: 'T' + r.number });
}

//IT IS HANDED A DOCUMENT RATHER THAN A FOLDER, so what it means to keep
//something is ../core/state's business and not this file's. That store writes
//beside and moves into place; this used to write straight over the file, and a
//list that loses power mid-write came back as no list at all — which every
//reader here treats as "nothing on the list yet" rather than as a loss.
module.exports = function todos(doc) {

    //`{ next, rows }` RATHER THAN A BARE LIST, so the counter survives a removal.
    //A bare list is still read — see nextNumber — and is what the dashboard's file
    //looks like, so one copied in by hand works and simply cannot promise the
    //number.
    function read() {
        var kept = doc.read(null);
        if (Array.isArray(kept)) return { next: 0, rows: kept };
        if (kept && Array.isArray(kept.rows)) return { next: Number(kept.next) || 0, rows: kept.rows };
        return { next: 0, rows: [] };
    }

    //A WRITE THAT DID NOT HAPPEN IS NOT A WRITE.
    //
    //THIS SWALLOWED THE FAILURE — "the answer still stands for this call" — and
    //it was defensible while the only way to fail was a disk hiccup: the caller
    //got its answer and the next read simply had one fewer row. It stopped being
    //defensible when this list started following the open folder, because now
    //there is a failure that means "there is nowhere to keep this", and
    //swallowing it makes `todoAdd` answer "T4, added" having kept nothing at
    //all. A list that reports success and forgets is worse than one that refuses.
    function write(kept) {
        doc.write(kept);
        return kept;
    }

    //FOUND BY WHATEVER SOMEBODY HAS TO HAND: T4, 4, or the id. A model that read
    //the list has the ref in front of it and a person types the short thing.
    function find(list, which) {
        var want = String(which == null ? '' : which).trim().toLowerCase();
        if (!want) return null;
        for (var i = 0; i < list.length; i++) {
            var r = list[i];
            if (String(r.id).toLowerCase() === want) return r;
            if ('t' + r.number === want) return r;
            if (String(r.number) === want) return r;
        }
        return null;
    }

    function all() {
        return read().rows.slice()
            .sort(function (a, b) { return (Number(a.number) || 0) - (Number(b.number) || 0); })
            .map(withRef);
    }

    function get(which) {
        var found = find(read().rows, which);
        return found ? withRef(found) : null;
    }

    function add(what, why, state, by) {
        var said = clean(what, MOST_WHAT);
        if (!said) {
            throw new Error('Say what is to be done, in a line. That line is what somebody reads in a list of twenty, so it has to make sense without the rest of it.');
        }

        var now = String(state || 'open').trim().toLowerCase();
        if (STATES.indexOf(now) < 0) throw new Error('"' + state + '" is not a state. One of: ' + STATES.join(', ') + '.');

        var kept = read();
        var number = nextNumber(kept);
        var at = new Date().toISOString();
        var row = {
            id: 'todo-' + number + '-' + at.slice(0, 10),
            number: number,
            what: said,
            why: clean(why, MOST_WHY) || null,
            state: now,
            //WHOSE IDEA IT WAS, which is the first question anybody asks about a
            //list two things write to. Never inferred here: whoever calls this
            //knows, and a guess would be wrong in exactly the interesting case.
            by: by ? clean(by, 40) : null,
            at: at,
            touched: at,
            done: now === 'done' ? at : null
        };
        kept.rows.push(row);
        write({ next: number, rows: kept.rows.slice(-MOST_ROWS) });
        return withRef(row);
    }

    //WHAT IS CHANGED IS WHAT IS PASSED. Everything else is left alone, so marking
    //something done does not quietly drop the reason it was written.
    function edit(which, changes) {
        var c = changes || {};
        var kept = read();
        var found = find(kept.rows, which);
        if (!found) throw new Error('There is no todo "' + which + '". Ask for the list to see what there is.');

        if (c.what !== undefined) {
            var said = clean(c.what, MOST_WHAT);
            if (!said) throw new Error('A todo with nothing in it is not a todo. To take it off the list, mark it done or remove it.');
            found.what = said;
        }
        if (c.why !== undefined) found.why = clean(c.why, MOST_WHY) || null;
        if (c.state !== undefined) {
            var now = String(c.state || '').trim().toLowerCase();
            if (STATES.indexOf(now) < 0) throw new Error('"' + c.state + '" is not a state. One of: ' + STATES.join(', ') + '.');
            //WHEN IT WAS FINISHED, kept the first time it was. Something reopened
            //and finished again keeps the newer one, because that is when it was
            //actually done; something edited while already done does not have its
            //date moved.
            if (now === 'done' && found.state !== 'done') found.done = new Date().toISOString();
            if (now !== 'done') found.done = null;
            found.state = now;
        }
        found.touched = new Date().toISOString();
        if (c.by) found.touchedBy = clean(c.by, 40);

        write(kept);
        return withRef(found);
    }

    function remove(which) {
        var kept = read();
        var found = find(kept.rows, which);
        if (!found) throw new Error('There is no todo "' + which + '".');
        //THE COUNTER IS LEFT WHERE IT IS. That is the whole point: the number
        //this one held is spent, and nothing else is ever given it.
        write({ next: nextNumber(kept) - 1, rows: kept.rows.filter(function (r) { return r !== found; }) });
        return withRef(found);
    }

    return {
        all: all,
        get: get,
        add: add,
        edit: edit,
        remove: remove,
        //EMPTIED, BUT NOT BACK TO T1. Nothing calls this but the drills; a
        //fresh-looking list that reuses every ref is the same trap as above.
        clear: function () { var kept = read(); return write({ next: nextNumber(kept) - 1, rows: [] }); },
        read: function () { return read().rows; },
        STATES: STATES,
        FILE: doc.path
    };
};
