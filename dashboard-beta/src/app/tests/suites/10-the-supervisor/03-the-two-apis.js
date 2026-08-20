'use strict'

// the two APIs — and neither machine can reach the other's
//
// This host serves two surfaces to machines over the same HTTPS listener, with
// the same kind of proof — a machine's name and its own token:
//
//   the jobs API      for a machine DOING work: fetch what it remembers, hand
//                     back an artifact, clone the repositories
//   the supervisor    for a machine DECIDING what work there is: write tasks and
//   API               queue them, read what came back
//
// SAME DOOR, SAME KEY, DIFFERENT ROOMS. Every machine this app made has a token
// that satisfies the door, so what separates the two surfaces is not
// authentication at all — it is what the machine IS. That makes it exactly the
// kind of boundary that is right on the day it is written and quietly wrong
// three changes later, and the only way to know is to ask from both sides.
//
// THE CROSS-CHECK IS THE WHOLE POINT. If a runner is refused the supervisor API
// and a supervisor is refused the jobs API, the separation holds. Both halves
// are needed: refusing in one direction only is a wall with a door in the back.
//
// AND EACH MUST STILL GET ITS OWN, which is the check that keeps this honest. A
// pair of refusals also happens when the whole API is broken, and a drill that
// only proves things are refused would pass loudest on the day nothing worked at
// all.
//
// IT ASKS FROM THE MACHINES, over the wire, with each machine's real credentials
// — read the way anything on that machine could read them. A runner's token is
// root-only and the user has passwordless sudo, so anything running there can
// have it. That is not the flaw; it is the reason the refusal has to be this
// host's decision rather than the guest's good manners.

const { it, requires } = require('../../harness')
const { aConnectedMachine } = require('../../helpers')

requires('the machines are built')

// Just the status code. What is being checked is the door, and a body would
// only be another way of saying the same number.
const CODE = "-o /dev/null -s -w '%{http_code}'"

const run = async (okc, machine, line, what) => {
  const said = await okc('vmRun', { name: machine, command: line, what })
  return String(said.output || '').split('\n').slice(1).join('\n').trim()
}

// A runner keeps its token in /etc/okc-agent.env, which is root's. It reads it
// with sudo, exactly as anything else on that machine could.
const AS_RUNNER = 'eval "$(sudo -n cat /etc/okc-agent.env | grep -E \'^OKC_(VM|TOKEN|CA)=\')" && '
// A supervisor keeps its own beside its command, sealed to that user.
const AS_SUPERVISOR = '. "$HOME/.okc/env" && '

it('a runner and a supervisor are both up, and this host knows which is which', async ({ okc, assert, state, log }) => {
  const machines = (await okc('vmList')).vms || []

  const boss = machines.find(m => m.supervisor && m.connected)
  assert.needs(boss, 'no supervisor machine is dialled in — this drill asks from both sides, so it needs both')

  // FROM THE TEST POOL, which is what `test` tags. The first version took the
  // first connected machine that was not a supervisor and got runner4 — one of
  // the host's own working machines. Nothing here harms it, and it is still not
  // this kit's to use: the tags exist so work can ask for a KIND of machine, and
  // a drill is a kind of work.
  const worker = await aConnectedMachine(okc, assert,
    'no ordinary machine is dialled in. Start one from the test pool — the kit tags its own "test" — and run this again')

  state.boss = boss.name
  state.worker = worker.name
  if (!worker.fromThePool) log(`no machine tagged "test" is up, so this borrowed ${worker.name} instead`)

  // WHERE THE MACHINES REACH THIS HOST, taken from what this host would serve
  // them rather than guessed: the address changes with the network, and a drill
  // hard-coding one tests a machine that does not exist.
  const served = await okc('vmScript', { name: worker.name, stage: 'firstBoot' })
  state.base = (String(served.script).match(/OKC_BASE='([^']+)'/) || [])[1]
  assert.ok(state.base, 'this host does not say where it listens in the script it serves a machine')

  log(`supervisor ${boss.name}, runner ${worker.name}, both talking to ${state.base}`)
}, { gate: true })

it('and the runner is refused the supervisor API', async ({ okc, assert, state, log }) => {
  // ASKED WITH ITS OWN, REAL CREDENTIALS. It is a machine this app made and its
  // token is good — which is the point: being a machine here is not the same as
  // being a supervisor, and this is the only thing standing between a worker and
  // the surface that writes and queues work.
  const listing = await run(okc, state.worker,
    `${AS_RUNNER}curl ${CODE} --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" "${state.base}/supervisor?vm=$OKC_VM"`,
    'a runner asking what a supervisor may do')
  assert.equal(listing, '401', `a runner asked the supervisor API what it may do and got ${listing}. Anything but 401 is a worker holding the surface that writes and queues work`)

  const doing = await run(okc, state.worker,
    `${AS_RUNNER}curl ${CODE} -X POST --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" -H 'content-type: application/json' --data '{}' "${state.base}/supervisor/do?vm=$OKC_VM&what=tasks"`,
    'a runner asking the supervisor API to do something')
  assert.equal(doing, '401', `a runner asked the supervisor API to read the board and got ${doing}`)

  log(`${state.worker}: 401 from /supervisor and from /supervisor/do — it is a machine here, and it is not a supervisor`)
})

it('and the supervisor is refused the jobs API', async ({ okc, assert, state, log }) => {
  // THE OTHER DIRECTION, and it used to be refused by accident: a supervisor is
  // never given a task, so there was no session to fetch and nowhere for an
  // artifact to belong. True, and about what it was DOING rather than what it
  // is — so it would have stopped being true the day something handed a
  // supervisor a task by hand. It is refused for what it is now.
  const session = await run(okc, state.boss,
    `${AS_SUPERVISOR}curl ${CODE} --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" "$OKC_BASE/session?vm=$OKC_VM"`,
    'a supervisor asking for a session')
  assert.equal(session, '401', `a supervisor asked the jobs API for a session and got ${session}`)

  const artifact = await run(okc, state.boss,
    `${AS_SUPERVISOR}curl ${CODE} -X POST --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" --data 'nothing' "$OKC_BASE/artifact?vm=$OKC_VM&name=drill.txt"`,
    'a supervisor handing over an artifact')
  assert.equal(artifact, '401', `a supervisor posted an artifact to the jobs API and got ${artifact}`)

  // AND THE REPOSITORIES, which is the one that would matter most. A supervisor
  // holds no repositories on purpose — its provisioning skips the project's half
  // entirely — so one that could clone from here would be holding a copy of the
  // work it is supposed to be handing out.
  const clone = await run(okc, state.boss,
    `${AS_SUPERVISOR}curl ${CODE} --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" "$OKC_BASE/git/local-repo-a/info/refs?service=git-upload-pack"`,
    'a supervisor cloning the workspace')
  assert.equal(clone, '401', `a supervisor asked this host's git server for a repository and got ${clone}`)

  log(`${state.boss}: 401 from /session, /artifact and /git — it decides what work there is, and does none of it`)
})

it('and each still gets its own', async ({ okc, assert, state, log }) => {
  // THE CHECK THAT STOPS THE THREE ABOVE FROM PASSING FOR THE WRONG REASON.
  // Everything is refused when everything is broken, and a drill made only of
  // refusals passes loudest on that day.
  const may = await run(okc, state.boss,
    `${AS_SUPERVISOR}curl ${CODE} --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" "$OKC_BASE/supervisor?vm=$OKC_VM"`,
    'the supervisor asking its own API')
  assert.equal(may, '200', `the supervisor cannot reach its own API either — it got ${may}, so this boundary refuses everybody`)

  // A runner's own surface: the repositories it works in. 200 is the git
  // handshake answering, which is what a clone starts with.
  const repo = await run(okc, state.worker,
    `${AS_RUNNER}curl ${CODE} --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" "${state.base}/git/local-repo-a/info/refs?service=git-upload-pack"`,
    'the runner asking for a repository')
  assert.equal(repo, '200', `the runner cannot reach the git server either — it got ${repo}`)

  log('the supervisor gets its list, the runner gets the repositories, and neither gets the other')
})

// ---- WHAT IT SAW ----------------------------------------------------------
//
// 17 August 2026, supervisor-1 and runner4 both up and dialled in, both talking
// to https://192.168.51.63:7373. Four checks, eight seconds.
//
//     supervisor supervisor-1, runner runner4, both talking to
//     https://192.168.51.63:7373
//     PASS a runner and a supervisor are both up, and this host knows which is
//     which
//
//     runner4: 401 from /supervisor and from /supervisor/do — it is a machine
//     here, and it is not a supervisor
//     PASS and the runner is refused the supervisor API
//
//     supervisor-1: 401 from /session, /artifact and /git — it decides what work
//     there is, and does none of it
//     PASS and the supervisor is refused the jobs API
//
//     the supervisor gets its list, the runner gets the repositories, and
//     neither gets the other
//     PASS and each still gets its own
//
// GUEST SIDE ONLY, AND THAT IS THE WHOLE SCOPE. These are the two surfaces
// MACHINES talk to, over the HTTPS listener. The window and the command line are
// the person's side and reach the whole action table through `call()` — nothing
// here narrows that, and nothing should: the point of the allowlist is that a
// machine gets a named few, not that anybody does.
//
// The supervisor's refusals used to happen for the wrong reason. It is never
// given a task, so /session had no session to hand it and /artifact had nowhere
// to file one — accidents about what it was DOING rather than what it IS, and
// they would have stopped being true the day something gave a supervisor a task
// by hand. `workerAsking` in server.js refuses it for being a supervisor now,
// and the git server refuses it for the same reason.
