var cachedPlugin = require('../src/app/core/cached/server');
var refsPlugin = require('../src/app/repositories/refs/server');

//---------------------------------------------------------------------------
//pieces of the plugin graph that more than one test file has to build.
//
//IN `tools/` AND NOT IN `test/`, because node's runner treats anything under a
//`test` folder as a test file and would run this as one — a suite with no
//assertions in it, reported as passing. ../CLAUDE.md says so; this is the first
//thing to need it.
//
//THE REAL PLUGINS, NEVER STAND-INS. What a test using this is checking is that
//a pane gets the same answer through ../src/app/repositories/refs that it used
//to get from git directly. A fake refs would be testing the fake.
//---------------------------------------------------------------------------

var QUIET = { on: function () {
    return { info: function () {}, good: function () {}, warn: function () {}, bad: function () {}, out: function () {} };
} };

//`refs` AND THE `cached` UNDERNEATH IT, with nowhere to write.
//
//NOWHERE IS THE RIGHT ANSWER HERE and not a shortcut: everything refs keeps is
//clock-keyed, and ../src/app/core/cached never writes that kind down whatever
//it is given. Handing it a state that has no workspace open proves the whole
//path works with no disk involved at all.
//
//AND IT HANDS BACK `stop`. refs watches each repository's `.git`, so a test
//that builds one and walks away leaves file handles open — on Windows that is
//also what stops a temp folder being removed afterwards.
async function refsFor(imports) {
    var log = imports.log || QUIET;

    var cached = null;
    await cachedPlugin({
        app: {}, log: log,
        state: {
            here: {
                where: async function () { return null; },
                doc: async function () { throw new Error('nothing is kept in a test'); }
            }
        }
    }, async function (_e, s) { cached = s.cached; });

    var refs = null, undo = null;
    await refsPlugin({
        //NO `start` EVENT. Warming reads every repository and sets up the
        //watches; a test that wants that calls `refs.warm()` itself, so the
        //ones that do not are not paying for it.
        app: { on: function () {} },
        log: log,
        git: imports.git,
        workspace: imports.workspace,
        cached: cached
    }, async function (_e, s) { refs = s.refs; undo = s.onDestroy; });

    return { refs: refs, cached: cached, stop: undo || function () {} };
}

module.exports = { refsFor: refsFor, QUIET: QUIET };
