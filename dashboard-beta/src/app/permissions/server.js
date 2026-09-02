//---------------------------------------------------------------------------
//WHAT A MACHINE DOING WORK MAY DO, declared by whoever refuses it.
//
//THE SUPERVISOR HAS HAD ONE OF THESE ALL ALONG: ../supervisor/allowed.js names
//every action it may ask for, and Supervisor → What it may do draws that list.
//A worker and a judge have rules too — a judge may not push to the change it
//was asked to read — and they were real, enforced, and invisible: written into
//the doors that refuse them and nowhere anybody could read.
//
//SO EACH PLUGIN SUBMITS ITS OWN, the same shape ../inbox uses for what is
//waiting on a person. The plugin that ENFORCES a rule is the one that declares
//it, because the alternative is a second copy of the rules kept somewhere
//central — and a copy is a thing that can be right on the day it is written and
//quietly wrong three changes later. There is nothing here to keep in step.
//
//AND THE DOOR ASKS THIS RATHER THAN DECIDING TWICE. `may(kind, door)` is what
//refuses; the pane draws the same answer. One rule, one place, both ends.
//
//---- WHY `kind` AND NOT `role` --------------------------------------------
//
//A ROLE IS WHAT A MACHINE IS TAGGED; A KIND IS WHAT IT IS DOING. The same disk
//is a worker on Monday and a judge on Tuesday — ../vms/ours/roles says so, and
//the queue lends it whichever sign-in the work needs. What decides whether a
//push is allowed is not the tag on the record: it is the run it is on right
//now, which is `whatIsOn(machine).kind`.
//
//Getting that backwards would have been a rule that reads correctly and refuses
//the wrong machine, on the day somebody retags one.
//
//IT FAILS SHUT. A door asking about a kind nobody declared gets `false` and a
//sentence saying so, rather than a permissive shrug — the same direction ../
//guards used to fail in, and the only safe one for a question shaped "may it".
//---------------------------------------------------------------------------

plugin.consumes = ['app', 'log'];
plugin.provides = ['permissions'];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var say = imports.log.on('app');

    var undo = [];
    var rules = [];

    //---- declaring one -----------------------------------------------------
    function rule(spec) {
        var it = spec || {};
        var kind = String(it.kind || '').trim();
        var door = String(it.door || '').trim();

        //A DOOR IS NOT DECORATION. It is what the pane lists and what a caller
        //names when it asks, and "something is not allowed" is not a sentence
        //anybody can act on.
        if (!kind) throw new Error('A permission has to say which KIND of run it is about — what the machine is doing, not what it is tagged.');
        if (!door) throw new Error('A permission has to name the door it is about, because that is what the pane lists and what a caller asks for.');
        if (typeof it.why !== 'string' || !it.why.trim()) {
            throw new Error('"' + door + '" for a ' + kind + ' has to say WHY. A list of yes and no is a '
                + 'thing somebody has to go and read the code to understand, which is the state this '
                + 'replaces.');
        }
        if (rules.some(function (r) { return r.kind === kind && r.door === door; })) {
            throw new Error('"' + door + '" is already declared for a ' + kind + '. Two plugins answering '
                + 'for one door is two answers, and only one of them would be the one that refuses.');
        }

        var one = {
            kind: kind,
            door: door,
            may: !!it.may,
            why: it.why.trim(),
            //WHERE THE REFUSAL LIVES, so somebody reading the pane can go and
            //read the code that does it rather than searching for it.
            at: it.at ? String(it.at) : null
        };
        rules.push(one);

        return function () {
            var was = rules.indexOf(one);
            if (was >= 0) rules.splice(was, 1);
        };
    }

    //---- asking ------------------------------------------------------------
    //
    //THE ANSWER CARRIES ITS REASON, because every caller here turns a refusal
    //into a sentence for somebody on a machine, and a caller that has to write
    //its own is a caller whose wording drifts from the pane's.
    function may(kind, door) {
        var found = rules.filter(function (r) {
            return r.kind === String(kind || '') && r.door === String(door || '');
        })[0];

        if (!found) {
            return {
                may: false,
                declared: false,
                why: 'nothing has said whether a ' + (kind || 'run of no kind') + ' may use "' + door
                    + '", so it may not. A door with no rule is a door nobody has thought about.'
            };
        }
        return { may: found.may, declared: true, why: found.why, at: found.at };
    }

    function all() {
        return rules.slice().sort(function (a, b) {
            return a.kind.localeCompare(b.kind) || a.door.localeCompare(b.door);
        });
    }

    if (actions) {
        undo.push(actions.define('permissions', {
            about: 'What a machine doing work may do, and why — declared by whichever plugin refuses it',
            takes: ['kind'],
            run: function (args) {
                var a = args || {};
                var want = String(a.kind || '').trim();
                var list = all().filter(function (r) { return !want || r.kind === want; });

                //THE KINDS THEMSELVES, so a pane can draw a tab per kind without
                //a second list of what kinds there are.
                var kinds = all().map(function (r) { return r.kind; }).filter(function (k, i, xs) {
                    return xs.indexOf(k) === i;
                });

                return {
                    kind: want || null,
                    kinds: kinds,
                    rules: list,
                    note: list.length
                        ? list.length + ' rule(s), each declared by the plugin that enforces it.'
                        : (want
                            ? 'Nothing has declared a rule for a ' + want + '.'
                            : 'Nothing has declared a rule yet.')
                };
            }
        }));
    }

    say.info('permissions: ready for plugins to declare what a run may do');

    await register(null, {
        onDestroy: function () { undo.forEach(function (f) { f(); }); rules.length = 0; },
        permissions: { rule: rule, may: may, all: all }
    });
}
module.exports = plugin;
