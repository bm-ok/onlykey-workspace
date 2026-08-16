'use strict'

// the machines are built — two of them, from an ISO, and they stay
//
// THE WARMING STAGE. Everything below this suite needs machines: a task has to
// go somewhere, provisioning has to be fetched by something, and half the guards
// only mean anything against a machine that is working. This is where those come
// from, and it is deliberately not "borrow the operator's runners" — a kit that
// only works on a host that already has runners is not a kit, it is a habit.
//
// IT IS ALSO STILL THE TEST OF BUILDING ONE. Nothing is faked to warm the host:
// the machines are made from nothing, installed unattended from the server
// image, provisioned by the scripts this host serves, and watched doing it on
// the serial console. Warming and proving are the same act here, which is the
// point of the whole reshape — the tests set the app up the way a person does,
// and check it as they go.
//
// TWO, AND AT THE SAME TIME. Two because one machine cannot show "this branch is
// already being worked on by another machine", and the queue with one machine is
// a queue that never has to choose. At the same time because that is the
// interesting case — two installs competing for disk and cores — and because
// twice ten minutes is twenty and once is ten.
//
// STABLE NAMES, which is what makes this stage idempotent. `kit-1` and `kit-2`
// are always the same two machines, so "are they built?" is a question about the
// WORLD rather than about a note somebody wrote — and a note can be perfectly
// true about a machine that was deleted by hand this morning. On a warm host
// this suite passes in seconds having built nothing, because the claim it makes
// is "two machines are built and ready", not "I built two machines".
//
// AND THEY STAY. Nothing here removes them. Taking them away is the cooling
// suite, asked for on purpose, and doing it marks this suite dirty again — see
// `invalidates` there.

const { it, keep, requires } = require('../../../tasks/harness')

// Nothing else in this project writes a machine called kit-*, the same idea as
// `drill/` on a branch: a name that says who made it, so removing one needs no
// judgement call and the operator's own runners are never in question.
const OURS = ['kit-1', 'kit-2']

// It stands on nothing. This is the ground the machine half of the kit is built
// on, and it is the suite that has to work on a host with nothing on it.
requires()

// Ten minutes of installing sits in the middle of this. A restart during it
// would otherwise mean building again from the top; with a note, the checks that
// passed are carried and it picks up at the step it had reached.
keep()

const ready = vm => vm && vm.stage !== 'defined' && vm.stage !== 'created' && vm.stage !== 'installing' && !!vm.baseSnapshot

// WHAT IS STILL MISSING, ASKED EVERY TIME RATHER THAN REMEMBERED.
//
// This file keeps its state so it can survive a restart mid-install, and that
// turned out to be a trap: a CARRIED check does not run, so the code that works
// out what is missing does not run either, and the series resumes holding an
// answer from before anything was built. It happened exactly that way — the
// first check was carried, `missing` still said both machines were
// missing, and two checks sat waiting for machines that were already built and
// correctly powered off.
//
// So what is missing is a question about the world, asked wherever it matters.
// The note keeps what the world cannot say — that this run built them, and how
// long it took — and nothing else.
async function whatIsMissing (okc) {
  const { vms } = await okc('vmList')
  return OURS.filter(name => !ready(vms.find(v => v.name === name)))
}

it('there are two machines to work with, or an ISO and permission to build them', async ({ okc, assert, slow, state, log }) => {
  const { vms } = await okc('vmList')
  const have = OURS.filter(name => ready(vms.find(v => v.name === name)))
  const missing = OURS.filter(n => !have.includes(n))

  if (!missing.length) {
    // ALREADY TRUE, so there is nothing to do and this is still a pass. The
    // claim is that two machines are built and ready, not that this run built
    // them — and asking the world is the only way to know, because the machines
    // may have been removed by hand since anything was written down.
    log(`${have.join(' and ')} are already built and ready — nothing to do`)
    return
  }

  assert.needs(slow, `${missing.join(' and ')} would have to be built, which is minutes and holds this host while it happens. Ask for it with: suiteRun --suite "the machines are built" --slow true`)

  const answer = await okc('vmIsos')
  const isos = Array.isArray(answer) ? answer : (answer.isos || [])
  const found = isos.find(i => /ubuntu.*live-server.*\.iso$/i.test(i.location || i.name || ''))
  assert.asksYou(found, `no Ubuntu live-server ISO is known to VirtualBox, so there is nothing to install from. Download one — https://releases.ubuntu.com — and either add it to a machine in VirtualBox once or leave it in Downloads, then run this again. What is here: ${isos.map(i => i.name).join(', ') || 'nothing at all'}`)
  state.iso = found.location
  state.began = state.began || Date.now()
  log(`${missing.join(' and ')} will be built from ${found.name || state.iso}`)
}, { gate: true })

it('they are defined, with their consoles captured before anything boots', async ({ okc, assert, state, log }) => {
  const missing = await whatIsMissing(okc)
  if (!missing.length) { log('both already exist'); return }

  for (const name of missing) {
    await okc('vmCreate', {
      vm: {
        name,
        iso: state.iso,
        // Smaller than a hand-made runner. These exist to be proved against and
        // rebuilt, and every megabyte is a megabyte of somebody's host.
        memoryMB: 4096,
        cpus: 3,
        diskMB: 40960,
        vramMB: 16,
        installAdditions: false,
        // The server image installs no desktop unless asked. Said rather than
        // left to the default, because it is the choice a person makes when they
        // make a real one.
        desktop: false,
        description: 'built by the test kit, and removed by it'
      }
    })
    // TURNED ON WHILE IT IS STILL OFF, which is the only time VirtualBox allows
    // a serial port to be added — so the one boot worth watching is the one it
    // would be too late to ask about.
    const on = await okc('vmSerial', { name, on: true })
    assert.ok(on.on, `the console of "${name}" is not being captured, so its install would happen unwatched`)
    log(`${name}: defined, 4096 MB, 3 cpus, 40 GB, console to ${on.file}`)
  }
})

it('and both installers run at the same time', async ({ okc, assert, state, log }) => {
  const missing = await whatIsMissing(okc)
  if (!missing.length) { log('nothing to install'); return }

  // STARTED TOGETHER, and this is the case worth having. `vmInstall` starts an
  // installer and returns once that machine's console has spoken — which is the
  // host saying the expensive first minute is over — so starting the second one
  // straight after is exactly the staggering this app was built to do rather
  // than a race nobody meant.
  for (const name of missing) await okc('vmInstall', { name })

  for (const name of missing) {
    const spoke = await okc('vmAwait', { name, for: 'console', find: 'installer journal follows|subiquity', seconds: 900 })
    log(`${name}: the installer is talking — ${spoke.line.slice(0, 90)}`)
  }
}, { minutes: 20 })

it('and both write a system to disk and boot it', async ({ okc, assert, state, log }) => {
  const missing = await whatIsMissing(okc)
  if (!missing.length) { log('nothing to install'); return }

  for (const name of missing) {
    await okc('vmAwait', { name, for: 'console', find: 'curtin', seconds: 2400 })
    log(`${name}: curtin is writing the system to disk`)
  }
  // THE FIRST THING THE INSTALLED SYSTEM SAYS, which is this project's own
  // first-boot script and not the kernel.
  //
  // `root=UUID=` was the obvious marker and it is WRONG HERE, which only running
  // it showed. The kernel's command line reaches the serial port because
  // first-boot writes a grub drop-in — and that drop-in applies from the NEXT
  // boot, which first-boot.sh says in as many words where it writes it. So on
  // the boot being waited for, the kernel is silent on this wire and the only
  // thing talking is the script. Waiting for the kernel line here waits for a
  // reboot that has not been asked for.
  //
  // Two machines were most of the way through provisioning, with 4325 lines of
  // console each and zero matches, before that was obvious.
  for (const name of missing) {
    const booted = await okc('vmAwait', { name, for: 'console', find: 'first boot: making the machine reachable', seconds: 2400 })
    log(`${name}: booted what it installed — ${booted.line.slice(0, 90)}`)
  }
}, { minutes: 50 })

it('and provisioning runs on both, from the scripts this host serves', async ({ okc, assert, state, log }) => {
  const missing = await whatIsMissing(okc)
  if (!missing.length) { log('nothing to provision'); return }

  for (const name of missing) {
    const doing = await okc('vmAwait', { name, for: 'console', find: 'toolchain', seconds: 1800 })
    log(`${name}: ${doing.line.slice(0, 90)}`)
  }
}, { minutes: 35 })

it('and both dial in, if they were just built', async ({ okc, assert, state, log }) => {
  // ONLY WHAT WAS BUILT, and this check spent its first run proving why.
  //
  // On a warm host both machines are POWERED OFF, because that is the resting
  // state this whole app is built around — off, on their base snapshot, claiming
  // nothing. Waiting for them to dial in there is waiting for something that
  // will never happen unless somebody starts them, and the first version did
  // exactly that: on a host where the machines were already built and at rest it
  // sat for the full thirty-five minutes it had been given.
  //
  // Being at rest IS ready. So the machines just built are watched dialling in,
  // and the ones that were already here are read from the register instead.
  const missing = await whatIsMissing(okc)
  if (!missing.length) { log('both were already here — a machine at rest does not dial in until something asks it to'); return }

  for (const name of missing) {
    await okc('vmAwait', { name, for: 'connected', seconds: 1800 })
  }
  const { agents } = await okc('vmAgents')
  for (const name of missing) {
    assert.ok(agents.some(a => a.vm === name), `"${name}" was built and never dialled in`)
  }
  if (state.began) log(`${missing.join(' and ')} dialled in ${Math.round((Date.now() - state.began) / 60000)} minutes after this started`)
}, { minutes: 35 })

it('and both answer, with somewhere to be put back to', async ({ okc, assert, state, log }) => {
  // INSTALLED IS NOT USABLE. The queue needs a machine that answers and has a
  // clean point to be returned to; without the second one it is correctly never
  // picked up, which looks exactly like a queue that has gone quiet.
  //
  // ASKED OF WHATEVER IS UP, which is the precise question and not a proxy for
  // it. Written first as "the ones this run built", then as "the ones still
  // missing" — and both are wrong in the same way: a machine stops being missing
  // the moment its snapshot lands, so whether this check tried anything depended
  // on which side of that instant it ran. What it actually needs is a machine
  // that is CONNECTED, because that is the only kind that can answer.
  //
  // On a warm host nothing is up, and that is not a gap: a machine at rest
  // answers nothing by design, and the register below is what the queue itself
  // reads before picking one.
  const { vms: live } = await okc('vmList')
  const up = OURS.filter(name => (live.find(v => v.name === name) || {}).connected)
  if (!up.length) log('neither is up — a machine at rest answers nothing, which is the state they are meant to be in')

  for (const name of up) {
    const said = await okc('vmRun', { name, command: 'echo okc-kit-ready', what: 'the kit asking a machine for a reply' })
    assert.equal(said.code, 0, `"${name}" could not run a command: ${JSON.stringify(said).slice(0, 200)}`)
    assert.ok(String(said.output || '').includes('okc-kit-ready'), `"${name}" ran the command and said something else`)
    log(`${name}: answers`)
  }

  // The snapshot is taken when a machine first dials in, so on a run that built
  // something there is a window where it answers and has nothing to come back
  // to. Waited for rather than demanded in the same breath.
  let settled = []
  for (let i = 0; i < 60; i++) {
    const { vms } = await okc('vmList')
    settled = OURS.map(name => vms.find(v => v.name === name)).filter(v => v && v.baseSnapshot)
    if (settled.length === OURS.length) break
    await new Promise(r => setTimeout(r, 5000))
  }
  assert.equal(settled.length, OURS.length, `${OURS.filter(n => !settled.some(v => v.name === n)).join(', ')} has no base snapshot, so nothing could ever put it away clean and the queue would pass over it for ever`)
  for (const vm of settled) log(`${vm.name}: stage "${vm.stage}", ${vm.state}, base snapshot "${vm.baseSnapshot}"`)
  state.built = true
}, { minutes: 12 })

it('and the install of each is on the record', async ({ okc, assert, state, log }) => {
  // WHAT THE CONSOLE IS FOR WHEN NOBODY IS WATCHING IT. The checks above waited
  // for each line as it arrived, which helps somebody sitting here. This is the
  // same evidence read back cold, which is the ordinary case: the machines were
  // built at some point and the question now is what they did.
  //
  // Words that only an install says. An earlier version of this accepted
  // "initrd" as evidence an installer had run — every ordinary boot mentions an
  // initrd, so it would have passed on a machine that was merely switched on.
  for (const name of OURS) {
    const files = []
    for (const which of ['serial', 'serial.previous']) {
      try {
        const got = await okc('vmLog', { name, which, lines: 5000 })
        files.push({ which, lines: got.lines, of: got.of })
      } catch { /* there may be no earlier boot, which is one of the two shapes */ }
    }
    if (!files.length) {
      log(`${name}: nothing on its console — it was built before its console was captured`)
      continue
    }
    const count = p => files.reduce((n, f) => n + f.lines.filter(l => new RegExp(p, 'i').test(l)).length, 0)
    const seen = {
      'the installer ran': count('subiquity|casper'),
      'it wrote the system to disk': count('curtin'),
      'it booted what it installed': count('first boot: making the machine reachable'),
      'provisioning ran': count('toolchain')
    }
    log(`${name}: ${files.map(f => `${f.which} ${f.of} lines`).join(', ')} — ${Object.entries(seen).map(([k, n]) => `${n} ${k}`).join(', ')}`)
  }
}, { minutes: 5 })
