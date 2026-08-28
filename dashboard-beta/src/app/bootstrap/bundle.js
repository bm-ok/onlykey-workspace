var fs = require('fs');
var path = require('path');

//---------------------------------------------------------------------------
//A SET OF SKILLS, JOBS, PROMPTS AND CONTRACTS, AS FILES.
//
//WHY THIS EXISTS: delete the data directory and everything a supervisor was
//taught is gone. Not the app — the app is fine — but the contracts somebody
//wrote, the prompts they tuned, the jobs, and the three documents that say what
//a supervisor, a worker and a judge each believe they are. Starting again from
//nothing is the failure this prevents.
//
//SO THE REPO KEEPS ONE, and it is a seed rather than a copy. What is checked in
//is enough to get a supervisor running and teaching itself again; what a project
//actually runs on diverges from it and belongs to that project.
//
//---- ONE READABLE FILE PER BODY, AND ONE MANIFEST FOR THE WIRING ----------
//
//    library.json      ids, names, what each is about, and what points at what
//    contracts/<id>.md prompts/<id>.md  jobs/<id>.js  skills/<which>.md
//
//NOT ONE JSON DOCUMENT WITH THE BODIES INSIDE IT, which is the obvious other
//shape and is the exact mistake ../library/starters.js already made: a contract
//kept as a JavaScript string with `\n` between every line is a contract nobody
//can read, diff, or edit without escaping it correctly. These are documents. The
//whole argument of this app is that documents read for approval have to be
//READABLE, and that has to be true of the copy on disk as well as the one on
//screen.
//
//AND THE MANIFEST HOLDS THE LINKS BECAUSE THEY ARE THE HARD PART. A job names a
//prompt and a prompt names a contract; rebuilding from nothing, the order those
//have to arrive in and what refers to what is the thing you cannot reconstruct
//by reading three folders.
//
//---- WHAT IS DELIBERATELY NOT IN IT ---------------------------------------
//
//APPROVALS. Not stripped as an afterthought — never written. An approval is a
//person saying they read THIS text on THIS machine, and a bundle that carried
//one would let a set of jobs arrive pre-approved and ready to run on a machine
//nobody had shown them to. Everything imported arrives waiting to be read.
//
//AND `setAside`, `edited`, `written`, hashes: state about a copy rather than
//about the thing. A fresh import is fresh.
//---------------------------------------------------------------------------

//THE FIELDS THAT ARE AUTHORED, per kind. Everything else on an entry is derived
//or is approval state, and neither belongs to a document.
var CARRIES = {
    contract: ['id', 'name', 'about', 'kind'],
    prompt: ['id', 'name', 'about', 'kind', 'contractId'],
    job: ['id', 'name', 'about', 'kind', 'promptId', 'tags']
};

var FOLDER = { contract: 'contracts', prompt: 'prompts', job: 'jobs' };
var SUFFIX = { contract: '.md', prompt: '.md', job: '.js' };

//A FILE NAME, AND NEVER A CALLER'S STRING USED RAW. An id comes from a library
//entry, and an id read back out of a manifest comes from a folder somebody may
//have edited by hand — so it is checked on the way in as well as on the way out.
function safe(name) {
    return String(name == null ? '' : name).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
}

function only(entry, fields) {
    var out = {};
    fields.forEach(function (f) {
        var v = entry[f];
        if (v === undefined || v === null || v === '') return;
        out[f] = v;
    });
    return out;
}

//---- writing one -----------------------------------------------------------
//
//    at        the folder to write into, made if it is not there
//    sets      { contract: [...], prompt: [...], job: [...] } of full entries
//    bodyOf    (kind, entry) => the text or the code
//    skills    [{ which, title, text }]
function write(at, sets, bodyOf, skills) {
    var manifest = { made: 'okc', kinds: {}, skills: [] };

    fs.mkdirSync(at, { recursive: true });

    Object.keys(FOLDER).forEach(function (kind) {
        var list = (sets && sets[kind]) || [];
        if (!list.length) return;

        var dir = path.join(at, FOLDER[kind]);
        fs.mkdirSync(dir, { recursive: true });

        manifest.kinds[kind] = list.map(function (e) {
            var body = bodyOf(kind, e);
            fs.writeFileSync(path.join(dir, safe(e.id) + SUFFIX[kind]), String(body == null ? '' : body));
            return only(e, CARRIES[kind]);
        });
    });

    (skills || []).forEach(function (s) {
        if (!s || !s.text) return;
        var dir = path.join(at, 'skills');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, safe(s.which) + '.md'), String(s.text));
        manifest.skills.push({ which: s.which, title: s.title || s.which });
    });

    fs.writeFileSync(path.join(at, 'library.json'), JSON.stringify(manifest, null, 2) + '\n');
    return manifest;
}

//---- and reading one -------------------------------------------------------
//
//THE MANIFEST DECIDES WHAT IS IN THE BUNDLE, not the folders. A file somebody
//dropped in `contracts/` without listing it is not imported: reading a directory
//and trusting what is in it is how a bundle grows things nobody put there.
//
//THE BODY IS REQUIRED. A manifest entry whose file is missing is a broken
//bundle, and importing it as an empty contract — no rules at all — is the worst
//available reading of a mistake.
function read(at, readFile, exists) {
    var readIt = readFile || function (p) { return fs.readFileSync(p, 'utf8'); };
    var isThere = exists || function (p) { try { return fs.existsSync(p); } catch (e) { return false; } };

    var manifestAt = path.join(at, 'library.json');
    if (!isThere(manifestAt)) {
        throw new Error('There is no library.json in "' + at + '", so this is not a bundle. One is written by '
            + 'bootstrapExport, and the manifest is what says which files belong to it.');
    }

    var manifest;
    try { manifest = JSON.parse(readIt(manifestAt)); }
    catch (e) { throw new Error('The manifest in "' + at + '" could not be read: ' + e.message); }

    var out = { kinds: {}, skills: [] };

    Object.keys(FOLDER).forEach(function (kind) {
        var list = (manifest.kinds || {})[kind] || [];
        out.kinds[kind] = list.map(function (e) {
            var file = path.join(at, FOLDER[kind], safe(e.id) + SUFFIX[kind]);
            if (!isThere(file)) {
                throw new Error('The manifest lists the ' + kind + ' "' + e.id + '" and there is no file for it '
                    + 'at ' + file + '. An import that quietly left the body out would write an empty one.');
            }
            return Object.assign(only(e, CARRIES[kind]), { body: readIt(file) });
        });
    });

    (manifest.skills || []).forEach(function (s) {
        var file = path.join(at, 'skills', safe(s.which) + '.md');
        if (!isThere(file)) {
            throw new Error('The manifest lists the skill "' + s.which + '" and there is no file for it at '
                + file + '.');
        }
        out.skills.push({ which: s.which, title: s.title || s.which, text: readIt(file) });
    });

    return out;
}

//HANDED OUT SO A SECOND WAY OF CARRYING A BUNDLE — a single file rather than a
//folder — uses the same names in the same places. See ../bootstrap/server.js:
//two lists of what a bundle looks like is where a folder and a tar would start
//to mean different things.
//---- WHAT MOVED BETWEEN TWO BUNDLES -----------------------------------------
//
//A TAR REWRITTEN FROM THE LIVE SET IS A DIFF NOBODY CAN READ: one binary blob
//became another. The question somebody asks before committing it is "what
//actually changed", and the answer that was worth writing into a commit
//message was "one of twenty-five entries moved: skills/judge.md, 5,248 bytes
//to 6,727". So that is the shape: by name, with both sizes.
//
//    was, now   [{ name, data }] as `archive.make` takes them
//    ->         { added, changed, removed, same, moved }  names in order, and
//               `moved` as the count of everything not the same
function changes(was, now) {
    var before = {}, after = {};
    (was || []).forEach(function (f) { before[f.name] = String(f.data == null ? '' : f.data); });
    (now || []).forEach(function (f) { after[f.name] = String(f.data == null ? '' : f.data); });

    var out = { added: [], changed: [], removed: [], same: [] };
    Object.keys(after).forEach(function (name) {
        if (!(name in before)) out.added.push({ name: name, now: after[name].length });
        else if (before[name] !== after[name]) {
            out.changed.push({ name: name, was: before[name].length, now: after[name].length });
        } else out.same.push(name);
    });
    Object.keys(before).forEach(function (name) {
        if (!(name in after)) out.removed.push({ name: name, was: before[name].length });
    });
    out.moved = out.added.length + out.changed.length + out.removed.length;
    return out;
}

module.exports = {
    write: write, read: read, changes: changes,
    CARRIES: CARRIES, FOLDER: FOLDER, SUFFIX: SUFFIX,
    safe: safe,
    carried: function (kind, entry) { return only(entry, CARRIES[kind]); }
};
