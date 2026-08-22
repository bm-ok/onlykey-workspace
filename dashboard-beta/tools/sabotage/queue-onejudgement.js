//what ../../test/queue/queue-onejudgement.test.js has to be able to catch.
//
//THE FIRST BREAK IS THE SHAPE THE FROZEN APP IS STILL IN. It is here rather
//than in a comment because a bug found by reading is a claim, and a bug a test
//can fail on is a fact.
module.exports = {
    file: 'src/app/queue/onejudgement.js',
    test: 'test/queue/queue-onejudgement.test.js',
    breaks: [
        //---- reading a record that moved under you ---------------------------

        //THE VERSION THIS COMES FROM read the caller's `judgement`, taken before
        //the run started, so "the last attempt" was the attempt BEFORE the one
        //that failed — and writing that list back deleted the failure.
        ['the record is read as it was before the run started',
            '        var attempts = ((judging.get(id) || judgement).attempts) || [];',
            '        var attempts = (judgement.attempts) || [];'],

        ['an empty list is turned into an attempt with nothing on it',
            '        if (marked.length) {',
            '        if (true) {'],

        //ONCE. Every sign-in failing and a machine spent each time round is
        //worse than a judgement that stops and says so.
        ['it re-queues for ever',
            '        if (!already) {',
            '        if (true) {'],

        ['a judgement whose sign-in was dead is marked done rather than re-queued',
            '            if (metered && metered.failedAuthAs) {',
            '            if (false) {'],

        ['it goes back in the queue and is then finished anyway',
            '                if (await backInTheQueue(id, judgement, metered.failedAuthAs, ref, to)) return;',
            '                await backInTheQueue(id, judgement, metered.failedAuthAs, ref, to);'],

        //---- what it is reading, and whether that is still true --------------

        //WHAT A PERSON ALLOWED WAS A COMMIT, not a pull request number. In
        //between the allowance and now, the author may have pushed.
        ['a pull request is read at whatever commit it is on now',
            '        if (subject.sha && got.head && String(got.head) !== String(subject.sha)) {',
            '        if (false) {'],

        ['a judgement that names no branch is set up on nothing',
            '            if (!branch) {',
            '            if (false) {'],

        //A CUT OWNS NO BRANCH OF ITS OWN — it is read on the line its pull
        //requests were opened from, because that is where the change is.
        ['a cut is read on a branch it does not have',
            "            var branch = subject.kind === 'cut' ? subject.source : subject.branch;",
            '            var branch = subject.branch;'],

        //A REPOSITORY THIS WORKSPACE DOES NOT HAVE is named rather than guessed
        //at: fetching into the wrong one puts somebody else's change on a line
        //that is not theirs.
        ['a name no repository here answers to is fetched into anyway',
            '        if (!row) throw new Error(ref + \' reads \' + subject.on + \', and no repository in this workspace is that.\');',
            '        if (!row) row = { repo: subject.on };'],

        //NOT SWEPT: "resolving what it reads is inside the try". Moving it out
        //is what the bug was, and moving it out is not an edit to one line —
        //every break that fits this format either leaves it inside or stops it
        //happening at all, which is a different claim. The test for it is
        //`a judgement that does not say what it reads is refused, and its
        //machine still comes back`, and the `release(machine)` break below
        //reaches the same finally by another door.

        //---- everything that only exists on the machine ----------------------

        //THE LOG LIVED ON THE MACHINE AND NOTHING KEPT IT, so a reading that
        //failed left an exit code on this host and a thirty-line tail.
        ['the log is not kept, so it goes with the machine',
            '            await keepTheLog(judgement, started.run, machine, outcome, to);',
            ''],

        ['a log already kept is fetched and written a second time',
            '            if (kept(judgement.uid, run)) return;',
            ''],

        //A JUDGE ONCE WROTE A 21,000-CHARACTER SURVEY, EXITED 1, and the
        //sentence saying why was deleted with the machine.
        ['a reading that failed does not say why while the machine is still up',
            '            await sayWhyItFailed(started.run, machine, outcome, ref, to);',
            ''],

        ['every reading is asked for its tail, including the ones that worked',
            '        if (outcome.exit === 0) return;',
            ''],

        //---- how the run ended -----------------------------------------------

        //A CRASH AND A READING THAT FOUND NOTHING were the same row afterwards,
        //and a panel described the crash as a finding.
        ['how the run ended is not kept on the attempt',
            '                        exit: outcome.exit === undefined ? null : outcome.exit,',
            ''],

        ['nothing is recorded about where the time went',
            '                        spent: spent,',
            ''],

        //---- and the two endings ----------------------------------------------

        ['a machine that stopped answering is rolled back with the evidence on it',
            "            if (outcome.state === 'unreachable') {",
            '            if (false) {'],

        ['the queue never lets go of the machine',
            '            release(machine);',
            ''],

        //---- and what it concluded ---------------------------------------------

        ['what it concluded is never read out of what it handed back',
            '            var concluded = concludedAcross(handed, function (file) {',
            '            var concluded = null; if (false) concludedAcross(handed, function (file) {'],

        ['a judgement that would not say is not marked done',
            "                state: 'done',",
            "                state: concluded ? 'done' : 'reading',"]
    ]
};
