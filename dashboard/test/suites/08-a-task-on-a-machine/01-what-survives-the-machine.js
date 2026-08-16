'use strict'

// what survives the machine — the artifact, the memory, and the token
//
// A MACHINE IS ROLLED BACK WHEN ITS WORK ENDS. Everything on it goes: the files
// it made, the folder Claude keeps its conversation in, and the credential it
// was lent. Three things are meant to survive that, by three different paths,
// and each is a handoff that either works or loses something nobody notices
// until they want it.
//
//     an artifact   a file a run hands over, kept here under the task
//     a session     ~/.claude, taken back at the end and put back next time,
//                   which is what makes a task given out twice a second attempt
//     the token     lent on the way up, and meant to come back on the way down
//
// WITHOUT SPENDING A WORKER RUN. The first two are HTTP endpoints a job posts
// to, so this drill posts to them from a machine exactly as `machines/job-api.js`
// does — same address, same credentials, same shape. That is the mechanism under
// test, and a real Claude run would exercise it no differently while costing
// minutes and somebody's tokens.
//
// BOTH ENDPOINTS REFUSE AN IDLE MACHINE, deliberately — "an artifact from a
// machine doing nothing has nowhere to belong" — so this arranges what they
// require: a task, given to a machine, in flight. `taskGive` is what does that,
// and it is the only caller that action has anywhere in this project.

const { it, cleanup, requires } = require('../../../tasks/harness')
const { scratch, aLine, aMachine } = require('../../helpers')

requires('the machines', 'the order')

it('a machine, a cut, and a task in flight on it', async ({ okc, assert, slow, state, log }) => {
  assert.needs(slow, 'this borrows a machine and puts a task on it — minutes. Ask for it with: suiteRun --suite "a task on a machine" --slow true')

  const free = await aMachine(okc, assert)
  const got = await okc('vmBorrow', { name: free.name, why: 'a drill proving what survives a machine being rolled back' })
  state.machine = got.name
  await okc('vmAwait', { name: state.machine, for: 'connected', seconds: 600 })

  state.line = await aLine(okc, assert)
  state.branch = scratch('survives')
  await okc('branchCreate', { branch: state.branch, reason: 'a drill proving an artifact, a session and a token survive a machine', group: state.line })

  state.task = await okc('taskCreate', {
    task: {
      title: 'drill: what survives the machine',
      brief: 'Nothing runs here. This task exists so a machine has something to hand things back FOR — both endpoints refuse a machine that is not running a task.',
      branch: state.branch
    }
  })

  // THE WORKSPACE FOR REAL, THE DISPATCH NOT AT ALL.
  //
  // `taskGive` was the obvious call and it is the wrong one here: it sets the
  // workspace up AND dispatches the brief, so it refused with "kit-1's worker is
  // signed out, so the work would fail the moment it started" — correctly. Its
  // second half starts a real worker, which costs minutes and somebody's tokens
  // to arrange a precondition for a test about three HTTP endpoints.
  //
  // So the machine is set up on the branch exactly as taskGive would, and the
  // task is put into the state the endpoints ask for. They look for a task in
  // `given` naming this machine — "an artifact from a machine doing nothing has
  // nowhere to belong" — and that is a precondition being arranged, the same as
  // borrowing the machine two lines up. What is under test is what happens when
  // a machine posts to them.
  await okc('vmWorkspace', { name: state.machine, branch: state.branch })
  await okc('taskUpdate', { id: state.task.id, task: { state: 'given', machine: state.machine } })

  // WHERE THIS HOST IS, READ FROM THE HEADER RATHER THAN ASSUMED.
  //
  // A dispatched command inherits OKC_VM, OKC_TOKEN and OKC_CA — and NOT
  // OKC_BASE, which is the whole address with its port. The first version used
  // $OKC_BASE and curl answered "URL rejected: No host part in the URL", which
  // is the same trap 06-provisioning hit and wrote down: the one place the base
  // URL exists is the header this app prepends to a provisioning script, which
  // is exactly what an install uses.
  const served = await okc('vmScript', { name: state.machine, stage: 'firstBoot' })
  state.base = (String(served.script).match(/OKC_BASE='([^']+)'/) || [])[1]
  assert.ok(state.base, 'the served script carries no OKC_BASE, so nothing tells a machine where to hand anything back')
  const mine = (await okc('tasks')).tasks.find(t => t.id === state.task.id)
  assert.equal(mine.machine, state.machine, `the task was given to ${state.machine} and names ${mine.machine || 'nobody'}`)
  assert.equal(mine.state, 'given', `it is "${mine.state}" rather than given, and the handoff endpoints ask for given`)
  log(`${state.machine} is up, on "${state.branch}", running #${mine.number}`)
}, { minutes: 15, gate: true })

it('a file the machine hands over is kept here', async ({ okc, assert, state, log }) => {
  // POSTED THE WAY A JOB POSTS IT. `artifact()` in the job API is a curl to
  // /artifact with the machine's own name and token; this is the same call, so
  // what is proved is the path a real run uses rather than a private one.
  const marker = `okc-artifact-${Date.now()}`
  const said = await okc('vmRun', {
    name: state.machine,
    command: `printf '%s\\n' '${marker}' > /tmp/okc-drill.txt && ` +
      'curl -fsS --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" -X POST ' +
      '--data-binary @/tmp/okc-drill.txt -H "content-type: text/plain" ' +
      `"${state.base}/artifact?vm=$OKC_VM&name=drill-survives.txt" && echo okc-handed-over`,
    what: 'a drill handing a file over the way a job does'
  })
  assert.ok(String(said.output || '').includes('okc-handed-over'),
    `the machine could not hand the file over: ${JSON.stringify(said).slice(0, 300)}`)

  const files = await okc('taskFiles', { id: state.task.id })
  const kept = (files.files || []).find(f => (f.name || f.path) === 'drill-survives.txt')
  assert.ok(kept, `nothing called drill-survives.txt is filed under #${state.task.number}: ${JSON.stringify(files).slice(0, 200)}`)
  state.artifact = kept
  log(`handed over and filed: ${kept.name || kept.path}, ${kept.bytes} bytes`)
}, { minutes: 5 })

it('and the memory a worker keeps goes back and comes forward again', async ({ okc, assert, state, log }) => {
  // THE SAME TWO CALLS A WORKER RUN MAKES, in the same order: tar ~/.claude
  // without the credential, POST it, then GET it back and unpack. A real run
  // does this around a conversation; the conversation is not what is being
  // tested.
  const marker = `okc-session-${Date.now()}`
  const put = await okc('vmRun', {
    name: state.machine,
    command: 'mkdir -p "$HOME/.claude" && ' +
      `printf '%s\\n' '${marker}' > "$HOME/.claude/okc-drill-memory.txt" && ` +
      'tar -czf /tmp/okc-session.tgz -C "$HOME" --exclude=.credentials.json .claude && ' +
      'curl -fsS --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" -X POST ' +
      '--data-binary @/tmp/okc-session.tgz -H "content-type: application/gzip" ' +
      `"${state.base}/session?vm=$OKC_VM&id=00000000-0000-4000-8000-00000000drill&folder=/tmp" && echo okc-remembered`,
    what: 'a drill handing its session back the way a worker run does'
  })
  assert.ok(String(put.output || '').includes('okc-remembered'),
    `the machine could not hand its session back: ${JSON.stringify(put).slice(0, 300)}`)

  const kept = (await okc('sessions')).sessions.find(s => s.task === state.task.id || s.number === state.task.number)
  assert.ok(kept, `nothing is kept for #${state.task.number} — a session is filed under the task, not the machine`)
  log(`kept for #${state.task.number}: ${kept.bytes} bytes`)

  // AND BACK THE OTHER WAY, which is the half that matters: a machine is rolled
  // back between tasks, so the only reason to keep this is to hand it forward.
  const back = await okc('vmRun', {
    name: state.machine,
    command: 'rm -rf "$HOME/.claude" && ' +
      'curl -fsS --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" -o /tmp/okc-back.tgz ' +
      `"${state.base}/session?vm=$OKC_VM" && ` +
      'tar -xzf /tmp/okc-back.tgz -C "$HOME" && cat "$HOME/.claude/okc-drill-memory.txt"',
    what: 'a drill asking for what it remembered, after throwing it away'
  })
  assert.ok(String(back.output || '').includes(marker),
    `the memory did not come back: the folder was deleted and what returned did not contain ${marker}. ${JSON.stringify(back).slice(0, 300)}`)
  log('the folder was deleted on the machine and came back with what was in it')
}, { minutes: 8 })

it('and the token that went up comes back the same', async ({ okc, assert, state, log }) => {
  // WHAT IS COMPARED IS A FINGERPRINT, never the credential. The rule for the
  // Keys tab is that this app may know something was done in there without
  // knowing what, and a drill printing a token would put it in the log, the
  // result and the transcript at once.
  const held = await okc('credentialsHeld')
  assert.needs(held && held.held, 'this host holds no worker credential, so there is nothing to lend')

  await okc('vmCredentialsPut', { name: state.machine })
  state.lent = true
  const sum = c => `sha256sum "$HOME/.claude/.credentials.json" | cut -c1-16`
  const first = await okc('vmRun', { name: state.machine, command: sum(), what: 'a drill fingerprinting the credential it was lent' })
  const up = String(first.output || '').trim().split('\n').pop().trim()
  assert.ok(/^[0-9a-f]{16}$/.test(up), `the machine has no credential to fingerprint: ${JSON.stringify(first).slice(0, 200)}`)

  // Taken back to this host, then lent again. If what came back is what went up,
  // the second fingerprint matches — and if the take-back path loses anything,
  // this is where it shows.
  //
  // AND IT NOW GOES THROUGH THE GUEST LIST, which is where sign-ins live: the
  // grab writes into the identity this machine holds rather than over a single
  // file, and the put hands that same identity back. The comparison is unchanged
  // and so is what it proves — what changed underneath is which of them can be
  // true at once, since two machines no longer share one record.
  await okc('vmCredentialsGrab', { name: state.machine })
  await okc('vmCredentialsPut', { name: state.machine })
  const again = await okc('vmRun', { name: state.machine, command: sum(), what: 'a drill fingerprinting it after a round trip' })
  const down = String(again.output || '').trim().split('\n').pop().trim()

  assert.equal(down, up, `the credential changed on its way back: it went up as ${up} and came back as ${down}. That is either a rotation this host did not expect or a path that mangles it, and both matter`)
  log(`fingerprint ${up} went up, was taken back, and went up again unchanged`)
}, { minutes: 8 })

cleanup(async ({ okc, state }) => {
  // The credential first, then the machine, then the paperwork. A machine left
  // holding one cannot be snapshotted, and a machine left borrowed is out of the
  // pool with nobody using it.
  if (state.machine) {
    if (state.lent) await okc('vmCredentialsForget', { name: state.machine }).catch(() => {})
    await okc('vmReturn', { name: state.machine }).catch(() => {})
  }
  if (state.task) await okc('taskRemove', { id: state.task.id }).catch(() => {})
  if (state.branch) await okc('branchDelete', { branch: state.branch, force: true }).catch(() => {})
})
