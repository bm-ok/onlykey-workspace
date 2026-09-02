//---------------------------------------------------------------------------
//WRITING A WORK ITEM DOWN, PUTTING IT IN THE QUEUE, AND THROWING IT AWAY.
//
//The three acts that decide whether a piece of work EXISTS and whether it is
//waiting. What running it looks like is the worker's, over in ../worker — see
//the note in ./store.js for why the record lives on this side of that line.
//
//EVERY GATE HERE IS ABOUT SOMETHING THAT COSTS A MACHINE. A task written against
//a branch nobody cut, or asking for a tag nothing carries, or naming a job that
//does not exist, is a task the queue picks up and fails on — twenty minutes of a
//machine booted, rolled back, handed a credential and pointed at nothing. The
//moment it is written is the cheap moment to find that out.
//
//AND ONE OF THEM IS ABOUT SOMETHING WORSE. See `becauseOf`.
//
//---- what it is given, rather than what it reaches for ---------------------
//
//Every lookup arrives as a function. That is not ceremony: these gates decide
//whether real work is created, and a gate that can only be exercised by creating
//real work is a gate nobody tests. It is the same arrangement as ./policy.js and
//for the same reason — the deciding is the part that goes wrong.
//---------------------------------------------------------------------------

module.exports = function doors(store, ask, log) {
    var say = log || { good: function () {}, warn: function () {}, bad: function () {}, info: function () {} };

    //---- the branch a task delivers on -------------------------------------
    //
    //TWO CHECKS, AND THEY FAIL FOR DIFFERENT REASONS. One is whether git will
    //accept the name at all; the other is whether anybody has cut it. A task
    //delivers on a branch, and one nobody has cut is work with nowhere to land.
    async function branchIsReady(branch) {
        var name = String(branch || '').trim();
        if (!name) return 'A branch needs a name.';

        var ok = await ask.branchNameIsOk(name);
        if (ok) return ok;

        if (!(await ask.branchExists(name))) {
            //THE TAB IT NAMES HAS TO EXIST. This said "the Branches tab",
            //which is not in the row: it is Branches Cut, beside Branches
            //Lines. A sentence telling somebody where to go, to a place that
            //is not there, is worse than not saying — it reads as the app
            //being broken rather than as a step being missing.
            return 'There is no branch called "' + name + '" in this workspace. Cut it first, on '
                + 'Repositories → Branches Cut — a task delivers on a branch, and one nobody has cut '
                + 'is work with nowhere to land.';
        }
        return null;
    }

    //---- WHAT THE LIBRARY SAYS, COPIED IN ----------------------------------
    //
    //ONE FUNCTION, BECAUSE WRITING A TASK AND EDITING ONE ARE THE SAME ACT HERE.
    //
    //The app being ported from had this in `taskCreate` and then again in
    //`taskUpdate`, and the second copy was written AFTER a run proved it was
    //missing: changing which contract a task ran under changed the NAME and left
    //the WORDS, so the board said one contract and the worker was held to
    //another — the exact failure the copying exists to prevent, arriving through
    //the one door that did not do it.
    //
    //A rule with two implementations has one that is wrong, and which one is
    //discovered by a machine.
    //
    //---- the rules are copied in, the same way the brief is ----------------
    //
    //`contractId` names one from the library and what gets STORED is its WORDS.
    //Every arrow carries a copy, and it is what makes a finished task readable: a
    //name proves nothing months later about what the worker was actually held to,
    //and the library it named has moved on since.
    //
    //BOTH AT ONCE IS REFUSED rather than silently preferring one — otherwise
    //which rules a run was under depends on which line of code read it first.
    //
    //---- and `in` rather than truthy, when editing ------------------------
    //
    //Most callers on that path are the queue and the panel sending a two-field
    //patch. Treating a MISSING key as "set it to none" would strip the rules off
    //every task the queue touched — so a key that is not there is not a change,
    //and a key that is there and empty is a removal.
    async function fromTheLibrary(it, how) {
        var o = how || {};
        var editing = o.when === 'editing';
        var said = editing ? 'putting a task under it' : 'writing a task under it';

        if (!editing || ('contractId' in it)) {
            var wanted = String(it.contractId || '').trim();

            if (wanted) {
                //WHEN EDITING, THE OTHER HALF MAY ALREADY BE ON THE RECORD. So
                //"both at once" asks what the task carries as well as what the
                //patch says — otherwise naming a library contract on a task that
                //already carries a file leaves both, which is the state this
                //refuses to create.
                var alsoAFile = editing
                    ? (it.contract || (!('contract' in it) && o.carries))
                    : it.contract;

                if (alsoAFile) {
                    throw new Error('Give it either a contract from the library or a file on this host, not both — '
                        + 'otherwise which rules a run was under depends on which line of code read it first.');
                }

                var one = await ask.contract(wanted);
                if (!one) throw new Error('There is no contract called "' + wanted + '".');
                if (!one.approved) {
                    throw new Error(one.lapsed
                        ? 'The contract "' + one.name + '" has been edited since it was approved. Read it and '
                            + 'approve it again before ' + said + '.'
                        //WHAT A WORKER MAY NOT DO IS READ BEFORE IT IS SENT, the
                        //same as what it is told to do.
                        : 'The contract "' + one.name + '" is not approved. What a worker may not do is read '
                            + 'before it is sent, the same as what it is told to do.');
                }

                it.contractId = wanted;
                it.rules = one.text;
                it.contractName = one.name;
            } else if (editing) {
                //TAKEN OFF, AND TAKEN OFF COMPLETELY. Leaving the words behind
                //would read as "no contract" everywhere the id is checked and
                //"these rules" everywhere the text is, which is worse than
                //either.
                it.contractId = null;
                it.rules = null;
                it.contractName = null;
            } else if (it.contract) {
                if (!(await ask.contractFileExists(String(it.contract)))) {
                    throw new Error('There is no contract at ' + it.contract + '. It is read from this host when '
                        + 'the task is given out.');
                }
            }
        }

        //A TASK NAMING A JOB THAT DOES NOT EXIST is a task the queue will pick
        //up and fail on, and the moment it is written is the cheap moment to
        //find that out.
        if (editing ? ('job' in it) : !!it.job) {
            var named = String(it.job || '').trim();
            var job = named ? await ask.job(named) : null;

            if (named && !job) {
                throw new Error('There is no job called "' + named + '". Ask for "jobs" to see what there is.');
            }
            //AND IT IS A JOB FOR DOING WORK. The judging library is kept apart,
            //and the refusal runs in both directions: a judge given to a task
            //would send a machine to READ a change under rules written for
            //reading, on a branch it was told to deliver on.
            if (job && job.kind === 'judge') {
                throw new Error('"' + job.id + '" is a judge — it reads a change and says whether it holds. A task '
                    + 'makes one. Pick a job from the work library, or ask for a judgement instead with '
                    + 'judgementCreate.');
            }

            it.job = named || null;
            it.jobName = job ? job.name : null;
        }

        //THE PROMPT'S NAME TRAVELS WITH ITS ID for the same reason the contract's
        //words do: the library entry may be gone by the time anybody reads the
        //task, and the task should still be able to say where its brief came
        //from.
        if ('promptId' in it) {
            var whose = String(it.promptId || '').trim();
            var from = whose && ask.prompt ? await ask.prompt(whose) : null;
            if (whose && !from) throw new Error('There is no prompt called "' + whose + '".');

            it.promptId = whose || null;
            it.promptName = from ? from.name : null;
        }

        return it;
    }

    //=======================================================================
    //WRITE A TASK.
    //=======================================================================
    async function create(input, how) {
        var it = typeof input === 'string' ? JSON.parse(input) : input;
        if (!it || typeof it !== 'object') throw new Error('Pass the task as an object.');
        it = Object.assign({}, it);
        var over = !!(how && how.overTheWire);

        //---- THE JUDGE IS THE GATE BETWEEN A SUPERVISOR AND A TASK --------
        //
        //A supervisor cannot see the code. Everything it believes about this
        //codebase, a judge told it — so a task it writes on any other basis is
        //work commissioned from a rumour: an issue filed about a version that no
        //longer exists, a claim about a different project, its own recollection
        //of a finding from a fortnight ago.
        //
        //THE COST OF THAT IS NOT ABSTRACT. It is a machine booted, rolled back,
        //handed a credential and pointed at a branch for twenty minutes to fix
        //something that was never wrong — and then a second judgement to find
        //out that nothing was.
        //
        //SO WORK OVER THE WIRE NAMES THE JUDGEMENT THAT ESTABLISHED IT IS REAL,
        //and that judgement has to have FINISHED. A queued one has established
        //nothing yet.
        //
        //NOT AT THE WINDOW. A person writing a task has read the code, or has
        //decided they do not need to, and either is their business — the same
        //boundary as approving a job, which is refused down the pipe and
        //ordinary at the window.
        if (over) {
            var ref = String((how && how.becauseOf) || it.becauseOf || '').trim();
            if (!ref) {
                throw new Error('Say which judgement established this work is real — pass becauseOf with its ref, '
                    + 'like "J4". You cannot see the code, so a task written without one is work commissioned from '
                    + 'a rumour. Ask for a judgement first, read what it handed back, and write the task from that.');
            }
            var found = await ask.judgement(ref);
            if (!found) {
                throw new Error('There is no judgement "' + ref + '". Ask for "judging" to see what has been asked '
                    + 'for — becauseOf names the judgement whose findings this work comes from.');
            }
            if (found.state !== 'done') {
                throw new Error(found.ref + ' is "' + found.state + '" and has not finished reading yet, so it has '
                    + 'established nothing. Wait for it, read what it handed back with judgementFindings, and then '
                    + 'write the task.');
            }
            //KEPT ON THE TASK. Six weeks later "why was this done" is answerable
            //by reading the judgement it came from rather than by asking whoever
            //was supervising that afternoon.
            it.becauseOf = found.ref;
            it.becauseOfId = found.id;
        }

        //WHAT IS IMPOSSIBLE, BEFORE WHAT IS MERELY NOT READY YET.
        //
        //Checked here as well as in the store, and the reason is the ORDER a
        //person meets these in. The branch checks below are about the workspace
        //as it stands: cut the branch and the task is fine. This one is about
        //the task itself and is true whatever anybody cuts, so being told about
        //the branch first sends somebody off to fix something that was never the
        //problem. The store keeps its own copy as the backstop for every other
        //way a task can be written.
        if (String(it.tag || '').trim().toLowerCase() === 'supervisor') {
            throw new Error('A task cannot ask for a machine tagged "supervisor". Those are out of the pool for '
                + 'good — a supervisor decides what work to give and is never given any — so this task would sit '
                + 'queued for ever waiting for one.');
        }

        //---- CUTTING THE BRANCH IN THE SAME ACT --------------------------
        //
        //THE SUPERVISOR'S OWN SEQUENCE IS THREE CALLS and the first two are one
        //decision. Its skill says so in the order it gives them: `branchCreate`
        //to cut a branch from a line, `taskCreate` to write the work on it,
        //`taskQueue` to give it out. Nobody cuts a branch and then wonders what
        //to put on it — the work is why the branch exists.
        //
        //SO THE TWO ARE OFFERED AS ONE, HERE, WHICH IS THE ONLY PLACE THEY CAN
        //BE. Doing it in the pane would make it a thing a person can do and a
        //model cannot, and this app has already been bitten by a rule that lived
        //in a form: the cut-versus-line filter on Add task was the only thing
        //enforcing it, so it was enforced in the one place a supervisor never
        //goes. Whatever the window can do from Add task, this door can do.
        //
        //IT IS STILL TWO ACTS AND BOTH REFUSALS STILL APPLY. `branchCreate` owns
        //what a branch may be called and what it may be cut from, and it is
        //asked rather than reimplemented — a second opinion about a branch name
        //is the thing ../../repositories/branches exists to prevent.
        //
        //AN EXISTING BRANCH AND A LINE TO CUT FROM IS REFUSED rather than
        //resolved. "Cut it from `default`" and "it is already there" cannot both
        //be what somebody meant, and quietly taking the existing one would put
        //work on a branch cut from somewhere else entirely — which is the one
        //mistake this whole arrangement is arranged against.
        var cutFrom = String(it.cutFrom || '').trim();
        var why = String(it.reason || '').trim();
        //NEITHER IS PART OF WHAT A TASK CARRIES. They say how to make the branch,
        //not what the work is, so they never reach the store.
        delete it.cutFrom;
        delete it.reason;

        if (cutFrom) {
            if (!ask.cutBranch) {
                throw new Error('This host cannot cut a branch while writing a task. Cut it first with branchCreate '
                    + 'and then write the task on it.');
            }
            var wants = String(it.branch || '').trim();
            if (!wants) {
                throw new Error('Say what the new branch is called. "Cut it from ' + cutFrom + '" says where it '
                    + 'starts, not what it is.');
            }
            if (!why) {
                throw new Error('Say what "' + wants + '" is for. A branch with no reason on it is one nobody can '
                    + 'account for later — the same thing branchCreate asks for, asked here because this is where '
                    + 'the branch is being made.');
            }
            if (await ask.branchExists(wants)) {
                throw new Error('"' + wants + '" is already here, so it cannot also be cut from "' + cutFrom
                    + '". Write the task on it without naming a line to cut from, or pick a name nothing is using.');
            }

            //THE REAL DOOR, ASKED. Its refusals — a name git will not take, a
            //protected name, a line that names nothing still here — arrive
            //unchanged, because they are better than anything worth writing
            //again here.
            //THE ISSUE GOES WITH THE CUT. The branch is where the pull request
            //is later made from, and the cut note is the one record that
            //survives to that moment -- the task does not, and the line does
            //not carry extras. So it is handed over here, at the act of
            //cutting, or the PR can never say what it closes.
            await ask.cutBranch({ branch: wants, reason: why, from: cutFrom, issue: it.issue || null });
            say.good('cut "' + wants + '" from "' + cutFrom + '" to write a task on it');
        }

        var branchWhy = await branchIsReady(it.branch);
        if (branchWhy) throw new Error(branchWhy);

        await fromTheLibrary(it, { when: 'writing' });

        var made = await store.add(it);

        //A TAG NOTHING CARRIES IS WORK THAT WAITS FOR EVER, and the board shows
        //it as queued rather than as wrong. The queue waits by design — a tag
        //that quietly meant "prefer" would send work to the wrong machine on a
        //busy afternoon — so the place to notice a typo is here, where it was
        //written.
        //
        //SAID, NOT REFUSED. A machine can be tagged after the task is written,
        //and that is an ordinary way to work: write the task, then tag the
        //machine that will take it. What is not ordinary is not knowing.
        if (made.tag) {
            var carried = {};
            (await ask.machines()).forEach(function (vm) {
                ((vm && vm.tags) || []).forEach(function (t) { carried[String(t).toLowerCase()] = true; });
            });
            if (!carried[made.tag]) {
                var have = Object.keys(carried);
                made.warning = 'No machine carries the tag "' + made.tag + '", so this waits in the queue until one '
                    + 'does. What is there: ' + (have.length ? have.join(', ') : 'no tags at all') + '.';
                say.warn('#' + made.number + ' asks for a machine tagged "' + made.tag + '" and none carries it — it will wait');
            }
        }
        return made;
    }

    //=======================================================================
    //PUT IT IN THE QUEUE.
    //
    //Work waits for a machine; a machine does not wait for work. A queued task
    //names no machine — the first one that is free takes it, and which one did
    //the work is recorded afterwards rather than decided in advance.
    //=======================================================================
    async function queue(ref, plan) {
        var task = await store.get(ref);

        if (task.verdict) {
            throw new Error('#' + task.number + ' has already been judged. Write a new task rather than reopening '
                + 'a decided one.');
        }

        //REFUSED AT THE DOOR, NOT IGNORED INSIDE. The tick skips a person's task
        //anyway — but a task sitting queued that nothing will ever pick up looks
        //exactly like one that is merely waiting its turn, which is the whole
        //thing this door exists to avoid.
        if (task.worker === 'person') {
            throw new Error('#' + task.number + ' is written for a person — the queue would roll a machine back and '
                + 'run Claude over the top of it. Take it yourself, or write it for a worker instead.');
        }

        var branchWhy = await branchIsReady(task.branch);
        if (branchWhy) throw new Error(branchWhy);

        var queued = await store.update(task.id, { state: 'queued' });
        say.good('#' + task.number + ' queued');

        //SAID NOW RATHER THAN DISCOVERED IN FIFTEEN MINUTES' TIME. A task that
        //can never be picked up looks exactly like one that is merely waiting,
        //and the difference matters most when somebody has gone home.
        //
        //BY THE SAME RULE THE TICK DISPATCHES BY. Counting free machines alone
        //answered "4 machine(s) can take it" about a task tagged for a kind of
        //machine this host has none of — the exact sentence the paragraph above
        //says this exists to avoid, written by the code under it. `plan` is that
        //rule, handed in, so there is one of it.
        var said = await plan(Object.assign({ kind: 'task', ref: '#' + queued.number }, queued));

        return Object.assign({}, queued, {
            waitingFor: said.canTakeIt.length ? null : said.why,
            note: said.canTakeIt.length
                ? said.canTakeIt.length + ' machine(s) can take it; the next tick picks it up.'
                : task.tag
                    ? 'Nothing tagged "' + task.tag + '" is free. It stays queued until something is — a tagged '
                        + 'task waits rather than taking a machine of another kind.'
                    : 'Nothing can take it yet. It stays queued until something can.'
        });
    }

    //TAKING ONE BACK, WHICH IS NOT THE SAME AS STOPPING ONE.
    //
    //A TASK LEFT QUEUED IS A RUN THAT HAS NOT HAPPENED YET. That is easy to
    //forget because nothing appears to be happening: work queued against a host
    //that cannot dispatch — nothing free, or no sign-in to give it — sits there
    //looking inert and starts the moment that changes. So anything that queues a
    //task speculatively needs a way to put it back, or it has scheduled a run
    //for whenever somebody next fixes something unrelated.
    //
    //ONE ALREADY GIVEN OUT IS NOT CALLED BACK BY THIS, on the same rule as
    //../judge's `judgementUnqueue`: the machine is working, and stopping it is a
    //different act on a different thing. Said rather than silently doing half
    //of it.
    async function unqueue(ref) {
        var task = await store.get(ref);

        if (task.state !== 'queued') {
            throw new Error('#' + task.number + ' is "' + task.state + '", not queued. One already given out is '
                + 'not called back by this — the machine is working and would have to be stopped on it.');
        }

        var back = await store.update(task.id, { state: 'draft' });
        say.warn('#' + task.number + ' taken back out of the queue');

        return Object.assign({}, back, {
            note: '#' + task.number + ' is a draft again. Nothing will pick it up until it is queued once more.'
        });
    }

    //=======================================================================
    //THROW IT AWAY.
    //
    //The branch and the kept logs are untouched, and the store says so — see
    //./store.js. Removing a task throws away what was ASKED, not what came back.
    //=======================================================================
    async function remove(ref) { return await store.remove(ref); }

    //=======================================================================
    //CHANGE ONE.
    //
    //TWO CALLERS THAT LOOK NOTHING ALIKE. A person editing a draft on the board,
    //and the queue marking a task as given, run, done — and they go through one
    //door because the identity pinning and the library copying have to be true
    //of both. The frozen app's `taskUpdate` is titled "Change a task that has not
    //been given out yet" and is also what every line of the tick writes through.
    //
    //---- what cannot change once it has been given out ------------------
    //
    //THE BRIEF AND THE BRANCH are what a worker was TOLD and WHERE it delivered.
    //Editing either after the fact rewrites the question a piece of work was the
    //answer to, and a verdict then refers to something that was never asked.
    //
    //THE STATE IS NOT AMONG THEM, and that is the whole reason this door is
    //shared: the queue moves a given task to `done` on every run. What is refused
    //is rewriting what it was for, not recording what happened to it.
    //=======================================================================
    async function edit(ref, changes) {
        var it = typeof changes === 'string' ? JSON.parse(changes) : (changes || {});
        var now = await store.get(ref);

        if (now.machine && (it.brief || it.branch || it.contract)) {
            throw new Error('"' + (now.id || ref) + '" has already been given to ' + now.machine + '. What it was '
                + 'asked and where it delivers cannot change now — that would rewrite the question its work '
                + 'answers. Write a new task, or take the verdict on this one first.');
        }

        //A BRANCH IS CHECKED THE SAME WAY WRITING ONE IS. Without it the order
        //holds at the door and not at the window beside it: write the task
        //correctly, then edit the branch to one nobody has cut.
        if (it.branch) {
            var why = await branchIsReady(String(it.branch).trim());
            if (why) throw new Error(why);
        }

        //`carries` IS WHAT THE TASK ALREADY HAS, so "a library contract and a
        //file at once" is asked of the result rather than of the patch.
        await fromTheLibrary(it, { when: 'editing', carries: now.contract });

        return await store.update(ref, it);
    }

    //=======================================================================
    //A PERSON'S DECISION ABOUT WORK, RECORDED AS A PERSON'S DECISION.
    //
    //NOT A MERGE, AND NOT A GATE. Accepting lands nothing, which is deliberate:
    //merging is a separate act with its own rules, and a verdict that quietly
    //merged would make reading the work and publishing it the same button. What
    //this records is that somebody read it and what they thought.
    //
    //---- and it is read fresh, at the moment of deciding ------------------
    //
    //A VERDICT ON AN EMPTY BRANCH IS A JUDGEMENT OF NOTHING, and afterwards it
    //is INDISTINGUISHABLE from a judgement of something: the record says
    //"accepted" either way, and the reason it was empty is not in it.
    //
    //So it is refused rather than allowed with a warning, and the branch is read
    //fresh rather than from anything already on the task. A worker that finished
    //without pushing has delivered nothing, and the gap between "the run ended"
    //and "somebody is deciding" is exactly where that becomes true.
    //=======================================================================
    async function judge(ref, verdict, note) {
        var task = await store.get(ref);
        var call = String(verdict == null ? '' : verdict).trim().toLowerCase();

        if (call !== 'accept' && call !== 'reject') {
            throw new Error('The verdict is "accept" or "reject".');
        }

        var art = await ask.delivered(task.branch);
        if (!art || !art.delivered) {
            throw new Error('Nothing has arrived on "' + task.branch + '", so there is nothing to '
                + 'judge. A worker that finished without pushing has delivered nothing.');
        }

        //A REJECTION WITH NO REASON IS SENT BACK TO A WORKER THAT CANNOT ASK
        //WHAT WAS WRONG. An acceptance needs no words — the work is the answer —
        //but a rejection that says nothing is an instruction to guess.
        var why = String(note == null ? '' : note).trim();
        if (call === 'reject' && !why) {
            throw new Error('Say why it was rejected. A rejection with no reason is sent back to a '
                + 'worker that cannot ask what was wrong.');
        }

        var decided = await store.update(task.id, {
            state: call === 'accept' ? 'accepted' : 'rejected',
            verdict: {
                call: call,
                note: why || null,
                at: new Date().toISOString(),
                //WHAT WAS ON THE BRANCH WHEN IT WAS DECIDED, kept with the
                //decision. The branch moves on; a verdict that only says
                //"accepted" is a verdict nobody can check afterwards.
                on: art.summary
            }
        });

        say.good(call + 'ed: ' + art.summary);
        return decided;
    }

    return {
        create: create, queue: queue, unqueue: unqueue, remove: remove, edit: edit, judge: judge,
        branchIsReady: branchIsReady, fromTheLibrary: fromTheLibrary
    };
};
