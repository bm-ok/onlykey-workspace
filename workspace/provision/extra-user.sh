#!/bin/bash
# This project's extra setup — the USER half.
#
# Runs as the user, after the app's user toolchain, so node through nvm is already
# there and this can rely on it.
#
# Anything system-wide is in extra.sh, which runs as root before this. If something
# here needs a package or a udev rule, that is where it belongs.
#
# A header of OKC_* values and `say`/`report` helpers is prepended by the dashboard.
# $HOME and $USER are the user's own here.

set -u

say "extra (user): starting as $(id -un)"

# --- where work happens -------------------------------------------------------
#
# One folder, in the user's home, made by the user. Nothing is cloned into it here:
# what belongs in it is this project's business and changes more often than a
# provisioning script should.

mkdir -p "$HOME/work"
say "work goes in $HOME/work"

# --- prove the machine is actually usable -------------------------------------
#
# Checked as the user, in a login shell, which is what a command sent to this machine
# gets. Each of these has been wrong before while looking right from a root shell, so
# they are reported rather than assumed.

say "node:   $(bash -lc 'node --version 2>/dev/null || echo MISSING')"
say "npm:    $(bash -lc 'npm --version 2>/dev/null || echo MISSING')"

# Docker without sudo depends on group membership, which is only read when a session
# starts -- so this is expected to say no until the machine has been rebooted once.
if docker info >/dev/null 2>&1; then
  say 'docker: usable without sudo'
else
  say 'docker: not usable without sudo yet — group membership applies from the next login'
fi

# The display only exists once somebody is logged in, which autologin arranges from
# the next boot.
if [ -n "${DISPLAY:-}" ] && xset q >/dev/null 2>&1; then
  say "display: $DISPLAY is reachable"
else
  say 'display: not reachable yet — autologin starts a session on the next boot'
fi

say 'extra (user) finished'
