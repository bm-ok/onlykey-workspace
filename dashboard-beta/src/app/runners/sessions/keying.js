//---------------------------------------------------------------------------
//WHAT A PIECE OF WORK FILES ITS MEMORY UNDER, AND WHAT IT IS TOLD ON THE WAY IN.
//
//One place, asked by BOTH ENDS — the handler that gives a machine what it
//remembers and the handler that takes it back. Two places working out a key
//separately is two places to get REMEMBERS wrong in opposite directions, and the
//symptom would be work handed a conversation it then cannot save.
//
//NOTHING HERE TOUCHES A DISK. Deciding where something goes and deciding to
//write it are different jobs, and only one of them can be tested without one.
//./archive.js does the writing.
//
//---- the lane is always part of the key ------------------------------------
//
//WHATEVER `REMEMBERS` SAYS. That is what makes "a judge is never handed a
//worker's session" a property of the KEY rather than something the lookup has to
//remember to check: the two can only collide if they agree on a lane, and a
//judgement is never in the worker lane.
//
//---- and a subject this cannot name falls back to the uid -------------------
//
//ALWAYS CORRECT, and the cost is only that the work starts cold. Guessing a key
//is the other kind of wrong — handing one conversation to work that has nothing
//to do with it — and an unrecognised shape is exactly when a guess is worst.
//---------------------------------------------------------------------------

//WHO KEEPS A CONVERSATION ACROSS THE MACHINES THEY PASS THROUGH.
//
//A worker does: rediscovering the branch every run is the waste this exists to
//stop. A judge does not, by default: a reading should be of the change in front
//of it, and a judge that remembers the last four readings of the same line is a
//judge with an opinion formed before it looked.
var REMEMBERS = { worker: true, judge: false };

//A KEY IS A FOLDER NAME. Anything else a subject might contain is not this
//file's to assume the shape of.
function safe(s) {
    return String(s == null || s === '' ? 'unknown' : s).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
}

//---- THE TWO FACTS, WORKED OUT ONCE ----------------------------------------
//
//`keyFor` turns them into a filename and `aboutWork` hands them back as words,
//and in the app being ported from those are two functions with the same
//branching written out twice. The comment there says "one function works both
//out, which is the only way they stay the same answer" — which is right, and
//was not what the code did. The two forms differ only in punctuation, so a
//change to one and not the other would file a session under a subject the
//sentence beside it does not name, and nothing would say so.
//
//Here it IS one function, and both readers take their answer from it.
//
//A judgement reads a branch here, or a pull request somewhere else. A task works
//on a branch. Those are the only three, and an unrecognised shape gives null
//rather than a guess.
function factsOf(doing) {
    if (!doing) return { lane: null, about: null, key: null };

    var lane = doing.kind === 'judgement' ? 'judge' : 'worker';
    var item = doing.item || {};
    var subject = item.subject || null;

    if (doing.kind !== 'judgement') {
        return item.branch
            ? { lane: lane, about: item.branch, key: 'cut--' + item.branch }
            : { lane: lane, about: null, key: null };
    }

    if (subject && subject.kind === 'pull') {
        return (subject.on && subject.number)
            ? {
                lane: lane,
                about: subject.on + '#' + subject.number,
                key: 'pull--' + subject.on + '--' + subject.number
            }
            : { lane: lane, about: null, key: null };
    }

    var named = subject && (subject.branch || subject.name);
    return named
        ? { lane: lane, about: named, key: 'cut--' + named }
        : { lane: lane, about: null, key: null };
}

//---- WHETHER THIS PIECE OF WORK KEEPS ANYTHING -----------------------------
//
//THE WORK MAY ASK FOR ITSELF, AND THAT OUTRANKS THE CONSTANT. A judgement
//carries `remembers`, set by a person in the dialog that asks for one, where the
//trade is written on the box. REMEMBERS is the default for work that did not
//say, and a per-judgement yes is not overridden by it: somebody who ticked the
//box has read what it costs, which is more than a default can claim.
//
//ONLY UPWARDS. Ticking it turns memory on for that one reading; nothing turns it
//off for work that would otherwise have it, because that would let a silent
//default beat a deliberate arrangement.
function remembers(doing) {
    if (!doing) return false;
    var lane = doing.kind === 'judgement' ? 'judge' : 'worker';
    var asked = doing.item && doing.item.remembers === true;
    return asked || !!REMEMBERS[lane];
}

function keyFor(doing) {
    if (!doing || !doing.uid) return null;
    if (!remembers(doing)) return doing.uid;

    var facts = factsOf(doing);
    return facts.key ? facts.lane + '--' + safe(facts.key) : doing.uid;
}

//THE SAME TWO FACTS, SAID RATHER THAN ENCODED, so what is stored beside a
//session and what its key is built from cannot drift apart.
function aboutWork(doing) {
    var facts = factsOf(doing);
    return { lane: facts.lane, about: facts.about };
}

//---- WHAT A CONTINUATION HAS TO BE TOLD ------------------------------------
//
//MEASURED, NOT SUPPOSED. With sessions filed by subject, a second task on a
//branch resumes the first one's conversation — which is the point, and it
//carries more than facts. A drill gave pass one a standing instruction ("every
//file on this branch begins with this heading"), then gave pass two a different
//brief under a different contract, and pass two wrote:
//
//    CONTRACT-LOADED          <- the new contract's rule
//    # PASS ONE STYLE         <- the OLD task's instruction, still obeyed
//
//    hello
//
//THAT IS NOT A WORKER MISBEHAVING. It obeyed everything it had been told, and
//one of those things was told to a different task. Nothing withdrew it, so
//nothing expired.
//
//WHAT IT COSTS is the property this app rests on: a task carries the TEXT of its
//prompt and contract so that what a worker was held to can be proven six weeks
//later. An instruction still in force and recorded nowhere in this task's record
//makes that record incomplete.
//
//AND IT LEAKS BOTH WAYS. Given a brief that contradicted its contract, the same
//worker flagged that the PREVIOUS task's committed file broke the CURRENT
//contract and considered amending it. New rules reach backwards onto finished
//work as readily as old rules reach forwards, so this says both.
//
//IT DOES NOT WITHHOLD THE MEMORY. That is what the memory is for, and a worker
//rediscovering the branch every run is the thing being fixed. It separates
//KNOWING from BEING BOUND.
//
//HERE, RATHER THAN AT EITHER CALLER, BECAUSE THERE ARE TWO. A plain brief goes
//through vmDispatch and a job goes through jobRun, and the first version of this
//was written into vmDispatch alone — where it NEVER ONCE FIRED, because every
//task in the drill that found the problem uses a job. Two paths to a worker is
//two places to forget, so the words live with the keying that decides whether
//they are needed at all.
function announcement(doing, kept) {
    if (!kept || !kept.taskId || !doing || kept.taskId === doing.id) return null;

    var wasA = doing.kind === 'judgement' ? 'a different reading' : 'a different task';
    var numbered = kept.number ? ' (#' + kept.number + ')' : '';

    return [
        'BEFORE ANYTHING ELSE — THIS IS A NEW PIECE OF WORK.',
        '',
        'You are continuing a conversation that belongs to this branch, not to this piece of '
            + 'work. What you remember was done as ' + wasA + numbered + ', under its own brief '
            + 'and its own rules.',
        '',
        'That memory is yours to use: the codebase, what you tried, what worked, what you decided '
            + 'and why. Use it, and do not spend this run rediscovering it.',
        '',
        'It is NOT a source of instructions. Standing instructions, styles and conventions you '
            + 'were given in that earlier work do not carry into this one — they ended with it. '
            + 'What binds you now is the brief below and the rules attached to this run, and '
            + 'nothing else. If something from before should still apply, it will be in the brief.',
        '',
        'And what was finished under those earlier rules was correct under them. Do not go back '
            + 'and revise committed work to match rules it was never done under. If you think '
            + 'something earlier is wrong, say so rather than change it.',
        ''
    ].join('\n');
}

module.exports = {
    REMEMBERS: REMEMBERS,
    safe: safe,
    factsOf: factsOf,
    remembers: remembers,
    keyFor: keyFor,
    aboutWork: aboutWork,
    announcement: announcement
};
