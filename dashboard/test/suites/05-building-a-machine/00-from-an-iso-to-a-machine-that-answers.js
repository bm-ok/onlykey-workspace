'use strict'

// building a machine — from an ISO to something that answers
//
// The beginning of everything else, and the one thing no other drill can stand
// in for: a machine defined from nothing, installed unattended, provisioned by
// the scripts this host serves, and dialling back in to say it is up.
//
// HALF AN HOUR, AND IT HOLDS THE HOST. So it is off unless asked for —
// `suiteRun --slow true`. Run all reports it as "could not be tried" and says
// how to run it, which is the honest answer rather than a half-hour nobody
// asked for.
//
// WRITTEN AFTER DOING IT BY HAND, on the day the server ISO arrived: a desktop
// image and a server image are installed by completely different machinery —
// preseed for one, subiquity autoinstall for the other — and VirtualBox hides
// that behind the same command. What it does NOT hide is that the post-install
// command runs in a different place: `curtin in-target` for server, so the
// bootstrap lands inside the installed system rather than in the installer's
// own filesystem. That is the kind of thing that works or does not, twenty-five
// minutes in, and is the reason this exists.

const { it, cleanup } = require('../../../tasks/harness')

// Named so it can be found and removed by anybody reading the machine list, and
// so `drillSweep` knows it is not somebody's real runner.
const NAME = `drill-vm-${new Date().toISOString().replace(/[^0-9]/g, '').slice(8, 14)}`

it('there is an ISO to install from, and this was asked for', async ({ okc, assert, slow, state }) => {
  assert.needs(slow, 'this builds a machine from nothing — about half an hour, and nothing else on this host may come up while it runs. Ask for it with: suiteRun --suite "building a machine" --slow true')

  const { isos } = await okc('vmIsos')
  const found = (isos || []).find(i => /ubuntu.*(server|desktop).*\.iso$/i.test(i.location || i.name || ''))
  assert.needs(found, 'VirtualBox knows about no Ubuntu ISO, so there is nothing to install from')
  state.iso = found.location

  const { vms } = await okc('vmList')
  assert.ok(!vms.some(v => v.name === NAME), `"${NAME}" already exists, which should be impossible — it is named after the minute it was made`)
})

it('a machine is defined, and it is only defined', async ({ okc, assert, state }) => {
  // Making a machine and installing one are separate acts on purpose: the first
  // is instant and reversible, the second is half an hour. A machine that exists
  // and has never been installed is a real state this app reports, and this is
  // the check that says so.
  const made = await okc('vmCreate', {
    vm: {
      name: NAME,
      iso: state.iso,
      // Smaller than a runner. This one is built to be proved and thrown away,
      // and every megabyte is a megabyte of somebody's host.
      memoryMB: 4096,
      cpus: 3,
      diskMB: 40960,
      vramMB: 16,
      installAdditions: false,
      description: 'made by a drill, and removed by it'
    }
  })
  state.made = true
  assert.equal(made.name, NAME, 'The machine was made under a different name')
  assert.ok(!made.baseSnapshot, 'A machine that has never been installed cannot have a clean point to come back to')

  const { vms } = await okc('vmList')
  const mine = vms.find(v => v.name === NAME)
  assert.ok(mine, 'It was made and is not in the list')
  assert.notEqual(mine.stage, 'ready', 'A machine that has not been installed is not ready')
})

it('the install runs unattended, and the machine dials in', async ({ okc, assert, state }) => {
  // THE WHOLE POINT, and everything that can be wrong is wrong here: the ISO,
  // the answer file VirtualBox generates for it, where the post-install command
  // runs, whether the guest can reach this host, whether it trusts this host's
  // certificate, and whether the scripts it fetches still work.
  //
  // Nothing else may come up while this runs — the gate refuses it by name —
  // and the dashboard must not be restarted, because the machine fetches its
  // setup from here at the very end.
  await okc('vmInstall', { name: NAME })

  // Not "started". Dialled in: booted, provisioned, and holding a channel back
  // to this host, which is the only definition anything else in this app uses.
  await okc('vmAwait', { name: NAME, for: 'connected', seconds: 2400 })

  const { agents } = await okc('vmAgents')
  const said = agents.find(a => a.vm === NAME)
  assert.ok(said, `"${NAME}" installed and never dialled in`)
  assert.ok(said.facts && said.facts.system, 'It dialled in without saying what it is')
}, { minutes: 45 })

it('and it is a machine this app can use', async ({ okc, assert, state }) => {
  // Installed is not usable. The queue needs a machine that answers commands and
  // has a clean point to be returned to; without the second one it is correctly
  // never picked up, which looks exactly like a queue that has gone quiet.
  const said = await okc('vmRun', { name: NAME, command: 'echo okc-built-and-answering', what: 'a drill asking a new machine for a reply' })
  assert.equal(said.code, 0, `The new machine could not run a command: ${JSON.stringify(said).slice(0, 200)}`)
  assert.ok(String(said.output || '').includes('okc-built-and-answering'), 'It ran the command and said something else')

  const { vms } = await okc('vmList')
  const mine = vms.find(v => v.name === NAME)
  assert.equal(mine.stage, 'ready', `It finished installing and reports "${mine.stage}"`)
  assert.ok(mine.baseSnapshot, 'It has no base snapshot, so nothing could ever put it away clean')
}, { minutes: 10 })

it('and it can be thrown away completely', async ({ okc, assert }) => {
  // The other half of building one. A machine this app made is a machine it can
  // destroy — disks and all — and a drill that leaves a 40 GB disk image behind
  // is the most expensive debris in this project.
  const gone = await okc('vmRemove', { name: NAME })
  assert.ok(gone, 'Nothing was reported about removing it')

  const { vms } = await okc('vmList')
  assert.ok(!vms.some(v => v.name === NAME), 'It was removed and is still in the list')
}, { minutes: 10 })

cleanup(async ({ okc, state }) => {
  // Only if the series did not get as far as removing it itself. A half-finished
  // install leaves a machine that never dialled in, which nothing else here will
  // ever tidy up.
  if (!state.made) return
  const { vms } = await okc('vmList').catch(() => ({ vms: [] }))
  if (!vms.some(v => v.name === NAME)) return
  await okc('vmRemove', { name: NAME }).catch(() => {})
})
