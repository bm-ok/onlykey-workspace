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

# --- the worker that actually does the work -----------------------------------
#
# Claude Code, installed for the user rather than system-wide, because node here
# comes from nvm and a global install under nvm IS the user's.
#
# No credential is installed with it, deliberately. The dashboard passes one per
# dispatch and it is never written to this machine's disk -- so a machine that is
# deleted, snapshotted or copied takes nothing with it, and the host stays the
# only durable holder. A key baked in here would end up in every snapshot of
# every machine ever built from this point.
#
# In the PROJECT's script rather than the app's: the dashboard does not know what
# a machine is for, and a machine that runs an agent is a choice this project
# makes.

say 'installing the worker'
if bash -lc 'command -v claude >/dev/null 2>&1'; then
  say "claude is already here: $(bash -lc 'claude --version 2>/dev/null' | head -1)"
else
  # A login shell, so nvm's node and its global prefix are the ones used. Without
  # it npm is either missing or the distribution's, and a global install lands
  # somewhere root owns and the user cannot run.
  if bash -lc 'npm install -g @anthropic-ai/claude-code >/dev/null 2>&1'; then
    say "claude installed: $(bash -lc 'claude --version 2>/dev/null' | head -1)"
  else
    say 'WARNING: could not install claude -- this machine cannot be given work until it is'
  fi
fi

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
