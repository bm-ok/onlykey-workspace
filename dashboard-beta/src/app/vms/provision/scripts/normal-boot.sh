#!/bin/bash
# Run on every ordinary boot, as the USER, by the okc-boot service.
#
# Not as root: it reports in and reads a few facts, and none of that needs root.
#
# Not the same job as first-boot.sh and deliberately a different file: this one
# runs hundreds of times and must be safe to run again, so it installs nothing and
# changes nothing. It says the machine is up, and refreshes anything that is
# allowed to have drifted since last time.
#
# A header of OKC_* variables and a `say` helper is prepended by the dashboard.

set -u

say "up: $(hostname), $(uname -sr)"

# --- say hello ----------------------------------------------------------------
#
# The dashboard may not be running, and that is not a fault. This is the machine
# announcing itself, not asking permission.
report booted

# --- what the operator will want to know --------------------------------------

addresses=$(hostname -I 2>/dev/null || true)
[ -n "$addresses" ] && say "reachable at: $addresses"

if systemctl is-active --quiet ssh 2>/dev/null || systemctl is-active --quiet sshd 2>/dev/null; then
  say "ssh is up"
else
  say "WARNING: ssh is not running on this boot"
fi

# --- re-run the swappable part, if asked ---------------------------------------
#
# Off by default. It exists because editing toolchain.sh and rebooting is a much
# shorter loop than reinstalling the operating system to try a change -- but a
# machine that silently re-provisions itself on every boot would be unpredictable,
# so it only happens when the spec says so.
if [ "${OKC_REPROVISION_ON_BOOT:-no}" = "yes" ]; then
  say "re-running the toolchain, because this machine is set to"
  if curl -fsSL "$OKC_BASE/provision/toolchain.sh?vm=$OKC_VM" -o /root/okc-toolchain.sh; then
    bash /root/okc-toolchain.sh || say "the toolchain failed on this boot"
  else
    say "could not fetch the toolchain; leaving the machine as it is"
  fi
fi

say "boot check finished"
