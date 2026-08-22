var quoting = require('../shell/quoting');
var q = quoting.q;

//---------------------------------------------------------------------------
//A RUN'S RECORD ON THE MACHINE, and the three questions asked about it.
//
//ONE DIRECTORY PER RUN: the prompt as it was given, the rules it was given with,
//the script that ran, its output, and the status written when it ends.
//
//KEPT RATHER THAN STREAMED AND DROPPED. "What actually ran" has no source but a
//record of the run — a claim in a transcript is the agent's account of itself,
//and the two diverge.
//---------------------------------------------------------------------------

var RUNS = '$HOME/.okc-runs';

//READABLE, SORTABLE, AND UNIQUE ENOUGH FOR ONE MACHINE'S RUNS. Not a uuid: this
//is a name somebody types back to ask what happened to it.
function newId(now) {
    var when = now || new Date();
    return 'run-' + when.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

//---- an id is a name, not a path and not a shell fragment ------------------
//
//THE VERSION THIS COMES FROM WROTE `q(id).slice(1, -1)` — quote it, then throw
//the quotes away — so the id landed BARE in the middle of a shell script, held
//together only by the escaping still inside it. It does reassemble correctly,
//and it is a trick that has to be re-derived by every reader.
//
//It is also a guard that is doing the wrong job. `newId` makes these, but `stop`
//and `output` take one back FROM A CALLER — it is a name somebody types — and an
//id of `../..` is a path traversal into another run's directory whether or not
//it is quoted properly. Quoting cannot answer that; a shape can.
var ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

//THE SECOND HALF CANNOT FAIL WHILE THE FIRST IS THERE, and that is worth saying
//rather than leaving it to look load-bearing — ../provision/scripts.js carries
//the same note about the same shape of check.
//
//`ID` already forbids a slash, and a traversal needs one: `a..b` is a directory
//called `a..b`, not a way out of the runs folder. It was tried as a sabotage and
//nothing changed, because there is nothing there to break.
//
//It stays because it is the check somebody would look for, and because it is
//what would catch the pattern above being weakened by an edit that looked
//harmless — the day a slash is allowed, this is what stops it mattering.
function checkId(id) {
    var name = String(id == null ? '' : id);
    if (!ID.test(name) || name.indexOf('..') >= 0) {
        throw new Error('"' + name + '" is not a run id. They look like "'
            + 'run-2026-08-22T04-08-57" — letters, numbers, dots and dashes.');
    }
    return name;
}

//---- stopping one ----------------------------------------------------------
//
//POLITELY FIRST. TERM lets a worker finish the line it is writing; KILL after a
//moment covers one that ignores it.
//
//NEITHER IS A SHUTDOWN OF THE MACHINE: that is the queue's business, and it does
//it when the run ends.
//
//THE WHOLE PROCESS GROUP FIRST — `kill -- -PID` — because a worker spawns
//children and killing only the leader leaves them running with nothing watching
//them. Falling back to the bare pid covers a run that never became a group
//leader.
function stop(id) {
    var name = checkId(id);
    return [
        'set -u',
        'D=' + RUNS + '/' + name,
        'if [ ! -f "$D/pid" ]; then echo "okc-stop-nopid"; exit 0; fi',
        'P=$(cat "$D/pid")',
        'if ! kill -0 "$P" 2>/dev/null; then echo "okc-stop-gone"; exit 0; fi',
        'kill -TERM -- -"$P" 2>/dev/null || kill -TERM "$P" 2>/dev/null || true',
        'for i in 1 2 3 4 5; do',
        '  kill -0 "$P" 2>/dev/null || break',
        '  sleep 1',
        'done',
        'if kill -0 "$P" 2>/dev/null; then',
        '  kill -KILL -- -"$P" 2>/dev/null || kill -KILL "$P" 2>/dev/null || true',
        '  sleep 1',
        'fi',
        //SAYS WHICH OF THE THREE HAPPENED. "It was stopped" is not the same
        //answer as "it was already gone" or "it would not die", and a caller
        //that cannot tell them apart reports the last one as success.
        'kill -0 "$P" 2>/dev/null && echo "okc-stop-refused" || echo "okc-stop-done"'
    ].join('\n');
}

//---- what one printed ------------------------------------------------------
//
//THE TRANSCRIPT SAYS WHAT THE AGENT DID; this says what its own PROCESS printed,
//which is where a crash before it ever started thinking shows up.
function output(id, lines) {
    var name = checkId(id);
    var n = Number(lines);
    if (!(n > 0)) n = 40;
    return 'tail -n ' + Math.floor(n) + ' ' + RUNS + '/' + name + '/out.log 2>/dev/null'
        + ' || echo "okc: no output for that run"';
}

//---- every run on the machine ----------------------------------------------
//
//THREE STATES, NOT TWO. A missing `status` used to mean running, full stop,
//which is only true while something is still there to write one. A run that was
//killed — or that never started — has no status and no process, and reporting
//that as "running" is a watcher that waits forever for a result nobody is going
//to produce. So the pid is checked: no status and nothing alive is `lost`.
//
//THE SEPARATOR IS A CHARACTER A TASK CANNOT CONTAIN. It used to be `|`, and a
//task with a pipe in it — a shell one-liner, a table, a regex — pushed extra
//fields into the line and the parser took the task as everything up to the first
//one. A unit separator is not a character prose has.
var SEP = String.fromCharCode(31);
var MARK = 'okc-run';

//AND THE SHELL IS TOLD THE SAME CHARACTER, worked out from it rather than typed
//again beside it.
//
//`list` used to carry a literal `\037` in two places while `SEP` was declared
//separately up here, so the machine's separator and the parser's were two
//constants that happened to agree. Changing one changed nothing observable in a
//test — every test builds its lines from `SEP` and reads them with `SEP`, so
//both halves moved together and stayed self-consistent while the real pairing,
//shell to parser, was broken. It was tried as a sabotage and survived.
//
//One answer, derived once: there is now nothing to keep in step.
//`\0` THEN THE OCTAL DIGITS, which is what POSIX printf takes — `\037`, not
//`\0037`. Padding the digits to three and keeping the leading zero produces the
//latter, which printf reads as `\003` followed by a literal `7`.
var SEP_OCTAL = '\\0' + SEP.charCodeAt(0).toString(8);

function list() {
    return [
        'set -u',
        '[ -d ' + RUNS + ' ] || exit 0',
        'S=$(printf "' + SEP_OCTAL + '")',
        'for d in ' + RUNS + '/*/; do',
        '  [ -d "$d" ] || continue',
        '  id=$(basename "$d")',
        '  started=$(cat "$d/started" 2>/dev/null || echo unknown)',
        '  if [ -f "$d/status" ]; then',
        '    state=finished',
        "    code=$(cat \"$d/status\" 2>/dev/null || echo '?')",
        '  elif [ -f "$d/pid" ] && kill -0 "$(cat "$d/pid")" 2>/dev/null; then',
        '    state=running',
        '    code=',
        '  elif [ -f "$d/pid" ]; then',
        '    state=lost',
        '    code=',
        '  else',
        //NO PID FILE YET. Either it is a second old, or it predates the pid
        //being recorded at all — both are indistinguishable from here, so
        //neither is claimed.
        '    state=running',
        '    code=',
        '  fi',
        '  lines=$(wc -l < "$d/out.log" 2>/dev/null || echo 0)',
        //THE FIRST LINE OF THE TASK, FLATTENED. Newlines and the separator both
        //go, because either would make one run look like two.
        '  first=$(head -c 160 "$d/task.txt" 2>/dev/null | tr "\\n' + SEP_OCTAL + '" "  ")',
        '  echo "' + MARK + '$S$id$S$state$S$code$S$started$S$lines$S$first"',
        'done'
    ].join('\n');
}

function runs(out) {
    return String(out == null ? '' : out).split('\n')
        .map(function (l) { return l.replace(/\r+$/, '').trim(); })
        .filter(function (l) { return l.indexOf(MARK + SEP) === 0; })
        .map(function (l) {
            var f = l.split(SEP);
            return {
                id: f[1],
                state: f[2],
                //AN EXIT CODE OF NOTHING IS NOT AN EXIT CODE OF ZERO. A run that
                //is still going has no code, and `Number('')` is 0 — which reads
                //as "it finished, successfully".
                exit: f[3] === '' || f[3] == null ? null : Number(f[3]),
                started: f[4],
                outputLines: Number(f[5]) || 0,
                //REJOINED RATHER THAN TAKEN AS ONE FIELD, so that if a separator
                //ever does survive the flattening the task is still whole.
                task: f.slice(6).join(SEP).trim()
            };
        })
        .sort(function (a, b) { return String(b.started).localeCompare(String(a.started)); });
}

module.exports = {
    RUNS: RUNS,
    SEP: SEP,
    newId: newId,
    checkId: checkId,
    stop: stop,
    output: output,
    list: list,
    runs: runs,
    q: q
};
