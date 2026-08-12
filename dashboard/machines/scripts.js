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

const DIR = path.join(__dirname, '..', 'provision')

// The stages, and which file each uses unless a VM says otherwise. Adding a stage
// here is the only place a new one needs registering.
const STAGES = {
  unattended: 'unattended.sh',
  firstBoot: 'first-boot.sh',
  toolchain: 'toolchain.sh',
  normalBoot: 'normal-boot.sh'
}

const list = () => fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(f => f.endsWith('.sh')).sort() : []

// Only ever a plain filename inside provision/. A spec is configuration, but it
// is still not allowed to name a path -- "../../something" would otherwise serve
// any file on the machine to a guest.
function resolve (wanted) {
  const name = path.basename(String(wanted || ''))
  if (!name.endsWith('.sh')) throw new Error(`"${wanted}" is not a shell script.`)
  const file = path.join(DIR, name)
  if (!file.startsWith(DIR) || !fs.existsSync(file)) throw new Error(`There is no provisioning script called "${name}".`)
  return file
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
function header (vm, { hostAddress, port }) {
  const spec = (vm && vm.spec) || {}
  return `#!/bin/bash
# ------------------------------------------------------------------------------
# Written by the dashboard for "${vm.name}". Everything below this block is the
# script file itself, unchanged -- so it can be read, edited and run by hand.
# ------------------------------------------------------------------------------
OKC_VM=${q(vm.name)}
OKC_HOST=${q(hostAddress)}
OKC_PORT=${q(port)}
OKC_BASE=${q(`http://${hostAddress}:${port}`)}
OKC_USER=${q(spec.user || 'okc')}
OKC_SSH_KEY=${q(spec.sshKey || '')}
OKC_REPROVISION_ON_BOOT=${q(spec.reprovisionOnBoot ? 'yes' : 'no')}
export OKC_VM OKC_HOST OKC_PORT OKC_BASE OKC_USER OKC_SSH_KEY OKC_REPROVISION_ON_BOOT

# Everything a script prints goes to one log on the machine and to the dashboard,
# so the live log and the machine's own record say the same thing.
OKC_LOG=/var/log/okc-provision.log
touch "$OKC_LOG" 2>/dev/null || OKC_LOG=/tmp/okc-provision.log
exec > >(tee -a "$OKC_LOG") 2>&1

# Never fatal, and never noisy about it: a machine must not fail to build because
# the dashboard was restarted while it was talking.
report () {
  curl -fsS --max-time 5 "$OKC_BASE/provision/report?vm=$OKC_VM&stage=$1" >/dev/null 2>&1 || true
}

say () {
  echo "okc: $*"
  curl -fsS --max-time 5 --get --data-urlencode "text=$*" \\
    "$OKC_BASE/provision/say?vm=$OKC_VM" >/dev/null 2>&1 || true
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

// Which stage a requested filename belongs to, so /provision/<file> works with
// either the stage's default name or a swapped-in one.
const stageOfFile = name => Object.keys(STAGES).find(s => STAGES[s] === name) || null

module.exports = { render, list, resolve, fileFor, STAGES, stageOfFile, DIR }
