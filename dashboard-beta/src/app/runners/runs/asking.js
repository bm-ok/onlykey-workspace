//---------------------------------------------------------------------------
//WHAT MAY BE ASKED OF A RUN, AND WHAT THE MACHINE'S ANSWER MEANT.
//
//../../vms/dispatch BUILDS THE SHELL AND READS IT BACK; this decides whether a
//question may be asked at all, and turns the one word a machine prints into
//something a person can act on. Neither half runs anything, which is why they
//are both testable without a machine.
//
//---- the two gates, in this order -----------------------------------------
//
//`ours.get` FIRST, ALWAYS. It refuses anything not in this app's registry —
//including a machine that exists in VirtualBox and was made by hand. Asking
//"is it dialled in" of a machine this app may not touch would answer a question
//about somebody else's host, and answering it at all is a way to probe what is
//on there. The refusal is deliberately the same for "no such machine" and "not
//ours" for the same reason.
//
//THEN DIALLED IN, because everything here is a question put TO the machine.
//Refused by name rather than attempted: a channel call to a machine that is not
//there times out, and sixty seconds later says something about a socket rather
//than about a machine being off.
//---------------------------------------------------------------------------

module.exports = function asking(deps) {
    var d = deps || {};

    var ours = d.ours;            //get
    var connected = d.connected;  //(name) -> boolean

    //`what` is what the caller was trying to do, and it goes in the refusal:
    //"its runs cannot be read" is a different sentence from "it cannot be given
    //work", and which one somebody sees decides what they do next.
    function reachable(name, what) {
        ours.get(name);
        if (!connected(name)) {
            throw new Error('"' + name + '" is not dialled in, so ' + what + '.');
        }
    }

    //---- and which run --------------------------------------------------
    //
    //ASKED SEPARATELY FROM THE MACHINE, because "you did not say which run" and
    //"that machine is off" are different mistakes with different fixes, and a
    //single combined refusal would name whichever the code checked first.
    function whichRun(run) {
        var id = String(run == null ? '' : run).trim();
        if (!id) throw new Error('Say which run.');
        return id;
    }

    return { reachable: reachable, whichRun: whichRun };
};

//---- WHAT THE MACHINE SAID WHEN ASKED TO STOP -----------------------------
//
//The guest prints one marker and nothing else, so this is the whole of the
//interpretation and it is worth having in one place.
//
//A STOPPED RUN IS NOT A FAILED ONE, and the difference matters when somebody
//reads the board tomorrow: it has no result because it was stopped, not because
//it went wrong. So the outcome is a sentence rather than a boolean.
//
//TWO OF THE FIVE ARE FAULTS AND THE OTHER THREE ARE NOT:
//
//  stopped        it died when asked
//  was already over   there was nothing to stop, which is a fine answer
//  never recorded a pid   nothing could be signalled. Not a refusal — the run
//                 is not running either way — but it says the record is thin,
//                 which is the thing to look at if it happens twice.
//  would not die  something there is ignoring both TERM and KILL
//  did not answer the machine said nothing at all
//
//THE LAST TWO THROW. Everything else in this app treats "stopped" as "the
//machine is free now", and a machine still running work nobody is watching is
//the one state that must not be reported as free.
var MARKERS = [
    ['okc-stop-done', 'stopped', false],
    ['okc-stop-gone', 'was already over', false],
    ['okc-stop-nopid', 'never recorded a pid, so nothing could be signalled', false],
    ['okc-stop-refused', 'would not die', true]
];

function outcomeOf(said) {
    var out = String(said || '');
    for (var i = 0; i < MARKERS.length; i++) {
        if (out.indexOf(MARKERS[i][0]) >= 0) return { how: MARKERS[i][1], bad: MARKERS[i][2] };
    }
    return { how: 'did not answer', bad: true };
}

module.exports.outcomeOf = outcomeOf;
module.exports.MARKERS = MARKERS;
