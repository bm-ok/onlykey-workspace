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

plugin.consumes = ['app', 'log', 'guestApi', 'whatIsOn', 'judge',
    //WHERE WHAT IS HANDED BACK GOES. ../../artifact owns that drawer — see its
    //header — so this door does not open one of its own.
    'artifact',
    //THE RULES THIS DOOR ENFORCES ARE DECLARED THERE, beside the code that
    //refuses by them. See the `permissions.rule` calls below.
    'permissions'];
plugin.provides = [];
async function plugin(imports, register) {

    //THE SAME DRAWER EVERYTHING ELSE READS, AND NOW BY ASKING RATHER THAN BY
    //AGREEING.
    //
    //This opened `archive.store('artifacts')` directly, and so did ../../judge
    //and ../../queue — twice, once of those under the name `findings`. Four
    //openings of one drawer, each correct, none of them the owner. The comment
    //here used to say "the same drawer ../../queue reads … not a second store
    //with the same idea", which is the right worry answered by everyone
    //remembering to spell it the same way.
    //
    //../../artifact OWNS IT NOW and this asks. A hand-over landing somewhere the
    //pane does not read is no longer possible to write.
    var artifacts = imports.artifact.handedBack;

    //---- WHAT A RUN MAY DO AT THIS DOOR ------------------------------------
    //
    //TWO DOORS AND THE SPLIT IS EXACTLY INVERTED FROM THE GIT ONE. A task
    //pushes and hands files back alongside; a judgement may not push at all, so
    //what it hands back is not a footnote, it IS the deliverable.
    var undeclare = [
        imports.permissions.rule({
            kind: 'task', door: 'artifact', may: true,
            at: 'runners/handback/guestapi.js',
            why: 'a task delivers on its branch, and a file handed back is what it wants read alongside '
                + 'the commits — a log, a screenshot, the thing that explains the diff.'
        }),
        imports.permissions.rule({
            kind: 'judgement', door: 'artifact', may: true,
            at: 'runners/handback/guestapi.js',
            why: 'a judgement changes nothing and may not push, so what it hands back is everything it '
                + 'has to say. This is the deliverable rather than a footnote to one.'
        }),
        imports.permissions.rule({
            kind: 'task', door: 'verdict', may: false,
            at: 'runners/handback/guestapi.js',
            why: 'a verdict is recorded against a judgement, and a task is not reading one — there is '
                + 'nothing for it to be a verdict about.'
        }),
        imports.permissions.rule({
            kind: 'judgement', door: 'verdict', may: true,
            at: 'runners/handback/guestapi.js',
            why: 'saying what it concluded is what a judgement is for. It writes `concluded`, which is '
                + 'a recommendation; only somebody at the window writes the decision.'
        })
    ];

    var stopServing = imports.guestApi.api(makeGuestApi({
        whatIsOn: imports.whatIsOn,
        artifacts: artifacts,
        say: imports.log.on,
        //ASKED OF ../../permissions, so the refusal a machine reads and the
        //sentence the Worker and Judge tabs show are one string.
        may: function (kind, door) { return imports.permissions.may(kind, door); },

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
        onDestroy: function () { stopServing(); undeclare.forEach(function (f) { f(); }); }
    });
}
module.exports = plugin;
