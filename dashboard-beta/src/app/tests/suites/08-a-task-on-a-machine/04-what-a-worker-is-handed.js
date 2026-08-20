'use strict'

// what a worker is handed — three commands and a skill, and nothing wider
//
// A worker on a machine can say four things to this host, and they are the whole
// of its surface: hand a file back, say a line, follow its own log, and push a
// branch. The first three are written into the run's directory and put on its
// PATH; the fourth is git with the machine's own token.
//
// AND A SKILL THAT SAYS WHAT ANY OF IT IS. Fetched per run rather than installed
// at provisioning time, for the same reason the supervisor's is re-fetched on
// every wake: a machine built last month would otherwise be working to last
// month's rules, and the failure is a worker doing something this host stopped
// wanting weeks ago.
//
// CHECKED AGAINST THE GENERATED SCRIPT, not against a machine. What reaches a
// guest is a string built on this host, and the reason to read it here is that
// the alternative is finding out twenty minutes into a run.

const { it, requires } = require('../../harness')
const fs = require('node:fs')
const path = require('node:path')
const dispatch = require('../../../machines/dispatch')

requires()

const aRun = () => String(dispatch.script({
  id: 'drill-run', task: 'do the thing', folder: '/home/okc/workspace',
  base: 'https://host:7373', vm: 'kit-1', token: 'TOKEN'
}))

it('a run is given the three commands, and each is made executable', async ({ assert, log }) => {
  const text = aRun()
  for (const cmd of ['okc-artifact', 'okc-say', 'okc-watch']) {
    assert.ok(text.includes(`/${cmd} <<'`), `a run does not write ${cmd}`)
    assert.ok(new RegExp(`chmod \\+x \\S+/${cmd}`).test(text), `${cmd} is written and never made executable, so calling it fails on the machine`)
  }
  log('okc-artifact, okc-say, okc-watch')
})

it('and none of them carries a credential', async ({ assert }) => {
  const text = aRun()
  // THE RULE THIS APP IS BUILT TO, and it was broken once: the first version of
  // dispatch passed a credential as an environment assignment on the command
  // that starts the run, which the agent inherits and can print. What these use
  // is the MACHINE'S OWN token, read from the agent's env file at the moment of
  // the call — the same one git already replays on every push.
  assert.ok(!/ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH|sk-ant-/.test(text),
    'a credential reached the run script, where the agent can read it out of its own environment')
  // Each of the two that talk to this host authenticates as the machine.
  for (const cmd of ['okc-artifact', 'okc-say']) {
    const at = text.indexOf(`/${cmd} <<'`)
    const body = text.slice(at, text.indexOf('EOF', at) + 400)
    assert.ok(/OKC_VM.*OKC_TOKEN|OKC_TOKEN/.test(body), `${cmd} does not authenticate as the machine`)
  }
})

it('and okc-say never fails the work it was describing', async ({ assert }) => {
  const text = aRun()
  const at = text.indexOf("/okc-say <<'")
  const body = text.slice(at, text.indexOf('OKC_SAY_EOF', at + 20))

  // BEST EFFORT, ALWAYS EXITS 0. A line that could not be delivered must never
  // fail the work it was describing — a worker that says what it is doing and
  // is killed for saying it is worse than a worker that says nothing.
  assert.ok(/\|\| true/.test(body), 'okc-say can fail, and a progress line is not worth failing a run over')
  assert.ok(/exit 0/.test(body), 'okc-say does not force a zero exit')
})

it('and the skill is fetched per run, not installed once', async ({ assert, log }) => {
  const text = aRun()
  assert.ok(/skills\/working-here/.test(text), 'a worker is given no skill, so everything it needs to know has to be in every brief')
  assert.ok(/provision\/runner-skill\.md/.test(text), 'nothing fetches the runner skill from this host')
  // Best effort, for the same reason as above: a worker with no skill is a
  // worker that has to be told everything in its brief, which is where this
  // project started and is survivable. Losing the run is not.
  assert.ok(/runner-skill\.md[^\n]*\|\| true/.test(text), 'a failed skill fetch kills the run')

  // AND THE SKILL SAYS THE TWO THINGS A WORKER CANNOT DISCOVER FOR ITSELF.
  const skill = fs.readFileSync(path.join(__dirname, '../../../provision/runner-skill.md'), 'utf8')
  assert.ok(/branch/i.test(skill) && /commit/i.test(skill),
    'the runner skill does not tell a worker that the branch is the deliverable')
  assert.ok(/roll|snapshot|does not survive|dies with/i.test(skill),
    'the runner skill does not tell a worker that the machine is rolled back underneath it — which is how work is lost')
  log(`${skill.split('\n').length} lines of skill`)
})
