var path = require('path');

var makeSpec = require('./spec');
var makeScripts = require('./scripts');
var header = require('./header');

//---------------------------------------------------------------------------
//THE SETUP: what a machine is built as, and what it is handed when it boots.
//
//THE SCRIPTS ARE FILES, NOT STRINGS IN HERE, and that is the design rather than
//an accident of how it grew. Making a different KIND of machine is editing or
//replacing a script; a machine's spec can name a different file for any stage.
//So this plugin knows the STAGES and the ORDER and the HEADER, and never what
//any particular step is for.
//
//---- what is here ---------------------------------------------------------
//
//./spec.js    — what a machine is built as, decided once. The flag, the tag and
//               the secret cannot disagree because there is one moment where
//               any of them is set.
//./scripts.js — which file a machine gets for a stage, and the rule that a spec
//               may not name a PATH.
//./header.js  — the block of values every script is given, and the quoting that
//               keeps a typed value from becoming a command on a machine that
//               runs it as root.
//
//---- and what is not here yet ---------------------------------------------
//
//THE SCRIPTS THEMSELVES. `first-boot.sh` and the rest are still only in
//../../../../dashboard/provision, because they are project-shaped files rather
//than code and they move with the create path that runs them.
//
//NOTHING PRETENDS OTHERWISE: with no folder on disk, `searchPath()` is empty and
//every resolve says "there is no provisioning script called X" — which is true.
//The alternative, a default that quietly points at the old app's folder, would
//make this app serve files it does not own to machines it did not build.
//
//AND THE BUILDING: create, install, the base snapshot. That is the half that
//drives ../vbox and writes to ../ours, and it lands next.
//---------------------------------------------------------------------------

plugin.consumes = ['app', 'log', 'ours', 'channel'];
plugin.provides = ['provision'];
async function plugin(imports, register) {
    //WHAT THE APP SHIPS. Beside the server bundle, because that is what survives
    //being packaged — see `node: { __dirname: false }` in webpack.config.js.
    var appDir = process.env.OKC_APP_PROVISION_DIR || path.join(__dirname, 'provision');

    //AND WHAT THE PROJECT BRINGS. Outside the app on purpose: project-specific
    //content is exactly what belongs there, and it is why the check that keeps
    //this app generic does not scan it.
    var workspaceDir = process.env.OKC_PROVISION_DIR || null;

    var scripts = makeScripts({ appDir: appDir, workspaceDir: workspaceDir });

    var spec = makeSpec({
        //ISSUED BY THE THING THAT CHECKS THEM. A token this app makes and a
        //token this app accepts must come from one place, or the two drift and
        //the failure is a machine that cannot dial in for a reason nothing
        //explains.
        newToken: imports.channel.newToken,

        //THE TAGS THIS APP GIVES A MEANING TO, from ../ours — where a role is a
        //fact about a machine record. Taken rather than restated, so a supervisor
        //means the same thing at the moment one is BUILT and at the moment the
        //queue decides whether to give it work.
        SUPERVISOR: imports.ours.SUPERVISOR,
        POOL: imports.ours.POOL
    });

    await register(null, {
        provision: {
            fill: spec.fill,

            render: scripts.render,
            raw: scripts.raw,
            fileFor: scripts.fileFor,
            has: scripts.has,
            list: scripts.list,
            resolve: scripts.resolve,
            sourceOf: scripts.sourceOf,
            stageOfFile: scripts.stageOfFile,
            searchPath: scripts.searchPath,

            header: header,
            STAGES: scripts.STAGES
        }
    });
}
module.exports = plugin;
