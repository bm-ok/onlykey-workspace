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

# --- what this workspace is, for whatever opens it ----------------------------
#
# The workspace's own notes, written to ~/workspace/CLAUDE.md so that anything
# working here is told how to finalise the workspace, build it, test it and run
# it -- rather than working all of that out again from the source, which is what
# happened before this existed.
#
# ON EVERY BOOT, AND OVERWRITTEN EVERY TIME. This is the shared copy from the
# host, and a machine is not where it is edited: a local change survives only
# until the next boot, and the host is where a change is kept and read. That is
# deliberate and is what makes the file the same on every machine.
#
# BEFORE THE WORKSPACE IS LAID OUT, WHICH IS FINE. `vmWorkspace` does `mkdir -p`
# on this folder and never clears it, so a file written now survives the repos
# being cloned in around it later.
#
# NEVER FATAL. A machine with no notes can still do its work; a machine that
# refused to finish booting over a missing document could not. Every failure
# here is a line in the log and nothing more -- and the host answers 503 rather
# than hanging when it cannot read the file, for the same reason.
mkdir -p "$HOME/workspace"
if curl -fsS --max-time 20 --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" \
    -o "$HOME/workspace/CLAUDE.md.new" \
    "$OKC_BASE/workstrap?vm=$OKC_VM" 2>/dev/null; then
  # WRITTEN ASIDE AND MOVED, so a fetch that dies halfway leaves the notes that
  # were already there rather than half a document. A truncated CLAUDE.md is
  # worse than an old one: it reads as complete.
  mv "$HOME/workspace/CLAUDE.md.new" "$HOME/workspace/CLAUDE.md"
  say "the workspace notes are at ~/workspace/CLAUDE.md ($(wc -c < "$HOME/workspace/CLAUDE.md") bytes)"
else
  rm -f "$HOME/workspace/CLAUDE.md.new"
  say "WARNING: could not fetch the workspace notes; carrying on without them"
fi

say "boot check finished"
