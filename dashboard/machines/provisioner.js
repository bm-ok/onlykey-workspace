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
const path = require('node:path')
const log = require('../core/log')
const vbox = require('./vbox')
const vms = require('./vms')
const channel = require('./channel')
const keys = require('../core/keys')

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
    installAdditions: input.installAdditions !== false,
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

  const iso = spec.iso ? await resolveISO(spec.iso) : ''
  const bridge = spec.network === 'bridged' ? await pickBridge(spec.bridgeAdapter) : ''

  to.info(`creating ${spec.name}: ${spec.cpus} cpu, ${spec.memoryMB} MB, ${Math.round(spec.diskMB / 1024)} GB disk`)
  await vbox.run(['createvm', '--name', spec.name, '--ostype', spec.ostype, '--register'], { tags: [spec.name] })

  const net = spec.network === 'bridged'
    ? ['--nic1', 'bridged', '--bridgeadapter1', bridge, '--nictype1', 'virtio']
    : ['--nic1', 'nat', '--nictype1', 'virtio']

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

  const vm = vms.add({ ...spec, iso, bridge, disk })
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
  await blankTheDisk(name, spec, to)

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

  const args = ['unattended', 'install', name,
    '--iso', iso,
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
  return vms.update(name, {
    reported: new Date().toISOString(),
    stage,
    installing: stage === 'online' ? null : vm.installing
  })
}

module.exports = { fill, create, install, report, resolveISO, pickBridge }
