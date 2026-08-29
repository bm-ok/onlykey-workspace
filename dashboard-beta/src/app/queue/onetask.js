//---------------------------------------------------------------------------
//ONE TASK, ON ONE MACHINE, FROM END TO END.
//
//AN ORDER RATHER THAN A SET OF COMMANDS. Almost every line delegates — ./starting
//brings the machine up, ./running waits for the work, ./metering reads what it
//cost, ./putting hands the machine back — and what is left here is the SEQUENCE,
//which is the part that has actually been wrong.
//
//---- the three ways this ends, and the finally that tells them apart -------
//
//  HANDED OVER   the task named no job, so the machine is set up and left
//                RUNNING for a person. Putting it away would take away the
//                thing that was just prepared.
//  OUT OF TOUCH  the machine stopped answering mid-run. Rolling it back
//                destroys the only account of what went wrong, so it is kept.
//  FINISHED      anything else. The machine goes back to the pool clean.
//
//THE MACHINE IS RELEASED IN ALL THREE, because a machine held by a queue that
//has stopped thinking about it is a machine nothing will ever touch again.
//
//---- and it all goes through the actions ----------------------------------
//
//Every refusal they carry applies to the queue exactly as it applies to a person
//pressing the button. A second way in is a second set of rules, and the second
//set is always the one that turns out to be wrong.
//---------------------------------------------------------------------------

//ONE PLACE SAYS HOW LONG SOMETHING TOOK. See ./running, which does the same.
var howLong = require('./waiting').secs;

module.exports = function onetask(deps) {
    var d = deps || {};
    var call = d.call;
    var say = d.say;

    var starting = d.starting;     //bringUp
    var running = d.running;       //waitForRun
    var metering = d.metering;     //meterRun
    var putting = d.putting;       //putAway, keepForLooking

    var hold = d.hold;             //mark a machine as somebody's
    var release = d.release;       //let the queue's own record of it go
    var headsOn = d.headsOn || function () { return {}; };
    var papersFor = d.papersFor || function () { return []; };
    var wakes = d.wakes || function () { return false; };
    var noteFor = d.noteFor || function () { return null; };
    var now = d.now || function () { return Date.now(); };
    var stamp = d.stamp || function () { return new Date().toISOString(); };
    var secs = d.secs || howLong;

    async function run(task, machine) {
        var to = say('queue', machine);
        var id = task.id;

        //WHICH OF THE THREE ENDINGS THIS IS. Decided as it goes and read once,
        //in the finally — so there is one place that knows what happens to the
        //machine rather than a return in every branch.
        var handedOver = false;
        var outOfTouch = null;

        //WHERE THE TIME WENT. A task that took forty minutes is a fact; forty
        //minutes of which thirty-five were bringing a machine up is a different
        //fact, and it is the one that leads anywhere.
        var spent = {};
        var began = now();

        async function phase(name, fn) {
            var at = now();
            try { return await fn(); } finally { spent[name] = now() - at; }
        }

        try {
            to.info('#' + task.number + ' "' + task.title + '" -> ' + machine);
            await call('taskUpdate', { id: id, task: { state: 'given', machine: machine } });

            await phase('bringUp', function () { return starting.bringUp(to, machine); });
            await phase('credential', function () {
                return call('vmCredentialsPut', { name: machine, role: 'worker' });
            });
            await phase('workspace', function () {
                return call('vmWorkspace', {
                    name: machine,
                    branch: task.branch,
                    folder: task.folder || undefined,
                    task: noteFor(task)
                });
            });

            //WHAT A JUDGE SAID, PUT WHERE THE WORKER WILL FIND IT.
            //
            //A judgement may not push to what it is reading, so handing a report
            //back is the only way it can say anything at all. A task raised
            //BECAUSE of one starts by reading it.
            //
            //BEST EFFORT: a report that could not be delivered is worth a line,
            //and is not worth refusing to do the work over.
            if (task.becauseOfId) {
                try {
                    var papers = await papersFor(task.becauseOfId, machine, to);
                    if (!papers.length) {
                        to.warn('the judgement handed nothing back, so #' + task.number
                            + ' has only its brief to go on');
                    }
                } catch (e) {
                    to.warn("could not put the judge's report on " + machine + ': ' + e.message);
                }
            }

            //---- a task with nothing to run -------------------------------
            //
            //SET UP AND LEFT RUNNING, FOR A PERSON. This is not a failure and
            //not an empty task: a machine on the right branch with a credential
            //and a workspace is most of what somebody wants before they start,
            //and the queue's job was to prepare it.
            //
            //BORROWED, WHICH IS NOT A EUPHEMISM. Borrowed already means "this
            //one is somebody's, do not queue it" to the rest of the app, so the
            //queue skips it and vmReturn is how it comes back.
            if (!task.job && !task.shell) {
                handedOver = true;
                hold(machine, { why: '#' + task.number + ' — set up and waiting for you', at: stamp() });

                await call('taskUpdate', {
                    id: id,
                    task: {
                        state: 'given', machine: machine, worker: 'person',
                        attempts: (task.attempts || []).concat([{ machine: machine, at: stamp(), setUp: true }])
                    }
                });

                to.good('#' + task.number + ' — ' + machine + ' is up on ' + task.branch
                    + ' and waiting. Nothing was run: this task names no job.');
                to.info('open it from the task, or give it back with vmReturn --name ' + machine);
                return;
            }

            //---- or something to run ---------------------------------------
            var started = task.job
                ? await call('jobRun', {
                    id: task.job, task: id, name: machine, folder: task.folder || undefined
                })
                : await call('vmDispatch', {
                    name: machine,
                    task: task.brief,
                    folder: task.folder || undefined,
                    rules: task.rules || undefined,
                    contractName: task.contractName || undefined,
                    contract: task.rules ? undefined : (task.contract || undefined),
                    shell: !!task.shell
                });

            //READ BACK BEFORE APPENDING. The record may have moved while the
            //machine was being brought up — five minutes is long enough for
            //somebody to have pressed something.
            var fresh = await call('tasks', {});
            var mine = (fresh.tasks || []).filter(function (t) { return t.id === id; })[0] || task;

            await call('taskUpdate', {
                id: id,
                task: {
                    run: started.run,
                    attempts: (mine.attempts || []).concat([{ run: started.run, machine: machine, at: stamp() }])
                }
            });

            //WHERE THE BRANCH STOOD BEFORE THE WORK. The only way to say "and
            //nothing new arrived" afterwards, which is the difference between a
            //run that worked and one that reported success and pushed nothing.
            var stoodAt = await headsOn(task.branch);

            var outcome = await phase('work', function () {
                return running.waitForRun(to, machine, started.run, Number(task.hours) || 6);
            });

            if (outcome.state === 'unreachable') {
                outOfTouch = started.run + ' was still going when this host lost sight of ' + machine;
            }

            //READ BEFORE THE MACHINE IS PUT AWAY, because the transcript lives
            //on it and the rollback takes it.
            var metered = await metering.meterRun(to, machine, started.run, {
                kind: 'task', about: task.title || null, ref: '#' + task.number
            });

            if (metered && metered.failedAuthAs) {
                var again = await backInTheQueue(id, task, metered.failedAuthAs, to);
                if (again) return;
            }

            //THE LOG IS BEST EFFORT; THE VERDICT IS NOT.
            try { await call('taskProgress', { id: id }); } catch (e) { /* best effort */ }

            var art = await call('taskArtifact', { id: id });
            spent.total = now() - began;

            var latest = ((await call('tasks', {})).tasks || []).filter(function (t) { return t.id === id; })[0] || mine;
            var marked = (latest.attempts || []).map(function (a) {
                return a.run === started.run ? Object.assign({}, a, { spent: spent }) : a;
            });

            var nowAt = await headsOn(task.branch);
            var moved = Object.keys(nowAt).filter(function (r) { return nowAt[r] && nowAt[r] !== stoodAt[r]; });

            await call('taskUpdate', {
                id: id, task: { state: 'done', attempts: marked, arrived: moved.length > 0 }
            });

            //A RUN THAT SAID IT WORKED AND PUSHED NOTHING is the confident wrong
            //report this whole app is arranged against — so the branch is named
            //along with where it still stands.
            var stillAt = Object.keys(stoodAt).filter(function (r) { return stoodAt[r]; })
                .map(function (r) { return r + ' ' + stoodAt[r]; }).join(', ');

            to[art.delivered && moved.length ? 'good' : 'warn'](
                '#' + task.number + ' done — ' + outcome.state
                + (outcome.exit === undefined ? '' : ' (exit ' + outcome.exit + ')')
                + ' — ' + art.summary
                + (moved.length ? ''
                    : ' — and nothing new arrived: ' + task.branch + ' is unchanged'
                        + (stillAt ? ' (' + stillAt + ')' : '')
                        + ', so whatever the run did is not here'));

            to.info('#' + task.number + ' took ' + secs(spent.total) + ' — '
                + Object.keys(spent).filter(function (k) { return k !== 'total'; })
                    .map(function (k) { return k + ' ' + secs(spent[k]); }).join(', '));

            //AND THE SUPERVISOR IS TOLD, IF IT IS MEANT TO BE. Never awaited and
            //never fatal: waking one is a convenience, and a task that finished
            //must not be reported as failed because nothing answered.
            try {
                if ((await wakes()) === true) {
                    Promise.resolve(call('supervisorWake', {
                        why: '#' + task.number + ' finished — ' + outcome.state
                    })).catch(function (e) {
                        say('supervisor').warn('it could not be woken after #' + task.number + ': ' + e.message);
                    });
                }
            } catch (e) {
                say('supervisor').warn('could not tell the supervisor about #' + task.number + ': ' + e.message);
            }
        } finally {
            //ONE PLACE THAT DECIDES WHAT HAPPENS TO THE MACHINE. Three endings,
            //and the wrong one in any of them costs either the work or the
            //machine.
            if (handedOver) {
                //NOTHING. It is running, set up, and somebody's.
            } else if (outOfTouch) {
                await putting.keepForLooking(machine, outOfTouch);
            } else {
                await putting.putAway(machine);
            }
            release(machine);
        }
    }

    //---- a sign-in that could not authenticate ------------------------------
    //
    //THE WORK NEVER STARTED, so the task goes back rather than being marked
    //done. Once — because if every sign-in it can be given is failing, putting
    //it back is a loop that spends a machine each time round.
    async function backInTheQueue(id, task, who, to) {
        var before = ((((await call('tasks', {})).tasks || [])
            .filter(function (t) { return t.id === id; })[0]) || {}).attempts || [];

        var already = before.filter(function (a) { return a.authFailed; }).length;

        var marked = before.slice();
        if (marked.length) {
            marked[marked.length - 1] = Object.assign({}, marked[marked.length - 1], { authFailed: who });
        }

        if (!already) {
            await call('taskUpdate', {
                id: id, task: { state: 'queued', machine: null, run: null, attempts: marked }
            });
            to.warn('#' + task.number + ' is back in the queue — it was never run: "' + who
                + '" could not authenticate, and that sign-in is now paused so this will not be given to it again');
            return true;
        }

        to.bad('#' + task.number + ' could not authenticate a second time, so it is not being re-queued again. '
            + 'Every sign-in it can be given is failing — replace one on the Runners tab before this can run.');
        return false;
    }

    return { run: run };
};
