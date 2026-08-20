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

        has: function (name) { return table.has(name); },

        list: function () {
            return [...table.entries()]
                .map(function (e) { return { name: e[0], about: e[1].about || null, takes: e[1].takes || [] }; })
                .sort(function (a, b) { return a.name.localeCompare(b.name); });
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
