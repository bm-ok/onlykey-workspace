//---------------------------------------------------------------------------
//EVERYTHING WAITING ON A PERSON, AS ONE LIST.
//
//COMPUTED, NEVER STORED. Every item here is derived from something that is
//already true somewhere else — a job nobody has approved, a machine that is off
//while holding a sign-in. A stored inbox is a list that goes on saying a thing
//needs doing after somebody has done it, and the only way to find out is to
//check, which is the work the list was supposed to save.
//
//SO AN ITEM DISAPPEARS BY THE FACT CHANGING. Approve the job and it is gone;
//take the credential back and it is gone. Nothing marks anything read.
//
//---- what belongs in it ---------------------------------------------------
//
//THE TEST IS "WOULD THIS SIT FOR A WEEK IF NOBODY LOOKED, AND WOULD THAT BE A
//PROBLEM". Not everything true is an errand.
//
//The app being ported from records getting this wrong in the direction that
//matters: judgements that finished without a verdict were listed here, and they
//were eight of the first fourteen items. Nothing is blocked by one — the change
//can still be sent, another reading can still be asked for — so the Judge badge
//sat at eight all day while the two things that genuinely needed somebody were a
//smaller number beside it. A count that is never zero is a count nobody reads,
//and that is this list's own failure mode arriving through this list.
//
//---- THE PLUGINS REGISTER; THIS ASKS NOBODY BY NAME -----------------------
//
//This consumed `library`, `ours` and `guests` and reached into each of them. Two
//things were wrong with that and only one of them is tidiness.
//
//IT COULD ONLY EVER GROW. Every plugin with something that can block a person is
//another name on the `consumes` line, and every name is another chance at a
//cycle — which does not fail as "the inbox is missing something", it fails as
//"the app does not start". The git door had to become its own plugin over
//exactly that, one subsystem earlier.
//
//AND IT PUT THE KNOWING IN THE WRONG PLACE. Whether an unapproved contract
//blocks anybody is a question about contracts, and the answer lives with them.
//This file had a paragraph about what `kind` means in the library, written here,
//where nobody maintaining the library would look.
//
//SO IT IS `inbox.source({...})`, which is the shape this app already uses for
//exactly this: `guestApi.api({...})`, `cron.add({...})`, `shell.tab({...})`.
//Hand it a name and a function; get back the way to remove it. This plugin now
//consumes `app` and `log` and nothing else, so no name added anywhere can ever
//close a loop through here.
//
//---- and it says what it is not counting ----------------------------------
//
//This composes from what THIS app can answer, which is not yet everything the
//app being ported from composes from. A partial list in the shape of a complete
//one is worse than a short one here more than anywhere: the whole promise is
//"if this is empty, nothing needs you".
//
//TWO DIFFERENT SILENCES, AND BOTH ARE NAMED. A source that is registered and
//THREW is not the same as a source nobody has written yet, and neither is the
//same as a source that answered "nothing". The first two are in `notCounted`;
//the third is what an empty list means.
//---------------------------------------------------------------------------

//WHAT NOBODY HAS REGISTERED YET, and this list only shrinks. Each line leaves
//here on the day the plugin that owns it registers a source of its own — which
//is the point of the registration: a gap becomes something one plugin is
//answerable for rather than a sentence in a file nobody else reads.
var STILL_TO_COME = [
    'pull requests that arrived and are waiting to be allowed',
    'repositories whose remote points nowhere',
    'changes written and not sent',
    'changes sent and not merged'
];

plugin.consumes = ['app', 'log'];
plugin.provides = ['inbox'];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var say = imports.log.on('app');

    var undo = [];
    var sources = [];

    //---- WHERE TO GO FOR IT ------------------------------------------------
    //
    //An item that cannot say where it is is an item somebody has to go and find,
    //which is most of the work it exists to save.
    //
    //OFFERED HERE RATHER THAN LEFT TO EACH PLUGIN, because the shape of a row is
    //this plugin's business and a source inventing its own is a row the pane
    //cannot draw. It is the same argument as the theme's: the kit is what stops
    //five plugins having five ideas about what a card is.
    function at(view, pane, pick) {
        return { view: view, pane: pane || null, pick: pick || null };
    }

    function item(kind, what, why, where, opts) {
        var o = opts || {};
        return {
            //STABLE, AND DERIVED FROM WHAT IT IS ABOUT. The pane keys rows on
            //it, and a key that changed every draw would restart every animation
            //and lose the selection.
            key: kind + ':' + (o.id || what),
            kind: kind,
            what: what,
            why: why,
            where: where,
            since: o.since || null,
            id: o.id || null
        };
    }

    //---- registering one ---------------------------------------------------
    function source(spec) {
        var it = spec || {};
        var name = String(it.name || '').trim();

        //A NAME IS NOT DECORATION HERE. It is what `notCounted` says when this
        //source cannot answer, and "something could not be read" is not a
        //sentence anybody can act on.
        if (!name) {
            throw new Error('A source of things waiting on a person needs a name, so the list can say '
                + 'which one it could not read.');
        }
        if (sources.some(function (s) { return s.name === name; })) {
            throw new Error('"' + name + '" is already a source. Two plugins answering under one name is '
                + 'two answers to what is waiting, and only one of them would be counted.');
        }
        if (typeof it.waiting !== 'function') {
            throw new Error('"' + name + '" must say what is waiting — pass `waiting()`, returning the '
                + 'items that need a person.');
        }

        var one = {
            name: name,
            waiting: it.waiting,
            //WHAT THIS SOURCE KNOWS IT IS NOT LOOKING AT. Declared beside the
            //thing that would do the looking, so the gap is owned rather than
            //remembered somewhere else.
            notReading: Array.isArray(it.notReading) ? it.notReading.slice() : []
        };
        sources.push(one);

        return function () {
            var at2 = sources.indexOf(one);
            if (at2 >= 0) sources.splice(at2, 1);
        };
    }

    if (actions) {
        undo.push(actions.define('inbox', {
            about: 'Everything waiting on you: what it is, why it needs you, and where to go for it',
            run: async function () {
                var out = [];
                var notCounted = [];

                for (var i = 0; i < sources.length; i++) {
                    var one = sources[i];
                    try {
                        var rows = await one.waiting();
                        (rows || []).forEach(function (r) { if (r) out.push(r); });
                        one.notReading.forEach(function (n) { notCounted.push(n); });
                    } catch (e) {
                        //A SOURCE THAT THREW IS NOT A SOURCE WITH NOTHING TO
                        //SAY, and the difference is the whole promise of this
                        //list. Named, so "nothing is waiting" cannot be the
                        //answer while something could not be asked.
                        say.warn('the inbox could not read "' + one.name + '": ' + e.message);
                        notCounted.push(one.name + ' could not be read — ' + e.message);
                    }
                }

                STILL_TO_COME.forEach(function (n) { notCounted.push(n); });

                return {
                    items: out,
                    count: out.length,

                    //NOTHING IS PUT AWAY, because putting one away is not
                    //ported. Said as a number rather than left off: the pane
                    //draws it when it is not zero, and zero is the true answer.
                    away: 0,

                    notCounted: notCounted,
                    note: out.length
                        ? null
                        : 'Nothing this app can see is waiting on you. It is not yet reading: '
                            + notCounted.join('; ') + '.'
                };
            }
        }));
    }

    await register(null, {
        inbox: {
            source: source,
            item: item,
            at: at,

            //FOR A PLUGIN THAT WANTS TO KNOW WHETHER IT IS BEING ASKED, and for
            //the test that would otherwise have to reach into this closure.
            sources: function () { return sources.map(function (s) { return s.name; }); }
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
