'use strict'

// Serves the shell scripts in provision/, with a small header of values.
//
// The scripts are files rather than strings in here on purpose: they are meant to
// be swapped. A VM's spec can name a different file for any stage, so making a
// different kind of machine is editing or replacing a script rather than changing
// this app.
//
// Read fresh on every request, never cached, so editing one takes effect on the
// next boot with nothing to restart.

const fs = require('node:fs')
const path = require('node:path')

// What the app ships.
const DIR = path.join(__dirname, '..', 'provision')

// What the project brings.
//
// Two ways to use it, and they are different on purpose:
//
//   extra.sh          runs AFTER the app's toolchain, and adds to it. This is the
//                     usual one: the app guarantees a baseline -- build tools,
//                     docker, a desktop, node -- and the project adds what only it
//                     needs. Nothing is duplicated and nothing is lost.
//   any other name    replaces the app's file of that name outright, for when the
//                     baseline itself is wrong for a project.
//
// Outside the app on purpose. It is also why the test that keeps the app generic
// does not scan this directory: project-specific content is exactly what is
// supposed to be here.
const WORKSPACE = process.env.OKC_PROVISION_DIR ||
  path.join(__dirname, '..', '..', 'workspace', 'provision')

const searchPath = () => [WORKSPACE, DIR].filter(d => { try { return fs.existsSync(d) } catch { return false } })

// The stages, and which file each uses unless a VM says otherwise. Adding a stage
// here is the only place a new one needs registering.
// Root and user are separate stages, not one script switching user mid-flight.
// Which of the two something needs is not a detail: packages and /etc are root's, a
// shell file or a per-user install is the user's, and mixing them is how a home
// directory ends up owned by root.
const STAGES = {
  firstBoot: 'first-boot.sh',
  toolchain: 'toolchain.sh',
  toolchainUser: 'toolchain-user.sh',
  normalBoot: 'normal-boot.sh',
  // A SCREEN, ONLY IF THE MACHINE WAS BUILT TO HAVE ONE.
  //
  // Every machine is installed from the same server image, which has no desktop
  // at all — so a desktop is something ADDED, by this, rather than something a
  // machine is born with and a runner has to have stripped out. That way round
  // because most machines here never show anybody anything, and the display
  // stack is most of what they would otherwise spend their boot and their
  // memory on.
  desktop: 'desktop.sh',
  // The project's additions, run after the app's. Usually only a project has these,
  // and a machine works perfectly well without either.
  extra: 'extra.sh',
  extraUser: 'extra-user.sh',
  // Not shell, and served without a header for that reason -- its values arrive
  // through the service unit first-boot.sh writes for it.
  agent: 'agent.py'
}

// Every script available, and which copy of it would actually be used.
function list () {
  const seen = new Map()
  for (const dir of searchPath()) {
    for (const f of fs.readdirSync(dir).filter(f => /\.(sh|py)$/.test(f)).sort()) {
      // First directory wins, and the workspace is first.
      if (!seen.has(f)) seen.set(f, { file: f, from: dir === WORKSPACE ? 'the project' : 'the app' })
    }
  }
  return [...seen.values()]
}

// Only ever a plain filename, and only inside one of the directories above. A spec
// is configuration, but it is still not allowed to name a path -- "../../something"
// would otherwise serve any file on this machine to a guest.
function resolve (wanted) {
  const name = path.basename(String(wanted || ''))
  if (!/\.(sh|py)$/.test(name)) throw new Error(`"${wanted}" is not a provisioning script.`)
  for (const dir of searchPath()) {
    const file = path.join(dir, name)
    if (file.startsWith(dir) && fs.existsSync(file)) return file
  }
  throw new Error(`There is no provisioning script called "${name}".`)
}

// Where a script came from, so the log can say whose copy ran.
const sourceOf = file => file.startsWith(WORKSPACE) ? 'the project' : 'the app'

// Does a stage exist at all? extra.sh usually only exists for a project, and its
// absence is normal rather than a problem.
const has = (vm, stage) => {
  try { fileFor(vm, stage); return true } catch { return false }
}

// Which file a VM gets for a stage: its own choice, or the default.
const fileFor = (vm, stage) => {
  const chosen = ((vm && vm.spec && vm.spec.scripts) || {})[stage]
  return resolve(chosen || STAGES[stage] || stage)
}

const q = s => `'${String(s == null ? '' : s).split("'").join("'\\''")}'`

// Values, and the two helpers every script uses. Prepended rather than
// substituted into the script, so each file stays valid shell on its own and can
// be run by hand on a machine to debug it.
function header (vm, { hostAddress, port, channelPort, caPort, caFingerprint }) {
  const spec = (vm && vm.spec) || {}
  return `#!/bin/bash
# ------------------------------------------------------------------------------
# Written by the dashboard for "${vm.name}". Everything below this block is the
# script file itself, unchanged -- so it can be read, edited and run by hand.
# ------------------------------------------------------------------------------
OKC_VM=${q(vm.name)}
OKC_HOST=${q(hostAddress)}
OKC_PORT=${q(port)}
OKC_BASE=${q(`https://${hostAddress}:${port}`)}
OKC_USER=${q(spec.user || 'okc')}
OKC_SSH_KEY=${q(spec.sshKey || '')}
OKC_REPROVISION_ON_BOOT=${q(spec.reprovisionOnBoot ? 'yes' : 'no')}
# WHETHER THIS MACHINE IS MEANT TO HAVE A SCREEN, decided when it was made and
# never afterwards. A machine with no desktop boots in a fraction of the time and
# idles on a fraction of the memory -- no display manager, no session, no
# compositor -- which is what a runner that only ever holds a terminal wants. A
# machine somebody is going to sit at wants the opposite.
#
# The scripts ask this rather than guessing from what is installed: "there is no
# gdm here" is also true of a desktop machine whose install went wrong, and those
# two need opposite responses.
OKC_DESKTOP=${q(spec.desktop === false ? 'no' : 'yes')}
# This machine's own secret, and the port it dials in on. It can only ever connect
# as itself, because the dashboard checks this against the machine it claims to be.
#
# It reaches this script over TLS, which is the point: this line used to cross the
# network in the clear on every machine ever built, as the first thing that
# happened, because the installer fetched this file with plain curl.
OKC_TOKEN=${q(spec.token || '')}
OKC_CHANNEL_PORT=${q(channelPort)}

# What proves the dashboard is the dashboard.
#
# OKC_CA is where the authority's certificate lives on this machine. Everything
# that talks to the host passes it, so nothing here ever needs to be told to skip
# verification -- which would have been the easy way to make a self-signed
# certificate work and would have thrown away the entire reason for having one.
#
# The fingerprint is carried so any script can re-fetch the authority and check
# it. The certificate is public and its address is unencrypted; this is what
# makes fetching it from there safe.
OKC_CA=/etc/okc/ca.pem
OKC_CA_URL=${q(`http://${hostAddress}:${caPort}/ca.pem`)}
OKC_CA_FINGERPRINT=${q(caFingerprint || '')}

export OKC_VM OKC_HOST OKC_PORT OKC_BASE OKC_USER OKC_SSH_KEY OKC_REPROVISION_ON_BOOT OKC_DESKTOP
export OKC_TOKEN OKC_CHANNEL_PORT OKC_CA OKC_CA_URL OKC_CA_FINGERPRINT

# Fetches the authority if it is not here, and refuses it unless it is the one
# the fingerprint names. Safe to call from anywhere, including before there is
# any certificate on the machine at all.
okc_ca () {
  [ -s "$OKC_CA" ] && return 0
  [ -n "$OKC_CA_FINGERPRINT" ] || return 1
  mkdir -p "$(dirname "$OKC_CA")" 2>/dev/null || return 1
  tmp=$(mktemp) || return 1
  curl -fsS --max-time 20 "$OKC_CA_URL" -o "$tmp" || { rm -f "$tmp"; return 1; }
  got=$(openssl x509 -in "$tmp" -noout -fingerprint -sha256 2>/dev/null | tr -d ':' | cut -d= -f2 | tr 'A-Z' 'a-z')
  want=$(printf '%s' "$OKC_CA_FINGERPRINT" | tr -d ':' | tr 'A-Z' 'a-z')
  if [ "$got" != "$want" ]; then
    echo "okc: REFUSED the certificate authority -- it is not the one this machine was told to expect."
    rm -f "$tmp"
    return 1
  fi
  mv "$tmp" "$OKC_CA" && chmod 0644 "$OKC_CA"
}
okc_ca || true

# Everything a script prints goes to one log on the machine and to the dashboard,
# so the live log and the machine's own record say the same thing.
OKC_LOG=/var/log/okc-provision.log
touch "$OKC_LOG" 2>/dev/null || OKC_LOG=/tmp/okc-provision.log
exec > >(tee -a "$OKC_LOG") 2>&1

# Never fatal, and never noisy about it: a machine must not fail to build because
# the dashboard was restarted while it was talking.
report () {
  curl -fsS --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" --max-time 5 "$OKC_BASE/provision/report?vm=$OKC_VM&stage=$1" >/dev/null 2>&1 || true
}

# Echoed always. Sent over HTTP only when nothing else is carrying our output:
# during an install nobody is listening to stdout, but when the agent runs a script
# it already streams stdout -- and doing both put every line in the log twice.
say () {
  echo "okc: $*"
  if [ "\${OKC_QUIET_SAY:-no}" != "yes" ]; then
    curl -fsS --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" --max-time 5 --get --data-urlencode "text=$*" \\
      "$OKC_BASE/provision/say?vm=$OKC_VM" >/dev/null 2>&1 || true
  fi
}
`
}

// The header, the script, and then the VM's own extra steps if it declared any --
// so a small addition does not need a new file.
function render (stage, vm, where) {
  const body = fs.readFileSync(fileFor(vm, stage), 'utf8')
  const steps = ((vm.spec || {}).setup || [])
    .map((s, i) => `say ${q(`extra step ${i + 1}: ${s.name || s.run}`)}\n${s.run}\n`)
    .join('\n')

  return [
    header(vm, where),
    body,
    steps ? `\n# --- this machine's own setup steps -------------------------------\n${steps}` : ''
  ].join('\n')
}

// Served exactly as it is on disk, for anything that is not shell.
const raw = (vm, stage) => fs.readFileSync(fileFor(vm, stage), 'utf8')

// Which stage a requested filename belongs to, so /provision/<file> works with
// either the stage's default name or a swapped-in one.
const stageOfFile = name => Object.keys(STAGES).find(s => STAGES[s] === name) || null

module.exports = { render, raw, list, resolve, fileFor, has, sourceOf, STAGES, stageOfFile, DIR, WORKSPACE }
