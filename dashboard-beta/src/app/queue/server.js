var policy = require('./policy');
var makeStore = require('./store');
var makeArchive = require('./archive');
var makeDoors = require('./doors');
var makeAttempts = require('./attempts');
var makeDispatching = require('./dispatching');

//---------------------------------------------------------------------------
//THE QUEUE, AS A THING OF ITS OWN.
//
//It was one panel inside Tasks, answered by an action that lived with the task
//actions, because for a long time a task was the only thing that could be
//queued. That stops being true the moment judging exists: a judgement waits for
//a machine exactly as a task does, and the two share ONE queue rather than
//having one each.
//
//TWO QUEUES WOULD BE THE FAULT THIS PLUGIN EXISTS TO PREVENT. Given a queue of
//tasks and a queue of judgements there are two answers to "what is next" and no
//answer at all to "what is this host doing" — and the priority between them
//becomes a thing nobody wrote down, decided by whichever loop ticked first.
//
//SO WHAT IS QUEUED IS AN ENTRY, and its `kind` says what it is. The ordering,
//the machines that could take it, and the reasons they cannot are the same
//question for both, which is the argument for one queue.
//
//---- what this plugin is, and what the other two are ----------------------
//
//THIS IS TASK MANAGEMENT, WHOLE. The record, its numbers, its states, its
//attempts, and the log each run left behind:
//
//    ./store.js      the record — three identities, and what is never stored
//    ./doors.js      writing one down, queueing it, throwing it away
//    ./attempts.js   every attempt at one, and how one ends by hand
//    ./archive.js    what a run left behind, kept where the machine cannot
//                    take it away
//    ./policy.js     who is free, what goes next, and what would go where
//
//IT HAS NO MAIN HALF. The two things that had to outlive a save both belong to
//somebody else now: the clock is a job in ../core/cron, and which machine is
//busy is ../vms/busy. What is left is all bundle-shaped, and reloads with it.
//
//THE WORKER AND THE JUDGE ARE THE TWO LIBRARIES — a set of jobs, prompts and
//contracts each — and they use those to ASK for a task. They do not own one once
//it exists.
//
//THAT IS THE LINE THE OLD ARRANGEMENT DID NOT HAVE, and the cost of not having
//it is written all over the app being ported from: the task logic and the job
//library were one folder called `tasks`, so "what a worker is" and "what a task
//is" were the same thing — and when judging arrived it needed both halves and
//could reach neither cleanly. Everything that went wrong in adoption came
//through that gap: the rules were written when tasks were the only work there
//was, and judging inherited none of them.
//
//---- and it depends on neither of them ------------------------------------
//
//The Worker and the Judge consume THIS as a service. This reaches them by
//action name and never declares them — `actions.call` resolves when it is
//called, which is a lookup rather than a graph edge. Declaring them would be a
//cycle and the plugin graph would not build at all; worse, it would be the wrong
//shape even if it did, because a queue that must be linked against the things it
//dispatches to cannot have one of them swapped out.
//
//---- what is here, and what is not, yet -----------------------------------
//
//THE POLICY IS HERE AND PROVEN: who is free, what goes next, and where each kind
//of work may land — ./policy.js, and test/queue-policy.test.js sabotages both
//halves of the rule that keeps reading and writing on separate accounts.
//
//THE TICK IS NOT. Nothing on this host dispatches yet, which is deliberate:
//the queue drives real machines, and a half-ported app that started handing out
//work would be doing it with half of the checks. What runs the work today is the
//app being ported from, so what is in flight is asked of ../vms/busy first and
//of that app second — and which of the two answered is SAID. A board reporting
//"nothing running" while a machine is running something is the confident wrong
//report this whole app is arranged against.
//---------------------------------------------------------------------------
//---- WHAT THE TICK NEEDED, AND WHY EACH ONE IS HERE ----------------------
//
//`guests`   which sign-in is free, which is paused, and who holds one — asked
//           BEFORE a machine is spent, because a task dispatched with no
//           identity available boots a machine, rolls it forward, fails at the
//           handover and rolls it back.
//`judge`    the judgements, which share this queue and are dispatched first.
//`ours`     the machine register, where a machine is marked as somebody's.
//`refs`     where a branch stands, read either side of a run.
//`channel`  talking to a machine — a judge's report going out, and a machine
//           dialling back in saying what it still holds.
//`workspace` whether there is anywhere to deliver at all.
//`settings` whether the supervisor is meant to be woken.
//
//NOTHING CONSUMES `queue`, so none of these can be a cycle — which is worth
//saying out loud, because an unresolved name takes down the whole graph and a
//cycle means nothing builds at all.
plugin.consumes = ['app', 'log', 'state', 'dataDir', 'secret', 'artifact', 'archive', 'cron', 'busy',
    'guests', 'judge', 'ours', 'refs', 'channel', 'workspace', 'settings', 'repositories'];
plugin.provides = ['queue'];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log.on('queue');
    var state = imports.state;
    var dataDir = imports.dataDir;
    var secret = imports.secret;

    //---- what is in flight, which is ../vms/busy's -------------------------
    //
    //THE QUEUE HAD ITS OWN MAP OF THIS, in a main half of its own, for the right
    //reason: the node bundle is rebuilt on every save, and a queue that forgot
    //which machine was holding which task would hand that machine a SECOND one,
    //on top of a worker still running in a repository it is still writing to.
    //
    //../vms/busy holds exactly that fact, for exactly that reason, and it is on
    //the host for exactly that lifetime. Two maps of "which machine is busy" is
    //two answers to one question, and the day it would have mattered is the day
    //the tick lands: a queued task and a snapshot would each believe they held
    //the same machine, and neither would be wrong about its own record.
    //
    //SO THE QUEUE ASKS RATHER THAN REMEMBERS. What it takes a machine FOR is the
    //queue's business; whether the machine is free is not.
    var busy = imports.busy;

    //HOW OFTEN THIS HOST LOOKS. Declared here because here is where the job is
    //registered — the cadence and the thing it paces are one edit apart, and the
    //board reads it from this same constant so it cannot describe a cadence that
    //is not the one running.
    var TICK = 15000;

    //---- the clock, which is a cron job ------------------------------------
    //
    //The timer used to be the queue's own — see ../core/cron for why every
    //repeating job in this app now shares one. What is queue-shaped is the two
    //RULES the switch carries, and they are declared here because this is where
    //they are true:
    //
    //IT COMES UP STOPPED. Always, on every start, with no setting that can
    //change it. This is the piece that gives real machines real work: it rolls
    //one back to its base snapshot, hands it a credential, and runs somebody's
    //instructions on it unattended. A thing that does that is STARTED by
    //somebody, every time, rather than found already running by whoever opened
    //the app. `autoStart` is simply not asked for.
    //
    //AND ONLY A PERSON MAY START IT. One sentence, said in one place, so the
    //generic `cronStart` and the queue's own `queueStart` refuse with the same
    //words — a second copy is how the two come to disagree about what is
    //allowed.
    var cron = imports.cron;
    var JOB = 'queue';
    var ONLY_A_PERSON = 'Starting the queue is done in the window, by a person. It gives real machines '
        + 'real work — rolled back, handed a credential, and run unattended — and a model may not '
        + 'decide that this host should begin doing that.';

    //THE JOB IS DECLARED BEFORE THE THING IT RUNS EXISTS, and armed after.
    //
    //`cron.add` is what makes the switch appear on the board and what makes
    //`cronStart` refuse without a person; the tick is what it does when started.
    //Declaring both here would put the whole assembly above every read in this
    //file, so the job is registered with its rules and given its `run` at the
    //bottom, where the pieces are built. A job with no `run` reports itself
    //unarmed rather than pretending — see `armed` below, which the board draws.
    cron.add({
        name: JOB,
        every: TICK,
        about: 'Gives waiting work to free machines on this host',
        humanOnly: ONLY_A_PERSON
    });

    //ASKED OF THE JOB EACH TIME RATHER THAN REMEMBERED. This half is rebuilt on
    //every save and the job is not, so a copy taken here would be a copy of how
    //things were the last time somebody pressed save.
    var clock = {
        running: function () { var j = cron.get(JOB); return !!(j && j.running); },
        since: function () {
            var j = cron.get(JOB);
            return (j && j.running) ? { by: j.startedBy, at: j.startedAt } : null;
        },
        armed: function () { var j = cron.get(JOB); return !!(j && j.run); },
        start: function (by) { return cron.start(JOB, by); },
        stop: function (why) { return cron.stop(JOB, why); }
    };

    //A QUEUE THAT CANNOT BE READ IS NOT AN EMPTY QUEUE.
    //
    //This swallowed the error and answered null, which the board then drew as
    //"nothing is waiting, no machine is free" — the single most misleading thing
    //this screen can say. "The host is keeping up" and "I cannot see the work"
    //are opposite reports and they looked identical.
    //
    //It is not hypothetical: the app being ported from was stopped while this was
    //being written, and the first answer this action ever gave was a confident,
    //completely empty board. So a failure is CARRIED rather than flattened.
    var unreachable = [];
    async function relayed(name, args) {
        if (!actions) return null;
        try { return await actions.call(name, args || {}); }
        catch (e) {
            unreachable.push(name);
            return null;
        }
    }

    //---- one entry, whichever kind it is -----------------------------------
    //
    //WHAT KIND OF WORK THIS IS, SAID ON EVERY ENTRY rather than implied by which
    //list it came from. A board that has to know where a row was read from in
    //order to say what it is cannot show two kinds in one list.
    function asJudgement(j) {
        return {
            kind: 'judgement',
            number: j.number,
            //ITS OWN LABEL, CARRIED RATHER THAN DERIVED. A judgement and a task
            //can both be number 4, and nothing drawing a row should have to know
            //this app's prefix conventions to say which is which.
            ref: j.ref || ('j' + j.number),
            id: j.id,
            title: j.title,
            //WHAT IT READS. A judgement takes no branch of its own — it is not
            //delivering anywhere — so this is the subject, not a destination.
            on: j.subject && j.subject.name,
            reads: j.subject && j.subject.kind,
            tag: j.tag || null
        };
    }

    function asTask(t) {
        return {
            kind: 'task',
            number: t.number,
            ref: '#' + t.number,
            id: t.id,
            title: t.title,
            //WHAT IT DELIVERS ON. A task works on a branch; a judgement names
            //the cut or line it reads instead, which is why this is not called
            //"branch" at the top level of an entry.
            on: t.branch,
            branch: t.branch,
            //A TAGGED ENTRY WAITS FOR ITS OWN KIND OF MACHINE rather than taking
            //somebody else's — so a row that is not moving has its reason here
            //rather than in a log line nobody was watching.
            tag: t.tag || null
        };
    }

    //---- and what has already been through ---------------------------------
    //
    //A QUEUE WITH NOTHING IN IT LOOKS THE SAME AS ONE NOTHING HAS EVER USED, and
    //those want opposite responses: one is a host keeping up, the other is a host
    //where something is wrong upstream and no work is arriving. "Nothing is
    //waiting and nothing is running" was the whole screen on an idle host, and it
    //said neither.
    var ENDED = { done: true, accepted: true, rejected: true, failed: true };
    function when(r) { return r.read || r.updated || r.touched || r.created || r.written || ''; }

    //=======================================================================
    //THE TASK FUNCTIONS, WHICH ARE WHAT THE WORKER AND THE JUDGE CALL.
    //
    //Task management is this plugin: tracking one, its progress, creating one,
    //and stopping one. The other two are LIBRARIES — a set of jobs, prompts and
    //contracts each — and they use these to ask for a task rather than keeping
    //one of their own.
    //
    //WIRED AS A SERVICE, AND STILL NOT AS ACTIONS. The seam has to be real
    //before anything can be written against it, and it costs nothing to be:
    //nothing here dispatches, and no action reads or writes this store, so the
    //app being ported from stays the one that owns the live board. The flip is
    //`actions.define`, later, at a moment somebody picks.
    var store = makeStore({
        tasks: function () { return state.here.doc('tasks'); },
        counter: function () { return state.here.doc('tasks-highest'); }
    }, log);

    //REDACTED THROUGH THE ONE ANSWER TO WHAT A SECRET LOOKS LIKE. A second copy
    //of that list is the exact fault ../core/secret/looks-like.js was written to
    //end — and this is the boundary where a machine's output is KEPT, so it is
    //the one place a token stops being a moment and becomes a filing.
    var archive = makeArchive(
        function () { return dataDir.at('task-logs'); },
        function (text) { return secret.redact(text || ''); }
    );

    //WHAT THE DOORS ARE GIVEN RATHER THAN WHAT THEY REACH FOR. Every one of
    //these still lives in the app being ported from, so each is a relay today
    //and a service edge the day its half moves — and the doors do not change
    //either way, which is the point of handing them in.
    var doors = makeDoors(store, {
        branchNameIsOk: async function (name) {
            var said = await relayed('branchNameOk', { branch: name });
            return said && said.why ? said.why : null;
        },
        branchExists: async function (name) {
            var said = await relayed('branchBoard');
            var rows = (said && (said.branches || said.board)) || [];
            return rows.some(function (b) { return b.name === name; });
        },
        judgement: async function (ref) {
            var said = await relayed('judging');
            var all = (said && (said.judgements || said.judging)) || [];
            return all.filter(function (j) { return j.ref === ref || j.id === ref; })[0] || null;
        },
        contract: async function (id) {
            var said = await relayed('contracts');
            var all = (said && said.contracts) || [];
            return all.filter(function (c) { return c.id === id; })[0] || null;
        },
        contractFileExists: async function () { return true; },
        job: async function (id) {
            var said = await relayed('jobs');
            var all = (said && said.jobs) || [];
            return all.filter(function (j) { return j.id === id; })[0] || null;
        },
        machines: async function () {
            var said = await relayed('vmList');
            return (said && said.vms) || [];
        }
    }, log);

    var attempts = makeAttempts(store, archive, {
        connected: async function (name) {
            var said = await relayed('vmList');
            var vm = ((said && said.vms) || []).filter(function (v) { return v.name === name; })[0];
            return !!(vm && vm.connected);
        },
        runs: async function (name) {
            var said = await relayed('vmRuns', { name: name });
            return (said && said.runs) || [];
        },
        runOutput: async function (name, run, lines) {
            return await relayed('vmRunOutput', { name: name, run: run, lines: lines });
        },
        sessions: async function (name) { return await relayed('vmSessions', { name: name }); },
        sessionTail: async function (name, session, limit) {
            return await relayed('vmSessionTail', { name: name, session: session, since: 0, limit: limit });
        },
        returnMachine: async function (name, keep) {
            return await actions.call('vmReturn', { name: name, keep: !!keep });
        }
    }, log);

    //---- and the dispatch itself -------------------------------------------
    //
    //ASSEMBLED IN ./dispatching, which is nothing but wiring — every rule it
    //joins up lives in a file of its own and is tested there. What is decided
    //HERE is only which service answers which question.
    var dispatch = makeDispatching({
        call: function (name, args) { return actions.call(name, args || {}); },
        say: function (who, machine) { return imports.log.on(who, machine); },

        busy: busy,
        ours: imports.ours,
        guests: imports.guests,
        judge: imports.judge,
        refs: imports.refs,
        channel: imports.channel,
        workspace: imports.workspace,
        settings: imports.settings,

        //THE RUN LOGS ARE THIS PLUGIN'S DRAWER — the same one taskProgress
        //fills, because a judgement's log is a run's log and somebody looking
        //for it should not have to know which kind of work produced it.
        logs: archive,
        //AND WHAT A JUDGEMENT HANDED BACK is ../judge's, opened here by the same
        //name it opens it by. Two drawers, two subjects: one is what a run SAID,
        //the other is what it DELIVERED.
        findings: imports.archive.store('artifacts'),

        //WHAT THIS HOST HAS SPENT, beside the rest of its state.
        meterFile: function () { return dataDir.at('meter.json'); },

        //WHAT A MACHINE IS FOR, left on it so it can say so if it dials back in.
        noteFor: store.noteFor,

        //WHICH REPOSITORY HERE, from the name GitHub uses. A question about
        //remotes, which is not this plugin's subject.
        repoFor: repoFor,

        //---- WHETHER THIS APP OWNS BOTH ENDS OF THE BOARD -----------------
        //
        //`tasks` IS DEFINED HERE AND `taskUpdate` IS NOT, so today this answers
        //false and nothing is dispatched. Asked of the action table rather than
        //carried as a flag: the day taskUpdate is defined here this becomes true
        //on its own, and nobody has to remember to turn anything on.
        //
        //`has` IS THIS HALF'S OWN TABLE and answers synchronously — "is this
        //action mine" is a real question and making it wait on a socket would be
        //the wrong trade. Which is exactly the question being asked.
        ownsTheBoard: function () {
            return !!(actions && actions.has && actions.has('tasks') && actions.has('taskUpdate'));
        },

        //AND A TASK BY ITS UID, for a machine dialling back in. By uid and
        //answered by uid: looking one up by NUMBER would follow a number
        //reissued after the task holding it was deleted.
        taskByUid: function (uid) { return store.get(uid); }
    });

    //---- WHICH REPOSITORY A PULL REQUEST'S SUBJECT NAMES -------------------
    //
    //A subject carries `owner/name` because that is where a pull request lives;
    //a repository in this workspace is called something shorter. MATCHED ON ALL
    //THREE NAMES one can go by, because which of them a subject was written with
    //depends on where it came from.
    //
    //A DECLARED FUNCTION rather than a `var`, so it can be handed in above while
    //being defined here — a `var` would be `undefined` at the moment it is
    //passed, and ./onejudgement would refuse every pull request with "no
    //repository in this workspace is that".
    async function repoFor(named) {
        var kept = null;
        try { kept = await imports.repositories.read(); } catch (e) { kept = null; }

        //NOTHING TO ASK IS NOT AN EMPTY WORKSPACE. `read` answers null when
        //nothing is open, and turning that into "no repository is that" would
        //refuse a judgement for the wrong reason.
        var rows = kept && kept.repos ? kept.repos : [];

        return rows.filter(function (x) {
            return x.repo === named
                || x.name === named
                || x.issuesOn === named
                || (x.remote && (x.remote.owner + '/' + x.remote.repo) === named);
        })[0] || null;
    }

    //---- which machines are busy, and whose tick says so --------------------
    //
    //WHAT THIS HOST IS RUNNING, from the record that outlives a save — empty
    //until the tick lands here, which is why the other half is asked when it is.
    //
    //ASKED OF THE OTHER HALF BY NAME, which needs `elsewhere` rather than
    //`call`: `queueState` IS defined here, and `call` tries this table first, so
    //it would call itself until the stack ends — looking from outside like the
    //app simply hanging.
    //
    //THIS HOST'S FIRST, THE OTHER HALF'S ONLY WHILE THERE IS NOTHING OF ITS OWN.
    //The day the tick lands here this fills and stops looking anywhere else,
    //without a second edit, and without a moment where a machine is in both.
    //
    //ONE FUNCTION BECAUSE TWO ANSWERS TO "IS THAT MACHINE FREE" IS THE BUG. The
    //board shows a pool and the door below plans work into it; worked out twice,
    //the board can call a machine free while the door has already given it away.
    async function busyNow() {
        //`all()` GIVES {name, job}; the board's word for those is machine and
        //task. Renamed here rather than in ../vms/busy, because what a
        //machine is being held FOR is this plugin's vocabulary.
        var mine = busy.all();
        if (mine.length) {
            return mine.map(function (r) { return { machine: r.name, task: r.job }; });
        }
        var there = null;
        if (actions && actions.elsewhere) {
            try { there = await actions.elsewhere('queueState', {}); } catch (e) { there = null; }
        }
        return (there && there.inFlight) || [];
    }

    function busyAs(inFlight) {
        return (inFlight || []).reduce(function (n, r) {
            n[r.machine] = r.task || r.doing;
            return n;
        }, {});
    }

    //THE RULE THE TICK DISPATCHES BY, ASKED ABOUT ONE ENTRY.
    //
    //HANDED TO ./doors.js RATHER THAN REBUILT IN IT, so "4 machine(s) can take
    //it" and what a tick would actually do are the same sentence. Counting free
    //machines instead once answered that about a task tagged for a kind of
    //machine this host has none of.
    async function planFor(entry) {
        var machines = await relayed('vmList');
        var vms = (machines && machines.vms) || [];
        var said = policy.plan([entry], vms, { inFlight: busyAs(await busyNow()), signIns: null });
        return {
            canTakeIt: said.dispatch.map(function (d) { return d.machine; }),
            why: said.waiting.map(function (w) { return w.why; })
        };
    }

    //WHAT A BRANCH ACTUALLY DELIVERED. Its own plugin, because the worker, the
    //judge and the repositories panes all ask it and none of them owns it.
    var artifact = imports.artifact;

    //AND WHAT A RUN HANDED OVER THAT A BRANCH COULD NOT HOLD. ../core/archive
    //owns where those are kept and how they are read back; this plugin only
    //knows that a task's are filed under its uid.
    //
    //THE SAME DRAWER THE JUDGE OPENS. A judgement's findings are handed over the
    //same way and filed the same way, so both ask ../core/archive for
    //`artifacts` rather than one of them owning it and the other reaching in.
    var artifacts = imports.archive.store('artifacts');

    var undo = [];
    if (actions) {
        //=================================================================
        //THE TASK DOORS, WHICH ARE THE QUEUE'S AND NOT THE WORKER'S.
        //
        //A JOB, A PROMPT AND A CONTRACT BELONG TO WHOEVER RUNS THEM — the
        //worker, the judge — and what those two do with them is ASK FOR A
        //TASK. Writing one down, putting it in the queue and throwing it away
        //are task management, so they live with the task management, and
        //../worker and ../judge call them rather than each owning a copy.
        //
        //THE LOGIC IS ALREADY IN ./doors.js AND WAS BEFORE THIS. What was
        //missing is only that nothing here answered to those names, so every
        //one of them relayed to the app being ported from — which means the
        //pane was reading THAT app's tasks while this one kept its own.
        //=================================================================
        //THE BOARD, AND IT MOVES WITH THE DOORS RATHER THAN AFTER THEM.
        //
        //A READ THAT RELAYS WHILE THE WRITES DO NOT IS WORSE THAN EITHER END.
        //`actions.call` tries this table first, so the moment `taskQueue` was
        //defined here it acted on THIS app's store — while the board went on
        //listing the other app's tasks. You would see #5, press Queue, and be
        //told there is no such task. Nothing about that reads as a migration
        //in progress; it reads as a broken button.
        //
        //SO THIS APP'S BOARD STARTS EMPTY, which is the deliberate cost written
        //down in ../../../CLAUDE.md: state lives in this app's own data folder,
        //so a moved subsystem starts with nothing and cannot corrupt the real
        //tasks. The pane says so rather than looking broken.
        undo.push(actions.define('tasks', {
            about: 'The board: every task, newest first, and whether its branch has anything on it yet',
            run: async function () {
                //NEWEST FIRST, AND SORTED HERE so the window and the command
                //line agree. The file is append-ordered because that is how it
                //is written; what order it should be READ in is a different
                //question, and answering it in two places is how two views of
                //one board come to disagree.
                //
                //BY NUMBER RATHER THAN A TIMESTAMP: it is the creation order by
                //definition, it cannot tie, and it does not depend on a clock.
                var list = (await store.read()).slice()
                    .sort(function (a, b) { return (b.number || 0) - (a.number || 0); });

                var out = [];
                for (var i = 0; i < list.length; i++) {
                    var t = list[i];

                    //READ PER TASK, because each delivers on its own branch —
                    //and through ../artifact, which is its own plugin exactly
                    //because the worker, the judge and the repositories panes
                    //all ask this and none of them owns it.
                    //THE `try` GUARDED A THROW AND NOT AN ANSWER. `art` was
                    //overwritten with whatever came back and then read for
                    //`.delivered`, so a reader that answered null would take the
                    //whole board down rather than reporting one task as having
                    //delivered nothing. ../artifact always answers with an
                    //object today; this stops that being a thing the board
                    //depends on. Found by assembling the plugin in a test with a
                    //stand-in that answered null.
                    var none = { delivered: false, summary: null, commits: [] };
                    var art = none;
                    try { art = (await artifact.read(t.branch)) || none; }
                    catch (e) { /* a branch that is gone has delivered nothing, which is an answer */ }

                    out.push(Object.assign({}, t, {
                        delivered: art.delivered,
                        artifact: art.summary,
                        commits: art.commits,

                        //THE STORED NAME, WITH NO LOOKUP BEHIND IT. The app being
                        //ported from falls back to asking the library, for tasks
                        //written before the name was carried on the task. There
                        //are none of those here and there never can be: this
                        //store is new, and everything written into it carries it.
                        jobName: t.jobName || null,

                        //WHAT THE BOARD SHOWS. The stored state says what a
                        //person decided; this says what is true, and where they
                        //disagree THE BRANCH WINS.
                        //
                        //DELIVERED OUTRANKS DONE, because it is the more
                        //informative of two true statements: a done task that
                        //delivered nothing and a done task that delivered are
                        //the same state and opposite outcomes.
                        //
                        //AND WHETHER THIS RUN PUT IT THERE. `delivered` says the
                        //BRANCH carries something, which stays true from the run
                        //before — so a task whose push was refused read as
                        //"delivered" beside the commit its predecessor made.
                        //`arrived` is recorded from the branch either side of the
                        //run, and only the queue can know it, because only the
                        //queue saw the before.
                        //
                        //COMPARED AGAINST false RATHER THAN TRUSTED AS A FLAG,
                        //because it is undefined for anything written before it
                        //was recorded, and "not known" must read as it always did.
                        reads: t.verdict ? t.state
                            : t.arrived === false && t.state === 'done' ? 'done, nothing arrived'
                                : art.delivered ? 'delivered'
                                    : t.state === 'given' ? 'working'
                                        : t.state === 'queued' ? 'queued'
                                            : t.state === 'done' ? 'done, nothing delivered'
                                                : 'draft'
                    }));
                }

                return { tasks: out };
            }
        }));

        undo.push(actions.define('taskCreate', {
            about: 'Write a task: what the work is, and the branch it delivers on. '
                + 'Over the wire it also names the judgement that established the work is real',
            takes: ['task', 'becauseOf'],
            //THE GATE IS INSIDE ./doors.js AND NOT HERE, because it is a rule
            //about what a task IS rather than about this table. `_overTheWire`
            //is the only thing this half knows that the door cannot.
            run: async function (args) {
                var a = args || {};
                return await doors.create(a.task, {
                    overTheWire: !!a._overTheWire,
                    becauseOf: a.becauseOf
                });
            }
        }));

        undo.push(actions.define('taskQueue', {
            about: 'Put a task in the queue. The next free machine takes it, runs it, and shuts down',
            takes: ['id'],
            //`planFor` IS HANDED IN so the answer the door gives — "3 machine(s)
            //can take it" — is the same rule a tick would dispatch by, rather
            //than a second opinion written beside it.
            run: async function (args) {
                return await doors.queue((args || {}).id, planFor);
            }
        }));

        undo.push(actions.define('taskRemove', {
            about: 'Throw a task away. Its branch, and the logs kept for it, are untouched',
            takes: ['id'],
            run: async function (args) {
                return await doors.remove((args || {}).id);
            }
        }));

        //---- what a run handed over, which a branch could not hold ---------
        //
        //NOT EVERY TASK PRODUCES SOURCE. A branch is the artefact for anything
        //that IS source, and it is the better one — reviewable, diffable, and
        //already the thing a verdict is about. A firmware build produces a
        //`.bin` that is the point of the task and whose source is only how it
        //got made; a packaging task produces an archive. The branch holds what
        //went in and nothing held what came out.
        //
        //THE OLD ANSWER WAS THAT THESE DO NOT SURVIVE, stated as a rule rather
        //than a gap: only git and the session outlive a machine, because the
        //machine goes back to its base snapshot. That is still true — what
        //changed is that a run can HAND SOMETHING OVER before that happens,
        //instead of leaving it on a disk about to be rolled back.
        //
        //WHERE IT IS KEPT IS ../core/archive'S BUSINESS, not this plugin's. The
        //name safety, the size cap, the binary refusal and the never-silently-
        //replaced rule are all over there, shared with the other things that
        //hand bytes to this host.
        undo.push(actions.define('taskFiles', {
            about: 'Files a task handed over — a built binary, an archive, anything a branch cannot hold',
            takes: ['id'],
            run: async function (args) {
                var id = (args || {}).id;

                //NO ID IS A DIFFERENT QUESTION: what is on this host in total,
                //including what belongs to tasks the board has forgotten.
                if (!id) {
                    var all = await artifacts.everything();
                    var board = {};
                    (await store.read()).forEach(function (t) { board[t.uid] = t; });

                    return {
                        tasks: all.map(function (a) {
                            var t = board[a.uid] || null;
                            return Object.assign({}, a, {
                                task: t ? t.id : null,
                                number: t ? t.number : null,
                                title: t ? t.title : null,
                                //WHAT WAS PRODUCED OUTLIVES THE NOTE ABOUT IT,
                                //and saying which rows those are is the point of
                                //asking without an id.
                                orphaned: !t
                            });
                        }),
                        bytes: all.reduce(function (n, a) { return n + (a.bytes || 0); }, 0),
                        where: await artifacts.root()
                    };
                }

                var task = await store.get(id);
                var kept = await artifacts.list(task.uid);

                return {
                    task: task.id,
                    number: task.number,
                    branch: task.branch,
                    files: kept,
                    bytes: kept.reduce(function (n, f) { return n + (f.bytes || 0); }, 0),
                    where: await artifacts.dirFor(task.uid),
                    note: kept.length
                        ? 'These are on this host, not on the machine — the machine was rolled back.'
                        : 'Nothing was handed over. A run hands a file over by calling "okc-artifact <file>", '
                            + 'which is on its PATH.'
                };
            }
        }));

        undo.push(actions.define('taskFileRead', {
            about: 'Read a file a task handed over, as text',
            takes: ['id', 'file'],
            //THE REFUSALS ARE ../core/archive'S: a binary is refused rather than
            //rendered as replacement characters, and something enormous is
            //refused with its size rather than loaded into a panel.
            run: async function (args) {
                var a = args || {};
                var task = await store.get(a.id);
                var said = await artifacts.read(task.uid, String(a.file || ''));
                return Object.assign({}, said, { task: task.id, number: task.number });
            }
        }));

        undo.push(actions.define('taskFileForget', {
            about: 'Throw away one file a task handed over. The task and its branch are untouched',
            takes: ['id', 'file'],
            run: async function (args) {
                var a = args || {};
                var task = await store.get(a.id);
                var gone = await artifacts.forget(task.uid, String(a.file || ''));
                log.warn('threw away "' + gone.name + '" from #' + task.number);
                return Object.assign({}, gone, {
                    note: 'Only the file. The task, its branch and its log are untouched.'
                });
            }
        }));

        //=================================================================
        //STARTING THE QUEUE IS A PERSON'S PRESS.
        //
        //It is not a setting and it is not a preference: switching this on
        //means this host will roll a machine back to its base snapshot, hand
        //it a credential, and run somebody's instructions on it unattended,
        //again and again, without asking. Nothing that can be reached over a
        //socket may decide that.
        //
        //THE SAME BOUNDARY AS APPROVING A JOB, and the same standing rule
        //behind it: the command line needs approvals because a model runs
        //them, and it must not be able to create work that runs by itself.
        //Starting the thing that RUNS the work is the same act one level up.
        //
        //STOPPING IS NOT SYMMETRICAL AND IS DELIBERATELY NOT REFUSED. Anything
        //that can see something going wrong should be able to stop new work
        //being picked up. The cost of a stop nobody meant is a queue somebody
        //restarts; the cost of a start nobody meant is a machine running a
        //stranger's code.
        //=================================================================
        undo.push(actions.define('queueStart', {
            about: 'Start handing queued work to machines on this host',
            takes: ['why'],
            run: function (args) {
                var a = args || {};
                if (a._overTheWire) throw new Error(ONLY_A_PERSON);
                var was = clock.running();
                clock.start(actions.whoAsked(a));
                return {
                    running: clock.running(),
                    since: clock.since(),
                    note: was
                        ? 'The queue was already running.'
                        : 'The queue is running. It looks every ' + (TICK / 1000) + 's and gives waiting work to '
                            + 'free machines. Stop it to have it pick nothing new up.'
                };
            }
        }));

        undo.push(actions.define('queueStop', {
            about: 'Stop giving new work to machines. Anything already running is not interrupted',
            takes: ['why'],
            run: function (args) {
                var a = args || {};
                var was = clock.running();
                clock.stop(a.why ? String(a.why) : null);
                var held = busy.all().map(function (r) { return { machine: r.name, task: r.job }; });
                return {
                    running: false,
                    stillWorking: held,
                    note: (was ? 'The queue is stopped. ' : 'The queue was not running. ')
                        + (held.length
                            //A STOP THAT READ AS "EVERYTHING HAS STOPPED" WOULD BE
                            //THE WRONG SENTENCE. The machines carry on; what
                            //stopped is anything NEW being picked up.
                            ? held.length + ' machine(s) are still working and are not interrupted — '
                                + held.map(function (r) { return r.machine + ' (' + r.doing + ')'; }).join(', ') + '.'
                            : 'Nothing was in flight.')
                };
            }
        }));

        undo.push(actions.define('queueState', {
            about: 'What the queue is doing: what is waiting, in what order, and which machines could take it',
            run: async function () {
                unreachable = [];
                var machines = await relayed('vmList');
                var vms = (machines && machines.vms) || [];

                //BOTH KINDS, READ SEPARATELY AND SORTED TOGETHER. Two stores,
                //because a judgement and a task are different records; one line,
                //because they want the same machines. `order` is what decides
                //which goes first, and it is the same function a tick would
                //dispatch by.
                var saidJ = await relayed('judging');
                var judgements = (saidJ && (saidJ.judgements || saidJ.judging)) || [];

                var saidT = await relayed('tasks');
                var tasks = (saidT && saidT.tasks) || [];

                var waiting = policy.order(
                    judgements.filter(function (j) { return j.state === 'queued'; }).map(asJudgement)
                        .concat(tasks.filter(function (t) { return t.state === 'queued'; }).map(asTask))
                );

                var past = judgements.filter(function (j) { return ENDED[j.state]; }).map(function (j) {
                    return {
                        kind: 'judgement', ref: j.ref || ('j' + j.number), id: j.id, title: j.title,
                        on: j.subject && j.subject.name, machine: j.machine || null,
                        at: when(j), state: j.state,
                        //A JUDGEMENT ENDING IS NOT A VERDICT. `done` means
                        //somebody read it; what they decided is recorded
                        //separately and is often not decided at all, which is a
                        //real state and worth showing as one.
                        verdict: j.verdict || null,
                        concluded: j.concluded || null
                    };
                }).concat(tasks.filter(function (t) { return ENDED[t.state]; }).map(function (t) {
                    return {
                        kind: 'task', ref: '#' + t.number, id: t.id, title: t.title,
                        on: t.branch, machine: t.machine || null,
                        at: when(t), state: t.state, verdict: t.verdict || null,
                        //WHETHER IT RAN AT ALL. A task can be `done` having never
                        //been given a machine — see what the queue does when it
                        //can be given no identity — and a history showing those
                        //the same as a real run would be the most misleading list
                        //on the screen.
                        tries: (t.attempts || []).length
                    };
                })).sort(function (a, b) {
                    return String(b.at).localeCompare(String(a.at));
                //ENOUGH TO SEE THE SHAPE OF THE DAY, not an archive. The Worker
                //and Judge tabs are where everything lives; this is the last few
                //things this queue did, beside what it is about to do.
                }).slice(0, 12);

                //---- WHAT IS RUNNING, AND WHOSE TICK IS RUNNING IT -----------
                //
                //THIS HOST DISPATCHES NOTHING YET. Reporting an empty `inFlight`
                //would be a board saying nothing is running while a machine is
                //running something — so it is read from the app being ported
                //from, and `tickHere` says whose it is. When the tick moves, this
                //reads its own and that flag flips.
                //WHAT IS RUNNING, whoever's tick is running it. See `busyNow`.
                var inFlight = await busyNow();
                var doing = busyAs(inFlight);

                return {
                    inFlight: inFlight,
                    //WHOSE CLOCK IS RUNNING, AND WHETHER IT IS. Two different
                    //facts: this host can own the tick and have it switched off,
                    //which is what it does on every start.
                    ticking: clock.running(),
                    startedBy: clock.since(),
                    waiting: waiting,
                    history: past,
                    //COUNTED PER KIND, because "four waiting" says nothing about
                    //whether this host is behind on READING work or behind on
                    //DOING it.
                    counts: waiting.reduce(function (n, e) {
                        n[e.kind] = (n[e.kind] || 0) + 1;
                        return n;
                    }, {}),
                    machines: policy.availability(vms, doing),
                    //---- AND WHAT WOULD GO WHERE, IF THE TICK WERE ON --------
                    //
                    //THE DECIDING, ANSWERABLE WITHOUT THE ACTING. While this
                    //lived inside the tick the only way to find out what it
                    //would do was to let it do it — on real machines. Now the
                    //board can say what is about to happen, and it says it by
                    //running the same function a tick dispatches by rather than
                    //by describing it.
                    //
                    //THE SIGN-IN CHECK IS NOT APPLIED HERE, and that is said
                    //rather than quietly skipped. Whether a credential is free
                    //is a rule about sign-ins and it lives with them — over in
                    //the app being ported from, until the Runners half moves. A
                    //second copy of it here is how two answers to "can this go
                    //out" come to disagree, and the one that decides is not the
                    //one anybody is reading.
                    plan: (function () {
                        var p = policy.plan(waiting, vms, { inFlight: doing, signIns: null });
                        return {
                            next: p.dispatch,
                            waiting: p.waiting.map(function (w) { return { ref: w.ref, why: w.why }; }),
                            free: p.free,
                            signInCheck: false,
                            about: 'What the tick would do with what is waiting now. The sign-in check is NOT part of '
                                + 'this — whether a credential is free is a rule that lives with the sign-ins, which '
                                + 'have not moved here yet, so a row shown as going out may still wait for one.'
                        };
                    })(),

                    order: policy.ORDER,
                    every: (TICK / 1000) + 's',
                    tickHere: clock.armed(),

                    //AND WHAT COULD NOT BE READ, NAMED. An empty board with this
                    //list on it is a different sentence from an empty board
                    //without one, and anything reading this — a person, a pane, a
                    //model writing a progress report — has to be able to tell
                    //them apart.
                    unreachable: unreachable.slice(),
                    note: unreachable.length
                        ? 'THIS BOARD IS INCOMPLETE — ' + unreachable.join(', ') + ' could not be read. What is shown '
                            + 'is not "nothing is waiting", it is "this could not be seen". The app being ported from '
                            + 'answers those and may not be running.'
                        : 'The order and the pool are this host\'s. Nothing here dispatches yet — what is running is '
                            + 'being run by the app this is being ported from, and is shown as it reports it.'
                };
            }
        }));
    }

    await register(null, {
        queue: {
            //---- the task functions ------------------------------------
            //
            //TRACKING, PROGRESS, CREATING, STOPPING. What the worker and the
            //judge reach for, and the only way either of them touches a task.
            task: {
                all: store.read,
                get: store.get,
                update: store.update,
                create: doors.create,
                queue: doors.queue,
                remove: doors.remove,
                progress: attempts.progress,
                finished: attempts.finished,
                //AND WHAT EACH RUN LEFT BEHIND. Kept by the queue because the
                //queue is what put the work on a machine, and read by both.
                log: {
                    list: archive.list,
                    read: archive.read,
                    has: archive.has,
                    everything: archive.everything
                },
                STORED: store.STORED,
                WORKERS: store.WORKERS
            },

            //THE POLICY, HANDED OUT WHOLE. Anything that TELLS somebody what
            //will happen applies the same rule the tick will dispatch by — that
            //is the entire reason this is a service and not a private function.
            availability: policy.availability,
            order: policy.order,
            takes: policy.takes,
            ofItsOwnKind: policy.ofItsOwnKind,
            kindsOf: policy.kindsOf,
            canBe: policy.canBe,
            kindSaid: policy.kindSaid,
            ORDER: policy.ORDER,
            TICK: TICK,

            //AND WHETHER IT IS RUNNING, which is now the clock's own answer
            //rather than a standing no.
            running: clock.running,

            //WHAT A RESTART LEFT BEHIND, and a machine saying what it still
            //holds. Both on the service rather than as actions: adoption is run
            //by the start of the clock, and a redial is something ../vms/channel
            //triggers when a machine dials in — neither is typed.
            adopt: dispatch.adopt,
            dialledIn: dispatch.dialledIn,

            //WHAT THIS HOST HAS SPENT, and on whose sign-in.
            spent: {
                all: dispatch.meter.all,
                byKey: dispatch.meter.byKey,
                total: dispatch.meter.total,
                where: dispatch.meter.where
            }
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });

    //---- AND THE CLOCK IS GIVEN THE THING IT RUNS --------------------------
    //
    //LAST, DELIBERATELY. Everything above is a declaration; this is the line
    //after which this host can give a real machine real work. It stays off until
    //a person starts it — see ONLY_A_PERSON — so arming it is not starting it.
    //
    //ADOPTION FIRST, ON EVERY TICK BEFORE THE FIRST DISPATCH. A restart can
    //leave a task in `given` with no run and a machine still holding one, and
    //handing out new work before picking those up is how one machine gets a
    //second task on top of a worker still writing.
    //
    //ONCE, AND THEN NEVER AGAIN, because adoption is about what a RESTART left:
    //running it every fifteen seconds would re-adopt work this tick had just
    //dispatched. Guarded by a flag rather than by a separate start hook, so the
    //two cannot get out of order.
    var adopted = false;

    //`does` HANDS BACK AN UNDO, and it goes on the same list as every action
    //this plugin defines — the node half is rebuilt on every save, and a job
    //still pointing at the previous build's tick is a tick running against a
    //graph that has been thrown away.
    undo.push(cron.does(JOB, async function () {
        if (!adopted) {
            adopted = true;
            //NEVER FATAL. A restart that could not be tidied up is a reason to
            //say so, not a reason for this host to stop dispatching for ever.
            try { await dispatch.adopt(); }
            catch (e) { log.warn('what the restart left could not all be picked up: ' + e.message); }
        }
        return await dispatch.tick.once();
    }));

    log.info('queue up — the tick is armed and stopped, as it always starts');
}
module.exports = plugin;
