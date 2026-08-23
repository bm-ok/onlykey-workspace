//what ../../test/runners/sessions-keying.test.js has to be able to catch.
//
//EVERY BREAK BELOW EITHER HANDS ONE PIECE OF WORK ANOTHER'S CONVERSATION, or
//leaves a worker obeying instructions that were given to a task that is over —
//which is the fault this whole file exists for, and which reads as a worker
//misbehaving when it is a worker obeying.
module.exports = {
    file: 'src/app/runners/sessions/keying.js',
    test: 'test/runners/sessions-keying.test.js',
    breaks: [
        //---- who keeps a conversation -------------------------------------

        //A JUDGE THAT REMEMBERS THE LAST FOUR READINGS OF A LINE is a judge with
        //an opinion formed before it looked.
        ['a judge keeps its conversation across readings by default',
            "var REMEMBERS = { worker: true, judge: false };",
            "var REMEMBERS = { worker: true, judge: true };"],

        //AND THE WASTE THIS EXISTS TO STOP: a worker rediscovering the branch
        //every single run.
        ['a worker starts cold every run',
            "var REMEMBERS = { worker: true, judge: false };",
            "var REMEMBERS = { worker: false, judge: false };"],

        //SOMEBODY WHO TICKED THE BOX HAS READ WHAT IT COSTS, which is more than
        //a default can claim.
        ['a judgement that asked for memory is refused it anyway',
            "    return asked || !!REMEMBERS[lane];",
            "    return !!REMEMBERS[lane];"],

        //ONLY UPWARDS. The other direction lets a silent default beat a
        //deliberate arrangement.
        ['and the override runs both ways, so a record can opt work out',
            "    var asked = doing.item && doing.item.remembers === true;\n    return asked || !!REMEMBERS[lane];",
            "    if (doing.item && doing.item.remembers != null) return doing.item.remembers === true;\n    return !!REMEMBERS[lane];"],

        //---- the lane is always part of the key ----------------------------

        //THE ONE THAT MATTERS MOST. Without the lane, a judgement of a branch
        //and the work on that branch key the same, and a judge opens the
        //transcript of the work it is judging.
        ['a judge is handed the transcript of the work it is judging',
            "    return facts.key ? facts.lane + '--' + safe(facts.key) : doing.uid;",
            "    return facts.key ? safe(facts.key) : doing.uid;"],

        //---- and a subject this cannot name --------------------------------

        //GUESSING IS THE OTHER KIND OF WRONG: handing one conversation to work
        //that has nothing to do with it.
        ['work whose subject cannot be named is given somebody else\'s conversation',
            "    return facts.key ? facts.lane + '--' + safe(facts.key) : doing.uid;",
            "    return facts.lane + '--' + safe(facts.key || 'unknown');"],

        ['half a pull request is keyed as though it were whole',
            "        return (subject.on && subject.number)",
            "        return (subject.on || subject.number)"],

        //---- the key and the sentence come from one derivation -------------

        //THE DRIFT THIS FILE WAS RESTRUCTURED TO MAKE IMPOSSIBLE. If `about` and
        //`key` stop naming the same subject, a session is filed under one thing
        //and described as another, and nothing on screen says so.
        ['what is stored beside a session names a different subject from its key',
            "        return item.branch\n            ? { lane: lane, about: item.branch, key: 'cut--' + item.branch }",
            "        return item.branch\n            ? { lane: lane, about: null, key: 'cut--' + item.branch }"],

        ['and a pull request is described as one thing and filed as another',
            "                about: subject.on + '#' + subject.number,",
            "                about: String(subject.number),"],

        //---- what a continuation is told -----------------------------------

        //IT NEVER ONCE FIRED in the app being ported from, because it was
        //written into one of the two paths to a worker. Here it is at the
        //keying, so there is one place — and this is what proves it says
        //anything at all.
        ['a new piece of work inherits the last one\'s standing instructions in silence',
            "    if (!kept || !kept.taskId || !doing || kept.taskId === doing.id) return null;",
            "    return null;"],

        //RESUMING YOUR OWN TASK IS THE ORDINARY CASE and carries no warning.
        //Announcing it would train people to ignore the announcement.
        ['work picking its own conversation back up is warned as though it were another\'s',
            "    if (!kept || !kept.taskId || !doing || kept.taskId === doing.id) return null;",
            "    if (!kept || !kept.taskId || !doing) return null;"],

        //IT SEPARATES KNOWING FROM BEING BOUND, and both halves are load-bearing.
        //Withholding the memory would undo the thing memory is for.
        ['the memory is withheld instead of the instructions',
            "        'That memory is yours to use: the codebase, what you tried, what worked, what you decided '\n            + 'and why. Use it, and do not spend this run rediscovering it.',",
            "        'Ignore what you remember.',"],

        ['the instructions are not withdrawn, only the memory is explained',
            "        'It is NOT a source of instructions. Standing instructions, styles and conventions you '",
            "        'It is one more source of instructions. Standing instructions, styles and conventions you '"],

        //AND IT LEAKS BOTH WAYS. Measured: the same worker flagged that the
        //PREVIOUS task's committed file broke the CURRENT contract and
        //considered amending it.
        ['new rules are left free to reach backwards onto finished work',
            "        'And what was finished under those earlier rules was correct under them. Do not go back '\n            + 'and revise committed work to match rules it was never done under. If you think '\n            + 'something earlier is wrong, say so rather than change it.',",
            "        '',"],

        //A MISSING NUMBER IS DECORATION; the withdrawal is not. Dropping the
        //whole announcement for it restores the original fault silently.
        ['an earlier piece of work with no number is not announced at all',
            "    if (!kept || !kept.taskId || !doing || kept.taskId === doing.id) return null;",
            "    if (!kept || !kept.taskId || !kept.number || !doing || kept.taskId === doing.id) return null;"],

        //---- and the folder name --------------------------------------------

        ['a subject with a slash in it is written straight into a path',
            "    return String(s == null || s === '' ? 'unknown' : s).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);",
            "    return String(s == null || s === '' ? 'unknown' : s).slice(0, 120);"]
    ]
};
