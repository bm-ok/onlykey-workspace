//where anything kept is kept, seen from the app's node half.
//
//it is worked out by ./main.js from `name` in package.json, and handed over on
//the host — because two answers to "where does it live" is how a credential ends
//up in one folder and the thing that reads it looks in another.
//
//WITHOUT A MAIN HALF THERE IS NO ANSWER, and this refuses rather than inventing
//one. A stand-in that returned a temp folder would be worse than a refusal in
//exactly the way that matters here: ../../keys writes a SEALED CREDENTIAL through
//this, and a plausible wrong path means writing one somewhere nobody will think
//to look for it, or to delete it.
//
//The test suite builds server halves against a bare host, so this case is real.
//It is why every caller resolves its paths lazily — asking at build time would
//turn a half that merely CAN store something into one that cannot be loaded.

plugin.consumes = ['app'];
plugin.provides = ['dataDir'];
async function plugin(imports, register) {
    var real = imports.app.host && imports.app.host.dataDir;

    if (real) return register(null, { dataDir: real });

    await register(null, {
        dataDir: {
            at: function () {
                throw new Error(
                    'This process has no data directory — there is no main half behind it, and the one place that '
                    + 'works it out is core/datadir/main.js. Nothing is guessed here on purpose: a plausible wrong '
                    + 'path is how something gets written where nobody will think to look for it.');
            }
        }
    });
}
module.exports = plugin;
