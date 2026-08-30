var fs = require('fs');
var path = require('path');

var makeLibrary = require('./entries');
var makeLayout = require('./layout');
var chain = require('./chain');
var starters = require('./starters');

//---------------------------------------------------------------------------
//THE LIBRARY: jobs, prompts and contracts, and the approvals that make them
//usable.
//
//    task <- job <- prompt <- contract
//
//WHY THIS IS A PLUGIN AND NOT THE WORKER'S OR THE JUDGE'S. Both of those ARE a
//set of jobs, prompts and contracts — that is what the word means here — and
//what each does with them is ask ../queue for work. Neither owns the library;
//they are two views of it, keyed by `kind`. So it is its own, and both consume
//it, by the same rule that put `pages` in ../core/io.
//
//./entries.js is the rules an approval is made of. ./chain.js is how the three
//link up. This half is the stores and the doors, and decides nothing.
//
//---- where all three live, which used to be two different places ----------
//
//ALL THREE ARE THE WORKSPACE'S, in its `.okc` drawer, laid out the way a
//bootstrap bundle is:
//
//    library.json          what is here, and what each thing is
//    contracts/<id>.md     prompts/<id>.md     jobs/<id>.js
//
//SO THE DRAWER IS A BUNDLE. An exported tar unpacked into a workspace is that
//workspace's library, and there is no import that rewrites one shape into
//another, because there is one shape. ./layout.js is the store and it asks
//../bootstrap/bundle.js for the folder names rather than repeating them.
//
//IT WAS AN ASYMMETRY AND THIS FILE ARGUED FOR IT: a job is a script that runs
//against the open folder, while "read the README against the code" names no
//repository — so jobs were the workspace's and the other two the computer's.
//
//WHAT THAT MISSED IS THE CONTRACT. A contract is the limits a worker runs under
//ON THIS PROJECT, and a prompt is what it is told to do with THESE
//repositories — so a second folder inherited the first one's rules without
//being told, and the half-and-half library was one where the jobs moved and the
//limits binding them did not.
//
//THE COST IS REAL AND WAS TAKEN KNOWINGLY: opening a fresh workspace now finds
//an empty library, and an afternoon of writing prompts does not follow you to
//the next project. Dropping in an exported bundle is the answer to that, which
//is the other half of why the layout is the bundle's.
//
//---- and the code is not ../core/archive's ---------------------------------
//
//A job's script is written HERE, by a person, at the window. ../core/archive is
//where files are kept when a MACHINE hands them back — a different direction and
//a different set of rules, since nothing about a job's code arrives untrusted
//over a wire.
//---------------------------------------------------------------------------

//THE PANE IS CALLED "Jobs", NOT "jobs". ../ui/shell keys panes on the name they
//were registered under, and a lower-case one silently lands on the tab with no
//pane chosen -- which looks like the row simply not working.
function capital(word) { return String(word).charAt(0).toUpperCase() + String(word).slice(1); }

plugin.consumes = ['app', 'log', 'state', 'inbox', 'versions'];
plugin.provides = ['library'];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log.on('library');
    var state = imports.state;

    //---- a job's code, which lives beside its record -----------------------
    //
    //ONE FILE PER JOB, named by its id, so a person opening the folder finds a
    //script rather than a field inside a JSON blob. It is JavaScript and it is
    //read in an editor; a string in a record is neither.
    async function jobsDir() {
        var at = null;
        try { at = await state.here.where(); } catch (e) { at = null; }
        return at ? path.join(at, 'jobs') : null;
    }

    function codePath(dir, id) { return dir ? path.join(dir, String(id) + '.js') : null; }

    function codeOf(entry, dir) {
        var at = codePath(dir, entry.id);
        if (!at) return '';
        try { return fs.readFileSync(at, 'utf8'); }
        catch (e) { return ''; }
    }

    //---- WHERE AN APPROVED COPY GOES, PER KIND --------------------------
    //
    //ALL THREE ARE FILED UNDER THEIR WORKSPACE, and it was jobs only — because
    //jobs were the only one kept per workspace. Now that all three are, two
    //workspaces can hold a contract of the same name and each needs its own
    //past; sharing one would make each look as though the other had been
    //editing it.
    //
    //WRITTEN ONCE, WHICH IT WAS NOT UNTIL SOMETHING READ THESE BACK. A copy kept
    //under one id and looked for under another is not an error — it is an empty
    //history, which reads exactly like "this has never been approved" and is the
    //one answer nobody would question.
    //
    //THE VERSIONS THEMSELVES STAY IN THE HOST'S DRAWER, keyed by this prefix,
    //rather than moving into `.okc` with the entries. What a thing WAS when it
    //was approved is the evidence behind a refusal — see ../guards — and it is
    //the one thing that should survive somebody deleting a folder to start
    //again. A bundle carries no approvals either, which is the same rule from
    //the other side: approving is the receiving host's act.
    var SCOPED = { job: true, prompt: true, contract: true };

    //THE WORKSPACE'S OWN NAME FOR ITSELF, NOT ITS DRAWER'S. This read the
    //basename of `here.where()`, which used to BE the slug — the drawer was
    //`state/workspaces/<slug>/`. The drawer is now `<the folder>/.okc`, so the
    //basename is `.okc` for every workspace on the host, and every one of them
    //would have filed its job history under the same prefix.
    //
    //WHICH IS THE FAILURE THE COMMENT ABOVE DESCRIBES, arriving by a route it
    //did not anticipate: not two jobs of the same name in two workspaces, but
    //two workspaces that had stopped having different names.
    //
    //`slugFor` ON THE FOLDER GIVES BACK EXACTLY THE OLD VALUE, which is why it
    //is used rather than the folder's plain name — version ids already written
    //carry the slug, and anything else here would orphan every history kept
    //before today while looking like it worked.
    async function versionId(kind, id) {
        var where = '';
        if (SCOPED[kind]) {
            try { where = state.slugFor(path.dirname(await state.here.where())) + '--'; }
            catch (e) { where = ''; }
        }
        return where + String(id);
    }

    //THE FROZEN DIFF AS TEXT, ADDED WHEREVER A VERSION GOES OUT. `rows` is the
    //record — worked out when the version was kept, against what was approved
    //before it, and never recomputed — and this is the same thing in the form a
    //command line and `ace/mode/diff` both read. One function because two copies
    //of "how a change is written down" is how two surfaces come to disagree
    //about what changed.
    function withChange(it) {
        if (!it) return null;
        return Object.assign({}, it, {
            changed: it.rows ? imports.versions.asText({ rows: it.rows }) : null
        });
    }

    function keeping(kind) {
        return async function (entry, body) {
            imports.versions.keep(kind, await versionId(kind, entry.id), body, {
                by: entry.approval && entry.approval.by,
                at: entry.approval && entry.approval.at
            });
        };
    }

    //---- ALL THREE FOLLOW THE WORKSPACE -----------------------------------
    //
    //JOBS ALREADY DID AND THE OTHER TWO DID NOT, which made the library half a
    //workspace's and half the host's: open a second folder and its jobs were its
    //own, while the contracts limiting them and the prompts driving them were
    //still the first folder's.
    //
    //THEY ARE ABOUT THE WORK, WHICH IS WHAT DECIDES. A contract is the rules a
    //worker runs under ON THIS PROJECT; a prompt is what it is told to do with
    //THESE repositories. Neither means anything away from the folder they were
    //written for, and a second project inheriting them is inheriting somebody
    //else's limits without being told.
    //
    //ASKED FOR PER CALL AND ASYNC, the same shape jobs already had — which
    //workspace is open is resolved on every call, and that is what makes
    //switching folders change the library with nothing subscribing to anything.
    //---- AND KEPT THE WAY A BUNDLE IS LAID OUT ----------------------------
    //
    //`library.json` beside `contracts/`, `prompts/`, `jobs/` and `skills/` — the
    //same folders `bootstrapExport` writes and `bootstrapImport` reads. So a
    //workspace's drawer IS a bundle: an exported tar unpacked into one is that
    //workspace's library, and there is no import step that rewrites one shape
    //into another because there are no longer two shapes.
    //
    //IT WAS THREE JSON BLOBS with the text escaped inside them, and job code
    //already on disk in `jobs/<id>.js` — so a third of this layout existed and
    //the other two kept prose in a form nobody could read without the app. See
    //./layout.js, which asks ../bootstrap/bundle.js for the folder names rather
    //than repeating them.
    function kept(kind) {
        var box = makeLayout(function () { return state.here.where(); }, kind);
        return function () { return box.at(); };
    }

    var contracts = makeLibrary('contract', kept('contract'), {
        keepApproved: keeping('contract'),
        writes: ['text'],
        needsBody: 'Write the rules. An empty contract would be handed to a worker as no limits at all.'
    });

    var prompts = makeLibrary('prompt', kept('prompt'), {
        keepApproved: keeping('prompt'),
        writes: ['text', 'contractId'],
        //THE CONTRACT IS PART OF WHAT WAS APPROVED. See ./entries.js.
        approvedWith: ['contractId'],
        needsBody: 'Write the prompt. An empty one would be handed to a worker as an empty instruction.'
    });

    var jobs = makeLibrary('job', kept('job'), {
        keepApproved: keeping('job'),
        writes: ['promptId', 'tags'],
        approvedWith: ['promptId'],
        //THE BODY IS THE CODE, AND THE CODE IS ON DISK. The approval is against
        //what will actually RUN, so editing the file lapses it even though
        //nothing about the record changed.
        context: jobsDir,
        bodyOf: function (e, dir) { return codeOf(e, dir); },

        //---- WHETHER THE SCRIPT IS ACTUALLY THERE -------------------------
        //
        //NOTHING SET THIS AND TWO PLACES READ IT, OPPOSITE WAYS. ../runners/runs
        ///joborder.js refuses with `if (!job.there)`, and `undefined` is falsy —
        //so EVERY job failed at the first step with "its file is missing from
        //the jobs folder", whether or not it was. ./chain.js reads the same
        //field as `j.there !== false`, where `undefined` passes, so the Jobs
        //pane listed all of them as runnable at the same time.
        //
        //Eight jobs, eight scripts on disk, every run dead on arrival and the
        //pane saying everything was fine. Found by asking why a judgement came
        //back "done" having handed back nothing.
        //
        //EXISTENCE, NOT CONTENT. `bodyOf` reads the file and answers '' when it
        //cannot, which cannot tell an empty script from an absent one — and
        //those have different fixes: one is written, the other is restored.
        alsoOf: function (e, dir) {
            var at = codePath(dir, e.id);
            var here = false;
            try { here = !!at && fs.statSync(at).isFile(); } catch (x) { here = false; }
            return { there: here };
        },

        onSave: async function (made, input, dir) {
            if (input.code === undefined) return;
            if (!dir) {
                throw new Error('No workspace is open, so there is nowhere to keep a job. A job is a script that '
                    + 'runs against the folder of repositories that is open.');
            }
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(codePath(dir, made.id), String(input.code));
        },

        onForget: async function (found, dir) {
            //THE SCRIPT GOES WITH THE RECORD. One left behind is a file nothing
            //points at, in a folder somebody opens looking for what is here.
            try { fs.unlinkSync(codePath(dir, found.id)); }
            catch (e) { /* it may never have been written */ }
        }
    });

    //---- the three, resolved against each other ----------------------------
    //
    //ASKED IN ONE PLACE so a prompt's contract is worked out once. ./chain.js is
    //where the links join; this only fetches.
    async function resolved(kind) {
        var rules = await contracts.all();
        var told = chain.promptsWith(await prompts.all(), rules);
        var dir = await jobsDir();
        var scripts = chain.jobsWith(await jobs.all(), told, {
            lines: function (j) { return codeOf(j, dir).split('\n').length; }
        });

        return {
            contracts: chain.ofKind(rules, kind),
            prompts: chain.ofKind(told, kind),
            jobs: chain.ofKind(scripts, kind),
            allContracts: rules, allPrompts: told, dir: dir
        };
    }

    //WHO IS ASKING. A machine is offered only what is in play; a person sees all
    //of it, because "what is here" and "what may be used" are different
    //questions and the second one is the guest's.
    function asked(args) {
        var a = args || {};
        return { fromMachine: !!(a._fromMachine || a.fromMachine) };
    }

    //AND WHETHER A PERSON IS THE ONE DOING IT, which is what decides whether a
    //save approves what it saved. See ./entries.js — a model may write one and
    //may not ratify its own.
    function by(args) {
        return (args || {})._overTheWire ? 'the command line' : 'the window';
    }

    var undo = [];
    if (actions) {
        //---- reading the three -------------------------------------------
        undo.push(actions.define('jobs', {
            about: 'The jobs this workspace has: scripts that take a prompt and do something with it. '
                + '"kind" is task or judge',
            takes: ['tag', 'kind'],
            run: async function (args) {
                var a = args || {};
                var it = await resolved(a.kind);
                var rows = a.tag
                    ? it.jobs.filter(function (j) { return (j.tags || []).indexOf(a.tag) >= 0; })
                    : it.jobs;

                var tags = {};
                it.jobs.forEach(function (j) { (j.tags || []).forEach(function (t) { tags[t] = true; }); });

                return {
                    jobs: chain.offeredTo(rows, asked(a)),
                    tags: Object.keys(tags).sort(),
                    prompts: it.allPrompts.map(function (p) {
                        return { id: p.id, name: p.name, approved: p.approved };
                    }),
                    where: it.dir,
                    note: rows.length
                        ? 'A job runs against the workspace that is open. Nothing unapproved runs, and that '
                            + 'means the script AND the prompt it is given.'
                        : 'No jobs yet. A job is a script that takes a prompt and does something with it.'
                };
            }
        }));

        undo.push(actions.define('job', {
            about: 'One job in full, including the script — which the listing leaves out',
            takes: ['id'],
            run: async function (args) {
                var a = args || {};
                var it = await resolved();
                var one = it.jobs.filter(function (j) { return j.id === String(a.id); })[0];
                if (!one) throw new Error('There is no job called "' + a.id + '".');

                //THE CODE IN FULL, which is what an editor asks for and what a
                //listing must not carry.
                return Object.assign({}, one, {
                    code: codeOf(one, it.dir) || starters.JOB,
                    starter: starters.JOB
                });
            }
        }));

        undo.push(actions.define('prompts', {
            about: 'The prompt library: what a worker can be told, written once and kept. '
                + '"kind" is task or judge',
            takes: ['kind'],
            run: async function (args) {
                var a = args || {};
                var it = await resolved(a.kind);
                return {
                    prompts: chain.offeredTo(it.prompts, asked(a)),
                    contracts: chain.offeredTo(it.contracts, asked(a)),
                    note: it.prompts.length
                        ? 'A task copies the text it was given rather than pointing at it, so editing one here '
                            + 'never rewrites a task that already went out.'
                        : 'Nothing kept yet. A prompt is the brief of a task, written once — worth keeping the '
                            + 'moment you would type it a second time.'
                };
            }
        }));

        undo.push(actions.define('contracts', {
            about: 'The rules a worker can be held to, written once and kept. "kind" is task or judge',
            takes: ['kind'],
            run: async function (args) {
                var a = args || {};
                var it = await resolved(a.kind);
                return {
                    contracts: chain.offeredTo(it.contracts, asked(a)),
                    starter: starters.CONTRACT,
                    note: it.contracts.length
                        ? 'A contract is what a worker may not do while doing what it was told. A task copies '
                            + 'the rules it was held to, so editing one here never changes what already went out.'
                        : 'Nothing kept yet. A contract is the limits, written once and read by a person.'
                };
            }
        }));

        undo.push(actions.define('contract', {
            about: 'One contract in full',
            takes: ['id'],
            run: async function (args) {
                var one = await contracts.get((args || {}).id);
                if (!one) throw new Error('There is no contract called "' + (args || {}).id + '".');
                return one;
            }
        }));

        //---- writing, approving, setting aside, forgetting -----------------
        //
        //THE SAME SIX DOORS FOR EACH, and every one of them is ./entries.js
        //with a different store behind it. What differs between the three is
        //where they are kept and what the approval is against, and both of those
        //are settled where the stores are built.
        //---- SAYING SO, RATHER THAN BEING FOUND OUT TWENTY SECONDS LATER ---
        //
        //EVERY PANE HERE READS ITS LIST ON A TWENTY SECOND POLL. So a job, a
        //prompt or a contract written from the command line is not on the screen
        //you are looking at -- and not clickable -- for up to twenty seconds.
        //
        //THE DRILL THAT FOUND IT IS THE ONE THAT WALKS THE WINDOW: it writes a
        //prompt down the pipe, drives to Worker/Prompts, and looks for the card
        //it just made. The prompt exists; the card does not yet. A person doing
        //the same thing meets the same wall and has no way to tell a slow pane
        //from a save that did not happen.
        //
        //ONE EVENT, AND THE PANE ASKS AGAIN. Deliberately NOT the rows: what
        //changed is cheap to say and the answer is what the pane already knows
        //how to fetch, filtered the way that pane wants it. Sending the list
        //would mean this half deciding which half of the library each pane is
        //about, which is the thing `kind` exists to keep apart.
        //
        //THE POLL STAYS AS THE FLOOR. A write this misses -- a file edited on
        //disk, a store changed by something that never came through here -- is
        //still picked up within twenty seconds. Events for the moments something
        //happens; a poll for the truth being derived elsewhere.
        var io = host && host.io;

        function changed(what) {
            if (io) io.emit('library:changed', { what: what });
        }

        function doors(what, store, opts) {
            var o = opts || {};

            undo.push(actions.define(what + 'Save', {
                about: o.saveAbout,
                takes: o.takes,
                run: async function (args) {
                    var a = args || {};
                    var made = await store.save(a, by(a));
                    log.good((made.created ? 'wrote ' : 'saved ') + what + ' "' + made.name + '"'
                        + (made.approved ? '' : ' — waiting to be read'));
                    changed(what);
                    return made;
                }
            }));

            undo.push(actions.define(what + 'Approve', {
                about: 'Say this ' + what + ' has been read, and may be used',
                takes: ['id', 'note'],
                //A PERSON'S PRESS, AND ONLY A PERSON'S. The whole library rests
                //on this: a model may write one and may not ratify its own.
                run: async function (args) {
                    var a = args || {};
                    //A PRESS DRIVEN FROM THE COMMAND LINE IS THE COMMAND LINE,
                    //whichever button it lands on. ../core/drive refuses a
                    //protected button before it reaches here, and this is the
                    //half that does not depend on the button being painted --
                    //a pane that builds its own control is a pane the driver
                    //cannot see the mark on.
                    //
                    //NOT `_fromTest`, DELIBERATELY. A drill may approve: it is
                    //how a run gets a job it can then dispatch, and the app
                    //being ported from draws the same line. What a drill may not
                    //do is arm the drills -- see ATTHEWINDOW in ../settings.
                    if (a._overTheWire || a._driven) {
                        throw new Error('Approving a ' + what + ' is done in the window, by somebody who has read '
                            + 'it. That is the whole of what an approval means here — a model may write one and '
                            + 'may not ratify its own. A press driven from the command line is the command line, '
                            + 'whichever button it lands on.');
                    }
                    var now = await store.approve(a.id, a.note);
                    log.good('approved ' + what + ' "' + now.name + '"');
                    changed(what);
                    return now;
                }
            }));

            undo.push(actions.define(what + 'Withdraw', {
                about: 'Take back the approval on a ' + what + '. It stays, and nothing may use it',
                takes: ['id'],
                //NOT REFUSED OVER THE WIRE, and deliberately. Anything that can
                //see something wrong should be able to stop it being used; the
                //cost of a withdrawal nobody meant is somebody reading it again.
                run: async function (args) {
                    var now = await store.withdraw((args || {}).id);
                    log.warn('withdrew approval on ' + what + ' "' + now.name + '"');
                    changed(what);
                    return now;
                }
            }));

            undo.push(actions.define(what + 'Use', {
                about: 'Put a ' + what + ' back in play, or set it aside. Setting aside keeps everything',
                takes: ['id', 'on'],
                run: async function (args) {
                    var a = args || {};
                    var now = await store.use(a.id, a.on, { by: by(a) });
                    changed(what);
                    return now;
                }
            }));

            //---- WHAT WAS APPROVED BEFORE THIS ----------------------------
            //
            //THE LIBRARY KEPT THESE AND NOTHING COULD READ THEM. ../core/versions
            //has written a copy on every approval since it existed, and the only
            //way to that copy was `approved --kind X --id Y` with the id spelled
            //the way THIS file files it — which a pane has no business knowing
            //and a person has no way of guessing.
            //
            //A DOOR PER KIND, LIKE THE OTHER FIVE. `contractVersions --id x`
            //reads the way the rest of this surface reads, and the alternative —
            //one door taking a `which` — is a second grammar for one subject.
            undo.push(actions.define(what + 'Versions', {
                about: 'Every version of this ' + what + ' that a person approved, newest first',
                takes: ['id'],
                run: async function (args) {
                    var a = args || {};
                    var one = await store.get(a.id);
                    if (!one) throw new Error('There is no ' + what + ' called "' + a.id + '".');

                    var filed = await versionId(what, a.id);
                    var all = imports.versions.list(what, filed);
                    return {
                        id: one.id, name: one.name, versions: all,
                        //THE NEWEST IN FULL, AND ONLY THE NEWEST. The listing is
                        //metadata for the reason ../core/versions says — twenty
                        //versions of a contract is half a megabyte nobody asked
                        //to read — but the newest is the one a LAPSED entry is a
                        //change from, so a pane that had to ask twice to show
                        //that would be asking twice on every selection.
                        newest: all.length ? withChange(imports.versions.newest(what, filed)) : null,
                        //LAPSED IS THE STATE THIS ANSWER IS FOR, so it is said
                        //here rather than left to be worked out from two fields.
                        lapsed: !!one.lapsed,
                        note: all.length
                            ? all.length + ' version(s) kept. Ask for one by `at` to read it and what changed to '
                                + 'reach it.'
                            : 'Nothing has been approved for this yet, so there is nothing kept. Versions start at '
                                + 'the first approval, not at the first save.'
                    };
                }
            }));

            undo.push(actions.define(what + 'Version', {
                about: 'One approved version of this ' + what + ': the text as approved, and what changed to reach it',
                takes: ['id', 'at'],
                run: async function (args) {
                    var a = args || {};
                    var one = await store.get(a.id);
                    if (!one) throw new Error('There is no ' + what + ' called "' + a.id + '".');

                    var filed = await versionId(what, a.id);
                    var it = a.at ? imports.versions.read(what, filed, a.at) : imports.versions.newest(what, filed);
                    if (!it) {
                        throw new Error(a.at
                            ? 'Nothing was approved for "' + a.id + '" at "' + a.at + '".'
                            : 'Nothing has been approved for "' + a.id + '" yet, so there is no version to read.');
                    }

                    return withChange(it);
                }
            }));

            undo.push(actions.define(what + 'Forget', {
                about: 'Delete a ' + what + '. Set it aside instead if it was ever used',
                takes: ['id'],
                run: async function (args) {
                    var gone = await store.forget((args || {}).id);
                    log.warn('deleted ' + what + ' "' + gone.name + '"');
                    changed(what);
                    return Object.assign({}, gone, {
                        note: 'Deleted. Anything that already went out kept its own copy of what it was given, '
                            + 'so nothing that ran changes.'
                    });
                }
            }));
        }

        doors('job', jobs, {
            saveAbout: 'Write or rewrite a job: its script, and the prompt it is given',
            takes: ['id', 'name', 'about', 'code', 'promptId', 'tags', 'kind']
        });
        doors('prompt', prompts, {
            saveAbout: 'Write or rewrite a prompt: what a worker is told, and the contract it runs under',
            takes: ['id', 'name', 'about', 'text', 'contractId', 'kind']
        });
        doors('contract', contracts, {
            saveAbout: 'Write or rewrite a contract: what a worker may not do while doing what it was told',
            takes: ['id', 'name', 'about', 'text', 'kind']
        });
    }

    //---- AND WHAT IN HERE IS WAITING ON A PERSON --------------------------
    //
    //REGISTERED WITH ../inbox RATHER THAN READ BY IT. That plugin used to
    //consume this one and reach in — see its header for why that could only
    //grow. What is here is the half it could never have written correctly from
    //the outside:
    //
    //TWO MEANINGS OF `kind` MEET IN ONE ROW, and keeping them apart is the whole
    //of this block. What the thing IS — a job, a prompt, a contract — and who it
    //is FOR: `task` ones live under Worker, `judge` ones under Judge. Counted
    //together they once put a badge on a tab the things were not on, and sent a
    //button to a pane where they are not.
    //
    //IT IS THE PLAIN CASE FOR THE LIST: a model may write one of these and may
    //not approve its own, so an unread one is work that has silently stopped and
    //will sit there for a week.
    //
    //`lapsed` IS THE ONE PEOPLE MISS. Approved, then edited — so what was
    //approved is not what would be sent. It reads as approved everywhere that
    //shows a badge, which is why the reason says which of the two it is.
    undo.push(imports.inbox.source({
        name: 'jobs, prompts and contracts nobody has read',
        //AWAITED, WHICH IT WAS NOT, AND IT HAD NEVER ONCE ANSWERED.
        //
        //`all()` reads a document off disk and is async. The version of this
        //that lived in ../inbox called it synchronously and handed the PROMISE
        //to `.filter` -- inside a `catch` whose comment read "the library is not
        //answering". So it threw on every call, was swallowed on every call, and
        //an unapproved job, prompt or contract has never appeared on that list.
        //The count somebody would have trusted was always zero.
        //
        //IT WAS FOUND THE FIRST TIME THIS RAN AS A REGISTERED SOURCE, by the
        //`notCounted` line naming it -- which is the whole difference between a
        //source that says nothing and a source nobody can hear.
        waiting: async function () {
            var out = [];
            var shelves = [['job', jobs], ['prompt', prompts], ['contract', contracts]];

            for (var s = 0; s < shelves.length; s++) {
                //`let` SO THE CLOSURE BELOW SEES THIS ITERATION'S. With `var`
                //every row would be labelled with the last shelf read.
                let type = shelves[s][0];
                let shelf = shelves[s][1];
                if (!shelf || !shelf.all) continue;

                var rows = (await shelf.all()) || [];
                rows.filter(function (x) { return !x.approved; }).forEach(function (one) {
                    var judging = String(one.kind || 'task') === 'judge';
                    out.push(imports.inbox.item(
                        type + ' to approve',
                        one.name || one.id,
                        'Nothing can run it until somebody reads it. ' + (one.lapsed
                            ? 'It was approved and then edited, so what was approved is not what would be sent.'
                            : 'Written and never approved.'),
                        imports.inbox.at(judging ? 'Judge' : 'Worker', capital(type) + 's', one.id),
                        { since: one.edited || one.written || null, id: one.id }
                    ));
                });
            }
            return out;
        }
    }));

    await register(null, {
        //HANDED OUT SO ../judge STOPS RELAYING FOR IT. `judgementCreate` reads
        //jobs, prompts and contracts to copy the words onto a judgement, and it
        //does that through the action table today.
        library: {
            jobs: jobs, prompts: prompts, contracts: contracts,
            resolved: resolved,
            starters: starters,

            //---- AND THE SCRIPT ITSELF, WHICH NOTHING COULD REACH -----------
            //
            //A JOB'S CODE IS A FILE BESIDE ITS RECORD and `codeOf` is the only
            //thing that reads it — a detail of this plugin, used for hashing the
            //approval and for counting lines. So a job entry has every field
            //ABOUT the script and not the script, and ../runners/runs asked it
            //for `job.code`: undefined, always.
            //
            //THE CONSEQUENCE WAS NOT A MISSING SCRIPT, WHICH WOULD HAVE BEEN
            //OBVIOUS. ../../vms/dispatch reads `it.job` to decide WHICH KIND OF
            //RUN this is — a job, a shell command, or a plain task — so an
            //undefined one silently made every job into a plain task, dispatched
            //as `claude -p "$(cat task.txt)"` with a task file that was also
            //empty. Every judgement and every scripted task since died as
            //`claude -p ""`, reported by Claude as "Input must be provided
            //either through stdin or as a prompt argument", which names neither
            //the job nor the fault.
            //
            //ON DEMAND RATHER THAN ON THE ENTRY. Attaching it would put a few
            //thousand characters of script on every row of a list that panes
            //draw and `capture` photographs, to serve the one caller that
            //actually runs one.
            codeFor: async function (id) {
                var dir = await jobsDir();
                var entry = await jobs.get(id);
                return entry ? codeOf(entry, dir) : null;
            }
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
