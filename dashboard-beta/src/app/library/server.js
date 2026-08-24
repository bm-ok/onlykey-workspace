var fs = require('fs');
var path = require('path');

var makeLibrary = require('./entries');
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
//---- where each of the three lives, which is not the same place -----------
//
//A JOB IS KEPT PER WORKSPACE. It is a SCRIPT that runs against the folder of
//repositories that is open, and its code is a file on disk beside the record.
//
//A PROMPT AND A CONTRACT ARE KEPT PER COMPUTER. "Read the README against the
//code and say where they disagree" names no branch and no repository, and a
//library that emptied itself when somebody switched workspace is one nobody
//would spend an afternoon building.
//
//THAT ASYMMETRY IS THE DESIGN, not an oversight to tidy up, and it is why this
//half consumes ../core/state rather than one drawer of it.
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

plugin.consumes = ['app', 'log', 'state', 'inbox'];
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

    var contracts = makeLibrary('contract', function () { return state.app.doc('contracts'); }, {
        writes: ['text'],
        needsBody: 'Write the rules. An empty contract would be handed to a worker as no limits at all.'
    });

    var prompts = makeLibrary('prompt', function () { return state.app.doc('prompts'); }, {
        writes: ['text', 'contractId'],
        //THE CONTRACT IS PART OF WHAT WAS APPROVED. See ./entries.js.
        approvedWith: ['contractId'],
        needsBody: 'Write the prompt. An empty one would be handed to a worker as an empty instruction.'
    });

    var jobs = makeLibrary('job', async function () { return await state.here.doc('jobs'); }, {
        writes: ['promptId', 'tags'],
        approvedWith: ['promptId'],
        //THE BODY IS THE CODE, AND THE CODE IS ON DISK. The approval is against
        //what will actually RUN, so editing the file lapses it even though
        //nothing about the record changed.
        context: jobsDir,
        bodyOf: function (e, dir) { return codeOf(e, dir); },

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
                    return now;
                }
            }));

            undo.push(actions.define(what + 'Use', {
                about: 'Put a ' + what + ' back in play, or set it aside. Setting aside keeps everything',
                takes: ['id', 'on'],
                run: async function (args) {
                    var a = args || {};
                    var now = await store.use(a.id, a.on, { by: by(a) });
                    return now;
                }
            }));

            undo.push(actions.define(what + 'Forget', {
                about: 'Delete a ' + what + '. Set it aside instead if it was ever used',
                takes: ['id'],
                run: async function (args) {
                    var gone = await store.forget((args || {}).id);
                    log.warn('deleted ' + what + ' "' + gone.name + '"');
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
            starters: starters
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
