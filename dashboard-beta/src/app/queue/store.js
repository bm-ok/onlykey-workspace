//---------------------------------------------------------------------------
//WHAT WAS ASKED, WHO IT WENT TO, AND WHAT A HUMAN DECIDED.
//
//That is the whole of what a task record holds, and the boundary is the point:
//`working` and `delivered` are DERIVED and never stored. A run's outcome and a
//branch's contents are facts elsewhere, and copying them here is how two answers
//to one question start disagreeing — with the copy winning, because the copy is
//the one on the board.
//
//PER WORKSPACE, because a task delivers to a branch in one set of repositories.
//Kept in one place, switching workspace would leave the board listing work
//against branches that do not exist here — and worse, a task could be given to a
//machine on a branch name that means something else in the folder now being
//served.
//
//---- why the RECORD lives with the queue -----------------------------------
//
//A work item's EXISTENCE AND POSITION belong here — written, queued, forgotten —
//and its EXECUTION belongs to the worker: the harness, the session, what it
//delivered. That is the line, and it is drawn by something harder than taste.
//
//The worker consumes the queue as a service. If the door that writes a task
//lived over there and this store lived with it, the queue would have to consume
//the worker to queue anything — and the plugin graph would not build at all,
//because each would be waiting on the other. A cycle is not a style problem; it
//is an app that does not start.
//
//SO THE TWO HALVES MEET AT ONE POINT, where a work item is GIVEN to a machine,
//and everything flows one way across it.
//
//---- it is not wired to the action table, and that is deliberate -----------
//
//Nothing here is reachable as an action yet. The app being ported from still
//owns the queue and is still the thing that RUNS work, so a second store filled
//in beside it would diverge the moment anything ran — two boards, both
//confident, disagreeing about how far along the same task is.
//
//So this is built and proven first and connected last, the same way the queue's
//policy was: the rules are testable without the machinery, and the cut-over is
//one act at a moment somebody picks.
//---------------------------------------------------------------------------

//THE STATES A TASK IS PUT INTO, and the one thing each means.
//
//`done` MEANS THE RUN ENDED. Not that it worked, and not that anybody has
//looked at it — it is the difference between a task still in flight and one
//waiting for a verdict. Without it a finished task sits in `given` for ever, the
//queue picks it up again on every restart, puts its machine away again, and
//reports the same completion as though it had just happened.
//`failed` MEANS IT NEVER RAN, which is not the same as ending with nothing to
//say. A dispatch that dies before the job starts — no script, no machine, a
//refusal on the way out — read as `done` here, so "the job's file is missing"
//and "a judge read the change and would not commit" were the same word, and the
//record said the second one. ../queue/server.js has counted `failed` as an
//ended state since before anything could store it.
//
//IT IS ENDED, NOT WAITING. Sending it back to `queued` would have the queue
//claim a machine, fail the same way and try again every fifteen seconds — the
//loop the note in ./tick.js is written against. A person re-queues it once the
//reason is gone.
var STORED = ['draft', 'queued', 'given', 'done', 'accepted', 'rejected', 'failed'];

//WHO DOES THE WORK — a slot with three implementations, not a special case.
//
//    claude   a worker session in the machine, given the brief as a prompt
//    shell    the brief is a SHELL COMMAND, not a prompt. For work that is about
//             this machinery rather than about anything a worker would do: a
//             soak that has to last a stated length of time, a drill that needs
//             a run to exist. Involving a worker in those makes the answer
//             depend on whether it felt like taking an hour, and bills somebody
//             for the privilege
//    person   somebody works it by hand, in an editor, in the machine
//
//THE THIRD IS WHY THIS IS A SLOT AND NOT THE BOOLEAN IT WAS. Work done by hand
//used to happen OUTSIDE all of this — a machine borrowed, an editor opened, and
//no task, no brief, no attempts, no verdict and no record that any of it
//happened. The chain is the same either way:
//
//    branch <- task <- claude <- supervisor
//    branch <- task <- person <- supervisor
//
//What differs is one step: how the work is started, and how it is known to be
//finished. Everything on both sides of that — the branch, the contract, the
//artifacts, the verdict — is identical, and treating the human path as a
//different kind of thing is what kept it off the board.
var WORKERS = ['claude', 'shell', 'person'];

//TIME-ORDERED AND UNIQUE, without pulling in a dependency for it. Sorting by uid
//therefore sorts by creation, which makes a directory of kept logs read in the
//order the work happened.
var counter = 0;
//THE ISSUE A TASK IS FOR, or null. `on` must be owner/name and `number` a
//positive integer; anything else is not an issue and is not kept.
function issueOf(x) {
    if (!x || typeof x !== 'object') return null;
    var on = String(x.on == null ? '' : x.on).trim();
    var n = Number(x.number);
    if (on.split('/').length !== 2 || !on.split('/')[0] || !on.split('/')[1]) return null;
    if (!(n > 0) || n !== Math.floor(n)) return null;
    return { on: on, number: n };
}

function makeUid() {
    counter = (counter + 1) % 0x10000;
    return Date.now().toString(36)
        + counter.toString(36).padStart(3, '0')
        + Math.floor(Math.random() * 0x1000).toString(36).padStart(3, '0');
}

//---- three identities, and they are for three readers ----------------------
//
//`number` counts from 1 and NEVER REPEATS — not even after the task that held it
//is deleted. It is what a person says out loud: "what happened to 3". Short
//enough to type, ordered, and it says how many pieces of work there have been,
//which a name cannot.
//
//`uid` is the durable one. It is what anything STORED points at — the kept logs
//in particular — because a title can be edited and a slug derived from it would
//then point somewhere else, silently orphaning everything filed under the old
//one. A number cannot serve either: numbers are unique within one workspace's
//board, and that board can be deleted and rebuilt.
//
//`id` is the slug, kept because it is what makes a command line readable. All
//three resolve to the same task.
module.exports = function makeTasks(docs, log) {
    //`docs` HANDS BACK THE TWO DOCUMENTS. Taken as an argument rather than
    //reached for, so this file can be asked a question about a board somebody
    //wrote down — which is the whole reason the queue's decisions were split out
    //the same way.
    function board() { return docs.tasks(); }

    //THE HIGHEST NUMBER EVER USED, KEPT OUTSIDE THE LIST OF TASKS.
    //
    //Counting from the tasks that exist looked right and was not: remove the
    //highest-numbered task and the next one written takes its number back. That
    //happened — #11 was removed, and the next task became #11 — which quietly
    //makes a number ambiguous in exactly the places numbers get used: a commit
    //message, a note, somebody saying "what happened to eleven".
    //
    //A number is meant to be the one identity a person can say out loud, so it
    //has to survive the record it was issued against being thrown away. This
    //document is the only thing that remembers deleted tasks, which is precisely
    //its job.
    async function highest() {
        var kept = 0;
        try { kept = Number(((await docs.counter()).read({}) || {}).highest) || 0; } catch (e) { /* first run */ }
        //NEVER BELOW WHAT IS ON THE BOARD: the counter can be deleted, and a
        //board that survived it must not start handing out numbers already in
        //use.
        var here = (await read()).map(function (t) { return Number(t.number) || 0; });
        return Math.max.apply(null, [kept, 0].concat(here));
    }

    async function claimNumber() {
        var next = (await highest()) + 1;
        try { (await docs.counter()).write({ highest: next, at: new Date().toISOString() }); }
        catch (e) { /* the number is right for this call; it is only not remembered */ }
        return next;
    }

    //FILLED IN FOR ANYTHING WRITTEN BEFORE THESE EXISTED, once, on the next
    //read. A task record that predates a field is not a broken record — it is a
    //record from before, and refusing to read it would throw away the history
    //this is for. The uid of an older task is its slug, which is exactly right:
    //that is what its kept logs are already filed under, so migrating does not
    //orphan them.
    function withIds(list) {
        var changed = false;
        var next = Math.max.apply(null, [0].concat(list.map(function (t) { return Number(t.number) || 0; })));
        var done = list.map(function (t) {
            if (t.number && t.uid && t.worker) return t;
            changed = true;
            next = t.number ? next : next + 1;
            return Object.assign({}, t, {
                number: t.number || next,
                uid: t.uid || t.id,
                //WHO DID IT, for tasks written before that was a question
                //anybody asked. Derivable rather than unknown: a task with
                //`shell` set was run by a script and everything else was run by
                //a worker, which is exactly what the boolean meant.
                worker: t.worker || (t.shell ? 'shell' : 'claude')
            });
        });
        return { list: done, changed: changed };
    }

    //TOLERANT IN THE SAME WAY AS THE MACHINE REGISTRY: a byte-order mark, or one
    //entry saved as an object rather than a list. Neither should empty the board
    //and make it look as though no work was ever written down.
    async function read() {
        var doc;
        try { doc = await board(); }
        catch (e) {
            //NO WORKSPACE IS NOT AN EMPTY BOARD, and this used to answer as
            //though it were. ../queue/server.js writes the rule out in full
            //where it refuses a judgement for the right reason: "nothing to ask"
            //and "nothing there" are different answers and only one of them is
            //true. An empty list here is read by a pane as "no work has been
            //written down", which is a claim about a folder nobody has opened.
            throw new Error('No workspace is open, so there is no board to read. '
                + 'Work is written down against a folder of repositories — open one, '
                + 'and what was queued there is still queued. (' + e.message + ')');
        }
        if (!doc) return [];

        var raw;
        try { raw = doc.read([]); }
        catch (e) {
            if (log) log.bad('the task board could not be read (' + e.message + '). No task is listed until it is fixed or deleted.');
            return [];
        }
        if (raw == null) return [];

        var got = withIds(Array.isArray(raw) ? raw : [raw]);
        if (got.changed) { try { doc.write(got.list); } catch (e) { /* readable either way; only not kept */ } }
        return got.list;
    }

    async function write(list) { (await board()).write(list); }

    //ANY OF THE THREE, because a person types the number, a script keeps the
    //uid, and the slug is what reads well in a command. Refusing two of them
    //would mean remembering which one this particular call wanted.
    async function get(ref) {
        var want = String(ref == null ? '' : ref).trim();
        var bare = want.replace(/^#/, '');
        var task = (await read()).filter(function (t) {
            return t.id === want || t.uid === want || String(t.number) === bare;
        })[0];
        if (!task) {
            throw new Error('There is no task "' + ref + '". Ask for the board to see what there is — '
                + 'a number, a uid or a name all work.');
        }
        return task;
    }

    //READABLE AND SORTABLE, and typed back by a person rather than pasted. The
    //suffix keeps two written in the same second apart without making it a uuid.
    async function newId(title) {
        var slug = String(title || 'task').toLowerCase()
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'task';
        var taken = {};
        (await read()).forEach(function (t) { taken[t.id] = true; });
        if (!taken[slug]) return slug;
        for (var n = 2; ; n++) if (!taken[slug + '-' + n]) return slug + '-' + n;
    }

    async function add(input) {
        var it = input || {};
        var title = String(it.title || '').trim();
        if (!title) throw new Error('Give the task a title, so the board is readable at a glance.');
        var brief = String(it.brief || '').trim();
        if (!brief) throw new Error('Say what the work is. The brief is what the worker is actually told.');
        var branch = String(it.branch || '').trim();
        if (!branch) {
            throw new Error('Name the branch this task delivers on. That branch is the artifact, and a task with '
                + 'nowhere to deliver cannot be judged.');
        }

        //AND ONE TAG A TASK MAY NOT ASK FOR. A supervisor machine is out of the
        //pool for good, so a task asking for one is a task that waits for ever
        //while the board says it is queued. Refused where it is written rather
        //than left to be discovered as silence.
        //
        //THE WORD, NOT THE CONSTANT, and deliberately. Importing it from the
        //queue would make the task store depend on the queue — the two halves of
        //this app meet at ONE point, where a task is GIVEN to a machine, and
        //this is not that point. A literal that can never change is the cheaper
        //of the two prices.
        var tag = String(it.tag || '').trim().toLowerCase() || null;
        if (tag === 'supervisor') {
            throw new Error('A task cannot ask for a machine tagged "supervisor". Those are out of the pool for '
                + 'good — a supervisor decides what work to give and is never given any — so this task would sit '
                + 'queued for ever waiting for one.');
        }

        var who = WORKERS.indexOf(it.worker) >= 0 ? it.worker : (it.shell ? 'shell' : 'claude');
        var now = new Date().toISOString();

        var task = {
            id: await newId(title),
            //FROM THE HIGH-WATER MARK, NOT FROM THE BOARD. Throwing the highest
            //task away must not hand its number back — two pieces of work
            //sharing a number is the one thing a number exists to prevent.
            number: await claimNumber(),
            uid: makeUid(),
            title: title,
            brief: brief,
            branch: branch,

            //A PATH ON THIS HOST, read at dispatch and carried with the run, so
            //the rules that governed a run sit beside it — and so editing that
            //file later cannot change what a finished run was told.
            contract: it.contract ? String(it.contract) : null,

            //THE RULES THEMSELVES, COPIED IN. Every arrow carries a copy rather
            //than a name. A path can be edited afterwards and a library entry can
            //be rewritten, and either would silently change what a finished task
            //appears to have been held to — which is the one question a task
            //record exists to answer months later. The name is kept beside them
            //only so the board can say which contract this was; nothing reads it
            //to find the rules.
            rules: it.rules ? String(it.rules) : null,
            contractId: it.contractId ? String(it.contractId) : null,
            contractName: it.contractName ? String(it.contractName) : null,

            //WHICH PROMPT THE BRIEF CAME FROM. The words are copied into `brief`
            //and that is what the worker gets — but the tie was thrown away, so
            //a task could not say where its brief came from and the library
            //could not say what had been written from it.
            promptId: it.promptId ? String(it.promptId) : null,
            promptName: it.promptName ? String(it.promptName) : null,

            //WHETHER A WORKER ACTUALLY RAN, as opposed to what this task was
            //written to be done by. `worker` is the plan and is set before
            //anything has happened; this is set when something has.
            usedClaude: false,
            folder: it.folder ? String(it.folder) : null,

            //WHICH JUDGEMENT ESTABLISHED THIS WORK IS REAL, for a task written
            //over the wire. A supervisor cannot see the code, so every task it
            //writes comes from what a judge found — and "why was this done" is
            //then answerable six weeks later by reading that judgement rather
            //than by asking whoever was supervising. Null for a task a person
            //wrote: they had their own reasons and are not asked to file them.
            becauseOf: it.becauseOf ? String(it.becauseOf) : null,
            becauseOfId: it.becauseOfId ? String(it.becauseOfId) : null,

            //WHICH GITHUB ISSUE THIS WORK IS FOR, when it is for one. `{on,
            //number}`, `on` being owner/name as GitHub spells it. A fact rather
            //than a sentence in the brief, because things downstream act on it:
            //the branch cut records it and the pull request says "Closes" from
            //it, which is how the issue closes on merge with nobody here
            //pressing anything. Null for work that came from nowhere in
            //particular, which is most of it.
            //
            //VALIDATED RATHER THAN TRUSTED. A malformed one is dropped to null
            //here, at the one place it enters, so nothing later has to defend
            //against `{on: 'x'}` reaching a pull request body.
            issue: issueOf(it.issue),

            worker: who,

            //WHICH JOB IS TO RUN IT, if one is. Most tasks have none: the queue
            //dispatches a worker with the brief and that is the ordinary path. A
            //job is for when the doing is itself a script — and it is the id
            //rather than the script, for the same reason the brief is a copy.
            job: String(it.job || '').trim() || null,
            jobName: it.jobName ? String(it.jobName) : null,

            //KEPT BECAUSE A GREAT DEAL READS IT, and derived so the two cannot
            //disagree.
            shell: who === 'shell',

            //HOW LONG THE QUEUE WAITS BEFORE GIVING UP, in hours. Six unless the
            //task says otherwise — enough for anything somebody is expecting
            //back today, and not enough for a soak left running overnight, which
            //would otherwise be abandoned at hour six while still working
            //perfectly and have its machine put away underneath it.
            hours: Number(it.hours) > 0 ? Number(it.hours) : null,

            //WHICH MACHINES THIS WILL RUN ON, or none for any of them. A task
            //does not name a machine — the queue decides that, and a task tied to
            //one machine waits for it while three others sit idle. But it may
            //name a KIND. Lower-cased on the way in, because a tag that depends
            //on how somebody typed it is a tag that silently matches nothing.
            tag: tag,

            state: 'draft',
            machine: null,
            //THE LAST RUN, kept for the things that only care about the latest.
            run: null,
            session: null,

            //EVERY TIME THIS WAS GIVEN OUT, oldest first.
            //
            //A single `run` field was the first shape and it lost the history the
            //moment a task was given out twice — which is the ordinary case, not
            //an edge one: a rejection sent back is a second attempt at the same
            //task, and overwriting the first makes the record say the task was
            //done once and cleanly. What actually happened to a piece of work is
            //most of what a reviewer wants, and it is the part nothing else keeps.
            attempts: [],
            verdict: null,
            created: now,
            updated: now
        };

        var existing = await read();
        await write(existing.concat([task]));
        if (log) log.good('#' + task.number + ' "' + title + '" written, delivering on ' + branch);
        return task;
    }

    async function update(ref, changes) {
        //RESOLVED THE SAME WAY EVERYWHERE, so a number works here exactly as it
        //works for reading. Two lookup rules for one kind of thing is how "no
        //task called 3" starts being an answer somebody has to interpret.
        var found = await get(ref);
        var list = await read();
        var i = list.map(function (t) { return t.uid; }).indexOf(found.uid);

        var c = changes || {};
        if (c.state && STORED.indexOf(c.state) < 0) {
            throw new Error('"' + c.state + '" is not a state a task is put into. Working and delivered are read '
                + 'from the run and the branch, not set.');
        }

        //THE IDENTITIES ARE PINNED RATHER THAN MERGED: a caller passing a whole
        //task object back would otherwise be able to renumber it, or hand it
        //another task's uid, and the kept logs would follow.
        list[i] = Object.assign({}, list[i], c, {
            id: found.id, uid: found.uid, number: found.number,
            updated: new Date().toISOString()
        });
        await write(list);
        return list[i];
    }

    async function remove(ref) {
        var task = await get(ref);
        var list = (await read()).filter(function (t) { return t.uid !== task.uid; });
        await write(list);
        if (log) log.good('#' + task.number + ' removed');
        //SAID RATHER THAN DONE, and true of two things. Deleting the branch would
        //destroy the artifact, which is the one thing here nobody can rewrite.
        //The kept logs are left for the same reason: they are the account of what
        //happened, filed under a uid that is not reused, so throwing away the
        //note about the work does not throw away the evidence of it.
        return {
            removed: task.id,
            number: task.number,
            note: 'The branch "' + task.branch + '" and the logs kept for it are untouched. Removing a task '
                + 'throws away what was asked, not what came back.'
        };
    }

    //WHAT A MACHINE IS TOLD IT IS FOR, and it is a NOTE, not the task.
    //
    //FOUR FIELDS AND NO MORE. The temptation is to write the task down there so
    //nothing has to be looked up, and that is how a guest ends up holding the
    //brief, the contract text and whatever else a task grew — on the machine the
    //contract is meant to bind. Identity is enough; the task itself is read here.
    //
    //THE BRANCH RIDES ALONG SO THE NOTE CAN BE CHECKED RATHER THAN BELIEVED: a
    //machine reverted and set up on something else has a note that no longer
    //matches what it is on, and that mismatch is the whole safety of trusting it.
    function noteFor(task) {
        return { id: task.id, number: task.number, uid: task.uid, branch: task.branch };
    }

    return {
        read: read, write: write, get: get, add: add, update: update, remove: remove,
        newId: newId, highest: highest, noteFor: noteFor,
        STORED: STORED, WORKERS: WORKERS
    };
};
