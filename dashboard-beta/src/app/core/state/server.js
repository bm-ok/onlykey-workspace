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

var HERE = require('./drawer');
//WHAT KEEPS A DRAWER OUT OF A REPOSITORY, published beside `HERE` and for
//the same reason -- ../../bootstrap needs it and cannot require across the
//two bundles. See ./ignore.js.
var IGNORE = require('./ignore');

plugin.consumes = ['app'];
plugin.provides = ['state'];
async function plugin(imports, register) {
    var state = imports.app.host && imports.app.host.state;

    if (!state) {
        var nowhere = function () {
            throw new Error('nothing is keeping state in this process — there is no main half behind it');
        };
        //READING IS THE ONE THING THAT MAY ANSWER, because "there is nothing
        //kept" is a true answer to it and the fallback is what the caller
        //already said to use. Writing is not: a write that silently went nowhere
        //would be read back as nothing and taken for a cleared setting.
        var blank = {
            path: null,
            read: function (fallback) { return fallback; },
            write: nowhere,
            forget: nowhere
        };
        return register(null, {
            state: {
                app: { doc: function () { return blank; }, where: null },
                here: {
                    doc: async function () { return blank; },
                    //THE SYNCHRONOUS DOOR REFUSES RATHER THAN ANSWERING BLANK.
                    //Its callers keep a conversation and a todo list, and the
                    //one thing worse than "there is nowhere to keep this" is a
                    //store that takes what it is given and forgets it.
                    now: nowhere,
                    open: async function () { return false; },
                    where: async function () { return null; }
                },
                follow: function () { return function () {}; },
                //NOTHING TO TELL, AND SAYING SO COSTS NOTHING. ../../workspace
                //pushes the open folder here on every change; with no main half
                //there is nowhere for it to land, and that is not a failure
                //worth propagating into a workspace being opened.
                at: function () { },
                slugFor: function (d) { return String(d); },
                where: null,

                //THE NAME OF A WORKSPACE'S DRAWER, and a real value even here.
                //It is a constant rather than a fact about this host, so a
                //stand-in that answered null for it would be inventing a
                //difference that does not exist — and ../../bootstrap builds a
                //path out of it, so null becomes "the path argument must be of
                //type string" a long way from the cause.
                HERE: HERE,
                IGNORE: IGNORE
            }
        });
    }

    await register(null, { state: state });
}
module.exports = plugin;
