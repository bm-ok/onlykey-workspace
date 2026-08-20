//---------------------------------------------------------------------------
//WHAT THE DRILLS REMEMBER, and it outlives the window.
//
//This was once a variable — `lastRun`, holding the one run the process had done.
//A restart wiped it and the board went back to reporting "not run", which is
//indistinguishable from a suite nobody has ever run, in an app that is restarted
//every time a line of it changes. It cost most where it hurt most: a drill that
//builds a machine from an ISO is half an hour of evidence, and it lived in one
//process's memory.
//
//THE ARGUMENT AGAINST KEEPING IT WAS RIGHT AND IS ANSWERED HERE. A result kept
//across a restart is "a claim about code that has since changed" — true, and the
//reason this stores a FINGERPRINT of each check beside its result. A remembered
//result whose check has been edited is not shown as a result; it says the check
//changed, which is more useful than a stale green tick.
//
//---- what moving it onto ../core/state changed ----------------------------
//
//IT IS `state.here` AND IT USED TO BE THE APP DRAWER WITH THE WORKSPACE WRITTEN
//INSIDE IT. Over there this file keeps a `workspace` field, a `claim(dir)` that
//notices when it has changed, and a `forWorkspace(dir)` every reader has to
//remember to call. That is the workspace drawer, hand-rolled, in the drawer next
//to it — and ../core/state exists precisely so that is not written twice.
//
//SO TWO FUNCTIONS ARE GONE RATHER THAN PORTED. There is no `claim` because a
//drawer is not claimed, and no `forWorkspace` because there is no way to read
//another workspace's. A reader that forgets to filter cannot exist.
//
//AND SWITCHING WORKSPACE NO LONGER DESTROYS ANYTHING. `claim` cleared the board
//when the folder changed — right in spirit, since the same check against another
//set of repositories is a different question, and wrong in effect: going to
//another workspace and coming back left you with nothing, and half an hour of
//ISO evidence was gone because somebody looked at a different folder. Each
//workspace has its own drawer now, so the results are not shown and not lost.
//
//NOTHING CALLS THIS YET, AND THAT IS SAID RATHER THAN HIDDEN. The board is
//`suites`, which enumerates the drills, which needs the harness — and the
//harness has not been ported. What is here is the half that could come over
//whole and be proven on its own: the store, its staleness rules, and the
//interrupted-run recovery. See ./HARNESS.md for what the other half costs.
//---------------------------------------------------------------------------

//A CHECK IS IDENTIFIED BY ALL THREE OF SUITE, TEST AND CHECK. A file's title is
//only unique inside its folder, so a key made of two would quietly merge two
//different checks that happen to share a name.
var keyOf = function (group, test, check) { return [group, test, check].join(' / '); };
var wholeOf = function (group, test) { return test ? (group + ' / ' + test) : group; };

var EMPTY = { checks: {}, wholes: {}, states: {}, run: null };

function shaped(raw) {
    return {
        checks: (raw && raw.checks && typeof raw.checks === 'object') ? raw.checks : {},
        wholes: (raw && raw.wholes && typeof raw.wholes === 'object') ? raw.wholes : {},
        states: (raw && raw.states && typeof raw.states === 'object') ? raw.states : {},
        run: (raw && raw.run) || null
    };
}

//IS THAT PROCESS STILL THERE? Signal 0 asks the operating system whether a pid
//exists without sending it anything, and it is in node itself.
//
//A pid could in principle have been reused by something unrelated. The
//consequence of believing that is a stale run left marked running, which the
//next run reports plainly; the consequence of not asking at all was a LIVE run
//marked interrupted, which corrupts the board it is writing. Between those two
//the choice is not close.
function stillThere(pid) {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; } catch (e) { return false; }
}

module.exports = function runs(state) {

    //ASKED EVERY TIME RATHER THAN HELD. Which workspace is open is not a
    //constant, and a doc held across a switch is the contamination ../core/state
    //exists to prevent — arriving by the one route the drawer cannot stop.
    async function doc() { return state.here.doc('tests'); }

    async function held() { return shaped((await doc()).read(null)); }

    //READ, CHANGE, WRITE, in one call each. The app being ported from memoises
    //the whole file in a module variable and writes the memo — which is faster
    //and is why `claim` had to exist to invalidate it. There is no memo here, so
    //there is nothing to invalidate, and the cost is a few kilobytes of JSON per
    //check rather than per run. That is the trade this whole file is making: the
    //drills write a few times a minute at most.
    async function change(fn) {
        var d = await doc();
        var now = shaped(d.read(null));
        var out = fn(now);
        d.write(now);
        return out === undefined ? now : out;
    }

    //---- the run that was interrupted --------------------------------------
    //
    //A run in flight is written down as running. Finding that on startup means
    //the run belonged to a process that is gone — the app was restarted or
    //killed mid-drill — and saying so is the honest answer. A machine may well
    //still be doing what that drill asked, which is exactly the state somebody
    //needs to be told about rather than left to infer from a board that says
    //nothing.
    async function tookOver() {
        return change(function (now) {
            //A RUN WHOSE PROCESS IS STILL ALIVE IS NOT ONE TO TAKE OVER — it is
            //one somebody else is in the middle of. A record with no pid at all
            //is from before this was written down, and the old answer is right
            //for it.
            if (now.run && now.run.running && now.run.pid && stillThere(now.run.pid) && now.run.pid !== process.pid) {
                return false;
            }
            if (!(now.run && now.run.running)) return false;

            now.run = Object.assign({}, now.run, { running: false, interrupted: true });
            Object.keys(now.checks).forEach(function (k) {
                if (now.checks[k].state === 'running') {
                    now.checks[k] = Object.assign({}, now.checks[k], {
                        state: 'interrupted',
                        why: 'the dashboard was restarted while this was running'
                    });
                }
            });
            return true;
        });
    }

    //---- what one check did ------------------------------------------------

    async function remember(group, test, check, result) {
        var r = result || {};
        return change(function (now) {
            now.checks[keyOf(group, test, check)] = {
                state: r.state,
                at: r.at || new Date().toISOString(),
                ms: r.ms == null ? null : r.ms,
                why: r.why || null,
                log: Array.isArray(r.log) ? r.log : [],
                //WHAT THE CHECK WAS when it produced this, so a result cannot
                //outlive the code it is about.
                fingerprint: r.fingerprint || null
            };
        });
    }

    async function recall(group, test, check, fingerprint) {
        var was = (await held()).checks[keyOf(group, test, check)];
        if (!was) return null;
        if (fingerprint && was.fingerprint && was.fingerprint !== fingerprint) {
            return Object.assign({}, was, {
                state: 'changed',
                why: 'this check has been edited since it last ran, so what it did then says nothing about what it does now',
                stale: true
            });
        }
        return was;
    }

    //---- what ran AS A WHOLE, and what has been dirtied since ---------------
    //
    //A suite that passes is a claim about the suite, and it can only be made by
    //running the suite. Run one test inside it and that test's result is current
    //while the SUITE's is not — the rest has not been tried since. Which is
    //exactly when somebody is most likely to believe it: they just watched the
    //part they were working on go green.

    //A CLEAN WHOLE RUN IS THE ONLY THING THAT CLEARS EITHER MARK. Dirty says the
    //claim is stale; disproved says it was contradicted. Running the suite
    //settles both, and nothing else is allowed to.
    async function ranWhole(what) {
        return change(function (now) {
            now.wholes[what] = { at: new Date().toISOString(), dirty: false };
        });
    }

    //CONTRADICTED FROM OUTSIDE, which is stronger than stale.
    //
    //Some checks carry evidence about somebody else's suite. A task drill that
    //cannot put its machine back to base has not made "a machine goes away
    //clean" out of date — it has shown it to be false, at the end of real work,
    //which is harder evidence than the machines suite gathers about itself. So
    //the suite reads as failed rather than merely wanting a re-run, and it says
    //which check did it: a red mark that cannot name its cause is one somebody
    //clears out of irritation.
    async function disprove(what, by) {
        var b = by || {};
        return change(function (now) {
            var was = now.wholes[what];
            now.wholes[what] = {
                at: was ? was.at : null,
                dirty: true,
                disprovedBy: {
                    at: new Date().toISOString(),
                    suite: b.suite || null,
                    test: b.test || null,
                    check: b.check || null,
                    why: b.why || null
                }
            };
        });
    }

    async function dirty(what) {
        return change(function (now) {
            var was = now.wholes[what];
            //`at` IS WHEN IT LAST RAN WHOLE, and null means never. Dirty is
            //recorded either way: something under this has been run on its own,
            //which is worth saying whether or not the whole was established.
            //
            //It was written the other way at first — refusing to dirty something
            //that had never run whole, so "never tried" could not be dressed up
            //as "tried and then disturbed". Right for a suite nobody has
            //touched, and wrong the moment a run CARRIES steps.
            //
            //AND IT KEEPS A CONTRADICTION. This wrote a fresh record at first,
            //which dropped `disprovedBy` — so a suite shown to be false went
            //quietly back to merely stale the next time anything dirtied it,
            //which on a busy board is minutes.
            now.wholes[what] = Object.assign(
                { at: was ? was.at : null, dirty: true },
                (was && was.disprovedBy) ? { disprovedBy: was.disprovedBy } : {}
            );
        });
    }

    async function wholeState(what) { return (await held()).wholes[what] || null; }

    //---- what a drill itself remembers, for the few that need it -----------
    //
    //Separate from results, and OPT-IN. Most drills want none of it: a series
    //hands things between its own checks through `state`, and when the run ends
    //that state is finished with — keeping it would make the next run start from
    //somebody else's leftovers.
    //
    //THE ONES THAT NEED IT ARE THE ONES THAT RESTART SOMETHING. A drill proving
    //the queue picks up in-flight work after a restart cannot span that restart
    //inside one run: the harness runs inside the dashboard, so the run dies with
    //it. The only way to write that test is for the drill to leave itself a
    //note, be run again, and find out where it had got to.
    async function saveState(group, test, value) {
        return change(function (now) {
            now.states[wholeOf(group, test)] = {
                at: new Date().toISOString(),
                //ONLY WHAT SURVIVES JSON. A drill that put a function or a
                //machine handle here would find it gone after the restart it is
                //testing, and the failure would look like the app's rather than
                //its own.
                value: JSON.parse(JSON.stringify(value == null ? {} : value))
            };
        });
    }

    async function loadState(group, test) {
        var was = (await held()).states[wholeOf(group, test)];
        return was ? was.value : null;
    }

    async function forgetState(group, test) {
        return change(function (now) { delete now.states[wholeOf(group, test)]; });
    }

    //---- the run itself ----------------------------------------------------

    async function began(asked) {
        return change(function (now) {
            //WHOSE RUN IT IS, and it has to be written down. `tookOver` decides
            //whether a run recorded as running belongs to a process that is
            //gone. It used to answer that with "am I starting? then it does",
            //which is true of the dashboard starting and FALSE of every other
            //process that loads these modules — and running one while the drills
            //were going marked the live run interrupted and flipped every check
            //in flight.
            //
            //Caught by building a banner that lights while a run is going: it
            //stayed dark through a run that was plainly happening.
            now.run = {
                at: new Date().toISOString(),
                asked: asked || null,
                running: true,
                interrupted: false,
                pid: process.pid
            };
        });
    }

    async function ended(counts) {
        return change(function (now) {
            now.run = Object.assign({}, now.run || {}, {
                running: false,
                finished: new Date().toISOString(),
                counts: counts || null
            });
        });
    }

    async function lastRun() { return (await held()).run; }

    //HOW FAR THE RUN THAT IS GOING HAS GOT, counted off the same records the
    //board is drawn from rather than kept a second time. Only the checks
    //belonging to THIS run count: `at` is compared against when the run began,
    //so a board full of yesterday's passes does not report as progress.
    async function progress() {
        var now = await held();
        var run = now.run;
        if (!run || !run.running) return null;

        var since = Date.parse(run.at || 0) || 0;
        var passed = 0, failed = 0, other = 0;
        var doing = null;
        //AND WHAT IT WAS DOING A MOMENT AGO, for the gap between checks. A check
        //is written down as running when it starts and overwritten when it ends,
        //so between two of them nothing is running — which is true, and useless
        //to say. Sampled during a suite of sub-second refusals the answer was
        //"nothing" more often than not, and the banner read "starting" after ten
        //checks had already passed. So the most recent one stands in.
        var latest = null, latestAt = 0;

        Object.keys(now.checks).forEach(function (key) {
            var c = now.checks[key];
            if (c.state === 'running') { doing = key; return; }
            var when = Date.parse(c.at || 0) || 0;
            if (when < since) return;
            if (when >= latestAt) { latestAt = when; latest = key; }
            if (c.state === 'passed') passed++;
            else if (c.state === 'failed') failed++;
            else other++;
        });

        return { doing: doing || latest, passed: passed, failed: failed, other: other, done: passed + failed + other };
    }

    //---- forgetting --------------------------------------------------------
    //
    //A result that is wrong is worse than none, and the ways to get one are
    //ordinary: a check was changed, a machine was in a state it will never be in
    //again, somebody wants a clean board before a demonstration.
    async function forget(what) {
        var w = what || {};
        return change(function (now) {
            var count = function () {
                return Object.keys(now.checks).length + Object.keys(now.wholes).length + Object.keys(now.states).length;
            };
            var before = count();

            if (!w.group && !w.test && !w.check) {
                now.checks = {};
                now.wholes = {};
                now.states = {};
                now.run = null;
                return before;
            }

            var wanted = function (key) {
                var p = key.split(' / ');
                if (w.group && p[0] !== w.group) return false;
                if (w.test && p[1] !== w.test) return false;
                if (w.check && p[2] !== w.check) return false;
                return true;
            };

            Object.keys(now.checks).forEach(function (k) { if (wanted(k)) delete now.checks[k]; });
            Object.keys(now.wholes).forEach(function (k) { if (wanted(k)) delete now.wholes[k]; });
            //A DRILL'S OWN NOTE GOES WITH IT. Clearing a suite and leaving the
            //thing it was in the middle of would be the worst of both: a clean
            //board and a drill that still thinks it is half way through.
            Object.keys(now.states).forEach(function (k) { if (wanted(k)) delete now.states[k]; });

            //AND THE SUITE ABOVE IT IS NO LONGER WHOLE. Forgetting one test
            //inside a suite that had been run entire leaves a suite-level pass
            //covering a result that is now gone — the same lie as running one
            //test and leaving the suite green.
            if (w.group && now.wholes[w.group]) {
                now.wholes[w.group] = Object.assign({}, now.wholes[w.group], { dirty: true });
            }
            return before - count();
        });
    }

    return {
        keyOf: keyOf, wholeOf: wholeOf, stillThere: stillThere,
        tookOver: tookOver,
        remember: remember, recall: recall,
        ranWhole: ranWhole, dirty: dirty, disprove: disprove, wholeState: wholeState,
        saveState: saveState, loadState: loadState, forgetState: forgetState,
        began: began, ended: ended, lastRun: lastRun, progress: progress,
        forget: forget,
        //WHERE IT IS, asked of the drawer rather than remembered here — the
        //mistake ../guards/main.js made when it moved, which threw on every call
        //for a field nothing needed to be a local.
        where: async function () { return (await doc()).path; },
        all: held
    };
};
module.exports.EMPTY = EMPTY;
