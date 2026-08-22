//---------------------------------------------------------------------------
//A MACHINE DIALS IN AND SAYS WHAT IT IS STILL DOING.
//
//THE OTHER HALF OF RE-QUEUEING. Restarting this app puts an unstarted task back
//in the queue, and that is right — a fresh process has no idea what was in
//flight, and the alternative is to guess from a registry written by the process
//that stopped. What it must NOT do is leave a machine standing there, set up on
//a branch, holding work nobody is claiming, while the queue offers the same work
//to a second machine. That happened: a task was handed over, the app restarted,
//and a second machine was booted for a task the first was already sitting on.
//
//So the machine answers for itself. `$HOME/.okc-task` is written when its
//workspace is set up and goes away when it is rolled back — which means the note
//exists exactly as long as the setup it describes does.
//
//---- the note is CHECKED, not believed ------------------------------------
//
//It comes from a guest, so it is treated as a claim. It may only reattach a task
//that is sitting in the queue UNSTARTED, only to a machine that is genuinely set
//up on that task's branch, and only if the branch it names is still the branch
//the task is about.
//
//It cannot take work away from another machine, cannot revive a task somebody
//finished, and cannot invent one. The worst a lying guest achieves is being
//given a task that was going to be given to a machine anyway.
//---------------------------------------------------------------------------

var NEWLINE = String.fromCharCode(10);

//---- what the machine actually said ----------------------------------------
//
//ASKED FOR THE FILE ONLY, AND THE LAST LINE OF IT. A guest shell prints things
//nobody asked for — a profile that greets you, a warning from something in the
//path — and all of it arrives here as output. The note is one line and it is the
//last one; taking that rather than the whole reply is what stops a chatty
//machine reading as a corrupt note.
function noteIn(output) {
    var text = String(output == null ? '' : output).trim().split(NEWLINE).pop().trim();
    if (!text) return { empty: true };
    try {
        var note = JSON.parse(text);
        if (!note || !note.uid) return { empty: true };
        return { note: note };
    } catch (e) {
        //SAID, NOT SWALLOWED. A machine that answers this question with
        //something unreadable is a machine whose note was written by a version
        //of this that no longer agrees with this one, and that is worth knowing.
        return { unreadable: true };
    }
}

module.exports = function redial(deps) {
    var d = deps || {};
    var call = d.call;
    var say = d.say;

    var ask = d.ask;              //(machine, command, opts) -> { output }
    var taskByUid = d.taskByUid;  //(uid) -> task, or throws
    var machineNamed = d.machineNamed;
    var busyWith = d.busyWith || function () { return { machines: [], work: [] }; };

    async function dialledIn(machine) {
        var to = say('queue', machine);

        var r = await ask(machine, 'cat "$HOME/.okc-task" 2>/dev/null || true', {
            what: 'asking what it is working on', timeout: 30000
        });

        var read = noteIn(r && r.output);
        if (read.empty) return null;
        if (read.unreadable) {
            to.warn('it answered with something that is not a task note — left alone');
            return null;
        }
        var note = read.note;

        //NAMED BY UID AND ANSWERED BY UID. A note carries the number too, and
        //only so this can be said out loud — looking one up by NUMBER would
        //follow a number reissued after the task holding it was deleted.
        var task = null;
        try { task = taskByUid(note.uid); } catch (e) { task = null; }
        if (!task) {
            to.info('it says it has #' + note.number + ', and there is no such task here any more — left alone');
            return null;
        }
        if (task.uid !== note.uid) return null;

        //THE BRANCH IT NAMES IS STILL THE BRANCH THE TASK IS ABOUT. A task
        //re-pointed while nothing was watching is not the task this machine was
        //set up for.
        if (task.branch !== note.branch) {
            to.warn('it says it has #' + task.number + ', but that task is about ' + task.branch
                + ' now and its note says ' + note.branch + ' — left alone');
            return null;
        }

        //AND THE MACHINE IS GENUINELY SET UP ON IT. Asked of this host's own
        //registry rather than taken from the note, because that is the half a
        //guest cannot write.
        var vm = machineNamed(machine);
        if (!vm || vm.branch !== task.branch) {
            to.warn('it says it has #' + task.number + ', but it is not set up on ' + task.branch
                + ' — left alone');
            return null;
        }

        if (task.state !== 'queued') {
            //NOT A PROBLEM, AND USUALLY NOT EVEN NEWS: a task that is `given` to
            //this same machine is simply already right, which is what happens
            //when nothing restarted. Said only when the note points somewhere it
            //cannot go.
            if (task.state === 'given' && task.machine && task.machine !== machine) {
                to.warn('it says it has #' + task.number + ', but that has since been given to '
                    + task.machine + ' — left alone');
            }
            return null;
        }

        //WHATEVER THE QUEUE IS MID-DISPATCH ON STAYS THE QUEUE'S. This is a race
        //of seconds — a machine reconnecting while a tick is running — and the
        //tick is the one holding the machine.
        var busy = busyWith();
        if ((busy.machines || []).indexOf(machine) >= 0) return null;
        if ((busy.work || []).indexOf(task.id) >= 0) return null;

        await call('taskUpdate', {
            id: task.id,
            task: {
                state: 'given',
                machine: machine,
                //A MACHINE THAT DIALLED BACK IN is one somebody or something
                //already set up, and what it is NOT is a fresh dispatch. Marking
                //it `person` keeps the queue's own recovery — which re-queues
                //tasks that were being set up and never started — from taking it
                //straight back off the machine that just told us it has it.
                worker: task.job ? task.worker : 'person'
            }
        });

        to.good('it dialled back in still holding #' + task.number + ' on ' + task.branch + ' — put back on it');
        return task;
    }

    return { dialledIn: dialledIn, noteIn: noteIn };
};

module.exports.noteIn = noteIn;
