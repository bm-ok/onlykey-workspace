//what ../../test/queue/queue-adopting.test.js has to be able to catch.
//
//FOUR SITUATIONS, TOLD APART. Every break below either confuses two of them or
//removes the thing that brings a machine back, and the cost of each is either a
//completed reading lost or a machine held out of the pool with nobody watching.
module.exports = {
    file: 'src/app/queue/adopting.js',
    test: 'test/queue/queue-adopting.test.js',
    breaks: [
        //---- adoption over an empty board -----------------------------------

        //ASKING WOULD READ AN EMPTY BOARD AND "RECOVER" IT, which is adoption
        //doing the one thing it exists to prevent.
        ['it recovers a workspace nobody is serving',
            "        if (!workspaceOpen()) return { skipped: 'no workspace' };",
            ''],

        //---- work that never started ------------------------------------------

        //IT SAT IN `given` WITH NO RUN, invisible to everything: the queue only
        //looks at `queued`, and the board showed it working with no worker.
        ['a task that never started is left where nothing will find it',
            '        var lostTasks = stranded(tasks, function (t) { return t.worker; });',
            '        var lostTasks = [];'],

        //THE DOOR LEFT OPEN WHEN THE SECOND KIND OF WORK WAS ADDED.
        ['and a judgement that never started, which is how this was missed before',
            '        var lostReadings = stranded(judgements, function (j) { return j.by; });',
            '        var lostReadings = [];'],

        //IT IS PUT BACK, NOT MARKED DONE. Nothing was dispatched, so no work
        //happened and there is nothing to judge.
        ['work that never started is filed as having been done',
            "                await call('taskUpdate', { id: t.id, task: { state: 'queued', machine: null } });",
            "                await call('taskUpdate', { id: t.id, task: { state: 'done' } });"],

        //THE MACHINE IS LET GO OF TOO. A task back in the queue still naming a
        //machine is a task that reads as being on one.
        ['it goes back in the queue still naming the machine it was on',
            "                await call('taskUpdate', { id: t.id, task: { state: 'queued', machine: null } });",
            "                await call('taskUpdate', { id: t.id, task: { state: 'queued' } });"],

        //ONE THAT COULD NOT BE WRITTEN MUST NOT STOP THE REST. A restart strands
        //several at once, and stopping at the first leaves the others invisible.
        ['one re-queue that fails stops every one behind it',
            '            } catch (e) { /* said by the warning above */ }\n            back.push(\'#\' + t.number);',
            "            } finally { /* nothing */ }\n            back.push('#' + t.number);"],

        //---- work that WAS running ----------------------------------------------

        //RE-QUEUEING ONE THAT STARTED runs it a second time on a second machine
        //while the first is still going.
        ['work that was running is re-queued as though it never started',
            '        tasks.filter(function (t) {\n            return t.state === \'given\' && t.machine && t.run;\n        })',
            "        tasks.filter(function (t) { return false && t.run; })"],

        ['and a reading that was running is picked up by nothing',
            "            return j.state === 'given' && j.machine && j.run && j.by !== 'person';",
            '            return false;'],

        //A MACHINE THE QUEUE ALREADY HOLDS IS THE QUEUE'S. Two things waiting on
        //one run is two things putting one machine away.
        ['a machine the queue is already holding is adopted out from under it',
            '            if (held(task.machine)) return;',
            ''],

        //---- and a person's, in all four ------------------------------------------

        //THERE IS NO RUN BECAUSE THERE IS NO WORKER PROCESS. Re-queueing one
        //hands their branch to a second machine while they are still in the first.
        ['a reading somebody is doing themselves is taken off them',
            "            return j.state === 'given' && j.machine && j.run && j.by !== 'person';",
            "            return j.state === 'given' && j.machine && j.run;"],

        //---- and the machine coming back ------------------------------------------

        //THE `finally` THAT PUTS IT AWAY DIED WITH THE PROCESS THAT WAS WATCHING,
        //so a complete reading left a machine up holding a judge's credential.
        ['an adopted task never gives its machine back',
            '            await putting.putAway(task.machine);\n            release(task.machine);',
            ''],

        ['an adopted reading never gives its machine back',
            '            await putting.putAway(j.machine);\n            release(j.machine);',
            ''],

        //---- what only exists on the machine ---------------------------------------

        //THE LOG READER EXPLAINED THE ABSENCE as "read before this app started
        //keeping their logs have none". For one made four minutes earlier.
        ['the log is thrown away, exactly as this path used to',
            '                await keepTheLog(j, outcome, to);',
            ''],

        ['a log already kept is fetched and written a second time',
            '            if (kept(j.uid, j.run)) return;',
            ''],

        //THE ONLY PLACE THE RECOMMENDATION EXISTS for a reading this app was not
        //watching.
        ['what it recommended is never read off the machine',
            '                concluded = await whatItRecommended(j);',
            ''],

        //A CONCLUSION ALREADY RECORDED must not be overwritten with nothing by a
        //machine that has gone away.
        ['a conclusion already on the record is wiped by an adoption',
            '                concluded: concluded || j.concluded || null,',
            '                concluded: concluded || null,'],

        //THE ATTEMPT IS WHERE "IT CRASHED" AND "IT FINISHED AND SAID NOTHING"
        //are told apart, and the machine is rolled back a moment later.
        ['how the run ended is left blank, as an adopted run used to',
            '                if (a.run !== j.run) return a;',
            '                return a;'],

        ['every attempt is marked, not the one this run was',
            '                if (a.run !== j.run) return a;',
            ''],

        //---- and what the okc-result line says ---------------------------------------

        ['the FIRST line is taken, so a shell that prints twice wins',
            '            if (o && o.recommendation) last = o.recommendation;',
            '            if (o && o.recommendation && !last) last = o.recommendation;'],

        ['a half-written line is guessed at rather than skipped',
            "            var o = JSON.parse(trimmed.slice('okc-result'.length).trim());",
            "            var o = { recommendation: trimmed.slice('okc-result'.length).trim() };"]
    ]
};
