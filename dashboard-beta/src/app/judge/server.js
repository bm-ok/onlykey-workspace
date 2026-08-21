var makeJudgements = require('./store');
var gate = require('./gate');

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
//THE RECORD READS, THE ONE THAT THROWS A RECORD AWAY, AND THE ONE THAT ASKS FOR
//A JUDGEMENT.
//
//`judgementCreate` IS WHERE THE JUDGE STOPS BEING A RECORD, and the decisions it
//makes are in ./gate.js rather than in the action — every one of them is a rule
//standing between a stranger's code and a machine on this host holding a
//credential, and rules that can only be exercised by arranging a real pull
//request get exercised once and then trusted. This half only fetches.
//
//THE ALLOWANCE COMES FROM ../repositories/pr AND IS NOT COPIED. Whether a pull
//request may be read here, at this commit, is a decision about a pull request;
//one place answers it, and a second reader is a second chance to get the
//staleness rule slightly different.
//
//WHAT IS NOT HERE: `judgementFindings` and `judgementSay`.
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
//— see ../../../CLAUDE.md. What is here shadows the relayed ones the moment it
//is defined, and answers about THIS app's record, which starts empty.
//
//AND THE LIBRARY IS STILL RELAYED, which is why `judgementCreate` reads jobs,
//prompts and contracts through `actions.call` rather than through a service. The
//words are COPIED onto the judgement either way, so where they were read from
//stops mattering the moment it is written.
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

plugin.consumes = ['app', 'log', 'state', 'prcuts', 'refs'];
plugin.provides = ['judge'];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log;
    var state = imports.state;

    //WHO OWNS "MAY THIS PULL REQUEST BE READ HERE": ../repositories/pr, because
    //the allowance is a decision about a pull request. This consumes that answer
    //rather than keeping a second copy of the staleness rule.
    var prcuts = imports.prcuts;

    //AND WHERE A REPOSITORY CAME FROM, and what each is at now — through
    //../repositories/refs, the group's one reader.
    var refs = imports.refs;

    var store = makeJudgements({
        judging: function () { return state.here.doc('judging'); },
        counter: function () { return state.here.doc('judging-highest'); }
    }, log);

    //WHAT HAS NOT MOVED HERE YET. `actions.call` tries this app's table first
    //and the pipe to the app being ported from second, so the library — jobs,
    //prompts, contracts — and the GitHub reads answer from over there until they
    //move. A failure is null rather than a throw: every caller below treats "I
    //could not find out" as its own answer, and ./gate.js refuses on it.
    async function relayed(name, args) {
        if (!actions) return null;
        try { return await actions.call(name, args || {}); }
        catch (e) { return null; }
    }

    //A WORKSPACE NAME TO THE NAME GITHUB KNOWS IT BY. See the block in
    //`judgementCreate` for what this cost.
    async function ownerAndName(name) {
        var said = null;
        try { said = await refs.origin(String(name)); }
        catch (e) { said = null; }

        if (!said || !said.owner || !said.repo) {
            throw new Error('"' + name + '" is not a repository in this workspace, and it is not an owner/name '
                + 'either. A pull request is named by the repository it is on — either the workspace name or '
                + 'owner/name.');
        }
        return said.owner + '/' + said.repo;
    }

    //WHAT GITHUB SAYS THE PULL REQUEST IS AT NOW.
    //
    //NULL WHEN IT COULD NOT BE ASKED, and ./gate.js treats that as a refusal
    //rather than as agreement — which is the whole point of asking.
    async function livePull(on, number) {
        var said = await relayed('pulls', { on: on, state: 'all' });
        if (!said) return null;
        return (said.pulls || []).filter(function (p) {
            return Number(p.number) === Number(number);
        })[0] || null;
    }

    //WHAT EACH REPOSITORY IS AT FOR THIS SUBJECT, which is what a judgement
    //records as `tips` and what says later whether a reading still describes the
    //code. Through ../repositories/refs, which reads each repository once for
    //the whole group.
    async function tipsFor(subject) {
        var branch = subject.kind === 'branch' ? subject.branch : (subject.source || null);
        if (!branch) return {};
        var at = {};
        try { at = await refs.heads(); } catch (e) { return {}; }

        var out = {};
        Object.keys(at).forEach(function (repo) {
            if (at[repo] && at[repo][branch]) out[repo] = at[repo][branch];
        });
        return out;
    }

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

        //=================================================================
        //ASKING FOR A JUDGEMENT.
        //
        //THE RULES ARE IN ./gate.js AND NOTHING HERE DECIDES ANYTHING. This
        //half only goes and gets the facts each rule needs — an allowance,
        //what GitHub says, which cuts exist, what the library holds — and
        //hands them over. See that file for why the split is worth having:
        //these are the rules between a stranger's code and a machine on this
        //host holding a credential, and a rule that can only be exercised by
        //arranging a real pull request is one that gets exercised once.
        //=================================================================
        undo.push(actions.define('judgementCreate', {
            about: 'Ask for a judgement of a branch cut, a PR cut or an arrived pull request: '
                + 'what is read, which job reads it, and what question it is being asked',
            takes: ['kind', 'branch', 'source', 'target', 'on', 'number', 'sha',
                'job', 'by', 'tag', 'question', 'remembers'],
            run: async function (args) {
                var a = args || {};
                var over = !!a._overTheWire;

                //---- A REPOSITORY MAY BE NAMED EITHER WAY, AND ONE OF THEM
                //WAS WRONG.
                //
                //An allowance is filed under the repository as GitHub knows it
                //— owner/name, because that is where a pull request lives. A
                //supervisor naturally says the name it sees everywhere else in
                //this app, which is the WORKSPACE name. Those are different
                //strings, so the allowance was looked up under a key nothing
                //had ever written, and the refusal said "nobody has allowed
                //this" about a pull request somebody had just allowed.
                //
                //A FALSE REFUSAL THAT LOOKS EXACTLY LIKE THE REAL ONE, found
                //the first time a supervisor tried it unprompted — which is the
                //only way a mismatch between two names for one thing shows up.
                //
                //RESOLVED RATHER THAN REFUSED: both are the right name from
                //where each caller is standing.
                var onWhat = a.on;
                if (String(a.kind || '').trim().toLowerCase() === 'pull'
                    && onWhat && String(onWhat).indexOf('/') < 0) {
                    onWhat = await ownerAndName(onWhat);
                }

                //RESOLVED BEFORE ANYTHING IS WRITTEN, so a judgement is never
                //filed against a cut that does not exist. ./store.js is where
                //the shapes are understood, and it refuses anything else.
                var subject = store.subjectFrom({
                    kind: a.kind, branch: a.branch, source: a.source, target: a.target,
                    on: onWhat, number: a.number, sha: a.sha
                });

                //---- the facts each rule needs -----------------------------
                var facts = {};
                if (subject.kind === 'pull') {
                    //FROM ../repositories/pr, WHICH OWNS THE DECISION. One
                    //place answers "may this be read here", and a second reader
                    //is a second chance to get the staleness rule slightly
                    //different.
                    facts.allowance = prcuts.allowed.check(subject.on, subject.number, subject.sha);
                    facts.live = await livePull(subject.on, subject.number);
                } else if (subject.kind === 'cut') {
                    var cuts = await relayed('prCuts', {});
                    facts.cuts = (cuts && cuts.cuts) || [];
                } else {
                    var board = await relayed('branchBoard', {});
                    facts.branches = (board && board.branches) || [];
                }

                var whyNot = gate.whyNotRead(subject, facts);
                if (whyNot) throw new Error(whyNot);

                //---- and whether this asker may commission it --------------
                var tips = await tipsFor(subject);
                var mine = await store.all();
                var no = gate.whyNotCommission(subject, mine, function (j) {
                    return gate.staleAgainst(j, tips);
                }, over);
                if (no) throw new Error(no);

                //---- the chain it will be read under -----------------------
                var chain = {};
                var library = null;
                if (a.job) {
                    library = ((await relayed('jobs', {})) || {}).jobs || [];
                    var which = library.filter(function (j) { return j.id === String(a.job); })[0];
                    if (!which) {
                        throw new Error('There is no job "' + a.job + '". Ask jobs for the list — a judgement '
                            + 'runs a job like any other work.');
                    }

                    //FROM THE LIBRARY, BECAUSE THAT IS WHERE THE WORDS LIVE.
                    //The `jobs` answer reports which prompt a job runs and
                    //whether it is approved — not its text, quite rightly — so
                    //a first version of this copied a field that does not exist
                    //and produced a judgement with no brief, which fails at the
                    //machine rather than here.
                    var prompts = ((await relayed('prompts', {})) || {}).prompts || [];
                    var words = which.promptId
                        ? prompts.filter(function (p) { return p.id === which.promptId; })[0] || null
                        : null;

                    var contracts = ((await relayed('contracts', {})) || {}).contracts || [];
                    var under = words && words.contractId
                        ? contracts.filter(function (c) { return c.id === words.contractId; })[0] || null
                        : null;

                    //THE JOB ROW CARRIES BOTH HALVES — what it is, and what the
                    //library says about whether it can run — so it is handed in
                    //twice rather than split into two lookups that could
                    //disagree.
                    chain = gate.chainFor(which, which, words, under);
                }

                var asked = String(a.question || '').trim();
                if (asked && !chain.brief) {
                    var can = (library || ((await relayed('jobs', {})) || {}).jobs || [])
                        .filter(function (j) { return j.kind === 'judge' && j.runnable; });
                    throw new Error(gate.askedWithNoJudge(can));
                }
                if (asked) chain.brief = gate.withQuestion(chain.brief, asked);

                var made = await store.add(Object.assign({
                    subject: subject, by: a.by, tag: a.tag,
                    question: asked || null,
                    remembers: a.remembers
                }, chain));

                return Object.assign({}, made, {
                    note: made.job
                        ? made.ref + ' is a draft. Queue it and the next machine that will take it reads '
                            + subject.name + '.'
                        : made.ref + ' is a draft with no job, so nothing can run it yet. Give it one — a '
                            + 'judgement without a chain is an opinion with nothing behind it.'
                });
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
