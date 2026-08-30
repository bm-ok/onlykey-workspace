//---------------------------------------------------------------------------
//WHICH SIGN-IN A MACHINE IS ABOUT TO BE HANDED.
//
//There was one credential and every machine got it. There is a list now, and
//this picks from it: the one this machine ALREADY has, or one that is free. Two
//machines therefore work as two identities, which is the whole point — the CLI
//refreshes the token as a worker runs, so a shared sign-in is two workers
//rotating one credential underneath each other.
//
//---- the WORK decides the kind, not the box -------------------------------
//
//This asked the MACHINE what it was and handed over the matching identity, which
//is exactly right while a machine is one thing. A machine tagged worker AND
//judge is two, and then "what kind is this machine" has no answer: it resolved
//to whichever tag was checked first, so a dual machine would have been handed a
//judge's credential for a task.
//
//So the caller says. The queue knows whether it is dispatching a task or a
//judgement, which is the thing that actually determines whose identity should go
//out.
//
//AND WHERE NOBODY SAYS, the machine answers if it can do so unambiguously. A
//machine with one role is not made harder to use by a feature for machines with
//two; one with two is refused BY NAME rather than being given a coin-flip.
//
//---- and the choosing has to know the rule the lending enforces -----------
//
//./lending REFUSES a mismatch — a worker's sign-in on a runner tagged judge, and
//the rest — and refusing is worth nothing if the thing that CHOOSES does not
//know the same rule. This picked any free non-supervisor sign-in, so the first
//judgement dispatched to a judge runner was offered a worker's identity and then
//refused it, minutes into a dispatch, for a reason that reads like a bug.
//
//Found by somebody tagging two machines: the moment a judge runner existed,
//judging was broken on a host whose only free sign-ins were workers. The refusal
//was right and the selection had never been taught.
//---------------------------------------------------------------------------

var shape = require('./shape');

var KINDS = ['worker', 'judge', 'supervisor', 'diy'];

//WHAT A MACHINE OF THIS KIND IS CALLED, for a sentence somebody reads. All
//three are RUNNERS — a runner is a virtual machine in the pool, and the tag says
//what it is for. See ./lending, which words it the same way.
var CALLED = {
    worker: 'a runner tagged worker',
    judge: 'a runner tagged judge',
    supervisor: 'a runner tagged supervisor'
};

//---- which kind of sign-in this machine is being given ---------------------
function kindWanted(machine, canBe, role) {
    var asked = KINDS.indexOf(role) >= 0 ? role : null;

    if (asked && canBe.indexOf(asked) < 0) {
        throw new Error(machine + ' cannot hold a ' + asked + '\'s sign-in: it is '
            + (canBe.length ? 'tagged ' + canBe.join(' and ') : 'not tagged for any role')
            + '. Give it the "' + asked + '" tag with vmTags, or send this work to a machine that has it.');
    }

    //REFUSED BY NAME RATHER THAN GIVEN A COIN-FLIP.
    if (!asked && canBe.length > 1) {
        throw new Error(machine + ' is tagged ' + canBe.join(' and ') + ', so which sign-in it should be '
            + 'handed depends on the work rather than on the machine. Say which with --role worker or '
            + '--role judge.');
    }

    var want = asked || canBe[0] || null;
    if (!want) {
        throw new Error(machine + ' has not been told what it is for, so there is no sign-in to give it. '
            + 'Tag it "worker" or "judge" with vmTags.');
    }

    return want;
}

//---- and which one of that kind --------------------------------------------
module.exports = function choosing(deps) {
    var d = deps || {};
    var all = d.all;              //every sign-in this host holds
    var paused = d.paused || shape.paused;

    function forMachine(machine, vm, role) {
        var canBe = (d.kindsOf || function () { return []; })(vm || {});
        var want = kindWanted(machine, canBe, role);

        var held = (all() || []).filter(function (g) { return g.role === want; });

        //---- ONE A MACHINE HAS ALREADY FAILED WITH IS NOT OFFERED AGAIN ----
        //
        //A credential that could not authenticate does not get better by being
        //tried on another machine. Left in the pool it is picked again, boots a
        //machine, lays out a workspace and fails minutes in — and it is picked
        //FIRST if it happens to be first in the list, so one dead sign-in can
        //starve a host that has a working one.
        //
        //PAUSED RATHER THAN THROWN AWAY, because that is not this app's decision
        //to make: it is somebody's credential and the fix is a person at a login
        //page. The predicate is ./shape's, because the QUEUE asks the same
        //question before it spends a machine and two readings of "has this
        //failed" is exactly how the two halves come to disagree.
        var alive = held.filter(function (g) { return !paused(g); });

        //THE ONE THIS MACHINE ALREADY HAS comes back to it, whatever its state —
        //re-placing a credential a machine is already signed in with is not a
        //new loan, and refusing it would make a retry impossible.
        var wanted = (vm && vm.guest)
            ? held.filter(function (g) { return g.name === vm.guest; })[0]
            : alive.filter(function (g) {
                return g.has && (!g.holder || g.holder === machine);
            })[0];

        if (wanted) return { name: wanted.name, role: want, guest: wanted };

        //AND SAID PLAINLY WHEN EVERY ONE OF THEM IS KNOWN BAD, which is a
        //different sentence from "none is free": nothing is out, they are dead,
        //and waiting will not help.
        if (held.length && held.every(paused)) throw everyOneIsDead(want, held);

        //AND WHEN THERE IS NONE OF THAT KIND AT ALL, because "every one is out"
        //is the wrong sentence for it: nothing is out, there simply is not one,
        //and the thing to do is add one rather than wait.
        if (!held.length) {
            throw new Error('"' + machine + '" is ' + (CALLED[want] || 'a runner') + ' and this host holds no '
                + want + ' sign-in. A ' + want + ' machine is lent a ' + want + '\'s identity and nothing '
                + 'else — that is what keeps '
                + (want === 'judge' ? 'reading a change and writing one on separate accounts' : 'the accounts separate')
                + '. Add one on the Runners tab, or change what this machine is for with vmTags.');
        }

        //AND OTHERWISE THEY ARE OUT, which is the one that fixes itself.
        var out = held.filter(function (g) { return g.holder; });
        throw new Error(out.length
            ? 'Every ' + want + ' sign-in is out on another machine: '
                + out.map(function (g) { return g.name + ' on ' + g.holder; }).join(', ')
                + '. Take one back, or add another — two machines cannot share one sign-in without '
                + 'rotating the same token underneath each other.'
            : 'This host holds no ' + want + ' sign-in with a token file any more. Add one on the '
                + 'Runners tab.');
    }

    //MARKED SO THE CALLER CAN TELL THIS APART FROM A MACHINE THAT BROKE.
    //
    //../../queue/tick finishes a task whose setup failed, on the grounds that the
    //attempt happened and produced nothing — which is right for a machine that
    //would not boot and WRONG for this: nothing was attempted, and marking it
    //done files "we learnt nothing" as an outcome.
    //
    //READ AS A FLAG rather than by matching the sentence, because a sentence is
    //written for a person and gets rewritten for one.
    function everyOneIsDead(want, held) {
        var which = held.map(function (g) {
            var c = g.lastCheck || {};
            return '"' + g.name + '" (' + (c.on || 'a machine') + ' could not authenticate with it'
                + (c.at ? ', ' + String(c.at).slice(0, 16).replace('T', ' ') : '') + ')';
        }).join('; ');

        var no = new Error('Every ' + want + ' sign-in this host holds has already failed on a machine: '
            + which + '. They are paused rather than thrown away — sign in again on the Runners tab, which '
            + 'replaces the record. Nothing will spend a machine on these until then.');

        no.noIdentity = true;
        return no;
    }

    return { forMachine: forMachine, kindWanted: kindWanted };
};

module.exports.kindWanted = kindWanted;
