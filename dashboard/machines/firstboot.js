'use strict'

// The script a new guest runs once, on its first boot.
//
// Rendered on every request rather than cached, so changing a VM's setup steps
// takes effect on the next attempt with nothing to rebuild.
//
// It is deliberately almost empty. The only things this app puts in are the two
// it needs to be able to talk to the machine at all -- an ssh server, and a line
// home saying it is alive. Everything else comes from the VM's own `setup` list,
// as data. A guest that needs a compiler says so in its spec; this file does not
// know what a compiler is.

const shellSingleQuote = s => `'${String(s).split("'").join("'\\''")}'`

function render (vm, { hostAddress, port }) {
  const spec = vm.spec || {}
  const report = stage =>
    `curl -fsS ${shellSingleQuote(`http://${hostAddress}:${port}/provision/report?vm=${encodeURIComponent(vm.name)}&stage=${stage}`)} >/dev/null 2>&1 || true`

  const steps = (spec.setup || []).map((step, i) => [
    `say ${shellSingleQuote(`step ${i + 1}/${(spec.setup || []).length}: ${step.name || step.run}`)}`,
    step.run,
    `[ $? -eq 0 ] || { say 'that step failed'; ${report('failed')}; exit 1; }`
  ].join('\n'))

  return `#!/bin/bash
# Written by the dashboard for "${vm.name}". Not edited by hand -- it is rendered
# fresh on every request from this VM's setup steps.
set -u

LOG=/var/log/okc-first-boot.log
exec > >(tee -a "$LOG") 2>&1

say () { echo "okc: $*"; ${report('running')}; }

say "first boot starting on $(hostname)"
${report('installing')}

export DEBIAN_FRONTEND=noninteractive

# An ssh server, because it is how this app reaches the machine afterwards. This
# is the one thing installed that no setup step asked for.
say 'installing openssh-server'
apt-get update -y || true
apt-get install -y openssh-server curl ca-certificates || true
systemctl enable --now ssh || systemctl enable --now sshd || true

${spec.sshKey
  ? `say 'adding the key you gave it'
install -d -m 700 /home/${spec.user}/.ssh
echo ${shellSingleQuote(spec.sshKey)} >> /home/${spec.user}/.ssh/authorized_keys
chmod 600 /home/${spec.user}/.ssh/authorized_keys
chown -R ${spec.user}:${spec.user} /home/${spec.user}/.ssh`
  : "say 'no ssh key was given, so password login is the only way in'"}

${steps.length ? steps.join('\n\n') : "say 'this machine has no setup steps'"}

say 'first boot finished'
${report('online')}
`
}

module.exports = { render }
