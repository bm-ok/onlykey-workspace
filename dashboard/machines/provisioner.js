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

async function install (name, { port }) {
  const vm = vms.get(name)
  const spec = vm.spec
  const to = log.on('vm', name)

  if (!spec.iso) throw new Error(`"${name}" has no installer image, so there is nothing to install.`)
  const iso = await resolveISO(spec.iso)
  if (!await vbox.isOff(name)) throw new Error(`"${name}" is running. Shut it down before installing.`)

  const host = await vbox.hostAddress()
  // Only the first script is named here. What it then fetches and in what order
  // is decided in unattended.sh, which is a file anyone can edit or replace --
  // so changing how a machine is built never means touching this app.
  const url = `http://${host}:${port}/provision/unattended.sh?vm=${encodeURIComponent(name)}`

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
  const inner = [
    'for i in 1 2 3 4 5 6 7 8 9 10; do',
    `curl -fsSL '${url}' -o /root/okc-first-boot.sh && break;`,
    `wget -qO /root/okc-first-boot.sh '${url}' && break;`,
    "echo 'okc: the dashboard is not reachable yet, retrying in 10s';",
    'sleep 10;',
    'done;',
    'bash /root/okc-first-boot.sh'
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
  // <hidden>-flow.local and okc-first-boot.sh into <hidden>-first-boot.sh, which
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
