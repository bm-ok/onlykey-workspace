//---------------------------------------------------------------------------
//EVERY ATTEMPT AT A WORK ITEM, AND HOW ONE ENDS.
//
//`taskProgress` and `taskFinished`, and they belong here for the same reason the
//record does: a work item's whole life is the queue's. The worker and the judge
//are the two libraries of what to run — a set of jobs, prompts and contracts —
//and they ASK for a task rather than owning it once it exists.
//
//---- what makes progress more than a read ---------------------------------
//
//IT PULLS EACH FINISHED RUN'S LOG ACROSS AND KEEPS IT. That is the part that
//matters, and it happens HERE rather than on a timer for a specific reason: this
//is the moment somebody is looking at the work item, and a run nobody has looked
//at since it ended is exactly the one whose machine has not been touched yet.
//
//The machine is the disposable half of this tool — see ./archive.js for the
//afternoon that cost two records. A rollback is a normal and correct thing to
//do, and it takes the only account of what happened with it.
//---------------------------------------------------------------------------

module.exports = function attempts(store, archive, ask, log) {
    var say = log || { good: function () {}, warn: function () {}, bad: function () {}, info: function () {} };

    //---- what a stored attempt actually says --------------------------------
    //
    //AN ATTEMPT WITH NO RUN NEVER HAD ONE, which is not the same as its run
    //being gone. This looked every attempt up by its run id and called anything
    //it could not find "gone" — reported as "the machine no longer has it". Two
    //kinds of attempt have no run at all and both were being libelled by it:
    //
    //  handed over   a work item with no job. The queue sets the machine up and
    //                leaves it running, so there is nothing to look up and the
    //                machine emphatically DOES still have it — it is sitting
    //                there waiting, which the panel said the opposite of, next
    //                to a button offering to open it
    //  failed        the setup threw before anything was dispatched. The reason
    //                is already on the attempt, and "the machine no longer has
    //                it" replaces a real explanation with a wrong one
    function stateOf(a, known) {
        if (a.failed) return Object.assign({}, a, { state: 'lost' });
        if (!a.run) return Object.assign({}, a, { state: a.setUp ? 'setUp' : 'never started' });
        return Object.assign({}, a, known[a.run] || { state: 'gone' });
    }

    //THE ATTEMPTS A WORK ITEM HAS, including the shape from before there were
    //any: a single `run` field was the first version and it lost the history the
    //moment a task was given out twice.
    function listed(task) {
        if (task.attempts && task.attempts.length) return task.attempts;
        return task.run ? [{ run: task.run, machine: task.machine }] : [];
    }

    async function progress(ref, opts) {
        var o = opts || {};
        var task = await store.get(ref);
        var all = listed(task);

        //A REAL ANSWER RATHER THAN A FAILURE. A machine that has been thrown
        //away is the NORMAL end of a work item — the queue shuts it down the
        //moment the work ends — and the attempts are still worth showing: they
        //are the record, and the machine was only ever where the work happened.
        //
        //STILL ANSWERED PER ATTEMPT, which the first version forgot. It returned
        //the raw attempts with no `state` and no `kept`, so the window drew an
        //empty badge and said "no log was kept here" about runs whose logs were
        //sitting on this host all along. The machine being gone is exactly when
        //the kept copy matters, so that is the worst moment to stop reporting it.
        if (!task.machine || !(await ask.connected(task.machine))) {
            return {
                task: task.id,
                attempts: all.map(function (a) {
                    return Object.assign({}, a, {
                        state: a.failed ? 'lost' : 'ended',
                        kept: archive.has(task.uid, a.run)
                    });
                }),
                live: null,
                why: task.machine
                    ? '"' + task.machine + '" is off — the queue puts a machine away when its work ends'
                    : 'it has not been given out yet'
            };
        }

        var runs = await ask.runs(task.machine);
        var known = {};
        (runs || []).forEach(function (r) { known[r.id] = r; });

        var withState = all.map(function (a) { return stateOf(a, known); });

        //---- PULLED ACROSS THE MOMENT IT IS OVER, AND NEVER AGAIN ----------
        for (var i = 0; i < withState.length; i++) {
            var a = withState[i];
            //NOTHING TO KEEP FOR AN ATTEMPT THAT NEVER RAN. A hand-over and a
            //failed setup both have no run id, so this asked the machine for the
            //output of `undefined` and warned that it could not keep it — three
            //times a draw, for ever, about a log that never existed.
            if (!a.run) continue;
            if (a.state === 'running' || a.state === 'gone') continue;
            if (archive.has(task.uid, a.run)) continue;
            try {
                var out = await ask.runOutput(task.machine, a.run, 2000);
                archive.keep(task.uid, a.run, {
                    output: (out && (out.output || out.text)) || '',
                    machine: task.machine,
                    state: a.state,
                    exit: a.exit
                });
                say.info('kept the log of ' + a.run + ', so it survives the machine');
            } catch (e) {
                say.warn('could not keep the log of ' + a.run + ': ' + e.message);
            }
        }

        //ONLY WHILE SOMETHING IS ACTUALLY RUNNING. Pulling a transcript is a
        //round trip to the guest, and doing it for a finished work item every
        //time somebody clicks a card is paying for an answer that cannot change.
        var live = null;
        if (withState.some(function (a) { return a.state === 'running'; })) {
            var sessions = await ask.sessions(task.machine);
            var newest = ((sessions && sessions.sessions) || sessions || [])[0];
            if (newest) {
                var tail = await ask.sessionTail(task.machine, newest.id, Number(o.lines) || 12);
                live = {
                    session: newest.id,
                    title: newest.title,
                    idle: newest.idle,
                    entries: (tail && tail.entries) || []
                };
            }
        }

        return {
            task: task.id,
            attempts: withState.map(function (a) {
                return Object.assign({}, a, { kept: archive.has(task.uid, a.run) });
            }),
            live: live,
            why: null
        };
    }

    //=======================================================================
    //SAY A WORK ITEM TAKEN BY HAND IS FINISHED.
    //
    //The machine goes back through the same door as everything else, so the same
    //refusal applies: anything uncommitted stops this, because putting a machine
    //away ROLLS IT BACK. A "finished" that quietly destroyed uncommitted work
    //would be the most expensive button in the app.
    //
    //IT DOES NOT DECIDE ANYTHING. `done` means the run ended — not that it
    //worked, and not that anybody has looked at it. What it delivered is
    //whatever reached the branch, and that is read from the branch.
    //=======================================================================
    async function finished(ref, keep) {
        var task = await store.get(ref);
        if (!task.machine) throw new Error('"' + task.id + '" is not on a machine.');

        var back = await ask.returnMachine(task.machine, !!keep);
        await store.update(task.id, { state: 'done' });
        say.good('finished by hand — waiting on a verdict');

        return {
            task: task.id,
            number: task.number,
            machine: (back && back.name) || task.machine,
            note: ((back && back.note) ? back.note + ' ' : '')
                + '#' + task.number + ' is done and waiting to be judged — what it delivered is whatever reached "'
                + task.branch + '".'
        };
    }

    return { progress: progress, finished: finished, stateOf: stateOf, listed: listed };
};
