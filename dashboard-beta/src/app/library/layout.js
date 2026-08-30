var fs = require('fs');
var path = require('path');

//---------------------------------------------------------------------------
//THE LIBRARY, KEPT THE WAY A BUNDLE IS LAID OUT.
//
//A workspace's drawer IS a bundle now:
//
//    library.json          what is here, and what each thing is
//    contracts/<id>.md     the rules, as text
//    prompts/<id>.md       the instruction, as text
//    jobs/<id>.js          the script, as code
//    skills/<which>.md     written by ../bootstrap, read by nothing here
//
//WHICH IS THE SAME LAYOUT `bootstrapExport` WRITES, on purpose: an exported tar
//unpacked into a workspace's `.okc` is that workspace's library, and a workspace
//tarred up is a bundle. There is no import step that rewrites one shape into
//another, because there are no longer two shapes.
//
//IT WAS THREE JSON BLOBS — `contracts.json`, `prompts.json`, `jobs.json`, with
//the text inline and job CODE already in `jobs/<id>.js`. So jobs were half of
//this layout already, and the other two kept a document nobody could read
//without the app. A contract is prose that a person writes and a worker is held
//to; keeping it as an escaped string inside an array is the reason editing one
//meant using the app.
//
//---- what this is NOT ------------------------------------------------------
//
//NOT A SECOND COPY OF ../bootstrap/bundle.js, which writes the same folders for
//a DIFFERENT purpose: a bundle is what goes to a machine, so it carries only the
//fields a machine needs — `CARRIES` there is four or five keys, and approval is
//deliberately not among them.
//
//THIS KEEPS THE WHOLE RECORD, including the approval, because it is the working
//store rather than a thing being sent. The two layouts agree on the FILES and
//differ in how much of each entry the manifest holds — which is what makes a
//bundle droppable in: every field it lacks is one this reads as absent, and an
//entry with no approval is exactly an entry nobody has approved yet.
//
//THAT IS THE SAFE DIRECTION and not a coincidence worth relying on quietly: a
//tar that could carry approval would be a way to arrive pre-ratified, and
//approving is the receiving host's act. See ../library/server.js, which refuses
//a model its own ratification.
//---------------------------------------------------------------------------

//---- THE FOLDERS AND NAMES ARE ../bootstrap/bundle.js's -------------------
//
//ASKED FOR RATHER THAN REPEATED. `contracts/`, `.md`, and what an id may look
//like as a filename are already decided over there, by the thing that writes the
//tar — and this layout is only worth anything if the two agree exactly. Two
//copies of "a contract goes in contracts/ and ends .md" is two copies that stay
//equal until somebody changes one.
var bundle = require('../bootstrap/bundle');

var FOLDER = bundle.FOLDER;
var SUFFIX = bundle.SUFFIX;
var safe = bundle.safe;

//WHERE THE BODY OF A THING LIVES, and for a job the answer is "not here". A
//job's code is written and read by ../library/server.js's own `jobsDir`, which
//had it on disk before this existed and still owns it — so this writes the
//manifest for a job and leaves the file alone.
var INLINE = { contract: 'text', prompt: 'text', job: null };

module.exports = function layout(dirOf, kind) {
    var folder = FOLDER[kind];
    var suffix = SUFFIX[kind];
    var inline = INLINE[kind];

    if (!folder) throw new Error('There is no library layout for "' + kind + '".');

    async function where() {
        var at = await dirOf();
        if (!at) throw new Error('No workspace is open, so there is no library to read.');
        return at;
    }

    function manifestAt(at) { return path.join(at, 'library.json'); }

    //THE WHOLE MANIFEST, because writing one kind must not lose the others. All
    //three libraries share this file, and a read-modify-write that only knew
    //about its own kind would drop the other two every time anything was saved.
    function readManifest(at) {
        var text;
        try { text = fs.readFileSync(manifestAt(at), 'utf8'); }
        catch (e) { return { made: 'okc', kinds: {}, skills: [] }; }

        try {
            //A BYTE-ORDER MARK IN FRONT OF THE BRACE is what a file picks up
            //from having been opened in an editor — and this file is MEANT to be
            //opened in an editor, so it is likelier here than anywhere else.
            var m = JSON.parse(text.replace(/^﻿/, ''));
            if (!m || typeof m !== 'object') return { made: 'okc', kinds: {}, skills: [] };
            if (!m.kinds || typeof m.kinds !== 'object') m.kinds = {};
            return m;
        } catch (e) {
            //UNREADABLE IS NOT EMPTY, and the difference matters: answering "no
            //contracts" for a manifest somebody broke by hand would let the app
            //carry on and write a fresh one over the top of it.
            throw new Error(manifestAt(at) + ' could not be read as JSON. Fix or remove it; '
                + 'nothing in this library is listed until then.');
        }
    }

    function bodyPath(at, id) { return path.join(at, folder, safe(id) + suffix); }

    function bodyOf(at, id) {
        try { return fs.readFileSync(bodyPath(at, id), 'utf8'); }
        catch (e) { return ''; }
    }

    return {
        //THE SHAPE ../library/entries.js ALREADY TAKES — `read(fallback)` and
        //`write(list)` — so nothing above this had to learn a new store.
        read: function (fallback) {
            var at;
            try { at = this._at; } catch (e) { at = null; }
            if (!at) return fallback;

            var list = readManifest(at).kinds[kind];
            if (!Array.isArray(list)) return fallback;

            if (!inline) return list;

            //THE BODY IS PUT BACK ON THE WAY OUT, so everything above this goes
            //on seeing one record with its text in it. A missing file reads as
            //empty rather than throwing: the manifest is what says a thing
            //exists, and a contract whose file somebody deleted is a contract
            //with no rules in it — which the approval check then refuses on,
            //rather than this failing the whole read.
            return list.map(function (e) {
                var out = Object.assign({}, e);
                out[inline] = bodyOf(at, e.id);
                return out;
            });
        },

        write: function (list) {
            var at = this._at;
            var m = readManifest(at);

            fs.mkdirSync(at, { recursive: true });

            if (inline) {
                fs.mkdirSync(path.join(at, folder), { recursive: true });
                (list || []).forEach(function (e) {
                    fs.writeFileSync(bodyPath(at, e.id), String(e[inline] == null ? '' : e[inline]));
                });
            }

            //WHAT WAS TAKEN OUT IS TAKEN OFF THE DISK. An entry forgotten in the
            //app leaving its file behind is how a folder fills with things the
            //manifest does not list — and ../bootstrap's reader trusts the
            //manifest, so those would be invisible until somebody looked.
            var keeping = {};
            (list || []).forEach(function (e) { keeping[safe(e.id)] = true; });
            var was = m.kinds[kind];
            if (inline && Array.isArray(was)) {
                was.forEach(function (e) {
                    if (keeping[safe(e.id)]) return;
                    try { fs.unlinkSync(bodyPath(at, e.id)); } catch (err) { /* already gone */ }
                });
            }

            m.kinds[kind] = (list || []).map(function (e) {
                if (!inline) return e;
                var out = Object.assign({}, e);
                delete out[inline];
                return out;
            });

            if (!m.made) m.made = 'okc';
            if (!Array.isArray(m.skills)) m.skills = [];

            //WRITTEN BESIDE AND MOVED INTO PLACE, the same way ../core/state
            //writes a document and for the same reason: a reader that opens this
            //mid-write does not get an error, it gets the fallback — which every
            //caller treats as "nothing kept yet".
            var beside = manifestAt(at) + '.writing';
            fs.writeFileSync(beside, JSON.stringify(m, null, 2) + '\n');
            fs.renameSync(beside, manifestAt(at));
            return list;
        },

        //RESOLVED BEFORE EITHER OF THE ABOVE. `read` and `write` are synchronous
        //because that is the shape entries.js expects of a document, and which
        //workspace is open is an async question — so the folder is worked out
        //here and handed to them.
        at: async function () {
            var box = Object.create(this);
            box._at = await where();
            return box;
        }
    };
};

module.exports.FOLDER = FOLDER;
module.exports.SUFFIX = SUFFIX;
