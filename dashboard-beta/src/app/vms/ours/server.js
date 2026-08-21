var makeOurs = require('./store');
var roles = require('./roles');
var records = require('./records');

//---------------------------------------------------------------------------
//WHICH VIRTUAL MACHINES THIS APP MADE, AND MAY THEREFORE TOUCH.
//
//A SAFETY BOUNDARY, NOT BOOKKEEPING — see ./store.js for the argument. The
//short version: the app can power off, snapshot, restore and DELETE what this
//lists, so membership must come from what this app wrote down and never from
//what VirtualBox happens to know about.
//
//SEPARATE FROM ../vbox ON PURPOSE. That plugin knows HOW to drive VirtualBox;
//this one knows WHICH machines may be driven. Merged, "delete this machine" is
//one forgotten check away from deleting a machine this app never created.
//
//---- what is here ---------------------------------------------------------
//
//./roles.js — what a machine is FOR. A worker, a judge, a supervisor, and the
//rule that silence is not an answer. It lives here rather than in the queue
//because a role is a TAG ON THE RECORD: the queue reads it to decide where work
//goes, the pane reads it to draw a chip, a drill reads it to pick a pool. Three
//readers, one fact, and the fact belongs to the thing it is about.
//
//./records.js — what a record is, and where the machine it describes has got
//to. Both pure, so a stage can be checked without a disk or a hypervisor.
//
//./store.js — the register itself, and the list somebody looks at.
//
//---- and what is deliberately not registered yet --------------------------
//
//NO `vmList`. Defining it here would shadow the one relayed to ../../../dashboard
//— that is the migration path and it is the right one for a WRITE. It is the
//wrong one for this read, because every action that PUTS a machine in a register
//(vmCreate, vmInstall, vmRemove) is still over there. The pane would go from
//showing real machines to showing an empty list that is technically correct, and
//the machines would still be running.
//
//A READ THAT RELAYS WHILE ITS WRITES DO NOT IS WORSE THAN EITHER END. So this
//registers a SERVICE and no actions. ../channel is across, so `connected` is a
//real answer now rather than a placeholder; ../provision and the create path are
//what is left, and `vmList` lands with them, in one step, pointing at a register
//that has something in it.
//---------------------------------------------------------------------------

//CONSUMING ../vbox IS THE RIGHT DIRECTION AND NOT A CYCLE. The register asks the
//vendor what a machine is doing; the vendor never asks who is on the register —
//it consumes app, log and cached, and nothing else. Which is exactly the
//guarantee this plugin exists for: there is no path by which the driver can
//learn about a machine except through the list this one keeps.
plugin.consumes = ['app', 'log', 'state', 'vbox', 'channel'];
plugin.provides = ['ours'];
async function plugin(imports, register) {
    var state = imports.state;

    var ours = makeOurs({
        doc: state.app.doc('machines'),
        say: imports.log.on,

        //ASKED FOR LIVE STATE AND NEVER FOR MEMBERSHIP. A host where VirtualBox
        //is not installed still has a register, and `all()` says so — the
        //machines are listed, `available` is false, and nothing pretends they
        //were lost.
        vbox: imports.vbox,

        //WHETHER ITS AGENT IS TALKING TO US, which is a different question from
        //whether VirtualBox says it is powered on.
        connected: imports.channel.connected,

        //AND THE ROSTER'S OWN ENTRY, which carries the facts a machine reports
        //about itself. `list()` rather than the roster's internal record, on
        //purpose: what comes back here is decorated onto a card, drawn in the
        //window and photographed by `capture`, and the internal one holds the
        //socket.
        agentFor: function (name) {
            return imports.channel.list().filter(function (a) { return a.vm === name; })[0] || null;
        }
    });

    await register(null, {
        ours: {
            read: ours.read,
            get: ours.get,
            has: ours.has,
            add: ours.add,
            update: ours.update,
            forget: ours.forget,
            all: ours.all,

            //THE ROLE RULES, on the service so that a sibling asks this plugin
            //rather than reaching into its folder.
            kindOf: roles.kindOf,
            kindsOf: roles.kindsOf,
            canBe: roles.canBe,
            kindSaid: roles.kindSaid,
            takesQueuedWork: roles.takesQueuedWork,

            SUPERVISOR: roles.SUPERVISOR,
            JUDGE: roles.JUDGE,
            WORKER: roles.WORKER,
            POOL: roles.POOL,
            STAGES: records.STAGES
        }
    });
}
module.exports = plugin;
