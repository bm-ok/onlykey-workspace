var crypto = require('crypto');

//---------------------------------------------------------------------------
//A JUDGEMENT, AS A PIECE OF WORK.
//
//Not a field on the thing being judged. A judgement gets a machine, a run, a job
//that says how it is done and a contract that says what it may not do —
//everything a task gets — because "why was this accepted" has to be answerable
//six weeks later by something other than asking whoever typed it.
//
//WHAT IT IS ABOUT IS NEVER A TASK. Writing a verdict onto the task that produced
//the work is the wrong subject twice over: a change may come from more than one
//task, and a task may deliver nothing worth reading. Judging follows the CHANGE.
//
//    a branch cut   the work as it stands across the repositories
//    a PR cut       the change as it is proposed for landing, one pull request
//                   per repository, taken as one act
//    a pull         somebody else's change, proposed into a repository here
//
//AND IT TAKES NO BRANCH OF ITS OWN, which follows from reading rather than
//writing. A judgement claiming a branch would hold a machine on it for no
//reason, and there would be two things with a claim on one branch.
//
//WHAT IT IS FOR: did the work follow the rules, is it secure, and are there bugs
//nobody caught. That is a different question from "did it do what was asked",
//which is what the work's own contract was about — which is why judging has its
//own job, prompt and contract rather than re-reading the task's.
//
//---- where this sits, and why it is not in ../queue ------------------------
//
//../queue IS TASK MANAGEMENT AND THIS IS NOT A TASK. What the queue owns is the
//running of work: what is waiting, what goes next, what a run left behind. A
//judgement is a piece of work the queue can carry — `kind: 'judgement'` in
//../queue/policy.js already — and this is the record of what was asked for and
//what came back.
//
//THE JUDGE IS A SET OF JOBS, PROMPTS AND CONTRACTS, exactly as the worker is,
//and what it does with them is ask the queue for work. So the shape is the same
//as ../queue/store.js on purpose: a plain module taking its documents as an
//argument, so the rules are testable without a plugin graph, a workspace or a
//machine.
//
//---- two stores, on purpose ------------------------------------------------
//
//THIS HOLDS THE WORK — waiting, running, decided. The verdict it reaches is
//appended to the record kept against a cut, over in ../repositories, which knows
//when an opinion has gone stale because the code moved. One is a queue; the
//other is a record. Merging them makes a finished judgement indistinguishable
//from a queued one on a board built to show what is left.
//---------------------------------------------------------------------------

//`failed` IS NOT `done`. See ../queue/store.js: a run that never started — its
//job had no script, its machine would not take it — was filed as done, which
//here reads as "somebody looked and would not say". They are opposite answers.
var STATES = ['draft', 'queued', 'given', 'done', 'failed'];

//PENDING IS A VERDICT. A judge that read a change and could not settle it has
//reached a real conclusion — "I looked and I cannot say" — and it is different
//from having not looked. Without it an unsettled reading has to pretend to be
//one of the other two, or leave the field empty, which reads as unjudged.
var VERDICTS = ['accepted', 'rejected', 'pending'];

//J1, J2 — ITS OWN SEQUENCE, AND ITS OWN PREFIX.
//
//A judgement and a task can both be number 4, and they share one queue and one
//board. So what a row shows is not a bare number: the label is part of the
//record, and nothing drawing it has to know this convention to get it right.
function refOf(number) { return 'J' + number; }

//---- what a judgement is about ---------------------------------------------
//
//TWO SHAPES, ONE FUNCTION, because every caller wants the same three answers:
//what kind, what to call it, and the key it is filed under. A PR cut is
//`source -> target`, which is the key the verdict record already uses — so a
//verdict reaching the cut needs no translation and cannot land under a name that
//is nearly right.
function subjectFrom(input) {
    var it = input || {};
    var kind = String(it.kind || (it.target ? 'cut' : 'branch')).trim().toLowerCase();

    if (kind === 'cut') {
        var source = String(it.source || it.branch || '').trim();
        var target = String(it.target || '').trim();
        if (!source || !target) {
            throw new Error('A PR cut is a source line and a target — say both, exactly as the cuts are listed. '
                + 'Without the target this would be filed under a cut that does not exist.');
        }
        return { kind: 'cut', source: source, target: target, name: source + ' -> ' + target };
    }

    if (kind === 'branch') {
        var branch = String(it.branch || it.source || '').trim();
        if (!branch) throw new Error('Name the branch cut to be read.');
        return { kind: 'branch', branch: branch, name: branch };
    }

    //A PULL REQUEST THAT ARRIVED, which is the one kind this app does not own.
    //
    //The other two are its own work: a branch cut here, or a cut this host sent
    //out. This is somebody else's change, proposed into a repository this
    //workspace holds — and it is a different KIND rather than a variation,
    //because everything downstream treats it differently: it may not be read at
    //all until a person has allowed it, the allowance is against a COMMIT, and
    //what comes back is reported to the author rather than only kept here.
    //
    //THE SHA IS PART OF THE SUBJECT, not a detail beside it. A pull request is a
    //moving target: its author can push while a judge is reading. A judgement
    //recording only the number would be a verdict about "whatever #7 was at some
    //point", which is the shape that lies — so the commit is in the subject, in
    //the name, and in the record.
    if (kind === 'pull') {
        var on = String(it.on || '').trim();
        var number = Number(it.number);
        var sha = String(it.sha || '').trim();
        if (!on || !number) {
            throw new Error('A pull request is named by the repository it is on and its number — "on" as '
                + 'owner/name, and "number". Without both this would be filed against a change nobody can find.');
        }
        if (!sha) {
            throw new Error('Say which commit the pull request is at. A judgement of a pull request without the '
                + 'commit it read is a verdict about whatever that pull request happened to be, which is worth '
                + 'nothing the moment the author pushes.');
        }
        return { kind: 'pull', on: on, number: number, sha: sha, name: on + '#' + number + '@' + sha.slice(0, 7) };
    }

    throw new Error('"' + kind + '" is not something this app knows how to judge. A judgement reads a "branch" '
        + '— the work as it stands — a "cut", the change as it is proposed for landing, or a "pull", somebody '
        + 'else\'s change proposed into a repository here.');
}

module.exports = function judgements(docs, log) {
    var say = (log && log.on) ? log.on('judge') : (log || {
        good: function () {}, warn: function () {}, bad: function () {}, info: function () {}
    });

    function board() { return docs.judging(); }

    async function read() {
        var doc;
        try { doc = await board(); }
        catch (e) { return []; }
        if (!doc) return [];
        var list = doc.read([]);
        return Array.isArray(list) ? list : [];
    }

    async function write(list) {
        var doc = await board();
        doc.write(list);
        return list;
    }

    //THE HIGHEST NUMBER EVER USED, KEPT OUTSIDE THE LIST.
    //
    //Counting from what exists looks right and is not: remove the
    //highest-numbered judgement and the next one written takes its number back,
    //which makes a number ambiguous in exactly the places numbers get used — a
    //commit message, a note, somebody asking what happened to J11. The same
    //high-water mark a task number uses, for the same reason, and ../queue/store.js
    //carries the scar of learning it.
    async function highest() {
        var kept = 0;
        try { kept = Number(((await docs.counter()).read({}) || {}).highest) || 0; } catch (e) { /* first run */ }
        //NEVER BELOW WHAT IS ON THE BOARD: the counter can be deleted, and a
        //board that survived it must not start handing out numbers already used.
        var here = (await read()).map(function (j) { return Number(j.number) || 0; });
        return Math.max.apply(null, [kept, 0].concat(here));
    }

    async function claimNumber() {
        var next = (await highest()) + 1;
        try { (await docs.counter()).write({ highest: next, at: new Date().toISOString() }); }
        catch (e) { /* the number is right for this call; it is only not remembered */ }
        return next;
    }

    var uid = function () {
        return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
    };

    function newId(subject, taken) {
        var base = ('judge-' + subject.name).toLowerCase()
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'judge';
        if (!taken[base]) return base;
        for (var n = 2; ; n++) if (!taken[base + '-' + n]) return base + '-' + n;
    }

    //---- what is here ------------------------------------------------------

    async function all() {
        return (await read()).map(function (j) {
            return Object.assign({}, j, { ref: refOf(j.number) });
        });
    }

    //BY NUMBER, REF OR ID, because a person says "J3", a script keeps the uid,
    //and the id is what reads well in a command.
    async function get(ref) {
        var want = String(ref == null ? '' : ref).trim();
        var bare = want.replace(/^[#J]/i, '');
        var found = (await read()).filter(function (j) {
            return j.id === want || j.uid === want || String(j.number) === bare;
        })[0];
        if (!found) {
            throw new Error('There is no judgement "' + ref + '". Ask for the list to see what there is — a '
                + 'number like J3, a uid or a name all work.');
        }
        return Object.assign({}, found, { ref: refOf(found.number) });
    }

    async function add(input) {
        var it = input || {};
        var subject = subjectFrom(it.subject || it);
        var list = await read();

        //ONE OPEN JUDGEMENT PER SUBJECT. A second one queued against the same
        //change is two machines reading the same thing to reach two verdicts,
        //and the board then has to explain which is the answer. Re-judging AFTER
        //one is decided is the case that matters and is allowed — that is the
        //sequence the record is built for.
        var already = list.filter(function (j) {
            return j.subject && j.subject.name === subject.name && j.state !== 'done';
        })[0];
        if (already) {
            throw new Error(refOf(already.number) + ' is already reading ' + subject.name + ' and has not '
                + 'finished. Wait for it, or remove it — two judgements of one change at once is two answers '
                + 'to one question.');
        }

        var taken = list.reduce(function (n, j) { n[j.id] = true; return n; }, {});

        var made = {
            id: newId(subject, taken),
            number: await claimNumber(),
            uid: uid(),
            subject: subject,

            //WHAT IT IS CALLED ON A BOARD. Derived rather than typed: a
            //judgement is always "read this", and asking for a title would
            //produce a list of sentences that all say the same thing.
            title: 'judge ' + subject.name,
            written: new Date().toISOString(),

            //THE CHAIN, AND EVERY ARROW CARRIES A COPY. Same rule as a task: the
            //words and the rules are copied in, never referenced, because a
            //library entry rewritten later would silently change what a finished
            //judgement appears to have been held to.
            job: it.job ? String(it.job) : null,
            brief: it.brief ? String(it.brief) : null,
            //THE PARTICULAR THING IT WAS ASKED, kept beside the brief that
            //carries it. The brief has it appended already — this is so a board
            //can show what was asked without printing the whole approved prompt.
            question: it.question ? String(it.question) : null,
            promptId: it.promptId ? String(it.promptId) : null,
            promptName: it.promptName ? String(it.promptName) : null,
            rules: it.rules ? String(it.rules) : null,
            contractId: it.contractId ? String(it.contractId) : null,
            contractName: it.contractName ? String(it.contractName) : null,

            //WHO READS IT. A person and a worker are the same act with a
            //different body: a person's judgement is a judgement with no run,
            //which is why this is a field rather than two kinds of record.
            by: it.by === 'person' ? 'person' : 'worker',

            //WHICH MACHINES IT WILL ACCEPT, exactly as a task does. Judging the
            //test pool's work on the test pool's machines is the ordinary reason.
            tag: it.tag ? String(it.tag) : null,

            //WHETHER THIS READING CARRIES ON FROM THE LAST ONE OF THE SAME
            //SUBJECT. Asked per judgement rather than set once, because it is a
            //trade somebody makes knowingly: a judge that remembers can say what
            //was fixed since, and has already formed a view it tends to keep
            //confirming.
            //
            //KEPT ON THE RECORD, so what was asked for is part of what happened
            //rather than a setting that may have moved since.
            remembers: it.remembers === true || it.remembers === 'true',

            state: 'draft',
            machine: null,
            attempts: [],

            //FILLED WHEN IT FINISHES. `tips` is what each repository was at when
            //it was read, which is what lets the verdict say later whether it
            //still describes what is there.
            verdict: null,
            note: null,
            tips: null,
            decided: null
        };

        await write(list.concat([made]));
        say.good(refOf(made.number) + ' written — ' + subject.name);
        return await get(made.id);
    }

    async function update(ref, patch) {
        var found = await get(ref);
        var p = patch || {};

        if (p.state && STATES.indexOf(p.state) < 0) {
            throw new Error('"' + p.state + '" is not a state a judgement can be in. They are: '
                + STATES.join(', ') + '.');
        }
        if (p.verdict && VERDICTS.indexOf(p.verdict) < 0) {
            throw new Error('"' + p.verdict + '" is not a verdict. It is ' + VERDICTS.join(' or ')
                + ' — a judgement that cannot say which is a judgement that has not been made.');
        }

        var list = (await read()).map(function (j) {
            return j.uid === found.uid
                ? Object.assign({}, j, p, { touched: new Date().toISOString() })
                : j;
        });
        await write(list);
        return await get(found.uid);
    }

    async function remove(ref) {
        var found = await get(ref);

        //OUT ON A MACHINE IS NOT A RECORD TO THROW AWAY. Removing it here leaves
        //a machine reading something nothing on this host is waiting for.
        if (found.state === 'given') {
            throw new Error(found.ref + ' is out on ' + (found.machine || 'a machine') + ' right now. Removing '
                + 'it here would leave a machine reading something nothing on this host is waiting for.');
        }

        await write((await read()).filter(function (j) { return j.uid !== found.uid; }));
        say.good(found.ref + ' thrown away');
        return { removed: found.ref, of: found.subject.name };
    }

    return {
        all: all, get: get, add: add, update: update, remove: remove,
        read: read, write: write,
        subjectFrom: subjectFrom, refOf: refOf,
        highest: highest,
        STATES: STATES, VERDICTS: VERDICTS
    };
};

module.exports.STATES = STATES;
module.exports.VERDICTS = VERDICTS;
module.exports.refOf = refOf;
module.exports.subjectFrom = subjectFrom;
