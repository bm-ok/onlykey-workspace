//what ../../test/queue/queue-doors-judge.test.js has to be able to catch.
//
//A VERDICT IS THE RECORD THAT SOMEBODY READ SOMETHING. Every break below either
//lets one be given about nothing — which afterwards is indistinguishable from a
//verdict about something — or loses the part of it a person would need to check
//the decision later.
module.exports = {
    file: 'src/app/queue/doors.js',
    test: 'test/queue/queue-doors-judge.test.js',
    breaks: [
        //---- nothing delivered is nothing to judge --------------------------

        ['work nobody pushed is accepted as though it were delivered',
            '        if (!art || !art.delivered) {',
            '        if (false) {'],

        //A READER THAT COULD NOT ANSWER must not read as "yes there is work
        //here". This is the half that catches a broken artifact read rather
        //than an empty branch.
        ['and an artifact read that answered nothing counts as delivery',
            '        if (!art || !art.delivered) {',
            '        if (art && !art.delivered) {'],

        //THE GAP BETWEEN "THE RUN ENDED" AND "SOMEBODY IS DECIDING" is exactly
        //where a branch stops being empty — or where a stale answer lets a
        //verdict through on one that still is.
        ['the branch is not read at all when the verdict is given',
            '        var art = await ask.delivered(task.branch);',
            '        var art = { delivered: true, summary: "" };'],

        //---- the verdict itself ---------------------------------------------

        ['anything at all is taken as a verdict',
            "        if (call !== 'accept' && call !== 'reject') {",
            '        if (false) {'],

        ['and only an exact lowercase word is',
            "        var call = String(verdict == null ? '' : verdict).trim().toLowerCase();",
            "        var call = String(verdict == null ? '' : verdict);"],

        //---- a rejection says why --------------------------------------------

        //SENT BACK TO A WORKER THAT CANNOT ASK WHAT WAS WRONG, so a rejection
        //that says nothing is an instruction to guess.
        ['work is rejected with no reason given',
            "        if (call === 'reject' && !why) {",
            '        if (false) {'],

        ['and whitespace counts as a reason',
            "        var why = String(note == null ? '' : note).trim();",
            "        var why = String(note == null ? '' : note);"],

        //---- and what is written down ----------------------------------------

        //THE BRANCH MOVES ON. A verdict that only says "accepted" is one nobody
        //can check afterwards.
        ['what was on the branch when it was decided is not kept with the decision',
            '                on: art.summary',
            '                on: null'],

        ['nothing records when it was decided',
            '                at: new Date().toISOString(),',
            '                at: null,'],

        ['a rejection records no reason even when one was given',
            '                note: why || null,',
            '                note: null,'],

        ['an acceptance and a rejection leave the task in the same state',
            "            state: call === 'accept' ? 'accepted' : 'rejected',",
            "            state: 'accepted',"],

        //---- and a decided task stays decided ---------------------------------
        //
        //THE DOOR THAT ALREADY READ `verdict` — write a new task rather than
        //reopening a decided one. Broken here rather than in the queue door's
        //own file, because what makes it work is that `judge` WROTE the field.
        ['a judged task is left with nothing saying so, so it can be queued again',
            '            verdict: {',
            '            noVerdict: {']
    ]
};
