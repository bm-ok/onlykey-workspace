//what ../../test/queue/queue-redial.test.js has to be able to catch.
//
//EVERY BREAK BELOW IS ONE THING A LYING GUEST MUST NOT BE ABLE TO DO. The note
//comes from a machine, so it is a claim; each check is what turns a claim into
//something safe to act on, and removing any one of them lets a guest take work
//from another machine, revive one somebody finished, or invent one.
module.exports = {
    file: 'src/app/queue/redial.js',
    test: 'test/queue/queue-redial.test.js',
    breaks: [
        //---- what the machine actually said ----------------------------------

        //A GUEST SHELL PRINTS THINGS NOBODY ASKED FOR, and all of it arrives
        //here as output. Taking the whole reply reads a chatty machine as a
        //corrupt note.
        ['the whole reply is read as the note, not the last line of it',
            "    var text = String(output == null ? '' : output).trim().split(NEWLINE).pop().trim();",
            "    var text = String(output == null ? '' : output).trim();"],

        //UID IS WHAT IT IS ANSWERED BY. A note without one names nothing.
        ['a note with no uid is acted on',
            '        if (!note || !note.uid) return { empty: true };',
            ''],

        //SAID, NOT SWALLOWED. An unreadable note was written by a version of
        //this that no longer agrees with this one.
        ['an unreadable note is silently the same as no note',
            '        return { unreadable: true };',
            '        return { empty: true };'],

        //---- and everything a lying guest must not be able to do ---------------

        ['it can invent a task',
            "            to.info('it says it has #' + note.number + ', and there is no such task here any more — left alone');\n            return null;",
            '            task = { id: note.uid, number: note.number, uid: note.uid, branch: note.branch, state: \'queued\' };'],

        //NAMED BY UID AND ANSWERED BY UID. Looking one up by NUMBER follows a
        //number reissued after the task holding it was deleted.
        ['a task whose uid does not match is taken anyway',
            '        if (task.uid !== note.uid) return null;',
            ''],

        //A TASK RE-POINTED WHILE NOTHING WAS WATCHING is not the task this
        //machine was set up for.
        ['a task that has been re-pointed is followed',
            '        if (task.branch !== note.branch) {',
            '        if (false) {'],

        //ASKED OF THIS HOST'S OWN REGISTRY rather than taken from the note,
        //because that is the half a guest cannot write.
        ['a machine claims work it is not actually set up for',
            '        if (!vm || vm.branch !== task.branch) {',
            '        if (false) {'],

        ['a machine this host has no record of is believed',
            '        if (!vm || vm.branch !== task.branch) {',
            '        if (vm && vm.branch !== task.branch) {'],

        //IT MAY ONLY REATTACH A TASK SITTING IN THE QUEUE UNSTARTED. Anything
        //else is either finished or somebody else's.
        ['a task somebody finished is revived',
            "        if (task.state !== 'queued') {",
            '        if (false) {'],

        //---- and what the queue is already doing --------------------------------

        //A RACE OF SECONDS — a machine reconnecting while a tick is running —
        //and the tick is the one holding the machine.
        ['a machine the queue is mid-dispatch on is taken from it',
            '        if ((busy.machines || []).indexOf(machine) >= 0) return null;',
            ''],

        ['a task the queue is mid-dispatch on is taken from it',
            '        if ((busy.work || []).indexOf(task.id) >= 0) return null;',
            ''],

        //---- and what it is marked as ---------------------------------------------

        //THE QUEUE'S OWN RECOVERY re-queues tasks that were being set up and
        //never started. A machine that just said it has one is exactly that
        //shape, so without this it is taken straight back off it.
        ['it is marked a fresh dispatch, so recovery takes it back off the machine',
            '                worker: task.job ? task.worker : \'person\'',
            '                worker: task.worker'],

        //A JOB IS SOMETHING TO RUN, so a task with one is not a machine somebody
        //is sitting in and must not be filed as a person's.
        ['a task with a job is filed as somebody working by hand',
            '                worker: task.job ? task.worker : \'person\'',
            "                worker: 'person'"],

        //---- and the question itself ------------------------------------------------

        //RECONNECTING IS WHAT TRIGGERS THIS, so a hang here is a hang on every
        //machine that comes back.
        ['the machine is asked a question with no bound on the answer',
            "            what: 'asking what it is working on', timeout: 30000",
            "            what: 'asking what it is working on'"]
    ]
};
