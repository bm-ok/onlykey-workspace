'use strict'

// the jobs API, call by call — every endpoint a worker uses, and its refusals
//
// A job running on a machine talks to this host over one small surface: fetch
// what the task remembers, hand the memory back, hand over a file, report
// progress. The round trip beside this file exercises whichever of those the
// `api-tour` job happens to use, which is the right way to prove the ROUND TRIP
// and the wrong way to prove the API — a call that quietly stopped answering
// shows up as a task that failed for some other-looking reason, twenty minutes
// in, on a machine.
//
// SO EACH ONE IS ASKED DIRECTLY, from a machine, over TLS, with that machine's
// own token — the same way machines/job-api.js asks. What is proven is not that
// a job works but that the surface underneath it does.
//
// AND THE REFUSALS ARE HALF OF IT. Every one of these endpoints decides WHOSE
// task it is answering about, and it decides from the token rather than from
// anything the caller says — a machine cannot ask for another machine's session
// by naming it, because it is never asked which one it wants. The checks below
// try exactly that.
//
// IT ARRANGES A TASK IN FLIGHT, because most of this surface only answers a
// machine that is running one — and puts it all back afterwards.

const { it, cleanup, requires } = require('../../../tasks/harness')
const { scratch, aLine, aConnectedMachine } = require('../../helpers')

requires('the machines are built')

// Just the status code, for the checks that are about the door rather than the
// answer.
const CODE = "-o /dev/null -s -w '%{http_code}'"

const run = async (okc, machine, line, what) => {
  const said = await okc('vmRun', { name: machine, command: line, what })
  return String(said.output || '').split('\n').slice(1).join('\n').trim()
}

// A machine's own credentials, read the way the agent's service unit gets them.
const AS_MACHINE = 'eval "$(sudo -n cat /etc/okc-agent.env | grep -E \'^OKC_(VM|TOKEN|CA)=\')" && '

it('a machine is running a task, which is what most of this surface answers', async ({ okc, assert, state, log }) => {
  const machine = await aConnectedMachine(okc, assert, 'no machine from the test pool is dialled in')
  state.machine = machine.name

  const line = await aLine(okc, assert)
  state.branch = scratch('jobs-api')
  await okc('branchCreate', { branch: state.branch, reason: 'a drill asking every call the jobs API offers', group: line })

  const jobs = (await okc('jobs')).jobs || []
  const job = jobs.find(j => j.approved)
  assert.needs(job, 'no approved job to write a task under')

  state.task = await okc('taskCreate', {
    task: { title: 'drill: the jobs API, call by call', brief: 'Written by a drill. Nothing runs it — it exists so the endpoints have a task to answer about.', branch: state.branch, job: job.id }
  })
  // GIVEN, WITHOUT DISPATCHING. The state is what the endpoints read — "which
  // task is this machine running" — and running the job would be the round trip
  // next door rather than this.
  await okc('taskUpdate', { id: state.task.id, task: { state: 'given', machine: machine.name } })
  await okc('vmWorkspace', { name: machine.name, branch: state.branch })
  state.setUp = true

  const served = await okc('vmScript', { name: machine.name, stage: 'firstBoot' })
  state.base = (String(served.script).match(/OKC_BASE='([^']+)'/) || [])[1]
  assert.ok(state.base, 'this host does not say where it listens in the script it serves a machine')
  log(`#${state.task.number} is in flight on ${machine.name}, talking to ${state.base}`)
}, { minutes: 8 })

it('and every call it offers answers', async ({ okc, assert, state, log }) => {
  const ask = (method, path, extra = '') => run(okc, state.machine,
    `${AS_MACHINE}curl ${CODE} ${method === 'POST' ? '-X POST ' : ''}--cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" ${extra} "${state.base}${path}?vm=$OKC_VM${path.includes('?') ? '' : ''}"`,
    `asking ${method} ${path}`)

  // WHAT IT REMEMBERS. 204 when there is nothing kept yet, which is the ordinary
  // answer for a task that has never run, and 200 once there is.
  const session = await ask('GET', '/session')
  assert.ok(['200', '204'].includes(session), `GET /session answered ${session}, and the only honest answers are 200 with an archive or 204 with nothing kept yet`)

  // PROGRESS, which is how a job says where it has got to. Never fatal on this
  // host's side, so what is checked is that it accepts one.
  const said = await ask('GET', '/provision/say', "--get --data-urlencode 'text=a drill asking every call'")
  assert.equal(said, '200', `the say endpoint answered ${said}`)

  const stage = await ask('GET', '/provision/report', '--get --data-urlencode "stage=drill"')
  assert.equal(stage, '200', `the report endpoint answered ${stage}`)

  // AND THE REPOSITORIES, which is the other half of what a job needs.
  const git = await run(okc, state.machine,
    `${AS_MACHINE}curl ${CODE} --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" "${state.base}/git/local-repo-a/info/refs?service=git-upload-pack"`,
    'asking for a repository')
  assert.equal(git, '200', `the git server answered ${git} to a machine that is set up on a branch`)

  log(`session ${session}, say ${said}, report ${stage}, git ${git}`)
}, { minutes: 6 })

it('and it cannot ask about a task that is not its own', async ({ okc, assert, state, log }) => {
  // THE PROPERTY THAT MAKES THE SURFACE SAFE: none of these endpoints takes a
  // task. They take a MACHINE — which the token proves — and this host looks up
  // what that machine is running. So there is no argument to lie about.
  //
  // Asked by trying: name another machine in the query while presenting our own
  // token, which is the shape of the attempt somebody would actually make.
  const machines = (await okc('vmList')).vms || []
  const other = machines.find(m => m.name !== state.machine && !m.supervisor)
  assert.needs(other, 'this needs a second machine to name')

  const code = await run(okc, state.machine,
    `${AS_MACHINE}curl ${CODE} --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" "${state.base}/session?vm=${other.name}"`,
    'asking for another machine\'s session while presenting its own token')
  assert.equal(code, '401',
    `a machine asked for ${other.name}'s session with its own token and got ${code}. The name in the query and the name in the token must be the same machine, or a token is a key to every task on this host`)

  log(`${state.machine} asking about ${other.name} is refused: 401`)
}, { gate: true })

it('and a file handed over is filed under the task, not under a name it chose', async ({ okc, assert, state, log }) => {
  // AN ARTIFACT IS A DELIVERY, and which task it belongs to is looked up rather
  // than asked for — the same rule as the session. What the machine chooses is
  // the file's NAME, and that is checked for the things a name can do.
  const said = await run(okc, state.machine,
    `${AS_MACHINE}printf 'a drill handed this over' > /tmp/okc-drill.txt && ` +
    `curl -sS --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" --data-binary @/tmp/okc-drill.txt ` +
    `"${state.base}/artifact?vm=$OKC_VM&name=drill-jobs-api.txt"; rm -f /tmp/okc-drill.txt`,
    'handing a file over')
  assert.ok(/kept|okc/i.test(said) || !said.includes('error'), `handing a file over said: ${said.slice(0, 200)}`)

  const files = await okc('taskFiles', { id: state.task.id })
  const kept = (files.files || []).find(f => (f.name || f.path) === 'drill-jobs-api.txt')
  assert.ok(kept, `nothing called drill-jobs-api.txt is filed under #${state.task.number}: ${JSON.stringify(files).slice(0, 200)}`)

  // AND A NAME THAT IS A PATH IS REFUSED. A file named "../../something" would
  // otherwise be a machine writing wherever it liked on this host.
  const escaped = await run(okc, state.machine,
    `${AS_MACHINE}printf 'no' | curl ${CODE} --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" --data-binary @- "${state.base}/artifact?vm=$OKC_VM&name=../escaped.txt"`,
    'handing over a file named as a path')
  assert.equal(escaped, '400', `a machine handed over a file named "../escaped.txt" and got ${escaped}`)

  log(`${kept.name} is filed under #${state.task.number}; a name that is a path is refused`)
}, { minutes: 5 })

cleanup(async ({ okc, state }) => {
  if (state.setUp && state.machine) {
    try { await okc('vmRelease', { name: state.machine }) } catch { /* it may not be claiming one */ }
  }
  if (state.task) { try { await okc('taskRemove', { id: state.task.id }) } catch { /* never written */ } }
  if (state.branch) { try { await okc('branchDelete', { branch: state.branch, force: true }) } catch { /* never cut */ } }
})
