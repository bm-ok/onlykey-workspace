//---------------------------------------------------------------------------
//WHETHER A SNAPSHOT MAY BE TAKEN, AND WHAT IT WOULD BE CALLED.
//
//NOTHING HERE TOUCHES VirtualBox. Every question below is answerable from what
//is already known — the register, and the snapshot tree already read — which is
//what makes them testable without a machine, and what makes them cheap enough to
//ask in the order that costs least.
//
//---- the four refusals, and none of them is tidiness -----------------------
//
//  no title            a snapshot with no name is one nobody can choose later
//  that title is taken VirtualBox WOULD allow a second, and then restoring by
//                      that name is a coin toss between them
//  it is running       the memory is stored beside the disk
//  it holds a sign-in  the credential is kept for as long as the snapshot is
//
//THE LAST ONE IS THE ONE THAT MATTERS MOST. A snapshot of a machine holding a
//worker credential keeps an unsealed copy of that credential for as long as the
//snapshot exists — and a snapshot is the thing this app keeps deliberately, and
//rolls back to, and copies when it clones. See ../guests: a credential is handed
//to a machine and taken back, and a snapshot taken in between makes that
//taking-back a lie.
//---------------------------------------------------------------------------

//A SNAPSHOT TREE IS A TREE. VirtualBox nests them under the one they were taken
//from, and a name taken three levels down is just as taken as one at the top —
//so the check that walks only the first level is the check that passes on the
//collision it was written for.
function everyName(snapshots) {
    var flat = [];
    (function walk(list) {
        (list || []).forEach(function (s) {
            if (!s) return;
            flat.push(String(s.name == null ? '' : s.name));
            if (s.children) walk(s.children);
        });
    })(snapshots);
    return flat;
}

module.exports = function snapshotting(deps) {
    var d = deps || {};

    var ours = d.ours;              //read
    var snapshotsOf = d.snapshotsOf; //async (name) -> { snapshots: [tree] }
    var isOff = d.isOff;            //async (name) -> boolean

    //---- WHAT IT WOULD BE CALLED ---------------------------------------
    function titleFor(title) {
        var wanted = String(title == null ? '' : title).trim();
        if (!wanted) {
            throw new Error('Give the snapshot a title, so it means something when you come back to it.');
        }
        return wanted;
    }

    async function refuseIfTaken(name, title) {
        var wanted = String(title).trim().toLowerCase();
        var tree = await snapshotsOf(name);
        var taken = everyName((tree || {}).snapshots).some(function (s) {
            return s.trim().toLowerCase() === wanted;
        });

        if (taken) {
            throw new Error('"' + name + '" already has a snapshot called "' + title + '". VirtualBox '
                + 'would allow a second one, and then restoring by that name is a coin toss between '
                + 'them — pick another name, or throw the old one away first with vmSnapshotDelete.');
        }
    }

    //---- AND WHETHER NOW IS A MOMENT TO TAKE ONE -----------------------
    //
    //REFUSED WHILE IT IS RUNNING. VirtualBox stores the machine's memory beside
    //its disk, so the snapshot arrives the size of the machine's RAM — and it is
    //a picture of something caught mid-thought rather than a point worth coming
    //back to. `vmBaseSnapshot` is the one that takes a running machine, because
    //it shuts it down first and starts it again after.
    async function refuseIfRunning(name) {
        if (!(await isOff(name))) {
            throw new Error('Shut the machine down first — a snapshot taken while it is running '
                + 'stores its memory too, which makes it enormous. "Make a clean starting point" '
                + 'does the shutting down for you.');
        }
    }

    //A SNAPSHOT OUTLIVES THE LENDING. The credential was handed to this machine
    //and is meant to be taken back; a snapshot taken while it is there keeps a
    //copy that taking it back does not reach.
    function refuseIfItHoldsASignIn(name) {
        var vm = (ours.read() || []).filter(function (v) { return v && v.name === name; })[0];
        if (vm && vm.holdsCredential) {
            throw new Error('"' + name + '" is holding a worker credential, and a snapshot would keep '
                + 'a copy of it for as long as the snapshot exists. Take it back first: '
                + 'vmCredentialsForget --name ' + name);
        }
    }

    //---- ALL OF IT, IN THE ORDER THAT COSTS LEAST ----------------------
    //
    //THE FREE QUESTIONS FIRST. A title nobody typed is knowable without asking
    //VirtualBox anything; whether the machine is off costs a call. Ordering it
    //the other way answers "shut it down first" to somebody who then shuts it
    //down and is told they forgot a title.
    async function mayTake(name, title) {
        var wanted = titleFor(title);
        refuseIfItHoldsASignIn(name);
        await refuseIfTaken(name, wanted);
        await refuseIfRunning(name);
        return wanted;
    }

    return {
        titleFor: titleFor,
        refuseIfTaken: refuseIfTaken,
        refuseIfRunning: refuseIfRunning,
        refuseIfItHoldsASignIn: refuseIfItHoldsASignIn,
        mayTake: mayTake
    };
};

module.exports.everyName = everyName;

//---- WHAT THE REGISTER LEARNS FROM A SNAPSHOT BEING TAKEN -----------------
//
//`baseSnapshot` IS ONLY SET ONCE. It is where a machine goes back to, and a
//later snapshot is a point along the way rather than a new beginning — moving it
//would make "roll it back" mean somewhere else without anybody saying so.
//
//`cleanSince` IS STAMPED BECAUSE THE DISK NOW MATCHES A SNAPSHOT. Taking one is
//the other way that becomes true — the machine did not move, the snapshot came
//to it — and there is now nothing beyond the newest one. See vmSnapshotRestore,
//which reads it.
module.exports.recordFor = function recordFor(vm, title, when) {
    var was = vm || {};
    var snapshots = Object.assign({}, was.snapshots || {});
    snapshots[title] = was.branch || null;

    return {
        baseSnapshot: was.baseSnapshot || title,
        snapshots: snapshots,
        cleanSince: new Date(when).toISOString(),

        //AND NOTHING IS OUTSTANDING ANY MORE. Whatever had been written onto
        //this disk is now INSIDE a snapshot rather than beyond one, so the mark
        //saying it was written since the last clean point is no longer about
        //anything. See `dirty` in ../../vms/ours/records.js.
        dirtySince: null
    };
};
