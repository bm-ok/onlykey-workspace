//---------------------------------------------------------------------------
//WHO IS FREE, AND WHAT GOES NEXT.
//
//The two questions the queue is made of, and the only two that are pure. There
//is no machine here, no timer, no dispatch and no store: rows in, an answer out.
//That is what makes them testable without a hypervisor, and it is why they are
//the first thing written.
//
//ONE PLACE, BECAUSE TWO WOULD DISAGREE. The Queue tab reports the order and the
//tick dispatches in it. Written twice, the two drift the first time anything
//changes — and the failure is a board saying a judgement is next while a task
//goes out, which nobody would think to check because both halves look right on
//their own.
//
//IN-FLIGHT IS PASSED IN rather than read from a module-level Map, which is the
//one change from the app this came from. What the queue is doing right now has
//to outlive a save — it belongs in main.js — and a policy that reaches for it
//could not be asked a question about a hypothetical, which is exactly what a
//test and a "what would happen if" panel both need.
//---------------------------------------------------------------------------

//---- what a machine is for -------------------------------------------------
//
//A SUPERVISOR IS FIXED AT CREATION. It skips the project's half of provisioning
//and gets the app's own instead, so you cannot retag your way into being one —
//and it wins if both are somehow present, because of the two wrong answers "this
//is the machine that decides" is the one that refuses more.
var SUPERVISOR = 'supervisor';

//A JUDGE AND A WORKER ARE THE SAME MACHINE — same provision, same scripts, same
//disk. What separates them is which SIGN-IN they may be lent and which work the
//queue sends them.
var JUDGE = 'judge';
var WORKER = 'worker';

function tagged(vm, want) {
    return ((vm && vm.tags) || []).some(function (t) { return String(t).toLowerCase() === want; });
}

//WHICH OF THE THREE A MACHINE IS, asked in one place.
//
//SILENCE IS NOT AN ANSWER. This said "worker" for a machine carrying no role
//tag, on the grounds that every machine made before the tag existed was an
//ordinary runner. That was true and it was a GUESS — and the thing it guessed
//about is which credential to hand the machine. An unlabelled box gets none.
function kindsOf(vm) {
    if (tagged(vm, SUPERVISOR)) return ['supervisor'];
    var out = [];
    if (tagged(vm, WORKER)) out.push('worker');
    if (tagged(vm, JUDGE)) out.push('judge');
    return out;
}

//WHETHER THIS MACHINE MAY DO THAT KIND OF WORK — membership rather than
//equality. A machine tagged worker AND judge does both, one at a time, rolled
//back to base in between; asking "is its kind judge" answered no for a machine
//that judges perfectly well.
function canBe(vm, role) { return kindsOf(vm).indexOf(role) >= 0; }

//FOR SAYING, NEVER FOR DECIDING. "worker+judge" is what somebody reads on a
//card; nothing may compare against it.
function kindSaid(vm) { return kindsOf(vm).join('+') || 'no role yet'; }

//---- who is free -----------------------------------------------------------
//
//REPORTED WITH A REASON RATHER THAN FILTERED SILENTLY, because "nothing is
//running and nothing is queued either" and "everything is queued and no machine
//can take it" look identical from outside and want opposite responses.
//
//THE ORDER OF THE CHECKS IS THE ANSWER. A machine can be several kinds of
//unavailable at once and only one of them is worth acting on, so the most
//specific and most temporary wins.
function availability(vms, inFlight) {
    var doing = inFlight || {};

    return (vms || []).map(function (v) {
        //WHAT IT MAY DO, CARRIED ON EVERY ANSWER. Added only to the last two
        //returns at first, so a machine that was busy — or claiming a branch, or
        //mid-install — came back with no roles on it and vanished from the panel
        //that lists the pool. A machine does not stop being a worker because it
        //is busy being one.
        var kinds = kindsOf(v);
        var no = function (why, extra) {
            return Object.assign({ name: v.name, kinds: kinds, free: false, why: why }, extra || {});
        };

        //BORROWED BY A PERSON, which is not the same as kept back. Kept back is
        //a standing decision about a machine; borrowed is somebody using it
        //right now — signing a worker in, or sitting in it with an editor open —
        //and it ends when they say so. Checked first because it is the most
        //specific and the most temporary: a machine somebody is inside is the
        //one the queue must not roll back, whatever else is true of it.
        if (v.borrowed) return no('borrowed — ' + (v.borrowed.why || 'somebody is using it'));

        //A SUPERVISOR IS NOT IN THE POOL AT ALL, and this is not a preference.
        //
        //A supervisor machine runs Claude Code to decide what work to give and
        //asks this dashboard for it. Giving it a task would roll it back to its
        //base snapshot mid-thought and run a worker over the top of the thing
        //that was handing out the work — so it is out, permanently, and by the
        //tag it was built with rather than by a setting somebody can flip.
        //
        //Checked before `forTasks`, which is a decision that CAN be changed:
        //this one cannot, and reporting it as "kept back" would suggest a button
        //exists.
        if (tagged(v, SUPERVISOR)) return no('is a supervisor machine, so it is never given task work');

        //A DECISION, CHECKED BEFORE ANY OF THE FACTS. Somebody has said keep
        //this one back, and that outranks it merely looking idle — which is
        //exactly what a machine somebody is about to use looks like.
        if (v.forTasks === false) return no('is kept back from the queue');
        if (doing[v.name]) return no('doing ' + doing[v.name]);
        if (!v.baseSnapshot) return no('has no base snapshot to come back to, so it cannot be made clean');
        if (v.branch) return no('still claims ' + v.branch);
        if (v.stage === 'installing') return no('is being installed');

        //---- AND WHETHER IT HAS SAID WHAT IT IS FOR ----------------------
        //
        //LAST, SO THE MORE URGENT REASONS WIN. A machine mid-install with no
        //role has two true answers and only one of them is worth acting on
        //today.
        //
        //HERE RATHER THAN IN THE DISPATCH LOOP, because this function is what
        //the Queue tab reads. Filtering it in the loop alone left the window
        //saying "free" about machines the queue would never touch — the same
        //fault as a machine still claiming a branch: not broken, correctly never
        //picked up, and looking exactly like a queue gone quiet.
        //
        //AND THE REASON CARRIES THE FIX, because "not free" about a machine
        //somebody just built is a dead end without the two words that solve it.
        if (!kinds.length) {
            return no('has not been told what it is for — the queue picks which sign-in to hand over from a '
                + 'machine\'s role, so tag it "worker" or "judge" with vmTags', { roleless: true });
        }

        return { name: v.name, free: true, why: null, kinds: kinds };
    });
}

//---- which machines an entry will accept -----------------------------------
//
//THE SAME REASONING AS `order`: the tick applies this rule, so anything that
//TELLS somebody what will happen has to apply the same one. The task pane did
//not, and answered "4 machine(s) can take it" about a task tagged for a kind of
//machine this host does not have.
//
//IT WAITS, RATHER THAN FALLING BACK. A tag that quietly means "prefer" is a tag
//that sends work to the wrong machine on a busy afternoon, which is the one
//thing somebody who bothered to tag a machine was trying to prevent.
function wants(entry) { return String((entry && entry.tag) || '').trim().toLowerCase(); }

function takes(entry, tags) {
    var want = wants(entry);
    if (!want) return true;
    return (tags || []).map(function (t) { return String(t).toLowerCase(); }).indexOf(want) >= 0;
}

//---- and a judgement goes to a judge machine, when there is one -------------
//
//THE TWO DIRECTIONS ARE NOT THE SAME RULE, and the difference is not tidiness.
//
//    a task must never go to a JUDGE machine     — always, no exception
//    a judgement goes to a judge machine         — when this host has one
//
//WHY THEY DIFFER. Excluding judge machines from tasks can never leave a task
//with nowhere to go: a machine is not a judge unless it says so, so the only way
//to run out of workers is for every machine to be a judge, which is a host
//nobody has built. Requiring a judge machine for judgements CAN leave work with
//nowhere to go — on any host that has not made one, which is most of them.
//
//So the strict half is applied strictly, and the half that could break a working
//app switches itself on when the machine to do it with exists. A rule that stops
//an app the moment it is added is a rule that gets reverted rather than adopted.
//
//WHAT BOTH HALVES ARE FOR: a judge machine is lent a JUDGE's sign-in and a
//runner a worker's. Sending a task to a judge machine would have it lent a
//worker's identity, and the account that says whether work holds becomes the
//account that wrote it. That is the one property this arrangement exists to
//keep, and it can be lost from either side.
//
//IT REPORTS WHY IT NARROWED, rather than only what is left. A judgement that
//waits because the one judge machine is busy and a judgement that waits because
//there is no judge machine at all are different situations with the same empty
//list, and the caller is the thing that has to say which.
function ofItsOwnKind(entry, free, all) {
    if (!entry) return { machines: free, why: null, fellBack: false };

    var pool = all || free;
    var canDo = function (m, role) {
        var vm = pool.filter(function (v) { return v.name === m.name; })[0] || m;
        return canBe(vm, role);
    };

    if (entry.kind === 'judgement') {
        var judges = free.filter(function (m) { return canDo(m, 'judge'); });
        if (judges.length) return { machines: judges, why: null, fellBack: false };

        //NONE FREE. If none EXISTS, this host has not set the separation up and
        //judging carries on as it always did — said out loud, because an
        //arrangement somebody believes is in force and is not is worse than one
        //they know they have not made yet.
        var anyExists = pool.some(function (v) { return canBe(v, 'judge'); });
        if (!anyExists) {
            //AND IT IS ONLY A FALLBACK IF THERE IS SOMETHING TO FALL BACK TO.
            //This promised judging would carry on using ordinary runners, which
            //is true on a host that HAS runners and was said on one where every
            //machine had had its role taken off — describing a graceful
            //degradation that was not happening while the work sat still.
            var runners = pool.filter(function (v) { return canBe(v, 'worker'); }).length;
            return {
                machines: free,
                fellBack: true,
                why: runners
                    ? 'no machine is tagged "' + JUDGE + '", so judgements go to ordinary runners and are signed by '
                        + 'a worker\'s identity. Make a judge machine to keep reading and writing on separate accounts.'
                    : 'no machine is tagged "' + JUDGE + '" and none is tagged "' + WORKER + '" either, so judging has '
                        + 'nowhere to go and waits. Tag a machine with vmTags — "' + JUDGE + '" to keep reading and '
                        + 'writing on separate accounts, or "' + WORKER + '" to have judgements read on a runner.'
            };
        }
        //One exists and is busy: wait for it rather than using a runner.
        return { machines: [], why: 'the judge machine is busy', fellBack: false };
    }

    //A TASK, AND THE STRICT HALF.
    //
    //ASKED AS "MAY IT BE A WORKER" rather than "is it not a judge", which are
    //the same question only while a machine is one thing. A machine tagged both
    //may work, and excluding it for carrying a judge tag would take a perfectly
    //good runner out of the pool for a reason that has nothing to do with this
    //task.
    return { machines: free.filter(function (m) { return canDo(m, 'worker'); }), why: null, fellBack: false };
}

//---- what goes next --------------------------------------------------------
//
//JUDGEMENTS BEFORE TASKS. A judgement reads work that is already waiting to
//land, and behind it somebody is holding a change; a task makes MORE work to be
//read. So a queue that runs tasks first grows the thing it is behind on.
//
//This is the only priority there is: within a kind it is strictly oldest-first,
//because a queue anybody has to reason about is one somebody works around.
var FIRST = { judgement: 0, task: 1 };
function rank(entry) {
    return FIRST[entry && entry.kind] !== undefined ? FIRST[entry.kind] : FIRST.task;
}

//SORTS A COPY. The caller's list is usually somebody else's array, and a queue
//that reorders what it was shown is a queue that changes a board by reading it.
function order(entries) {
    return (entries || []).slice().sort(function (a, b) {
        return rank(a) - rank(b) || a.number - b.number;
    });
}

//SAID IN WORDS, because the board draws it and a model reads it. Kept beside the
//rule so it cannot describe an order that is not this one.
var ORDER = 'Judgements first, then tasks; oldest first within each. A judgement reads work that is already '
    + 'waiting to land, so it goes ahead of work that makes more.';

module.exports = {
    SUPERVISOR: SUPERVISOR, JUDGE: JUDGE, WORKER: WORKER,
    kindsOf: kindsOf, canBe: canBe, kindSaid: kindSaid,
    availability: availability,
    takes: takes, ofItsOwnKind: ofItsOwnKind,
    order: order, ORDER: ORDER
};
