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
    var fallbacks = [];
    var catalogues = [];

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

        //WHAT TO DO WITH A NAME NOBODY HERE OWNS YET. This app is a port in
        //progress: most of what the window asks for still lives in the app it
        //is being ported from, reached over its own socket. A fall-through is
        //how both can be true at once — an action that has moved is answered
        //here, and one that has not is passed on, with nothing above caring
        //which. As actions arrive, the fall-through quietly stops being used.
        fallback: function (fn) {
            fallbacks.push(fn);
            return function remove() {
                fallbacks = fallbacks.filter(function (x) { return x !== fn; });
            };
        },

        //AND WHAT EACH FALL-THROUGH COULD ANSWER, which `fallback` cannot say.
        //A fallback is a function that answers a name; it has no way to
        //enumerate what it would accept, so a list built from this table alone
        //describes a tenth of what the app can actually do.
        //
        //That is not a cosmetic gap. The API pane leads with "every capability
        //this server has, nothing can exist without appearing here" — a
        //sentence which, listing ten of two hundred and sixty, is simply false,
        //and false in the direction that makes somebody conclude a capability
        //was lost in the port.
        catalogue: function (fn) {
            catalogues.push(fn);
            return function remove() {
                catalogues = catalogues.filter(function (x) { return x !== fn; });
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

        //EVERYTHING THIS APP CAN DO, wherever it is answered.
        //
        //`where` TRAVELS WITH EACH ROW, because during a port that is the most
        //interesting fact about an action: 'here' is one this app owns, and
        //anything else names the half still answering it. It is also how the
        //list stops needing maintenance — the day an action moves in, its row
        //changes side on its own.
        //
        //A CATALOGUE THAT CANNOT BE READ IS NOT AN EMPTY ONE. If the pipe is
        //down, its names are missing from this answer, and saying so is the
        //difference between "the port has not got there yet" and "the thing it
        //relays to is not running". The caller is told which.
        all: async function () {
            var mine = actions.list().map(function (a) {
                return { name: a.name, about: a.about, takes: a.takes, where: 'here' };
            });
            var seen = new Set(mine.map(function (a) { return a.name; }));
            var missing = [];

            for (var i = 0; i < catalogues.length; i++) {
                var got;
                try { got = await catalogues[i](); }
                catch (e) { missing.push(e.message); continue; }
                if (!got || !got.list) continue;
                got.list.forEach(function (a) {
                    //THIS HALF WINS A NAME IT OWNS. An action that has moved in
                    //is answered here, so listing the far one beside it would
                    //show two rows for one capability and no way to tell which
                    //one runs.
                    if (seen.has(a.name)) return;
                    seen.add(a.name);
                    mine.push({
                        name: a.name, about: a.about || null,
                        takes: a.takes || [], where: got.where || 'elsewhere'
                    });
                });
            }

            mine.sort(function (a, b) { return a.name.localeCompare(b.name); });
            return { actions: mine, missing: missing };
        },

        call: async function (name, args) {
            var spec = table.get(name);
            if (spec) return spec.run(args || {});

            for (var i = 0; i < fallbacks.length; i++) {
                var answered = await fallbacks[i](name, args || {});
                //`undefined` means "not mine"; anything else is the answer. A
                //fallback that owns the name and genuinely returns nothing says
                //so with null.
                if (answered !== undefined) return answered;
            }

            throw new Error('No action called "' + name + '"');
        }
    };

    await register(null, { actions: actions });
}
module.exports = plugin;
