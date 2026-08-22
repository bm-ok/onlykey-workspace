//---------------------------------------------------------------------------
//WHAT HAS BEEN SPENT, AND ON WHOSE SIGN-IN.
//
//Every model run this app causes happens under a named identity — see
//../runners/guests — and until this existed nothing wrote down that it happened.
//A turn logged "it thought for 38s" and a job logged an exit code; what it COST
//went into the transcript on a machine and, for a worker, was rolled back with
//the machine a minute later.
//
//PER KEY, BECAUSE THAT IS THE QUESTION. "How much has this app spent" is mildly
//interesting; "which account is this being billed to, and how much" is a
//question with a person's name on it — the same reason the supervisor's sign-in
//is picked deliberately rather than taken as whichever is free. A host with
//three sign-ins and one number cannot answer it.
//
//A ROW PER RUN, NEVER A RUNNING TOTAL. Totals are computed on the way out, so a
//row recorded wrongly can be removed and the totals are simply right afterwards.
//A stored total is a number nothing can check.
//
//WHAT IS NOT HERE: any attempt to price anything. `cost` is what the model's own
//result line said it cost, carried through unchanged and null when it did not
//say. This app does not know anybody's rates, and a number it invented would be
//indistinguishable from one it was told.
//
//---- and why it lives in the queue, for now --------------------------------
//
//THE QUEUE IS THE ONLY THING THAT WRITES IT — ./metering, at the one moment the
//numbers exist, before the machine is rolled back. Nothing reads it yet: the
//pane that shows what a host has spent has not been ported.
//
//THE DAY THERE IS A SECOND READER this becomes its own plugin, because a
//spending record read by two panes is a shared system and belongs to neither.
//Until then, putting it in core would be a service with one caller sitting where
//everything can reach it.
//---------------------------------------------------------------------------

var fs = require('fs');
var path = require('path');

//ENOUGH TO SEE A MONTH OF ORDINARY USE. Trimmed from the front, so what is lost
//is the oldest — and the totals say how many rows they are computed from, so a
//trim is visible rather than silent.
var MOST_ROWS = 5000;

//A BYTE ORDER MARK AT THE FRONT OF A JSON FILE is not JSON, and PowerShell
//writes one. Stripped rather than allowed to make the whole ledger unreadable.
var BOM = String.fromCharCode(0xFEFF);

function num(v) {
    var n = Number(v);
    return isFinite(n) && v !== null && v !== '' ? n : null;
}

//---- what a `result` line says, in this app's words rather than the CLI's ---
//
//ONE PLACE THAT KNOWS THOSE FIELD NAMES, because they are somebody else's and
//will change. Everything downstream reads `turns`, `cost`, `input`, `output` —
//so the day the CLI renames one, this is the only file that is wrong.
//
//USAGE IS FOUR NUMBERS, NOT ONE. Cached reads are the bulk of a long brief and
//are charged differently from fresh input; adding them together would produce a
//number that looks like context size and is not comparable to anything.
function fromResult(e) {
    if (!e || typeof e !== 'object') return null;
    var u = e.usage || {};
    return {
        turns: num(e.num_turns),
        cost: num(e.total_cost_usd),
        ms: num(e.duration_ms),
        input: num(u.input_tokens),
        output: num(u.output_tokens),
        cacheRead: num(u.cache_read_input_tokens),
        cacheWrite: num(u.cache_creation_input_tokens),
        //WHETHER THE RUN ITSELF SAID IT WENT WRONG. A turn that errored still
        //spent what it spent, so it is recorded and marked rather than dropped.
        trouble: e.is_error === true || String(e.subtype || '') === 'error_during_execution'
    };
}

function add(a, b) { return (a == null && b == null) ? null : Number(a || 0) + Number(b || 0); }

var EMPTY = {
    runs: 0, turns: null, cost: null, ms: null, input: null, output: null,
    cacheRead: null, cacheWrite: null, trouble: 0, first: null, last: null
};

function tallyOf(rows) {
    return (rows || []).reduce(function (t, r) {
        return {
            runs: t.runs + 1,
            turns: add(t.turns, r.turns),
            cost: add(t.cost, r.cost),
            ms: add(t.ms, r.ms),
            input: add(t.input, r.input),
            output: add(t.output, r.output),
            cacheRead: add(t.cacheRead, r.cacheRead),
            cacheWrite: add(t.cacheWrite, r.cacheWrite),
            trouble: t.trouble + (r.trouble ? 1 : 0),
            first: t.first && t.first < r.at ? t.first : r.at,
            last: t.last && t.last > r.at ? t.last : r.at
        };
    }, Object.assign({}, EMPTY));
}

module.exports = function meter(deps) {
    var d = deps || {};

    //A THUNK, for the reason every other store here takes one: asking the data
    //directory where to write while the graph is being built makes its refusal a
    //startup failure rather than an answer to a question nobody asked.
    var file = d.file;
    var now = d.now || function () { return new Date().toISOString(); };

    function read() {
        try {
            var kept = JSON.parse(String(fs.readFileSync(file(), 'utf8')).replace(BOM, ''));
            return Array.isArray(kept) ? kept : [];
        } catch (e) { return []; }
    }

    function write(list) {
        try { fs.mkdirSync(path.dirname(file()), { recursive: true }); } catch (e) { /* it exists */ }
        try { fs.writeFileSync(file(), JSON.stringify(list, null, 2)); }
        catch (e) { /* the answer still stands for this call */ }
        return list;
    }

    //ONE RUN. `key` is the sign-in it was spent on, and it is the field this
    //whole file exists for — a row without one is still recorded, because losing
    //the SPEND is worse than losing the attribution, and it shows as "not
    //attributed" rather than being quietly folded into somebody's total.
    function record(what) {
        var it = what || {};

        var row = {
            at: now(),
            key: it.key ? String(it.key) : null,
            machine: it.machine ? String(it.machine) : null,
            //'supervisor' for a waking, 'task' for a worker's run. Kept as a
            //plain string rather than an enum: a third kind will arrive, and a
            //list here would be one more thing to remember to extend.
            kind: String(it.kind || 'run'),
            about: it.about ? String(it.about).slice(0, 200) : null,
            ref: it.ref ? String(it.ref) : null,
            turns: null, cost: null, ms: null,
            input: null, output: null, cacheRead: null, cacheWrite: null,
            trouble: false
        };

        //WHAT THE RUN ITSELF SAID, over the blanks. ./metering hands the whole
        //`result` line, and reading it is this file's job — see fromResult.
        var said = fromResult(it.result);
        if (said) Object.assign(row, said);

        write(read().concat([row]).slice(-MOST_ROWS));
        return row;
    }

    //BY KEY, AND A TOTAL. Both from the same rows in one pass over the same
    //function, so the columns cannot disagree with the line at the top — which
    //is the one bug a summary screen always has.
    function byKey(rows) {
        var all = rows || read();
        var names = [];
        all.forEach(function (r) {
            var k = r.key || null;
            if (names.indexOf(k) < 0) names.push(k);
        });

        return names
            .map(function (name) {
                return Object.assign({ key: name }, tallyOf(all.filter(function (r) {
                    return (r.key || null) === name;
                })));
            })
            .sort(function (a, b) {
                return Number(b.cost || 0) - Number(a.cost || 0) || b.runs - a.runs;
            });
    }

    function all() {
        return read().slice().sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
    }

    return {
        record: record,
        all: all,
        byKey: byKey,
        total: function (rows) { return tallyOf(rows || read()); },
        read: read,
        clear: function () { return write([]); },
        where: file,
        MOST_ROWS: MOST_ROWS
    };
};

module.exports.fromResult = fromResult;
module.exports.tallyOf = tallyOf;
module.exports.MOST_ROWS = MOST_ROWS;
