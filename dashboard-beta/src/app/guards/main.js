var fs = require('node:fs');
var path = require('node:path');

//---------------------------------------------------------------------------
//the guards: which presses and which values are a person's, kept where a person
//can change them.
//
//WHY THIS IS NOT JUST WRITTEN IN THE PANES. `protect` in the code says what the
//app thinks should be guarded, which is a good default and somebody else's
//opinion. The person running this has their own view of what they want to be
//asked about — and a guard they cannot move is one they work around instead.
//
//So: the code proposes and this decides. A pane marks a control `protect` and it
//is guarded unless the person turns that guard off; the person may also guard
//anything else on the screen, by the words on it, whether or not the code
//thought of it.
//
//THE ONE RULE THAT MAKES ANY OF IT WORTH HAVING: A GUARD MAY BE READ FROM
//ANYWHERE AND SET FROM NOWHERE BUT THE WINDOW.
//
//A guard that the command line can remove is not a guard. It is a comment, one
//`guardSet --off` away from nothing, and every refusal downstream of it becomes
//a refusal you have to trust a model not to have unlocked first. `_overTheWire`
//is stamped by ipc/main.js on anything that came down the pipe, and that is the
//whole check — reading is open, writing is refused, and the refusal says where
//to go instead.
//
//IT FAILS SHUT. An unreadable or corrupt file means every proposed guard stands
//and none of the person's exceptions do. The wrong answer in that direction
//costs somebody a trip to the window; the wrong answer in the other direction is
//a press nobody agreed to.
//---------------------------------------------------------------------------

plugin.consumes = ['actions', 'app', 'dataDir', 'state'];
plugin.provides = [];
async function plugin(imports, register) {
    var actions = imports.actions;

    //THE DATA DIRECTORY IS DERIVED FROM `name` IN package.json, which is not
    //obvious and is worked out in one place now — see ../datadir, which also
    //says what a rename costs. It used to be rebuilt here and again in ../shot.
    //KEPT THROUGH ../core/state RATHER THAN BY HAND, and the reason is sharper
    //here than anywhere else it was done by hand. That store writes beside and
    //moves into place; a plain write over the real file has a window in which it
    //is half a document — and a half-written guards file does not fail to parse
    //loudly, it falls into the `catch` below and reads as NOTHING IS TURNED OFF.
    //A permissions file that loses power mid-write and comes back as "everything
    //is allowed" is the worst available failure for this particular file.
    var kept = imports.state.app.doc('guards');

    //WHERE IT USED TO BE. This wrote to the root of the data directory and the
    //store keeps documents in `state/`, so moving it without carrying the file
    //over would silently un-guard everything somebody had set — which looks
    //exactly like a fresh install and is not one. Carried once, and only when
    //there is nothing in the new place: a document already there is the live one.
    var before = imports.dataDir.at('guards.json');

    //`off` holds the proposed guards the person has TURNED OFF, and `on` holds
    //the ones they added themselves. Storing exceptions rather than the whole
    //list is what lets the code add a new guarded button later and have it be
    //guarded — a stored full list would silently leave it open.
    var state = { off: [], on: [], seen: [] };

    //BY THE WORDS ON IT, AND NOT BY WHERE IT IS — the same key ../guards/window.js
    //uses. They have to agree or this stores two entries the window reads as one.
    //A person who guards "Merge it" means all of them; `where` is kept because
    //"where did I see this" makes the list readable, not because it narrows the
    //guard.
    //
    //THIS LINE WAS SUPPOSED TO HAVE BEEN CHANGED ALREADY. It read
    //`(g.where || '*') + ' ' + label`, and the edit that was meant to replace it
    //silently did nothing — the space in the file was not a space but a NUL
    //byte, so the text being searched for was never there. The build was fine,
    //the tests were green, and a commit message said the two halves had been
    //brought into line when they had not.
    function key(g) { return String(g.label || '').trim().toLowerCase(); }

    function shaped(raw) {
        return {
            off: raw && Array.isArray(raw.off) ? raw.off : [],
            on: raw && Array.isArray(raw.on) ? raw.on : [],
            seen: raw && Array.isArray(raw.seen) ? raw.seen : []
        };
    }

    function load() {
        var raw = kept.read(null);

        //ONLY WHEN THERE IS NOTHING IN THE NEW PLACE. A document already there is
        //the live one, and taking the older copy because it happens to be in the
        //older place is how a setting goes backwards in time.
        if (raw === null) {
            try {
                raw = JSON.parse(fs.readFileSync(before, 'utf8').replace(/^﻿/, ''));
                state = shaped(raw);
                //WRITTEN FORWARD IMMEDIATELY, so the next run reads one place.
                //The old file is left rather than deleted: if this move is wrong,
                //the evidence should still be there.
                kept.write(state);
                return;
            } catch (e) { raw = null; }
        }

        //never written, or unreadable. Both mean: nothing is turned off.
        state = shaped(raw);
    }

    function save() { kept.write(state); }

    load();

    var read = function () {
        return {
            off: state.off.slice(),
            on: state.on.slice(),
            seen: state.seen.slice(),
            //WHERE IT IS NOW, asked of the document rather than remembered here.
            //This read a `file` variable that the move to ../core/state removed,
            //so every call to `guards` threw "file is not defined" — the whole
            //action, for a field nothing needed to be a local.
            file: kept.path,
            note: 'Guards are read from anywhere and set only at the window. `off` are proposed guards a person turned off; `on` are guards a person added.'
        };
    };

    var undo = [];
    {
        undo.push(actions.define('guards', {
            about: 'Which presses and which values are a person\'s. Readable from anywhere; changed only at the window',
            run: read
        }));

        //WHAT THERE IS TO GUARD, REMEMBERED.
        //
        //The guards pane can only see the pane somebody is standing on — which
        //made it a catalogue of one screen, and the screen it was most often
        //standing on was itself. So every control the driver reports is recorded
        //here the first time it is seen, and the list becomes what this app
        //offers rather than what is in front of you this second.
        //
        //IT ONLY EVER GROWS BY LOOKING. Nothing is invented: a button appears in
        //this list because it was on the screen when something asked. That also
        //means the list is honest about its own gaps — a pane nobody has opened
        //is not in it, and the pane says so rather than implying completeness.
        undo.push(actions.define('guardsSeen', {
            about: 'Record the controls on screen, so what can be guarded is known without standing on every pane',
            takes: ['controls'],
            run: function (args) {
                var list = (args && args.controls) || [];
                var byKey = {};
                state.seen.forEach(function (x) { byKey[key(x)] = x; });
                var added = 0;
                var moved = 0;
                list.forEach(function (c) {
                    if (!c || !c.label) return;
                    var k = key(c);
                    var had = byKey[k];
                    if (!had) {
                        had = { label: c.label, kind: c.kind || 'button', where: c.where || null, proposed: !!c.proposed };
                        byKey[k] = had;
                        state.seen.push(had);
                        added++;
                        return;
                    }
                    //SEEN AGAIN IS NEW INFORMATION, and the first version threw
                    //it away: an entry was written once and never touched, so
                    //`proposed` was whatever was true the very first time
                    //anything looked.
                    //
                    //Which went wrong exactly as you would expect. The Tests
                    //buttons were catalogued while they were still raw
                    //`<button class="btn">`s; they became `<Button protect>`
                    //later, and the Guards pane went on reporting "Run
                    //everything — open" about a button that is guarded, painted
                    //purple, and refused from the command line.
                    //
                    //A catalogue that records the world once is a catalogue of
                    //when it was written.
                    if (!!had.proposed !== !!c.proposed) { had.proposed = !!c.proposed; moved++; }
                    if (c.where && had.where !== c.where) { had.where = c.where; moved++; }
                    if (c.kind && had.kind !== c.kind) { had.kind = c.kind; moved++; }
                });
                if (added || moved) save();
                return { added: added, changed: moved, seen: state.seen.length };
            }
        }));

        undo.push(actions.define('guardSet', {
            about: 'Guard a button or a field, or turn a proposed guard off. Only from the window',
            takes: ['where', 'label', 'on'],
            run: function (args) {
                //THE WHOLE POINT, in four lines. Everything else in this file is
                //bookkeeping.
                if (args && args._overTheWire) {
                    throw new Error(
                        'A guard is set at the window and nowhere else. This came over the pipe, ' +
                        'and a guard the command line can move is not a guard — it is one call away from nothing, ' +
                        'and every refusal behind it becomes a refusal you have to trust was not unlocked first. ' +
                        'Settings → Guards.'
                    );
                }
                var label = String((args && args.label) || '').trim();
                if (!label) throw new Error('Say which, by the words on it.');
                var g = { where: (args && args.where) || '*', label: label };
                var k = key(g);
                var want = !(args.on === false || args.on === 'false');

                //TURNING OFF WHAT YOU TURNED ON IS A REMOVAL, NOT AN EXCEPTION.
                //
                //`off` means "the app proposes this guard and the person
                //overruled it". A guard somebody ADDED has nothing to overrule,
                //so recording it there leaves an exception to a rule that does
                //not exist — harmless, and it accumulates, and the next reader
                //has to work out that half the entries mean nothing.
                //
                //Found by adding a guard and taking it away again: the store
                //came back with `on: []` and `off: [ the thing ]`, which reads
                //as a decision when it is a leftover.
                var wasMine = state.on.some(function (x) { return key(x) === k; });
                state.off = state.off.filter(function (x) { return key(x) !== k; });
                state.on = state.on.filter(function (x) { return key(x) !== k; });
                if (want) state.on.push(g);
                else if (!wasMine) state.off.push(g);
                save();
                return Object.assign({ set: g, guarded: want }, read());
            }
        }));
    }

    await register(null, {
        onDestroy: function () { undo.forEach(function (f) { f(); }); }
    });
}
module.exports = plugin;
