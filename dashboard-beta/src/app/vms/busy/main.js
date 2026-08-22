var makeDoing = require('./doing');
var makeTurns = require('./turns');

//---------------------------------------------------------------------------
//NOT DOING TWO OF THESE AT ONCE, at two scopes — see ./doing.js and ./turns.js.
//
//---- why this is main.js and not server.js --------------------------------
//
//IT IS ABOUT LIFETIME, AND THE THING IT HOLDS OUTLIVES A SAVE. The node bundle
//is rebuilt every time a file is written; an install is twenty-five minutes.
//
//A lock kept in the server half would be thrown away and made again in the
//middle of one, and the failure is not that a claim is lost — it is that the
//claim is lost while the WORK CONTINUES. The old install goes on running in the
//old closure, the new map is empty, and the next thing to ask is told the
//machine is free. That is precisely the second VBoxManage command this exists
//to refuse, arriving through the one door nobody was watching.
//
//The queue holds its in-flight record here for the same reason, and ../../core/
//build/main.js hands both over on the host.
//
//NOTHING HERE IS PERSISTED, and that is right: a claim describes work that is
//running IN THIS PROCESS. Writing it to disk would mean a restart came back
//believing a machine was mid-install when nothing was installing it, and the
//refusal would have no way to ever end.
//---------------------------------------------------------------------------

//IT PUTS ITSELF INTO ../../core/handover RATHER THAN BEING NAMED BY CORE.
//../../core/build carries the host and knows none of the app services on it —
//see the header there. This plugin is liftable into another project because
//nothing in core says its name.
plugin.consumes = ['handover'];
plugin.provides = ['busy'];
async function plugin(imports, register) {
    var doing = makeDoing();
    var turns = makeTurns();

    var busy = {
        //---- one long thing at a time, per machine ------------------------
        what: doing.what,
        claim: doing.claim,
        release: doing.release,
        during: doing.during,
        all: doing.all,

        //---- and one machine coming up at a time, across the host ---------
        comingUp: turns.comingUp,
        booting: turns.booting,
        queued: turns.queued
    };

    imports.handover.put('busy', busy);
    await register(null, { busy: busy });
}
module.exports = plugin;
