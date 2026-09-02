var fs = require('fs');
var path = require('path');

var policy = require('./policy');
//WHETHER THE QUEUE COULD TAKE A MACHINE AT ALL — the same question the
//Runners pane asks, from the module that owns it.
var roles = require('../vms/ours/roles');
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
//AND THE TICK IS HERE NOW. It was not for a long time, deliberately — the queue
//drives real machines, and a half-ported app that started handing out work would
//be doing it with half of the checks. What is in flight is still asked of
//../vms/busy first and of the app being ported from second, and which of the two
//answered is SAID: a board reporting "nothing running" while a machine is
//running something is the confident wrong report this whole app is arranged
//against.
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
var makeWatching = require('./watching');

//`archive` IS NO LONGER TAKEN, and the reason is worth a line because the name
//survives in this file. `var archive` below is ./archive — the run-LOG store,
//kept in this host's own data folder — and it is a different thing from
//../core/archive, which this consumed only to open the handed-back drawer. That
//drawer is ../artifact's now, so the dependency went with it.
//
//A CONSUMES ENTRY NOTHING READS IS A FALSE EDGE. It says this cannot start until
//that has, which stops being true the moment the last reader goes and is
//invisible until somebody is untangling the graph for a different reason.
plugin.consumes = ['app', 'log', 'state', 'dataDir', 'secret', 'artifact', 'cron', 'busy',
    'guests', 'judge', 'ours', 'refs', 'channel', 'workspace', 'settings', 'repositories', 'meter'];
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
    //../vms/busy is on the host for exactly that lifetime, so the ledger lives
    //there — as `busy.given`, which is ITS OWN MAP beside the operation lock and
    //not the same one.
    //
    //---- THE PARAGRAPH THAT USED TO BE HERE WAS WRONG, AND CHEAPLY ----------
    //
    //It argued that one map was the point: "two maps of which machine is busy is
    //two answers to one question, and the day it would have mattered is the day
    //the tick lands — a queued task and a snapshot would each believe they held
    //the same machine". The tick landed. They did not disagree. They DEADLOCKED,
    //in under a second, on the first judgement this app ever dispatched: the job
    //held the machine as `J4`, its own rollback asked for it as "being shut
    //down", and the guard refused J4 on behalf of J4.
    //
    //THE TWO ARE NOT ONE QUESTION. "A VirtualBox command is mid-flight" lasts
    //seconds and must refuse everybody, the holder included. "The queue has
    //given this machine to a piece of work" lasts hours and CONTAINS dozens of
    //the first. One strictly contains the other, so they can never both be
    //served by one table — ../vms/busy/given.js carries the long version of
    //this, beside the code.
    //
    //IT WAS ALREADY RIGHT IN THE APP BEING PORTED FROM, which keeps `busyWith`
    //in the queue and reaches into `machines/busy` for `comingUp` alone. This is
    //that arrangement, with the map moved to the host for the lifetime reason
    //above — which is the part the old one does not need and this one does.
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
    //repeating job in this app now shares one.
    //
    //---- IT USED TO COME UP STOPPED, ALWAYS, AND ONLY A PERSON COULD START IT
    //
    //Both of those are gone, and what replaced them is one sentence: THE GATE IS
    //ON THE WORK, NOT ON THE CLOCK.
    //
    //Nothing reaches a machine that was not built from a job, a prompt and a
    //contract somebody read and approved — and approving is refused over the
    //wire, in ../library/server.js, in those words: "a model may write one and
    //may not ratify its own." ../queue/dispatching.js says the rest of it: a job
    //the queue dispatches "meets exactly the refusals a job dispatched by hand
    //meets." So by the time anything is waiting here, the decision has been made
    //by a person already.
    //
    //THE SECOND GATE WAS GUARDING THE WRONG END, and it cost more than it held.
    //It made the queue stop dead on every restart — and a restart is what a
    //`main.js` edit IS, so during this port that was several times an hour. The
    //press it demanded was not somebody deciding anything; it was somebody
    //typing the same yes again because the app had been rebuilt.
    //
    //IT ALSO LEAKED. `cronStart --name queue` would have been the same act under
    //a name nobody had guarded, so ../core/cron grew a `humanOnly` mechanism
    //that exactly one job ever used. A guard belonging to one job living in the
    //generic scheduler, where every other job had to be read as "not that one".
    //That is gone with it, and cron is a scheduler again.
    //
    //SO IT COMES UP RUNNING, LIKE `github-watch` BELOW AND EVERY OTHER TIMER
    //THIS APP HAS. That was a setting for a while — `queueAutoStart`, off until
    //somebody said otherwise — and the setting was the same mistake as the guard
    //before it, one step quieter: a host whose whole job is handing work to
    //machines came up not doing it, and the only sign was work sitting still.
    //
    //THE SWITCH ANSWERED A QUESTION NOBODY HAS TWICE. Somebody who does not want
    //work given out stops the queue, or does not queue any; wanting it off
    //PERMANENTLY, across every restart, is not a state this app was ever left
    //in — it was left on, and the switch existed to undo a default nobody
    //wanted.
    //
    //STOPPING IT STILL WORKS, AND SURVIVES A SAVE, which is the property that
    //made a setting look necessary and does not need one. ../core/cron honours
    //`autoStart` only for a job it has not seen before, and this half is rebuilt
    //on every save while the job is not — so a save cannot restart a queue
    //somebody stopped on purpose. Only starting the app does that, which is what
    //starting the app should mean.
    var cron = imports.cron;
    var JOB = 'queue';

    //THE JOB IS DECLARED BEFORE THE THING IT RUNS EXISTS, and armed after.
    //
    //`cron.add` is what makes the switch appear on the board; the tick is what
    //it does when started. Declaring both here would put the whole assembly
    //above every read in this file, so the job is registered with its rules and
    //given its `run` at the bottom, where the pieces are built. A job with no
    //`run` reports itself unarmed rather than pretending — see `armed` below,
    //which the board draws.
    //
    cron.add({
        name: JOB,
        every: TICK,
        about: 'Gives waiting work to free machines on this host',
        autoStart: true
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
    //NOT `actions.elsewhere`, WHICH THE NAME NOW SUGGESTS AND IT NEVER WAS.
    //
    //This is `actions.call` — it tries THIS app's table first and only falls
    //through to the app being ported from for what is not here yet. That is what
    //makes a moved action take over the moment it is defined, with nothing to
    //update here: `vmRuns`, `vmRunOutput`, `vmSessions` and `vmSessionTail` all
    //moved into ../runners and every caller below started reading this app's
    //answer without a line changing.
    //
    //The name is about what it was FOR rather than what it does. What it adds
    //over a plain call is the swallow: a queue that cannot reach one action
    //should report that one thing as unknown, not fail the whole board.
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
            tag: t.tag || null,
            //WHICH ISSUE IT IS FOR, so a board row can say so without a second
            //read. Null for most tasks.
            issue: t.issue || null
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
        //CUTTING A BRANCH, WHICH IS ../../repositories/branches' ACT AND NOT
        //THIS PLUGIN'S. Handed in as a lookup like every other gate here, so
        //./doors.js can offer "cut it and write the work on it" as one act
        //without this half growing an opinion about branch names. Its refusals
        //arrive unchanged.
        cutBranch: async function (it) {
            return await actions.call('branchCreate', {
                branch: it.branch, reason: it.reason, group: it.from, issue: it.issue || undefined
            });
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
        //ASKED FOR REAL, AND ASKED THE SAME WAY THE DISPATCH ASKS IT.
        //
        //THIS RETURNED `true` FOR EVERY PATH, so the gate in ./doors.js that
        //refuses a task naming a contract file that is not there could not
        //refuse anything. A stub easier to satisfy than the real thing, in the
        //shipping code rather than in a test.
        //
        //WHAT IT COST IS THE WHOLE POINT OF THAT GATE. ../runners/runs/briefing
        //resolves and reads the file when the task is GIVEN OUT, and throws if it
        //is missing — so the task was accepted, sat in the queue, took a machine,
        //and failed there. The moment it is written is the cheap moment to find
        //that out; this is what makes that true.
        //
        //`path.resolve` BECAUSE THAT IS WHAT THE OTHER END DOES. A relative path
        //that exists from the dashboard's working directory is one the dispatch
        //will find, and disagreeing about what a path MEANS would refuse tasks
        //that would have run.
        contractFileExists: async function (at) {
            try { return fs.existsSync(path.resolve(String(at))); }
            catch (e) { return false; }
        },

        //WHAT ARRIVED ON THE BRANCH, READ FRESH. `judge` refuses a verdict on an
        //empty branch, and a cached answer is the one thing that could make that
        //check pass on a branch nothing reached — see ../artifact.
        delivered: async function (branch) {
            return await imports.artifact.read(branch, { fresh: true });
        },
        job: async function (id) {
            var said = await relayed('jobs');
            var all = (said && said.jobs) || [];
            return all.filter(function (j) { return j.id === id; })[0] || null;
        },
        //THE PROMPT A BRIEF CAME FROM, so an edited task can still say where its
        //words started. Relayed like the rest of the library, and it goes the
        //day ../library's writes do.
        prompt: async function (id) {
            var said = await relayed('prompts');
            var all = (said && said.prompts) || [];
            return all.filter(function (p) { return p.id === id; })[0] || null;
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
    //---- THE GITHUB WATCH, WHICH THE TICK HAS CALLED SINCE IT WAS WRITTEN ----
    //
    //`tick.js` calls `watch()` at the top of every tick and this plugin never
    //supplied one, so it was the no-op default for the whole of that time, and
    //`watchGitHub` was a setting with a rationale and no consumer. See
    //./watching.js for the whether; the sweep itself is `repositoriesCheck`,
    //which already knows how to page and how to stop with room in the budget.
    var watch = makeWatching({
        on: async function () { return !!(await imports.settings.read()).watchGitHub; },
        sweep: function () { return actions.call('repositoriesCheck', {}); },
        warn: function (t) { imports.log.on('github').warn(t); }
    });

    //ON ITS OWN TIMER, NOT THE QUEUE'S. The queue job is armed and stopped by
    //default and stays that way until somebody starts it -- so a watch that
    //lived only on the queue's tick would never fire on a host that is not
    //dispatching, which is exactly the host somebody left to watch an issue
    //tracker. Same shape as `channel-silence`: from startup, every fifteen
    //seconds, and a no-op nineteen times out of twenty because ./watching.js
    //says no until five minutes have passed and the setting is on.
    //
    //THE TICK STILL CALLS `watch()` TOO. Harmless -- the same guards make the
    //second caller a no-op -- and it keeps the hook the tick has always had.
    cron.add({
        name: 'github-watch',
        every: 15000,
        autoStart: true,
        about: 'Asks GitHub what arrived, every five minutes while watchGitHub is on, and wakes the supervisor for a tag'
    });
    //`undo` IS DECLARED FURTHER DOWN, so this is held and pushed there. A free
    //identifier here compiles and dies at load, with every check green.
    var stopWatching = cron.does('github-watch', function () {
        return watch().then(function (swept) { return swept ? { swept: true } : null; });
    });

    var dispatch = makeDispatching({
        call: function (name, args) { return actions.call(name, args || {}); },
        watch: watch,
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
        //AND WHAT A JUDGEMENT HANDED BACK. Two drawers, two subjects: one is
        //what a run SAID, the other is what it DELIVERED.
        //
        //THE JUDGE LANE, AND IT WAS ALWAYS THIS ONE. Both readers below —
        //./papers, which gives a task the findings it is meant to work from, and
        //./onejudgement, which reads a judgement's own — want a JUDGEMENT's
        //files. The name `findings` said so; the store it was opened from did
        //not, and would have answered with a task's just as readily.
        findings: imports.artifact.handedBack('judge'),

        //WHAT THIS HOST HAS SPENT, beside the rest of its state.
        meter: imports.meter,

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
        //`given.all()` GIVES {name, job}; the board's word for those is machine
        //and task. Renamed here rather than in ../vms/busy, because what a
        //machine is being held FOR is this plugin's vocabulary.
        //
        //`given` AND NOT THE LOCK BESIDE IT. ../vms/busy/given.js is the queue's
        //ledger; `busy.all()` is the VirtualBox operation lock, which a job
        //takes and releases many times while it holds a machine. Reading that
        //one here would have called a machine in flight only during the seconds
        //it happened to be mid-rollback.
        var mine = busy.given.all();
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
    //WHAT A TASK HANDED BACK, asked of ../artifact rather than opened here.
    //
    //THIS SAID "THE SAME DRAWER THE JUDGE OPENS … so both ask ../core/archive
    //rather than one of them owning it and the other reaching in". The worry was
    //right and the answer was that nobody owned it: four plugins opened this
    //store directly, and the agreement was held together by everyone spelling it
    //the same way. ../artifact owns it now.
    //
    //THE WORKER LANE, NAMED ONCE. A task's files and a judgement's are separate
    //drawers, so `taskFiles` cannot answer with a judgement's by being handed a
    //uid that happens to exist — which is what a single drawer keyed by uid
    //allowed, and what nothing was checking.
    var artifacts = imports.artifact.handedBack('worker');

    var undo = [];
    undo.push(stopWatching);
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
            about: 'Write a task: what the work is, and the branch it delivers on. Give the task `cutFrom` (a line) '
                + 'and `reason` to cut that branch in the same act. Over the wire it also names the judgement '
                + 'that established the work is real',
            takes: ['task', 'becauseOf'],
            //THE GATE IS INSIDE ./doors.js AND NOT HERE, because it is a rule
            //about what a task IS rather than about this table. WHO ASKED is the
            //only thing this half knows that the door cannot.
            //
            //`_fromMachine` AND NOT `_overTheWire`. The judgement gate is about a
            //caller that cannot see the code, which is a machine — the command
            //line is the person building this app and reads every file in the
            //workspace. ../supervisor/guestapi.js sets `_fromMachine` to the name
            //of the machine that dialled in; the pipe in ../core/ipc never sets
            //it, and both doors strip every `_` key off what arrives first, so it
            //cannot be claimed. See the argument beside the gate in ./doors.js.
            run: async function (args) {
                var a = args || {};
                return await doors.create(a.task, {
                    fromMachine: a._fromMachine || null,
                    becauseOf: a.becauseOf
                });
            }
        }));

        //=======================================================================
        //TAKING A MACHINE OUT OF THE POOL, AND PUTTING IT BACK.
        //
        //THE SAME TWO ACTS THE TICK PERFORMS, done by a person instead of by the
        //loop: bring one up clean, and put it away. They are defined HERE, in the
        //plugin that owns the pool, because everything they need — who is free,
        //how a machine is brought up, how one is put away — is this plugin's, and
        //a second copy of "put a machine away" is the kind of duplication that is
        //discovered by a machine rather than by a reader.
        //
        //---- and why they had to exist ------------------------------------
        //
        //NOTHING COULD GIVE A MACHINE BACK. The queue keeps a machine it lost
        //sight of rather than rolling it back, and ../../inbox tells the person
        //it is theirs "until you give it back" — an instruction naming an action
        //this app did not have. `attempts.finished` relayed `vmReturn` to the app
        //being ported from, so finishing a task by hand was broken here too.
        //=======================================================================

        undo.push(actions.define('vmBorrow', {
            about: 'Take a machine out of the pool and bring it up clean, for a person to use. A tag asks for a kind of machine',
            takes: ['name', 'why', 'tag'],
            run: async function (args) {
                var a = args || {};
                var reason = String(a.why || '').trim() || 'somebody is using it';

                var said = await actions.call('vmList', {});
                var all = (said && said.vms) || [];
                //THE SAME PAIR queueState DRAWS THE POOL WITH — what is
                //running, whoever's tick is running it, keyed by machine. A
                //borrow that asked a different question from the board would
                //hand out a machine the board shows as busy.
                var free = policy.availability(all, busyAs(await busyNow()));

                var pick = a.name ? String(a.name) : null;

                if (pick) {
                    //A NAMED MACHINE THAT IS BUSY IS REFUSED IN THE QUEUE'S OWN
                    //WORDS rather than quietly swapped for a different one.
                    var row = free.filter(function (x) { return x.name === pick; })[0];
                    if (!row) throw new Error('There is no machine called "' + pick + '".');
                    if (!row.free) throw new Error('"' + pick + '" ' + row.why + '.');
                } else {
                    //OR A KIND OF MACHINE, WHICH IS WHAT A TAG IS FOR.
                    //
                    //"The first free machine" reaches whatever is idle, and on a
                    //host where somebody keeps working runners beside a test kit
                    //that is the wrong answer more often than the right one: the
                    //drills borrowed a runner because it happened to be free,
                    //gave it back rolled to its base snapshot, and looked like
                    //the queue behaving oddly.
                    //
                    //The tick already matches work to machines by tag and WAITS
                    //rather than falling back, so this refuses rather than
                    //quietly handing over an untagged machine.
                    var want = String(a.tag || '').trim().toLowerCase();
                    var tags = {};
                    all.forEach(function (v) {
                        tags[v.name] = (v.tags || []).map(function (t) { return String(t).toLowerCase(); });
                    });

                    var could = free.filter(function (x) {
                        return x.free && (!want || (tags[x.name] || []).indexOf(want) >= 0);
                    });

                    if (!could.length) {
                        throw new Error(want
                            ? 'No machine tagged "' + want + '" is free. ' + free.map(function (x) {
                                return x.name + ((tags[x.name] || []).length ? ' [' + tags[x.name].join(', ') + ']' : '')
                                    + ' ' + (x.free ? 'is free' : x.why);
                            }).join('; ') + '.'
                            : 'No machine is free. ' + free.map(function (x) {
                                return x.name + ' ' + (x.free ? 'is free' : x.why);
                            }).join('; ') + '.');
                    }
                    pick = could[0].name;
                }

                //CLAIMED BEFORE IT IS BROUGHT UP, so the next tick — at most
                //fifteen seconds away and possibly sooner — cannot take it while
                //it is starting.
                imports.ours.update(pick, { borrowed: { why: reason, at: new Date().toISOString() } });

                var to = imports.log.on('vm', pick);
                to.info('borrowed — ' + reason);

                try {
                    await dispatch.starting.bringUp(to, pick);
                } catch (e) {
                    //HANDED BACK ON FAILURE. A machine left borrowed by a
                    //bring-up that never finished is out of the pool with nobody
                    //using it, which is the failure this whole thing exists to
                    //avoid.
                    imports.ours.update(pick, { borrowed: null });
                    to.bad('could not bring it up, so it is back in the pool: ' + e.message);
                    throw e;
                }

                return {
                    name: pick,
                    why: reason,
                    note: pick + ' is yours until you give it back. The queue will not touch it, and '
                        + '"vmReturn --name ' + pick + '" puts it away clean.'
                };
            }
        }));

        //---- AND KEEPING ONE BACK WITHOUT TAKING IT --------------------
        //
        //A BORROW AND A KEEP-BACK ARE DIFFERENT THINGS. Borrowing says "I am
        //using this right now" and brings the machine up; this says "leave this
        //one out of the pool" and changes nothing else about it. A machine kept
        //back can sit powered off for a month.
        //
        //IT DOES NOT INTERRUPT ANYTHING, and that is said out loud on the answer.
        //Somebody pressing this while a task runs on that machine is asking for
        //it BACK, and would otherwise assume it had been freed at once.
        //---- AND WHO DECIDED IT, WHICH DECIDES WHO MAY UNDO IT -------------
        //
        //TWO DIFFERENT FACTS WORE ONE FIELD. `forTasks: false` meant both "a
        //person took this machine out of the pool" and "the DIY lane is holding
        //it while somebody sits in it", and nothing could tell them apart.
        //
        //IT COST A MACHINE. The DIY lane's give-back was guarded by a flag on
        //the SEAT, so when the seat went the fact went with it: ok-diy1 sat out
        //of the pool for two days, held by nothing, with the Runners button as
        //the only way out. And a rebuild PRESERVES a keep-back on purpose --
        //correct for a person's decision, wrong for a lane that no longer holds
        //the machine.
        //
        //SO IT IS WRITTEN ON THE MACHINE AND SAYS WHOSE IT IS. Any ending can
        //then give back what DIY took, and none of them may touch a keep-back
        //somebody made themselves.
        undo.push(actions.define('vmForTasks', {
            about: 'Let the queue use this machine, or keep it back for yourself',
            takes: ['name', 'enabled', 'by'],
            run: async function (args) {
                var a = args || {};
                var name = String(a.name || '').trim();
                var vm = imports.ours.get(name);

                //NO ARGUMENT MEANS TOGGLE IT, which is what a button does.
                //
                //THE PORTED LINE READ `!(vm.forTasks === false)` AND NEVER
                //TOGGLED ANYTHING. Kept back is `false`, so that gave false again
                //— still kept back; available is undefined, so it gave true —
                //still available. It normalised to the current value in both
                //directions, which is indistinguishable from a button that does
                //nothing, and looks exactly like the click not registering.
                //
                //Caught by pressing it twice rather than by reading it.
                var want = a.enabled === undefined || a.enabled === null
                    ? (vm.forTasks === false)
                    : !(a.enabled === false || a.enabled === 'false' || a.enabled === 'no' || a.enabled === '0');

                //LETTING GO ALWAYS CLEARS IT, whoever is letting go: once the
                //machine is back in the pool there is nothing left to hand back.
                //And a person keeping it back makes it THEIRS, which is why the
                //default is null rather than "leave what was there".
                var by = String(a.by || '').trim().toLowerCase();
                imports.ours.update(name, {
                    forTasks: want,
                    keptBackBy: want ? null : (by === 'diy' ? 'diy' : null)
                });

                var doing = busyAs(await busyNow())[name] || null;
                imports.log.on('vm', name).info(want ? 'available to the queue' : 'kept back from the queue');

                //---- AND WHAT IT SAYS HAS TO BE TRUE OF THIS MACHINE ---------
                //
                //"The queue may pick this up" IS NOT TRUE OF EVERY MACHINE. The
                //queue takes worker or judge and nothing else, so on anything
                //else both halves of this note promised or threatened something
                //that was never going to happen either way — and the press that
                //cleared a stale flag on a DIY machine answered "the queue may
                //pick this up", about a machine it will always leave alone.
                var inPlay = roles.takesQueuedWork(vm);

                return {
                    name: name,
                    forTasks: want,
                    //SAID SEPARATELY RATHER THAN FOLDED INTO THE SENTENCE, so
                    //anything reading this can tell "not held back" from "not
                    //something the queue takes".
                    inQueue: inPlay,
                    note: !inPlay
                        ? (want
                            ? 'Nothing is holding ' + name + ' back now. The queue still will not pick it up: it '
                                + 'takes worker or judge, and this is tagged '
                                + (((vm && vm.tags) || []).length ? vm.tags.join(', ') : 'nothing') + '.'
                            : 'Recorded, but it changes nothing: the queue takes worker or judge and would leave '
                                + name + ' alone anyway.')
                        : want
                            ? 'The queue may pick this up when it is free and clean.'
                            : doing
                                ? 'It is running ' + doing + ' and will finish that first — this stops it being picked '
                                    + 'up again, it does not interrupt it.'
                                : 'The queue will not pick this up. Nothing else about it changes.'
                };
            }
        }));

        undo.push(actions.define('vmReturn', {
            about: 'Give a borrowed machine back: put it away clean, or just release the claim',
            takes: ['name', 'keep'],
            run: async function (args) {
                var a = args || {};
                var name = String(a.name || '').trim();
                var keep = a.keep === true || a.keep === 'true';

                var vm = imports.ours.get(name);

                //"NOTHING TO GIVE BACK" IS ABOUT WHAT IT HOLDS, NOT ABOUT THE
                //BORROW.
                //
                //Refusing on the borrow alone reads as a tidy guard right up
                //until a machine exists that is claiming a branch and is NOT
                //borrowed — and then it is the only thing between that machine
                //and the one door that puts it away. The recovery path for a
                //stuck machine would refuse to run BECAUSE the machine is stuck.
                //
                //A CLAIM IS WHAT MATTERS MOST HERE: it is a standing permission
                //to push to a branch, and it outlives the borrow that created it.
                //Refusing to clear one is refusing to revoke.
                var holding = (vm && (vm.borrowed || vm.branch || vm.holdsCredential));
                if (!holding) {
                    throw new Error('"' + name + '" is not borrowed, claims no branch and holds no sign-in, '
                        + 'so there is nothing to give back.');
                }

                //ASKED WHAT IT IS HOLDING FIRST, because putting it away ROLLS IT
                //BACK, and a person working by hand is exactly who has
                //uncommitted work. The queue's own runs push before they finish;
                //a human in an editor has no such habit, and losing an afternoon
                //to a tidy-up button is not a mistake anybody makes twice.
                if (!keep) {
                    var holds = null;
                    try { holds = await actions.call('vmHolds', { name: name }); }
                    catch (e) { /* said below, if it said anything */ }

                    if (holds && holds.summary) {
                        throw new Error('"' + name + '" is still holding ' + holds.summary + '. Putting it away '
                            + 'rolls it back to its base snapshot, which discards that. Push it, or give it back '
                            + 'with keep=true to release the claim and leave the machine exactly as it is.');
                    }
                }

                imports.ours.update(name, { borrowed: null });

                if (keep) {
                    imports.log.on('vm', name).good('given back — left running, and free for the queue');
                    return { name: name, put: false, note: name + ' is back in the pool as it is. It is still running.' };
                }

                await dispatch.putting.putAway(name);
                return {
                    name: name, put: true,
                    note: name + ' is off, back at its base snapshot, and free for the queue.'
                };
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

        //AND TAKING ONE BACK OUT, which the board had no way to do — ../judge has
        //had `judgementUnqueue` since it was written and the task half of the
        //same board did not.
        //
        //IT IS NOT A TIDINESS ACTION. Work queued against a host that cannot
        //dispatch it sits looking inert and starts the moment that changes, so
        //without this the only ways out of the queue are to let it run or to
        //throw the task away — and one of those spends a machine on work
        //somebody decided against.
        undo.push(actions.define('taskUnqueue', {
            about: 'Take a task back out of the queue. Does not stop one already running',
            takes: ['id'],
            run: async function (args) {
                return await doors.unqueue((args || {}).id);
            }
        }));


        //---- AND THE SAME TWO DOORS FOR A JUDGEMENT -------------------------
        //
        //THESE WERE DEFINED IN ../judge, WHICH IS THE DRIFT. Putting a piece of
        //work into the queue is this plugin's rule: what may enter it, what goes
        //ahead of what, and what a finished record means. All three had an
        //answer here for a task and a second answer over there for a judgement,
        //written separately because judging arrived as its own system — and
        //two answers to one question is how they stop matching.
        //
        //THEY MOVED WITHOUT EITHER PLUGIN LEARNING ANYTHING NEW. This one
        //already consumes `judge` and holds its store, and ../judge keeps what
        //judging MEANS: what was read, what it found, what it concluded, what a
        //person decided.
        //
        //STILL TWO STORES, ONE LIFECYCLE. A judgement and a task are different
        //records — one carries a verdict and findings, the other a branch it
        //delivers on — and pretending otherwise would lose that. What they must
        //not have is two sets of rules about running.

        undo.push(actions.define('judgementQueue', {
            about: 'Put a judgement in the queue. It goes ahead of tasks, because it reads work that is '
                + 'already waiting',
            needs: 'workspace',
            takes: ['ref', 'id'],
            run: async function (args) {
                var a = args || {};
                var it = await imports.judge.get(a.ref || a.id);
                var ref = it.ref || imports.judge.refOf(it.number);

                //ALREADY DECIDED IS NOT REOPENED. The record of what was thought,
                //and when, is the thing being kept — a second reading is a second
                //judgement, with its own question and its own answer.
                if (it.state === 'done') {
                    throw new Error(ref + ' has already been decided. Ask for a new judgement rather than '
                        + 'reopening one — the record of what was thought, and when, is the thing being kept.');
                }

                //A PERSON'S JUDGEMENT HAS NO MACHINE IN IT. Queueing one would
                //hand a reading somebody meant to do themselves to a worker.
                if (it.by === 'person') {
                    throw new Error(ref + ' is for a person to read. The queue would give it to a machine '
                        + 'and run a worker over it. Record what you decide with judgementVerdict instead.');
                }

                //AND NOTHING TO RUN IS NOTHING TO QUEUE. A judgement without a
                //chain is an opinion with nothing behind it.
                if (!it.job) {
                    throw new Error(ref + ' has no job, so there is nothing for a machine to run. A '
                        + 'judgement without a chain is an opinion with nothing behind it.');
                }

                var queued = await imports.judge.update(it.id, { state: 'queued' });
                imports.log.on('judging', it.id).good(ref + ' queued — reads '
                    + ((it.subject && it.subject.name) || 'a change'));

                return Object.assign({}, queued, {
                    note: 'Queued ahead of any task waiting. A judgement reads work that is already waiting '
                        + 'to land; a task makes more of it.'
                });
            }
        }));

        undo.push(actions.define('judgementUnqueue', {
            about: 'Take a judgement back out of the queue. Does not stop one already running',
            needs: 'workspace',
            takes: ['ref', 'id'],
            run: async function (args) {
                var a = args || {};
                var it = await imports.judge.get(a.ref || a.id);
                var ref = it.ref || imports.judge.refOf(it.number);

                //ONE ALREADY GIVEN OUT IS NOT CALLED BACK BY THIS. The machine is
                //reading, and stopping it is a different act on a different
                //thing — said rather than silently doing half of it.
                if (it.state !== 'queued') {
                    throw new Error(ref + ' is "' + it.state + '", not queued. One already given out is not '
                        + 'called back by this — the machine is reading and would have to be stopped on it.');
                }

                return await imports.judge.update(it.id, { state: 'draft' });
            }
        }));

        //---- CHANGING ONE, AND THE TWO CALLERS THAT DO -----------------------
        //
        //A PERSON EDITING A DRAFT and the queue recording what happened to a run
        //go through the same door, because the identity pinning and the library
        //copying have to be true of both — see ./doors.edit.
        //
        //AND DEFINING IT HERE IS WHAT LETS THIS HOST DISPATCH AT ALL. Until now
        //the tick read this app's board through `tasks` and every write relayed
        //to the app being ported from: two boards, with every write landing on
        //the live one. ./tick refuses to dispatch while that is true and asks the
        //action table each time, so this line is what clears it.
        undo.push(actions.define('taskUpdate', {
            about: 'Change a task: what it says while it is a draft, and what happened to it once it has run',
            takes: ['id', 'task'],
            run: async function (args) {
                var a = args || {};
                return await doors.edit(a.id, a.task);
            }
        }));


        //---- AND THE SAME TWO FOR A JUDGEMENT -------------------------------
        //
        //MOVED OUT OF ../judge WITH THE PAIR ABOVE. Changing a piece of work and
        //throwing it away are acts the task half of this board has always had,
        //and having them twice meant two places deciding when work may be
        //edited — which had already produced two different answers about a
        //record whose run never started.
        //
        //THE RULES ABOUT WHAT A JUDGEMENT IS travelled with them, because they
        //read the record's own state and are the same shape as the ones above:
        //one out on a machine may not have what it is reading changed under it,
        //and a decided one is a record of what somebody thought rather than a
        //document to edit.

        undo.push(actions.define('judgementUpdate', {
            about: 'Change a judgement that has not been given out yet',
            needs: 'workspace',
            takes: ['ref', 'id', 'judgement'],
            run: async function (args) {
                var a = args || {};
                var it = await imports.judge.get(a.ref || a.id);
                var ref = it.ref || imports.judge.refOf(it.number);

                var patch = a.judgement;
                if (typeof patch === 'string') patch = JSON.parse(patch);
                patch = patch || {};

                if (it.state === 'given') {
                    var reading = Object.keys(patch).filter(function (k) { return READING.indexOf(k) >= 0; });
                    if (reading.length) {
                        throw new Error(ref + ' is out on ' + (it.machine || 'a machine') + ', so '
                            + reading.join(', ') + ' cannot be changed — changing what it is reading while it '
                            + 'reads it would make the record describe something that did not happen. How it '
                            + 'ENDED can still be recorded.');
                    }
                }

                if (it.state === 'done') {
                    throw new Error(ref + ' is decided. A judgement is a record of what somebody thought at a '
                        + 'moment — edit it and it stops being that. Ask for another one.');
                }

                return await imports.judge.update(it.uid || it.ref, patch);
            }
        }));

        undo.push(actions.define('judgementRemove', {
            about: 'Throw a judgement away. What it handed back is untouched',
            //---- BOTH NAMES, BECAUSE EVERY CALLER USED THE OTHER ONE --------
            //
            //THIS TOOK `ref` AND NOTHING SENT IT. The pane sends `id`, and so do
            //all six drills that tidy up after themselves — so `args.ref` was
            //undefined every time and this asked the store to remove the string
            //"undefined". Pressing "Throw it away" on J4 answered "There is no
            //judgement \"undefined\"" while the panel beside it was showing J4.
            //
            //AND IT WAS SILENT FOR AS LONG AS IT WAS WRONG. Every drill wraps
            //this in `try { ... } catch { /* already gone */ }`, which is a fair
            //thing to write and turns a call that CANNOT work into one that
            //looks like it had nothing to do. The judgements those drills made
            //are all still on the board.
            //
            //`../judge/store.js`’s remove ALREADY TAKES SEVERAL KINDS OF HANDLE — a number, a
            //uid, a ref, a name — so being fussy about which WORD carries it
            //was a strictness that bought nothing and cost every caller.
            takes: ['ref', 'id'],
            //THE REFUSAL FOR ONE THAT IS OUT ON A MACHINE IS IN ../judge/store.js,
            //because it is a rule about the record rather than about this table.
            run: async function (args) {
                var a = args || {};
                var which = a.ref != null ? a.ref : a.id;
                if (which == null || String(which).trim() === '') {
                    throw new Error('Say which judgement to throw away. A number like J3, a uid or a name all work.');
                }
                return await imports.judge.remove(which);
            }
        }));

        undo.push(actions.define('taskRemove', {
            about: 'Throw a task away. Its branch, and the logs kept for it, are untouched',
            takes: ['id'],
            run: async function (args) {
                return await doors.remove((args || {}).id);
            }
        }));

        //---- A PERSON'S DECISION, WHICH IS NOT A MERGE ---------------------
        //
        //NOT A SUPERVISOR'S, AND THAT IS WRITTEN DOWN WHERE THE FENCE IS —
        //../supervisor/allowed.js leaves `taskJudge` off the list on purpose: a
        //verdict decides whether work was any good, and a supervisor judging its
        //own delivery is a worker marking its own homework.
        //
        //The rule about WHO is stated there rather than restated here, because
        //one fence with a reason beside each line is the whole design of that
        //file. What is here is what a verdict IS.
        undo.push(actions.define('taskJudge', {
            about: 'Record a verdict on what a task delivered',
            needs: 'workspace',
            takes: ['id', 'verdict', 'note'],
            run: async function (args) {
                var a = args || {};
                return await doors.judge(a.id, a.verdict, a.note);
            }
        }));

        //---- AND SAYING ONE TAKEN BY HAND IS OVER ---------------------------
        //
        //THE MACHINE GOES BACK THROUGH THE SAME DOOR AS EVERYTHING ELSE, so the
        //same refusal applies: anything uncommitted stops this, because putting a
        //machine away rolls it back. ./attempts.js owns that.
        undo.push(actions.define('taskFinished', {
            about: 'Say a task you took by hand is finished: give the machine back and put it up '
                + 'for a verdict',
            needs: 'workspace',
            takes: ['id', 'keep'],
            run: async function (args) {
                var a = args || {};
                return await attempts.finished(a.id, a.keep === true || a.keep === 'true');
            }
        }));

        //---- EVERY ATTEMPT AT ONE TASK, AND WHAT ITS WORKER IS DOING NOW ----
        //
        //THE DECIDING IS ./attempts.js's, all of it — which attempt is running,
        //which never started, and which had no run to start with. What is here
        //is the door.
        //
        //IT PULLS EACH FINISHED RUN'S LOG ACROSS AND KEEPS IT, which is why this
        //is more than a read and why it happens on being ASKED rather than on a
        //timer: this is the moment somebody is looking at the work, and a run
        //nobody has looked at since it ended is exactly the one whose machine
        //has not been touched yet. The machine is the disposable half of this
        //tool, and a rollback takes the only account of what happened with it.
        undo.push(actions.define('taskProgress', {
            about: 'Every attempt at a task, and what its worker is doing right now',
            needs: 'workspace',
            takes: ['id', 'lines'],
            run: async function (args) {
                var a = args || {};
                return await attempts.progress(a.id, {
                    lines: a.lines == null ? 12 : Number(a.lines)
                });
            }
        }));

        //---- WHY A RUN DID WHAT IT DID --------------------------------------
        //
        //`taskProgress` AND `judgementFindings` ANSWER WHAT HAPPENED. This
        //answers why, and it is the only thing that does: the transcript of the
        //run itself, kept on this host so it survives the machine being rolled
        //back underneath it.
        //
        //THE DRAWER IS ALREADY FULL AND NOTHING COULD READ IT. Every run's
        //output has been kept — see ./onetask.js and ./onejudgement.js, which
        //fetch it before the machine is put away, exactly so this question can
        //be asked later — and no door opened it. The logs were being written for
        //a reader that did not exist.
        //
        //ONE DRAWER, TWO KINDS, TWO DOORS. A judgement's log is a run's log and
        //is filed the same way; what differs is only which record holds the uid,
        //so somebody looking for it should not have to know which kind of work
        //produced it. Two doors rather than one taking a kind, because the ids
        //are different vocabularies — #32 is a task and J29 is a judgement, and
        //a single door would have to guess which was meant.
        function aLog(what, uidOf) {
            return async function (args) {
                var a = args || {};
                var it = await uidOf(a);

                var kept = archive.list(it.uid);

                if (!a.run) {
                    return Object.assign({}, it.said, {
                        attempts: kept,
                        //NOTHING KEPT IS NOT THE SAME AS NOTHING SAID, and the
                        //difference is worth a sentence: anything that ran
                        //before this app started keeping logs has none, and no
                        //amount of asking will produce one.
                        note: kept.length
                            ? kept.length + ' attempt(s) kept. Ask again with `run` for one of them.'
                            : 'Nothing was kept for this. Anything that ran before this app began keeping '
                                + 'logs has none — the machine was rolled back and the output went with it.'
                    });
                }

                var one = archive.read(it.uid, a.run, { lines: a.lines == null ? 200 : Number(a.lines) });

                //`found: false` RATHER THAN A THROW, which is this drawer's
                //shape — see ./archive.js. Turned into a refusal here because a
                //caller that asked for one run by name wants to be told it is
                //not there, not handed an object that reads as an empty log.
                if (!one.found) {
                    throw new Error('Nothing was kept for "' + a.run + '" — ' + one.why + '. Ask without a '
                        + 'run to see which attempts there are.');
                }
                return Object.assign({}, it.said, one);
            };
        }

        undo.push(actions.define('taskLog', {
            about: "One attempt's output from a task, kept on this host so it survives the machine",
            needs: 'workspace',
            takes: ['id', 'run', 'lines'],
            run: aLog('task', async function (a) {
                var task = await store.get(a.id);
                if (!task) {
                    throw new Error('There is no task "' + a.id + '". Ask for "tasks" to see what there is.');
                }
                return { uid: task.uid, said: { task: task.id, number: task.number, title: task.title } };
            })
        }));

        undo.push(actions.define('judgementLog', {
            about: "One attempt's output from a judgement, kept on this host — the only thing that says why "
                + 'one came back empty',
            needs: 'workspace',
            takes: ['id', 'ref', 'run', 'lines'],
            //IT EXISTS BECAUSE ITS ABSENCE WAS EXPENSIVE, and twice. In the app
            //this is ported from, a supervisor looking for why J41 came back
            //empty asked `taskLog` three times and was refused three times: a
            //judgement is not a task, and that was the only log-reading tool
            //there was. Here it was worse — the verb was on the supervisor's
            //list, so it was offered as a tool, and answered nothing at all.
            //
            //AND J26 IS WHAT IT IS FOR. That judgement came back empty on 27
            //August because the runner started `claude` with no input and gave
            //up in sixteen seconds. From outside, that is identical to a judge
            //that read the change and found nothing — and the second is an
            //answer while the first is a machine fault that will happen again.
            run: aLog('judgement', async function (a) {
                var it = await imports.judge.get(a.ref || a.id);
                if (!it) {
                    throw new Error('There is no judgement "' + (a.ref || a.id) + '". Ask for "judging" to '
                        + 'see what there is.');
                }
                return { uid: it.uid, said: { judgement: it.id, ref: it.ref || imports.judge.refOf(it.number) } };
            })
        }));

        //---- AND WHAT ARRIVED ON ITS BRANCH ---------------------------------
        //
        //NEVER CACHED, and that is the whole note. This is what somebody judges
        //from, and reading a four-second-old picture of a branch is exactly the
        //wrong moment to be reading a stale one.
        undo.push(actions.define('taskArtifact', {
            about: "What arrived on a task's branch: commits and files, per repository",
            needs: 'workspace',
            takes: ['id'],
            run: async function (args) {
                var task = await store.get((args || {}).id);
                return await artifact.read(task.branch, { fresh: true });
            }
        }));

        //---- ONE REPOSITORY'S CHANGES, IN FULL ------------------------------
        //
        //WHICH REPOSITORY IS ASKED FOR RATHER THAN GUESSED. A task's branch can
        //exist in several, and picking one would answer a question nobody put —
        //the refusal names what is missing instead.
        undo.push(actions.define('taskDiff', {
            about: "One repository's changes on a task's branch, in full",
            needs: 'workspace',
            takes: ['id', 'repo', 'file'],
            run: async function (args) {
                var a = args || {};
                if (!a.repo) throw new Error('Say which repository.');

                var task = await store.get(a.id);
                return {
                    task: task.id,
                    repo: a.repo,
                    branch: task.branch,
                    file: a.file || null,
                    diff: await artifact.diff(a.repo, task.branch, a.file)
                };
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

                //BY THE NAME `taskFiles` PRINTS, WHICH IS NOT THE ONE ON DISK.
                //
                //A file is kept as `<run>--<name>`, and the list shows the short
                //name — the one the job was TOLD to write. Reading matched the
                //on-disk name only, so `taskFiles` printed `handover.txt` and
                //`taskFileRead --file handover.txt` answered "there is no file
                //called that", about a file it had just listed.
                //
                //../artifact RESOLVES IT, because the drawer is its and ../judge
                //wanted the same answer. An exact match always wins; two runs
                //that both handed back one name are refused rather than guessed
                //at.
                var want = String(a.file || '');
                var found = await artifacts.find(task.uid, want);

                if (!found.one && found.many) {
                    throw new Error('#' + task.number + ' handed back ' + found.many.length + ' files called "'
                        + want + '", from different runs. Name the one that is meant: '
                        + found.many.map(function (f) { return f.file; }).join(', ') + '.');
                }
                if (!found.one) {
                    throw new Error('#' + task.number + ' handed back nothing called "' + want + '". It handed back: '
                        + (found.handed.map(function (f) { return f.name || f.file; }).join(', ') || 'nothing at all')
                        + '.');
                }

                var said = await artifacts.read(task.uid, found.one.file);
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
        //STARTING THE QUEUE IS NOT A PERSON'S PRESS, AND IT WAS.
        //
        //It refused over the wire, with a paragraph here saying why: switching
        //it on means this host rolls a machine back, hands it a credential and
        //runs instructions on it unattended, so nothing reachable over a socket
        //may decide that.
        //
        //WHAT WAS WRONG WITH IT is that the thing it describes has already been
        //decided by then. Nothing is waiting here that was not built from a job,
        //a prompt and a contract somebody read and approved, and approving is
        //what refuses over the wire — ../library/server.js, "a model may write
        //one and may not ratify its own". This was a second gate on the timer
        //that hands out already-approved work, and the run it guards is the same
        //run whether the tick starts it or somebody presses Run now.
        //
        //IT WAS NOT FREE. The queue stopped dead on every restart, and a
        //`main.js` edit IS a restart — during this port, several times an hour.
        //What it asked for was not a decision; it was the same yes typed again
        //because the app had been rebuilt, which is how a gate stops being read
        //and starts being cleared.
        //
        //STOPPING WAS NEVER REFUSED AND STILL IS NOT. Anything that can see
        //something going wrong should be able to stop new work being picked up.
        //That asymmetry was right and is untouched.
        //=================================================================
        undo.push(actions.define('queueStart', {
            about: 'Start handing queued work to machines on this host',
            takes: ['why'],
            run: function (args) {
                var a = args || {};
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
                var held = busy.given.all().map(function (r) { return { machine: r.name, task: r.job }; });
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
                    //THE SIGN-IN CHECK IS APPLIED HERE NOW, and it did not used
                    //to be. It was left out while the Runners half was still in
                    //the app being ported from, and what this said was that a
                    //row shown as going out may still wait for a credential.
                    //
                    //THAT SENTENCE OUTLIVED THE THING IT DESCRIBED. `guests` is
                    //consumed by this plugin and ../runners/guests answers
                    //`forQueue` — the tick has been asking it, through
                    //./dispatching, the whole time. So the board was the only
                    //reader that could not see why work was not going out, and
                    //the person watching it is the one who has to do something
                    //about it: a paused sign-in is fixed by signing in again,
                    //and nothing else on this host can do that for them.
                    //
                    //STILL NOT A SECOND COPY OF THE RULE. It runs the same
                    //`policy.plan` a tick dispatches by, given the same answer
                    //from the same place — which is the only arrangement where
                    //the board and the tick cannot come to disagree.
                    plan: (function () {
                        //A BOARD IS WORTH DRAWING WITHOUT THIS. If the sign-ins
                        //cannot be read the plan is still the truth about
                        //machines and order, and `signInCheck` says which of the
                        //two answers this is rather than leaving a reader to
                        //assume the stricter one.
                        var signIns = null;
                        try { signIns = imports.guests.forQueue(); } catch (e) { signIns = null; }

                        var p = policy.plan(waiting, vms, { inFlight: doing, signIns: signIns });
                        return {
                            next: p.dispatch,
                            waiting: p.waiting.map(function (w) { return { ref: w.ref, why: w.why }; }),
                            free: p.free,
                            signInCheck: !!signIns,
                            signIns: signIns,
                            about: signIns
                                ? 'What the tick would do with what is waiting now, including whether a sign-in is '
                                    + 'free to give it — the same check, from the same place, that a tick dispatches by.'
                                : 'What the tick would do with what is waiting now. The sign-ins could not be read, so '
                                    + 'a row shown as going out may still wait for one.'
                        };
                    })(),

                    order: policy.ORDER,
                    every: (TICK / 1000) + 's',
                    tickHere: clock.armed(),

                    //`autoStart` IS NOT ON THIS ANSWER ANY MORE, because it is no
                    //longer a question. The queue comes up running, always — see
                    //the argument at `cron.add` above. What is left is `ticking`,
                    //which is what is happening NOW, and that was always the half
                    //somebody actually wanted.
                    //
                    //A READER THAT STILL ASKS FOR IT GETS `undefined` RATHER THAN
                    //`false`, and that is the honest answer: false would mean "it
                    //will not come up running", which is not true of any host.

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
                        //---- AND OTHERWISE, WHETHER ANY OF IT IS GOING TO HAPPEN
                        //
                        //THIS SENTENCE WAS LEFT BEHIND BY THE THING IT DESCRIBED.
                        //It said "nothing here dispatches yet — what is running is
                        //being run by the app this is being ported from" for as
                        //long as it took the tick to move over, and went on saying
                        //it afterwards. `tickHere` sat two lines above it
                        //answering true.
                        //
                        //A NOTE THAT IS PROSE GOES STALE; ONE BUILT FROM THE
                        //FIELDS BESIDE IT CANNOT. The comment above `inFlight`
                        //was updated when the tick moved and this was not, which
                        //is exactly the drift — so it now says what `ticking` and
                        //`tickHere` say, and there is nothing left to remember to
                        //change.
                        : !clock.armed()
                            ? 'The tick is not armed on this host, so nothing here will be given out. That is the '
                                + 'moment after a save — this half is rebuilt and the job is not — and it comes back by itself.'
                            : clock.running()
                                ? 'The queue is running on this host. It looks every ' + (TICK / 1000) + 's and gives '
                                    + 'waiting work to free machines.'
                                : 'THE QUEUE IS STOPPED, so nothing here is waiting to be picked up — it is waiting for '
                                    + 'somebody to start it, in the window, under Settings and Cron. It comes up stopped '
                                    + 'every time and on purpose: it rolls a real machine back, hands it a credential, '
                                    + 'and runs instructions on it unattended.'
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

            //AND NOT WHAT THIS HOST HAS SPENT. `spent` was here, re-exporting
            //the meter, back when the queue owned that record — and it is
            //../meter's now, with two readers. A second door onto somebody
            //else's store is how "which of these is the real one" becomes a
            //question, so the queue WRITES rows through the service it consumes
            //and hands nobody a way to read them back through it.
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });

    //---- AND THE CLOCK IS GIVEN THE THING IT RUNS --------------------------
    //
    //LAST, DELIBERATELY. Everything above is a declaration; this is the line
    //after which this host can give a real machine real work. Arming is not
    //starting, and the two stay apart: a job with no `run` reports itself
    //unarmed rather than pretending. Whether it comes up RUNNING is decided
    //where the job is registered at the top of this file, and the answer is
    //always yes.
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
