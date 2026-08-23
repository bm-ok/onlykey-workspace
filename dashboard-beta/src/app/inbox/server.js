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
//---- and it says what it is not counting ----------------------------------
//
//This composes from what THIS app can answer, which is not yet everything the
//app being ported from composes from. A partial list in the shape of a complete
//one is worse than a short one here more than anywhere: the whole promise is
//"if this is empty, nothing needs you".
//
//So `notCounted` names every source that is not being read, by name, and the
//note says so when the list is empty.
//---------------------------------------------------------------------------

plugin.consumes = ['app', 'log', 'library', 'ours', 'guests'];
plugin.provides = [];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    if (!actions) return register(null, {});

    var undo = [];

    //WHERE TO GO FOR IT, in this app's own names. An item that cannot say where
    //it is is an item somebody has to go and find, which is most of the work it
    //exists to save.
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

    undo.push(actions.define('inbox', {
        about: 'Everything waiting on you: what it is, why it needs you, and where to go for it',
        run: async function () {
            var out = [];

            //---- THINGS WRITTEN AND NOT APPROVED --------------------------
            //
            //A job, a prompt or a contract that nothing may run until somebody
            //reads it. A model may write one and may not approve its own, so an
            //unread one is work that has silently stopped.
            //
            //TWO MEANINGS OF "kind" MEET HERE and keeping them apart is the
            //whole of this block. What the thing IS — a job, a prompt, a
            //contract — and who it is FOR: "task" ones live under Actions,
            //"judge" ones under Judge. Counted together they once put a badge on
            //a tab the things were not on, and sent a button to a pane where
            //they are not.
            try {
                var lib = imports.library;
                [['job', lib.jobs], ['prompt', lib.prompts], ['contract', lib.contracts]].forEach(function (pair) {
                    var type = pair[0];
                    var shelf = pair[1];
                    if (!shelf || !shelf.all) return;

                    (shelf.all() || []).filter(function (x) { return !x.approved; }).forEach(function (one) {
                        var lane = String(one.kind || 'task') === 'judge' ? 'judge' : 'task';
                        out.push(item(
                            type + ' to approve',
                            one.name || one.id,
                            'Nothing can run it until somebody reads it. ' + (one.lapsed
                                ? 'It was approved and then edited, so what was approved is not what would be sent.'
                                : 'Written and never approved.'),
                            lane === 'judge' ? at('judge', 'judges', one.id) : at('actions', type + 's', one.id),
                            { since: one.edited || one.written || null, id: one.id }
                        ));
                    });
                });
            } catch (e) { /* the library is not answering; `notCounted` says which sources spoke */ }

            //---- A MACHINE THAT IS OFF AND STILL HOLDING A SIGN-IN ---------
            //
            //THE ONE WITH A REPAIR ATTACHED. A machine stopped outside the
            //ordinary sequence — a host that went down, a Windows update — keeps
            //the credential, and the copy on its disk may be NEWER than the one
            //here, because the CLI rotates the token as a worker runs. Left
            //alone this host goes on handing out a token several refreshes
            //behind while believing it holds the current one.
            //
            //IT WOULD SIT FOR A WEEK AND THAT WOULD BE A PROBLEM, which is the
            //test for being on this list at all.
            try {
                var live = {};
                try {
                    var said = await actions.call('vmList', {});
                    ((said && said.vms) || []).forEach(function (v) { live[v.name] = v; });
                } catch (e) { /* the register below still knows who holds what */ }

                (imports.ours.read() || []).forEach(function (vm) {
                    var now = live[vm.name] || vm;
                    if (now.state === 'running') return;
                    if (!vm.holdsCredential && !vm.guest) return;

                    out.push(item(
                        'credential to take back',
                        vm.name,
                        'It is powered off and still holding ' + (vm.guest ? '"' + vm.guest + '"' : 'a sign-in')
                            + '. What is on its disk may be newer than the copy here, so it cannot simply be '
                            + 'forgotten — starting it, reading it back and stopping it again is one press.',
                        at('runners', 'machines', vm.name),
                        { id: vm.name }
                    ));
                });
            } catch (e) { /* no register; nothing can be said about machines */ }

            //WHAT IS NOT BEING READ, BY NAME. The promise of this list is "if it
            //is empty, nothing needs you" — so a source nobody is asking has to
            //be visible rather than absent.
            var notCounted = [
                'pull requests that arrived and are waiting to be allowed',
                'repositories whose remote points nowhere',
                'changes written and not sent',
                'changes sent and not merged'
            ];

            return {
                items: out,
                count: out.length,

                //NOTHING IS PUT AWAY, because putting one away is not ported.
                //Said as a number rather than left off: the pane draws it when
                //it is not zero, and zero is the true answer here.
                away: 0,

                notCounted: notCounted,
                note: out.length
                    ? null
                    : 'Nothing this app can see is waiting on you. It is not yet reading: '
                        + notCounted.join('; ') + '.'
            };
        }
    }));

    await register(null, {
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
