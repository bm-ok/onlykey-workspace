//---------------------------------------------------------------------------
//WAITING UNTIL A MACHINE'S KERNEL IS UP.
//
//THE TURN ENDS WHEN THE KERNEL IS UP, not when VBoxManage returns.
//
//Starting a machine is instant to ask for and expensive to do: the reply comes
//back in a moment and the machine then pulls on the disk and every core for the
//next minute. Ending the turn on that reply makes "one machine at a time" hold
//for about a second — and the queue and the installer both listen to the console
//before handing the host on, while the one a PERSON presses did not.
//
//---- and its own silence is not this action's failure ----------------------
//
//A machine with no console capture cannot say anything, and a machine with no
//serial PORT cannot either. Both are reported and neither is treated as an
//error: what matters is that the host is not handed to the next machine while
//this one is at its heaviest.
//
//THE PORT HAS TO EXIST, NOT JUST THE FILE. The register saying "this machine's
//console is captured" is a statement about a file on THIS host; whether anything
//is WRITING to it is a fact about the VirtualBox machine — and a rebuild makes a
//new machine with no serial port, leaving a file that will never grow again.
//
//Without that check, silence from a machine with no port reads as "the kernel
//never came up", and a perfectly healthy install gets its power pulled three
//times. That happened, mid-install, and it was this app doing it.
//---------------------------------------------------------------------------

var LOOK = 500;

module.exports = function speaking(deps) {
    var d = deps || {};

    var serialFor = d.serialFor;      //where a machine's console is captured
    var sizeOf = d.sizeOf;            //how big that file is, or 0
    var portOf = d.portOf;            //async (name) -> the uart1 setting
    var vbox = d.vbox;                //stop, waitUntilOff, waitUntilUnlocked, start
    var now = d.now || function () { return Date.now(); };
    var sleep = d.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

    async function untilItSpeaks(name, to, how) {
        var o = how || {};
        var capMs = o.capMs == null ? 60000 : o.capMs;
        var tries = Math.max(1, o.tries || 1);

        var file = serialFor(name);
        if (!file) {
            //NO CONSOLE, NO SIGNAL. Said rather than replaced with a guess — a
            //machine whose console is not captured is one nothing can watch, and
            //that is worth knowing at the moment it matters rather than later.
            to.info('its console is not being captured, so nothing can tell when its kernel is up '
                + '— vmSerial turns that on');
            return { spoke: false, why: 'no console' };
        }

        var port = null;
        try { port = await portOf(name); } catch (e) { port = null; }
        if (!port || port === 'off') {
            to.info('this machine has no serial port, so its silence says nothing — not treating that as '
                + 'a failed start');
            return { spoke: false, why: 'no port' };
        }

        for (var attempt = 1; attempt <= tries; attempt++) {
            var took = await listen(file, capMs);
            if (took !== null) {
                to.good('its kernel is up and talking after ' + took + 's'
                    + (attempt > 1 ? ' (start ' + attempt + ')' : '')
                    + ' — the host is free for the next machine');
                return { spoke: true, took: took, attempt: attempt };
            }

            if (attempt >= tries) break;

            //THE POWER IS PULLED RATHER THAN ASKED. A machine that has not
            //reached a kernel has nothing to answer an ACPI button with — asking
            //it politely is a minute spent proving what its silence already
            //said.
            to.warn('nothing on its console in ' + Math.round(capMs / 1000) + 's — its kernel never came '
                + 'up. Pulling the power and starting it again (start ' + (attempt + 1) + ' of ' + tries + ')');

            try { await vbox.stop(name, true); } catch (e) { /* it may already be off */ }
            try { await vbox.waitUntilOff(name, { timeout: 60000 }); } catch (e) { /* said below */ }
            try { await vbox.waitUntilUnlocked(name); } catch (e) { /* said below */ }
            try { await vbox.start(name, 'gui'); }
            catch (e) { to.bad('could not start it again: ' + e.message); }
        }

        to.bad('"' + name + '" said nothing on its console after ' + tries + ' start(s) — it is not '
            + 'reaching a kernel');
        return { spoke: false, why: 'silent after ' + tries + ' start(s)' };
    }

    //THE FILE GROWING IS THE SIGNAL. Not what it says: a kernel talks in
    //whatever words it likes and in whatever language the machine was built in,
    //and "there are more bytes than there were" is true of all of them.
    async function listen(file, capMs) {
        var began = now();
        var was = sizeOf(file);

        while (now() - began < capMs) {
            if (sizeOf(file) > was) return Math.round((now() - began) / 1000);
            await sleep(LOOK);
        }
        return null;
    }

    return { untilItSpeaks: untilItSpeaks };
};
