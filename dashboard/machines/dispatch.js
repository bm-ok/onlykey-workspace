'use strict'

// Giving a machine a task, and letting go of it.
//
// FIRE AND FORGET, on purpose. A task runs for minutes or an hour, and holding
// the channel open for it would make dispatching indistinguishable from waiting
// -- one command that appears to hang, no progress, and nothing else able to use
// the machine meanwhile. So this starts the work detached and returns a run id.
// Progress is READ afterwards, from the session transcript, which is a delta
// with a bookmark rather than a stream nobody is watching.
//
// NOTHING HERE CARRIES A CREDENTIAL, and that is a correction rather than an
// omission. The first version of this passed one as an environment assignment on
// the command that starts the run -- which the agent inherits, and can print.
//
// That is the exact interaction the design notes warn about and call easy to
// miss: transcripts are captured to this host and kept, so a credential that
// reaches agent-visible output -- an env dump, a stack trace, an error -- is
// copied out and filed by design. A worker is signed in separately, through its
// own credential file, which is Claude Code's and not something the agent is
// handed a copy of in its environment.

const path = require('node:path')

// Shell-single-quoted. Everything here crosses into a script, and a task is
// written by a person -- or by another agent -- so its shape is not this file's
// to assume.
const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`

const RUNS = '$HOME/.okc-runs'

// A heredoc ends at its delimiter, wherever that appears. Text arriving here is
// written by a person or by another agent, so "it will not contain that line" is
// an assumption about somebody else's prose -- and the failure is not an error
// but the rest of the text being executed as shell.
function heredoc (path, body, tag) {
  if (new RegExp(`^${tag}$`, 'm').test(body)) {
    throw new Error(`That text contains a line reading exactly "${tag}", which is the marker used to send it to the machine. Change that line.`)
  }
  return `cat > ${path} <<'${tag}'\n${body}\n${tag}`
}

// Where a run's record lives on the machine. One directory per run: the prompt
// as it was given, the rules it was given with, the script that ran, its output,
// and the status written when it ends.
//
// Kept rather than streamed and dropped. "What actually ran" has no source but a
// record of the run -- a claim in a transcript is the agent's account of itself,
// and the two diverge.
function script ({ id, task, folder, contract, resume }) {
  const dir = `${RUNS}/${id}`

  // THE CONTRACT IS CARRIED, NOT REFERENCED.
  //
  // It used to be a path on the machine, which is why it was never once used:
  // nothing here puts a file on a machine, so the flag named something that
  // could not be made to exist. Now the text comes from this host and is written
  // into the run's own directory.
  //
  // Which is the better arrangement anyway. Rules that govern a run belong beside
  // that run, not in a file somewhere else that can be edited afterwards -- read
  // six weeks later, a path proves nothing about what the worker was actually
  // told, and the whole point of keeping a run record is that it cannot drift.
  const rules = contract ? `${dir}/contract.md` : null

  return `set -u
mkdir -p ${dir}
cd ${q(folder)} 2>/dev/null || cd "$HOME"

# The task as written, byte for byte, so what was asked can be read back later
# rather than reconstructed from a command line.
${heredoc(`${dir}/task.txt`, task, 'OKC_TASK_EOF')}
${rules ? `\n# The rules this run was given, kept with it.\n${heredoc(rules, contract, 'OKC_CONTRACT_EOF')}\n` : ''}
if ! command -v claude >/dev/null 2>&1; then
  echo "okc: claude is not installed on this machine, so it cannot be given work"
  exit 1
fi

# --dangerously-skip-permissions is the point rather than a shortcut. A worker
# that stops to ask cannot run unattended, and asking is exactly what nobody is
# there for. It is defensible HERE and would not be anywhere else: this machine
# cannot reach the dashboard's actions at all, may push one branch and no other,
# cannot touch a default branch, cannot rewrite or delete what it has pushed, and
# is thrown away when the work is done.
#
# WRITTEN TO A FILE AND RUN, rather than passed to "bash -c".
#
# It was bash -c once, and every dispatch it produced died instantly without
# leaving so much as an empty out.log. A shell-quoted path is wrapped in single
# quotes, and putting one inside a single-quoted -c argument ENDS that argument
# -- so the command bash actually received was "cd", with the rest arriving as
# positional parameters. A folder without spaces reassembled by accident and
# hid it; the first folder with a space in it did not.
#
# A file has no such layer: it is written once, verbatim, by a heredoc whose
# delimiter is quoted so nothing here expands. It is also the honest record of
# what ran, sitting beside the task and the output.
cat > ${dir}/run.sh <<'OKC_RUN_EOF'
# Its own pid, first, so a run that dies can be told from one still going. Without
# it a run that was killed reads as "running" forever, because the status file it
# would have written is exactly what never got written.
echo $$ > ${dir}/pid
cd ${q(folder)} 2>/dev/null || cd "$HOME"
claude -p "$(cat ${dir}/task.txt)" --dangerously-skip-permissions --output-format json${rules ? ` --append-system-prompt-file ${rules}` : ''}${resume ? ` --resume ${q(resume)}` : ''} > ${dir}/out.log 2>&1
echo $? > ${dir}/status
OKC_RUN_EOF

# Detached with nohup and its own session, so the run outlives the connection
# that started it -- the channel is how it was asked, not what holds it up.
nohup setsid bash ${dir}/run.sh > /dev/null 2>&1 &

# Recorded immediately, so a run that dies in its first second is still a run
# that happened rather than a directory nobody can account for.
date -u +%Y-%m-%dT%H:%M:%SZ > ${dir}/started
echo okc-dispatched ${id}`
}

// Stopping a run that is still going.
//
// THE PROCESS GROUP, not the process. `setsid` gave the run a session of its
// own, so the worker, whatever it spawned, and the shell holding them are all in
// one group -- and killing only the pid leaves a worker running with nothing
// watching it, which is worse than not stopping at all: the machine looks free
// and is not.
//
// The status file is deliberately NOT written. A stopped run has no result, and
// inventing an exit code for it would make it indistinguishable from one that
// finished. With the pid gone and no status, it reads as `lost` -- which is
// exactly what it is, and what every reader here already understands.
//
// Politely first. TERM lets a worker finish the line it is writing; KILL after a
// moment covers one that ignores it. Neither is a shutdown of the machine: that
// is the queue's business, and it does it when the run ends.
const stop = id => `set -u
D=${RUNS}/${q(id).slice(1, -1)}
if [ ! -f "$D/pid" ]; then echo "okc-stop-nopid"; exit 0; fi
P=$(cat "$D/pid")
if ! kill -0 "$P" 2>/dev/null; then echo "okc-stop-gone"; exit 0; fi
kill -TERM -- -"$P" 2>/dev/null || kill -TERM "$P" 2>/dev/null || true
for i in 1 2 3 4 5; do
  kill -0 "$P" 2>/dev/null || break
  sleep 1
done
if kill -0 "$P" 2>/dev/null; then
  kill -KILL -- -"$P" 2>/dev/null || kill -KILL "$P" 2>/dev/null || true
  sleep 1
fi
kill -0 "$P" 2>/dev/null && echo "okc-stop-refused" || echo "okc-stop-done"`

// Every run on the machine, newest first, with what became of it.
//
// `status` is written only when the run ends, so its absence is the answer to
// "is it still going" -- and it is reported as a state rather than as a missing
// field, because a caller that has to interpret an absence will eventually
// interpret it as finished.
//
// THREE STATES, NOT TWO. A missing status used to mean running, full stop, which
// is only true while something is still there to write one. A run that was killed
// -- or that never started, which is how the quoting bug above presented -- has no
// status and no process, and reporting that as "running" is a watcher that waits
// forever for a result nobody is going to produce. So the pid is checked: no
// status and nothing alive is `lost`, and says so.
const list = () => `set -u
[ -d ${RUNS} ] || exit 0
for d in ${RUNS}/*/; do
  [ -d "$d" ] || continue
  id=$(basename "$d")
  started=$(cat "$d/started" 2>/dev/null || echo unknown)
  if [ -f "$d/status" ]; then
    state=finished
    code=$(cat "$d/status" 2>/dev/null || echo '?')
  elif [ -f "$d/pid" ] && kill -0 "$(cat "$d/pid")" 2>/dev/null; then
    state=running
    code=
  elif [ -f "$d/pid" ]; then
    state=lost
    code=
  else
    # No pid file yet. Either it is a second old, or it predates the pid being
    # recorded at all -- both are indistinguishable from here, so neither is
    # claimed.
    state=running
    code=
  fi
  lines=$(wc -l < "$d/out.log" 2>/dev/null || echo 0)
  first=$(head -c 160 "$d/task.txt" 2>/dev/null | tr '\\n' ' ')
  echo "okc-run|$id|$state|$code|$started|$lines|$first"
done`

// The tail of one run's raw output. The transcript says what the agent did; this
// says what its own process printed, which is where a crash before it ever
// started thinking shows up.
const output = (id, lines = 40) => `tail -n ${Number(lines) || 40} ${RUNS}/${q(id).slice(1, -1)}/out.log 2>/dev/null || echo "okc: no output for that run"`

function runs (out) {
  return String(out || '').split('\n')
    .map(l => l.trim()).filter(l => l.startsWith('okc-run|'))
    .map(l => l.split('|'))
    .map(([, id, state, code, started, lines, task]) => ({
      id,
      state,
      exit: code === '' ? null : Number(code),
      started,
      outputLines: Number(lines) || 0,
      task: (task || '').trim()
    }))
    .sort((a, b) => String(b.started).localeCompare(String(a.started)))
}

// Readable, sortable, and unique enough for one machine's runs. Not a uuid: this
// is a name somebody types back to ask what happened to it.
const newId = () => 'run-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

module.exports = { script, list, output, runs, stop, newId, RUNS, path }
