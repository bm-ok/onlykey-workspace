//---------------------------------------------------------------------------
//WAITING FOR A MACHINE TO GET SOMEWHERE.
//
//FOUR WAITS BEHIND ONE NAME, because they are four answers to one question —
//"has it got there yet" — and which one is wanted depends only on what "there"
//means to the caller:
//
//  console / speaking    its kernel is up and running code. THE EARLIEST THING A
//                        MACHINE CAN SAY, and the most useful one for anything
//                        deciding whether the host is free again — `connected`
//                        is minutes later.
//  console + a pattern   the console said something in particular. An unattended
//                        install is twenty-five minutes with no agent, no
//                        network and no channel; the steps are readable one line
//                        at a time, and this is how to wait for one of them.
//  connected / gone      it has dialled in, or stopped being dialled in.
//  anything else         a VirtualBox state — off, running — asked of the one
//                        place allowed to ask.
//
//---- a pattern rather than a list of stages -------------------------------
//
//The stages belong to the installer and the distribution rather than to this
//app. A list here would be a copy of somebody else's boot sequence, out of date
//the moment it is written.
//
//THE FILE IS READ RATHER THAN WATCHED. It is written by the VirtualBox process a
//line at a time and there is no event to subscribe to; a read of a local file
//every second and a half costs nothing next to the thing being waited for.
//---------------------------------------------------------------------------

//THE COLOUR A BOOT IS FULL OF, taken off the line that matched — so whatever is
//waiting can report WHAT it saw rather than that it saw something.
var COLOUR = /\[[0-9;?]*[a-zA-Z]/g;

var LEAST = 5;
var MOST = 3600;
var DEFAULT = 300;

function howLong(seconds) {
    return Math.max(LEAST, Math.min(Number(seconds) || DEFAULT, MOST)) * 1000;
}

module.exports = function awaiting(deps) {
    var d = deps || {};

    var ours = d.ours;              //get
    var vbox = d.vbox;              //waitUntilOff, waitForState
    var channel = d.channel;        //list
    var speaking = d.speaking;      //untilItSpeaks

    //WHERE A CONSOLE IS CAPTURED, worked out rather than read off the register.
    //
    //../vms/provision decides the path and records it, and this composes the
    //same one — which is what the app being ported from does, and the two are
    //not interchangeable: a machine whose register has no `serial` reads as "no
    //console" to ./speaking and as "a file that has not been written yet" here.
    //Waiting for a line is one of the cases where not-yet-written is exactly
    //what is being waited for, so it is left as it is.
    var consoleFor = d.consoleFor;
    var readFile = d.readFile;

    var now = d.now || function () { return Date.now(); };
    var sleep = d.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

    var LOOK_FILE = 1500;
    var LOOK_CHANNEL = 500;

    async function until(name, what) {
        var o = what || {};
        var machine = ours.get(name);
        var wants = String(o.for || 'connected');
        var limit = howLong(o.seconds);
        var began = now();

        var find = String(o.find == null ? '' : o.find).trim();
        var console = wants === 'console' || wants === 'speaking';

        if (console && find) return await untilItSays(machine, find, limit, began);
        if (console) return await untilItSpeaks(machine, o.tries, limit, began);

        //---- and otherwise, either the channel or VirtualBox -----------------
        //
        //`here` ANSWERS null FOR ANYTHING THAT IS NOT ABOUT THE CHANNEL, which
        //is how the two are told apart without a list of state names here.
        var here = function () {
            if (wants === 'connected') return !!dialledIn(machine.name);
            if (wants === 'gone') return !dialledIn(machine.name);
            return null;
        };

        if (here() === null) return await untilVirtualBoxSaysSo(machine, wants, limit, began);

        //THE CHANNEL IS IN THIS PROCESS, so this is a lookup rather than a call
        //out to anything. Asked twice a second, which costs nothing and makes
        //the answer arrive when it happens rather than up to a tick later.
        while (!here() && now() - began < limit) await sleep(LOOK_CHANNEL);

        var took = Math.round((now() - began) / 1000);
        if (!here()) {
            throw new Error('"' + machine.name + '" was not ' + wants + ' after ' + took + 's. A machine '
                + 'that is powered on and not dialled in is either still booting or stuck — vmScreenshot '
                + 'is the only thing that tells those apart.');
        }
        return said(machine.name, wants, took);
    }

    function dialledIn(name) {
        return (channel.list() || []).filter(function (a) { return a.vm === name; })[0] || null;
    }

    function said(name, was, took) {
        return {
            name: name, was: was, took: took,
            note: '"' + name + '" was ' + was + ' after ' + took + 's.'
        };
    }

    //---- waiting for the console to say something in particular --------------
    async function untilItSays(machine, find, limit, began) {
        var pattern = new RegExp(find, 'i');
        var file = consoleFor(machine.name);

        for (;;) {
            var hit = null;
            try {
                var text = readFile(file);
                hit = String(text).split(/\r?\n/).filter(function (l) { return pattern.test(l); })[0] || null;
            } catch (e) {
                //NOT WRITTEN YET, which is one of the things being waited for.
            }

            if (hit) {
                var took = Math.round((now() - began) / 1000);
                return {
                    name: machine.name,
                    was: 'said',
                    took: took,
                    line: hit.replace(COLOUR, '').trim(),
                    note: '"' + machine.name + '" said something matching /' + find + '/ on its console '
                        + 'after ' + took + 's.'
                };
            }

            if (now() - began >= limit) {
                var waited = Math.round((now() - began) / 1000);
                throw new Error('"' + machine.name + '" did not say anything matching /' + find + '/ on '
                    + 'its console within ' + waited + 's. vmLog --name ' + machine.name + ' --which serial '
                    + 'is what it did say.');
            }

            await sleep(LOOK_FILE);
        }
    }

    //---- or for it to say anything at all -------------------------------------
    //
    //`tries` TURNS WAITING INTO SUPERVISING: silence becomes a failed start
    //rather than patience, and the machine is power-cycled and listened to
    //again. Off unless asked for, because most callers only want to know.
    async function untilItSpeaks(machine, tries, limit, began) {
        var to = d.say('vm', machine.name);
        var it = await speaking.untilItSpeaks(machine.name, to, {
            capMs: limit,
            tries: Math.max(1, Number(tries) || 1)
        });

        var took = Math.round((now() - began) / 1000);
        if (!it.spoke) {
            throw new Error('"' + machine.name + '" said nothing on its console within ' + took + 's ('
                + it.why + ').');
        }

        return {
            name: machine.name, was: 'speaking', took: took,
            note: '"' + machine.name + '" started talking after ' + took + 's.'
        };
    }

    //---- or for VirtualBox to say it is somewhere -------------------------------
    async function untilVirtualBoxSaysSo(machine, wants, limit, began) {
        var ok = wants === 'off'
            ? await vbox.waitUntilOff(machine.name, { timeout: limit })
                .then(function () { return true; }, function () { return false; })
            : await vbox.waitForState(machine.name, function (s) { return s === wants; }, { timeout: limit })
                .then(function () { return true; }, function () { return false; });

        var took = Math.round((now() - began) / 1000);
        if (!ok) throw new Error('"' + machine.name + '" was not ' + wants + ' after ' + took + 's.');
        return said(machine.name, wants, took);
    }

    return { until: until };
};

module.exports.howLong = howLong;
module.exports.COLOUR = COLOUR;
