var fs = require('fs');
var path = require('path');

var makeAsking = require('./asking');
var makeBriefing = require('./briefing');
var makeFolder = require('./folder');
var makeJobOrder = require('./joborder');

//---------------------------------------------------------------------------
//WORK IN FLIGHT ON A MACHINE: GIVING IT OUT, FOLLOWING IT, STOPPING IT.
//
//SEPARATE FROM ../machines, WHICH IS THE LIFECYCLE. That plugin starts a
//machine, stops it, photographs it and rolls it back — things done TO a machine.
//This is about the work a machine is holding, which has its own lifetime: a run
//outlives the command that started it, survives this app being restarted, and
//is read back afterwards rather than waited for.
//
//The app being ported from splits them the same way — actions/machines.js and
//actions/runs.js — and the reason shows up in the refusals. Everything here
//refuses a machine that is not dialled in, because everything here is a question
//put TO the machine; half of ../machines works on one that is off, and must.
//
//---- what is here and what is not -----------------------------------------
//
//THE SHELL IS ../../vms/dispatch's, all of it. What a run is, how one is
//started detached, how the guest records it, what the watcher writes — none of
//that is here, and this file builds no shell of its own. It is the door: who may
//ask, of which machine, and what the answer meant.
//
//`vmSessions` and `vmSessionTail` are the OTHER half of following a run — what
//the agent said, rather than what its process printed. Both are worth having and
//they answer different questions: a crash before the agent ever started thinking
//appears here and nowhere in a transcript. Those two are ../sessions'.
//---------------------------------------------------------------------------

plugin.consumes = ['app', 'log', 'dispatch', 'ours', 'channel', 'secret',
    //FOR `vmDispatch` ONLY, and each for one question:
    //  whatIsOn        whether this is a continuation, and of what
    //  sessions        where that conversation is filed, and what it must be told
    //  vbox, guestApi  where a guest hands an artifact back to
    //  repoWorkspaces  whether `--folder` is a path on the machine or on this host
    'whatIsOn', 'sessions', 'vbox', 'guestApi', 'repoWorkspaces',
    //AND FOR `jobRun`:
    //  library   the job, the prompt and the contract, each with its approval
    //  queue     the task a job may be run for
    //  judge     the judgement it may be run for instead
    'library', 'queue', 'judge'];
plugin.provides = [];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log;

    var dispatch = imports.dispatch;
    var channel = imports.channel;
    var sessions = imports.sessions;

    var asking = makeAsking({
        ours: imports.ours,
        connected: channel.connected
    });

    //WHERE WORK RUNS ON THE MACHINE — see ./folder.js for the silent fallback
    //this exists to close, and why the app being ported from closed it for jobs
    //and not for tasks.
    var folder = makeFolder({
        homeOf: async function (name) {
            var r = await channel.run(name, 'printf "%s\\n" "$HOME"',
                { what: 'where its home is', timeout: 15000 });
            return String((r && r.output) || '').trim().split('\n').pop().trim();
        },
        defaultFor: function (name) {
            var vm = imports.ours.get(name);
            return imports.repoWorkspaces.folderFor(vm && vm.spec);
        }
    });

    var order = makeJobOrder({
        jobs: imports.library.jobs,
        prompts: imports.library.prompts,
        contracts: imports.library.contracts,
        //THE SCRIPT, NOT JUST THE RECORD. See ./joborder.js: a job entry
        //describes its code and does not carry it.
        codeFor: imports.library.codeFor
    });

    var briefing = makeBriefing({
        readFile: function (at) { return fs.readFileSync(at, 'utf8'); },
        exists: function (at) { return fs.existsSync(at); },
        resolve: function (p) { return path.resolve(String(p)); },
        basename: function (p) { return path.basename(p); }
    });

    var undo = [];

    if (actions) {
        //---- GIVING A MACHINE A TASK, AND LETTING GO OF IT ------------------
        //
        //RETURNS AS SOON AS THE WORK HAS STARTED, NOT WHEN IT ENDS. A task runs
        //for minutes or an hour; waiting would make one command look like a
        //hang, hold the machine against anything else, and give no progress in
        //the meantime. Progress is read afterwards with `vmSessionTail`, which
        //is a delta with a bookmark rather than a stream nobody is watching.
        //
        //NOTHING HERE CARRIES A CREDENTIAL, and that is a correction rather than
        //an omission. The first version of this passed one as an environment
        //assignment on the command that starts the run — which the agent
        //inherits, and can print. Transcripts are captured to this host and
        //KEPT, so a credential reaching agent-visible output is copied out and
        //filed by design. A worker is signed in separately, through its own
        //credential file, which is Claude Code's and not something the agent is
        //handed a copy of.
        undo.push(actions.define('vmDispatch', {
            about: 'Give a machine a task to work on, and return without waiting for it',
            takes: ['name', 'task', 'folder', 'contract', 'rules', 'contractName', 'resume', 'shell'],
            run: async function (args) {
                var a = args || {};
                asking.reachable(a.name, 'it cannot be given work');
                if (!a.task || !String(a.task).trim()) throw new Error('Say what the task is.');

                var to = log.on('vm', a.name);

                //---- WHICH RULES, DECIDED BEFORE ANYTHING IS STARTED --------
                var under = briefing.rulesFor(a);

                //---- A CONTINUATION SAYS SO ---------------------------------
                //
                //Wrapped, because a brief that could not be annotated is still
                //the brief — and refusing to dispatch because the memory folder
                //could not be read would stop work over a note about it.
                //
                //See ../sessions/keying.js for what it says and why it lives
                //there rather than here: this is one of TWO paths to a worker,
                //and writing the words at this end is how the first version of
                //it never once fired.
                var task = String(a.task);
                try {
                    var doing = await imports.whatIsOn(a.name);
                    var kept = doing ? await sessions.get(sessions.keyFor(doing)) : null;
                    task = makeBriefing.briefWith(sessions.announcement(doing, kept), task);
                } catch (e) { /* a brief that could not be annotated is still the brief */ }

                //---- AND WHETHER ITS WORKER CAN AUTHENTICATE AT ALL ---------
                //
                //ASKED BEFORE ANYTHING IS SET UP, because a worker that cannot
                //authenticate does not fail as "signed out" — it fails as an api
                //error in a json blob, minutes later, after a workspace has been
                //laid out and a run recorded. The first task ever given out
                //failed exactly that way and nothing between the button and the
                //log said the obvious thing.
                //
                //ASKED OF THE MACHINE rather than read from the registry. A
                //machine can be signed in three ways — handed a credential,
                //signed in on itself, or carrying a key in its environment — and
                //the registry only knows about the first. Refusing a machine
                //that could in fact work is a worse fault than the one being
                //fixed.
                //
                //A SHELL RUN HAS NO WORKER IN IT, so being signed out is beside
                //the point: refusing one would mean refusing a soak because a
                //credential it will never touch is missing.
                if (!a.shell) {
                    var able = await channel.run(a.name,
                        'if [ -s "$HOME/.claude/.credentials.json" ] || [ -n "${ANTHROPIC_API_KEY:-}" ]; '
                        + 'then echo okc-can-authenticate; fi',
                        { what: 'checking its worker can authenticate', timeout: 30000 });

                    if (!/okc-can-authenticate/.test(able.output || '')) {
                        throw new Error('"' + a.name + '"\'s worker is signed out, so the work would fail '
                            + 'the moment it started. Hand it the credential first: vmCredentialsPut '
                            + '--name ' + a.name);
                    }
                }

                var id = dispatch.newId();

                //---- WHERE IT RUNS, RESOLVED AGAINST THE MACHINE'S OWN HOME --
                //
                //NOT PASSED THROUGH AS WRITTEN, which is what the app being
                //ported from does here and is why every task on a default folder
                //has been running in the home directory. The default IS a shell
                //expansion and everything sent to a guest is single-quoted, so
                //`cd '$HOME/workspace'` fails and the line ends `|| cd "$HOME"`.
                //See ./folder.js.
                var where = await folder.on(a.name,
                    imports.repoWorkspaces.guestPath(a.folder, '--folder'));

                //---- WHERE THIS HOST CAN BE REACHED --------------------------
                //
                //Worked out here rather than left for the guest to assemble. The
                //machine already knows the address; what it does not know is
                //which port artifacts go to, and telling it is cheaper than
                //putting another value in its environment and re-provisioning to
                //get it there.
                //
                //NO ADDRESS MEANS NO HELPER, AND THE RUN STILL RUNS. What is
                //lost is the ability to hand something back, which is worth less
                //than the work.
                var base = null;
                try {
                    var at = await imports.vbox.hostAddress();
                    if (at) base = 'https://' + at + ':' + imports.guestApi.PORT;
                } catch (e) { /* no address means no helper */ }

                var r = await channel.run(a.name, dispatch.script({
                    id: id,
                    task: task,
                    folder: where,
                    contract: under.rules,
                    resume: a.resume,
                    shell: !!a.shell,
                    base: base
                }), { what: 'dispatching ' + id, timeout: 60000 });

                //---- STARTED IS NOT DISPATCHED ------------------------------
                //
                //The guest prints a marker once the work is detached and
                //running. Without this, a script that failed on its first line
                //returns exactly like one that started an hour of work.
                if (!/okc-dispatched/.test(r.output || '')) {
                    throw new Error('"' + a.name + '" did not start the work: '
                        + (String(r.output || '').trim().split('\n').pop() || 'it said nothing'));
                }

                to.good(a.name + ' is working on ' + id
                    + (under.rules ? ', under ' + under.named : ''));

                return {
                    run: id,
                    machine: a.name,
                    folder: where,
                    //SAID PLAINLY, because "no rules" is the dangerous one and
                    //it is also the silent one — a run without a contract looks
                    //exactly like a run with one from everywhere except here.
                    contract: under.rules ? (under.at || under.named) : null,
                    watch: 'okc.js vmSessionTail --name ' + a.name,
                    note: 'started, not finished — read its session for progress and vmRuns for the outcome'
                };
            }
        }));

        //---- SENDING A JOB TO A MACHINE ------------------------------------
        //
        //THE SAME MACHINERY AS A TASK, not a parallel one. ../../vms/dispatch
        //already writes a run directory, detaches the work, records a pid and a
        //status and keeps the log. A job is a third mode beside `claude -p` and
        //`bash`: `node`, with a small API written beside the script.
        //
        //WHAT IT MAY RUN IS ./joborder.js's, all of it — the approvals, where
        //the words come from, and the refusal to send a prompt without the
        //contract it was approved with.
        undo.push(actions.define('jobRun', {
            about: 'Send a job to a machine and let it run there, with a prompt — or with what a task '
                + 'or a judgement carries',
            needs: 'workspace',
            takes: ['id', 'promptId', 'task', 'judgement', 'name', 'folder'],
            run: async function (args) {
                var a = args || {};

                var job = await order.jobFor(a.id);

                //---- A MACHINE IS REQUIRED, AND REFUSED RATHER THAN CHOSEN ---
                //
                //Which machine a job runs on decides what it can see and what it
                //leaves behind, and picking one quietly is how work lands
                //somewhere nobody meant. The refusal lists what IS connected,
                //because that is the question behind the mistake.
                if (!a.name) {
                    var free = (imports.ours.read() || [])
                        .filter(function (v) { return channel.connected(v.name); })
                        .map(function (v) { return v.name; });
                    throw new Error(free.length
                        ? 'Say which machine. Connected right now: ' + free.join(', ') + '.'
                        : 'Say which machine — and none is connected right now, so start one first.');
                }

                asking.reachable(a.name, 'it cannot be given anything');
                var vm = imports.ours.get(a.name);
                var to = log.on('job', a.id, a.name);

                //---- THE WORKER CREDENTIAL, BECAUSE A JOB MAY START ONE ------
                //
                //The queue does three things before it dispatches a task — bring
                //the machine up, hand it the credential, set the workspace up —
                //and a job dispatched here did none of them. That was invisible
                //until the API grew `claude()`: a job that ran a worker got
                //`Not logged in · Please run /login` every time, on a machine
                //whose only fault was that nobody had given it the credential
                //this host had been holding since yesterday.
                //
                //NOT FATAL, ON PURPOSE. Most jobs never start a worker, and a
                //machine that cannot be given one is a reason to say so rather
                //than to refuse work that does not need it — `claude()` will say
                //the same thing far more precisely if it turns out to matter.
                //
                //WHICH SIGN-IN, FROM THE JOB. A judge job wants a judge's
                //identity and a task job a worker's, and on a machine tagged as
                //both nothing else can answer it.
                var role = job.kind === 'judge' ? 'judge' : 'worker';
                try {
                    await actions.call('vmCredentialsPut', { name: a.name, role: role });
                } catch (e) {
                    to.warn(a.name + ' has no ' + role + ' credential — a job that starts one will be '
                        + 'refused: ' + e.message);
                }

                //---- WHAT IT IS TOLD -----------------------------------------
                if (a.task && a.judgement) {
                    throw new Error('Run it for a task or for a judgement, not both — they are '
                        + 'different pieces of work and the run belongs to one of them.');
                }

                //---- AWAITED, WHICH IT WAS NOT --------------------------
                //
                //BOTH STORES READ FROM DISK AND BOTH `get`s ARE ASYNC. Neither
                //was awaited, so `work` was a PROMISE — and a promise is an
                //object, so `if (!work)` was satisfied and the run carried on
                //holding it. Every field read off it afterwards was undefined.
                //
                //IT FAILED AS "#undefined has no brief, so there is nothing to
                //give the job", which names neither the real fault nor the piece
                //of work: `work.ref` and `work.number` are both absent on a
                //promise, so even the thing being refused could not be printed.
                //
                //THIS PATH HAD NEVER WORKED, for a task or for a judgement. It
                //is the last step before a job is handed to a machine, so
                //everything upstream — the queue, the tick, the claim, the boot,
                //the credential handover — was correct and the run died at the
                //door. The drills that would have caught it need real machines
                //and are skipped without them.
                var work = null;
                if (a.task) {
                    work = await imports.queue.task.get(a.task);
                    if (!work) throw new Error('There is no task called "' + a.task + '".');
                } else if (a.judgement) {
                    work = await imports.judge.get(a.judgement);
                    if (!work) throw new Error('There is no judgement called "' + a.judgement + '".');
                }

                //---- A CONTINUATION SAYS SO, AND THIS IS THE PATH THAT MATTERS
                //
                //The brief becomes the job's prompt in ./joborder.js, so the
                //announcement has to be on the brief before it gets there.
                //
                //THIS IS THE PATH THE FIRST VERSION MISSED. It was written into
                //vmDispatch alone, where it never once fired: a task with a JOB
                //never touches vmDispatch, and every task in the drill that
                //found the problem has one. See ../sessions/keying.js.
                if (work && work.brief) {
                    try {
                        var doing = {
                            kind: a.judgement ? 'judgement' : 'task',
                            id: work.id,
                            uid: work.uid,
                            item: work
                        };
                        var kept = await sessions.get(sessions.keyFor(doing));
                        var said = sessions.announcement(doing, kept);
                        if (said) {
                            work = Object.assign({}, work, {
                                brief: makeBriefing.briefWith(said, work.brief)
                            });
                            //SAID OUT LOUD, because whether this fired is
                            //otherwise only answerable by reading the code —
                            //which is how the first version went unnoticed while
                            //never firing at all. A brief is not in the run log,
                            //so nothing downstream can show it either.
                            to.info('this brief is announced as a continuation — it resumes a '
                                + 'conversation begun by other work on this subject');
                        }
                    } catch (e) { /* a brief that could not be annotated is still the brief */ }
                }

                var told = await order.whatItIsTold({
                    work: work,
                    promptId: work ? null : (a.promptId || job.promptId || null)
                });

                //---- AND WHERE IT RUNS ---------------------------------------
                var where = await folder.on(a.name,
                    imports.repoWorkspaces.guestPath(a.folder, '--folder'));

                var base = null;
                try {
                    var at = await imports.vbox.hostAddress();
                    if (at) base = 'https://' + at + ':' + imports.guestApi.PORT;
                } catch (e) { /* no address means no helper, and the job still runs */ }

                var runId = makeJobOrder.runIdFor(a.id, Date.now());

                to.info('sending "' + job.name + '" to ' + a.name
                    + (told.prompt ? ' with the prompt "' + told.prompt.name + '"' : '')
                    + (told.contract ? ', under "' + told.contract.name + '"' : ''));

                var out = await channel.run(a.name, dispatch.script({
                    id: runId,
                    task: job.code,
                    job: job.code,
                    vm: a.name,
                    //THE MACHINE'S OWN TOKEN, which this host holds and the guest
                    //does not have until something puts it there.
                    token: vm.spec && vm.spec.token,
                    prompt: told.prompt
                        ? { id: told.prompt.id, name: told.prompt.name, text: told.prompt.text }
                        : null,
                    //THE TEXT, NOT THE NAME. Carried rather than referenced: read
                    //six weeks later, a name proves nothing about what the worker
                    //was actually held to.
                    contract: told.contract ? told.contract.text : null,
                    contractName: told.contract ? told.contract.name : null,
                    contractId: told.contract ? told.contract.id : null,
                    folder: where,
                    //WHAT THIS MACHINE IS ABOUT TO BE, WHICH DECIDES WHICH SKILL
                    //IT IS GIVEN. A judgement is the only thing that arrives
                    //here carrying one, and ../../queue/onejudgement.js is the
                    //only caller that does — so this is the fact rather than a
                    //guess from the machine's tags, which say what it MAY do and
                    //not what it is doing. `beta-worker1` is tagged both.
                    judging: !!a.judgement,
                    base: base
                }), { what: 'dispatching the job ' + a.id, timeout: 60000 });

                if (!/okc-dispatched/.test(out.output || '')) {
                    throw new Error('"' + a.name + '" did not start it: '
                        + (String(out.output || '').trim().split('\n').pop() || 'it said nothing'));
                }

                to.good(a.name + ' is running "' + job.name + '" as ' + runId);

                return {
                    run: runId,
                    job: job.id,
                    machine: a.name,
                    prompt: told.prompt ? told.prompt.id : null,
                    //SAID PLAINLY, because "no rules" is the dangerous answer and
                    //it is also the silent one — the same note vmDispatch makes.
                    contract: told.contract ? told.contract.id : null,
                    //FIRE AND FORGET, like every other run here. Holding the
                    //channel open would make starting one indistinguishable from
                    //waiting for it.
                    note: 'Started. Read what it says with: okc.js vmRunOutput --name ' + a.name
                        + ' --run ' + runId
                };
            }
        }));

        //---- WHAT HAS BEEN GIVEN TO A MACHINE, AND WHAT BECAME OF IT -------
        //
        //A RUN WITH NO STATUS IS REPORTED AS `running` RATHER THAN AS A MISSING
        //FIELD — see ../../vms/dispatch/runs.js, which decides that. A caller
        //that has to interpret an absence will eventually interpret it as
        //finished, and the queue is a caller that would then hand the machine to
        //somebody else while the work was still going.
        //---- WHAT A MACHINE IS HOLDING THAT IS NOT HERE --------------------
        //
        //THE QUESTION ASKED BEFORE ANYTHING ROLLS A MACHINE BACK. Putting one
        //away restores its base snapshot, which is right after work that ENDED
        //and destroys everything after work that has not. A person working by
        //hand is exactly who has uncommitted changes — the queue's own runs push
        //before they finish, and a human in an editor has no such habit.
        //
        //SO IT IS ASKED OF THE MACHINE, not inferred here. What is on that disk
        //is not knowable from this side: a branch this host thinks it is on says
        //nothing about what was typed into it since.
        //
        //ONE LINE PER REPOSITORY, in a shape that is READ rather than parsed out
        //of prose. Nothing at all when there is no workspace on it, which is a
        //real answer and not a failure.
        //
        //A REPOSITORY WITH NO UPSTREAM HAS NOTHING TO BE AHEAD OF, so counting
        //`@{upstream}..HEAD` fails there and answers zero — which would read as
        //"nothing to lose" about a repository whose every commit exists only on
        //that machine. Untracked means ALL of it, not none of it, and `tracked`
        //travels with the number so a reader knows which it is.
        undo.push(actions.define('vmHolds', {
            about: 'What a machine is holding that is not here: commits not pushed, and files not committed',
            takes: ['name'],
            run: async function (args) {
                var name = String((args || {}).name || '').trim();
                var vm = imports.ours.get(name);

                //NOT DIALLED IN IS NOT "NOTHING". It is "could not ask", and the
                //difference decides whether a rollback is safe — so it is said
                //rather than answered with an empty list.
                if (!channel.connected(name)) {
                    return {
                        asked: false,
                        why: '"' + name + '" is not dialled in, so it cannot be asked what it is holding.',
                        repos: []
                    };
                }

                var folder = imports.repoWorkspaces.folderFor(vm && vm.spec);

                var script = [
                    'set -u',
                    'WS="' + folder + '"',
                    '[ -d "$WS" ] || exit 0',
                    'for d in "$WS"/*/; do',
                    '  [ -d "$d/.git" ] || continue',
                    '  cd "$d" || continue',
                    '  name=$(basename "$d")',
                    '  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)',
                    '  if git rev-parse --abbrev-ref "@{upstream}" >/dev/null 2>&1; then',
                    '    ahead=$(git rev-list --count "@{upstream}..HEAD" 2>/dev/null || echo 0)',
                    '    tracked=yes',
                    '  else',
                    '    ahead=$(git rev-list --count HEAD 2>/dev/null || echo 0)',
                    '    tracked=no',
                    '  fi',
                    //`wc -l`, NOT `grep -c .`. grep prints 0 AND exits 1 when
                    //nothing matches, so `|| echo 0` fired as well and `dirty`
                    //came back as two lines — which split the record in half and
                    //took `tracked` off the end of it. Every repository then read
                    //as tracked, including one whose every commit exists only on
                    //that machine. Measured against a real workspace, not
                    //reasoned about.
                    '  dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d " ")',
                    '  echo "okc-holds|$name|$branch|$ahead|$dirty|$tracked"',
                    'done'
                ].join('\n');

                var r = await channel.run(name, script, { what: 'what it is holding', timeout: 60000 });

                var repos = String((r && r.output) || '').split('\n')
                    .map(function (l) { return l.trim(); })
                    .filter(function (l) { return l.indexOf('okc-holds|') === 0; })
                    .map(function (l) { return l.split('|'); })
                    .map(function (f) {
                        return {
                            repo: f[1],
                            branch: f[2],
                            ahead: Number(f[3]) || 0,
                            dirty: Number(f[4]) || 0,
                            tracked: f[5] !== 'no'
                        };
                    });

                var commits = repos.reduce(function (n, x) { return n + x.ahead; }, 0);
                var files = repos.reduce(function (n, x) { return n + x.dirty; }, 0);

                //WHAT IT MAY PUSH, AGAINST WHAT IT IS ACTUALLY ON. Two different
                //claims, and only the first was ever recorded: "may push
                //fix/thing" is a permission and says nothing about where the
                //machine's work IS. A machine sitting on another branch is not
                //dangerous — the push refuses — it is a machine whose work has
                //nowhere to go, and nothing said so until somebody tried.
                var elsewhere = repos.filter(function (x) { return vm && vm.branch && x.branch !== vm.branch; });

                return {
                    asked: true,
                    repos: repos,
                    commits: commits,
                    files: files,
                    mayPush: (vm && vm.branch) || null,
                    elsewhere: elsewhere.map(function (x) { return x.repo + ' is on ' + x.branch; }),
                    adrift: elsewhere.length
                        ? name + ' may push ' + (vm && vm.branch) + ', but '
                            + elsewhere.map(function (x) { return x.repo + ' is on ' + x.branch; }).join(' and ')
                            + ' — work there cannot be pushed until it is on ' + (vm && vm.branch) + '.'
                        : null,

                    //SAID ONCE, HERE, so every caller says it the same way — and
                    //`null` when there is nothing, so a caller can test it
                    //without deciding for itself what counts as holding something.
                    summary: (commits || files)
                        ? [
                            commits ? (commits + ' commit' + (commits === 1 ? ' that exists' : 's that exist') + ' nowhere else') : null,
                            files ? (files + ' file' + (files === 1 ? '' : 's') + ' changed and not committed') : null
                        ].filter(Boolean).join(', ')
                        : null
                };
            }
        }));

        undo.push(actions.define('vmRuns', {
            about: 'The tasks given to a machine, and whether they are still going',
            takes: ['name'],
            run: async function (args) {
                var name = (args || {}).name;
                asking.reachable(name, 'its runs cannot be read');

                var r = await channel.run(name, dispatch.list(),
                    { what: 'reading its runs', timeout: 60000 });
                return { runs: dispatch.runs(r.output) };
            }
        }));

        //---- WHAT A RUN'S OWN PROCESS PRINTED ------------------------------
        //
        //DIFFERENT FROM THE TRANSCRIPT, AND WORTH BOTH. The transcript says what
        //the agent did; this says what happened to the program running it —
        //which is where a crash before it ever started thinking appears, and
        //where an agent that never authenticated says so.
        //
        //REDACTED, BECAUSE THIS IS KEPT. The queue reads two thousand lines of
        //it into an attempt's record when a task ends badly, so it goes to disk.
        //Command output carries tokens; ../../core/secret is the one place that
        //knows what one looks like.
        undo.push(actions.define('vmRunOutput', {
            about: "The tail of one task's raw output",
            takes: ['name', 'run', 'lines'],
            run: async function (args) {
                var a = args || {};
                asking.reachable(a.name, 'its output cannot be read');
                var run = asking.whichRun(a.run);
                var lines = a.lines == null ? 40 : Number(a.lines);

                var r = await channel.run(a.name, dispatch.output(run, lines),
                    { what: 'reading ' + run, timeout: 60000 });
                return { run: run, output: imports.secret.redact(r.output) };
            }
        }));

        //---- STOPPING ONE, AND EVERYTHING IT STARTED -----------------------
        //
        //THE OUTCOME IS A SENTENCE, NOT A BOOLEAN — see ./asking.js. A stopped
        //run is not a failed one, and the difference matters when somebody reads
        //the board tomorrow: it has no result because it was stopped, not
        //because it went wrong.
        //
        //TWO OF THE FIVE READINGS THROW. Everything downstream treats a
        //successful stop as "the machine is free now", so a machine still
        //running work nobody is watching must never be reported as free.
        //---- WHAT THE MODEL ON A MACHINE IS DOING, RIGHT NOW -----------------
        //
        //`vmRunOutput` ABOVE IS THE RAW LOG and is the right thing to keep: one
        //JSON object per line, most of them token counts. It is the wrong thing
        //to put in front of a person.
        //
        //RENDERED ON THE MACHINE. The guest already carries `watch.js` — it is
        //what `okc-watch` pipes through when somebody follows a run in a
        //terminal — so this asks the machine to render its own log rather than
        //growing a second renderer here. Two of those would drift, and the copy
        //on this host would be the one nobody notices is wrong.
        //
        //ONE ACTION FOR BOTH KINDS, because the question is the same one: what
        //is the model on that machine doing. A runner writes a log per run and a
        //supervisor relinks one file across wakings — which is exactly what lets
        //somebody watch a supervisor rather than race a button — and both are
        //`<box>/watch.js` over a file.
        //
        //THE LINE COUNT COMES BACK WITH IT so a reader can paint only what is
        //new. It is the RAW count: the rendered text changes length as a turn is
        //summarised, and a number that means something different between two
        //reads is worse than none. Same shape as `vmLog`, which the console pane
        //already reads this way.
        undo.push(actions.define('vmWatching', {
            about: 'What the model on a machine is doing now, rendered as a person can read it',
            takes: ['name', 'lines'],
            run: async function (args) {
                var a = args || {};
                asking.reachable(a.name, 'what it is doing cannot be read');

                //WHICH KIND OF BOX, ASKED OF THE MACHINE'S OWN RECORD rather
                //than guessed from its name. A machine tagged `supervisor` is
                //one; anything else keeps its logs per run.
                var vm = await imports.ours.get(a.name);
                var isSupervisor = !!(vm && (vm.tags || []).indexOf('supervisor') >= 0);

                var lines = a.lines == null ? 400 : Number(a.lines);
                var r = await channel.run(a.name, dispatch.watching(isSupervisor ? 'supervisor' : 'run', lines),
                    { what: 'reading what ' + a.name + ' is doing', timeout: 60000 });

                //THE COUNT IS THE FIRST LINE THAT IS ONE, WHICH IS NOT THE FIRST
                //LINE. `channel.run` echoes what it was asked to do as a `$ ...`
                //line above the output, so reading line zero as the number gave
                //NaN — which became `of: 0`, which reads as "nothing is running"
                //while nine kilobytes of rendering sat underneath it. The pane
                //said the machine was idle in the middle of a turn.
                //
                //FOUND BY LOOKING AT THE PANE, not by the number being obviously
                //wrong: a zero here is a sentence rather than an error.
                var all = String(r.output == null ? '' : r.output).split('\n');
                var at = 0;
                while (at < all.length && !/^\s*\d+\s*$/.test(all[at])) at++;

                var of = at < all.length ? Number(all[at].trim()) : NaN;
                var text = all.slice(at + 1).join('\n');

                return {
                    name: a.name,
                    supervisor: isSupervisor,
                    //`of` IS HOW MANY RAW LINES THE LOG HAS, not how many are
                    //below. A caller polls this and paints the difference.
                    of: isNaN(of) ? 0 : of,
                    asked: lines,
                    text: imports.secret.redact(text),
                    note: (isNaN(of) || of === 0)
                        ? 'Nothing is running on ' + a.name + ' — there is no log to read yet.'
                        : null
                };
            }
        }));

        undo.push(actions.define('vmRunStop', {
            about: 'Stop a run on a machine, and everything it started',
            takes: ['name', 'run'],
            run: async function (args) {
                var a = args || {};
                asking.reachable(a.name, 'its runs cannot be stopped');
                var run = asking.whichRun(a.run);

                var r = await channel.run(a.name, dispatch.stop(run),
                    { what: 'stopping ' + run, timeout: 60000 });
                var said = makeAsking.outcomeOf(r.output);

                if (said.bad) {
                    throw new Error(run + ' ' + said.how + '. Look at the machine — something there '
                        + 'is ignoring both TERM and KILL.');
                }

                log.on('vm', a.name).warn(run + ' ' + said.how);
                return {
                    name: a.name,
                    run: run,
                    outcome: said.how,
                    //SAID PLAINLY, because a stopped run is the one that looks
                    //like a failure and is not.
                    note: 'stopped, not failed — it has no result because it was stopped'
                };
            }
        }));
    }

    await register(null, { onDestroy: function () { while (undo.length) undo.pop()(); } });
}
module.exports = plugin;
