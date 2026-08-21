var makeJudgements = require('./store');

//---------------------------------------------------------------------------
//THE JUDGE: a set of jobs, prompts and contracts, and the record of what was
//asked with them.
//
//THE SAME SHAPE AS ../worker, and that is the whole point of the split. A job, a
//prompt and a contract belong to whoever RUNS them; what a judge does with its
//three is ask ../queue for work. Neither the worker nor the judge owns a task
//once it exists — ../queue does — and neither owns the queue.
//
//SO THIS OWNS ONE THING: what was asked of a judge and what came back. ./store.js
//is that record and has no plugin, no workspace and no machine in it.
//
//---- what is here, and what is not, yet -----------------------------------
//
//THE RECORD READS AND THE ONE THAT THROWS A RECORD AWAY. Both are questions
//about a file this app keeps, so both can be answered here today.
//
//WHAT IS NOT: `judgementCreate`, `judgementFindings` and `judgementSay`.
//
//  create    is where the judge stops being a record. A judgement of a pull
//            request may not be asked for until a person has ALLOWED it, and
//            the allowance is against a commit — the standing rule is that a
//            stranger's change is not read on this host because a model decided
//            it should be. That gate lives with the pull requests, in
//            ../repositories/pr, and this consumes it rather than keeping a
//            second copy of the decision.
//
//  findings  is what a run handed back, filed under the judgement — and it is
//            the SUPERVISOR'S ONE WINDOW ONTO THE CODE. A supervisor is not
//            given the diff or the files a task delivered; it decides what to
//            do next from what a judge said. That store has not been ported.
//
//  say       posts a review to somebody else's repository, under a person's
//            name. It is refused over the wire and refused to a driven click,
//            and it needs the GitHub half.
//
//UNTIL THOSE MOVE THEY RELAY, which is the migration path this app is built on
//— see ../../../CLAUDE.md. The two here shadow the relayed ones the moment they
//are defined, and they answer about THIS app's record, which starts empty.
//---------------------------------------------------------------------------

//WHAT A LIST LEAVES OUT, AND WHAT IT CUTS SHORT.
//
//`brief` and `rules` are the two long ones and the two nothing reading a list
//wants. Taking them out fixed this once, at seventy-five thousand characters —
//and it was seventy-seven thousand again a while later, because `question` grew
//to carry a whole claim and `note` to carry a finished judgement's findings in
//full. A drill said so before anybody noticed: "the list of judgements is a file
//rather than a list".
//
//TRUNCATED RATHER THAN DROPPED. A list with no hint of what any of them SAID is
//one nobody can triage from, which is the same mistake in the other direction.
//An ellipsis is the signal that there is more, and `ref` is how to get it.
function trim(s, n) {
    var t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    if (!t) return null;
    return t.length > n ? t.slice(0, n) + '…' : t;
}

plugin.consumes = ['app', 'log', 'state'];
plugin.provides = ['judge'];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log;
    var state = imports.state;

    var store = makeJudgements({
        judging: function () { return state.here.doc('judging'); },
        counter: function () { return state.here.doc('judging-highest'); }
    }, log);

    var undo = [];
    if (actions) {
        undo.push(actions.define('judging', {
            about: 'Every judgement: what is waiting to be read, what is being read, and what was decided. '
                + 'One ref reads that one in full',
            takes: ['ref'],
            run: async function (args) {
                var want = (args || {}).ref;
                var all = await store.all();

                if (want) {
                    var asked = String(want).trim().toUpperCase();
                    var one = all.filter(function (j) {
                        return String(j.ref).toUpperCase() === asked || String(j.number) === String(want);
                    })[0];
                    if (!one) {
                        throw new Error('There is no judgement called "' + want + '". The list has '
                            + all.length + ': ' + (all.map(function (j) { return j.ref; }).join(', ') || 'none') + '.');
                    }
                    return {
                        judgement: one,
                        note: one.ref + ' in full, including the words it was given and the rules it was held to. '
                            + 'judgementFindings is what it handed back.'
                    };
                }

                var short = all.map(function (j) {
                    var row = Object.assign({}, j);
                    delete row.brief;
                    delete row.rules;
                    delete row.attempts;

                    row.question = trim(j.question, 160);
                    row.note = trim(j.note, 240);

                    //---- THE ONE ANSWER THE ATTEMPTS WERE CARRYING ----------
                    //
                    //TAKING `attempts` OUT COST SOMETHING, and it was not
                    //obvious until a second reader went looking. A judgement
                    //that CRASHED and one that read the change and found
                    //nothing are the same row without the exit code — and the
                    //exit code lives on the attempts. So anything working out
                    //"did this crash" from this list ran over a field that is
                    //not here, found nothing, and reported a confident FALSE
                    //standing in for "I was not told".
                    //
                    //The raw material stays out; the answer it was wanted for
                    //comes along. Same shape as the tasks board, which carries
                    //`reads` rather than the commits it worked that out from.
                    //
                    //THREE VALUES, NOT TWO. `null` for a judgement whose
                    //attempts recorded no exit code at all. "Nothing was
                    //recorded" is its own answer and is not evidence of a clean
                    //run.
                    row.crashed = (function () {
                        var said = (j.attempts || []).filter(function (a) { return a.exit != null; });
                        if (!said.length) return null;
                        return said.some(function (a) { return a.exit !== 0; });
                    })();

                    return row;
                });

                return {
                    judgements: short,
                    //COUNTED BY STATE, because "eleven judgements" says nothing
                    //about whether this host is behind. What somebody wants is
                    //how many are still to happen.
                    waiting: all.filter(function (j) { return j.state === 'queued'; }).length,
                    running: all.filter(function (j) { return j.state === 'given'; }).length,
                    decided: all.filter(function (j) { return j.state === 'done'; }).length,
                    note: all.length
                        ? 'The words each one was given and the rules it was held to are left out here, and what '
                            + 'it asked and what it found are cut short — an ellipsis means there is more. Ask for '
                            + 'one by ref to read any of it in full.'
                        //EMPTY BECAUSE THE RECORD MOVED, said rather than left
                        //to read as loss. This board answers from THIS app,
                        //whose state is its own — see ../../../CLAUDE.md.
                        : 'Nothing has been asked for here yet. This board reads this app’s own record, which '
                            + 'starts empty and is separate from the dashboard being ported from.'
                };
            }
        }));

        undo.push(actions.define('judgementRemove', {
            about: 'Throw a judgement away. What it handed back is untouched',
            takes: ['ref'],
            //THE REFUSAL FOR ONE THAT IS OUT ON A MACHINE IS IN ./store.js,
            //because it is a rule about the record rather than about this table.
            run: async function (args) {
                return await store.remove((args || {}).ref);
            }
        }));
    }

    await register(null, {
        //HANDED OUT AS A SERVICE so ../queue can read what is waiting without
        //going through the action table, and so the doors that are not built
        //yet have somewhere to land.
        judge: {
            all: store.all,
            get: store.get,
            add: store.add,
            update: store.update,
            remove: store.remove,
            subjectFrom: store.subjectFrom,
            refOf: store.refOf,
            STATES: store.STATES,
            VERDICTS: store.VERDICTS
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
