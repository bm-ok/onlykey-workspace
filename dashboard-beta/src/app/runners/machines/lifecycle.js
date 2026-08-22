//---------------------------------------------------------------------------
//STARTING A MACHINE, AND SHUTTING ONE DOWN.
//
//The two acts everything else on this tab is arranged around, and the two that
//cost the host most: a machine coming up pulls on the disk and every core for a
//minute, and one going down may or may not be listening.
//
//---- one supervisor runs at a time, and that is a rule about WHAT THEY ARE --
//
//A supervisor decides what work there is: it reads the board, writes tasks and
//queues them. Two of them running is two things deciding, with NO IDEA OF EACH
//OTHER — the same issue picked up twice, two branches cut for one piece of work,
//two tasks queued against each other. Nothing fails; the board just fills with
//work nobody asked for twice.
//
//Refused at the one door that brings a machine up, rather than left to whoever
//remembers. The refusal NAMES the one already running, because "stop that one
//first" is the only thing to do about it.
//
//A RUNNER IS NOT AFFECTED. Two, four, ten runners at once is the point of the
//queue — they are told what to do and cannot decide anything.
//
//---- and pressing the power button is a REQUEST ---------------------------
//
//`acpipowerbutton` is exactly what the button on a real machine's case does: it
//tells the guest somebody would like it to shut down. A guest that is wedged, or
//still on its boot splash, or has no acpid, IGNORES it — and returning the
//instant the request was sent made a stop that did nothing indistinguishable
//from one that worked. The next thing to look at the machine found it still
//running with no record of why.
//
//Found by a drill: `vmStop` printed nothing, twice, on a machine hung at its
//splash screen, and it took a screenshot to work out that the machine had simply
//ignored the request.
//
//IT DOES NOT PULL THE POWER ON ITS OWN. That is a different act with a different
//cost — an unclean shutdown, mid-write — and choosing it is the operator's,
//which is what `force` is for. What this does instead is say plainly that the
//machine did not answer, and what to do about it.
//---------------------------------------------------------------------------

//GENEROUS FOR A REQUEST, BRIEF FOR A PULL: a guest shutting down tidily takes as
//long as its services take, and a power cut is immediate.
var ASKED = 120;
var PULLED = 30;
var LEAST = 5;
var MOST = 900;

function howLong(seconds, pull) {
    var wanted = Number(seconds) || (pull ? PULLED : ASKED);
    return Math.max(LEAST, Math.min(wanted, MOST)) * 1000;
}

function isPull(force) { return force === true || force === 'true'; }

module.exports = function lifecycle(deps) {
    var d = deps || {};

    var ours = d.ours;            //get, read, SUPERVISOR
    var vbox = d.vbox;            //start, stop, isOff, waitUntilOff
    var busy = d.busy;            //during, comingUp
    var channel = d.channel;      //drop
    var speaking = d.speaking;    //untilItSpeaks
    var say = d.say;
    var now = d.now || function () { return Date.now(); };

    //---- only one supervisor at a time -------------------------------------
    async function nobodyElseIsDeciding(name, mine) {
        var tags = (mine.tags || []).map(function (t) { return String(t).toLowerCase(); });
        if (tags.indexOf(ours.SUPERVISOR) < 0) return;

        var others = (ours.read() || []).filter(function (v) {
            return v.name !== name
                && (v.tags || []).some(function (t) { return String(t).toLowerCase() === ours.SUPERVISOR; });
        });

        for (var i = 0; i < others.length; i++) {
            var off = true;
            try { off = await vbox.isOff(others[i].name); } catch (e) { off = true; }
            if (off) continue;

            throw new Error('"' + others[i].name + '" is already running, and one supervisor runs at a '
                + 'time. Two of them decide what work there is with no idea of each other — the same issue '
                + 'picked up twice, two branches cut for one piece of work. Stop "' + others[i].name
                + '" first.');
        }
    }

    async function start(name, type) {
        var mine = ours.get(name);
        await nobodyElseIsDeciding(name, mine);

        var to = say('vm', name);

        //THE TURN ENDS WHEN THE KERNEL IS UP. See ./speaking — the host must not
        //be handed to the next machine while this one is at its heaviest.
        return await busy.during(name, 'being started', function () {
            return busy.comingUp(name, async function () {
                var started = await vbox.start(name, type === 'headless' ? 'headless' : 'gui');
                try { await speaking.untilItSpeaks(name, to); } catch (e) { /* its silence is not a failure */ }
                return started;
            }, {
                onWait: function (other) {
                    to.info('waiting for "' + other + '" to get its kernel up — one machine starts at a '
                        + 'time on this host');
                }
            });
        });
    }

    async function stop(name, how) {
        var o = how || {};
        ours.get(name);

        var pull = isPull(o.force);
        var wait = howLong(o.seconds, pull);
        var to = say('vm', name);

        return await busy.during(name, 'being shut down', async function () {
            //ALREADY OFF IS THE STATE THAT WAS WANTED, not an error. VirtualBox
            //answers "Machine 'x' is not currently running", which reads as a
            //failure and stops whatever asked — and stopping a machine that is
            //already stopped is the most ordinary thing in the world: a queue
            //tidying up, a drill cleaning up, somebody pressing it twice.
            if (await vbox.isOff(name)) {
                return { name: name, off: true, how: 'already', took: 0, note: '"' + name + '" was already off.' };
            }

            //THE SESSION IS DROPPED HERE, NOT LEFT TO TIME OUT.
            //
            //A machine whose power is pulled sends no FIN, so its socket looks
            //perfectly healthy for the seventy seconds it takes silence to be
            //noticed — and in that window it is listed as connected, commands
            //are dispatched to it, and they hang until the timeout.
            //
            //DROPPED BEFORE THE STOP rather than after, because after is a race
            //with how long VirtualBox takes.
            channel.drop(name, pull ? 'had its power pulled' : 'was asked to shut down');

            var began = now();
            await vbox.stop(name, pull);

            var off = await vbox.waitUntilOff(name, { timeout: wait }).then(
                function () { return true; }, function () { return false; });
            var took = Math.round((now() - began) / 1000);

            if (off) {
                to[pull ? 'warn' : 'good'](pull ? 'power pulled, off after ' + took + 's'
                    : 'shut down after ' + took + 's');
                return {
                    name: name, off: true, how: pull ? 'pulled' : 'asked', took: took,
                    note: '"' + name + '" is off after ' + took + 's.'
                };
            }

            to.warn('did not go off within ' + took + 's of being asked');
            return {
                name: name, off: false, how: pull ? 'pulled' : 'asked', took: took,
                note: pull
                    ? '"' + name + '" was told to power off and VirtualBox still reports it running after '
                        + took + 's. That is VirtualBox itself being stuck rather than the guest — vmInfo '
                        + 'says what it thinks the machine is doing.'
                    : '"' + name + '" did not answer the power button within ' + took + 's. A guest ignores '
                        + 'it while it is wedged, still booting, or has no acpid — vmScreenshot is the only '
                        + 'thing that tells those apart. Pull its power with force=true when you have looked.'
            };
        });
    }

    return { start: start, stop: stop, nobodyElseIsDeciding: nobodyElseIsDeciding };
};

module.exports.howLong = howLong;
module.exports.isPull = isPull;
