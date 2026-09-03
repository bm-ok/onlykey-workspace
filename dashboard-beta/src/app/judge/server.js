var makeJudgements = require('./store');
var reviewing = require('./reviewing');
var gate = require('./gate');
//THE VERDICT PARSER IS THE QUEUE'S, and it is pure; required across the
//plugin line the way ../github/trust.js is, so the two never disagree about
//what a last line means.
var concluding = require('../queue/concluding');

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
//`judgementFindings` IS WHAT A RUN HANDED BACK, and it is the SUPERVISOR'S ONE
//WINDOW ONTO THE CODE. A supervisor is not given the diff or the files a task
//delivered; it decides what to do next from what a judge said. Where those files
//are kept is ../core/archive's business — the same drawer ../queue opens for a
//task's, because they arrive the same way and are filed the same way.
//
//`judgementSay` IS HERE NOW, and it is the only thing in this plugin that
//PUBLISHES. It puts a review on somebody else's repository, under a person's
//name, where it cannot be unsent — so it is two calls rather than one (`preview`
//composes and posts nothing), and the posting half is refused over the wire and
//refused to a driven click. This app consuming `github` at all begins here.
//
//`judgementCreate` READS THE LIBRARY THROUGH `actions.call` rather than through
//a service, which is left over from when jobs, prompts and contracts were
//answered by the app this one was ported from. It costs nothing to keep: the
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

//`archive` IS GONE FROM HERE. What a judgement handed back was the only thing
//this opened it for, and ../artifact owns that drawer now — see the note beside
//`handedBack` below.
plugin.consumes = ['app', 'log', 'state', 'prcuts', 'refs', 'artifact', 'github'];
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

    //WHAT A JUDGEMENT HANDED BACK, asked of ../artifact rather than opened here.
    //
    //THIS OPENED `archive.store('artifacts')` ITSELF, and so did ../queue —
    //twice, once under the name `findings` — and so did the door that writes
    //into it. Four openings of one drawer, every one correct, none of them the
    //owner. The comment here used to say it was "the same drawer ../queue opens
    //… because they arrive the same way", which is a shared fact held together
    //by everyone remembering to spell it identically.
    //
    //AND THE LANE IS NAMED ONCE, HERE. A judgement's files are in the judge
    //drawer and a task's in the worker one, so this cannot read the other's by
    //passing a uid that happens to exist.
    var artifacts = imports.artifact.handedBack('judge');

    var store = makeJudgements({
        judging: function () { return state.here.doc('judging'); },
        counter: function () { return state.here.doc('judging-highest'); }
    }, log);

    //ASKED BY NAME, WITH THE FAILURE SWALLOWED. A failure is null rather than a
    //throw: every caller below treats "I could not find out" as its own answer,
    //and ./gate.js refuses on it. The name is left over from when an unported
    //name travelled to another app; what it does now is call and soften.
    async function relayed(name, args) {
        if (!actions) return null;
        try { return await actions.call(name, args || {}); }
        catch (e) { return null; }
    }

    //THE ISSUE A SUBJECT WAS CUT FOR, from the cut note, or nothing. A cut's
    //rows carry their note already; a branch is looked up in the same drawer
    //../repositories/branches keeps the notes in. Never thrown: a judgement
    //with no issue behind it is the ordinary case.
    async function issueBehind(subject, facts) {
        try {
            if (subject.kind === 'cut') {
                var one = ((facts && facts.cuts) || []).filter(function (c) {
                    return c && c.source === subject.source;
                })[0];
                return (one && one.note && one.note.issue) || null;
            }
            if (subject.kind === 'branch' && subject.branch && imports.state && imports.state.here) {
                var notes = (await imports.state.here.doc('cuts')).read({}) || {};
                var mine = notes[subject.branch];
                return (mine && mine.issue) || null;
            }
        } catch (e) { return null; }
        return null;
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

    //WHAT A ROW SAYS ABOUT ITSELF, on every answer about one judgement, so
    //nothing reading a finding has to go and fetch the judgement to know what it
    //was about or what it was held to.
    function whose(it) {
        return {
            ref: it.ref,
            reads: it.subject && it.subject.name,
            state: it.state,
            verdict: it.verdict || null,
            note: it.note || null,
            contractName: it.contractName || null
        };
    }

    //HOW IT ENDED, FROM THE ATTEMPTS. Three values and not two: null is "nothing
    //was recorded", which is not evidence of a clean run.
    function exits(it) {
        return (it.attempts || []).map(function (a) { return a.exit; })
            .filter(function (x) { return x != null; });
    }
    function crashed(it) {
        var said = exits(it);
        return said.length ? said.some(function (x) { return x !== 0; }) : false;
    }
    function lastExit(it) {
        var said = exits(it);
        return said.length ? said[said.length - 1] : 'unknown';
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
                    //---- AND WHY IT NEVER RAN, WHICH IS ON THE ATTEMPTS ----
                    //
                    //THE SAME ARGUMENT AS `crashed` DIRECTLY BELOW, and found
                    //the same way: the raw material is taken out of this list,
                    //and something that reads the list then cannot answer a
                    //question the attempts were carrying.
                    //
                    //A DISPATCH THAT DIED WROTE ITS REASON ONTO THE ATTEMPT AND
                    //NOWHERE ELSE. So the pane drew "done, handed back 0 files"
                    //over a run whose job had no script, and the sentence saying
                    //so — in the record, one field away — was never on screen.
                    //A whole afternoon went into "nothing is happening".
                    row.whyFailed = (function () {
                        var last = (j.attempts || []).slice(-1)[0];
                        return (last && last.failed) || null;
                    })();

                    row.crashed = (function () {
                        var said = (j.attempts || []).filter(function (a) { return a.exit != null; });
                        if (!said.length) return null;
                        return said.some(function (a) { return a.exit !== 0; });
                    })();

                    return row;
                //---- NEWEST FIRST ----------------------------------------
                //
                //THIS HAD NO ORDER AT ALL and came out in whatever order the
                //store had written them, which is oldest first. So the top of
                //the list was the least interesting thing on it — J4, judged
                //days ago — and the one just asked for was at the bottom,
                //below nineteen finished ones, off the end of a short window.
                //
                //THE SAME WAY THE TASKS BOARD IS SORTED, by number descending
                //— see ../queue/server.js. Two lists of the same shape on two
                //tabs, ordered opposite ways, is a difference nobody decided.
                //
                //BY NUMBER RATHER THAN BY DATE, because the number is what the
                //list is labelled with and what somebody asks for by name. A
                //list sorted by a field it does not show reads as unsorted.
                }).sort(function (a, b) { return (b.number || 0) - (a.number || 0); });

                return {
                    judgements: short,
                    //COUNTED BY STATE, because "eleven judgements" says nothing
                    //about whether this host is behind. What somebody wants is
                    //how many are still to happen.
                    waiting: all.filter(function (j) { return j.state === 'queued'; }).length,
                    running: all.filter(function (j) { return j.state === 'given'; }).length,
                    //`done` IS NOT `decided`, AND THE FIRST ONE THIS APP EVER RAN
                    //WAS THE DIFFERENCE. J4 was dispatched, deadlocked before it
                    //could boot the machine, and landed in `done` with `verdict`
                    //and `decided` both null and one attempt carrying the reason
                    //— an honest record, counted here as a judgement that had
                    //reached a verdict.
                    //
                    //IT IS THE WRONG WAY TO BE WRONG. "Eleven decided" is what
                    //somebody reads to mean the reading has been DONE, and a
                    //failure that inflates it hides itself in the one number
                    //that would have shown it.
                    decided: all.filter(function (j) { return j.state === 'done' && j.verdict; }).length,
                    //SO THE ONES THAT ENDED WITHOUT ONE ARE THEIR OWN COUNT
                    //rather than folded into either neighbour. They are not
                    //waiting — nothing will pick them up again — and they did
                    //not decide anything.
                    gaveUp: all.filter(function (j) { return j.state === 'done' && !j.verdict; }).length,
                    note: all.length
                        ? 'The words each one was given and the rules it was held to are left out here, and what '
                            + 'it asked and what it found are cut short — an ellipsis means there is more. Ask for '
                            + 'one by ref to read any of it in full.'
                        //EMPTY BECAUSE THE RECORD MOVED, said rather than left
                        //to read as loss. This board answers from THIS app,
                        //whose state is its own — see ../../../CLAUDE.md.
                        : 'Nothing has been asked for here yet.'
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

                //---- AND THE ISSUE THE BRANCH WAS CUT FOR, WHOLE -------------
                //
                //FOUND BY THIS APP, NOT REMEMBERED BY THE SUPERVISOR. The cut
                //note carries the issue as a fact (branchCreate `issue`), so a
                //judge of that branch, or of a cut made from it, is handed the
                //conversation itself -- fenced, from issueRead -- rather than
                //whatever the supervisor chose to say about it. This is the
                //loop it saves: J33 passed a change the maintainer would not
                //have, because the maintainer's words never reached it.
                var forIssue = await issueBehind(subject, facts);
                if (forIssue) {
                    var told = await relayed('issueRead', { on: forIssue.on, number: forIssue.number });
                    if (told && told.conversation) chain.brief = gate.withAsked(chain.brief, told.conversation);
                }

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

        //=================================================================
        //WHAT A JUDGEMENT HANDED BACK.
        //
        //THE ONLY WAY A JUDGE CAN SAY ANYTHING. It may not push to what it
        //reads — that is refused on the host, in the git route — so everything
        //it found arrives as files filed under the judgement.
        //
        //AND THIS IS THE SUPERVISOR'S ONE WINDOW ONTO THE CODE, which is the
        //whole reason it is worth being careful about. A supervisor decides
        //what to do next on a line from what a JUDGE says about it, not from
        //reading the repositories: it is not given the diff, the files a task
        //delivered, or a change to read. So what a judge hands back is not a
        //convenience — it is the channel, and if a judge says nothing the
        //supervisor knows nothing, which is the correct outcome rather than a
        //gap to route around.
        //
        //THE SAME DRAWER ../queue OPENS. Filed under a uid by ../core/archive,
        //which owns where these are kept and every refusal about reading one.
        //=================================================================
        //---- RE-READ A VERDICT THE PARSER MISSED ----------------------------
        //
        //FOR A WHILE THE QUEUE READ EVERY DRAWER AS EMPTY (8a9dc86), so
        //judgements that had handed back a report ending RECOMMENDATION or
        //CLAIM were recorded as having concluded nothing. The reports are
        //still in the drawer. This reads them again, with the same parser,
        //and records what the judge already said -- the same fact
        //judgementFindings shows, written where the board and the story read
        //it. Nothing is decided here; a verdict a person recorded is not
        //touched.
        undo.push(actions.define('judgementReconclude', {
            about: 'Read a judgement\'s handed-back report again and record the conclusion its last line says — '
                + 'for judgements recorded as having concluded nothing while the drawer was misread',
            takes: ['ref', 'id', 'all'],
            run: async function (args) {
                var a = args || {};
                var want = [];
                if (a.all === true || a.all === 'true' || (!a.ref && !a.id)) {
                    want = (await store.all()).filter(function (j) {
                        return j.state === 'done' && !j.concluded;
                    });
                } else {
                    want = [await store.get(a.ref || a.id)];
                }
                var done = [];
                for (var i = 0; i < want.length; i++) {
                    var it = want[i];
                    var handed = await artifacts.list(it.uid);
                    var said = await concluding.concludedAcross(handed, async function (file) {
                        return String(((await artifacts.read(it.uid, file)) || {}).text || '');
                    });
                    if (said && said !== it.concluded) {
                        await store.update(it.ref, { concluded: said });
                        log.on('judge').good(it.ref + ' re-read: it concluded ' + said);
                        done.push({ ref: it.ref, was: it.concluded || null, concluded: said, files: handed.length });
                    } else {
                        done.push({ ref: it.ref, was: it.concluded || null, concluded: it.concluded || null, files: handed.length, unchanged: true });
                    }
                }
                var moved = done.filter(function (d) { return !d.unchanged; });
                return {
                    judgements: done, changed: moved.length,
                    note: moved.length
                        ? moved.map(function (d) { return d.ref + ' now says ' + d.concluded; }).join(', ') + '.'
                        : (done.length ? 'Nothing to change: ' + done.map(function (d) { return d.ref + (d.files ? ' handed back no verdict line' : ' handed nothing back'); }).join(', ') + '.' : 'No judgement is waiting on a conclusion.')
                };
            }
        }));

        undo.push(actions.define('judgementFindings', {
            about: 'What a judgement handed back: the files it wrote, and one of them in full',
            takes: ['ref', 'id', 'file'],
            run: async function (args) {
                var a = args || {};
                var it = await store.get(a.ref || a.id);
                var handed = await artifacts.list(it.uid);

                if (!a.file) {
                    //---- THE FILES, AND NOT THE JUDGEMENT'S OWN FACTS ---------
                    //
                    //THIS FOLDED `whose(it)` IN — ref, reads, state, verdict and
                    //contractName — and the pane drew them as a badge and a
                    //subtitle on the handed-back card. Those are facts about a
                    //JUDGEMENT wearing a file card's clothes, and carrying them
                    //here was the only thing that made this answer differ in
                    //shape from a task's.
                    //
                    //`ref` IS KEPT because it is this answer's own identity —
                    //which judgement's files these are — and somebody reading the
                    //JSON has nothing else to tell them by.
                    //
                    //THE REST COME FROM `judging`, which already answers "that
                    //one in full". The judgement API answers judgement facts; this
                    //answers files. Asking one door two questions is how a pane
                    //ends up with two sources for one truth.
                    return {
                        ref: it.ref,

                        //BOTH NAMES, AND IT CARRIED ONLY THE WRONG ONE.
                        //
                        //A handed-back file is stored as `<run>--<name>`, so
                        //`f.file` is `job-check-a-claim-20260902211533--CLAIM.md`
                        //and `f.name` — off the sidecar — is `CLAIM.md`, which is
                        //what the job was TOLD to write. This mapped `f.file`
                        //into `name` and dropped the other.
                        //
                        //WHICH MADE THE LIST UNREADABLE AT EXACTLY THE WRONG END.
                        //The command line fits a name into forty columns and the
                        //run prefix is thirty-four of them, so it printed
                        //`job-check-a-claim-20260902211533--CLAI…` — everything
                        //except the part anybody needs.
                        //
                        //AND THE READ DOOR BELOW ALREADY KNEW BETTER. It accepts
                        //`CLAIM.md`, because "a supervisor did exactly that and
                        //was refused for naming the file the job was told to
                        //write" — so the list was hiding the name the reader
                        //already takes.
                        //
                        //`file` IS WHAT TO ASK FOR and `name` is what to show.
                        //The short name is ambiguous when two runs both handed
                        //back a CLAIM.md, and the read door refuses that rather
                        //than guessing; the on-disk name never is.
                        files: handed.map(function (f) {
                            return {
                                name: f.name || f.file,
                                file: f.file,
                                bytes: f.bytes,
                                kept: f.kept || null
                            };
                        }),
                        //A RUN THAT CRASHED IS NOT A JUDGE THAT FOUND NOTHING,
                        //and saying so is the whole of this branch. It said "it
                        //read the change and handed nothing back. That is an
                        //answer" about a job that died at `require` before
                        //reading a line — which sends whoever asked looking at
                        //the code for a fault that is in the judge.
                        //
                        //FROM THE ATTEMPT'S EXIT CODE, which the queue records.
                        //Absent on judgements from before that was kept, and
                        //absent reads as the old sentence, which is right.
                        note: handed.length
                            ? 'Ask again with a file name to read one in full.'
                            : it.state !== 'done'
                                ? 'Nothing yet — it has not finished reading.'
                                : crashed(it)
                                    ? 'The run FAILED — it did not read the change. Nothing here is a finding '
                                        + 'about the code. Look at what it said before the machine was put '
                                        + 'away. Exit ' + lastExit(it) + '.'
                                    : 'It read the change and handed nothing back. That is an answer: there is '
                                        + 'no finding, and nothing about the code is known from it.'
                    };
                }

                //---- BY THE NAME SOMEBODY WOULD USE, not only the one on disk
                //
                //A handed-back file is stored as `<run>--<name>`, so the run it
                //came from is part of its identity and two runs of one
                //judgement cannot overwrite each other. That prefix is this
                //app's bookkeeping, and asking for "CLAIM.md" is what anybody
                //reading the contract would do — a supervisor did exactly that
                //and was refused for naming the file the job was told to write.
                //
                //ONLY WHERE IT IS UNAMBIGUOUS. If two runs both handed back a
                //CLAIM.md the short name names two things, and the refusal is
                //right — so it lists them and asks for the one that is meant,
                //rather than picking the newer and being quietly wrong about
                //which reading is being read.
                var want = String(a.file);
                var ends = handed.filter(function (f) {
                    return f.file === want || String(f.file).indexOf('--' + want) === String(f.file).length - want.length - 2;
                });
                var one = ends.length === 1 ? ends[0]
                    : handed.filter(function (f) { return f.file === want; })[0];

                if (!one && ends.length > 1) {
                    throw new Error(it.ref + ' handed back ' + ends.length + ' files called "' + want + '", from '
                        + 'different runs. Name the one that is meant: '
                        + ends.map(function (f) { return f.file; }).join(', ') + '.');
                }
                if (!one) {
                    throw new Error(it.ref + ' handed back nothing called "' + a.file + '". It handed back: '
                        + (handed.map(function (f) { return f.file; }).join(', ') || 'nothing at all') + '.');
                }

                //THE REFUSALS FOR A BINARY AND FOR SOMETHING ENORMOUS ARE
                //../core/archive'S, and are the right answer to pass straight
                //through rather than to soften.
                //THE SAME SHAPE AS THE LIST ABOVE, and it was not for a moment.
                //The list stopped folding `whose(it)` in and this did not, so one
                //action answered with the judgement's facts for a file and
                //without them for the list of files. An action that changes shape
                //depending on which question you asked it is one nothing can
                //print without checking both.
                var body = await artifacts.read(it.uid, one.file);
                return {
                    ref: it.ref,
                    file: one.file, bytes: one.bytes, text: body.text
                };
            }
        }));

        //---- SAYING ONE OUT LOUD, ON SOMEBODY ELSE'S PULL REQUEST ----------
        //
        //WHAT A JUDGEMENT OF AN ARRIVED PULL REQUEST IS FOR, IN THE END. A
        //judgement changes nothing and may not push — so a reading of somebody
        //else's pull request that stays on this host has told nobody anything.
        //The author cannot see it, and answering the person who sent it is the
        //whole point of judging an arrival.
        //
        //TWO CALLS, NOT ONE. `preview` composes exactly what would be posted and
        //posts nothing; without it, it posts. A comment on somebody else's
        //repository cannot be taken back in any way that matters — an edit
        //leaves the original in the history and the notification has already
        //gone — so what goes up is READ FIRST, in full, by the person whose
        //account it will appear under.
        //
        //AND IT IS A PERSON. Refused over the wire and refused to a driven
        //click, for the same reason allowing the judgement was: this is this
        //host speaking in public, under somebody's name, about a stranger's
        //work.
        //
        //THE WHOLE REVIEW, NOT A SUMMARY OF IT. Summarising twelve thousand
        //considered characters into three sentences means a model deciding which
        //of a judge's reservations the author gets to see — and the section a
        //summary drops first is "what I could not check", which is the section
        //that makes the rest honest.
        //---- WHAT A JUDGE HANDED BACK, AS THE TEXT OF A REVIEW ---------------
        //
        //THE LARGEST NON-EMPTY FILE IT HANDED BACK, under a header that says
        //what the judge recommended, at which commit, and that it ran nothing.
        //Lifted out of the old judgementSay so the preview, the draft and the
        //direct post all compose the same text -- the line at the top must not
        //be able to say one thing while the review under it says another.
        async function reviewText(it, at) {
            var ref = it.ref || store.refOf(it.number);
            if (it.state !== 'done') throw new Error(ref + ' has not finished reading yet.');

            var handed = await artifacts.list(it.uid);
            if (!handed.length) {
                throw new Error(ref + ' handed nothing back, so there is nothing to say. A judgement '
                    + 'that read nothing is not a review.');
            }
            var body = '';
            var from = null;
            for (var i = 0; i < handed.length; i++) {
                var text = '';
                try { text = String(((await artifacts.read(it.uid, handed[i].file)) || {}).text || ''); }
                catch (e) { continue; }
                if (!text.trim()) continue;
                if (text.length > body.length) { body = text; from = handed[i].file; }
            }
            if (!body.trim()) {
                throw new Error(ref + ' handed back ' + handed.length + ' file(s) and none of them has '
                    + 'anything in it.');
            }

            //THE RECOMMENDATION IS READ FROM THE REVIEW, not from the record, so
            //the header cannot disagree with the text under it.
            var said = body.match(/^\s*RECOMMEND(?:ATION)?:\s*(yes|no|accept|reject)\s*$/mi);
            var concluded = said ? (/^(yes|accept)$/i.test(said[1]) ? 'accept' : 'reject') : null;

            return { ref: ref, body: body, from: from, concluded: concluded, at: at };
        }

        function headerFor(plan, sha, forcedWhy) {
            return [
                '**Recommend Pulling: ' + plan.call + '**',
                '',
                'Read at ' + String(sha || '').slice(0, 7) + ' by an automated judge on the '
                    + "maintainer's host. It fetched this change and read it; it ran nothing from it, "
                    + 'and changed nothing anywhere.',
                plan.call === 'UNSTATED'
                    ? 'It did not end with a recommendation in the form it was asked for, so the answer '
                        + 'above is not its answer — read the review.'
                    : null,
                forcedWhy ? '_' + forcedWhy + '_' : null,
                '',
                '---',
                ''
            ].filter(function (x) { return x !== null; }).join('\n');
        }

        //---- A JUDGEMENT BECOMES A PULL REQUEST REVIEW, DRAFTED ---------------
        //
        //A JUDGEMENT LIVED ONLY HERE. Its recommendation was a field on a record
        //in this app, and the one way it reached GitHub was a plain comment --
        //which carries no state, satisfies no branch rule, and reads to a
        //maintainer as somebody talking rather than somebody reviewing. GitHub's
        //object for "a reviewer concluded X at commit Y" is a review, and that
        //is what this writes: APPROVE, REQUEST_CHANGES, or COMMENT. See
        //./reviewing.js for the map and the two things that bend it.
        //
        //DRAFTED, NOT POSTED. A review goes on somebody else's pull request under
        //this host's token, so it reads as the person who owns the token having
        //said it. It waits in `github-drafts` beside the issue replies, keyed
        //the same way (a pull request IS an issue on GitHub), and the same press
        //in the window releases it -- `issueApprove`, which re-reads the pull
        //request first and refuses if the head has moved. What keeps it a
        //person's is `releasing()` in ../repositories/repos/server.js, which
        //turns away the pipe, a drill and a driven press; the only way past the
        //person is `githubReviewDirect`, set at the window.
        //
        //CALLED BY THE QUEUE when a judgement finishes, by `judgementSay` when a
        //person or the supervisor asks, and by nothing else. Drafting is not
        //speech; it is refused to nobody.
        async function draftReview(args) {
                var a = args || {};
                var it = await store.get(a.ref || a.id);
                var ref = it.ref || store.refOf(it.number);
                var subject = it.subject || {};
                var wantPreview = a.preview === true || a.preview === 'true';

                //WHERE IT GOES: one pull request, or every pull request a cut
                //landed as. A branch is neither -- it has not been sent
                //anywhere, and a judgement of it is answered by sending it or
                //not.
                var targets = [];
                if (subject.kind === 'pull') {
                    targets.push({ on: subject.on, number: subject.number, pinned: subject.sha || null });
                } else if (subject.kind === 'cut') {
                    var all = (prcuts && prcuts.all) ? await prcuts.all() : {};
                    var rec = all[subject.name] || null;
                    ((rec && rec.pulls) || []).forEach(function (p) {
                        if (p.number && p.into) targets.push({ on: p.into, number: p.number, pinned: null });
                    });
                    if (!targets.length) {
                        throw new Error(ref + ' reads the cut "' + subject.name + '", which has no pull request yet. '
                            + 'Send the cut and judge it again, or decide it here by landing it or not.');
                    }
                } else {
                    throw new Error(ref + ' reads ' + (subject.name || 'something that is not a pull request')
                        + '. Only a judgement of a pull request has somewhere to be said — a branch of '
                        + "this host's own work is answered by sending it, or by landing it or not.");
                }

                var plan0 = reviewing.reviewPlan({ concluded: it.concluded, job: it.job });
                if (plan0.skip) {
                    return { ref: ref, drafted: false, posted: false, why: plan0.why,
                        note: ref + ' is a claim check, and ' + plan0.why + '.' };
                }

                var review = await reviewText(it);
                //THE TEXT'S OWN RECOMMENDATION, AND ONLY THAT, as it always has
                //been: the header must not say one thing while the review under
                //it says another. A record that says "accept" over a review that
                //recommends nothing is UNSTATED -- the review is what a
                //maintainer reads.
                var concluded = review.concluded || null;

                //WHO THIS HOST IS, without a request. Null when never checked,
                //which reads as "not the author" and lets GitHub be the judge
                //of that -- a 422 is loud, and the alternative is guessing.
                var me = null;
                try { me = ((await actions.call('githubHeld', {})) || {}).login || null; } catch (e) { me = null; }

                var direct = false;
                try { direct = ((await actions.call('settings', {})) || {}).settings.githubReviewDirect === true; }
                catch (e) { direct = false; }

                var out = [];
                for (var t = 0; t < targets.length; t++) {
                    var tg = targets[t];
                    var bits = String(tg.on || '').split('/');
                    //THE PULL REQUEST AS IT IS NOW: its author, for the own-author
                    //rule, and its head, which the review is pinned to.
                    var got = await imports.github.call('GET', '/repos/' + bits[0] + '/' + bits[1] + '/pulls/' + tg.number, null, { fresh: true });
                    if (got.status !== 200 || !got.body) {
                        throw new Error('GitHub would not say what ' + tg.on + '#' + tg.number + ' is now: '
                            + ((got.body && got.body.message) || got.status));
                    }
                    var author = got.body.user && got.body.user.login;
                    var headNow = (got.body.head && got.body.head.sha) || null;
                    var own = !!(me && author && String(me).toLowerCase() === String(author).toLowerCase());
                    var sha = tg.pinned || headNow;

                    var plan = reviewing.reviewPlan({ concluded: concluded, job: it.job, ownAuthor: own });
                    var full = headerFor(plan, sha, plan.why) + review.body.trim() + '\n';

                    var draft = {
                        kind: 'review', on: tg.on, number: tg.number, sha: sha, headNow: headNow,
                        event: plan.event, recommend: plan.call, forced: plan.forced, why: plan.why, own: own,
                        text: full, at: new Date().toISOString(),
                        by: typeof actions.whoAsked === 'function' ? actions.whoAsked(a) : 'the app', judgement: ref
                    };

                    if (wantPreview) {
                        out.push({ ref: ref, on: tg.on, number: tg.number, recommend: plan.call, event: plan.event,
                            forced: plan.forced, from: review.from, body: full, characters: full.length, posted: false,
                            note: 'This is exactly what would appear on ' + tg.on + '#' + tg.number
                                + ' as a ' + plan.event + ' review. Nothing has been posted.' });
                        continue;
                    }

                    if (direct) {
                        var r = await imports.github.call('POST',
                            '/repos/' + bits[0] + '/' + bits[1] + '/pulls/' + tg.number + '/reviews',
                            { commit_id: headNow, body: full, event: plan.event });
                        if (r.status !== 200) {
                            throw new Error('GitHub would not take the review on ' + tg.on + '#' + tg.number + ': '
                                + ((r.body && r.body.message) || ('it answered ' + r.status)));
                        }
                        var was = (await store.get(it.id)).reviewed || [];
                        await store.update(it.id, { reviewed: was.concat([{
                            on: tg.on, number: tg.number, sha: headNow, event: plan.event,
                            url: (r.body && r.body.html_url) || null, at: new Date().toISOString()
                        }]) });
                        log.on('github', tg.on).good(ref + ' reviewed ' + tg.on + '#' + tg.number + ' — ' + plan.event
                            + ' — posted directly, nobody read it first');
                        //THE SAME RECORD ../repositories/repos KEEPS for a reply
                        //or a close sent without a person. Written here rather
                        //than relayed because it is one line and a failed
                        //bookkeeping write must not fail a review that has
                        //already gone out; the drawer is a log, and both
                        //writers append to it the same shape.
                        try {
                            var spokenBox = await imports.state.here.doc('github-spoken');
                            var spokenAll = spokenBox.read({ said: [] }) || { said: [] };
                            spokenBox.write({ said: (spokenAll.said || []).concat([{
                                at: new Date().toISOString(), kind: 'review', on: tg.on, number: tg.number,
                                direct: true, by: ref, url: (r.body && r.body.html_url) || null
                            }]).slice(-200) });
                        } catch (e) { /* worth having, not worth failing over */ }
                        out.push({ ref: ref, on: tg.on, number: tg.number, recommend: plan.call, event: plan.event,
                            url: (r.body && r.body.html_url) || null, posted: true, waiting: false,
                            note: 'Posted as a ' + plan.event + ' review. Settings → Trust has direct reviews switched on, so nobody read it first.' });
                        continue;
                    }

                    var box = await state.here.doc('github-drafts');
                    var kept = box.read({}) || {};
                    //ONE PER PULL REQUEST. A second judgement of the same change
                    //replaces the first draft: two answers to one question is
                    //not a queue.
                    kept[tg.on + '#' + tg.number] = draft;
                    box.write(kept);
                    log.on('github', tg.on).info(ref + ' wrote a ' + plan.event + ' review of ' + tg.on + '#' + tg.number + ' — waiting to be released');
                    out.push({ ref: ref, on: tg.on, number: tg.number, recommend: plan.call, event: plan.event,
                        forced: plan.forced, posted: false, waiting: true, characters: full.length,
                        note: 'Written and waiting as a ' + plan.event + ' review. Nothing has been sent: a person reads '
                            + 'it and releases it — on the Judge tab, or under the pull request in Repositories → Issues. '
                            + 'Turning that step off is done in the window, in Settings → Trust.' });
                }

                //ONE ANSWER FOR ONE PULL REQUEST, a list for a cut across several.
                return out.length === 1 ? out[0] : { ref: ref, reviews: out, posted: out.every(function (x) { return x.posted; }),
                    waiting: out.some(function (x) { return x.waiting; }),
                    note: out.length + ' review(s): ' + out.map(function (x) { return x.on + '#' + x.number + ' ' + x.event; }).join(', ') };
        }

        undo.push(actions.define('reviewDraft', {
            about: 'Write a judgement of a pull request as a review draft: APPROVE, REQUEST_CHANGES or COMMENT, waiting for a person to release it',
            needs: 'workspace',
            takes: ['ref', 'id', 'preview'],
            run: draftReview
        }));

        //---- THE OLD NAME, ONTO THE SAME MACHINERY ---------------------------
        //
        //`judgementSay` posted a plain comment and refused the pipe. It is the
        //door the supervisor's list and its skill name, so it stays -- and
        //answers now with a DRAFT, the way issueSay does, which is what the
        //list's own note about it promised and the refusal contradicted. The
        //refusal has moved to release, where it belongs: writing a draft is not
        //speech, releasing it is.
        undo.push(actions.define('judgementSay', {
            about: 'Put a judgement on its pull request as a review: preview it, or write it as a draft for a person to release',
            needs: 'workspace',
            takes: ['ref', 'id', 'preview'],
            run: async function (args) {
                //THE FUNCTION, NOT THE TABLE: one door, two names, and a test
                //that loads this plugin alone can reach both.
                return await draftReview(args || {});
            }
        }));

        //---- THE QUEUE'S HALF OF THIS LIVES IN ../queue ---------------------
        //
        //`judgementQueue` AND `judgementUnqueue` WERE DEFINED HERE, and putting
        //a piece of work into the queue is the queue's rule, not this plugin's.
        //They decided what may enter it, what goes ahead of what, and what a
        //finished record means — three answers the task half of the same board
        //already had, written a second time here because judging arrived as its
        //own system.
        //
        //THIS PLUGIN KEEPS WHAT JUDGING MEANS: what was read, what it found,
        //what it concluded, what a person decided, and whether a reading still
        //describes the code. ../queue owns whether any of it runs.
        //
        //IT ALREADY HAD WHAT IT NEEDED. ../queue consumes `judge` and holds this
        //store, so the acts moved without either plugin learning anything new
        //about the other.

        //---- what has been read about a change, for whoever is sending it ---
        //
        //ASKED BY ../repositories/pr BEFORE IT SENDS ANYTHING OUT OVER THE PIPE,
        //and answered here because the staleness rule is this plugin's. A
        //second reader of `tips` is a second chance to get "does this reading
        //still describe the code" slightly different, and the two would drift
        //in the direction that matters least often and hurts most.
        //
        //THROUGH THE ACTION TABLE RATHER THAN A SERVICE, because this plugin
        //already consumes `prcuts` — the allowance for reading a pull request
        //is a decision about a pull request — and consuming `judge` back would
        //be a cycle. Same reason `judgementCreate` reads the library through
        //`actions.call`.
        //
        //FACTS, NOT A VERDICT ON THE SENDING. What a judgement means for
        //sending a change out is that caller's rule, not this one's; this says
        //only what was read, what is still current, and what each concluded.
        undo.push(actions.define('judgementsFor', {
            about: 'What has been judged about a set of branches, and which of those readings still '
                + 'describe what is there now',
            takes: ['branches'],
            run: async function (args) {
                var a = args || {};
                var want = a.branches;
                if (typeof want === 'string') {
                    want = want.indexOf('[') === 0 ? JSON.parse(want) : want.split(',');
                }
                var names = {};
                (want || []).forEach(function (n) {
                    var s = String(n == null ? '' : n).trim();
                    if (s) names[s] = true;
                });
                if (!Object.keys(names).length) throw new Error('Which branches? Nothing was named.');

                var all = await store.all();

                //A CHECK-A-CLAIM IS NOT A REVIEW OF THE CHANGE, so it neither
                //satisfies a gate nor blocks one. It reads a REPORT — "is what
                //somebody said about this code true" — and answers
                //true/false/unclear; whether the change is fit to go out is a
                //different question that nothing asked it.
                //
                //BOTH DIRECTIONS MATTER, and both have happened over there:
                //counting one as a review let a change out on a judgement that
                //never assessed it, and letting one block stopped a change
                //because a reviewer's request had been CONFIRMED — which is the
                //opposite of what confirming it means.
                var mine = all.filter(function (j) {
                    return j.state === 'done'
                        && j.job !== 'check-a-claim'
                        && j.subject && j.subject.kind === 'branch'
                        && names[j.subject.branch];
                });

                //STALENESS IS MEASURED AGAINST WHAT EACH JUDGEMENT READ, one by
                //one. Asking for the tips of the LINE name would answer about a
                //name git does not have, so every judgement would read as
                //current for ever — the exact failure staleness exists to
                //prevent.
                var rows = [];
                for (var i = 0; i < mine.length; i++) {
                    var j = mine[i];
                    var now = await tipsFor(j.subject);
                    var stale = gate.staleAgainst(j, now);
                    rows.push({
                        ref: j.ref, id: j.id, reads: j.subject.branch,
                        verdict: j.verdict || null, note: j.note || null,
                        by: j.by || null, job: j.job || null,
                        decided: j.decided || null, stale: !!stale
                    });
                }

                var current = rows.filter(function (r) { return !r.stale; });
                return {
                    branches: Object.keys(names),
                    judgements: rows,
                    current: current,
                    //THE LAST CURRENT ONE, because that is the reading that
                    //stands. Earlier ones are what was thought before.
                    latest: current.length ? current[current.length - 1] : null,
                    note: rows.length
                        ? rows.length + ' reading(s), ' + current.length + ' still describing what is there'
                        : 'Nothing has judged any of these branches.'
                };
            }
        }));

        //---- and what it decided, which nothing could record ----------------
        //
        //EVERYTHING HERE WAS BUILT TO READ A VERDICT AND NOTHING WROTE ONE.
        //`store.js` carries `VERDICTS` and validates one on the way in;
        //`gate.js` gates a second reading on `state === 'done' && by ===
        //'person' && verdict`; `judging` counts `decided` and `gaveUp` off that
        //field. And `judgementQueue`, a few lines up, refuses a person's
        //judgement with "Record what you decide with judgementVerdict instead"
        //— naming an action that did not exist.
        //
        //So a judgement could be asked for, queued, run and read, and then
        //nothing could say what it decided. A person's own reading — which is
        //what `by: 'person'` is FOR — could never reach done with a verdict at
        //all, and the loop had no end.
        undo.push(actions.define('judgementVerdict', {
            about: 'Record what a judgement decided: accepted or rejected, and why',
            needs: 'workspace',
            takes: ['ref', 'id', 'verdict', 'note'],
            run: async function (args) {
                var a = args || {};
                var it = await store.get(a.ref || a.id);
                var ref = it.ref || store.refOf(it.number);

                var said = String(a.verdict == null ? '' : a.verdict).trim().toLowerCase();
                if (store.VERDICTS.indexOf(said) < 0) {
                    throw new Error('A verdict is ' + store.VERDICTS.join(' or ') + '. "' + a.verdict
                        + '" is neither, and a judgement that cannot say which is one that has not been made.');
                }

                //A REJECTION SAYS WHY. Nothing is automatically re-run and
                //nothing is sent anywhere — a rejection is a RECORD, and what
                //happens to the work is a person's decision — so this note is
                //the whole of what survives it.
                var why = String(a.note == null ? '' : a.note).trim();
                if (said === 'rejected' && !why) {
                    throw new Error('Say why it was rejected. A rejection with no reason cannot be acted on by '
                        + 'anybody — and nothing is automatically re-run, so this note is the whole of what '
                        + 'survives.');
                }

                //WHAT IT WAS READ AGAINST, TAKEN NOW, FROM GIT. This is what
                //lets the reading go stale later: a judgement made before
                //another push is a judgement of something else.
                //
                //REFUSED WHEN THERE ARE NONE. An empty set of tips is not "no
                //information" — it is a judgement that will read as current for
                //ever, which is the shape that lies.
                var tips = await tipsFor(it.subject);
                if (!Object.keys(tips).length) {
                    throw new Error('This host cannot see where ' + (it.subject && it.subject.name)
                        + ' is now, so a verdict could not record what it was made against — and would read as '
                        + 'current for ever. Nothing was filed. Check the branch still exists across the '
                        + 'repositories it was cut in.');
                }

                var decided = await store.update(it.uid || it.ref, {
                    state: 'done',
                    verdict: said,
                    note: why || null,
                    tips: tips,
                    decided: new Date().toISOString()
                });

                log.on('judging', it.id)[said === 'accepted' ? 'good' : 'warn'](
                    ref + ' ' + said + ' — ' + (it.subject && it.subject.name)
                );

                //NO SECOND COPY FILED AGAINST THE CUT. The app being ported from
                //writes the verdict onto a cut record as well, because its gate
                //read that file; ./gate.js reads the judgements themselves, by
                //subject, so a second copy here would be a second answer to one
                //question — and the two would drift.
                return Object.assign({}, decided, {
                    note: 'Recorded against ' + (it.subject && it.subject.name) + '. It stops describing what '
                        + 'is there the moment anything is pushed to it. Nothing is re-run and nothing is sent '
                        + 'anywhere — what happens to the work is a person\'s decision.'
                });
            }
        }));

        //WHAT A JUDGEMENT IS READING, as opposed to how it ended. Named here
        //because the refusal below is about this list and nothing else reads it.
        var READING = ['subject', 'job', 'kind', 'branch', 'source', 'target', 'on', 'number',
            'sha', 'question', 'tag', 'remembers', 'by'];

        //AND CHANGING ONE THAT HAS NOT GONE OUT.
        //
        //WHAT IT IS READING MAY NOT MOVE WHILE IT READS. Changing the subject or
        //the job under a machine makes the record describe something that did
        //not happen. HOW IT ENDED still may: a judgement whose app was
        //restarted mid-run sits in `given` for ever otherwise — the queue only
        //looks at `queued`, and the one door that could record it would refuse
        //because it was in the state that needed recording. A state nothing can
        //leave is a state nothing should be able to enter.
        //---- CHANGING ONE AND THROWING ONE AWAY LIVE IN ../queue ------------
        //
        //`judgementUpdate` AND `judgementRemove` WERE HERE, beside the two that
        //moved before them. Changing a piece of work and throwing it away are
        //the same acts the task half of the board has had all along, and having
        //them twice meant two places deciding when work may be edited.
        //
        //THE RULES ABOUT THE RECORD ITSELF STAY IN ./store.js, which is the
        //split this plugin already stated: the refusal for a judgement out on a
        //machine is a rule about the record; which table offers the act is not.

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
