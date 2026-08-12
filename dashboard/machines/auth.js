'use strict'

// Signing a machine's worker in, from here.
//
// The sign-in is a conversation: the worker prints a URL, a person visits it and
// authorises, and a code comes back. That is two exchanges with one process,
// which a single command cannot do -- so the process is started detached with
// its input coming from a pipe that stays open, and the code is written into
// that pipe afterwards.
//
// Started HERE rather than by somebody opening a terminal in the machine,
// because the whole point is that the host runs this. A person opening the
// machine and typing is the thing every other part of this replaced.

// Where the sign-in keeps its pipe and its output, on the machine.
const DIR = '$HOME/.okc-auth'

const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`

// Start it, and wait just long enough to have something to say.
//
// The wait is here rather than in the caller because the answer to "sign this
// machine in" is the URL -- returning immediately and making somebody ask again
// would be a worse version of the same round trip.
const begin = seconds => `set -u
mkdir -p ${DIR}
# A previous attempt left a pipe and a process; both would take the input meant
# for this one, and the URL that came back would authorise the wrong attempt.
#
# KILLED BY RECORDED PID, never by pattern. pkill -f matches whole command
# lines, and the shell running this script has the entire script in its own argv
# -- including the line that launches the sign-in. So any pattern that matches
# the thing being killed also matches THIS process, and the script kills itself
# before doing anything at all. It produced no output whatsoever, which is the
# least diagnosable failure available: gone before it could say so. Bracketing
# the pattern fixed only the first of the two places the text appears, which is
# why the second attempt failed identically.
#
# A negative pid kills the process group, which is what setsid made it -- killing
# the wrapper alone would leave the worker holding the pipe.
if [ -f ${DIR}/pid ]; then kill -- -"$(cat ${DIR}/pid)" 2>/dev/null || true; fi
rm -f ${DIR}/in ${DIR}/log ${DIR}/status
mkfifo ${DIR}/in

# Held open by a writer that never writes. Without one the pipe reaches
# end-of-file the moment it is opened, and the worker exits deciding nobody is
# there to answer -- which looks exactly like a sign-in that failed for its own
# reasons.
setsid bash -c 'exec 3> ${DIR}/in; while [ -p ${DIR}/in ]; do sleep 1; done' > /dev/null 2>&1 &

# UNDER A PSEUDO-TERMINAL, because the sign-in is an interactive screen rather
# than a program that prints and reads. Without one it has nowhere to draw and
# says nothing at all -- which is not a failure with a reason, it is silence, and
# silence is the hardest thing to act on.
#
# \`script\` is util-linux and is already on any machine that has a shell. -q so
# its own chatter stays out of the log, -e so the worker's exit status is the one
# recorded rather than script's.
setsid bash -c 'script -qec "claude auth login" /dev/null < ${DIR}/in > ${DIR}/log 2>&1; echo $? > ${DIR}/status' > /dev/null 2>&1 &
echo $! > ${DIR}/pid

# Polled rather than slept at, so a fast answer is not paid for with a fixed
# wait, and a slow one is not cut off early.
for i in $(seq 1 ${seconds}); do
  if grep -qE 'https?://' ${DIR}/log 2>/dev/null; then break; fi
  if [ -f ${DIR}/status ]; then break; fi
  sleep 1
done

echo OKC_AUTH_LOG_BEGIN
cat ${DIR}/log 2>/dev/null
echo OKC_AUTH_LOG_END
[ -f ${DIR}/status ] && echo "OKC_AUTH_EXIT $(cat ${DIR}/status)"

# Said when there is nothing else to say. An empty log is the least actionable
# answer available -- it does not distinguish "still starting" from "the program
# is missing" from "it wrote to a terminal we are not holding" -- so the things
# that tell those apart are reported alongside it.
echo OKC_AUTH_WHY_BEGIN
echo "script: $(command -v script || echo MISSING)"
echo "claude: $(command -v claude || echo MISSING)"
echo "pid: $(cat ${DIR}/pid 2>/dev/null || echo none) alive: $(kill -0 "$(cat ${DIR}/pid 2>/dev/null || echo 0)" 2>/dev/null && echo yes || echo no)"
echo "logsize: $(wc -c < ${DIR}/log 2>/dev/null || echo none)"
echo OKC_AUTH_WHY_END
echo OKC_AUTH_DONE`

// The code, into the pipe the worker is reading.
//
// Then the same poll: it either finishes, or it says why not, and either way the
// answer is its own output rather than an assumption about what silence meant.
const code = (value, seconds) => `set -u
[ -p ${DIR}/in ] || { echo "OKC_AUTH_NO_PIPE"; exit 0; }
printf '%s\\n' ${q(value)} > ${DIR}/in
for i in $(seq 1 ${seconds}); do
  [ -f ${DIR}/status ] && break
  sleep 1
done
echo OKC_AUTH_LOG_BEGIN
cat ${DIR}/log 2>/dev/null
echo OKC_AUTH_LOG_END
[ -f ${DIR}/status ] && echo "OKC_AUTH_EXIT $(cat ${DIR}/status)"
echo OKC_AUTH_DONE`

const cancel = () => `if [ -f ${DIR}/pid ]; then kill -- -"$(cat ${DIR}/pid)" 2>/dev/null || true; fi
rm -f ${DIR}/in ${DIR}/log ${DIR}/status ${DIR}/pid
echo OKC_AUTH_CANCELLED`

// What a terminal was sent, turned back into text.
//
// The sign-in runs under a pseudo-terminal, so what comes back is what a
// terminal would have been asked to DRAW: colour codes, cursor moves, and -- the
// one that matters here -- OSC 8 hyperlinks, which carry the address inside an
// escape sequence and then print it AGAIN as the visible text.
//
// Left in, the URL arrives wrapped in escapes and doubled end to end. It looks
// approximately right, which is worse than looking wrong: it cannot be clicked,
// pasted or opened, and the reason is invisible in the middle of a long query
// string.
const plain = s => String(s || '')
  // Hyperlinks first, keeping the visible text and dropping the target, so the
  // address is not left in twice.
  .replace(/\u001b\]8;;[^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
  // Any other operating-system command: window titles, notifications.
  .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
  // Colours, cursor movement, erase.
  .replace(/\u001b\[[0-9;?]*[ -\/]*[@-~]/g, '')
  .replace(/\u001b[()][0-9A-B]/g, '')
  // Whatever is left that a terminal would have acted on rather than shown.
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')

function read (output) {
  const s = plain(output)
  const a = s.indexOf('OKC_AUTH_LOG_BEGIN')
  const b = s.indexOf('OKC_AUTH_LOG_END')
  const log = a >= 0 && b > a ? s.slice(a + 'OKC_AUTH_LOG_BEGIN'.length, b).trim() : ''
  const exit = /OKC_AUTH_EXIT (\d+)/.exec(s)

  // The first http(s) URL it printed. Trailing punctuation is trimmed because a
  // URL at the end of a sentence collects the full stop, and a URL that does not
  // open is worse than none -- it reads as the tool being broken.
  const url = (log.match(/https?:\/\/\S+/) || [null])[0]

  const c = s.indexOf('OKC_AUTH_WHY_BEGIN')
  const d = s.indexOf('OKC_AUTH_WHY_END')
  const why = c >= 0 && d > c ? s.slice(c + 'OKC_AUTH_WHY_BEGIN'.length, d).trim() : ''

  return {
    url: url ? url.replace(/[.,)\]}'"]+$/, '') : null,
    finished: !!exit,
    exit: exit ? Number(exit[1]) : null,
    log,
    why,
    noPipe: /OKC_AUTH_NO_PIPE/.test(s)
  }
}

module.exports = { begin, code, cancel, read, DIR }
