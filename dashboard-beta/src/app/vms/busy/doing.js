//---------------------------------------------------------------------------
//ONE LONG THING AT A TIME, PER MACHINE.
//
//Snapshotting a machine shuts it down, snapshots it and starts it again.
//Installing wipes its disk and drives an installer for half an hour. Restoring
//throws its disk away. Each of those is several VirtualBox commands with the
//machine in an UNFINISHED STATE in between — and VirtualBox answers a second one
//during that window with a session lock error, which arrives as a wall of COM
//text describing an interface nobody asked about.
//
//SO A SECOND ONE IS REFUSED HERE, where the refusal can say which machine is
//busy and with what. Not queued: waiting would mean a command that appears to
//hang for twenty-five minutes, and the honest answer to "start this machine"
//while it is being installed is no, not later.
//
//READS ARE NEVER BLOCKED. Asking what a machine's state is, or what it has on
//screen, is exactly what somebody does when something is taking a long time, and
//a lock that stops you looking is a lock that gets worked around.
//---------------------------------------------------------------------------

module.exports = function doing() {
    var busy = {};   //machine name -> what it is in the middle of

    function what(name) {
        return Object.prototype.hasOwnProperty.call(busy, name) ? busy[name] : null;
    }

    //REFUSES RATHER THAN WAITS, AND NAMES BOTH THE MACHINE AND THE JOB. "It is
    //busy" is not actionable; "runner1 is being installed" is.
    function claim(name, job) {
        var already = what(name);
        if (already) {
            throw new Error('"' + name + '" is already ' + already + '. Wait for that to finish — '
                + 'one of these at a time, because they leave the machine half-way in between and '
                + 'VirtualBox will refuse the second with an error about a session lock.');
        }
        busy[name] = job;
    }

    function release(name) {
        if (!Object.prototype.hasOwnProperty.call(busy, name)) return false;
        delete busy[name];
        return true;
    }

    //CLAIM, RUN, RELEASE WHATEVER HAPPENS. A job that threw still has to let go,
    //or one failure leaves a machine permanently unusable with nothing running
    //on it — and the refusal it then gives names a job that finished long ago.
    async function during(name, job, fn) {
        claim(name, job);
        try {
            return await fn();
        } finally {
            release(name);
        }
    }

    function all() {
        return Object.keys(busy).map(function (name) {
            return { name: name, job: busy[name] };
        });
    }

    return { what: what, claim: claim, release: release, during: during, all: all };
};
