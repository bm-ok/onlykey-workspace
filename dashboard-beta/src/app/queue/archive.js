var fs = require('fs');
var path = require('path');

//---------------------------------------------------------------------------
//WHAT A RUN LEFT BEHIND, KEPT HERE, WHERE THE MACHINE CANNOT TAKE IT AWAY.
//
//A run's output and the worker's transcript live on the machine that did the
//work — and a machine is the disposable half of this tool. It gets rolled back
//to a snapshot, or deleted, or rebuilt, and every one of those is a normal and
//correct thing to do. Doing it takes the only account of what happened with it.
//
//NOT HYPOTHETICAL: two rollbacks in one afternoon erased the record of two runs
//whose results had already been reported. What remained was a task record saying
//work was done and nothing at all saying how.
//
//So a finished run is pulled across and kept beside the task, in the app's data
//directory rather than in a repository — it is produced by RUNNING, not by
//writing. The machine's copy stays where it is: this is a copy, not a move,
//because moving would make the machine's own record depend on this host being
//reachable at the moment it finished.
//
//REDACTED ON THE WAY IN. This is the boundary the credential rules already name:
//output crossing from a machine is KEPT here, permanently, so a token that
//reached a worker's output is not a moment of exposure but a filing. Cleaned
//here is the only place it can be stopped.
//
//---- and it is filed under a uid, not a number -----------------------------
//
//THE LOG OUTLIVES THE NOTE ABOUT IT, which is the right way round: removing a
//task deliberately leaves its logs, because they are the evidence and the record
//is only the request. A uid is never reused and never renumbered, so a log filed
//under one stays findable after the task it belonged to is gone.
//---------------------------------------------------------------------------

//TASK AND RUN IDS ARE MADE BY THIS APP AND ARE ALREADY TAME, but they arrive
//through an action, and an action's arguments are somebody else's text.
function safe(s) {
    return String(s == null || s === '' ? 'unknown' : s).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
}

module.exports = function archive(root, redact) {
    var clean = redact || function (t) { return t; };

    //ONE FOLDER PER TASK, ONE PER RUN INSIDE IT. A flat directory of run ids
    //would be sortable and useless: the question is always "what happened to
    //this task", and the answer should not require knowing which run ids
    //belonged to it.
    function dirFor(task, run) { return path.join(root(), safe(task), safe(run)); }

    function has(task, run) {
        try { return fs.existsSync(path.join(dirFor(task, run), 'out.log')); }
        catch (e) { return false; }
    }

    //KEPT ONCE AND NEVER REWRITTEN.
    //
    //A finished run does not change, and re-pulling it would mean the kept copy
    //silently follows whatever the machine says today — including saying
    //nothing, after a rollback. The first copy taken is the record.
    function keep(task, run, what) {
        var it = what || {};
        var dir = dirFor(task, run);
        if (has(task, run)) return { kept: false, why: 'already kept', dir: dir };

        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'out.log'), clean(it.output || ''));
        if (it.session) fs.writeFileSync(path.join(dir, 'session.json'), clean(JSON.stringify(it.session, null, 2)));
        fs.writeFileSync(path.join(dir, 'about.json'), JSON.stringify({
            task: task, run: run,
            machine: it.machine || null,
            state: it.state || null,
            //HOW IT ENDED, and the record already learnt once that a crashed run
            //and one that ran and found nothing are the same row without it.
            exit: it.exit === undefined ? null : it.exit,
            kept: new Date().toISOString()
        }, null, 2));
        return { kept: true, dir: dir };
    }

    //EVERYTHING KEPT FOR ONE TASK, oldest first. Read from the DIRECTORY rather
    //than from the task record, so a run whose task was thrown away is still
    //findable.
    function list(task) {
        var dir = path.join(root(), safe(task));
        var runs = [];
        try {
            runs = fs.readdirSync(dir, { withFileTypes: true })
                .filter(function (e) { return e.isDirectory(); })
                .map(function (e) { return e.name; });
        } catch (e) { return []; }

        return runs.sort().map(function (run) {
            var about = {};
            try { about = JSON.parse(fs.readFileSync(path.join(dir, run, 'about.json'), 'utf8')); }
            catch (e) { /* an interrupted keep */ }
            var bytes = 0;
            try { bytes = fs.statSync(path.join(dir, run, 'out.log')).size; }
            catch (e) { /* as above */ }
            return Object.assign({ run: run }, about, { bytes: bytes, dir: path.join(dir, run) });
        });
    }

    function read(task, run, opts) {
        var file = path.join(dirFor(task, run), 'out.log');
        var text;
        try { text = fs.readFileSync(file, 'utf8'); }
        catch (e) { return { found: false, why: 'nothing was kept for that run here', file: file }; }

        var all = text.split('\n');
        var want = Math.max(1, Number((opts || {}).lines) || 200);
        return {
            found: true,
            file: file,
            lines: all.length,
            //THE TAIL, because output ends with what happened. The whole file is
            //on disk and its path is returned, so nothing is hidden — only not
            //carried.
            text: all.slice(-want).join('\n'),
            more: Math.max(0, all.length - want)
        };
    }

    //EVERYTHING KEPT, FOR EVERY TASK THERE HAS EVER BEEN ONE FOR.
    //
    //THIS IS HOW A LOG STAYS REACHABLE AFTER ITS TASK IS GONE. Removing a task
    //deliberately leaves its logs — the evidence is meant to outlive the note
    //about it — but everything that read them wanted a task id, and a task id is
    //precisely what has just been thrown away. So the record sat on disk, filed
    //under a uid nothing could look up, which is indistinguishable from having
    //deleted it.
    function everything() {
        var uids = [];
        try {
            uids = fs.readdirSync(root(), { withFileTypes: true })
                .filter(function (e) { return e.isDirectory(); })
                .map(function (e) { return e.name; });
        } catch (e) { return []; }

        return uids.map(function (uid) {
            var runs = list(uid);
            var kept = runs.map(function (r) { return r.kept; }).filter(Boolean).sort();
            return {
                uid: uid,
                runs: runs.length,
                bytes: runs.reduce(function (n, r) { return n + (r.bytes || 0); }, 0),
                //TAKEN FROM THE RUNS rather than from the folder's own
                //timestamp, which changes when anything inside it is touched.
                first: kept[0] || null,
                last: kept.length ? kept[kept.length - 1] : null,
                //ENOUGH TO RECOGNISE IT BY when the task record is gone, which
                //is the case this exists for.
                machines: Object.keys(runs.reduce(function (n, r) {
                    if (r.machine) n[r.machine] = true;
                    return n;
                }, {})),
                dir: path.join(root(), uid)
            };
        }).sort(function (a, b) { return String(b.last || '').localeCompare(String(a.last || '')); });
    }

    return { keep: keep, list: list, read: read, has: has, everything: everything, dirFor: dirFor };
};
