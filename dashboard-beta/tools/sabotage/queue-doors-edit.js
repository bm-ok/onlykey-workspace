//what ../../test/queue/queue-doors-edit.test.js has to be able to catch.
//
//THE DOOR TWO CALLERS SHARE — a person editing a draft, and the queue recording
//what happened to a run. Every break below either lets one of them rewrite what
//the other was answering, or lets the library and the record disagree about what
//a worker was held to.
module.exports = {
    file: 'src/app/queue/doors.js',
    test: 'test/queue/queue-doors-edit.test.js',
    breaks: [
        //---- what cannot change once it has been given out --------------------

        //THE BRIEF AND THE BRANCH are what a worker was TOLD and WHERE it
        //delivered. Editing either rewrites the question a piece of work was the
        //answer to, and a verdict then refers to something that was never asked.
        ['a task already given out can have its brief rewritten',
            '        if (now.machine && (it.brief || it.branch || it.contract)) {',
            '        if (false) {'],

        ['and only the brief is protected, so the branch can still move',
            '        if (now.machine && (it.brief || it.branch || it.contract)) {',
            '        if (now.machine && it.brief) {'],

        ['and the contract file can still be swapped underneath a finished run',
            '        if (now.machine && (it.brief || it.branch || it.contract)) {',
            '        if (now.machine && (it.brief || it.branch)) {'],

        //THE STATE IS NOT AMONG THEM, and if it were the queue could not record
        //what happened to the work it dispatched — which is what this door is
        //for half the time.
        ['nothing about a given task may change, so the queue can record nothing',
            '        if (now.machine && (it.brief || it.branch || it.contract)) {',
            '        if (now.machine) {'],

        //---- the branch is checked here as it is at the other door -------------

        //WITHOUT IT THE ORDER HOLDS AT THE DOOR AND NOT AT THE WINDOW BESIDE IT:
        //write the task correctly, then edit the branch to one nobody has cut.
        ['a branch nobody has cut can be edited in',
            '        if (it.branch) {\n            var why = await branchIsReady(String(it.branch).trim());\n            if (why) throw new Error(why);\n        }',
            ''],

        //---- what the library says, copied in ----------------------------------

        //THE FAILURE THIS SHARED FUNCTION EXISTS FOR. Changing which contract a
        //task ran under changed the NAME and left the WORDS, so the board said
        //one contract and the worker was held to another.
        ['the contract name moves and the rules do not',
            '                it.rules = one.text;',
            ''],

        ['the rules move and the name does not',
            '                it.contractName = one.name;',
            ''],

        ['nothing from the library is copied in on an edit at all',
            "        if (!editing || ('contractId' in it)) {",
            '        if (!editing) {'],

        //TAKEN OFF, AND TAKEN OFF COMPLETELY. Leaving the words behind reads as
        //"no contract" everywhere the id is checked and "these rules" everywhere
        //the text is, which is worse than either.
        ['taking the contract off leaves its words behind',
            '                it.rules = null;',
            ''],

        //A KEY THAT IS NOT THERE IS NOT A CHANGE. Treating a missing key as "set
        //it to none" strips the rules off every task the queue touches.
        ['a missing key is read as a removal, so the queue strips every task bare',
            "        if (!editing || ('contractId' in it)) {",
            '        if (true) {'],

        ['and the same for the job, so a dispatch unnames the job it is running',
            "        if (editing ? ('job' in it) : !!it.job) {",
            '        if (true) {'],

        //---- and the refusals that hold on both paths -----------------------------

        //WHAT A WORKER MAY NOT DO IS READ BEFORE IT IS SENT, the same as what it
        //is told to do.
        ['an unapproved contract can be put on a task by editing it',
            '                if (!one.approved) {',
            '        if (false) {\n                if (false) {'],

        ['a contract that does not exist is accepted, and the task carries a name with no words',
            "                if (!one) throw new Error('There is no contract called \"' + wanted + '\".');",
            '                if (!one) one = { name: wanted, text: null, approved: true };'],

        //BOTH AT ONCE is refused rather than silently preferring one — otherwise
        //which rules a run was under depends on which line of code read it first.
        ['a library contract and a file on this host can be held at once',
            '                if (alsoAFile) {',
            '                if (false) {'],

        //ASKED OF WHAT THE TASK CARRIES, not only of the patch.
        ['only the patch is asked, so a library contract lands on a task holding a file',
            "                var alsoAFile = editing\n                    ? (it.contract || (!('contract' in it) && o.carries))\n                    : it.contract;",
            '                var alsoAFile = it.contract;'],

        //A JUDGE READS A CHANGE AND SAYS WHETHER IT HOLDS. A task makes one, and
        //the refusal exists on both doors or on neither.
        ['a judge can be made a task job by editing it in',
            "            if (job && job.kind === 'judge') {",
            '            if (false) {'],

        ['a job that does not exist is accepted on an edit',
            "                throw new Error('There is no job called \"' + named + '\". Ask for \"jobs\" to see what there is.');",
            '                job = { id: named, name: named };'],

        ['taking the job off leaves its name behind',
            '            it.jobName = job ? job.name : null;',
            '            if (job) it.jobName = job.name;'],

        //THE PROMPT'S NAME TRAVELS WITH ITS ID because the library entry may be
        //gone by the time anybody reads the task.
        ['a prompt id is kept with no name beside it',
            '            it.promptName = from ? from.name : null;',
            ''],

        ['a prompt that does not exist is accepted',
            "            if (whose && !from) throw new Error('There is no prompt called \"' + whose + '\".');",
            '']
    ]
};
