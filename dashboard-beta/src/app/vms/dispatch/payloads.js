var fs = require('fs');
var path = require('path');

//---------------------------------------------------------------------------
//THE FILES THAT RUN ON A MACHINE RATHER THAN HERE.
//
//  job-api.js      what a job is handed
//  job-runner.js   the three lines that start one
//  watch-guest.js  a way to stand behind a model and watch it work
//
//REAL FILES, NOT STRINGS IN A SOURCE FILE, and that is the design rather than an
//accident of how it grew: all three can then be linted, syntax-checked and read
//like the code they are. `node --check` on a string inside a template literal is
//not a thing anybody does, and the one time this mattered the failure was a
//guest running a file that did not parse.
//
//COPIED TO dist/ BY webpack RATHER THAN BUNDLED — see PAYLOADS in
//webpack.config.js. What must arrive on the machine is WHAT SOMEBODY WROTE;
//bundled, a guest would receive babel's output with this app's own module graph
//folded into it, and `watch-guest.js` would arrive requiring modules that are
//not there.
//
//READ ONCE, AT LOAD. They cannot change while the app is running, and re-reading
//them per dispatch would put a file read on a path a guest is waiting at the end
//of.
//---------------------------------------------------------------------------

//BESIDE THE SERVER BUNDLE, because that is what survives being packaged — see
//`node: { __dirname: false }` in webpack.config.js, and ../provision/server.js,
//which finds its scripts the same way.
var DIR = process.env.OKC_APP_GUEST_DIR || path.join(__dirname, 'guest');

var FILES = {
    api: 'job-api.js',
    runner: 'job-runner.js',
    watch: 'watch-guest.js'
};

module.exports = function payloads(deps) {
    var d = deps || {};
    var dir = d.dir || DIR;
    var read = d.read || function (p) { return fs.readFileSync(p, 'utf8'); };

    var held = {};

    //LOUD AND AT LOAD, not at the moment a guest is waiting for it. A missing
    //payload otherwise surfaces as a guest that starts, fetches nothing, and
    //reports a node error about a file it was never sent — twenty minutes into
    //somebody's run.
    Object.keys(FILES).forEach(function (which) {
        var file = path.join(dir, FILES[which]);
        try {
            held[which] = read(file);
        } catch (e) {
            throw new Error('The dashboard is missing ' + FILES[which] + ', which runs on the machine. '
                + 'It should be at ' + file + ' — it is copied there from src/app/vms/dispatch/guest '
                + 'by the PAYLOADS list in webpack.config.js.');
        }

        //AN EMPTY PAYLOAD IS WORSE THAN A MISSING ONE: it copies, it writes, and
        //the guest runs nothing while everything reports success.
        if (!String(held[which]).trim()) {
            throw new Error(FILES[which] + ' is empty. A guest would be sent a file that does nothing '
                + 'and every step would report success.');
        }
    });

    return {
        api: function () { return held.api; },
        runner: function () { return held.runner; },
        watch: function () { return held.watch; },
        dir: function () { return dir; },
        FILES: FILES
    };
};

module.exports.FILES = FILES;
module.exports.DIR = DIR;
