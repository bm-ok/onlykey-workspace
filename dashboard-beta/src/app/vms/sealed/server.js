var makeDeliver = require('./deliver');
var makePayload = require('./payload');
var sealing = require('./sealing');

//---------------------------------------------------------------------------
//HANDING A VALUE TO A MACHINE SO THAT ONLY THAT MACHINE CAN READ IT.
//
//  ./sealing.js   the crypto, both halves, so a round trip is provable here
//  ./deliver.js   the two round trips, given a runner
//  ./payload.js   the guest's half, which is SENT rather than installed
//
//---- it consumes no channel, and that is deliberate ----------------------
//
//The runner is an ARGUMENT to every call. This plugin therefore knows nothing
//about how a machine is reached — ../channel, ssh, or a test's recorder — and
//`what nothing sent carries the value` can be asked of the real path rather than
//of a reconstruction of it.
//
//It also means nothing here has to be re-thought the day a second way of
//reaching a machine exists.
//
//---- and it is called `sealed`, not `handover` ---------------------------
//
//../../core/handover already provides that name and is a different thing
//entirely: what an app plugin hands its own other half across a reload. The app
//being ported from calls this `core/handover.js` and has no such collision, so a
//reader arriving from there should know to look here. See ./sealing.js.
//---------------------------------------------------------------------------

plugin.consumes = [];
plugin.provides = ['sealed'];
async function plugin(imports, register) {
    //READ AT LOAD, so a missing payload is a startup failure rather than a
    //surprise at the moment a machine is waiting for a credential.
    var payload = makePayload();
    var deliver = makeDeliver({ guestHalf: payload.guestHalf });

    await register(null, {
        sealed: {
            //THE ONE CALL ANYTHING OUTSIDE THIS PLUGIN WANTS.
            toTheMachine: deliver.toTheMachine,

            //WHAT THIS HOST WOULD CALL THE SAME TEXT, so a caller can compare
            //what landed against what it sent without hashing it a second way
            //somewhere else.
            fingerprint: sealing.fingerprint,

            //AND THE TWO HALVES, for a drill that stands in for a guest. Not for
            //ordinary use: sealing something by hand and sending it some other
            //way is how the value ends up back in a command line.
            sealFor: sealing.sealFor,
            openWith: sealing.openWith,
            aPair: sealing.aPair,

            VERSION: sealing.VERSION,
            where: payload.where
        }
    });
}
module.exports = plugin;
