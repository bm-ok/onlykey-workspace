//---------------------------------------------------------------------------
//WHAT WORK HANDS BACK — the doors, on this side.
//
//A PLUGIN OF ITS OWN BECAUSE TWO PLUGINS WOULD BOTH HAVE TO OWN IT. Filing a
//file needs the archive and what the machine is running; recording a verdict
//needs the judge. ../../queue holds the artifacts store and cannot ask what a
//machine is doing — `whatIsOn` is provided by a plugin that consumes the queue,
//so reaching back would close a loop. This consumes all three and provides
//nothing, which is what a set of doors should look like.
//
//SEE ./guestapi.js for the rules. This half only says where the pieces come
//from.
//---------------------------------------------------------------------------

var makeGuestApi = require('./guestapi');

plugin.consumes = ['app', 'log', 'archive', 'guestApi', 'whatIsOn', 'judge'];
plugin.provides = [];
async function plugin(imports, register) {

    //THE SAME DRAWER ../../queue READS. `taskFiles` and `taskFileRead` answer out
    //of `artifacts`, so a file handed back has to land in that one and not in a
    //second store with the same idea — which is how a hand-over succeeds and the
    //pane goes on saying nothing arrived.
    var artifacts = imports.archive.store('artifacts');

    var stopServing = imports.guestApi.api(makeGuestApi({
        whatIsOn: imports.whatIsOn,
        artifacts: artifacts,
        say: imports.log.on,

        //THROUGH THE JUDGE'S OWN STORE, so the rules about what a verdict is and
        //when one may be recorded stay in one place — see ../../judge/store.js,
        //which holds VERDICTS and refuses anything else.
        //
        //`concluded` AND NOT `verdict`. What a judge RECOMMENDS and what a person
        //DECIDED are two fields on purpose: a machine may write the first and
        //only somebody at the window writes the second. A guest that could set
        //`verdict` would be a worker deciding whether its own kind of work is
        //accepted.
        verdictFor: async function (doing, said, note) {
            return await imports.judge.update(doing.uid || doing.id, {
                concluded: said,
                note: note || null
            });
        }
    }));

    await register(null, {
        onDestroy: function () { stopServing(); }
    });
}
module.exports = plugin;
