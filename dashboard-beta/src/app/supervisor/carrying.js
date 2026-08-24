//---------------------------------------------------------------------------
//WHAT THE SUPERVISOR IS IN THE MIDDLE OF.
//
//A supervisor is woken, reads, decides, acts and stops. Between wakings it
//remembers one number — the bookmark saying how far it has read — and nothing
//else. That is enough while every decision finishes inside one waking, and it
//stops being enough the moment work has stages:
//
//    issue #42 -> a judgement to check whether it is real -> a line -> a task
//    to fix it -> another judgement -> a change sent out
//
//Six wakings, minimum, usually more. Without somewhere to put it, each waking
//re-derives where it had got to by reading the whole board and guessing — and a
//guess about "did I already ask for that" is how the same judgement gets queued
//twice, or a task sits waiting for a re-judgement nobody asked for.
//
//SO: A LINE OF STATE PER THING IT IS CARRYING, keyed by what it is ABOUT — a
//task, a judgement, an issue, a line — because that is what it thinks in.
//
//---- a notebook, not a second board ---------------------------------------
//
//NOTHING HERE DECIDES ANYTHING AND NOTHING READS IT TO ACT. The tasks are in the
//task store and the judgements in theirs, and what is TRUE about them is read
//from those. What is kept here is only what a supervisor believes it is doing,
//which exists nowhere else because nothing else has an opinion about it.
//
//WHICH MEANS IT CAN BE WRONG, and that is survivable by design: throw it away
//and the supervisor is exactly where it was on day one — reading the board and
//working it out. Anything that could not survive that does not belong here.
//
//FOR THE PERSON TOO. The window can show what the supervisor thinks it is in the
//middle of, which is the one question a chat transcript answers badly.
//---------------------------------------------------------------------------

//THE STATES THIS APP SUGGESTS, and does NOT enforce. Triage is somebody's
//working vocabulary and a fixed list would be wrong for the third project that
//uses this. Suggested, because a vocabulary that drifts every waking is not a
//vocabulary — and these are the five states this flow actually has.
var USUAL = ['waiting on a judge', 'waiting on a worker', 'needs a person', 'ready to send', 'done'];

//LONG ENOUGH FOR A SENTENCE SOMEBODY READS AT A GLANCE, short enough that this
//cannot become the place a model writes its reasoning. Reasoning belongs in what
//it says to the person; this is a label and a line.
var MOST_STATE = 40;
var MOST_NOTE = 500;
var MOST_ROWS = 200;

function clean(s, most) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, most);
}

module.exports = function carrying(doc) {
    function read() {
        var kept = doc.read({ rows: [] });
        return (kept && Array.isArray(kept.rows)) ? kept.rows : [];
    }

    function write(rows) { doc.write({ rows: rows }); return rows; }

    function all() {
        return read().map(function (r) {
            return Object.assign({}, r, { usual: USUAL.indexOf(r.state) >= 0 });
        });
    }

    //ONE ENTRY PER THING. Writing about the same thing again REPLACES it — this
    //is where something IS, not a history of where it has been, and the history
    //is in the record of what actually happened rather than in what somebody
    //thought was happening.
    function set(what) {
        var w = what || {};
        var about = clean(w.about, 80);
        if (!about) {
            throw new Error('Say what this is about — a task like "#131", a judgement like "J5", an issue, '
                + 'or a line. It is the name you will look it up by.');
        }

        var state = clean(w.state, MOST_STATE);
        if (!state) {
            throw new Error('Say what state it is in. Short: ' + USUAL.join(', ')
                + ' — or your own words, as long as you keep using the same ones.');
        }

        var rows = read().filter(function (r) { return r.about !== about; });
        var row = {
            about: about,
            state: state,
            note: clean(w.note, MOST_NOTE) || null,
            at: new Date().toISOString(),
            by: w.by ? clean(w.by, 40) : null
        };
        rows.push(row);

        //OLDEST FIRST, CAPPED. A notebook that grows for ever becomes a thing
        //nobody reads, and the entries that matter are the ones touched recently.
        rows.sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); });
        write(rows.slice(-MOST_ROWS));
        return row;
    }

    function forget(about) {
        var what = clean(about, 80);
        var rows = read();
        var found = rows.filter(function (r) { return r.about === what; })[0];
        if (!found) throw new Error('Nothing is being carried about "' + about + '".');
        write(rows.filter(function (r) { return r.about !== what; }));
        return { forgotten: found.about, was: found.state };
    }

    function clear() { return write([]); }

    return { all: all, set: set, forget: forget, clear: clear, read: read, USUAL: USUAL };
};

module.exports.USUAL = USUAL;
module.exports.MOST_ROWS = MOST_ROWS;
