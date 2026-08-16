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

// WHAT IT SAW LAST TIME is recorded at the bottom of this file, and it is the
// most valuable transcript here: this drill costs half an hour and holds the
// host, so the record of one run is what somebody reads INSTEAD of running it.

it('there is an ISO to install from, and this was asked for', async ({ okc, assert, slow, state, log }) => {
  assert.needs(slow, 'this builds a machine from nothing — about half an hour, and nothing else on this host may come up while it runs. Ask for it with: suiteRun --suite "building a machine" --slow true')

  // A BARE ARRAY, and this drill spent its whole life not knowing that.
  //
  // It asked for `{ isos }`, got undefined, and reported "VirtualBox knows about
  // no Ubuntu ISO" on a host with four of them — so the gate never opened and
  // the nine checks below it had never once been attempted. Nothing catches
  // this: the shape of an answer is not a name, so `npm test` cannot see it, and
  // a drill that refuses to run looks exactly like a drill that is being
  // careful.
  //
  // Tolerant of both shapes on purpose. This is a drill about the machinery, not
  // about the envelope an action returns things in, and it should keep working
  // if that is tidied up later.
  const answer = await okc('vmIsos')
  const isos = Array.isArray(answer) ? answer : (answer.isos || [])

  // THE SERVER IMAGE, WHICH IS THE ONLY ONE THIS PROJECT INSTALLS. A desktop
  // image is a different install — preseed rather than subiquity, a different
  // post-install path, gigabytes more, and a desktop nobody asked for. This host
  // has both, and matching either would have quietly built the wrong thing and
  // proved it worked.
  const found = isos.find(i => /ubuntu.*live-server.*\.iso$/i.test(i.location || i.name || ''))
  assert.needs(found, `no Ubuntu live-server ISO is known to VirtualBox, and a desktop image is a different install: ${isos.map(i => i.name).join(', ') || 'nothing at all'}`)
  state.iso = found.location

  const { vms } = await okc('vmList')
  assert.ok(!vms.some(v => v.name === NAME), `"${NAME}" already exists, which should be impossible — it is named after the minute it was made`)
  state.began = Date.now()
  log(`installing "${NAME}" from ${state.iso}`)
  // A GATE, not a step. Without this the checks below carried on when nobody
  // had asked for a slow run: they made a machine with no installer image and
  // reported it as a FAILURE, which is a red line about a drill that was never
  // meant to run. See `gate` in tasks/harness.js.
}, { gate: true })

it('a machine is defined, and it is only defined', async ({ okc, assert, state, log }) => {
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
      // NO DESKTOP, which is the default and is said here anyway. A server image
      // installs one only if asked — see provision/desktop.sh — and this machine
      // exists to prove the install works, not to be sat in front of. Saying it
      // also makes the drill state which of the two shapes it is building, since
      // that is the checkbox somebody has to decide when they make a real one.
      desktop: false,
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
  log(`defined: 4096 MB, 3 cpus, a 40 GB disk — stage "${mine.stage}", no base snapshot, nothing installed`)
})

it('its console is captured before anything boots', async ({ okc, assert, state, log }) => {
  // TURNED ON WHILE IT IS STILL OFF, which is the only time VirtualBox allows a
  // serial port to be added — and the reason this is a step of its own rather
  // than a line inside the one above. A machine that is already installing
  // cannot be given a console, so the one boot worth watching is the one it is
  // too late to watch.
  //
  // This is what makes the rest of this file possible. Until the agent dials in
  // there is no channel, no network and nothing to ask: the console is the only
  // thing the machine says for the first twenty-five minutes of its life.
  const on = await okc('vmSerial', { name: NAME, on: true })
  assert.ok(on.on, `The console of "${NAME}" is not being captured, so the install would happen unwatched`)
  state.console = on.file
  log(`its console will be written to ${on.file}`)
})

it('the installer boots and says so on the console', async ({ okc, assert, state, log }) => {
  // THE WHOLE POINT, and everything that can be wrong is wrong here: the ISO,
  // the answer file VirtualBox generates for it, where the post-install command
  // runs, whether the guest can reach this host, whether it trusts this host's
  // certificate, and whether the scripts it fetches still work.
  //
  // Nothing else may come up while this runs — the gate refuses it by name —
  // and the dashboard must not be restarted, because the machine fetches its
  // setup from here at the very end.
  //
  // `vmInstall` STARTS the installer and returns; the twenty-five minutes happen
  // inside the machine. It returns when this machine's console has said
  // something, which is the host being told the expensive minute is over — so
  // by the time it comes back there is already a kernel talking.
  await okc('vmInstall', { name: NAME })

  // THE INSTALLER'S OWN VOICE, and it is there because this project put it
  // there: the first thing in the autoinstall file's early commands writes a
  // line to /dev/ttyS0 and points the installer's journal at it. So the console
  // carries subiquity's running commentary rather than only the kernel.
  //
  // NOT "Linux version", WHICH WAS THE FIRST GUESS AND WAS WRONG. The installer
  // boots from the ISO with its kernel log going somewhere else, so the only
  // "Linux version" in a whole install is the INSTALLED system's, ten minutes
  // later. Waiting for it here passed — while measuring the wrong thing, and
  // leaving the next check to match the same line and report the handover as
  // having taken no time at all.
  const spoke = await okc('vmAwait', { name: NAME, for: 'console', find: 'installer journal follows|subiquity', seconds: 600 })
  state.installerAt = Date.now()
  log(`the installer is talking after ${Math.round((Date.now() - state.began) / 1000)}s: ${spoke.line.slice(0, 110)}`)
}, { minutes: 12 })

it('and it writes a system onto the disk', async ({ okc, assert, state, log }) => {
  // curtin is what actually installs: it partitions, unpacks the image and
  // configures the target. It is also where the post-install command runs — `in
  // target` for a server image, so the bootstrap lands inside the installed
  // system rather than in the installer's own filesystem, which is the one
  // difference between a desktop and a server install that this project had to
  // learn the hard way.
  const writing = await okc('vmAwait', { name: NAME, for: 'console', find: 'curtin', seconds: 1800 })
  log(`curtin is running ${Math.round((Date.now() - state.installerAt) / 60000)} minutes in: ${writing.line.slice(0, 110)}`)
}, { minutes: 35 })

it('and it gets far enough to hand over to what it installed', async ({ okc, assert, state, log }) => {
  // THE STEP THIS FILE EXISTS FOR, and the one nothing could see before.
  //
  // Between the two kernels is the whole install: partitioning, unpacking, the
  // packages, and the post-install command that puts the bootstrap inside the
  // installed system rather than in the installer's own filesystem. None of it
  // can be asked about — there is no agent and no network — and until the
  // console was captured the only way to know it had happened was that a machine
  // either did or did not dial in half an hour later.
  //
  // `root=UUID=` is what says which kernel is talking. The installer boots from
  // the ISO, so its command line is a casper one; the installed system boots
  // from the disk that was just written, and names the filesystem by uuid. So
  // this line arriving IS the handover, stated by the machine rather than
  // inferred from a clock.
  const booted = await okc('vmAwait', { name: NAME, for: 'console', find: 'root=UUID=', seconds: 2400 })
  state.installedAt = Date.now()
  log(`it installed and rebooted into what it installed, ${Math.round((state.installedAt - state.installerAt) / 60000)} minutes after the installer started`)
  log(`the installed kernel's command line: ${booted.line.replace(/^.*Command line: /, '').slice(0, 130)}`)
}, { minutes: 45 })

it('and provisioning runs on that first boot', async ({ okc, assert, state, log }) => {
  // THE SCRIPTS THIS HOST SERVES, running inside the machine, seen from outside
  // it. first-boot fetches them over TLS with the machine's own token and runs
  // them; toolchain is the biggest of them and says what it is doing.
  //
  // This is the step that used to be invisible. An install that reached the
  // login prompt and never dialled in could have failed here — a certificate it
  // would not trust, a script that would not run — and nothing could tell that
  // apart from a machine that never booted at all.
  const doing = await okc('vmAwait', { name: NAME, for: 'console', find: 'toolchain', seconds: 1800 })
  log(`the provisioning scripts are running on the machine: ${doing.line.slice(0, 110)}`)
}, { minutes: 35 })

it('and the first boot starts the agent that dials home', async ({ okc, assert, state, log }) => {
  // The last thing provisioning does, seen from outside the machine. first-boot
  // writes a unit and enables it; this is systemd starting it, on the console,
  // before anything has reached this host.
  //
  // Worth its own step because "it never dialled in" has two completely
  // different causes — the agent never started, or it started and could not
  // reach here — and they are hours apart to diagnose. This line tells them
  // apart in one look.
  const unit = await okc('vmAwait', { name: NAME, for: 'console', find: 'okc-agent', seconds: 1200 })
  log(`the agent unit is on the console after the first boot: ${unit.line.slice(0, 110)}`)
}, { minutes: 25 })

it('and it dials in', async ({ okc, assert, state, log }) => {
  // Not "started". Dialled in: booted, provisioned, and holding a channel back
  // to this host, which is the only definition anything else in this app uses.
  await okc('vmAwait', { name: NAME, for: 'connected', seconds: 1200 })

  const { agents } = await okc('vmAgents')
  const said = agents.find(a => a.vm === NAME)
  assert.ok(said, `"${NAME}" installed and never dialled in`)
  assert.ok(said.facts && said.facts.system, 'It dialled in without saying what it is')
  log(`installed unattended and dialled in ${Math.round((Date.now() - state.began) / 60000)} minutes after it was asked for`)
  log(`it says it is: ${String(said.facts.system).split('\n')[0]}`)
}, { minutes: 25 })

it('and the install is on the record afterwards', async ({ okc, assert, state, log }) => {
  // WHAT THE CONSOLE IS FOR WHEN NOTHING IS WATCHING IT. The checks above waited
  // for each line as it arrived, which only helps somebody sitting here while it
  // happens. This is the same evidence read back cold, which is the ordinary
  // case: a machine was built overnight and the question in the morning is what
  // it did.
  //
  // BOTH FILES, because it depends on how the installer handed over. A guest
  // reboot keeps the same VirtualBox session and the console file simply carries
  // on; a power cycle starts a new one and truncates it — and this app keeps one
  // generation aside for exactly that, so the installer's own boot is either
  // still at the top of this file or is the whole of the previous one.
  const both = []
  for (const which of ['serial', 'serial.previous']) {
    try {
      const got = await okc('vmLog', { name: NAME, which, lines: 5000 })
      both.push({ which, lines: got.lines, of: got.of })
    } catch { /* there may be no previous boot, which is one of the two shapes */ }
  }
  assert.ok(both.length, 'The console of the install was not written down anywhere')

  const count = pattern => both.reduce((n, f) => n + f.lines.filter(l => new RegExp(pattern, 'i').test(l)).length, 0)

  // WORDS THAT ONLY AN INSTALL SAYS. The first version of this accepted `initrd`
  // as evidence that an installer had run — and every ordinary boot mentions an
  // initrd, so it would have passed on a machine that was merely switched on.
  // The bar for "this is evidence" is a word that cannot appear unless the thing
  // being claimed actually happened.
  const seen = {
    'the installer ran': count('subiquity|casper'),
    'it wrote the system to disk': count('curtin'),
    'it booted what it installed': count('root=UUID='),
    'provisioning ran': count('toolchain'),
    'the agent started': count('okc-agent')
  }
  for (const [what, n] of Object.entries(seen)) {
    assert.ok(n > 0, `The console holds no evidence that ${what} — so that step is unaccounted for, and this is the only account there is`)
  }

  log(`kept: ${both.map(f => `${f.which} (${f.of} lines)`).join(', ')}`)
  for (const [what, n] of Object.entries(seen)) log(`  ${String(n).padStart(4)} line(s) — ${what}`)
}, { minutes: 5 })

it('and it is a machine this app can use', async ({ okc, assert, state, log }) => {
  // Installed is not usable. The queue needs a machine that answers commands and
  // has a clean point to be returned to; without the second one it is correctly
  // never picked up, which looks exactly like a queue that has gone quiet.
  const said = await okc('vmRun', { name: NAME, command: 'echo okc-built-and-answering', what: 'a drill asking a new machine for a reply' })
  assert.equal(said.code, 0, `The new machine could not run a command: ${JSON.stringify(said).slice(0, 200)}`)
  assert.ok(String(said.output || '').includes('okc-built-and-answering'), 'It ran the command and said something else')

  // THE SNAPSHOT IS TAKEN WHEN IT FIRST DIALS IN, not when the install ends, so
  // there is a window where a machine is answering and has nothing to be put
  // back to. Waited for rather than demanded in the same breath — the same
  // mistake the task round trip made about a machine claiming its branch.
  let mine = null
  for (let i = 0; i < 60; i++) {
    const { vms } = await okc('vmList')
    mine = vms.find(v => v.name === NAME)
    if (mine && mine.baseSnapshot) break
    await new Promise(r => setTimeout(r, 5000))
  }
  assert.ok(mine && mine.baseSnapshot, 'It has no base snapshot five minutes after dialling in, so nothing could ever put it away clean and the queue would pass over it for ever')

  // NOT "ready", WHICH IS WHAT THIS ASKED FOR AND IS WRONG ABOUT THIS APP.
  //
  // The stages are a ladder — defined, created, installing, online, ready,
  // connected — and the highest true one is reported. A machine that is dialled
  // in says "connected" and will never say "ready" while it is; "ready" is what
  // it says once it is off with a snapshot to come back to. So the first version
  // failed a perfectly good machine with `It finished installing and reports
  // "connected"`, which is the drill misreading the app rather than a fault.
  assert.equal(mine.stage, 'connected', `It is dialled in and reports "${mine.stage}"`)
  log(`it answers commands, is stage "${mine.stage}", and has a base snapshot ("${mine.baseSnapshot}") to be put away to`)
}, { minutes: 10 })

it('and it can be thrown away completely', async ({ okc, assert, log }) => {
  // The other half of building one. A machine this app made is a machine it can
  // destroy — disks and all — and a drill that leaves a 40 GB disk image behind
  // is the most expensive debris in this project.
  const gone = await okc('vmRemove', { name: NAME })
  assert.ok(gone, 'Nothing was reported about removing it')

  const { vms } = await okc('vmList')
  assert.ok(!vms.some(v => v.name === NAME), 'It was removed and is still in the list')
  log(`"${NAME}" is gone, disks and all`)
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
