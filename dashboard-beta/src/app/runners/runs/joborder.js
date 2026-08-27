//---------------------------------------------------------------------------
//WHAT A JOB RUN IS MADE OF, DECIDED BEFORE ANYTHING IS SENT.
//
//A JOB GOES TO A MACHINE, and that is the whole design rather than a detail. It
//ran in the dashboard's own process once, which was wrong in a way worth keeping
//written down: `require` gives a Node module everything Node has, so the API
//handed to a job was a convenience and never a sandbox. An approved job was
//arbitrary code running as the operator, on the operator's computer. It was
//demonstrated rather than argued — a three-line job reported the host's name and
//the user it was running as.
//
//NOTHING UNAPPROVED IS SENT, and it is checked HERE as well as at the pane,
//because this is the door: the script is bytes on disk that anything could have
//written, and the hash it was approved against is of exactly those bytes.
//
//---- three things are approved, and each says so differently ----------------
//
//    the job       the code that runs
//    the prompt    what a worker is told to do
//    the contract  what it may not do while doing it
//
//A prompt and its contract are only ever read together, so a run that took one
//without the other would be sending half of what somebody approved.
//
//AND "EDITED SINCE" IS NOT "NEVER APPROVED". They have different fixes — read it
//again, versus read it for the first time — so they are different sentences.
//---------------------------------------------------------------------------

function approvalOf(what, kind) {
    if (!what) return null;
    if (what.approved) return null;

    return what.lapsed
        ? 'The ' + kind + ' "' + what.name + '" has been edited since it was approved. Read it and '
            + 'approve it again before it is sent.'
        : 'The ' + kind + ' "' + what.name + '" is not approved. Nothing unapproved runs, whoever '
            + 'is asking.';
}

module.exports = function joborder(deps) {
    var d = deps || {};

    var jobs = d.jobs;            //get(id)
    var codeFor = d.codeFor || null;   //the script itself, read on demand
    var prompts = d.prompts;      //all()
    var contracts = d.contracts;  //all()

    //---- THE JOB ---------------------------------------------------------
    async function jobFor(id) {
        var job = await jobs.get(id);
        if (!job) throw new Error('There is no job called "' + id + '".');

        //A JOB WITH NO SCRIPT IS NOT A JOB WITH AN EMPTY ONE. The entry is in
        //the library and the file it names is gone, which is a different problem
        //from an unapproved one and has a different fix.
        if (!job.there) {
            throw new Error('"' + job.name + '" has no script. Its file is missing from the jobs folder.');
        }

        var why = approvalOf(job, 'job');
        if (why) throw new Error(why);

        //---- WITH ITS SCRIPT, WHICH THE RECORD DOES NOT CARRY ---------------
        //
        //A job entry describes the script; it is not the script. The caller
        //dispatches `job.code`, and without this that is undefined — which
        //../../vms/dispatch reads as "this is not a job", turning every job into
        //a plain task with an empty brief. Fetched here because this is the
        //function whose whole answer is "the job to run".
        //
        //REFUSED IF IT IS NOT THERE, in the same breath as the check above it.
        //`there` says the file existed a moment ago; this is the file.
        var code = codeFor ? await codeFor(job.id) : null;
        if (!String(code == null ? '' : code).trim()) {
            throw new Error('"' + job.name + '" has no script to run. Its file is in the jobs folder and is empty, '
                + 'or could not be read.');
        }

        return Object.assign({}, job, { code: code });
    }

    //---- AND WHAT IT IS TOLD ----------------------------------------------
    //
    //FROM A TASK, WHICH ALREADY CARRIES ITS OWN COPIES.
    //
    //A task written from a prompt copied that prompt's words into its brief and
    //its contract's words into its rules — that is the spine's rule, and the
    //whole reason a finished task stays readable. So a job run for a task uses
    //what the TASK carries rather than going back to the library and reading
    //whatever is there now. Those are different texts the moment anybody edits
    //one, and the task's is the one somebody wrote, queued and will be judged on.
    //
    //NOTHING BELOW HAD TO CHANGE FOR A JUDGEMENT. It carries the same fields for
    //the same reason. What differs is only what it is CALLED, so that is the one
    //thing read off the record instead of built from a number — J1 and #1 are
    //different pieces of work.
    function fromWork(work) {
        var called = work.ref || ('#' + work.number);

        if (!work.brief || !String(work.brief).trim()) {
            throw new Error(called + ' has no brief, so there is nothing to give the job.');
        }

        return {
            prompt: {
                id: work.id,
                name: called + ' ' + (work.title || ''),
                text: String(work.brief)
            },
            //THE TASK'S OWN RULES ARE NOT RE-APPROVED HERE, and that is not an
            //omission. A brief has never been a library object with an approval
            //on it — it is what a person wrote, and the queue has always handed
            //it straight to the worker. Running it through a job instead is the
            //same words to the same worker on the same machine, so it grants
            //nothing new.
            contract: work.rules
                ? {
                    id: work.contractId || "the task's own",
                    name: work.contractName || 'the rules it was written under',
                    text: String(work.rules)
                }
                : null
        };
    }

    //FROM THE LIBRARY, WHERE BOTH HALVES ARE READ BEFORE THEY ARE SENT.
    async function fromLibrary(promptId) {
        var prompt = ((await prompts.all()) || []).filter(function (p) { return p.id === promptId; })[0] || null;
        if (!prompt) throw new Error('There is no prompt called "' + promptId + '".');

        var why = approvalOf(prompt, 'prompt');
        if (why) {
            throw new Error(why + ' What a worker is told is read before it is sent, the same as the '
                + 'script that sends it.');
        }

        if (!prompt.contractId) return { prompt: prompt, contract: null };

        var contract = ((await contracts.all()) || [])
            .filter(function (c) { return c.id === prompt.contractId; })[0] || null;

        //REFUSED RATHER THAN RUN WITHOUT IT, which is the whole reason a
        //contract is a thing here. A missing or unapproved contract silently
        //becoming "no rules" is the failure this replaced: a run with no limits
        //looks exactly like a run with limits from everywhere except the limits.
        if (!contract) {
            throw new Error('The prompt "' + prompt.name + '" runs under the contract "'
                + prompt.contractId + '", and there is no such contract. It will not be sent without '
                + 'the rules it was approved with.');
        }

        var no = approvalOf(contract, 'contract');
        if (no) throw new Error(no + ' What a worker may not do is read before it is sent, the same as '
            + 'what it is told to do.');

        return { prompt: prompt, contract: contract };
    }

    //---- ONE OF THE THREE, NEVER TWO -------------------------------------
    //
    //A task and a judgement are different pieces of work and the run belongs to
    //one of them. A task and a prompt is the same mistake from the other side —
    //a task already carries the words it was written with, so naming a prompt
    //too is asking for two different texts at once.
    async function whatItIsTold(it) {
        var a = it || {};

        if (a.task && a.judgement) {
            throw new Error('Run it for a task or for a judgement, not both — they are different '
                + 'pieces of work and the run belongs to one of them.');
        }
        if (a.work && a.promptId) {
            throw new Error('Give it either a prompt from the library or a task, not both — a task '
                + 'already carries the words it was written with.');
        }

        if (a.work) return fromWork(a.work);
        if (a.promptId) return await fromLibrary(a.promptId);

        //A JOB MAY RUN WITHOUT A PROMPT, and that is the caller's business
        //rather than this one's: a job that tidies branches needs no
        //instruction, and refusing one for lacking an input it never reads
        //would be this deciding what a job is for.
        return { prompt: null, contract: null };
    }

    return { jobFor: jobFor, whatItIsTold: whatItIsTold };
};

module.exports.approvalOf = approvalOf;

//THE RUN ID SAYS WHAT KIND IT IS, so a job is legible in `vmRuns` and in the
//directory it leaves behind rather than looking like a task somebody named
//oddly. `now` is passed in because a run id is a fact about when, and a function
//that reads the clock cannot be tested.
module.exports.runIdFor = function runIdFor(id, now) {
    return 'job-' + id + '-' + new Date(now).toISOString().replace(/[^0-9]/g, '').slice(0, 14);
};
