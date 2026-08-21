//---------------------------------------------------------------------------
//BRINGING THE LIBRARY ACROSS FROM THE APP BEING PORTED FROM.
//
//A plugin exists for one reason and goes when that reason does. This one exists
//because ../library moved wholesale — it had to, since a read that relays while
//its writes do not is worse than either end — and this app's own library
//therefore started empty while a working one sat in the other app's data
//folder.
//
//DELETABLE IN ONE PIECE, which is the whole argument for it being its own
//plugin rather than a door on ../library. Same shape as ../debug-snapshot:
//delete the folder and the action and the idea go with it, and nothing else has
//a line to take out. When the relay goes, this goes.
//
//IT WOULD BE THE WRONG SHAPE INSIDE ../library. That plugin's entire subject is
//"a person read this and said so"; a door in it that fills it from somewhere
//else is a door beside the gate, and it would outlive the reason it was added.
//
//---- what it does NOT carry, and this is the point ------------------------
//
//NOT THE APPROVALS. Not one, and not under any argument about the text being
//identical.
//
//An approval is a person saying they read THIS, HERE. Copying one between two
//apps makes it a statement about a record rather than about a reading, which is
//exactly the door ../library/entries.js refuses to leave open when something is
//set aside and brought back over the wire. Everything arrives waiting to be
//read, and the Worker and Judge tabs are where somebody reads it.
//
//SO THIS CANNOT PUT ANYTHING INTO PLAY. The most it can do is save somebody
//retyping fifteen hundred characters to arrive at the same text.
//
//---- and it never overwrites -----------------------------------------------
//
//ANYTHING ALREADY HERE IS LEFT EXACTLY AS IT IS, including its approval. A
//second run brings across what is still missing and touches nothing else, so it
//is safe to run twice and safe to run after somebody has started reading.
//
//Without that, running this twice would rewrite an entry somebody had just
//approved — and a rewrite down the pipe takes the approval with it, which is
//this plugin undoing the one thing it must not touch.
//---------------------------------------------------------------------------

//IN THIS ORDER, BECAUSE THE CHAIN POINTS THIS WAY.
//
//    task <- job <- prompt <- contract
//
//A prompt names the contract it runs under and a job names its prompt, so
//carrying them the other way round leaves entries pointing at things that are
//not here yet — which reads as "its contract is gone" until the next one lands.
var ORDER = ['contract', 'prompt', 'job'];

var FROM = {
    contract: { list: 'contracts', of: function (said) { return (said && said.contracts) || []; } },
    prompt: { list: 'prompts', of: function (said) { return (said && said.prompts) || []; } },
    job: { list: 'jobs', of: function (said) { return (said && said.jobs) || []; } }
};

plugin.consumes = ['app', 'log', 'library'];
plugin.provides = [];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log.on('carryover');
    var library = imports.library;

    if (!actions) return register(null, {});

    //ASKED OF THE OTHER APP BY NAME, WHICH NEEDS `elsewhere`.
    //
    //`jobs`, `prompts` and `contracts` are all defined HERE now, and
    //`actions.call` tries this table first — so it would answer with this app's
    //own empty library and report, perfectly confidently, that there was nothing
    //to bring across. The same trap `queueState` fell into, one plugin along.
    async function there(name, args) {
        if (!actions.elsewhere) return null;
        try { return await actions.elsewhere(name, args || {}); }
        catch (e) { return null; }
    }

    var undo = [];

    undo.push(actions.define('carryOver', {
        about: 'Bring the jobs, prompts and contracts across from the dashboard being ported from. '
            + 'Nothing arrives approved, and nothing already here is touched',
        takes: ['what', 'dry'],
        run: async function (args) {
            var a = args || {};
            var only = a.what ? String(a.what).replace(/s$/, '') : null;
            var dry = a.dry === true || a.dry === 'true';

            var kinds = only ? ORDER.filter(function (k) { return k === only; }) : ORDER;
            if (only && !kinds.length) {
                throw new Error('"' + a.what + '" is not one of these. There is: ' + ORDER.join(', ') + '.');
            }

            var out = { brought: [], already: [], couldNot: [], dry: dry };
            var unreachable = [];

            for (var i = 0; i < kinds.length; i++) {
                var kind = kinds[i];
                var said = await there(FROM[kind].list, {});
                if (!said) { unreachable.push(FROM[kind].list); continue; }

                var rows = FROM[kind].of(said);
                var store = library[kind + 's'];

                for (var j = 0; j < rows.length; j++) {
                    var row = rows[j];
                    var mine = await store.get(row.id);

                    if (mine) {
                        //LEFT EXACTLY AS IT IS, approval and all.
                        out.already.push({ kind: kind, id: row.id, name: row.name });
                        continue;
                    }

                    //A JOB'S BODY IS ITS CODE, and the listing deliberately does
                    //not carry it — see ../library/chain.js. So it is fetched
                    //one at a time, from over there.
                    var code;
                    if (kind === 'job') {
                        var whole = await there('job', { id: row.id });
                        if (!whole || typeof whole.code !== 'string') {
                            out.couldNot.push({
                                kind: kind, id: row.id, name: row.name,
                                why: 'its script could not be read from the other app'
                            });
                            continue;
                        }
                        code = whole.code;
                    }

                    if (dry) {
                        out.brought.push({ kind: kind, id: row.id, name: row.name, would: true });
                        continue;
                    }

                    try {
                        //SAVED AS THOUGH DOWN THE PIPE, which is what makes this
                        //safe: ../library/entries.js only stamps an approval
                        //when a person is the one saving, so everything written
                        //here arrives waiting to be read.
                        await store.save({
                            id: row.id,
                            name: row.name,
                            about: row.about || null,
                            kind: row.kind,
                            text: kind === 'job' ? undefined : row.text,
                            code: kind === 'job' ? code : undefined,
                            promptId: kind === 'job' ? (row.promptId || null) : undefined,
                            contractId: kind === 'prompt' ? (row.contractId || null) : undefined,
                            tags: kind === 'job' ? (row.tags || []) : undefined
                        }, 'carried over');

                        out.brought.push({ kind: kind, id: row.id, name: row.name });
                    } catch (e) {
                        out.couldNot.push({ kind: kind, id: row.id, name: row.name, why: e.message });
                    }
                }
            }

            //A LIBRARY THAT COULD NOT BE READ IS NOT AN EMPTY LIBRARY, and the
            //difference has to reach whoever asked — the same rule ../queue's
            //board is built to.
            if (unreachable.length) {
                out.unreachable = unreachable;
                out.note = 'Could not read ' + unreachable.join(', ') + ' from the other dashboard. It may not '
                    + 'be running. Nothing here was changed by that.';
                return out;
            }

            if (!dry && out.brought.length) {
                log.good('carried over ' + out.brought.length + ' — all waiting to be read');
            }

            out.note = (dry ? 'Nothing was written. ' : '')
                + out.brought.length + ' ' + (dry ? 'would come across' : 'came across') + ', '
                + out.already.length + ' already here and untouched'
                + (out.couldNot.length ? ', ' + out.couldNot.length + ' could not' : '')
                + '. NOTHING IS APPROVED: an approval is a person saying they read this, here — so every one '
                + 'of these is waiting to be read on the Worker and Judge tabs.';

            return out;
        }
    }));

    await register(null, {
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
