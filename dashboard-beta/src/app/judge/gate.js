//---------------------------------------------------------------------------
//WHAT MAY BE ASKED OF A JUDGE, AND WHAT MAY NOT.
//
//NO FETCHING IN HERE. Every rule below is a decision about facts somebody else
//went and got — an allowance, what GitHub says, what cuts exist, what the
//library holds — so they all arrive as arguments and every one of them is
//testable without a workspace, a network or a machine.
//
//THAT SPLIT IS NOT TIDINESS HERE, IT IS THE POINT. These are the rules that
//stand between a stranger's code and a machine on this host holding a
//credential. A rule that can only be exercised by arranging a real pull request
//is a rule that gets exercised once, by hand, and then trusted.
//
//---- the four things this refuses, and who each one protects --------------
//
//1. SOMEBODY ELSE'S CODE IS NOT READ UNTIL A PERSON HAS SAID SO, AT THIS
//   COMMIT. Judging an arrived pull request means fetching a stranger's change
//   onto a machine holding a credential, and the judge is a model reading text
//   the author wrote. An allowance is recorded per commit; if the author has
//   pushed since, what was approved is not what would be read.
//
//   AND STALE IS NOT "NO". A person has looked and formed a view — the thing
//   they looked at is simply gone. It needs a different sentence, because the
//   action it asks for is different: look again, not "ask somebody".
//
//2. THE ALLOWANCE IS THIS HOST'S RECORD; GITHUB IS THE FACT. They disagree
//   when an author pushes between the allowance and the request, which is a
//   race of seconds and exactly what the mechanism is for.
//
//3. A MACHINE DOES NOT MARK A PERSON'S HOMEWORK. A supervisor asking for a
//   second reading of a change a person has already read and settled is
//   second-guessing by another route. Refused over the wire ONLY, and only
//   while their reading still describes what is there — if the code moved,
//   judging again is judging something else. A person may always ask for
//   another, including one that disagrees with their own: the record is a
//   sequence of opinions and two that disagree is the most useful thing in it.
//
//4. A JUDGE IS NOT A WORKER. "Did this follow the rules, is it secure, what bug
//   was missed" and "make this change" are different questions written under
//   different rules. A working job run as a judge would read a change under
//   rules written for changing it.
//---------------------------------------------------------------------------

//---- 1 and 2: may this subject be read here at all? ------------------------
//
//    subject   from ./store.js — kind, and what it names
//    facts     what was looked up for it:
//                allowance  { allowed, stale, said, why }  for a pull
//                live       what GitHub says the pull is at now, or null
//                cuts       the PR cuts that exist, for a cut
//                branches   the branch cuts that exist, for a branch
//
//ANSWERS A SENTENCE OR NULL rather than throwing, so a caller can decide what a
//refusal is — and so a test can read the sentence rather than a stack.
function whyNotRead(subject, facts) {
    var f = facts || {};

    if (subject.kind === 'pull') {
        var may = f.allowance || { allowed: false, stale: false };

        if (!may.allowed) {
            if (may.stale && may.said) {
                return subject.on + '#' + subject.number + ' was allowed at ' + String(may.said.sha).slice(0, 7)
                    + ' and is now at ' + String(subject.sha).slice(0, 7) + ' — the author has pushed since, so '
                    + 'what was approved is not what a judge would read. Look at it again and allow it at the '
                    + 'commit it is on now.';
            }
            return 'Nobody has allowed ' + subject.on + '#' + subject.number + ' to be judged. Somebody else\'s '
                + 'code is only read here once a person has looked at it and said so, at the commit it is on '
                + '— Repositories → Overview.';
        }

        //THE ALLOWANCE PASSED; NOW THE FACT.
        //
        //ABSENT IS A REFUSAL, NOT A PASS. "This host could not ask GitHub" and
        //"GitHub agrees" are opposite answers, and treating an unanswered
        //question as agreement is how a stale allowance gets through.
        if (!f.live) {
            return 'This host could not find out what ' + subject.on + '#' + subject.number + ' is at on '
                + 'GitHub, so it cannot tell whether the commit that was allowed is still the one there.';
        }

        var there = String(f.live.headSha || '');
        if (there !== subject.sha) {
            //SHOWN LONG ENOUGH TO DIFFER. Truncating both to seven characters
            //once produced "is at 6ee55a3 and names 6ee55a3" about two commits
            //that are genuinely different — a refusal that reads as a bug in
            //itself. Two commits sharing a short prefix is rare and is exactly
            //when this sentence has to be readable.
            var brief = there.slice(0, 7) !== String(subject.sha).slice(0, 7);
            return subject.on + '#' + subject.number + ' is at ' + (brief ? there.slice(0, 7) : (there || '?'))
                + ' on GitHub and this judgement names '
                + (brief ? String(subject.sha).slice(0, 7) : subject.sha)
                + '. The author pushed while this was being arranged — allow the new commit if it is still '
                + 'worth reading.';
        }

        return null;
    }

    if (subject.kind === 'cut') {
        var found = (f.cuts || []).some(function (c) {
            return c.source === subject.source && c.target === subject.target;
        });
        if (!found) {
            return 'There is no PR cut "' + subject.name + '". Ask for what has been sent out — a judgement is '
                + 'filed against the cut it read, and one filed under a name nothing matches is a verdict '
                + 'nobody will find.';
        }
        return null;
    }

    //A BRANCH CUT, READ FROM GIT ACROSS EVERY REPOSITORY rather than from a list
    //this app keeps. A judgement of a branch that is not here is a machine
    //booted to read nothing.
    var here = (f.branches || []).some(function (b) { return (b.name || b) === subject.branch; });
    if (!here) {
        return 'There is no branch cut "' + subject.branch + '" in this workspace. Ask for what has been cut '
            + '— a judgement reads what is there, and one written against a name nothing matches would send a '
            + 'machine to read nothing.';
    }
    return null;
}

//---- 3: who may commission a second reading --------------------------------
//
//    mine    every judgement already recorded about this subject
//    stale   (judgement) -> true when it no longer describes what is there
//
//OVER THE WIRE ONLY. At the window a person is asking for a reading of work they
//can see; this is about a model commissioning a re-read of a decision a person
//already made.
function whyNotCommission(subject, mine, stale, overTheWire) {
    if (!overTheWire) return null;

    var settled = (mine || []).filter(function (j) {
        return j.state === 'done' && j.by === 'person' && j.verdict
            && j.subject && j.subject.name === subject.name;
    });

    //STILL TRUE OF WHAT IS THERE. If the code has moved since, judging again is
    //not second-guessing — it is judging something else, which is exactly what
    //a judgement going stale means.
    var current = settled.filter(function (j) { return !(stale ? stale(j) : false); });
    var last = current[current.length - 1];
    if (!last) return null;

    return last.ref + ' is a person\'s own reading of ' + subject.name + ', they recorded "' + last.verdict
        + '", and nothing has changed there since. Asking for another judgement of it would be checking their '
        + 'work — which is not yours to commission. If the change moves, judge it then; if you think they are '
        + 'wrong, say so and let them decide.';
}

//---- does a reading still describe what is there? --------------------------
//
//A judgement records `tips` — what each repository was at when it was read.
//That is what lets a verdict say later whether it still describes the code, and
//it is what the rule above means by "nothing has changed there since".
//
//    kept   the judgement's own record of the tips it read
//    now    what those repositories are at now
//
//IDENTICAL OR IT IS STALE, and that includes the SET of repositories and not
//only the shas. A repository appearing means there is code in the change that
//nobody read; one disappearing means part of what was read is gone. Either way
//the reading no longer describes what is there.
//
//NO TIPS RECORDED READS AS NOT STALE, and the direction is deliberate. This
//answer is used to decide whether a model may commission a re-read of a
//decision a person made, so the question is really "may I overrule the reason
//not to". Not being able to tell whether the code moved is not a reason to
//assume it did — an old record from before tips were kept goes on being
//protected, and a person can always ask for another reading themselves.
function staleAgainst(kept, now) {
    var was = (kept && kept.tips) || null;
    if (!was) return false;

    var here = now || {};
    var mine = Object.keys(was).sort();
    var theirs = Object.keys(here).sort();

    if (mine.length !== theirs.length) return true;
    for (var i = 0; i < mine.length; i++) {
        if (mine[i] !== theirs[i]) return true;
        if (String(was[mine[i]]) !== String(here[mine[i]])) return true;
    }
    return false;
}

//---- 4: the chain it will be read under ------------------------------------
//
//APPROVED OR IT DOES NOT RUN. A judging job is a job — same library, same
//approval, same rule that a model may write one and may not ratify its own.
//Nothing new appears here, which is most of the argument for this shape.
//
//    job       the library entry, or null
//    said      what the library reports about it: { runnable, whyNot }
//    prompt    the prompt the job runs, or null
//    contract  the contract that prompt runs under, or null
//
//THROWS RATHER THAN ANSWERING A SENTENCE, because unlike the two above there is
//nothing sensible to carry on and do: every one of these is "this cannot run",
//and the caller's only move is to say so.
function chainFor(job, said, prompt, contract) {
    if (!job) return {};

    //A JUDGE IS NOT A WORKER, and the libraries are kept apart so that is not a
    //matter of somebody picking carefully.
    if (job.kind !== 'judge') {
        throw new Error('"' + job.id + '" is a job for doing work, not for judging it. A judge is written under '
            + 'the Judge tab and kept apart on purpose — a working job run as a judge would read a change under '
            + 'rules written for changing it.');
    }

    if (!said || !said.runnable) {
        throw new Error('The job "' + job.id + '" cannot run: '
            + ((said && said.whyNot) || 'something in its chain is not approved')
            + '. A judgement is held to the same approvals as any other work — more so, since its whole purpose '
            + 'is to say whether rules were followed.');
    }

    //A JUDGE WITH NO PROMPT SAYS NOTHING TO A WORKER, and this is where that has
    //to be refused.
    //
    //IT COST A REAL RUN. Three judging jobs were quietly unbound from their
    //prompts by a save that never mentioned prompts, and nothing said so. The
    //judgement was written, queued and dispatched; a machine rolled back,
    //booted, took a credential and cloned three repositories before the job
    //refused with "no brief, so there is nothing to give the job" — forty
    //seconds of machine for a fault visible the moment it was asked for.
    //
    //EVERY PANEL SAID "CAN JUDGE" THROUGHOUT, because a job with no prompt is
    //not broken — it is a job with no prompt. It is only a JUDGE that is broken,
    //and this is the door where the difference is known.
    if (!job.promptId) {
        throw new Error('The judge "' + job.id + '" has no prompt, so there would be nothing to tell the worker '
            + 'to look for. Give it one under Judge → Judges before asking it to read anything.');
    }

    if (!prompt) {
        throw new Error('The job "' + job.id + '" runs the prompt "' + job.promptId + '", and there is no such '
            + 'prompt. A judgement copies the words it will be read under when it is written, so this is '
            + 'refused now rather than on a machine.');
    }

    if (prompt.contractId && !contract) {
        throw new Error('The prompt "' + prompt.id + '" runs under the contract "' + prompt.contractId + '", and '
            + 'there is no such contract. It will not be copied without the rules it was approved with.');
    }

    //COPIES, NEVER NAMES. The spine's rule, and it matters most here: a
    //judgement read six weeks later has to be able to say what it was holding
    //the work to, and a library entry rewritten since would silently change the
    //answer.
    return {
        job: job.id,
        brief: prompt ? prompt.text : null,
        promptId: prompt ? prompt.id : null,
        promptName: prompt ? prompt.name : null,
        rules: contract ? contract.text : null,
        contractId: contract ? contract.id : null,
        contractName: contract ? contract.name : null
    };
}

//---- the particular thing being asked, on top of the approved words --------
//
//One approved prompt cannot name the issue it is checking — the issue did not
//exist when the prompt was read. "Is this claim true of the code" is the
//approved question; WHICH claim is the parameter.
//
//ADDED, NEVER SUBSTITUTED. The approved text stands exactly as it was approved
//and this is appended under a heading that says what it is, so reading the brief
//six weeks later shows both halves and which is which.
//
//THE SAME LATITUDE A TASK ALREADY HAS — a task's whole brief is written by
//whoever wrote it, under an approved contract — so it grants nothing new. The
//contract still governs, and the contract is the half that says what a judge may
//not do.
var HEADING = '## What you are being asked about, specifically';

function withQuestion(brief, asked) {
    var q = String(asked == null ? '' : asked).trim();
    if (!q) return brief;
    return String(brief) + '\n\n---\n\n' + HEADING + '\n\n' + q;
}

//A QUESTION NEEDS A JUDGE TO ASK IT, and the refusal NAMES the ones that can.
//
//"Give this a job as well" was not enough: a supervisor met that four times in a
//row bootstrapping a survey. Each refusal was correct and each was useless — it
//said what was missing and not what would fix it, so there was nothing to do but
//guess again. A refusal that cannot be acted on is a refusal that gets retried.
//
//THE IDS ARE PASSED IN RATHER THAN DESCRIBED, so this cannot go stale as the
//library changes — and only the ones that can actually RUN are offered, since
//suggesting an unapproved chain moves the refusal one step later.
function askedWithNoJudge(canRun) {
    var ids = (canRun || []).map(function (j) { return j.id; });
    return 'A question needs a judge to ask it: pass "job" as well, and the question is added to what that '
        + 'job\'s prompt says. '
        + (ids.length
            ? 'The judges that can run are: ' + ids.join(', ') + '. For example job: "' + ids[0] + '".'
            : 'No judging chain is approved yet, so nothing can run one — see the Judge tab.');
}

module.exports = {
    whyNotRead: whyNotRead,
    staleAgainst: staleAgainst,
    whyNotCommission: whyNotCommission,
    chainFor: chainFor,
    withQuestion: withQuestion,
    askedWithNoJudge: askedWithNoJudge,
    HEADING: HEADING
};
