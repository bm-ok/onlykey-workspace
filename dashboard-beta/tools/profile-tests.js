var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

//---------------------------------------------------------------------------
//`npm run test-profile` — what each test file costs, and what never finishes.
//
//---- NOT CALLED `test-profile.js`, AND THAT IS THE POINT --------------------
//
//NODE'S TEST RUNNER GLOBS `**/test-*.js` as well as `**/*.test.js` and
//`**/test/**`. Under its old name this file matched — so `npm test` RAN THE
//PROFILER as one of its own tests, which ran the suite again from inside the
//suite. It cost fourteen seconds of every run and reported nothing, because
//nobody was reading a profiler's stdout in the middle of a test run.
//
//CLAUDE.md already warns about the `test/**` half of this trap and says to put
//shared helpers in tools/ for exactly that reason. This is the other half: being
//in tools/ is not enough, the NAME has to miss the glob too. Anything here that
//starts with `test-` is a test as far as `npm test` is concerned.
//
//WHY THIS EXISTS. `npm test` is two minutes and says one number at the end, so
//"the suite is slow" is as much as anybody can tell from it. Two minutes is long
//enough that it stops being run, and a suite that stops being run is a suite
//that stops being true.
//
//AND IT ANSWERS A SECOND QUESTION `npm test` CANNOT. A test file that never
//exits does not fail — the runner waits, and if the thing that started it is
//killed the file goes on running by itself. Eleven of those had been burning for
//two days when this was written, one of them a single `server-graph.test.js`
//left over from a cancelled run thirty-four hours earlier. Nothing anywhere said
//so, and they were competing for the same cores as everything measured since.
//
//SO A FILE THAT WILL NOT EXIT IS KILLED AND NAMED, rather than waited on.
//
//---- three things this is built to, all learnt the hard way ---------------
//
//SIX AT A TIME, NOT ALL OF THEM. Launching every file at once is a heavier load
//than `npm test` puts on the machine — and measuring by hammering is the exact
//fault this was written to look for. The same mistake in ./walk.js made the
//server too busy to answer the thing the walk was waiting for.
//
//IT PRINTS AS EACH ONE LANDS. A measurement that says nothing while it runs is
//indistinguishable from a hang, which is what the first version of this file
//was, and it was rightly refused.
//
//IT NEVER LEAVES ANYTHING BEHIND. See above.
//
//    npm run test-profile              every file
//    npm run test-profile -- queue     only the files whose name matches
//---------------------------------------------------------------------------

//ENOUGH TO KEEP THE CORES BUSY, few enough that the machine is still usable and
//the timings are of the tests rather than of the contention.
var AT_ONCE = 6;

//THE SLOWEST FILE IN THIS SUITE IS UNDER TWENTY SECONDS. A minute and a half is
//not "slow", it is "not going to finish".
var GIVE_UP = 90000;

var TEST = path.join(__dirname, '..', 'test');

var only = process.argv.slice(2).filter(function (a) { return a[0] !== '-'; })[0] || null;

//INTO THE FOLDERS TOO. `test/` is grouped the way `src/app` is — core, git,
//repositories, queue, ui, tabs, and `rules` for the checks that walk the whole
//tree rather than one plugin — so a flat read finds nothing at all.
function walk(at, under) {
    var out = [];
    fs.readdirSync(at, { withFileTypes: true }).forEach(function (e) {
        var name = under ? under + '/' + e.name : e.name;
        if (e.isDirectory()) out = out.concat(walk(path.join(at, e.name), name));
        else if (/\.test\.js$/.test(e.name)) out.push(name);
    });
    return out;
}

var files = walk(TEST, '')
    .filter(function (f) { return !only || f.indexOf(only) >= 0; });

if (!files.length) {
    console.log(only ? 'no test file matches "' + only + '"' : 'there are no test files');
    process.exit(1);
}

var queue = files.slice();
var began = Date.now();
var done = 0;
var all = [];

//WHAT IS IN FLIGHT RIGHT NOW, BY NAME.
//
//PRINTING ONLY COMPLETIONS HIDES THE ONE THING THIS IS FOR. A run that stops at
//34 of 35 tells you a file never finished and not WHICH — the one you cannot see
//is precisely the one still running. So each file says when it STARTS as well,
//and if nothing lands for a while the ones still going are named with how long
//they have been at it.
var running = {};
var landed = Date.now();

console.log(files.length + ' test file' + (files.length === 1 ? '' : 's') + ', '
    + AT_ONCE + ' at a time, node ' + process.version + ' on ' + os.cpus().length + ' cpus');
console.log('');

function next() {
    var f = queue.shift();
    if (!f) return Promise.resolve();
    var t0 = Date.now();

    running[f] = Date.now();
    console.log('        start    ' + f);

    return new Promise(function (resolve) {
        var p = cp.spawn(process.execPath, ['--test', path.join('test', f.split('/').join(path.sep))], {
            cwd: path.join(__dirname, '..'),
            stdio: ['ignore', 'pipe', 'pipe']
        });

        //KEPT, NOT PRINTED. A failing file's output is worth having and worth
        //not interleaving with five others; it is shown at the end, once.
        var said = '';
        p.stdout.on('data', function (b) { if (said.length < 200000) said += b; });
        p.stderr.on('data', function (b) { if (said.length < 200000) said += b; });

        var hung = setTimeout(function () {
            try { p.kill('SIGKILL'); } catch (e) { /* already gone */ }
        }, GIVE_UP);

        p.on('close', function (code, signal) {
            clearTimeout(hung);
            delete running[f];
            landed = Date.now();
            var r = {
                file: f, ms: Date.now() - t0, code: code,
                hung: !!signal, said: said
            };
            all.push(r);
            done++;
            console.log(String(done).padStart(3) + '/' + files.length + '  '
                + String(r.ms).padStart(7) + 'ms  ' + r.file
                + (r.hung ? '   NEVER EXITED — killed' : (code ? '   FAILED' : '')));
            resolve();
        });
    }).then(next);
}

//NAMED WHEN IT GOES QUIET, because quiet is the symptom being chased. Unref'd,
//so it can never be the reason this does not exit.
var heartbeat = setInterval(function () {
    if (Date.now() - landed < 12000) return;
    var still = Object.keys(running);
    if (!still.length) return;
    console.log('        still going after ' + Math.round((Date.now() - landed) / 1000) + 's quiet: '
        + still.map(function (f) {
            return f + ' (' + Math.round((Date.now() - running[f]) / 1000) + 's)';
        }).join(', '));
}, 6000);
if (heartbeat.unref) heartbeat.unref();

Promise.all(Array.from({ length: Math.min(AT_ONCE, files.length) }, next)).then(function () {
    clearInterval(heartbeat);
    var wall = Date.now() - began;
    var sum = all.reduce(function (n, r) { return n + r.ms; }, 0);
    var bad = all.filter(function (r) { return r.code || r.hung; });

    all.sort(function (a, b) { return b.ms - a.ms; });

    console.log('');
    console.log('added up: ' + (sum / 1000).toFixed(1) + 's     '
        + AT_ONCE + ' at a time: ' + (wall / 1000).toFixed(1) + 's');
    console.log('');
    console.log('slowest:');
    all.slice(0, 10).forEach(function (r) {
        console.log('  ' + String(r.ms).padStart(7) + 'ms  ' + r.file
            + (r.hung ? '   NEVER EXITED' : ''));
    });

    if (bad.length) {
        console.log('');
        bad.forEach(function (r) {
            console.log('---- ' + r.file + (r.hung ? ' never exited ----' : ' failed ----'));
            var lines = r.said.split('\n').filter(function (l) { return l.indexOf('✖') >= 0; });
            (lines.length ? lines : r.said.split('\n').slice(-12)).slice(0, 12)
                .forEach(function (l) { console.log('  ' + l.trim()); });
        });
    }

    //WHAT THIS DOES AND DOES NOT PROVE, said on the way out for the same reason
    //./check.js says its own — this is about TIME. A file that runs fast and
    //checks nothing profiles beautifully.
    console.log('');
    console.log('this is how long they take, and nothing about what they check.');

    process.exitCode = bad.length ? 1 : 0;
});
