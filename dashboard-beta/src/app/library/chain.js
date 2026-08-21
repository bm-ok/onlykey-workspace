//---------------------------------------------------------------------------
//    task <- job <- prompt <- contract
//
//WHETHER A CHAIN COULD RUN RIGHT NOW, as ONE answer rather than four flags a
//reader has to combine.
//
//THREE THINGS ARE APPROVED, NOT TWO, AND THE THIRD ARRIVES THROUGH THE SECOND.
//The script, the prompt it is given, and the rules that prompt runs under. A job
//does not name a contract — a PROMPT does — so a job asks its prompt whether IT
//is usable rather than reaching past it to the contract. That keeps the chain
//pointing one way, and means there is one place that knows how the links join.
//
//NO STORES IN HERE. Three lists arrive and three lists leave, so every rule
//below can be exercised against literals — which matters because these decide
//whether something a person has not read is handed to a machine.
//
//---- why `whyNot` is said in full -----------------------------------------
//
//"Its prompt is not usable" sends somebody to the prompt, where they find it
//approved and fine, and the actual fault — a contract two links down — is not
//mentioned anywhere they were sent. So a job whose prompt is blocked by its
//contract says so, with both names in it.
//---------------------------------------------------------------------------

//WHAT A MACHINE MAY BE OFFERED. A library only grows, and something set aside
//is out of play — but only for anything asking from a machine. A person looking
//at the library sees all of it, because "what is here" and "what may be used"
//are different questions and the second one is the guest's.
function offeredTo(rows, asked) {
    return (asked && asked.fromMachine)
        ? (rows || []).filter(function (r) { return r.setAside !== true; })
        : (rows || []);
}

//BOTH LIBRARIES WHEN NOTHING IS SAID, so a plain listing never hides half of
//what exists. The screens ask for the half they are about, and every row carries
//its own `kind` either way.
function ofKind(rows, kind) {
    if (kind === undefined || kind === null || kind === '') return rows || [];
    var want = String(kind) === 'judge' ? 'judge' : 'task';
    return (rows || []).filter(function (r) { return r.kind === want; });
}

//---- a prompt, and the rules it runs under --------------------------------
//
//A prompt is what a worker is told to do and a contract is what it may not do
//while doing it, and the two are only ever read TOGETHER — so "is this usable"
//is one answer, and `whyNot` names which half is missing.
function promptsWith(prompts, contracts) {
    var rules = contracts || [];

    return (prompts || []).map(function (p) {
        var under = p.contractId
            ? rules.filter(function (c) { return c.id === p.contractId; })[0] || null
            : null;

        return Object.assign({}, p, {
            contract: under ? { id: under.id, name: under.name, approved: under.approved } : null,
            //NAMED RATHER THAN SILENTLY IGNORED. A prompt pointing at a contract
            //that has been forgotten is not a prompt with no contract.
            missingContract: !!(p.contractId && !under),
            usable: !!(p.approved && (!p.contractId || (under && under.approved))),
            whyNot: !p.approved
                //LAPSED AND NEVER-READ ARE DIFFERENT SITUATIONS asking for
                //different actions, so they get different sentences.
                ? (p.lapsed ? 'edited since it was approved' : 'not approved')
                : p.contractId && !under
                    ? 'its contract is gone'
                    : p.contractId && under && !under.approved
                        ? 'its contract "' + under.name + '" is not approved'
                        : null
        });
    });
}

//---- a job, and the prompt it is given ------------------------------------
//
//    prompts   as `promptsWith` above returned them, so a prompt's own contract
//              is already resolved and this does not work it out a second time
//              with a second chance of getting it wrong
//    codeOf    how many lines the script has, or null when there is no script
function jobsWith(jobs, prompts, opts) {
    var library = prompts || [];
    var o = opts || {};

    return (jobs || []).map(function (j) {
        var from = j.promptId
            ? library.filter(function (p) { return p.id === j.promptId; })[0] || null
            : null;

        return Object.assign({}, j, {
            //THE CODE IS LONG AND THIS LIST IS READ AS A LIST. It is served in
            //full by the singular action, which is what the editor asks for.
            code: undefined,
            lines: o.lines ? o.lines(j) : (j.lines || 0),
            prompt: from
                ? { id: from.id, name: from.name, approved: from.approved, usable: from.usable, whyNot: from.whyNot }
                : null,
            missingPrompt: !!(j.promptId && !from),

            runnable: !!(j.there !== false && j.approved && (!j.promptId || (from && from.usable))),

            whyNot: j.there === false
                ? 'its script is missing'
                : j.lapsed
                    ? 'edited since it was approved'
                    : !j.approved
                        ? 'not approved'
                        : j.promptId && !from
                            ? 'its prompt is gone'
                            : j.promptId && from && !from.usable
                                ? (from.approved
                                    //SAID IN FULL, because "its prompt is not
                                    //usable" would send somebody to the prompt
                                    //to find it perfectly fine.
                                    ? 'its prompt "' + from.name + '" runs under a contract that is not ready — '
                                        + from.whyNot
                                    : 'its prompt "' + from.name + '" is not approved')
                                : null
        });
    });
}

module.exports = {
    offeredTo: offeredTo,
    ofKind: ofKind,
    promptsWith: promptsWith,
    jobsWith: jobsWith
};
