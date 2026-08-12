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

// Where a run's record lives on the machine. One directory per run: the prompt
// as it was given, the raw output, and the exit status written when it ends.
//
// Kept rather than streamed and dropped. "What actually ran" has no source but a
// record of the run -- a claim in a transcript is the agent's account of itself,
// and the two diverge.
function script ({ id, task, folder, contract, resume }) {
  const dir = `${RUNS}/${id}`

  return `set -u
mkdir -p ${dir}
cd ${q(folder)} 2>/dev/null || cd "$HOME"

# The task as written, byte for byte, so what was asked can be read back later
# rather than reconstructed from a command line.
cat > ${dir}/task.txt <<'OKC_TASK_EOF'
${task}
OKC_TASK_EOF

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
# Detached with nohup and its own session, so the run outlives the connection
# that started it -- the channel is how it was asked, not what holds it up.
nohup setsid bash -c 'cd ${q(folder)} 2>/dev/null || cd "$HOME"; claude -p "$(cat ${dir}/task.txt)" --dangerously-skip-permissions --output-format json${contract ? ` --append-system-prompt-file ${q(contract)}` : ''}${resume ? ` --resume ${q(resume)}` : ''} > ${dir}/out.log 2>&1; echo $? > ${dir}/status' > /dev/null 2>&1 &

# Recorded immediately, so a run that dies in its first second is still a run
# that happened rather than a directory nobody can account for.
date -u +%Y-%m-%dT%H:%M:%SZ > ${dir}/started
echo okc-dispatched ${id}`
}

// Every run on the machine, newest first, with what became of it.
//
// `status` is written only when the run ends, so its absence is the answer to
// "is it still going" -- and it is reported as `running` rather than as a
// missing field, because a caller that has to interpret an absence will
// eventually interpret it as finished.
const list = () => `set -u
[ -d ${RUNS} ] || exit 0
for d in ${RUNS}/*/; do
  [ -d "$d" ] || continue
  id=$(basename "$d")
  started=$(cat "$d/started" 2>/dev/null || echo unknown)
  if [ -f "$d/status" ]; then
    state=finished
    code=$(cat "$d/status" 2>/dev/null || echo '?')
  else
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

module.exports = { script, list, output, runs, newId, RUNS, path }
