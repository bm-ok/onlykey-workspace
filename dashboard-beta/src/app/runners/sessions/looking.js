//---------------------------------------------------------------------------
//WHAT IS INSIDE A SESSION ARCHIVE, AND WHETHER IT MAY BE KEPT AT ALL.
//
//READ ON THE WAY IN, NOT ON THE WAY OUT. The archive is the thing that has to
//survive; a summary of it is what anybody actually looks at, and computing that
//on every paint would mean gunzipping ninety kilobytes and parsing fifty turns
//of JSON on a three-second draw loop. So it is done once, when the bytes arrive,
//and what a panel reads afterwards is a small object.
//
//NOTHING HERE IS TRUSTED. This came off a machine running a script somebody
//wrote — and, on the machines this app makes, a script an AGENT could have
//edited before the upload. Every field is read defensively, and a transcript
//that does not parse produces a summary saying so rather than a throw: losing
//the transcript because its SUMMARY failed would be the tail wagging the dog.
//
//THE TAR READING IS ../../core/archive's, all of it. That plugin already
//refuses what is not a tar, works around nanotar's `byteOffset` handling, and
//never throws on rubbish. A second tar reader on a path a guest feeds is the
//last thing this app needs.
//---------------------------------------------------------------------------

//---- WHAT MUST NEVER BE IN ONE --------------------------------------------
//
//`~/.claude` HOLDS `.credentials.json`, THE WORKER'S OWN TOKEN. The host has a
//copy already, sealed by ../../core/secret; one riding along in here would be an
//UNSEALED copy per piece of work, in a folder whose whole purpose is to be kept
//for a long time.
//
//IT IS EXCLUDED WHEN THE TAR IS BUILT — see ../../vms/dispatch/guest/job-api.js,
//`NOT_THESE`. That is the right place for it and it is not a boundary: job-api
//is a file the HOST writes ONTO the guest, in a directory the agent doing the
//work can read and edit. So the guarantee rested entirely on the guest behaving,
//while the comment beside it called the exclusion load-bearing.
//
//This is the same check on the end a guest cannot edit. It costs one pass over
//an entry list that has already been parsed for the summary anyway.
//
//MATCHED ON THE BASENAME, not the path. The archive is made relative to $HOME so
//it unpacks as `.claude` wherever it lands, which means the entry is
//`.claude/.credentials.json` — but a differently-built tar could put it at
//`./.claude/.credentials.json`, or in a subfolder, and the answer is the same
//either way. What is being refused is the FILE, not one spelling of where it sat.
var NEVER = ['.credentials.json'];

function basename(name) {
    var n = String(name || '').replace(/\\/g, '/');
    var cut = n.lastIndexOf('/');
    return cut < 0 ? n : n.slice(cut + 1);
}

//The names in it that must not be, or an empty list. A LIST rather than a
//boolean, so the refusal can say what it found — "there is a credential in it"
//is actionable and "it was refused" is not.
function mustNotHave(entries) {
    return (entries || [])
        .filter(function (e) { return e && NEVER.indexOf(basename(e.name)) >= 0; })
        .map(function (e) { return String(e.name); });
}

//---- THE TRANSCRIPT, AND WHICH ONE ----------------------------------------
//
//THE BIGGEST ONE IN IT. A run resumed into an existing project folder can leave
//more than one, and the one being carried on is the one with something in it.
function transcriptIn(entries) {
    return (entries || [])
        .filter(function (e) { return e && /projects\/.*\.jsonl$/.test(e.name || ''); })
        .sort(function (a, b) { return (b.size || 0) - (a.size || 0); })[0] || null;
}

//---- AND WHAT HAPPENED IN IT ----------------------------------------------
//
//`text` is the transcript as a string; every line is a JSON object and any line
//may be rubbish.
//
//A `.jsonl` WHOSE LAST LINE IS HALF-WRITTEN IS AN ORDINARY STATE: a run killed
//mid-write leaves one, and everything before it still counts. So an unparseable
//line is skipped rather than ending the read.
function summarise(text) {
    var out = {
        turns: 0, tools: [], touched: [], moreTouched: 0,
        model: null, tokens: null, from: null, to: null, errors: 0
    };

    var tools = new Map();
    var touched = new Set();
    var models = new Set();
    var inTok = 0, outTok = 0, cache = 0;

    var lines = String(text == null ? '' : text).split('\n');
    for (var i = 0; i < lines.length; i++) {
        if (!lines[i].trim()) continue;

        var t = null;
        try { t = JSON.parse(lines[i]); } catch (e) { continue; }
        if (!t || typeof t !== 'object') continue;

        out.turns++;
        if (t.timestamp) {
            if (!out.from) out.from = t.timestamp;
            out.to = t.timestamp;
        }
        if (t.isApiErrorMessage) out.errors++;

        var m = t.message || {};

        //`<synthetic>` IS WHAT CLAUDE WRITES FOR A TURN IT MADE UP rather than
        //one a model produced, and reporting it as the model somebody used is a
        //small lie in the one field people read first.
        if (m.model && m.model !== '<synthetic>') models.add(m.model);

        if (m.usage) {
            inTok += m.usage.input_tokens || 0;
            outTok += m.usage.output_tokens || 0;
            cache += m.usage.cache_read_input_tokens || 0;
        }

        if (!Array.isArray(m.content)) continue;
        for (var c = 0; c < m.content.length; c++) {
            var part = m.content[c];
            if (!part || part.type !== 'tool_use') continue;
            tools.set(part.name, (tools.get(part.name) || 0) + 1);
            var where = part.input
                && (part.input.file_path || part.input.path || part.input.notebook_path);
            if (where) touched.add(String(where));
        }
    }

    out.model = Array.from(models).join(', ') || null;
    out.tools = Array.from(tools)
        .map(function (pair) { return { name: pair[0], n: pair[1] }; })
        .sort(function (a, b) { return b.n - a.n; });

    //BOUNDED, because this is written into a record that is read on every draw,
    //and a worker that touched four hundred files would otherwise put all four
    //hundred in it. The count of what was left out is kept, so "40" never reads
    //as "that is all of them".
    var all = Array.from(touched);
    out.touched = all.slice(0, 40);
    out.moreTouched = Math.max(0, all.length - 40);

    out.tokens = { in: inTok, out: outTok, cache: cache };
    return out;
}

module.exports = {
    NEVER: NEVER,
    basename: basename,
    mustNotHave: mustNotHave,
    transcriptIn: transcriptIn,
    summarise: summarise
};
