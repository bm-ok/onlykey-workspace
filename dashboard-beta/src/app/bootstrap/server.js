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

//`workstrap` FOR THE WORKSPACE'S OWN NOTES. A bundle is what a fresh workspace
//starts from, and a workspace with no CLAUDE.md is one where every machine works
//out how to build and test the project again from the source. Asked of that
//plugin rather than read off disk here: whose copy answers — the workspace's own
//or the shipped starter — is its rule, not this one's.
plugin.consumes = ['app', 'log', 'library', 'provision', 'archive', 'state', 'workstrap'];
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

    //THE FOLDERS A BUNDLE MAY UNPACK INTO, and nothing else. `bootstrapSeed`
    //writes into a folder somebody named, from a tar somebody may have replaced,
    //so what it is allowed to create is a list rather than whatever the archive
    //happens to hold.
    //
    //`skills` IS NOT ON IT. A bundle written before the skills moved carried one,
    //and the reader that understood that shape is gone — so unpacking the folder
    //would leave a workspace holding three documents nothing serves from, which
    //is worse than not carrying them: the pane says a skill is missing while a
    //copy of it sits in the drawer under a name nobody looks for.
    var KEEP = { contracts: true, prompts: true, jobs: true, provision: true };

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

        //---- AND THE PROVISION FOLDER --------------------------------------
        //
        //TWO SOURCES, AND THE ORDER MATTERS. First this workspace's own folder —
        //the scripts somebody put there and the skills they approved. Then the
        //three skills for any that folder does not hold, resolved through the
        //search path so they fall back to what the app ships.
        //
        //THE SECOND HALF IS WHY THE TAR NEVER LOSES A SKILL. A workspace that
        //has never edited one has nothing in its own folder, and carrying only
        //what it holds would ship a bundle with no skills in it at all — which
        //is exactly the set a fresh workspace most needs.
        //
        //FIRST WINS, as everywhere else here: what this workspace has beats what
        //the app shipped.
        var scripts = [];
        var seen = {};

        (imports.provision.kept() || []).forEach(function (f) {
            seen[f.name] = true;
            scripts.push({ name: f.name, text: f.text });
        });

        Object.keys(SKILLS).forEach(function (which) {
            var name = imports.provision.STAGES[SKILLS[which]];
            if (!name || seen[name]) return;
            var text = skillText(SKILLS[which]);
            if (text) scripts.push({ name: name, text: text });
        });

        //---- AND THE WORKSPACE'S NOTES ------------------------------------
        //
        //WHATEVER A MACHINE WOULD BE GIVEN: the workspace's own copy when it has
        //one, the starter when it has not. Both are worth carrying and for
        //different reasons — the first takes what somebody learned about this
        //project into a workspace made from it, and the second makes the file
        //exist and be editable on day one rather than being a document nobody
        //knows to start.
        //
        //NOT FATAL. A bundle without notes is a bundle; ../workstrap falls back
        //to the starter on the other side anyway, so failing an export over this
        //would be refusing to ship the contracts because a README was missing.
        var notes = null;
        try { notes = (await imports.workstrap.read()).text; }
        catch (e) { notes = null; }

        return { sets: sets, code: code, scripts: scripts, notes: notes };
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
    //OVERRIDABLE, THE SAME WAY ../vms/provision's shipped folder is. A drill
    //needs a set to seed a folder FROM, and the alternative is writing a tar into
    //the source tree beside this file and remembering to delete it.
    var shipped = process.env.OKC_BOOTSTRAP_TAR || path.join(__dirname, 'okc-bootstrap.tar');

    //---- PUTTING A SET BACK, WHEREVER IT WAS READ FROM ---------------------
    //
    //ONE IMPORTER FOR BOTH DOORS. A bundle is a folder or it is a single file,
    //and those differ only in how the bytes are got at — what a bundle MEANS
    //must not depend on which one somebody used, and two copies of this is
    //exactly where that would start to be untrue.
    async function putItBack(had, over) {
        var wrote = { contract: 0, prompt: 0, job: 0, provision: 0 };
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

        //---- AND THE PROVISION FOLDER, FILE FOR FILE -----------------------
        //
        //BY NAME, WITH NO MAPPING. A bundle's `provision/` is a workspace's
        //`.okc/provision/`, so a file goes in under the name it arrived with —
        //`supervisor-skill.md` and `extra.sh` alike. The skills used to be
        //translated here from a second spelling; there is only one now.
        //
        //THE NAME IS STILL CHECKED. It came out of a manifest in a folder
        //somebody may have edited, so it is held to the same rule as everything
        //else served from that directory — a plain filename, nothing that could
        //climb out of it.
        var into = await imports.provision.keptDir();
        if (had.provision.length && !into) {
            throw new Error('No workspace is open, so there is nowhere to put a provisioning file. They are '
                + 'kept beside that workspace’s jobs, the same as everything else here.');
        }

        for (var f of had.provision) {
            var name = path.basename(String(f.name || ''));
            if (!name || !imports.provision.SERVABLE.test(name)) {
                skipped.push('"' + f.name + '", which is not a provisioning file');
                continue;
            }

            var mine = path.join(into, name);
            if (fs.existsSync(mine) && !over) { skipped.push('provision "' + name + '"'); continue; }

            fs.mkdirSync(into, { recursive: true });
            fs.writeFileSync(mine, f.text);
            wrote.provision++;
        }

        //---- AND THE WORKSPACE'S NOTES ------------------------------------
        //
        //ONE LEVEL UP FROM THE PROVISION FOLDER, at the root of the drawer,
        //because that is where ../workstrap keeps them and a bundle folder is a
        //`.okc` folder.
        //
        //LEFT ALONE IF THERE IS ALREADY ONE, like every other file here. Notes
        //are the single most workspace-specific thing in a bundle — they are
        //about THIS project — so importing a set on top of a workspace that has
        //written its own must not replace them silently. `over` is somebody
        //saying they meant it.
        if (had.workstrap && String(had.workstrap).trim()) {
            //ASKED OF ../core/state RATHER THAN DERIVED FROM `into`. The drawer
            //is one `path.dirname` up from the provision folder and that is
            //exactly the kind of true-today relationship that stops being true
            //quietly — and `into` is null when a bundle carries no provisioning
            //files at all, which has nothing to do with whether a workspace is
            //open.
            var drawer = await imports.state.here.where();
            if (!drawer) {
                skipped.push('the workspace notes, because no workspace is open');
            } else {
                var notesAt = path.join(drawer, imports.workstrap.NAME);
                if (fs.existsSync(notesAt) && !over) {
                    skipped.push('the workspace notes, which this workspace already has');
                } else {
                    fs.writeFileSync(notesAt, String(had.workstrap));
                    wrote.workstrap = 1;
                }
            }
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
        var had = { kinds: {}, provision: [] };

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

        (manifest.provision || []).forEach(function (f) {
            var want = 'provision/' + safe(f.name);
            var found = imports.archive.find(seen.entries, want);
            if (!found) {
                throw new Error('The manifest lists the provisioning file "' + f.name + '" and there is no '
                    + want + ' in the file. Importing it would write an empty one.');
            }
            had.provision.push({ name: f.name, text: imports.archive.text(found) });
        });

        //---- AND THE WORKSPACE'S NOTES, IF IT CARRIES ANY -------------------
        //
        //OPTIONAL, WHICH NOTHING ELSE HERE IS. A bundle written before notes
        //existed is not a broken bundle, so their absence is silence rather than
        //a refusal — but a manifest that CLAIMS them with no file behind it is
        //damaged, and importing that as an empty CLAUDE.md would tell every
        //machine opening the workspace that this project has nothing worth
        //saying about it.
        if (manifest.workstrap) {
            var wantNotes = safe(manifest.workstrap);
            var foundNotes = imports.archive.find(seen.entries, wantNotes);
            if (!foundNotes) {
                throw new Error('The manifest lists workspace notes and there is no ' + wantNotes
                    + ' in the file. Importing it would write an empty CLAUDE.md, which is what every '
                    + 'machine opening this workspace would then be given.');
            }
            had.workstrap = imports.archive.text(foundNotes);
        }

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
                counts.provision = here.scripts.length;

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
        //---- SETTING A WORKSPACE UP FROM THE SHIPPED SET -------------------
        //
        //A FOLDER WITH NO `.okc` HAS NEVER BEEN A WORKSPACE, and this is what it
        //starts as: the contracts, prompts, jobs, skills and provisioning
        //scripts the app was built with, written in as files.
        //
        //AN EXTRACTION AND NOT AN IMPORT, which is the whole reason it is three
        //lines of writing rather than a second copy of `putItBack`. A drawer IS
        //the bundle's layout — see ../library/layout.js — so the files go in as
        //they are: nothing to translate, no store to write through, no approval
        //to stamp.
        //
        //ONLY WHEN THERE IS NOTHING THERE. It cannot land on top of anything,
        //which is what makes it safe to do without asking. A folder that already
        //has a drawer is left exactly alone and says so.
        //
        //EVERYTHING ARRIVES UNAPPROVED, and that is the property this rests on. A
        //bundle carries no approval — see ./bundle.js, which never writes one —
        //so what lands is a set of documents waiting to be read. Approving is
        //this host's act, and a folder becoming a workspace does not perform it.
        undo.push(actions.define('bootstrapSeed', {
            about: 'Give a folder that has no .okc the set this app shipped with, so it starts as a workspace',
            takes: ['dir'],
            run: async function (args) {
                var a = args || {};
                var dir = String(a.dir == null ? '' : a.dir).trim();
                if (!dir) throw new Error('Say which folder to set up.');

                var drawer = path.join(dir, imports.state.HERE);
                if (fs.existsSync(drawer)) {
                    return { dir: dir, seeded: false, why: 'it already has one', note: null };
                }

                var raw;
                try { raw = fs.readFileSync(shipped); }
                catch (e) {
                    //NOT A FAILURE OF THE FOLDER. Nothing shipped, so there is
                    //nothing to start it from — and a workspace with an empty
                    //library is a workspace.
                    return { dir: dir, seeded: false, why: 'no set shipped with this app', note: null };
                }

                var seen = imports.archive.inside(raw);
                if (seen.unreadable) throw new Error('The set that shipped could not be read: ' + seen.unreadable);

                var wrote = 0;
                seen.entries.forEach(function (e) {
                    if (e.type !== 'file') return;

                    //---- A NAME OUT OF AN ARCHIVE, AND NEVER USED RAW -------
                    //
                    //One known folder and a plain filename, or the manifest at
                    //the root. A tar is bytes that came from somewhere, and
                    //`../../` in an entry name is how one writes outside the
                    //folder it is being unpacked into.
                    var parts = String(e.name || '').split('/');
                    var into, name;

                    if (parts.length === 1) {
                        //TWO NAMES AT THE ROOT AND BOTH ARE SPELLED OUT. The
                        //manifest, and the guard that keeps the drawer out of a
                        //repository — see ../core/state/ignore.js. Anything else
                        //at the root of a tar is not something this wrote.
                        if (parts[0] !== 'library.json' && parts[0] !== '.gitignore') return;
                        into = drawer;
                        name = parts[0];
                    } else if (parts.length === 2) {
                        if (!KEEP[parts[0]]) return;
                        if (safe(parts[1]) !== parts[1] || !parts[1]) return;
                        into = path.join(drawer, parts[0]);
                        name = parts[1];
                    } else return;

                    fs.mkdirSync(into, { recursive: true });
                    fs.writeFileSync(path.join(into, name), imports.archive.text(e));
                    wrote++;
                });

                log.good('set ' + dir + ' up from the shipped set — ' + wrote + ' file(s)');

                return {
                    dir: dir,
                    seeded: true,
                    files: wrote,
                    note: 'This folder had no ' + imports.state.HERE + ', so it was given the set this app '
                        + 'shipped with: ' + wrote + ' file(s). Everything in it is waiting to be read — '
                        + 'nothing arrives approved.'
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
                }, here.scripts, here.notes);

                var counted = Object.keys(manifest.kinds).map(function (k) {
                    return manifest.kinds[k].length + ' ' + k + '(s)';
                });

                log.good('wrote a bundle to ' + at + ' — ' + counted.join(', ')
                    + ' and ' + manifest.provision.length + ' provisioning file(s)');

                return {
                    to: at,
                    kinds: manifest.kinds, provision: manifest.provision,
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
        //THE FILES OF A BUNDLE, once, for the two actions that write one. The
        //manifest is built alongside and goes last, after everything it names.
        async function bundleFiles() {
            var here = await whatThereIs();

            var files = [];
            var manifest = { made: 'okc', kinds: {}, provision: [] };

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

            here.scripts.forEach(function (f) {
                files.push({ name: 'provision/' + safe(f.name), data: f.text });
                manifest.provision.push({ name: f.name });
            });

            //THE WORKSPACE'S NOTES, AT THE ROOT — see ../workstrap. The same
            //place and the same name a workspace keeps them under, because a
            //bundle folder IS a `.okc` folder and nothing else here is mapped on
            //the way in or out either.
            if (here.notes && String(here.notes).trim()) {
                files.push({ name: imports.workstrap.NAME, data: String(here.notes) });
                manifest.workstrap = imports.workstrap.NAME;
            }

            files.push({ name: 'library.json', data: JSON.stringify(manifest, null, 2) + '\n' });

            //---- AND THE GUARD THAT KEEPS A DRAWER OUT OF A REPOSITORY ------
            //
            //A workspace set up from this gets it on the way in, so it is
            //protected from before it holds anything. ../core/state/main writes
            //the same file whenever a drawer is made, which is what covers the
            //workspaces that already exist — see ../core/state/ignore.js.
            //
            //NOT IN THE MANIFEST. `library.json` lists what a person is going to
            //be asked to read and approve, and this is neither: it is a file the
            //app puts there for git's benefit. Listing it would put a line in
            //the Library pane for something nobody can approve or edit.
            files.push({ name: '.gitignore', data: imports.state.IGNORE });

            return files;
        }

        //THE FILES INSIDE A TAR THAT IS ALREADY THERE, in the same shape, so the
        //two can be compared by name. Nothing, rather than an error, when there
        //is no file: the first ship of a repo is the whole set added.
        function filesInside(at) {
            var raw;
            try { raw = fs.readFileSync(at); } catch (e) { return null; }
            var seen = imports.archive.inside(raw);
            if (seen.unreadable) return null;
            return seen.entries.map(function (e) {
                return { name: e.name, data: imports.archive.text(e) };
            });
        }

        undo.push(actions.define('bootstrapFile', {
            about: 'The whole set as a single file, to save wherever you keep things',
            takes: [],
            run: async function () {
                var files = await bundleFiles();
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

        //---- THE TAR THE REPO KEEPS, REWRITTEN FROM WHAT IS LIVE -------------
        //
        //THE SHIPPED SET WENT STALE BY FOURTEEN THOUSAND CHARACTERS AND NOTHING
        //SAID SO. A skill is approved here, the judge is retaught here, and the
        //copy a fresh workspace starts from is the one in the repo -- which
        //was last written by pressing "as a file" in the window, saving the
        //download over the checked-in one by hand, and remembering to. That
        //is a step with no receipt, and it was skipped for a week.
        //
        //THIS IS THAT STEP AS A COMMAND, for development: the same bytes
        //`bootstrapFile` hands the window, written onto the tar the repo keeps,
        //and an account of what moved -- by name, both sizes -- because a tar
        //rewritten is a diff git cannot show and the commit message has to.
        //
        //WHERE IT GOES. In development the server bundle runs from dist/ and
        //the tar it was copied from is one level up, in the repo; that is the
        //file that is true, so it is the default. A packaged app has no repo
        //above it, and writing into its own dist would be a change nothing
        //could commit -- so there the path has to be given.
        //
        //FROM THE COMMAND LINE, WHICH IS THE PIPE -- that is the whole ask, so
        //`_overTheWire` is not refused here the way an import is. What is
        //refused is a MACHINE's press: a supervisor's reach ends at
        //../supervisor/allowed.js, which does not list this, and `_driven` is
        //the mark of a window the drills are steering.
        undo.push(actions.define('bootstrapShip', {
            about: 'Rewrite the bundle the repo ships from what is approved here, and say what moved. '
                + 'For development; the tar is what a fresh workspace starts from',
            takes: ['to'],
            run: async function (args) {
                var a = args || {};
                if (a._driven) {
                    throw new Error('Rewriting the shipped bundle is done at this host, by a person or a '
                        + 'script they ran. It writes a file that gets committed.');
                }

                var to = String(a.to == null ? '' : a.to).trim();
                if (!to) {
                    var dev = process.env.NODE_ENV !== 'production';
                    var above = path.join(path.dirname(shipped), '..', 'okc-bootstrap.tar');
                    if (dev && fs.existsSync(above)) to = above;
                    else {
                        throw new Error('This is not a development boot with a repository above it, so there '
                            + 'is no tar to rewrite by default. Say where with --to.');
                    }
                }

                var files = await bundleFiles();
                var moved = bundle.changes(filesInside(to) || [], files);
                var bytes = imports.archive.make(files);

                if (!moved.moved) {
                    return {
                        to: to, files: files.length, size: bytes.length, wrote: false, moved: moved,
                        note: 'The tar already holds exactly what is here. Nothing was written.'
                    };
                }

                fs.mkdirSync(path.dirname(to), { recursive: true });
                fs.writeFileSync(to, bytes);
                log.good('shipped a bundle of ' + files.length + ' file(s) to ' + to + ' -- '
                    + moved.moved + ' of ' + files.length + ' moved');

                return {
                    to: to, files: files.length, size: bytes.length, wrote: true, moved: moved,
                    note: moved.moved + ' of ' + files.length + ' entries moved. Read them before committing: '
                        + 'the tar is what a fresh workspace starts from, and nothing about approvals is in it.'
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
