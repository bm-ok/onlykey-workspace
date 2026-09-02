//---------------------------------------------------------------------------
//WHAT THE SUPERVISOR KNOWS.
//
//A supervisor is woken, reads, decides, acts and stops. Between wakings it
//remembers one number — the bookmark saying how far it has read — and nothing
//else. Everything it worked out goes with the waking that worked it out.
//
//SO IT WROTE THINGS DOWN WHERE IT COULD, and the only place it could was the
//todo list, because that was the one store it could put free text in that a
//person could then see. That is not misuse: a list of things TO DO filled up
//with things that are simply TRUE — the owner prefers short commits, this
//repository's tests need a display, do not touch the firmware without asking —
//because there was nowhere else to put them.
//
//---- this replaces ./carrying.js, which was nearly it ----------------------
//
//`triage` already gave the supervisor read, write and delete, all three on its
//allowed list. What it did not have was a PANE, so nobody could look at it —
//while the todo list was visible. That asymmetry is most of why the notes went
//to the wrong store.
//
//AND ITS SHAPE WAS FOR A DIFFERENT JOB. A triage row was
//`about -> {state, note}` with `state` REQUIRED and the note capped at 500
//characters, and both were right for what it was: tracking what a supervisor is
//waiting on, deliberately too small to become the place a model writes its
//reasoning.
//
//NEITHER SURVIVES CONTACT WITH A MEMORY. "The owner prefers short commits" is
//not in a state, and refusing it for not naming one is refusing the fact. Five
//hundred characters is a sentence and a half.
//
//---- what is kept from it, because it was right ---------------------------
//
//KEYED, SO WRITING IT AGAIN EDITS IT. One entry per thing, looked up by name.
//A memory that appends would hold three versions of what somebody prefers and
//no way to say which is current — which is exactly what a list of dated notes
//becomes after a fortnight.
//
//CAPPED, OLDEST FIRST. A memory that grows for ever is one nobody reads, and
//the entries that matter are the ones touched recently.
//
//IT CAN BE WRONG, AND THAT IS SURVIVABLE. Nothing here decides anything. The
//tasks are in the task store and the judgements in theirs; what is TRUE about
//them is read from those. This is what a supervisor believes, which exists
//nowhere else because nothing else has an opinion about it. Throw it away and
//the supervisor is where it was on day one — reading the board and working it
//out. Anything that could not survive that does not belong here.
//---------------------------------------------------------------------------

//A NAME IS LOOKED UP BY, so it is short and it is not a sentence. Long enough
//for "#131" or "how the owner likes commits", short enough that it cannot become
//the note itself.
var MOST_NAME = 80;

//LONG ENOUGH FOR A PARAGRAPH, and that is the change from ./carrying.js's 500.
//A memory that cannot hold the reason behind a fact is one that keeps the fact
//and loses why — and the supervisor then writes the why into the chat, where it
//goes when the conversation is long. That is the whole failure this exists to
//end.
//
//NOT UNBOUNDED. It lives in the workspace drawer, it is read whole at the head
//of a waking, and a memory big enough to fill a context window is one that
//crowds out what the waking is actually about.
var MOST_NOTE = 4000;

//AND `state` IS OPTIONAL NOW, which is the other half of the change. It is kept
//because "waiting on a judge" is a genuinely useful thing to write beside a
//fact about #131 — and it is not required, because most of what a supervisor
//knows is not in a state at all.
var MOST_STATE = 40;

var MOST_ROWS = 200;

function clean(s, most) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, most);
}

//THE NOTE KEEPS ITS LINE BREAKS, and nothing else does. A name and a state are
//labels and are flattened; a note is prose somebody reads, and squashing it to
//one line is how a paragraph becomes a wall.
function cleanNote(s, most) {
    return String(s == null ? '' : s)
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .trim()
        .slice(0, most);
}

module.exports = function memory(doc) {
    function read() {
        var kept = doc.read({ rows: [] });
        return (kept && Array.isArray(kept.rows)) ? kept.rows : [];
    }

    function write(rows) { doc.write({ rows: rows }); return rows; }

    function all() { return read(); }

    function get(name) {
        var want = clean(name, MOST_NAME);
        return read().filter(function (r) { return r.name === want; })[0] || null;
    }

    //ONE ENTRY PER NAME. Writing about the same name again REPLACES it — this is
    //what the supervisor believes NOW, not a history of what it has believed,
    //and the history of what actually happened is in the record.
    function set(what) {
        var w = what || {};
        var name = clean(w.name, MOST_NAME);
        if (!name) {
            throw new Error('Say what this is about — the name you will look it up by. A thing like "#131" '
                + 'or "J5", or a subject like "how the owner likes commits".');
        }

        var note = cleanNote(w.note, MOST_NOTE);
        if (!note) {
            throw new Error('Say what you know about "' + name + '". A name with nothing behind it is a '
                + 'reminder that there was something to remember, which is worse than not writing it down.');
        }

        var was = get(name);
        var rows = read().filter(function (r) { return r.name !== name; });
        var row = {
            name: name,
            note: note,
            //OPTIONAL, AND ABSENT RATHER THAN EMPTY when it is not given. Most of
            //what is known is not in a state; a blank one on every row trains the
            //eye past the field entirely.
            state: clean(w.state, MOST_STATE) || null,
            at: new Date().toISOString(),
            by: w.by ? clean(w.by, 40) : null
        };
        rows.push(row);

        rows.sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); });
        write(rows.slice(-MOST_ROWS));

        //WHETHER THIS WAS NEW SAYS WHAT HAPPENED. "Remembered" and "changed its
        //mind about" are different events, and the caller writes different lines
        //for them.
        return { row: row, was: was };
    }

    function forget(name) {
        var want = clean(name, MOST_NAME);
        var rows = read();
        var found = rows.filter(function (r) { return r.name === want; })[0];
        if (!found) throw new Error('Nothing is remembered about "' + name + '".');
        write(rows.filter(function (r) { return r.name !== want; }));
        return { forgotten: found.name, note: found.note };
    }

    function clear() { return write([]); }

    return { all: all, get: get, set: set, forget: forget, clear: clear, read: read };
};

module.exports.MOST_ROWS = MOST_ROWS;
module.exports.MOST_NOTE = MOST_NOTE;
module.exports.MOST_NAME = MOST_NAME;
