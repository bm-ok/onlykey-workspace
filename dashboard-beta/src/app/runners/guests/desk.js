//---------------------------------------------------------------------------
//WHICH MACHINE HOLDS THE SIGN-IN DESK.
//
//EVERY CLAUDE SIGN-IN THIS HOST HOLDS COMES OFF ONE MACHINE, at a user that
//exists for nothing else — see ../../vms/provision/scripts/supervisor.sh. That
//is not an arrangement anybody would guess at, so the refusals below explain it
//rather than merely stating a fact.
//
//---- why a runner is refused, at length ------------------------------------
//
//"That is not a supervisor machine" answers WHAT and not WHY, and somebody
//asking a runner for a login URL is asking for the one thing this app
//deliberately moved. Runners used to be borrowed one at a time to be signed in
//and then wiped — a machine brought up, a person waited on, a machine put away,
//per credential.
//
//The app being ported from shortened that sentence once when this became shared
//code, and a drill noticed the explanation had gone. So it is long here on
//purpose.
//
//NOTHING HERE TOUCHES A MACHINE. Deciding which one and starting it are
//different jobs; only the first can be tested without one.
//---------------------------------------------------------------------------

module.exports = function desk(deps) {
    var d = deps || {};

    var ours = d.ours;                  //read, get
    var connected = d.connected;        //(name) -> boolean
    var SUPERVISOR = d.SUPERVISOR || 'supervisor';

    function isSupervisor(vm) {
        return !!(vm && (vm.tags || []).some(function (t) {
            return String(t).toLowerCase() === SUPERVISOR;
        }));
    }

    //---- WHICH ONE, OR A REFUSAL THAT SAYS WHAT TO DO --------------------
    //
    //THE ANSWER IS A NAME, NOT A MACHINE THAT IS READY. Bringing it up is the
    //caller's next step and is deliberately not folded in here: starting a
    //machine is a minute of waiting, and a function that sometimes does it is a
    //function nobody can predict the cost of.
    function which(name) {
        var all = (ours.read() || []).filter(isSupervisor);

        if (!all.length) {
            throw new Error('There is no supervisor machine on this host. Make one with the '
                + '"Supervisor machine" box ticked — every Claude sign-in happens on one, at a user '
                + 'that exists for nothing else.');
        }

        if (name) {
            //ASKED OF THE REGISTER, so a machine this app did not make is
            //refused by the same boundary as everywhere else.
            if (!isSupervisor(ours.get(name))) {
                throw new Error('"' + name + '" is a runner, and only a supervisor machine has a '
                    + 'sign-in desk. Every Claude sign-in happens on one machine, as a user that '
                    + 'exists for nothing else — a runner is handed a credential when it works and '
                    + 'never asks for one.');
            }
            return name;
        }

        if (all.length === 1) return all[0].name;

        //MORE THAN ONE, SO THE ONE THAT IS UP WINS — and if that is not exactly
        //one, it is asked for rather than guessed. A sign-in is a person at a
        //browser; sending them to the wrong machine wastes the one part of this
        //nothing can automate.
        var up = all.filter(function (v) { return connected(v.name); });
        if (up.length !== 1) {
            throw new Error('There is more than one supervisor machine ('
                + all.map(function (v) { return v.name; }).join(', ') + '). Say which one.');
        }
        return up[0].name;
    }

    return { which: which, isSupervisor: isSupervisor };
};
