//---------------------------------------------------------------------------
//ONE JUDGEMENT, ON ONE MACHINE, FROM END TO END.
//
//THE SAME SHAPE AS ./onetask, AND DELIBERATELY NOT THE SAME FUNCTION. What is
//shared is the machine handling — rolled back, brought up, given a credential,
//put away afterwards — and those are CALLED here rather than copied. What
//differs is the two things that make a judgement a judgement:
//
//  IT IS SET UP ON WHAT IT READS. A branch cut is read on its own branch; a PR
//  cut is read on the line the pull requests were opened from, because that is
//  where the change is. Reading code means having it, so the machine is set up
//  exactly as a worker's would be.
//
//  AND IT MAY NOT PUSH. Being set up on a branch is what every other machine's
//  permission to push is MADE of, so this would otherwise hand a judge the right
//  to write to the very line it is judging. THE REFUSAL IS ON THE HOST, in the
//  git route, where no guest can edit it. Nothing here relies on the judging job
//  being written politely.
//
//What it hands back it hands back as artifacts, filed under the judgement, which
//is the only way it can say anything at all.
//
//---- two endings, not three -----------------------------------------------
//
//There is no handed-over case: a judgement with no job never reaches the queue.
//So it is kept when this app lost sight of it, and put away otherwise — and the
//machine is released either way, for the reason ./onetask gives.
//
//WRITTEN HERE BECAUSE IT WAS NEARLY NOT. Everything about keeping a machine was
//added to the task path, and this one calls the same waitForRun through the same
//queue on the same machines — so leaving it out would have made a judgement's
//evidence the one kind this app still destroys. That is the sixth time a rule
//written for tasks would have missed judging, and the only reason it did not is
//that the callers were counted.
//---------------------------------------------------------------------------

var concludedAcross = require('./concluding').concludedAcross;
var howLong = require('./waiting').secs;

module.exports = function onejudgement(deps) {
    var d = deps || {};
    var call = d.call;
    var say = d.say;

    var starting = d.starting;     //bringUp
    var running = d.running;       //waitForRun
    var metering = d.metering;     //meterRun
    var putting = d.putting;       //keepForLooking, putAway

    var judging = d.judging;       //get, update — the judgement record
    var release = d.release;
    var refOf = d.refOf || function (n) { return 'J' + n; };

    //WHICH REPOSITORY HERE, from the name GitHub uses — a question about
    //remotes, which is not this plugin's subject.
    //
    //AWAITED, because the answer is a lookup over a list another plugin reads
    //off disk. Called synchronously it would resolve a promise as truthy and
    //fetch `undefined` into a branch nobody asked for.
    var repoFor = d.repoFor || async function () { return null; };

    //WHAT CAME BACK, and how to read one of them.
    var handedBack = d.handedBack || function () { return []; };
    var readHanded = d.readHanded || function () { return ''; };

    //WHERE A LOG GOES SO IT SURVIVES THE MACHINE.
    var kept = d.kept || function () { return false; };
    var keep = d.keep || function () {};

    var tipsFor = d.tipsFor || function () { return null; };
    var wakes = d.wakes || function () { return false; };
    var now = d.now || function () { return Date.now(); };
    var stamp = d.stamp || function () { return new Date().toISOString(); };
    var secs = d.secs || howLong;

    async function run(judgement, machine) {
        var to = say('queue', machine);
        var id = judgement.id;
        var ref = judgement.ref || refOf(judgement.number);

        //WHY THIS READING ENDED WITHOUT BEING SEEN TO END, or null if it was
        //seen. Read in the finally, which decides whether this machine is put
        //away or kept as it is.
        var outOfTouch = null;

        var spent = {};
        var began = now();

        async function phase(name, fn) {
            var at = now();
            try { return await fn(); } finally { spent[name] = now() - at; }
        }

        //WHICH BRANCH CARRIES THE CHANGE. A judgement's subject is never a
        //branch it owns — this is where the code it must read happens to live.
        var subject = judgement.subject || {};

        //INSIDE THE TRY, AND THAT IS THE WHOLE POINT OF IT BEING HERE.
        //
        //Resolving the subject used to sit above, where a throw skipped the
        //finally that puts the machine away and takes it out of the queue's
        //record — so the FIRST failure any judgement can have was also the one
        //failure that leaked a machine. It was found the first time a subject
        //this could not resolve reached the queue: a machine read "doing J36"
        //with nothing on it and nothing coming, and the queue would not have
        //touched it again until a restart.
        //
        //Nothing had started yet, so nothing was left running and no credential
        //was out — but that is luck about WHERE the throw was, not a property of
        //the code. Anything that fails between here and bringUp has the shape.
        try {
            var settled = await whatItReads(subject, ref, machine, to, phase);
            var branch = settled.branch;
            var reading = settled.reading;

            to.info(ref + ' "' + judgement.title + '" -> ' + machine);
            judging.update(id, { state: 'given', machine: machine });

            await phase('bringUp', function () { return starting.bringUp(to, machine); });

            //A JUDGE'S IDENTITY, BECAUSE THIS IS A JUDGEMENT — said by the work
            //rather than read off the machine, which is the only thing that can
            //answer it for a machine tagged worker AND judge.
            await phase('credential', function () {
                return call('vmCredentialsPut', { name: machine, role: 'judge' });
            });

            await phase('workspace', function () {
                return call('vmWorkspace', {
                    name: machine,
                    branch: branch,
                    //ONLY SET WHEN WHAT IS BEING READ ARRIVED FROM OUTSIDE: the
                    //pull request's branch in its own repository, every other
                    //repository on its default, and nothing claimed anywhere.
                    reading: reading,
                    //WHAT THIS MACHINE IS FOR, left on it so it can say so if it
                    //dials back in. A judgement says what it is READING, which
                    //is the honest sentence for a machine that will not be
                    //delivering anything.
                    task: noteFor(subject, ref, branch, reading)
                });
            });

            var started = await call('jobRun', { id: judgement.job, judgement: id, name: machine });
            judging.update(id, {
                run: started.run,
                attempts: (judgement.attempts || []).concat([{ run: started.run, machine: machine, at: stamp() }])
            });

            var outcome = await phase('reading', function () {
                return running.waitForRun(to, machine, started.run, Number(judgement.hours) || 6);
            });

            if (outcome.state === 'unreachable') {
                outOfTouch = started.run + ' was still reading when this host lost sight of ' + machine;
            }

            //BEFORE ANYTHING ELSE TOUCHES THE MACHINE — see ./metering.
            var metered = await metering.meterRun(to, machine, started.run, {
                kind: 'judgement', about: subject.name || judgement.title || null, ref: ref
            });

            //THE SAME RULE AS A TASK'S, and written here rather than shared
            //because the two paths file their work in different stores — but it
            //IS the same rule, so if it changes it changes in both.
            if (metered && metered.failedAuthAs) {
                if (await backInTheQueue(id, judgement, metered.failedAuthAs, ref, to)) return;
            }

            await keepTheLog(judgement, started.run, machine, outcome, to);
            await sayWhyItFailed(started.run, machine, outcome, ref, to);

            //WHAT CAME BACK, before the machine is touched again — it is about
            //to be rolled back, which is exactly when nobody is watching.
            //AWAITED. The drawer this reads is ../core/archive's store and its
            //`list` is async; read without the await it is a Promise, whose
            //`.length` is undefined -- so every judgement that ever ran here
            //was logged "nothing handed back" and concluded nothing, while the
            //report sat in the drawer ending RECOMMENDATION: accept. ./papers.js
            //awaits the same function; this did not.
            var handed = (await handedBack(judgement.uid)) || [];
            var concluded = await concludedAcross(handed, async function (file) {
                return String(((await readHanded(judgement.uid, file)) || {}).text || '');
            });

            //AND THE TIPS, so this judgement can say later whether it still
            //describes what is there. A judgement made before another push is a
            //judgement of something else, and without this it reads as current
            //for ever.
            var read = await tipsFor(judgement.subject);
            if (concluded) to.info(ref + ' concluded: ' + concluded);

            spent.total = now() - began;
            //AWAITED -- see ./papers.js for what the bare call cost. Here it
            //cost the mark on the attempt: a Promise has no `attempts`, so the
            //exit code was written onto an empty list and the record kept
            //nothing about how the run ended.
            var latest = (await judging.get(id)) || judgement;

            //HOW THE RUN ENDED, KEPT ON THE ATTEMPT. The log said "exit 1" and
            //the record did not, so a judgement that CRASHED and one that read
            //the change and found nothing were the same row afterwards — and a
            //panel described the crash as a finding: "it read the change and
            //handed nothing back. That is an answer." It was not an answer. The
            //run died at `require` thirty-seven seconds in, having read nothing.
            //
            //THE DISTINCTION CANNOT BE RECOVERED LATER: the machine is rolled
            //back a few lines below, and the exit code goes with it.
            var marked = (latest.attempts || []).map(function (a) {
                return a.run === started.run
                    ? Object.assign({}, a, {
                        spent: spent,
                        exit: outcome.exit === undefined ? null : outcome.exit,
                        outcome: outcome.state || null
                    })
                    : a;
            });

            //DONE MEANS THE READING ENDED, not that a verdict was reached. A
            //judgement that ran and said nothing is a real and useful thing to
            //see: it is the difference between "nobody has looked" and
            //"somebody looked and would not say".
            judging.update(id, {
                state: 'done',
                attempts: marked,
                read: stamp(),
                //NOT A VERDICT. `concluded` is what the judge recommends; the
                //verdict is recorded by a person, and a supervisor has no tool
                //for either. Kept apart in the record for the same reason they
                //are kept apart in the flow.
                //SAID BEATS INFERRED, AND NEITHER IS DISCARDED. There are two
                //sources for this: the judge POSTing /verdict at the end of its
                //session, and this side reading a conclusion out of what it
                //handed back. The first is the judge SAYING what it concluded;
                //the second is working it out from a document.
                //
                //THIS WROTE `null` OVER THE SAID ONE. A judgement that posted
                //"accept" and handed back a report this parser could not read a
                //verdict from ended with `concluded: null` — the recommendation
                //arrived, was recorded, and was erased seconds later by the run
                //that was reporting the same event.
                concluded: concluded || (latest && latest.concluded) || null,
                tips: read
            });

            //---- AND ITS REVIEW, DRAFTED ----------------------------------
            //
            //A judgement of a pull request -- somebody else's, or a cut this
            //host sent -- becomes a review draft the moment it lands, so a
            //person finds it waiting rather than remembering to ask. Fire and
            //forget, the same shape as the wake below: a slow GitHub is not a
            //reason for the run to hang. `reviewDraft` itself declines a claim
            //check and a bare branch, so nothing is decided here.
            if (subject.kind === 'pull' || subject.kind === 'cut') {
                Promise.resolve(call('reviewDraft', { ref: ref })).catch(function (e) {
                    say('supervisor').warn(ref + ' finished but its review could not be drafted: ' + e.message);
                });
            }

            //---- AND THE LIVE CUT, BROUGHT UP TO THE BRANCH ---------------
            //
            //A JUDGE ACCEPTED THE BRANCH AS IT NOW STANDS, and if a pull
            //request is already open from it, that pull request should carry
            //this commit -- not the one a judge rejected an hour ago. The push
            //waited on somebody remembering to cut again, and nobody did.
            //`prCutRefresh` opens nothing; with no live cut it says so and
            //stops. Fire and forget, like the review.
            if (concluded === 'accept' && (subject.kind === 'branch' || subject.kind === 'cut')) {
                var line = subject.kind === 'cut' ? subject.source : subject.branch;
                if (line) {
                    Promise.resolve(call('prCutRefresh', { source: line })).then(function (r) {
                        if (r && r.refreshed) to.good(ref + ' accepted, so the open pull request(s) from "' + line + '" now carry the branch as it stands');
                    }).catch(function (e) {
                        to.warn(ref + ' accepted, but the pull request(s) from "' + line + '" could not be brought up to it: ' + e.message);
                    });
                }
            }

            to[handed.length ? 'good' : 'warn'](
                ref + ' done — ' + outcome.state
                + (outcome.exit === undefined ? '' : ' (exit ' + outcome.exit + ')')
                + ' — ' + (handed.length ? handed.length + ' file(s) handed back' : 'nothing handed back'));

            to.info(ref + ' took ' + secs(spent.total) + ' — '
                + Object.keys(spent).filter(function (k) { return k !== 'total'; })
                    .map(function (k) { return k + ' ' + secs(spent[k]); }).join(', '));

            //AND THE SUPERVISOR IS TOLD, which it was not, and which left a hole
            //in the middle of its own loop.
            //
            //A finished TASK woke it and a finished JUDGEMENT did not — so the
            //one thing a supervisor is most often waiting on was the one thing
            //that never arrived. It queues a judge because it cannot see the
            //code, records that it is waiting, and then sits there: the answer
            //lands, the board changes, and nothing tells it.
            //
            //THIS IS THE MORE IMPORTANT OF THE TWO WAKES, not the lesser. A task
            //finishing produces work to look at; a judgement finishing produces
            //a DECISION to make.
            try {
                if ((await wakes()) === true) {
                    Promise.resolve(call('supervisorWake', {
                        why: ref + ' finished — '
                            + (concluded ? 'it concluded "' + concluded + '"' : 'it reached no conclusion')
                    })).catch(function (e) {
                        say('supervisor').warn('it could not be woken after ' + ref + ': ' + e.message);
                    });
                }
            } catch (e) {
                say('supervisor').warn('could not tell the supervisor about ' + ref + ': ' + e.message);
            }
        } finally {
            //EXCEPT WHEN THIS APP LOST SIGHT OF IT, which is the one ending
            //where the machine's disk is the only account of what happened.
            if (outOfTouch) await putting.keepForLooking(machine, outOfTouch);
            else await putting.putAway(machine);
            release(machine);
        }
    }

    //---- what it is reading, and whether that is still true -----------------
    //
    //A BRANCH CUT AND A PR CUT are both this host's own work and are already in
    //the repositories. A PULL REQUEST FROM OUTSIDE is on GitHub and nowhere
    //else, so the first step of reading one is fetching it into a local branch —
    //which prFetch does, and which CHECKS THE ALLOWANCE AGAIN as it goes.
    //
    //CHECKED TWICE ON PURPOSE. The first check was at judgementCreate, minutes
    //or hours ago; this one is now, against the commit GitHub has now. In
    //between, the author may have pushed — and what a person allowed was a
    //COMMIT, not a pull request number.
    async function whatItReads(subject, ref, machine, to, phase) {
        if (subject.kind !== 'pull') {
            var branch = subject.kind === 'cut' ? subject.source : subject.branch;
            if (!branch) {
                throw new Error(ref + ' does not say what it is reading, so there is nothing '
                    + 'to set a machine up on.');
            }
            return { branch: branch, reading: null };
        }

        var row = await repoFor(subject.on);
        if (!row) throw new Error(ref + ' reads ' + subject.on + ', and no repository in this workspace is that.');

        var got = await phase('fetching', function () {
            return call('prFetch', { repo: row.repo, number: subject.number });
        });
        to.info(ref + ': ' + subject.on + '#' + subject.number + ' is here as "' + got.branch
            + '" at ' + String(got.head).slice(0, 7));

        //AND IT IS THE COMMIT THAT WAS JUDGED. prFetch proves somebody allowed
        //what is on GitHub now; this proves what is on GitHub now is what this
        //judgement was written about. A judgement of a different commit filed
        //under this one's name is the thing every "current" question downstream
        //would then be answering wrongly.
        if (subject.sha && got.head && String(got.head) !== String(subject.sha)) {
            throw new Error(ref + ' was written about ' + String(subject.sha).slice(0, 7)
                + ' and ' + subject.on + '#' + subject.number + ' is now at '
                + String(got.head).slice(0, 7) + '. Ask for a judgement of the commit it is on.');
        }

        return { branch: got.branch, reading: { repo: row.repo, branch: got.branch } };
    }

    function noteFor(subject, ref, branch, reading) {
        if (subject.kind !== 'pull') {
            return ref + ': reading ' + subject.name + ' — a judgement. Hand findings back as files; '
                + 'this machine may not push.';
        }
        return ref + ': reading ' + subject.name + ' — a pull request that arrived from outside this '
            + 'workspace. The change is on "' + branch + '" in ' + reading.repo + '; every other '
            + 'repository is on its default so you can say whether any of them needed changing too. '
            + 'Hand findings back as files; this machine may not push anywhere.';
    }

    //---- the whole log, which nothing kept ---------------------------------
    //
    //A task's output is archived under its uid the first time somebody opens the
    //task, and a judgement's was archived by nothing at all. So it lived on the
    //machine, and the machine is restored to its base snapshot a few lines
    //below: what survived was an exit code on this host and a thirty-line tail
    //in the event log, and only when it failed.
    //
    //THAT COST A DIAGNOSIS. A judgement exited 1 having read for 154 seconds and
    //handed nothing back. The supervisor went looking for the reason and asked
    //`taskLog` three times — the only log-reading tool there is — and was
    //refused three times, because a judgement is not a task.
    //
    //KEPT WHETHER OR NOT IT WENT WRONG. A successful reading's log is how
    //somebody answers "why did it take four minutes" or "did it actually run the
    //tests", and that question arrives later, when the machine is long since
    //rolled back. One round trip per run, not on a timer.
    async function keepTheLog(judgement, run, machine, outcome, to) {
        try {
            if (kept(judgement.uid, run)) return;
            var out = await call('vmRunOutput', { name: machine, run: run, lines: 2000 });
            keep(judgement.uid, run, {
                output: out.output || out.text || '',
                machine: machine,
                state: outcome.state || null,
                exit: outcome.exit === undefined ? null : outcome.exit
            });
            to.info('kept the log of ' + run + ', so it survives the machine');
        } catch (e) {
            to.warn('could not keep the log of ' + run + ': ' + e.message);
        }
    }

    //---- and why, if it went wrong, while the machine is still up ----------
    //
    //A job's own output lives ON THE MACHINE, and the machine is restored to its
    //base snapshot the moment this ends. So a run that failed takes the reason
    //with it, and what is left on this host is "exit 1" and nothing else.
    //
    //That cost two diagnoses in one day. The second was worse: a judge read
    //three repositories for four minutes, wrote a 21,000-character survey, and
    //the run still exited 1 — and the sentence saying why was deleted with the
    //machine before anybody could read it.
    //
    //READ ONLY WHEN IT FAILED, because a successful run's output is already
    //summarised and this is a round trip to a machine that is about to go away.
    async function sayWhyItFailed(run, machine, outcome, ref, to) {
        if (outcome.exit === 0) return;
        try {
            var tail = await call('vmRunOutput', { name: machine, run: run, lines: 30 });
            var said = String((tail && (tail.output || tail.tail)) || '').trim();
            if (!said) return;
            to.bad(ref + ' failed — what the run said before the machine was put away:');
            said.split(String.fromCharCode(10)).slice(-30).forEach(function (line) { to.info('  ' + line); });
        } catch (e) {
            to.warn(ref + ' failed and its output could not be read off ' + machine + ': ' + e.message);
        }
    }

    //---- a sign-in that could not authenticate ------------------------------
    //
    //THE READING NEVER STARTED, so the judgement goes back rather than being
    //marked done. Once, for the reason ./onetask gives.
    //
    //---- READ BACK, WHICH THE VERSION THIS COMES FROM DID NOT --------------
    //
    //The task path re-reads the record here and this one used the `judgement`
    //the caller was handed — which was read BEFORE the run started, so it does
    //not contain the attempt written when the run was dispatched. Marking "the
    //last attempt" on that list therefore marked the attempt BEFORE this one,
    //and writing the list back deleted the one that had just failed.
    //
    //So the record lost the run that could not authenticate, kept a `run` id
    //pointing at nothing in its history, and — because the mark landed on an
    //older attempt — `already` could read as 1 on a judgement that had only
    //failed once. That is the guard against re-queueing for ever firing on the
    //FIRST failure, which stops a judgement dead and says "replace the sign-in"
    //about a sign-in that had one bad try.
    //
    //Found by porting, not by running: the two paths were written apart and only
    //one of them was fixed. It is why they are now written to look alike.
    async function backInTheQueue(id, judgement, who, ref, to) {
        var attempts = (((await judging.get(id)) || judgement).attempts) || [];
        var already = attempts.filter(function (a) { return a.authFailed; }).length;

        //AND NOTHING IS FABRICATED WHEN THERE IS NOTHING TO MARK. An empty list
        //slices to an empty list, and the old shape turned that into an attempt
        //with no run, no machine and no time on it.
        var marked = attempts.slice();
        if (marked.length) {
            marked[marked.length - 1] = Object.assign({}, marked[marked.length - 1], { authFailed: who });
        }

        if (!already) {
            judging.update(id, {
                state: 'queued',
                machine: null,
                run: null,
                attempts: marked
            });
            to.warn(ref + ' is back in the queue — it was never read: "' + who
                + '" could not authenticate, and that sign-in is now paused');
            return true;
        }

        to.bad(ref + ' could not authenticate a second time, so it is not being re-queued again. '
            + 'Replace the judge sign-in on the Runners tab before this can run.');
        return false;
    }

    return { run: run };
};
