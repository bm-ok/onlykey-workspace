var fs = require('fs');
var path = require('path');

var bundle = require('./bundle');

//---------------------------------------------------------------------------
//TAKING IT ALL OUT, AND PUTTING IT ALL BACK.
//
//THE FAILURE THIS IS FOR: the data directory is gone. Not corrupted, not
//half-written — gone, because somebody reinstalled, or moved machine, or wiped
//it to test that a fresh install works. The app comes back perfectly and knows
//nothing: no contracts, no prompts, no jobs, and three skills that are whatever
//shipped rather than what a supervisor had been taught to be.
//
//A REPO CANNOT HOLD THE LIVE SET, and should not try. What runs is per
//workspace and diverges the moment somebody edits it — it becomes that
//project's, which is the whole point of it being editable. What a repo can hold
//is a SEED: enough of each to get a supervisor running and improving itself
//again.
//
//---- ITS OWN PLUGIN, BECAUSE IT SPANS TWO ---------------------------------
//
//Jobs, prompts and contracts are ../library's. The three skills are files on the
//provisioning search path, which is ../vms/provision's. A bundle is both, and
//putting it inside either would be that one reaching across into the other.
//
//---- WHICH DIRECTION IS GUARDED, AND WHY THEY DIFFER ----------------------
//
//EXPORT IS OPEN. It reads what is already here and writes it where somebody
//asked. Nothing downstream changes, and refusing it from the command line would
//make the one thing you want to do from a script — back this up — the one thing
//you cannot.
//
//IMPORT IS A PERSON'S. It writes the documents that say what a machine is told
//to be. A bundle is a folder, a folder can come from anywhere, and an import
//reachable down the pipe would be a way around every refusal in ../supervisor:
//rewriting a skill is refused there, so it would be done here instead.
//---------------------------------------------------------------------------

plugin.consumes = ['app', 'log', 'library', 'provision', 'archive'];
plugin.provides = [];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log.on('bootstrap');
    var lib = imports.library;

    var STORES = { contract: lib.contracts, prompt: lib.prompts, job: lib.jobs };

    //THE LAYOUT, TAKEN FROM ./bundle.js RATHER THAN RESTATED. A folder and a tar
    //hold the same names in the same places, and two lists of them is where the
    //two would start to differ.
    var FOLDERS = bundle.FOLDER;
    var SUFFIXES = bundle.SUFFIX;
    var safe = bundle.safe;
    var carried = bundle.carried;

    //WHICH SKILLS THERE ARE, ASKED OF THE PLACE THAT KNOWS. Hard-coding the
    //three here would be a second list to keep in step with ../vms/provision's
    //STAGES, and the one that went stale would be this one.
    var SKILLS = { supervisor: 'skill', worker: 'workerSkill', judge: 'judgeSkill' };

    function skillText(stage) {
        try { return fs.readFileSync(imports.provision.fileFor(null, stage), 'utf8'); }
        catch (e) { return null; }
    }

    //---- everything that is here right now ---------------------------------
    //
    //A JOB'S SCRIPT IS FETCHED HERE, not while the folder is being written.
    //`bundle.write` is synchronous — it is a folder of files and reads better
    //that way — and a job's code is an await, so the one asynchronous field is
    //resolved first rather than making the whole layout async for it.
    async function whatThereIs() {
        var sets = {};
        for (var kind of Object.keys(STORES)) sets[kind] = await STORES[kind].all();

        var code = {};
        for (var job of sets.job || []) code[job.id] = await lib.codeFor(job.id);

        var skills = [];
        Object.keys(SKILLS).forEach(function (which) {
            var text = skillText(SKILLS[which]);
            if (text) skills.push({ which: which, title: which, text: text });
        });

        return { sets: sets, code: code, skills: skills };
    }

    //---- WHERE THE ONE THAT SHIPPED WITH THIS APP IS -----------------------
    //
    //BESIDE THE SERVER BUNDLE, which is what `__dirname` resolves to once
    //packaged — the same place ../vms/provision finds its scripts, and for the
    //same reason. webpack copies it there on every emit; see PAYLOADS.
    //
    //IT IS THE ANSWER TO "restore from what?" WHEN THERE IS NOTHING. A person
    //whose data directory has gone has no export of their own to point at, and
    //asking them to find a folder inside an app they just reinstalled is asking
    //them to already know the answer.
    //A FILE AND NOT A FOLDER, because the repo kept the set twice and two
    //copies of anything drift the moment one is edited. The tar is the one that
    //gets RESTORED FROM, so it is the one that is true — and a folder of the
    //same documents beside it was a second answer to the same question.
    var shipped = path.join(__dirname, 'okc-bootstrap.tar');

    //---- PUTTING A SET BACK, WHEREVER IT WAS READ FROM ---------------------
    //
    //ONE IMPORTER FOR BOTH DOORS. A bundle is a folder or it is a single file,
    //and those differ only in how the bytes are got at — what a bundle MEANS
    //must not depend on which one somebody used, and two copies of this is
    //exactly where that would start to be untrue.
    async function putItBack(had, over) {
        var wrote = { contract: 0, prompt: 0, job: 0, skill: 0 };
        var skipped = [];

        //CONTRACTS, THEN PROMPTS, THEN JOBS — the order the links run in. A
        //prompt names a contract and a job names a prompt, so importing them the
        //other way round makes every entry arrive pointing at something that is
        //not there yet.
        for (var kind of ['contract', 'prompt', 'job']) {
            for (var e of (had.kinds[kind] || [])) {
                var already = await STORES[kind].get(e.id);
                if (already && !over) {
                    //NOT OVERWRITTEN BY DEFAULT, AND SAID. A bundle landing on
                    //top of what somebody has been editing is the one way this
                    //could cost real work.
                    skipped.push(kind + ' "' + e.id + '"');
                    continue;
                }

                var input = Object.assign({}, e);
                delete input.body;
                if (kind === 'job') input.code = e.body;
                else input.text = e.body;

                //`by` IS NOT THE WINDOW, AND THAT IS THE POINT. Saving at the
                //window approves — see ../library/entries.js — and an imported
                //document is precisely one nobody has read yet.
                await STORES[kind].save(input, 'an imported bundle');
                wrote[kind]++;
            }
        }

        for (var sk of had.skills) {
            var stage = SKILLS[sk.which];
            if (!stage) { skipped.push('skill "' + sk.which + '"'); continue; }

            var mine = await imports.provision.keptFor(stage);
            if (!mine) {
                throw new Error('No workspace is open, so there is nowhere to keep a skill. They are kept '
                    + 'beside that workspace’s jobs, the same as everything else here.');
            }
            if (fs.existsSync(mine) && !over) { skipped.push('skill "' + sk.which + '"'); continue; }

            fs.mkdirSync(path.dirname(mine), { recursive: true });
            fs.writeFileSync(mine, sk.text);
            wrote.skill++;
        }

        log.good('put a set back — ' + JSON.stringify(wrote)
            + (skipped.length ? ', ' + skipped.length + ' left alone' : ''));

        return {
            wrote: wrote, skipped: skipped,
            note: (wrote.contract + wrote.prompt + wrote.job)
                ? 'Imported, and every one of them is waiting to be read — nothing here can run until '
                    + 'somebody approves it.'
                : 'Nothing was written. ' + (skipped.length
                    ? 'Everything in the bundle is already here; pass over to write on top of it.'
                    : 'The bundle was empty.')
        };
    }

    //---- A BUNDLE THAT ARRIVED AS BYTES ------------------------------------
    //
    //THE SAME SHAPE `bundle.read` HANDS BACK, so one importer serves every way
    //of getting at a set and there is nowhere for a folder and a file to start
    //meaning different things.
    function readTar(raw) {
        var seen = imports.archive.inside(raw);
        if (seen.unreadable) {
            throw new Error('That file is not a bundle this app wrote: ' + seen.unreadable);
        }

        var manifestEntry = imports.archive.find(seen.entries, 'library.json');
        if (!manifestEntry) {
            throw new Error('There is no library.json in that file, so it is not a bundle. The manifest '
                + 'is what says which of the files in it belong to the set.');
        }

        var manifest;
        try { manifest = JSON.parse(imports.archive.text(manifestEntry)); }
        catch (e) { throw new Error('The manifest in that file could not be read: ' + e.message); }

        //THE SAME SHAPE `bundle.read` HANDS BACK, so one importer serves
        //both doors and there is nowhere for the two to disagree about
        //what a bundle means.
        var had = { kinds: {}, skills: [] };

        Object.keys(FOLDERS).forEach(function (kind) {
            had.kinds[kind] = ((manifest.kinds || {})[kind] || []).map(function (e) {
                var want = FOLDERS[kind] + '/' + safe(e.id) + SUFFIXES[kind];
                var found = imports.archive.find(seen.entries, want);
                if (!found) {
                    throw new Error('The manifest lists the ' + kind + ' "' + e.id + '" and there is no '
                        + want + ' in the file. Importing it would write an empty one.');
                }
                return Object.assign(carried(kind, e), { body: imports.archive.text(found) });
            });
        });

        (manifest.skills || []).forEach(function (sk) {
            var found = imports.archive.find(seen.entries, 'skills/' + safe(sk.which) + '.md');
            if (!found) throw new Error('The manifest lists the skill "' + sk.which + '" and it is not in the file.');
            had.skills.push({ which: sk.which, title: sk.title || sk.which, text: imports.archive.text(found) });
        });
        return had;
    }

    var undo = [];
    if (actions) {
        undo.push(actions.define('bootstrap', {
            about: 'What a bundle would hold, and where the one that shipped with this app is',
            takes: [],
            run: async function () {
                var here = await whatThereIs();
                var counts = {};
                Object.keys(STORES).forEach(function (k) { counts[k] = (here.sets[k] || []).length; });
                counts.skill = here.skills.length;

                var have = false;
                try { have = fs.statSync(shipped).isFile(); }
                catch (e) { have = false; }

                return {
                    here: counts,
                    shipped: have ? shipped : null,
                    note: have
                        ? 'A set shipped with this app and can be restored from without an export of your own.'
                        : 'No set shipped with this app, so there is nothing to restore from but a folder you '
                            + 'wrote yourself.'
                };
            }
        }));
        undo.push(actions.define('bootstrapExport', {
            about: 'Write every skill, job, prompt and contract to a folder, as files, so a set can be kept '
                + 'or moved',
            takes: ['to'],
            run: async function (args) {
                var a = args || {};
                var at = String(a.to == null ? '' : a.to).trim();
                if (!at) {
                    throw new Error('Say where to write it: a folder. It is made if it is not there, and what '
                        + 'is written is one readable file per document plus a manifest of what points at what.');
                }

                var here = await whatThereIs();

                //THE BODY COMES FROM WHERE IT ACTUALLY LIVES. A contract and a
                //prompt carry their text on the entry; a job's is a script on
                //disk and is read on demand — see ../library, which learned that
                //the expensive way.
                var manifest = bundle.write(at, here.sets, function (kind, e) {
                    return kind === 'job' ? here.code[e.id] : e.text;
                }, here.skills);

                var counted = Object.keys(manifest.kinds).map(function (k) {
                    return manifest.kinds[k].length + ' ' + k + '(s)';
                });

                log.good('wrote a bundle to ' + at + ' — ' + counted.join(', ')
                    + ' and ' + manifest.skills.length + ' skill(s)');

                return {
                    to: at,
                    kinds: manifest.kinds, skills: manifest.skills,
                    note: 'Written. Nothing about approvals is in it, deliberately: everything imported from '
                        + 'this arrives waiting to be read, because an approval is a person saying they read '
                        + 'that text here.'
                };
            }
        }));

        //---- THE SAME BUNDLE AS ONE FILE ---------------------------------
        //
        //A FOLDER IS THE RIGHT SHAPE ON DISK AND THE WRONG ONE TO HAND SOMEBODY.
        //Twenty-five files is what you want in a repository, where each is read
        //and diffed on its own; it is not what you want when the question is
        //"where do I keep this so I can put it back". That answer is one file
        //you can name, move, and mail to yourself.
        //
        //A TAR, THROUGH ../core/archive, because the reader for one is already
        //here — so what this writes is exactly what `inside` takes back. A second
        //format would mean this app could produce something it could not read.
        //
        //BASE64 OVER THE PIPE. The action table carries JSON; bytes on it are
        //bytes in a string, and a hundred and seventy kilobytes of documents is
        //not worth a second transport.
        undo.push(actions.define('bootstrapFile', {
            about: 'The whole set as a single file, to save wherever you keep things',
            takes: [],
            run: async function () {
                var here = await whatThereIs();

                var files = [];
                var manifest = { made: 'okc', kinds: {}, skills: [] };

                Object.keys(FOLDERS).forEach(function (kind) {
                    manifest.kinds[kind] = (here.sets[kind] || []).map(function (e) {
                        var body = kind === 'job' ? here.code[e.id] : e.text;
                        files.push({
                            name: FOLDERS[kind] + '/' + safe(e.id) + SUFFIXES[kind],
                            data: String(body == null ? '' : body)
                        });
                        return carried(kind, e);
                    });
                });

                here.skills.forEach(function (sk) {
                    files.push({ name: 'skills/' + safe(sk.which) + '.md', data: sk.text });
                    manifest.skills.push({ which: sk.which, title: sk.title });
                });

                //THE MANIFEST LAST, so it is written after everything it names.
                files.push({ name: 'library.json', data: JSON.stringify(manifest, null, 2) + '\n' });

                var bytes = imports.archive.make(files);
                log.good('made a bundle of ' + files.length + ' file(s), ' + bytes.length + ' bytes');

                return {
                    name: 'okc-bootstrap.tar',
                    bytes: bytes.toString('base64'),
                    files: files.length,
                    size: bytes.length,
                    note: 'One file holding every document. Nothing about approvals is in it.'
                };
            }
        }));

        undo.push(actions.define('bootstrapFromFile', {
            about: 'Read a bundle that was saved as a single file, and put what is in it here',
            takes: ['bytes', 'over'],
            run: async function (args) {
                var a = args || {};

                //A PERSON'S PRESS, for the same reason `bootstrapImport` is: it
                //writes what a machine is told it is, and a file is even easier
                //to hand to something than a folder.
                if (a._overTheWire || a._driven) {
                    throw new Error('Restoring is done in the window. It writes the documents that say what a '
                        + 'supervisor, a worker and a judge each believe they are.');
                }

                var raw;
                try { raw = Buffer.from(String(a.bytes || ''), 'base64'); }
                catch (e) { throw new Error('That was not a bundle: the bytes could not be read.'); }

                var had = readTar(raw);
                return await putItBack(had, a.over === true || a.over === 'over');
            }
        }));

        undo.push(actions.define('bootstrapImport', {
            about: 'Read a bundle — a folder or a saved file — and put what is in it here. Everything arrives '
                + 'waiting to be read',
            takes: ['from', 'over'],
            run: async function (args) {
                var a = args || {};

                //A PERSON'S PRESS. See the header: this writes what a machine is
                //told it is, and an import down the pipe is a way around every
                //refusal in ../supervisor.
                if (a._overTheWire || a._driven) {
                    throw new Error('Importing a bundle is done in the window. It writes the documents that '
                        + 'say what a supervisor, a worker and a judge each believe they are — and rewriting '
                        + 'one of those is refused from the command line, so doing it by importing a folder '
                        + 'would be the same act through a different door.');
                }

                var at = String(a.from == null ? '' : a.from).trim();
                if (!at) throw new Error('Say which folder to read.');

                //---- A FOLDER OR A FILE, AND IT IS TOLD APART BY LOOKING --
                //
                //THE SET THAT SHIPS IS A TAR NOW, and the pane restores from it
                //by naming its path — so this door has to take both. Deciding by
                //what is actually THERE rather than by the suffix: a bundle
                //saved without one is still a bundle, and a folder called
                //`x.tar` is still a folder.
                var isFile = false;
                try { isFile = fs.statSync(at).isFile(); }
                catch (e) {
                    throw new Error('There is nothing at "' + at + '" to read.');
                }

                var had = isFile ? readTar(fs.readFileSync(at)) : bundle.read(at);
                var over = a.over === true || a.over === 'over';

                return Object.assign({ from: at }, await putItBack(had, over));
            }
        }));
    }

    await register(null, {
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
