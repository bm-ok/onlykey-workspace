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

plugin.consumes = ['app', 'log', 'library', 'provision'];
plugin.provides = [];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log.on('bootstrap');
    var lib = imports.library;

    var STORES = { contract: lib.contracts, prompt: lib.prompts, job: lib.jobs };

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

    var undo = [];
    if (actions) {
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

        undo.push(actions.define('bootstrapImport', {
            about: 'Read a folder written by bootstrapExport and put what is in it here. Everything arrives '
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

                var had = bundle.read(at);
                var over = a.over === true || a.over === 'over';

                var wrote = { contract: 0, prompt: 0, job: 0, skill: 0 };
                var skipped = [];

                //CONTRACTS, THEN PROMPTS, THEN JOBS — the order the links run
                //in. A prompt names a contract and a job names a prompt, so
                //importing them the other way round makes every entry arrive
                //pointing at something that is not there yet.
                for (var kind of ['contract', 'prompt', 'job']) {
                    for (var e of (had.kinds[kind] || [])) {
                        var already = await STORES[kind].get(e.id);
                        if (already && !over) {
                            //NOT OVERWRITTEN BY DEFAULT, AND SAID. A bundle
                            //landing on top of what somebody has been editing is
                            //the one way this could cost real work.
                            skipped.push(kind + ' "' + e.id + '"');
                            continue;
                        }

                        var input = Object.assign({}, e);
                        delete input.body;
                        if (kind === 'job') input.code = e.body;
                        else input.text = e.body;

                        //`by` IS NOT THE WINDOW, AND THAT IS THE POINT. Saving at
                        //the window approves — see ../library/entries.js — and an
                        //imported document is precisely one nobody has read yet.
                        await STORES[kind].save(input, 'an imported bundle');
                        wrote[kind]++;
                    }
                }

                for (var s of had.skills) {
                    var stage = SKILLS[s.which];
                    if (!stage) { skipped.push('skill "' + s.which + '"'); continue; }

                    var mine = await imports.provision.keptFor(stage);
                    if (!mine) {
                        throw new Error('No workspace is open, so there is nowhere to keep a skill. They are '
                            + 'kept beside that workspace’s jobs, the same as everything else here.');
                    }
                    if (fs.existsSync(mine) && !over) { skipped.push('skill "' + s.which + '"'); continue; }

                    fs.mkdirSync(path.dirname(mine), { recursive: true });
                    fs.writeFileSync(mine, s.text);
                    wrote.skill++;
                }

                log.good('imported from ' + at + ' — ' + JSON.stringify(wrote)
                    + (skipped.length ? ', ' + skipped.length + ' left alone' : ''));

                return {
                    from: at, wrote: wrote, skipped: skipped,
                    note: (wrote.contract + wrote.prompt + wrote.job)
                        ? 'Imported, and every one of them is waiting to be read — nothing here can run until '
                            + 'somebody approves it.'
                        : 'Nothing was written. ' + (skipped.length
                            ? 'Everything in the bundle is already here; pass over to write on top of it.'
                            : 'The bundle was empty.')
                };
            }
        }));
    }

    await register(null, {
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
