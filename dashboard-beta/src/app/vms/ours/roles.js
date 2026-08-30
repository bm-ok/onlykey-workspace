//---------------------------------------------------------------------------
//WHAT A MACHINE IS FOR.
//
//THIS LIVES WITH THE RECORDS RATHER THAN WITH THE QUEUE, and that placement is
//the whole point of the file. A machine's role is written on the machine — it
//is a tag on the record this registry keeps. The queue READS it to decide where
//work goes, the pane READS it to draw a chip, a drill READS it to pick a pool.
//Three readers, one fact, and the fact belongs to the thing it is about.
//
//TAGS ARE OTHERWISE FREE TEXT AND DELIBERATELY SO: they are what somebody calls
//a kind of machine, and the tags that exist are the tags on the machines. The
//four below are the ones this app gives a meaning to, which is why they are
//named here rather than typed at each place that checks one.
//---------------------------------------------------------------------------

//A SUPERVISOR IS FIXED AT CREATION. It skips the project's half of provisioning
//and gets the app's own instead — including a second user for the sign-in desk
//— so you cannot retag your way into being one. Applied when it is built and
//refused afterwards, because a guarantee somebody can type away is not one.
var SUPERVISOR = 'supervisor';

//A JUDGE AND A WORKER ARE THE SAME MACHINE. Same provision, same scripts, same
//disk. What separates them is which SIGN-IN they may be lent and which work the
//queue sends them — both decisions this host makes at the time, about a machine
//that is identical either way. So these two are ordinary tags that can be
//moved, and a machine is turned from a worker into a judge by saying so.
//
//(An early version made `judge` immutable by copying the supervisor rule
//without its reason. The reason is PROVISIONING, and it does not apply here.)
//
//WHAT DOES STILL HAVE TO BE TRUE is that neither changes underneath running
//work: a machine that becomes a judge mid-task would be lent the wrong identity
//for what it is already doing. That is a question about whether it is BUSY, not
//about when it was made.
var JUDGE = 'judge';
var WORKER = 'worker';

//AND THE HUMAN'S OWN.
//
//DIY IS A ROLE LIKE THE OTHER THREE, and it is the person's. A DIY machine is
//the same disk as a worker and runs the same job API — what makes it a different
//kind is WHO IS SITTING IN IT: a person, running their own session by hand,
//instead of a model running a brief the queue handed out.
//
//WHICH IS WHY IT IS A ROLE AND NOT A LABEL ON A WORKER. Two things follow from
//the tag and neither is cosmetic: the queue must never pick it up (see
//`takesQueuedWork` below, which stays worker-or-judge), and it is lent its OWN
//sign-in rather than borrowing a worker's. Sharing the worker identity would
//bill a person's afternoon to the pool the queue draws from, and would mean the
//queue's workers and the person could not both be signed in at once.
var DIY = 'diy';

//AND THE POOL EVERY OTHER MACHINE IS IN.
//
//A tag is how work asks for a KIND of machine. Machines with no tag were a kind
//too — the ordinary one — and it had no name, so "which pool is this machine
//in" had two sorts of answer: a tag, or a shrug. Anything checking that work
//went where it was meant to had to special-case the shrug.
var POOL = 'default';

function tagged(vm, want) {
    return ((vm && vm.tags) || []).some(function (t) { return String(t).toLowerCase() === want; });
}

//WHICH OF THE FOUR A MACHINE IS.
//
//SILENCE IS NOT AN ANSWER. This once said "worker" for a machine carrying no
//role tag, on the grounds that every machine made before the tag existed was an
//ordinary runner. That was true and it was a GUESS — and the thing it guessed
//about is WHICH CREDENTIAL TO HAND THE MACHINE. An unlabelled box gets none.
//
//SUPERVISOR WINS IF BOTH ARE SOMEHOW PRESENT, which should be impossible and is
//resolved anyway: of the two wrong answers, "this is the machine that decides"
//is the one that refuses more, and when a record is confused the safe reading
//wins.
function kindsOf(vm) {
    if (tagged(vm, SUPERVISOR)) return ['supervisor'];
    var out = [];
    if (tagged(vm, WORKER)) out.push('worker');
    if (tagged(vm, JUDGE)) out.push('judge');
    if (tagged(vm, DIY)) out.push('diy');
    return out;
}

//WHETHER THIS MACHINE MAY DO THAT KIND OF WORK — membership rather than
//equality. A machine tagged worker AND judge does both, one at a time, rolled
//back to base in between; asking "is its kind judge" answered no for a machine
//that judges perfectly well.
function canBe(vm, role) { return kindsOf(vm).indexOf(role) >= 0; }

//A SINGLE ANSWER WHERE THERE IS ONE, and null where there is not.
//
//NULL FOR A MACHINE THAT IS BOTH, on purpose: there is no single answer, and
//anything comparing against one would be picking a winner silently.
function kindOf(vm) {
    var kinds = kindsOf(vm);
    return kinds.length === 1 ? kinds[0] : null;
}

//WHETHER THE QUEUE MAY PICK THIS ONE UP AT ALL. Asked in one place so the
//queue, the Runners pane and any drill give the same answer — and so that "why
//was this machine never given anything" has somewhere to be answered.
//
//A SUPERVISOR IS NOT IN THE POOL AT ALL, and that is not a preference: it runs
//Claude Code to decide what work to give, and a machine that decides what work
//to give should not also be given some.
//DIY IS DELIBERATELY NOT IN THIS LIST. A DIY machine is a person's seat, and
//the whole point of the role is that nothing hands it work: the tick must not
//pick it up, roll it back to base, and run a task over the top of somebody's
//afternoon. So the queue's question stays worker-or-judge, and adding `diy` here
//would quietly undo the reason the role exists.
function takesQueuedWork(vm) { return canBe(vm, 'worker') || canBe(vm, 'judge'); }

//FOR SAYING, NEVER FOR DECIDING. "worker+judge" is what somebody reads on a
//card; nothing may compare against it.
function kindSaid(vm) { return kindsOf(vm).join('+') || 'no role yet'; }

module.exports = {
    SUPERVISOR: SUPERVISOR, JUDGE: JUDGE, WORKER: WORKER, DIY: DIY, POOL: POOL,
    kindOf: kindOf, kindsOf: kindsOf, canBe: canBe,
    kindSaid: kindSaid, takesQueuedWork: takesQueuedWork
};
