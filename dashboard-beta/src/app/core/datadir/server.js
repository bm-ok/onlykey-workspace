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

    //THE WHOLE SURFACE, NOT JUST `at`, and this was missing two thirds of it.
    //
    //./main.js publishes `path`, `from` and `at`. This published `at` alone — so
    //in a process with no main half, `dataDir.path` was not a refusal, it was
    //`undefined`, and `path.join(undefined, 'id_okc')` throws a TypeError about
    //an argument. ../ssh and ../tls both build their directory that way.
    //
    //WHICH DEFEATS THE PARAGRAPH AT THE TOP OF THIS FILE. The refusal exists to
    //say, in words, that nobody knows where this process keeps things and that
    //guessing is the danger — and it only ever said it down one of the three
    //ways in. A stand-in narrower than the thing it stands in for answers
    //`undefined` where it meant to refuse, which is the quiet direction.
    //
    //GETTERS, because `path` and `from` are values on the real one and have to
    //stay values here. Reading either throws the same sentence `at()` throws.
    function noAnswer() {
        throw new Error(
            'This process has no data directory — there is no main half behind it, and the one place that '
            + 'works it out is core/datadir/main.js. Nothing is guessed here on purpose: a plausible wrong '
            + 'path is how something gets written where nobody will think to look for it.');
    }

    await register(null, {
        dataDir: {
            at: noAnswer,
            get path() { return noAnswer(); },
            get from() { return noAnswer(); }
        }
    });
}
module.exports = plugin;
