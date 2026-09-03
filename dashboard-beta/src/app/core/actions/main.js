//the action table: every capability this app has, by name.
//
//ONE SURFACE. This is the rule the dashboard is built on and the one most worth
//carrying over: an action added here exists for the window, the command line and
//whatever comes next, all at once. Not an http route for the page and a separate
//function for the terminal — one table, three ways in. Where that has been
//broken elsewhere, the second way in is always the one that turns out to have
//different rules.
//
//WHY THE TABLE IS IN MAIN AND THE ACTIONS ARE NOT. main.js is loaded once and
//never reloads; server.js is rebuilt and re-run on every save. The socket in
//../ipc holds long-lived connections and cannot be torn down each time somebody
//edits a file — so the registry lives here, where it is stable, and the actions
//register INTO it from the half that reloads. Editing an action re-registers it
//without dropping a single connection, which is better than the app this is
//ported from, where changing one costs a restart.
//
//WHICH MEANS EVERY REGISTRATION MUST BE UNDONE. A server half that adds an
//action and does not remove it in onDestroy leaves the old one behind on the
//next reload — and the two would differ by exactly the edit somebody just made.
//`define` hands back the function that removes it, so the caller cannot forget
//what it owns.

plugin.consumes = [];
plugin.provides = ['actions'];
async function plugin(imports, register) {
    var table = new Map();

    var actions = {
        //`spec` is { about, takes, run } — the same shape the dashboard uses,
        //so an action can be moved across without being rewritten.
        define: function (name, spec) {
            if (!name || typeof spec !== 'object' || typeof spec.run !== 'function') {
                throw new Error('an action needs a name and a run()');
            }
            table.set(name, spec);
            return function remove() {
                //only if it is still MINE. A reload defines the new one before
                //the old one's onDestroy runs in some orders, and a remover that
                //did not check would delete the replacement.
                if (table.get(name) === spec) table.delete(name);
            };
        },

        has: function (name) { return table.has(name); },

        //WHO ASKED FOR THIS CALL, in words, from the stamps the table itself
        //carries. It belongs here because this is what receives them: an action
        //module that worked it out from the raw fields would be a second opinion
        //about the one question every refusal in this app turns on.
        //
        //TWO ANSWERS, NOT THE DASHBOARD'S THREE. Over there a third — "the
        //command line, driving the window" — covers a person's own window being
        //worked from outside. There is no such state here: ../drive refuses to
        //press a guarded button or fill a guarded field at all, so a driven call
        //never reaches an action pretending to be a person. The refusal moved
        //earlier rather than being dropped, and this returns what is true.
        whoAsked: function (args) {
            if (args && args._fromMachine) return String(args._fromMachine);
            if (args && args._overTheWire) return 'the command line';
            return 'the window';
        },

        //WHAT THIS HALF OWNS, and nothing else. Kept separate from `all()`
        //because "is this action mine" is a real question with a synchronous
        //answer, and making it wait on a socket would be the wrong trade.
        list: function () {
            return [...table.entries()]
                .map(function (e) { return { name: e[0], about: e[1].about || null, takes: e[1].takes || [] }; })
                .sort(function (a, b) { return a.name.localeCompare(b.name); });
        },

        //EVERYTHING THIS APP CAN DO.
        //
        //EVERY ROW USED TO CARRY `where`, because during the port that was
        //the most interesting fact about an action: whether this app owned it
        //or the old one was still answering it. There is one table now, so
        //there is nowhere else a row could be from and nothing for the field
        //to say. ../../api's badge for anything but 'here' goes with it.
        //
        //STILL ASYNC, because it is called as one from three places and a
        //signature that changes with the internals is a signature that makes
        //callers rewrite for nothing.
        all: async function () {
            return {
                actions: actions.list().map(function (a) {
                    return { name: a.name, about: a.about, takes: a.takes };
                })
            };
        },

        call: async function (name, args) {
            var spec = table.get(name);
            if (spec) return spec.run(args || {});

            //ONE TABLE, ONE ANSWER, AND THAT SENTENCE IS TRUE AGAIN.
            //
            //There was a fall-through here to the app this one was ported
            //from, and while it existed "No action called X" was the WRONG
            //sentence for most of this app's names: they were not missing,
            //they were merely somewhere else. So this threw a longer thing
            //that had to go and ask the other half whether it was down.
            //
            //Nothing is somewhere else now.
            throw new Error('No action called "' + name + '"');
        }
    };

    await register(null, { actions: actions });
}
module.exports = plugin;
