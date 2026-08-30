//---------------------------------------------------------------------------
//WHICH SIGN-IN MAY GO TO WHICH MACHINE.
//
//FOUR ROLES, AND THE DIFFERENCE IS ENTIRELY WHO SPENDS THE IDENTITY:
//
//  worker      lent to a machine that does the work
//  judge       lent to a machine that READS work and never writes it
//  supervisor  never lent to a worker or a judge. It is the sign-in this host
//              decides with — the model that chooses what work to give rather
//              than the one doing it.
//  diy         the person's own. Same disk as a worker and the same job API;
//              what differs is who is sitting in it.
//
//WHY DIY HAS ITS OWN RATHER THAN BORROWING A WORKER'S. Two reasons, and neither
//is bookkeeping. The pool the queue draws from is finite, so a person holding a
//worker sign-in for an afternoon is an afternoon the queue cannot run — the
//person and the workers have to be able to be signed in at once. And work a
//person does by hand should not arrive billed to the identity the queue's
//output is attributed to.
//
//WHY A JUDGE HAS ITS OWN. A judge says whether work holds, and a worker writes
//the work. Sharing one identity between them makes "who said this is good" and
//"who wrote it" the same account, which is the one distinction a judge exists to
//provide. It is also the difference between a review and a signature.
//
//---- separated from the store on purpose ----------------------------------
//
//TAKES ROWS RATHER THAN READING THEM, so the rule can be asked about a list
//somebody wrote down. The alternative for a drill is to add real sign-ins to
//this host to see how they are treated — and a throwaway worker sign-in carrying
//an invented token is one the QUEUE can pick up fifteen seconds later and hand
//to a machine. The decision is separated from the doing for exactly that reason;
//see how ../../queue/policy is arranged.
//
//AND ENFORCED AT THE ONE POINT THAT RECORDS A MACHINE HOLDING SOMETHING, rather
//than at each of the several places that hand one over. A second copy of this
//rule is the copy that turns out to be wrong.
//---------------------------------------------------------------------------

var shape = require('./shape');

var SAYS = {
    worker: 'a worker sign-in',
    judge: 'a judge sign-in',
    supervisor: 'a supervisor sign-in',
    diy: 'a DIY sign-in'
};

//---- and what a machine is called, which is the same word three times ------
//
//A RUNNER IS A VIRTUAL MACHINE IN THE POOL. All three of these are runners; the
//TAG says what one is for, and work asks for a tag rather than for a name.
//
//This said "a runner" for a worker machine and "a judge machine" for a judge,
//which reads as though only one of the three were a runner. The app being ported
//from words it that way — its create dialog offers "an ordinary runner that
//takes tasks" — and the shape underneath is the one written here: one kind of
//machine, three tags.
var MACHINE_SAYS = {
    worker: 'a runner tagged worker',
    judge: 'a runner tagged judge',
    supervisor: 'a runner tagged supervisor',
    diy: 'a runner tagged diy'
};

//---- what the machine may be, as a LIST -------------------------------------
//
//A MACHINE CAN BE MORE THAN ONE THING. Tagged worker AND judge it serves both,
//one at a time, and the question here is not "what kind is it" but "may this
//sign-in go to it" — which is MEMBERSHIP, not equality. Written as equality, a
//dual machine silently resolved to whichever tag the reader checked first, and
//the other tag did nothing.
//
//A STRING IS STILL ACCEPTED, because callers that know a machine has one kind
//are not wrong and should not all be rewritten to pass an array of one.
function kindsFrom(machineKind) {
    if (Array.isArray(machineKind)) return machineKind.filter(Boolean);
    return machineKind ? [machineKind] : [];
}

//---- and why it may not, in words somebody can act on ----------------------
//
//Returns null when it may, and otherwise the sentence saying why. A refusal that
//does not say what would fix it is a refusal somebody argues with.
function whyNotOn(role, machineKind, name, machine) {
    var want = shape.roleFrom(role);
    var can = kindsFrom(machineKind);

    //---- A SUPERVISOR IS REFUSED FOR BEING ONE, BEFORE ANY OF THAT ---------
    //
    //ASKED FIRST BECAUSE IT IS TRUE OF EVERY MACHINE. A supervisor sign-in
    //belongs on a runner tagged supervisor and nowhere else, so the state of the
    //tags cannot change the answer — and letting the untagged branch below answer
    //first produced a refusal that was correct and gave DANGEROUS ADVICE: "give
    //it the worker tag, and then this can go to it". Tagging the machine is
    //exactly what must not fix this. The sentence invited the one action that
    //would put the identity deciding what workers do inside a worker.
    //
    //A drill caught it by asking with a machine that does not exist, which is
    //the shape that isolates WHICH reason a refusal is for — and the same drill
    //had caught the same class of fault once before, when the role was checked
    //after the credential had already been written to the disk.
    if (want === 'supervisor' && can.indexOf('supervisor') < 0) {
        return '"' + name + '" is ' + SAYS.supervisor + ' and ' + machine + ' is '
            + (can.length ? MACHINE_SAYS[can[0]] : 'not tagged supervisor')
            + '. Lending it there would let something other than the supervisor spend the identity '
            + 'that decides what workers do. No tag changes this: a supervisor sign-in goes to the '
            + 'runner tagged supervisor or nowhere.';
    }

    //---- A MACHINE THAT HAS NOT SAID WHAT IT IS GETS NOTHING ---------------
    //
    //The tag is how a machine says which credential it may hold, so no tag is
    //not a default — it is an unanswered question. Refused with the answer in
    //it: "not allowed" about a machine somebody just built is useless next to
    //the two words that fix it.
    if (!can.length) {
        return machine + ' has not been told what it is for, so nothing can be lent to it. A machine '
            + 'holds a worker\'s identity, a judge\'s, or the person\'s own, and the tag is how it says '
            + 'which — give it the "worker", "judge" or "diy" tag with vmTags, and then "' + name
            + '" can go to it.';
    }

    if (can.indexOf(want) >= 0) return null;

    var is = can[0];
    var why = want === 'supervisor'
        ? 'Lending it there would let something other than the supervisor spend the identity that '
            + 'decides what workers do.'
        : want === 'judge'
            ? 'A judge has its own identity so that reading a change and writing one are separate '
                + 'accounts — lending it elsewhere collapses that back into one.'
            //---- AND THE PERSON'S OWN, ON A MACHINE THE QUEUE CAN TAKE -----
            //
            //THIS IS THE FAILURE THE ROLE EXISTS TO STOP, so it names it rather
            //than saying the tags disagree. The tick would roll that machine
            //back to base and run a task on it — under the person's identity,
            //over the top of whatever they had open.
            : want === 'diy'
                ? 'A DIY sign-in is the person\'s own, and ' + machine + ' is one the queue can pick up. '
                    + 'The tick would roll it back and spend that identity on work nobody asked it to do. '
                    + 'Tag a machine "diy" and the queue leaves it alone.'
                : 'A runner tagged ' + (is === 'supervisor' ? 'supervisor' : is) + ' signs in as '
                    + 'itself: this would hold one of the identities the worker runners draw from, and '
                    + 'bill that machine\'s work to a worker.';

    return '"' + name + '" is ' + SAYS[want] + ' and ' + machine + ' is ' + MACHINE_SAYS[is] + '. ' + why;
}

//---- which of a given list could go to a machine of this role right now -----
//
//`machine` NAMES A MACHINE ALREADY HOLDING ONE, which is not a reason to refuse
//it its own: asking "what is free for kit-1" while kit-1 holds a sign-in should
//not report that sign-in as taken by somebody else.
function choosable(rows, role, machine) {
    return (rows || []).filter(function (g) {
        return g.role === role
            && g.has
            && !shape.paused(g)
            && (!g.holder || g.holder === (machine || null));
    });
}

//THE ONES THAT WOULD BE FREE BUT FOR HAVING FAILED. Named so a refusal can say
//WHICH sign-in to replace, rather than that there is none — "no worker sign-in
//is free" and "the two you have are both paused" want different things done.
function pausedFor(rows, role) {
    return (rows || []).filter(function (g) {
        return g.role === role && g.has && shape.paused(g);
    });
}

//---- and what the queue asks, in one answer --------------------------------
//
//THE SHAPE ../../queue/policy.plan TAKES. It asks one question — is there a
//sign-in of this kind to give — and needs the paused ones by name for the
//sentence it writes when there is not.
function forQueue(rows) {
    return ['worker', 'judge'].reduce(function (n, role) {
        n[role] = {
            free: choosable(rows, role, null).length,
            paused: pausedFor(rows, role).map(function (g) { return g.name; })
        };
        return n;
    }, {});
}

module.exports = {
    whyNotOn: whyNotOn,
    choosable: choosable,
    pausedFor: pausedFor,
    forQueue: forQueue,
    kindsFrom: kindsFrom,
    SAYS: SAYS,
    MACHINE_SAYS: MACHINE_SAYS
};
