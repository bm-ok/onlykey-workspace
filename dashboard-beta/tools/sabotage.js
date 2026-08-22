var fs = require('fs');
var path = require('path');
var cp = require('child_process');

//---------------------------------------------------------------------------
//`npm run sabotage <plan>` — break one thing, run the tests, put it back.
//
//A TEST THAT CANNOT FAIL IS A SENTENCE, NOT A CHECK. The only way to know which
//it is is to break the thing it claims to check and watch it go red. Roughly a
//third of the sabotages run against this codebase have found a weak TEST before
//they found anything about the code:
//
//  * a check that a link-local address is never named passed with the filter
//    deleted, because the machine it ran on had no link-local interface
//  * a batching check could not tell a two-second settle from none, because
//    every await in it was a microtask and the timer never got to fire
//  * a null-is-kept check passed against a truth test, because `null !==
//    undefined`
//
//---- two things this does that ten hand-written copies did not ------------
//
//IT TIMES OUT. A sabotage can make a test HANG rather than fail — deleting the
//sharing of an in-flight answer left a second caller waiting on a promise
//nothing would ever resolve. Without a limit the sweep stops there.
//
//AND IT PUTS THE FILE BACK WHATEVER HAPPENS. The copy this replaces restored
//only at the end, so the one time it hung it left the source broken on disk. On
//exit, on a throw, on ctrl-c: the original bytes go back.
//
//IT MATCHES AGAINST LF, whatever is on disk. Git checks files out with CRLF
//here, so a multi-line anchor written with \n finds nothing and the run reports
//"could not break" — which reads exactly like a rule that has moved.
//
//---- the plan --------------------------------------------------------------
//
//A plain module, kept beside the test it belongs to:
//
//    module.exports = {
//        file: 'src/app/vms/vbox/gate.js',
//        test: 'test/vms/vbox-gate.test.js',
//        breaks: [
//            ['what this pretends is true', 'the real line', 'the broken line']
//        ]
//    };
//---------------------------------------------------------------------------

var GIVE_UP = Number(process.env.OKC_SABOTAGE_PATIENCE || 60000);

var plan = process.argv[2];
if (!plan) {
    console.error('which plan? npm run sabotage -- test/vms/vbox-gate.sabotage.js');
    process.exit(1);
}

var it = require(path.resolve(plan));
var FILE = path.resolve(it.file);
var onDisk = fs.readFileSync(FILE, 'utf8');
var original = onDisk.split('\r\n').join('\n');

//PUT BACK WHATEVER HAPPENS. Registered before the first break, so there is no
//window in which the file is broken and nothing is watching.
var restored = false;
function restore() {
    if (restored) return;
    restored = true;
    try { fs.writeFileSync(FILE, onDisk); } catch (e) { /* nothing else to try */ }
}
process.on('exit', restore);
process.on('SIGINT', function () { restore(); process.exit(130); });
process.on('uncaughtException', function (e) { restore(); throw e; });

console.log(it.file + '  against  ' + it.test);

//THE RUNNING APP WILL FLAP WHILE THIS GOES, and it is worth a line because the
//first time it happens it looks like a real fault.
//
//This breaks a REAL SOURCE FILE, once per break, and the dev server is watching
//that folder — so each edit rebuilds the server bundle and reloads the server
//half against deliberately broken code. The window prints a stack trace, and it
//is a trace of a sabotage rather than of anything wrong with the app.
//
//It puts itself right: the restore below triggers one last rebuild, and the app
//comes back on the real file. Nothing has to be done about it except know.
//
//THE CHECKS THEMSELVES DO NOT GO NEAR THE RUNNING APP — `node --test` reads the
//source directly. The app is a bystander that happens to share the file.
console.log('the window will report reload failures while this runs — it is watching this file,');
console.log('and each break is a real edit to it. It comes back on the last restore.');
console.log('');

var clean = true;

it.breaks.forEach(function (b) {
    var what = b[0], from = b[1], to = b[2];

    if (original.indexOf(from) < 0) {
        //NOT A PASS AND NOT A FAILURE. The line moved, so this sabotage tested
        //nothing — and saying "caught" here would be the sweep lying about
        //itself.
        console.log('COULD NOT BREAK  ' + what);
        console.log('     the line it looks for is not in the file any more');
        clean = false;
        return;
    }

    fs.writeFileSync(FILE, original.replace(from, to));

    var said = cp.spawnSync('node', ['--test', it.test], {
        encoding: 'utf8',
        timeout: GIVE_UP,
        killSignal: 'SIGKILL'
    });

    var out = said.stdout || '';
    var which = out.split('\n')
        .filter(function (l) { return l.indexOf('✖') >= 0; })
        .map(function (l) {
            return l.replace(/^[^✖]*✖\s*/, '').replace(/\s*\([\d.]+ms\)\s*$/, '');
        })
        .filter(function (w) { return w && w.indexOf('failing tests') < 0; });

    if (said.signal === 'SIGKILL') {
        //A HANG IS CAUGHT, not survived — nothing passed. But it is worth its
        //own word, because a suite that hangs under a sabotage usually means a
        //test is waiting on something the sabotage stopped producing, and that
        //is a slower signal than a red line.
        console.log('caught (hung)  ' + what);
        console.log('     the suite never finished — a test is waiting on what this broke');
        return;
    }

    if (said.status !== 0) {
        console.log('caught   ' + what);
        console.log('     by: ' + (which[0] || '(a failure with no name)'));
        return;
    }

    console.log('SURVIVED ' + what);
    console.log('     nothing checks this');
    clean = false;
});

restore();

//AND THEN WAIT FOR THE WATCHER TO NOTICE, which is the difference between an app
//that comes back and one left sitting on a failed reload.
//
//THIS EXITED THE MOMENT IT HAD WRITTEN THE FILE BACK. webpack was still building
//the LAST break at that point, so the sequence the app saw was: broken file →
//build → reload fails → rectify keeps the last good graph and prints the failure
//→ and then nothing, because the restore had already happened and there was no
//further change to rebuild from.
//
//The file was correct on disk and the window showed a ReferenceError for a
//variable that was plainly declared two lines up. It cost a real investigation
//to find that the code was never wrong.
//
//SO THE RESTORED FILE IS TOUCHED AGAIN AFTER A PAUSE. A second write with a
//different mtime is a change the watcher cannot miss, and it is the LAST one —
//so whatever raced before it, the app's final rebuild is from the real file.
//AND THE TIMER IS NOT UNREF'D, deliberately. Holding the process open for that
//second and a half IS the fix; letting node exit early would put the write back
//exactly where it was.
setTimeout(function () {
    try { fs.writeFileSync(FILE, onDisk); } catch (e) { /* nothing else to try */ }

    console.log('');
    console.log(clean
        ? 'every sabotage was caught — these tests can fail'
        : 'SOMETHING GOT THROUGH — a test above is a sentence rather than a check');

    process.exitCode = clean ? 0 : 1;
}, 1500);
