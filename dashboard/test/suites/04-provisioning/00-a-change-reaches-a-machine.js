'use strict'

// provisioning — a change here is what a machine gets
//
// The scripts are FETCHED, not baked in: a machine asks this host for
// `first-boot.sh` while it is being installed, and for any stage again
// afterwards, over the same authenticated endpoint. So an edit here is how a
// machine changes — and if that path is broken, the failure is a
// twenty-five-minute install that quietly used last week's script.
//
// This drill was written the day a console block was added to first-boot.sh, to
// answer the question that change raised: does what I just edited actually reach
// a machine, and can I tell without reinstalling one?
//
// THE FIRST TWO CHECKS COST NOTHING and are worth having on their own. The third
// borrows a machine and asks it to fetch the same script with its own
// credentials, which is the only way to prove the endpoint works for the caller
// that matters — this host asking itself proves nothing about a guest's token.

const { it, cleanup } = require('../../../tasks/harness')
const fs = require('node:fs')
const path = require('node:path')

// Read from the repository rather than from the app, because the whole claim is
// that these two agree.
const ON_DISK = path.join(__dirname, '..', '..', '..', 'provision', 'first-boot.sh')

// WHAT IT SAW LAST TIME is recorded at the bottom of this file.

it('the app serves the script that is on disk', async ({ okc, assert, state, log }) => {
  const { vms } = await okc('vmList')
  assert.needs(vms && vms.length, 'this host has no machines, and a script is rendered for a named one')
  state.vm = vms[0].name

  const served = await okc('vmScript', { name: state.vm, stage: 'firstBoot' })
  state.served = served.script
  const here = fs.readFileSync(ON_DISK, 'utf8')

  // The file is the tail of what is served: the app prepends a header of OKC_*
  // values and the say/report helpers, which is why a script can use them
  // without defining them. Anything else served is a script from somewhere else.
  assert.ok(state.served.includes(here.trim().split('\n').slice(1).join('\n').slice(0, 400)),
    'What the app serves is not the file in provision/ — an edit here would not reach a machine')
  log(`rendered for ${state.vm}: ${state.served.split('\n').length} lines served, and provision/first-boot.sh is ${here.split('\n').length} lines on disk`)
})

it('and the header it promises is on the front of it', async ({ assert, state, log }) => {
  // Every script is written as though OKC_USER, say and report already exist.
  // They exist because of this header, and a script that lost it fails on its
  // first line, twenty-five minutes into an install.
  for (const needed of ['OKC_USER', 'OKC_VM', 'say ', 'report ']) {
    assert.ok(state.served.includes(needed),
      `The served script does not carry ${needed}, which every provisioning script is written to assume`)
  }
  log(`the header carries OKC_USER, OKC_VM, say and report — so a script may use them without defining them`)
})

it('and the change made to it is in there', async ({ assert, state, log }) => {
  // The specific edit that prompted this drill. Not a general rule — a named
  // change, checked to be in what a machine would receive, which is what
  // somebody actually wants to know after editing a script.
  assert.ok(state.served.includes('99-okc-console.cfg'),
    'The console drop-in added to first-boot.sh is not in what a machine would be handed')
  assert.ok(state.served.includes('console=ttyS0,115200n8'),
    'The kernel command line that sends the guest console to the host is not in the served script')
  log('the console drop-in (99-okc-console.cfg) and console=ttyS0,115200n8 are both in what a machine would be handed')
})

it('and a live machine fetching it gets the same thing', async ({ okc, assert, state, log }) => {
  // THE ONLY CHECK THAT PROVES THE ENDPOINT. Everything above is this host
  // asking itself; a guest fetches over TLS, with its own name and token, from
  // an address it was told at install time. Any of those can be wrong while the
  // three checks above pass.
  const { vms } = await okc('vmList')
  const free = vms.find(v => v.stage === 'ready' && v.state !== 'running' && !v.branch && !v.borrowed && v.forTasks !== false)
  assert.needs(free, 'no machine is free to ask, so the fetch cannot be proved from the side that matters')

  await okc('vmBorrow', { name: free.name, why: 'a drill proving a machine fetches what this host serves' })
  state.machine = free.name
  await okc('vmAwait', { name: state.machine, for: 'connected', seconds: 300 })

  // Its own credentials, from its own environment — never written into the
  // command, which would send a machine its own secret back over the channel.
  // THE ADDRESS COMES FROM THE HEADER, because the guest cannot build it.
  //
  // A dispatched command inherits OKC_VM, OKC_TOKEN, OKC_CA and OKC_HOST — and
  // OKC_HOST is the bare address, with the port kept separately. So `$OKC_HOST`
  // alone means port 443, and this drill sat there for 135 seconds finding that
  // out. The one place the whole base URL exists is the header the app prepends
  // to a script, which is exactly what an install uses, so it is read from
  // there.
  const base = (String(state.served).match(/OKC_BASE='([^']+)'/) || [])[1]
  assert.ok(base, 'The served script carries no OKC_BASE, so nothing tells a machine where to fetch from')

  const said = await okc('vmRun', {
    name: state.machine,
    // Counted in the guest and printed as one number, so what comes back is the
    // ANSWER rather than the script. An assertion written against the whole
    // reply would have matched the command echoed back in it — which is what the
    // first version of this did, and it passed while the fetch was broken.
    command: `curl -fsS --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" "${base}/provision/first-boot.sh?vm=$OKC_VM" | grep -c okc-console || echo NONE`,
    what: 'a drill fetching the first-boot script the way an install does'
  })
  assert.equal(said.code, 0, `The machine could not fetch the script at all: ${JSON.stringify(said).slice(0, 300)}`)

  // The last line, because the channel echoes "$ <what>" before the output.
  const answer = String(said.output || '').trim().split('\n').pop().trim()
  assert.notEqual(answer, 'NONE', 'The machine fetched first-boot.sh and the console drop-in was not in it')
  assert.ok(Number(answer) > 0,
    `The machine fetched first-boot.sh and found the change ${answer} times — expected at least one. What came back: ${JSON.stringify(said.output || '').slice(0, 300)}`)
  log(`${state.machine} fetched it from ${base} with its own token and counted the change ${answer} time(s)`)
}, { minutes: 12 })

cleanup(async ({ okc, state }) => {
  // Put away clean, which discards everything this drill did to the guest — and
  // nothing here was meant to outlive it. A provisioning change that should
  // survive a rollback needs a new base snapshot, which is the operator's act
  // and not a drill's.
  if (state.machine) await okc('vmReturn', { name: state.machine }).catch(() => {})
})

// WHAT IT SAW — 16 August 2026, 14:20, all four passed
//
//   the app serves the script that is on disk
//     rendered for runner4: 557 lines served, and provision/first-boot.sh is 465
//     lines on disk
//
//   and the header it promises is on the front of it
//     the header carries OKC_USER, OKC_VM, say and report — so a script may use
//     them without defining them
//
//   and the change made to it is in there
//     the console drop-in (99-okc-console.cfg) and console=ttyS0,115200n8 are
//     both in what a machine would be handed
//
//   and a live machine fetching it gets the same thing
//     runner4 fetched it from https://192.168.51.63:7373 with its own token and
//     counted the change 2 time(s)
//
// 557 SERVED AGAINST 465 ON DISK is the header, and seeing the two numbers is
// worth more than the assertion above them: ninety-odd lines are prepended by
// this app, which is why every script here uses OKC_USER and `say` without
// defining them. A day when those numbers are equal is a day the header stopped
// being added and every script fails on its first line, twenty-five minutes into
// an install.
//
// AND THE LAST LINE IS THE ONLY REAL PROOF. The three above it are this host
// asking itself. That one is a guest, over TLS, with its own name and token,
// against an address it was told at install time — every one of which can be
// wrong while the first three pass.
