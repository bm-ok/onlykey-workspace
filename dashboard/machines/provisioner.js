'use strict'

// Making a virtual machine, and getting an operating system onto it.
//
// Generic: the spec is data. There is no notion of what the machine is FOR --
// no roles, no device identities, no assumed toolchain. USB passthrough and
// shared folders are supported because VirtualBox supports them, and are declared
// per VM rather than decided here.
//
// Several details below look arbitrary and are not. They are marked, because each
// one cost a failed 25-minute install to find.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const log = require('../core/log')
const vbox = require('./vbox')
const vms = require('./vms')
const channel = require('./channel')
const keys = require('../core/keys')
// Where this host keeps what it writes. Used for the serial console an install
// turns on — see install().
const data = require('../core/data')
// The one tag with a meaning, taken from the registry rather than spelled again
// here. See vms.js.
const { SUPERVISOR, POOL } = vms

// What a VM is, with everything optional filled in. One place, so a spec read
// back later means the same thing as when it was made.
function fill (input = {}) {
  const name = String(input.name || '').trim()
  if (!/^[\w.-]+$/.test(name)) {
    throw new Error('Give it a name using letters, numbers, dots or dashes — no spaces.')
  }
  // These defaults are the previous version's, which were arrived at by actually
  // running the thing rather than guessed: 8 GB and 4 cpus because a build in a
  // 2-cpu guest is miserable, 60 GB because a toolchain plus sources outgrows 30,
  // and a named LTS ostype because "Ubuntu_64" makes VirtualBox pick worse
  // defaults for the unattended installer.
  return {
    name,
    ostype: input.ostype || 'Ubuntu24_LTS_64',
    cpus: Number(input.cpus) || 4,
    memoryMB: Number(input.memoryMB) || 8192,
    vramMB: Number(input.vramMB) || 128,
    diskMB: Number(input.diskMB) || 61440,
    iso: input.iso || '',
    // WHETHER THIS ONE IS MEANT TO HAVE A SCREEN, and it is decided here or
    // never. A desktop is not decoration: a task with no job leaves its machine
    // running at a desktop for whoever wrote it, and the Runners tab says
    // "anything needing a screen will work" — so this cannot simply be dropped.
    //
    // But a runner that only ever holds a terminal pays for a display manager,
    // a session and a compositor it never shows anybody: a gigabyte of memory
    // and most of the boot. Two machines coming up at once is what wedges this
    // host, and most of what they are competing over is a desktop nobody is
    // looking at.
    //
    // OFF UNLESS ASKED FOR, because every machine is installed from the SERVER
    // image and a desktop is something ADDED — see provision/desktop.sh. That is
    // the way round it has to be: a machine born with a desktop has to have it
    // stripped out to be lean, and stripping is never as complete as never
    // installing.
    //
    // READ ONLY AFTERWARDS. Nothing on the action surface changes it: what a
    // machine was built to be is a fact about that build, and flipping the flag
    // later would say "desktop" about a machine that has no X on it at all.
    desktop: input.desktop === true || input.desktop === 'true',
    // WHAT THIS MACHINE IS FOR, and it is the one kind that is not a runner.
    //
    // A supervisor machine runs Claude Code and nothing else: it decides what
    // work to give and asks this dashboard for it. It never takes a task itself,
    // it clones no repositories, and it gets none of the project's provisioning —
    // see SUPERVISOR in tasks/queue.js and OKC_SUPERVISOR in provision/.
    //
    // DECIDED HERE OR NEVER, like `desktop` above and for the same reason: it
    // changes what gets installed at first boot, so flipping it afterwards would
    // say "supervisor" about a machine built as a runner. It also carries a tag
    // that cannot be taken off by hand — vmTags refuses — because the tag is what
    // keeps it out of the pool, and a tag somebody can remove is not a guarantee.
    supervisor: input.supervisor === true || input.supervisor === 'true',
    // WHAT KIND OF MACHINE THIS IS, and unlike `desktop` above it can be
    // changed whenever you like — see vmTags. It is asked for here because the
    // moment somebody is making a machine is the moment they know what it is
    // for, and a field asked six weeks later is one nobody goes back to fill in.
    //
    // Accepted as a list or as one comma-separated string, because the window
    // sends a typed line and a script sends an array, and neither should have to
    // know what the other does.
    //
    // A supervisor carries its tag whatever else was typed, because the tag is
    // what the queue reads — see tasks/queue.js. Written in here rather than
    // checked in three places later: the tag and the flag cannot disagree if
    // there is only one moment where either is set.
    tags: (() => {
      const asked = [...new Set([
        ...(Array.isArray(input.tags) ? input.tags : String(input.tags || '').split(','))
          .map(t => String(t).trim().toLowerCase())
          .filter(Boolean),
        ...(input.supervisor === true || input.supervisor === 'true' ? [SUPERVISOR] : [])
      ])]
      // EVERY MACHINE IS IN A POOL. One that was given no kind is in the ordinary
      // one, and it says so — see POOL in vms.js. A supervisor is not: it takes
      // no work at all, so putting it in the pool work is drawn from would be a
      // name for something that can never happen.
      if (!asked.length) return [POOL]
      return asked
    })(),
    // Bridged, because a guest has to be able to reach this app to fetch its
    // setup, and on NAT it cannot see the host at all without more plumbing.
    network: input.network === 'nat' ? 'nat' : 'bridged',
    bridgeAdapter: input.bridgeAdapter || '',
    sshPort: Number(input.sshPort) || 2222,
    user: input.user || 'okc',
    password: input.password || 'okc',
    fullName: input.fullName || 'okc',
    hostname: input.hostname || `${name.replace(/[^a-z0-9-]/gi, '-')}.local`,
    locale: input.locale || 'en_US',
    timeZone: input.timeZone || 'UTC',
    // THE GUEST ADDITIONS FOLLOW THE DESKTOP, because that is what they are for.
    //
    // The kernel half is already there: Ubuntu ships vboxguest and vboxsf in its
    // own kernel, so a machine without additions still gets its display modes —
    // runner3 came up at 1280x800 with twenty-two modes offered and no additions
    // installed at all. What is missing without them is the USER-SPACE half:
    // VBoxClient, which is clipboard sharing, resizing with the window,
    // drag-and-drop and time sync.
    //
    // Every one of those is about somebody sitting in front of the machine. A
    // runner holding a terminal uses none of them, and pays for them in install
    // time and in kernel modules rebuilt on every kernel update.
    //
    // FORCED ON BY SHARED FOLDERS, whatever else was said: a share needs the
    // mount helper, and a machine that declared shares and cannot mount them is
    // a machine whose whole reason for existing quietly did not happen.
    installAdditions: typeof input.installAdditions === 'boolean'
      ? input.installAdditions
      : (input.desktop === true || input.desktop === 'true' || (Array.isArray(input.shares) && input.shares.length > 0)),
    baseSnapshot: input.baseSnapshot || 'base',
    sshKey: input.sshKey || '',
    // Its own secret, per machine, so a machine can only ever dial in as itself.
    token: input.token || channel.newToken(),
    // Declared, never assumed. An empty list means the concept does not apply.
    usb: Array.isArray(input.usb) ? input.usb : [],
    shares: Array.isArray(input.shares) ? input.shares : [],
    setup: Array.isArray(input.setup) ? input.setup : []
  }
}

// Accepts a path, or part of the name of an ISO VirtualBox already knows about --
// which is usually where they already are.
async function resolveISO (wanted) {
  if (wanted && fs.existsSync(wanted)) return wanted
  const known = await vbox.isos()
  if (!wanted) {
    if (known.length === 1) return known[0].location
    throw new Error(`Choose an installer image. VirtualBox knows about: ${known.map(i => i.name).join(', ') || 'none'}`)
  }
  const needle = wanted.toLowerCase()
  const hit = known.find(i => i.name.toLowerCase().includes(needle))
  if (hit) return hit.location
  throw new Error(`No installer image matching "${wanted}". VirtualBox knows about: ${known.map(i => i.name).join(', ') || 'none'}`)
}

// The host-only network every machine gets a second foot in, made if there is
// not one. VirtualBox serves DHCP on it, which is the whole point: a lease it
// hands out is a lease it can be asked about.
//
// Not a preference and not per machine. One network, every machine on it, so
// "which one is runner4 on" is never a question.
async function hostOnlyAdapter () {
  const have = await vbox.hostOnlyIfs()
  if (have.length) return have[0].name
  const made = await vbox.makeHostOnlyIf()
  return made
}

async function pickBridge (preferred) {
  const list = await vbox.bridges()
  if (preferred) {
    const hit = list.find(b => b.name === preferred)
    if (!hit) throw new Error(`There is no network adapter called "${preferred}".`)
    return hit.name
  }
  const up = list.filter(b => b.status === 'Up' && b.ip && !b.ip.startsWith('169.254'))
  if (!up.length) throw new Error('No network adapter is up to bridge onto. Use NAT instead, or say which adapter.')
  return up[0].name
}

// BUILDING THE THING IN VIRTUALBOX, which is not the same as making a machine.
//
// A machine here is a SPEC — a name, a size, a key, a token, a place in the
// register. What VirtualBox holds is a build of that spec, and a build is cheap
// and replaceable. Separating them is what lets an install throw the build away
// and make it again rather than reusing whatever the last one left behind.
//
// Returns what the build decided, because two of those are facts the register
// keeps: which ISO was resolved and which adapter it was bridged onto.
async function buildInVbox (spec, to) {
  const iso = spec.iso ? await resolveISO(spec.iso) : ''
  const bridge = spec.network === 'bridged' ? await pickBridge(spec.bridgeAdapter) : ''

  to.info(`creating ${spec.name}: ${spec.cpus} cpu, ${spec.memoryMB} MB, ${Math.round(spec.diskMB / 1024)} GB disk`)
  await vbox.run(['createvm', '--name', spec.name, '--ostype', spec.ostype, '--register'], { tags: [spec.name] })

  // A SECOND ADAPTER, ON A NETWORK VIRTUALBOX ITSELF SERVES, AND IT STAYS.
  //
  // The first one is how the machine reaches the world and this host. This one
  // is how this host reaches the MACHINE when the first one cannot help — and
  // the case that matters is a machine that never dials in.
  //
  // "What is this machine's address" has no answer today. VirtualBox keeps one,
  // but it is REPORTED BY THE GUEST ADDITIONS, which an installer does not have
  // and a terminal-only runner does not install. `dhcpserver findlease` knows
  // only about networks VirtualBox serves, and a bridged machine gets its lease
  // from the router. So a machine that will not come up is a machine with no
  // address, which is exactly when somebody needs one.
  //
  // On a host-only network VirtualBox IS the DHCP server, so the lease is a fact
  // it can be asked for, by MAC, with the machine off if need be. See vmAddress.
  //
  // KEPT FOR THE LIFE OF THE MACHINE rather than removed after the install: the
  // day it is wanted is a day something has gone wrong, and a diagnostic that
  // has to be added first is not there when it is needed. It also leaves a way
  // in that does not touch the network the machine works on, which is worth
  // having later for isolation.
  const hostOnly = await hostOnlyAdapter().catch(e => {
    to.warn(`no host-only network, so this machine will have no second way in: ${e.message}`)
    return null
  })

  const net = spec.network === 'bridged'
    ? ['--nic1', 'bridged', '--bridgeadapter1', bridge, '--nictype1', 'virtio']
    : ['--nic1', 'nat', '--nictype1', 'virtio']
  if (hostOnly) net.push('--nic2', 'hostonly', '--hostonlyadapter2', hostOnly, '--nictype2', 'virtio')

  await vbox.run(['modifyvm', spec.name,
    '--memory', String(spec.memoryMB),
    '--cpus', String(spec.cpus),
    '--vram', String(spec.vramMB),
    '--graphicscontroller', 'vmsvga',
    '--ioapic', 'on',
    '--rtcuseutc', 'on',
    '--audio-driver', 'none',
    '--usbxhci', 'on',
    '--clipboard-mode', 'bidirectional',
    ...net
  ], { tags: [spec.name] })

  // NAT needs a forwarded port or there is no way to ssh in at all.
  if (spec.network === 'nat') {
    await vbox.run(['modifyvm', spec.name, '--natpf1', `ssh,tcp,127.0.0.1,${spec.sshPort},,22`], { tags: [spec.name] })
  }

  // THE CONSOLE, ON EVERY MACHINE, FROM THE MOMENT IT IS BUILT.
  //
  // A serial port in raw-file mode is a wire out of the guest that needs nothing
  // running inside it: the kernel writes to ttyS0 from its first line, before the
  // network, before systemd, before there is any agent to dial home — and
  // VirtualBox copies every byte to a file here. It is the only way to watch a
  // boot that never finishes, which is the failure it was built for.
  //
  // It used to be off unless asked for, on the reasoning that a file the host
  // writes for the life of a machine is not a default anybody chose. What that
  // produced was an instrument only the drills had: every machine the test kit
  // built could be watched and every machine made at the window could not, and an
  // install ran for twelve minutes with the Terminal tab showing nothing.
  //
  // The cost is small and bounded: VirtualBox truncates the file on every start
  // and the previous boot is rolled aside, so it is two boots' worth per machine
  // rather than a growing record. The cost of not having it is a machine that
  // will not boot and no way to see why.
  //
  // Here rather than at install, because this is the one place a VirtualBox
  // machine is built — create() and the rebuild inside install() both come
  // through — so there is no second path that can be forgotten.
  const serial = path.join(data.sub('serial'), `${spec.name}.log`)
  await vbox.setSerial(spec.name, serial).catch(e => to.warn(`could not capture its console: ${e.message}`))

  const folder = path.dirname((await vbox.info(spec.name)).CfgFile || '.')
  const disk = path.join(folder, `${spec.name}.vdi`)
  await vbox.run(['createmedium', 'disk', '--filename', disk, '--size', String(spec.diskMB), '--format', 'VDI'],
    { timeout: 300000, tags: [spec.name] })

  // portcount 2: the disk on port 0 and the installer on port 1.
  await vbox.run(['storagectl', spec.name, '--name', 'SATA', '--add', 'sata',
    '--controller', 'IntelAhci', '--portcount', '2', '--bootable', 'on'], { tags: [spec.name] })
  await vbox.run(['storageattach', spec.name, '--storagectl', 'SATA', '--port', '0', '--device', '0',
    '--type', 'hdd', '--medium', disk], { tags: [spec.name] })
  if (iso) {
    await vbox.run(['storageattach', spec.name, '--storagectl', 'SATA', '--port', '1', '--device', '0',
      '--type', 'dvddrive', '--medium', iso], { tags: [spec.name] })
  }

  // Declared as data. Attached at create time rather than later, because a
  // machine that boots once without them can do the wrong thing before anyone
  // notices they are missing.
  for (const [i, f] of spec.usb.entries()) {
    if (!f.vendorId || !f.productId) continue
    await vbox.run(['usbfilter', 'add', String(i), '--target', spec.name,
      '--name', f.name || `${f.vendorId}:${f.productId}`,
      '--vendorid', f.vendorId, '--productid', f.productId], { tags: [spec.name] })
  }
  for (const share of spec.shares) {
    if (!share.name || !share.hostPath) continue
    fs.mkdirSync(share.hostPath, { recursive: true })
    await vbox.run(['sharedfolder', 'add', spec.name, '--name', share.name,
      '--hostpath', share.hostPath, ...(share.readOnly ? ['--readonly'] : []), '--auto-mount-point', ''],
    { tags: [spec.name] })
  }

  return { iso, bridge, disk, serial }
}

// ---- making the machine ----------------------------------------------

async function create (input) {
  if (!vbox.available()) throw new Error('VirtualBox is not installed, or not where this expected to find it.')
  const spec = fill(input)
  const to = log.on('vm', spec.name)

  // Checked against all of VirtualBox, not just against ours: the collision that
  // matters is with any machine on the host, including ones this app must not
  // touch.
  if (await vbox.exists(spec.name)) {
    throw new Error(`VirtualBox already has a machine called "${spec.name}". Pick another name — this app will not touch a machine it did not make.`)
  }

  const { iso, bridge, disk, serial } = await buildInVbox(spec, to)

  // `serial` among the rest: the port was attached as the machine was built, and
  // the registry has to say so or the window will not know there is a console to
  // read. Two records of one fact is how they come to disagree, so it is carried
  // out of the one place that made it.
  const vm = vms.add({ ...spec, iso, bridge, disk, serial })
  to.good(`${spec.name} created. It has no operating system yet — install one next.`)
  return vm
}

// ---- getting an operating system onto it -----------------------------

// Detach the disk, destroy it, make an empty one the same size, put it back.
//
// Three steps rather than one because VirtualBox will not delete a medium that
// is attached to a machine, and will not attach one that does not exist. The
// order is forced by that, not chosen.
async function blankTheDisk (name, spec, to) {
  // THE SNAPSHOTS GO FIRST, AND THIS IS NOT TIDINESS.
  //
  // A snapshot is a point on a DISK. Blanking the disk under it leaves a machine
  // that still lists "base" — taken an hour ago, from an operating system that
  // no longer exists — and the registry still pointing at it. The queue then
  // sees a machine with a clean point to come back to, takes it, and finds out
  // otherwise at the moment it tries to put it away.
  //
  // Found by somebody reading a card and saying "base says over an hour ago",
  // about a machine that had been reinstalled ten minutes earlier. Nothing
  // failed; it was simply a lie that had not been called yet.
  //
  // Cleared in the registry as well as in VirtualBox, because the next dial-in
  // takes a fresh base only if this app believes there is none — see
  // firstSnapshotIfItNeedsOne.
  try {
    const had = await vbox.snapshots(name)
    // Deepest first: a parent cannot go while a child stands on it.
    for (const s of [...(had.snapshots || [])].sort((a, b) => b.depth - a.depth)) {
      to.info(`removing "${s.name}" — it is a point on a disk that is about to be thrown away`)
      await vbox.deleteSnapshot(name, s.name).catch(e => to.warn(`could not remove "${s.name}": ${e.message}`))
    }
  } catch (e) {
    to.warn(`could not read its snapshots before blanking the disk: ${e.message}`)
  }
  vms.update(name, { baseSnapshot: null, snapshots: {} })

  const info = await vbox.info(name)
  const disk = info['SATA-0-0'] || spec.disk
  if (!disk || disk === 'none') {
    to.warn('there is no disk attached to blank; installing onto whatever is there')
    return
  }

  to.info(`blanking ${path.basename(disk)} so the installer starts from nothing`)
  await vbox.run(['storageattach', name, '--storagectl', 'SATA', '--port', '0', '--device', '0',
    '--type', 'hdd', '--medium', 'none'], { tags: [name] })
  // --delete removes the file as well as the registry entry. Without it the next
  // createmedium fails on a path that is still there, and VirtualBox keeps a
  // registry full of media nobody can account for.
  await vbox.run(['closemedium', 'disk', disk, '--delete'], { timeout: 300000, tags: [name] })
  await vbox.run(['createmedium', 'disk', '--filename', disk, '--size', String(spec.diskMB), '--format', 'VDI'],
    { timeout: 300000, tags: [name] })
  await vbox.run(['storageattach', name, '--storagectl', 'SATA', '--port', '0', '--device', '0',
    '--type', 'hdd', '--medium', disk], { tags: [name] })
}

async function install (name, { port, caPort }) {
  const vm = vms.get(name)
  const spec = vm.spec
  const to = log.on('vm', name)

  if (!spec.iso) throw new Error(`"${name}" has no installer image, so there is nothing to install.`)
  const iso = await resolveISO(spec.iso)
  if (!await vbox.isOff(name)) throw new Error(`"${name}" is running. Shut it down before installing.`)

  // A MACHINE IS BUILT FROM NOTHING, NEVER REUSED.
  //
  // Installing used to keep the machine and replace only its disk. Everything
  // else came along: the snapshots, which are points on a disk that no longer
  // existed; the MAC addresses; whatever `modifyvm` had been told at some point
  // by a version of this app that has since changed its mind.
  //
  // That produced a machine with a fresh operating system and a base snapshot
  // from an hour earlier, pointing at a disk that had been deleted underneath
  // it. Nothing failed. The queue would have taken that machine, worked on it,
  // and found out at the moment it tried to put it away.
  //
  // So the VirtualBox machine is DESTROYED and made again from the spec this app
  // holds. The spec is the machine's definition; the thing in VirtualBox is a
  // build of it, and a build is cheap. What survives is what should: its name,
  // its size, its key, its token, and its place in this app's register.
  //
  // The cost is honest and worth stating: new MAC addresses, so a new host-only
  // lease and a new address on the network, and any snapshot anybody was keeping
  // is gone. That is what "install" has always meant here.
  const rebuilt = await vbox.exists(name)
  if (rebuilt) {
    to.info('removing the existing machine, so this install starts from nothing rather than from whatever it was carrying')
    channel.drop(name, 'is being rebuilt')
    await vbox.destroy(name)
    vms.update(name, { baseSnapshot: null, snapshots: {}, branch: null, borrowed: null })
    await buildInVbox(spec, to)

    // AND THE CONSOLE COMES BACK WITH IT.
    //
    // The serial port is configuration on the VirtualBox machine, so destroying
    // the build destroys it — and this app's own record still said the console
    // was being captured. The result is the worst kind of instrument: a terminal
    // tab open on a file that will never grow again, saying nothing, while the
    // install it was opened to watch runs invisibly.
    //
    // Reported as it happened: "the serial never reconnected on the new machine".
    // AND THE CONSOLE COMES BACK WITH THE BUILD. buildInVbox attaches the port to
    // every machine it makes, so what is left here is the record: this app's own
    // note of where the console is written has to name the file that now exists,
    // or the window has no reason to open a terminal on it.
    //
    // Written whatever it said before. The port is not optional any more — see
    // buildInVbox — so a machine whose record said "off" is a record that is now
    // wrong rather than a preference to preserve.
    const console1 = path.join(data.sub('serial'), `${name}.log`)
    vms.update(name, { serial: console1 })
    to.info(`its console is captured again on the new build, at ${path.basename(console1)}`)
    to.good(`${name} is a new machine again — installing onto it`)
  }

  // A BLANK DISK, every time, and this is not tidiness.
  //
  // The boot order is disk before dvd, so a machine whose disk already boots
  // never reaches the installer at all -- it just starts the operating system
  // that is already there. Installing a second time therefore did nothing, while
  // the dashboard reported "installing" and the machine sat at a login screen.
  // A whole class of confident wrong answer: the state said one thing, the
  // screen said another, and nothing failed.
  //
  // It also makes the dialog's own sentence true. It says "Anything already on
  // this machine's disk is overwritten", and until now that was only true the
  // first time.
  //
  // Recreating rather than reordering boot: an empty disk is not bootable, so
  // the dvd is reached without touching the order, and the installer meets the
  // same blank disk it met when the machine was new -- no leftover partitions
  // for it to have an opinion about.
  // Only when the machine was NOT just rebuilt. A rebuild has already made a
  // disk that has never held anything; blanking it again would delete and
  // recreate a file that is one minute old, which is a minute of somebody's disk
  // spent proving something already true.
  if (!rebuilt) await blankTheDisk(name, spec, to)

  const host = await vbox.hostAddress()

  // The one credential a machine with nothing on it can be given.
  //
  // Scripts carry the machine's token, so they cannot be handed to whoever asks
  // -- but a machine being installed has no token yet to prove itself with. The
  // ticket bridges exactly that gap: made here, carried on the installer's
  // command line, and DEAD the moment the machine dials in, which is the moment
  // it has a token instead.
  //
  // Made fresh per install rather than kept on the machine, because the command
  // line outlives the install: VirtualBox writes it into `vboxpostinstall.sh` in
  // the machine's folder, where it stays. A token there would be a live secret
  // in a plain file; a spent ticket is a string that opens nothing.
  const ticket = channel.newToken()
  vms.update(name, { installTicket: ticket })

  // Only one script is named here. What it then fetches and in what order is
  // decided in first-boot.sh, which anyone can edit or replace -- so changing how a
  // machine is built never means touching this app.
  const url = `https://${host}:${port}/provision/first-boot.sh?vm=${encodeURIComponent(name)}&ticket=${ticket}`

  // The trust anchor, and the only one available at this moment.
  //
  // A machine being installed holds nothing: no certificate, no authority,
  // nothing to check anything against. But the script it is about to fetch
  // carries its token, so fetching that in the clear -- or with verification
  // turned off -- is exactly what all of this exists to stop.
  //
  // So the authority is fetched from the one unencrypted port and CHECKED
  // against this fingerprint, which travels here instead: on the installer's
  // command line, by a route nothing on the network can touch. It is not a
  // secret, it is short, and it is the reason the unencrypted fetch is safe.
  const tls = keys.ensure()
  const caUrl = `http://${host}:${caPort}/ca.pem`

  // Every detail of the next few lines is load-bearing:
  //
  // * VirtualBox pastes this into its own template as an unquoted argument to a
  //   helper, so it must be a plain argument list. A leading parenthesis makes it
  //   a bash syntax error and the install dies at the very end with nothing
  //   saying why. Anything compound goes inside `bash -c`.
  // * No `$` anywhere. The template puts this inside a double-quoted argument, so
  //   the OUTER shell expands `$(...)` and `$var` before `bash -c` ever sees them
  //   -- a loop counter arrives empty and a substitution runs on the wrong side.
  // * Retried, because this fetch is the single moment the whole install depends
  //   on this app being reachable. A restart or a slow network would otherwise
  //   waste the entire install.
  //
  // Two fetches now rather than one, and the order is the point: the authority
  // first and unverified, then checked, and only then anything carrying a
  // secret. If the check fails this stops -- it does not fall back to plain
  // HTTP, because a fallback is a way to be pushed onto the unprotected path by
  // whoever is doing the pushing.
  const inner = [
    'mkdir -p /etc/okc;',
    'for i in 1 2 3 4 5 6 7 8 9 10; do',
    `curl -fsSL '${caUrl}' -o /etc/okc/ca.pem && break;`,
    `wget -qO /etc/okc/ca.pem '${caUrl}' && break;`,
    "echo 'okc: could not fetch the certificate authority yet, retrying in 10s';",
    'sleep 10;',
    'done;',
    // Told apart from a fingerprint that does not match, which is a different
    // fault with a different cause. Without this, a file that was never fetched
    // reaches the check below and is reported as an authority that "is not the
    // one this machine was told to expect" -- an accusation about substitution,
    // for a machine that simply had no way to download anything.
    'if [ ! -s /etc/okc/ca.pem ]; then',
    "echo 'okc: could not fetch the certificate authority at all -- neither curl nor wget worked here';",
    'exit 1;',
    'fi;',
    // Compared with a pipeline and a grep rather than a variable, because of the
    // rule above: no `$` survives to this side. `got=$(...)` would be expanded by
    // the outer shell and arrive empty, so the comparison would be between two
    // empty strings -- which PASSES, and would have accepted any authority at all
    // while looking like it checked.
    "if ! openssl x509 -in /etc/okc/ca.pem -noout -fingerprint -sha256 | tr -d ':' | tr 'A-Z' 'a-z' | grep -q " +
      `'${tls.fingerprint}'; then`,
    "echo 'okc: REFUSED the certificate authority -- it is not the one this machine was told to expect';",
    'exit 1;',
    'fi;',
    // BOTH tools here too, and this is the line that has to stay.
    //
    // curl is NOT in the installer's target on Ubuntu desktop. The original
    // bootstrap had a wget fallback for exactly that reason; when this was
    // rewritten for TLS the fallback survived on the fetch above and was dropped
    // from this one, because wget spells its authority flag differently and
    // translating it was one step more than copying it.
    //
    // What that cost is the shape worth remembering: the install ran for
    // twenty-five minutes, the first fetch succeeded through wget, the
    // fingerprint checked out, and then this loop said "the dashboard is not
    // reachable yet" ten times -- a sentence about the network, describing a
    // missing program, on a machine whose only symptom was an installer saying
    // "Something went wrong". Nothing reached the live log, because the guest
    // never got far enough to report anything.
    //
    // Neither is told to skip verification. --cacert and --ca-certificate are
    // the same instruction spelled twice, which is the whole difference between
    // this and the version that failed.
    'for i in 1 2 3 4 5 6 7 8 9 10; do',
    `curl -fsSL --cacert /etc/okc/ca.pem '${url}' -o /root/okc-bootstrap.sh && break;`,
    `wget -q --ca-certificate=/etc/okc/ca.pem -O /root/okc-bootstrap.sh '${url}' && break;`,
    "echo 'okc: could not fetch the setup script yet, retrying in 10s';",
    'sleep 10;',
    'done;',
    // Said here rather than left to bash. Without it the script simply runs a
    // file that is not there, and the last words of a twenty-five minute install
    // are "No such file or directory" and "exit code: 127" -- which describe the
    // symptom and name neither the cause nor what state the machine is now in.
    'if [ ! -s /root/okc-bootstrap.sh ]; then',
    "echo 'okc: could not fetch the setup script -- the operating system is installed but nothing has been set up on it';",
    'exit 1;',
    'fi;',
    'bash /root/okc-bootstrap.sh'
  ].join(' ')

  // OUR AUTOINSTALL TEMPLATE, WHICH IS VIRTUALBOX'S PLUS ONE BLOCK.
  //
  // What it adds is a way to watch: the installer's own journal streamed to the
  // serial port, and ssh into the installer environment with the same key the
  // finished machine gets. Between "installing" and "it dialled in" this app had
  // no evidence of any kind, and a machine that hangs in that window looks
  // exactly like one that is working.
  //
  // Written out with OUR placeholder filled in first — VirtualBox reads the file
  // afterwards and fills in every @@VBOX_...@@ of its own, which is why this can
  // be a copy of theirs rather than a reimplementation of it.
  //
  // If the template is missing or cannot be written, the install goes ahead
  // WITHOUT it: being unable to watch is worse than not installing, but only
  // slightly, and a machine that will not build because of a logging convenience
  // is the wrong trade.
  let template = null
  try {
    const from = path.join(__dirname, '..', 'provision', 'autoinstall-user-data')
    const text = fs.readFileSync(from, 'utf8').split('@@OKC_SSH_KEY@@').join(String(spec.sshKey || '').trim())
    template = path.join(os.tmpdir(), `okc-autoinstall-${name}.yaml`)
    fs.writeFileSync(template, text)
  } catch (e) {
    template = null
    to.warn(`installing without the dashboard's autoinstall additions (${e.message}) — the install will not be watchable over the serial port or ssh`)
  }

  const args = ['unattended', 'install', name,
    '--iso', iso,
    ...(template ? ['--script-template', template] : []),
    '--user', spec.user,
    '--password', spec.password || 'okc',
    '--full-user-name', spec.fullName,
    '--hostname', spec.hostname.includes('.') ? spec.hostname : `${spec.hostname}.local`,
    '--locale', spec.locale,
    '--time-zone', spec.timeZone,
    '--post-install-command', `bash -c "${inner}"`]
  if (spec.installAdditions) args.push('--install-additions')
  args.push('--start-vm', 'gui')

  to.info(`installing ${path.basename(iso)} on ${name}; it will fetch its setup from ${url}`)
  vms.update(name, { installing: new Date().toISOString(), reported: null })

  // VBoxManage echoes back every value it was given, INCLUDING the password. The
  // log is kept and read later, so a secret reaching it is a secret permanently
  // written down.
  //
  // The field lines below are where it actually appears, and those are always
  // redacted. Blanking the password everywhere as well is only safe when it is
  // long enough to be distinctive: a password of "okc" turned okc-flow.local into
  // <hidden>-flow.local and okc-bootstrap.sh into <hidden>-bootstrap.sh, which
  // makes the log lie about names for no security gain.
  const secrets = [spec.password].filter(s => s && s.length >= 8 && !name.includes(s))
  try {
    const out = await vbox.run(args, { timeout: 300000, quiet: true })
    for (let line of out.split('\n')) {
      line = line.trim()
      if (!line) continue
      if (/^\s*(user-|admin-)?password\s*=/.test(line)) line = line.replace(/=.*/, '= <hidden>')
      for (const s of secrets) line = line.split(s).join('<hidden>')
      to.out(line)
    }
  } catch (e) {
    let why = e.message
    for (const s of secrets) why = why.split(s).join('<hidden>')
    vms.update(name, { installing: null })
    throw new Error(why)
  }

  to.good(`${name} is installing. It takes a while, and will report back here when it is up.`)
  return { name, iso, url }
}

// What the guest says about itself, on its way through first boot.
function report (name, stage) {
  const vm = vms.read().find(v => v.name === name)
  if (!vm) return { ignored: true }
  log.on('vm', name, 'guest').good(`${name}: ${stage}`)
  const now = vms.update(name, {
    reported: new Date().toISOString(),
    stage,
    installing: stage === 'online' ? null : vm.installing
  })

  return now
}

// THE FIRST CLEAN STARTING POINT, taken when the machine first dials in.
//
// A machine with no base snapshot cannot be put away clean, so the queue
// correctly never picks it up — and "the queue is ignoring my new machine" is
// indistinguishable from "the queue has nothing to do". Every machine built here
// needed somebody to remember this step, long after they started the thing that
// needed it. runner3 was built, used, and refused by vmProvisionUpdate before
// anybody noticed it had none.
//
// NOT WHEN THE GUEST SAYS "ONLINE", which was the first attempt and was wrong in
// a way worth writing down: first-boot.sh runs in the INSTALLER's post-install
// stage — its own comments say so — so "online" arrives while the machine is
// still the installer, before the installed system has ever booted. Hooking it
// there pressed the power button in the middle of an install and then raced the
// installer's own reboot. It survived; it should not have been asked to.
//
// Dialling in is the honest signal: the installed system booted, its agent
// started, and it reached this host. Nothing has been asked of it yet.
//
// Detached, because snapshotting shuts the machine down and starts it again, and
// this is running inside the handler that makes a machine reachable. A failure
// is said and changes nothing — the machine is installed either way, and
// vmBaseSnapshot is still there to be pressed.
function firstSnapshotIfItNeedsOne (name) {
  const vm = vms.read().find(v => v.name === name)
  if (!vm || vm.baseSnapshot) return
  if (vm.installing) return   // still being built; it will dial in again after
  setTimeout(() => {
    base(name).catch(e => log.on('vm', name).warn(`could not take its first snapshot: ${e.message}. Take one with vmBaseSnapshot — until it has one, the queue cannot use it.`))
  }, 5000)
}

// The first snapshot, taken once and never again by this path. Written here
// rather than called through the actions table because provisioner is under
// machines/ and this is a machine operation: the action does the same thing for
// a person pressing a button.
async function base (name, title = 'base') {
  const to = log.on('vm', name)
  to.info('taking its first clean snapshot, so it can be put away and reused')
  if (!await vbox.isOff(name)) {
    await vbox.stop(name, false)
    if (!await vbox.waitUntilOff(name, { timeout: 180000 })) {
      to.warn('it did not shut down when asked; pulling the power to snapshot it')
      await vbox.stop(name, true).catch(() => {})
      await vbox.waitUntilOff(name, { timeout: 60000 })
    }
    await vbox.waitUntilUnlocked(name)
  }
  await vbox.takeSnapshot(name, title, 'the machine as it was built, before anything was asked of it')
  vms.update(name, { baseSnapshot: title, snapshots: { [title]: null } })
  to.good(`"${title}" is the point this machine will be returned to after every task`)
  return { name, baseSnapshot: title }
}

// ---- the console every machine is supposed to have -------------------------
//
// EVERY MACHINE, NOT ONLY THE NEW ONES. buildInVbox attaches the port to
// anything built from now on, which leaves the machines that already exist —
// including ones built by an earlier version, which is most of them.
//
// Run at startup. It only touches a machine that is OFF and has no port, because
// VirtualBox will not add one to a running machine, and it says so rather than
// failing silently: a machine that is up right now gets its port the next time it
// is off, and this is called again on the next start.
//
// Cheap when there is nothing to do: one registry read, and no VBoxManage call
// at all for a machine that already has a console.
async function makeSureConsolesAreCaptured () {
  if (!vbox.available()) return { checked: 0, given: [], later: [] }
  const given = []
  const later = []

  for (const vm of vms.read()) {
    if (vm.serial) continue
    const to = log.on('vm', vm.name)
    let off = false
    try { off = await vbox.isOff(vm.name) } catch { continue }   // not built yet; the build will do it
    if (!off) { later.push(vm.name); continue }

    const file = path.join(data.sub('serial'), `${vm.name}.log`)
    try {
      await vbox.setSerial(vm.name, file)
      vms.update(vm.name, { serial: file })
      given.push(vm.name)
      to.good(`its console is now captured — every machine has one, and this one did not`)
    } catch (e) {
      to.warn(`could not capture its console: ${e.message}`)
    }
  }

  if (later.length) {
    log.on('machines').info(`${later.join(', ')} ${later.length === 1 ? 'is' : 'are'} running, so ${later.length === 1 ? 'its' : 'their'} console cannot be captured until ${later.length === 1 ? 'it is' : 'they are'} next off — VirtualBox will not add a serial port to a running machine`)
  }
  return { checked: vms.read().length, given, later }
}

// ---- and every machine is in a pool ---------------------------------------
//
// The ones built from now on are put in one by fill(); this is for the machines
// that already existed when the idea arrived. Same shape as the console sweep
// above and for the same reason: a rule that only applies to new machines is a
// rule with a growing list of exceptions.
//
// A SUPERVISOR IS LEFT ALONE. It takes no work, so the pool work is drawn from
// is not a thing it can be in.
function makeSurePoolsAreNamed () {
  const given = []
  for (const vm of vms.read()) {
    if ((vm.tags || []).length) continue
    if ((vm.tags || []).some(t => String(t).toLowerCase() === SUPERVISOR)) continue
    vms.update(vm.name, { tags: [POOL] })
    given.push(vm.name)
    log.on('vm', vm.name).info(`it carried no tag, so it is in the "${POOL}" pool — every machine is in one`)
  }
  return { given }
}

module.exports = { fill, create, install, report, base, firstSnapshotIfItNeedsOne, resolveISO, pickBridge, makeSureConsolesAreCaptured, makeSurePoolsAreNamed }
