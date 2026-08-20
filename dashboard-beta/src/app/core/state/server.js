//the same state, seen from the app's node half.
//
//the documents are owned by ./main.js, which is where `dataDir` is — and where
//anything that must survive a save belongs. What arrives here is that same
//object, handed over on the host.
//
//WHY BOTH HALVES WANT IT. `guards` is main-side because a permission must not
//vanish on a reload; `todos` and `workspace` are server halves because they
//reload freely and nothing is lost when they do. Both keep something between
//restarts, so both need this, and neither should be moved to the other side just
//to reach it.
//
//ABSENT IS ABSENT, AND IT SAYS SO RATHER THAN PRETENDING. Unlike ../log, which
//hands back a logger that drops every line, a store that quietly forgot
//everything would be worse than none: a caller would write the workspace, read
//it back as nothing, and conclude the workspace had been cleared. The test suite
//builds server halves against a bare host, so this has to be a real answer —
//and "there is nowhere to keep this" is one.

plugin.consumes = ['app'];
plugin.provides = ['state'];
async function plugin(imports, register) {
    var state = imports.app.host && imports.app.host.state;

    if (!state) {
        var nowhere = function () {
            throw new Error('nothing is keeping state in this process — there is no main half behind it');
        };
        return register(null, {
            state: {
                doc: function () {
                    return {
                        path: null,
                        //READING IS THE ONE THING THAT MAY ANSWER, because
                        //"there is nothing kept" is a true answer to it and the
                        //fallback is what the caller already said to use.
                        read: function (fallback) { return fallback; },
                        write: nowhere,
                        forget: nowhere
                    };
                },
                where: null
            }
        });
    }

    await register(null, { state: state });
}
module.exports = plugin;
