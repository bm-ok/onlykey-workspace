var fs = require('fs');
var path = require('path');
var zlib = require('zlib');
var nanotar = require('./vendor/nanotar/nanotar.js');

//---------------------------------------------------------------------------
//WHERE FILES ARE KEPT, AND HOW THEY ARE READ BACK.
//
//Not what any of them MEAN. Three things in this app hand bytes to a host and
//want them again later, and every one of them wanted the same six answers —
//where does this go, what is here, read me one, is it there, throw it away, what
//is on disk in total. Written three times that is three chances to get the name
//safety, the size cap or the binary check slightly different.
//
//    a run's output      what a worker printed, kept because the machine it ran
//                        on is rolled back the moment the work ends
//    a task's artefacts  a firmware image, a package — what a branch cannot hold
//    a worker's session  its `~/.claude`, tarred, so a task given out twice is
//                        one worker having a second go rather than two strangers
//
//THOSE ARE THREE DIFFERENT THINGS AND STAY THREE STORES. They have different
//lifetimes, different readers and different size limits; what they share is the
//machinery, and the machinery is what is here. `store(name)` is how each gets
//its own drawer.
//
//---- and it is the workspace's drawer, not the host's ----------------------
//
//ROOTED AT `state.here`, which is per-workspace. Point the app at a second
//workspace and the first one's artefacts are not sitting there, answering, about
//tasks that are not in front of you — the contamination ../state's own header
//exists to prevent, which applies to what a task PRODUCED exactly as much as to
//the note about it.
//
//INSIDE THE WORKSPACE, AT `<the folder>/.okc/`, AND THIS USED TO SAY THE
//OPPOSITE. The old note argued that a workspace is a folder somebody may clone or
//`git clean -xdf`, so what a run handed back would be one command from gone if it
//lived there. That risk is real and is now accepted rather than avoided — see
//../state's header for the trade and why it was taken.
//
//WHAT IT MEANS HERE SPECIFICALLY: an artifact is the ONLY copy of what a run
//produced. Deleting a workspace folder deletes them, and unlike the machines
//there is no VirtualBox to recover them from. Anything that has to survive the
//folder has to be sent somewhere else first — a pull request, a branch, a file
//somebody saved — and that was always true; it is just no longer softened by the
//artifacts happening to sit somewhere the folder's deletion would miss.
//
//---- what "viewed" means here ---------------------------------------------
//
//READING ONE BACK IS PART OF KEEPING IT, so the refusals live here too: a
//binary is refused rather than rendered as replacement characters, something
//enormous is refused with its size rather than loaded into a panel, and an
//archive can be looked INSIDE without being unpacked to disk.
//
//THE TAR READER IS VENDORED HERE for that last one — see ./vendor/README.md.
//Node ships `zlib` so gzip is free; tar is the half it has no opinion about.
//
//---- this is not ../../queue/archive.js -----------------------------------
//
//That one is the QUEUE'S run-log store and is one of the three above. This is
//the mechanism under it. They share a word, so both headers say which is which —
//two things under one name is how they get merged later by somebody tidying.
//
//---- nothing that arrives here is trusted ---------------------------------
//
//BYTES COME OFF A MACHINE RUNNING A SCRIPT SOMEBODY WROTE, and a NAME comes with
//them. The name never becomes a path until it has been through `nameIsOk`, and
//that is an allow list rather than a hunt for every spelling of "the parent
//directory": a name either matches or it is not a name. Same shape as the
//repository names in ../../repositories, and for the same reason — being sure
//you thought of every traversal is not a thing anybody manages twice.
//---------------------------------------------------------------------------

//A NAME A GUEST MAY SEND. No directory component, because there is nothing to
//traverse out of if one never arrives.
var NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

//BIG ENOUGH FOR A FIRMWARE IMAGE OR A PACKAGED BUILD, small enough that a
//runaway `dd` cannot fill this host's disk before anybody notices. A refusal
//says the size, because "too big" without a number is unactionable.
var MOST = 256 * 1024 * 1024;

//AND SMALL ENOUGH TO PUT IN A PANEL. Past this, the answer is "open it from the
//folder" rather than a megabyte of text down a socket.
var READABLE = 2 * 1024 * 1024;

function safe(s) {
    return String(s == null || s === '' ? 'unknown' : s)
        .replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
}

//WHETHER A NAME IS ONE THIS WILL ACCEPT, said as a sentence rather than a
//boolean, because the caller has to tell a guest why.
function nameIsOk(name) {
    var n = String(name == null ? '' : name);
    if (!n) return 'it needs a name';
    if (n.length > 120) return 'that name is too long';
    if (!NAME.test(n)) {
        return 'a name may contain letters, numbers, dot, dash and underscore, and must start with a '
            + 'letter or a number — no directories, and no path of any kind';
    }
    return null;
}

//THE TWO BYTES THAT SAY GZIP. Checked rather than taken from a file name: the
//caller has bytes, and the name they came under was chosen on a machine.
function gzipped(bytes) {
    return !!(bytes && bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b);
}

//---- a Buffer may not be handed to the tar reader as it stands -------------
//
//`parseTar` DOES `data.buffer || data` AND IGNORES `byteOffset`. A node Buffer
//is usually a VIEW into a shared pool, so its `.buffer` is the whole pool — and
//the reader then parses from offset 0 of that pool, which is whatever else the
//process happened to put there.
//
//IT DOES NOT FAIL. It returns entries, with names and sizes and types, read out
//of unrelated memory. The first time this was hit, an archive came back holding
//one entry called "bytes: 10240" — this file's own console output, sitting in
//the pool a few hundred bytes along.
//
//SO EVERYTHING IS NORMALISED TO A VIEW THAT STARTS AT ZERO before it goes in.
//The vendored file is not patched: what is in ./vendor is what they published,
//and a local fix there is one nobody sees when it is next updated.
function flat(bytes) {
    if (bytes.byteOffset === 0 && bytes.buffer && bytes.buffer.byteLength === bytes.byteLength) {
        return bytes;
    }
    var out = new Uint8Array(bytes.byteLength);
    out.set(bytes);
    return out;
}

//AND WHETHER THIS IS A TAR AT ALL, which the reader also does not check.
//
//Given rubbish it does not throw — it reads the first hundred bytes as a name
//and hands back an entry. Off a machine, that is an attacker-chosen filename
//presented as the contents of an archive.
//
//`ustar` AT OFFSET 257 is the header magic, in both the POSIX spelling and the
//older GNU one. A tar is also a whole number of 512-byte blocks.
function looksLikeTar(bytes) {
    if (!bytes || bytes.byteLength < 512) return false;
    var magic = Buffer.from(bytes.buffer, bytes.byteOffset + 257, 5).toString('latin1');
    return magic === 'ustar';
}

plugin.consumes = ['state'];
plugin.provides = ['archive'];
async function plugin(imports, register) {
    var state = imports.state;

    //WHERE THIS WORKSPACE KEEPS THINGS, or null when none is open.
    async function drawer() {
        try { return await state.here.where(); }
        catch (e) { return null; }
    }

    //---- one drawer, for one kind of thing ---------------------------------
    //
    //    name    the folder under the workspace's drawer
    //    most    the largest single file it will take
    //    clean   run over anything read back as text — ../secret's redaction,
    //            for a store whose contents are command output
    function store(name, opts) {
        var o = opts || {};

        //A NAME MAY BE A PATH, AND EACH SEGMENT IS MADE SAFE SEPARATELY.
        //
        //`store('artifacts/worker')` is a drawer INSIDE a drawer, which is what
        //lets one ignore rule — `artifacts/` — cover every lane under it,
        //including one added later by somebody who never reads this file.
        //
        //ONE `safe()` OVER THE WHOLE STRING WOULD NOT DO IT. It replaces
        //anything outside `[A-Za-z0-9._-]`, so a slash became an underscore and
        //`artifacts/worker` quietly became the single folder `artifacts_worker`
        //— beside the drawer rather than within it, and outside the rule written
        //to cover it. Nothing would have failed; the files would simply have
        //been staged for commit.
        //
        //`..` IS DROPPED EXPLICITLY, AND `safe()` IS NOT ENOUGH ON ITS OWN.
        //
        //This was written first as split-then-`safe()` and it opened a hole the
        //moment it was tested: `safe()` permits dots, because a file is called
        //`firmware.bin` — so `safe('..')` returns `..` unchanged. That was
        //harmless while the whole name was ONE segment, where
        //`artifacts/../../escape` flattened to the single silly folder
        //`artifacts_.._.._escape`. Splitting on `/` turned the same string into
        //a real climb, and `store('artifacts/../../escape')` wrote OUTSIDE the
        //drawer entirely, into the workspace beside the repositories.
        //
        //A SEGMENT IS A NAME, and `.` and `..` are not names — they are
        //instructions about where to go. So they are removed before `safe()`
        //rather than passed through it.
        //
        //`dirFor` BELOW IS DELIBERATELY NOT CHANGED. A uid comes from work and,
        //at the guest door, from something a machine said — a slash in one must
        //keep FLATTENING rather than nesting, or a machine would choose where on
        //this host its file lands. This is about a name written in this app's
        //own source, which is a different kind of value entirely.
        var kind = String(name == null ? '' : name)
            .split(/[\\/]/)
            .filter(function (s) { return s !== '' && s !== '.' && s !== '..'; })
            .map(safe)
            .join(path.sep) || safe('');
        var most = o.most || MOST;
        var readable = o.readable || READABLE;
        var clean = o.clean || function (t) { return t; };

        async function root() {
            var at = await drawer();
            return at ? path.join(at, kind) : null;
        }

        async function dirFor(uid) {
            var at = await root();
            return at ? path.join(at, safe(uid)) : null;
        }

        //KEPT, AND NEVER SILENTLY REPLACED.
        //
        //A second file of the same name is a second DELIVERY, not a correction:
        //two runs of one task both produce `firmware.bin`, and quietly
        //overwriting means what is on disk belongs to whichever run finished
        //last with nothing saying so. Each gets the run it came from in its
        //name, and a clash after that is suffixed rather than refused — the
        //delivery already happened, and losing it to a name collision helps
        //nobody.
        async function keep(uid, file, bytes, about) {
            var why = nameIsOk(file);
            if (why) throw new Error(why);
            if (!bytes || !bytes.length) throw new Error('there was nothing in it');
            if (bytes.length > most) {
                throw new Error('that is ' + Math.round(bytes.length / 1048576) + ' MB, and the most this '
                    + 'takes is ' + Math.round(most / 1048576) + ' MB');
            }

            var dir = await dirFor(uid);
            //NOWHERE TO KEEP IT IS REFUSED, NOT DROPPED. This is a record of
            //something that happened on a machine that is about to be rolled
            //back; "saved" and "there was nowhere to save it" are different
            //answers and only one of them is true.
            if (!dir) {
                throw new Error('no workspace is open, so there is nowhere to keep "' + file + '". What a run '
                    + 'handed back is kept per workspace — see core/state.');
            }
            fs.mkdirSync(dir, { recursive: true });

            var meta = about || {};
            //THE RUN IT CAME FROM, WHEN THAT IS KNOWN. It is not always: a file
            //can arrive in the first second of a run, before the run's own id
            //has been written down — a race worth losing in this direction,
            //because the alternative was refusing the file entirely. A stamp
            //stands in and does the same job of keeping two deliveries apart.
            var from = meta.run ? safe(meta.run) : new Date().toISOString().replace(/[:.]/g, '-');

            var at = path.join(dir, from + '--' + file);
            for (var n = 2; fs.existsSync(at); n++) at = path.join(dir, from + '-' + n + '--' + file);

            fs.writeFileSync(at, bytes);

            //SELF-DESCRIBING, because a folder named by a uid tells nobody
            //anything. The uid stays the key — it is never reused and never
            //renamed, unlike a number or a slug that follows a title — but
            //somebody opening this in a file manager should not have to come
            //back to the source to find out what it belonged to.
            fs.writeFileSync(at + '.about.json', JSON.stringify(Object.assign({}, meta, {
                uid: uid, name: file, bytes: bytes.length, kept: new Date().toISOString()
            }), null, 2));

            return { file: path.basename(at), path: at, name: file, bytes: bytes.length, run: meta.run || null };
        }

        //EVERYTHING UNDER ONE UID, NEWEST FIRST.
        //
        //READ FROM THE DIRECTORY rather than from whatever record points at it,
        //so a file whose task was thrown away is still findable. What was
        //produced outlives the note about it, which is the right way round.
        async function list(uid) {
            var dir = await dirFor(uid);
            if (!dir) return [];

            var names = [];
            try {
                names = fs.readdirSync(dir).filter(function (n) { return !/\.about\.json$/.test(n); });
            } catch (e) { return []; }

            return names.map(function (n) {
                var full = path.join(dir, n);
                var meta = {};
                try { meta = JSON.parse(fs.readFileSync(full + '.about.json', 'utf8')); }
                catch (e) { /* an interrupted keep */ }
                var bytes = 0;
                try { bytes = fs.statSync(full).size; } catch (e) { /* as above */ }
                return Object.assign({ file: n, path: full, bytes: bytes }, meta);
            }).sort(function (a, b) {
                return String(b.kept || '').localeCompare(String(a.kept || ''));
            });
        }

        async function has(uid, file) {
            return (await list(uid)).some(function (f) { return f.file === String(file); });
        }

        //ONE OF THEM, AS TEXT.
        //
        //REFUSED RATHER THAN MANGLED WHEN IT IS NOT TEXT. Much of what lands in
        //these stores is a build product, and rendering one as UTF-8 produces a
        //screenful of replacement characters that looks like a corrupted file
        //rather than like the wrong question.
        //
        //DECIDED BY LOOKING AT THE BYTES, not at the extension — the guest chose
        //the name and the bytes are the thing. A NUL in the first few kilobytes
        //is the oldest and still the best test, and it is what `git diff` uses to
        //decide the same thing about a blob.
        async function read(uid, file, how) {
            var want = String(file);
            var found = (await list(uid)).filter(function (f) { return f.file === want; })[0];
            if (!found) throw new Error('There is no file called "' + file + '" kept under that.');

            if (found.bytes > readable) {
                throw new Error('That is ' + Math.round(found.bytes / 1048576) + ' MB. Open it from the folder '
                    + 'rather than in a panel.');
            }

            var bytes = fs.readFileSync(found.path);
            if (bytes.subarray(0, 8000).includes(0)) {
                throw new Error('"' + file + '" is not text — it has bytes no editor would show. Open it from '
                    + 'the folder.');
            }

            var text = clean(bytes.toString('utf8'));
            var lines = (how && how.lines) || 0;
            if (lines > 0) {
                var all = text.split('\n');
                if (all.length > lines) {
                    text = all.slice(-lines).join('\n');
                    return Object.assign({}, found, { text: text, of: all.length, showing: lines });
                }
            }
            return Object.assign({}, found, { text: text });
        }

        //THE `.about.json` GOES WITH IT. A record of a delivery whose delivery
        //is gone is a row that reads as a file and is not one, and these lists
        //are read to find out what a run produced.
        async function forget(uid, file) {
            var want = String(file);
            var found = (await list(uid)).filter(function (f) { return f.file === want; })[0];
            if (!found) throw new Error('There is no file called "' + file + '" kept under that.');

            fs.unlinkSync(found.path);
            try { fs.unlinkSync(found.path + '.about.json'); } catch (e) { /* may never have been written */ }
            return { forgotten: found.file, name: found.name || found.file, bytes: found.bytes };
        }

        //EVERY UID THAT HAS ANYTHING, INCLUDING ONES NOTHING POINTS AT ANY MORE.
        async function everything() {
            var at = await root();
            if (!at) return [];

            var uids = [];
            try {
                uids = fs.readdirSync(at, { withFileTypes: true })
                    .filter(function (e) { return e.isDirectory(); })
                    .map(function (e) { return e.name; });
            } catch (e) { return []; }

            var out = [];
            for (var i = 0; i < uids.length; i++) {
                var files = await list(uids[i]);
                out.push({
                    uid: uids[i],
                    files: files.length,
                    bytes: files.reduce(function (n, f) { return n + (f.bytes || 0); }, 0),
                    last: files.map(function (f) { return f.kept; }).filter(Boolean).sort().pop() || null,
                    dir: await dirFor(uids[i])
                });
            }
            return out.sort(function (a, b) {
                return String(b.last || '').localeCompare(String(a.last || ''));
            });
        }

        return {
            name: kind,
            keep: keep, list: list, read: read, has: has, forget: forget,
            everything: everything, dirFor: dirFor, root: root
        };
    }

    //---- looking inside one without unpacking it ---------------------------
    //
    //    { entries: [{ name, type, size, data }], files, gzip, unreadable }
    //
    //`unreadable` IS THE ANSWER WHEN IT COULD NOT BE READ, with `entries` empty
    //beside it. NOTHING HERE THROWS, and that is not politeness: the archive is
    //the thing that has to survive, a summary of it is what anybody looks at,
    //and losing a transcript because reading it failed would be the tail wagging
    //the dog.
    function inside(bytes) {
        var out = { entries: [], files: 0, gzip: false, unreadable: null };
        if (!bytes || !bytes.length) {
            out.unreadable = 'there was nothing in it';
            return out;
        }

        var raw = bytes;
        out.gzip = gzipped(bytes);
        if (out.gzip) {
            try { raw = zlib.gunzipSync(bytes); }
            catch (e) {
                out.unreadable = 'it says it is gzipped and does not unpack: ' + e.message;
                return out;
            }
        }

        //CHECKED BEFORE IT IS PARSED, because the reader does not check and
        //does not throw — see `looksLikeTar`.
        if (!looksLikeTar(raw)) {
            out.unreadable = 'it is not a tar — there is no header where one should be';
            return out;
        }

        try { out.entries = nanotar.parseTar(flat(raw)) || []; }
        catch (e) {
            out.unreadable = 'it is not a tar this can read: ' + e.message;
            return out;
        }

        //A DIRECTORY IS AN ENTRY AND IS NOT A FILE. Counting them together
        //answers "how much is in here" with a number that includes the folders.
        out.files = out.entries.filter(function (e) { return e.type === 'file'; }).length;
        return out;
    }

    //ONE ENTRY, BY NAME OR BY A TEST. Null rather than a throw, because "there
    //is no such file in it" is an ordinary answer about somebody else's archive.
    //---- AND MAKING ONE, WHICH IS THE OTHER DIRECTION --------------------
    //
    //THIS PLUGIN ONLY EVER READ. Everything about it was written for bytes
    //ARRIVING — a machine hands something back and this unpacks it — and the tar
    //library vendored for that has always been able to write one too.
    //
    //THE CALLER THAT NEEDED IT: ../../bootstrap, handing somebody a single file
    //they can put where they like. A folder of twenty-five files is the right
    //shape on disk and the wrong shape to hand to a person, who wants one thing
    //they can name and move and mail to themselves.
    //
    //    files   [{ name, data }] -- data is a string or bytes
    //
    //ONE TAR AND NOT A ZIP, because the reader for it is already here and
    //`inside` will take back exactly what this writes. Two formats would mean
    //this app could produce something it could not read.
    function make(files) {
        var made = (files || []).map(function (f) {
            return {
                name: String(f.name),
                data: typeof f.data === 'string' ? Buffer.from(f.data, 'utf8') : f.data
            };
        });
        return Buffer.from(nanotar.createTar(made));
    }

    function find(entries, want) {
        var all = entries || [];
        if (typeof want === 'function') return all.filter(want)[0] || null;
        return all.filter(function (e) { return e.name === String(want); })[0] || null;
    }

    //AN ENTRY'S BYTES AS TEXT, and never a throw on rubbish. `toString` replaces
    //what it cannot decode rather than failing, which is right here: half a
    //readable transcript is worth more than an exception.
    function text(entry) {
        if (!entry || !entry.data) return '';
        try { return Buffer.from(entry.data).toString('utf8'); }
        catch (e) { return ''; }
    }

    await register(null, {
        archive: {
            store: store,
            make: make,
            inside: inside,
            find: find,
            text: text,
            gzipped: gzipped,
            nameIsOk: nameIsOk,
            MOST: MOST,
            READABLE: READABLE
        }
    });
}
module.exports = plugin;
