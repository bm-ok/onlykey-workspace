#!/bin/bash
# What this machine is for — the USER half.
#
# Runs as the user, in a login shell, not as root. So everything it writes is theirs
# by construction: no `chown` afterwards, no `install -o`, and no chance of leaving a
# root-owned file in a home directory where it would fail quietly.
#
# System-wide things are in toolchain.sh, which runs first as root. If something here
# needs a package, that is where the package belongs.
#
# THIS IS THE BASELINE for the user's side, and every machine gets it. A project adds
# to it with extra-user.sh rather than replacing it.
#
# A header of OKC_* values and `say`/`report` helpers is prepended by the dashboard.
# $HOME and $USER are the user's own here, so nothing needs to be told who they are.

set -u

say "toolchain (user): starting as $(id -un) in $HOME"

# --- DISPLAY for shells ------------------------------------------------------
#
# In BOTH files, and the second one is the one that matters.
#
# Ubuntu's .bashrc opens with `case $- in *i*) ;; *) return;; esac`, so for a
# NON-interactive shell it returns before reaching anything added to it -- and a
# command sent to this machine runs in exactly that kind of shell. Putting DISPLAY
# only in .bashrc gave an interactive shell ":0" and a dispatched command an empty
# variable, so anything driving the desktop failed while the desktop was working
# perfectly.
#
# This is the same trap as nvm below, found the same way: by asking a login shell
# rather than trusting an interactive one.
#
# Both guarded, because this is meant to be run again.

if ! grep -q 'okc: DISPLAY' "$HOME/.bashrc" 2>/dev/null; then
  cat >>"$HOME/.bashrc" <<'BASHRC_ADD'

# okc: DISPLAY so anything run from a shell can reach the desktop session.
export DISPLAY=:0
BASHRC_ADD
  say 'added DISPLAY=:0 to .bashrc, for interactive shells'
fi

if ! grep -q 'okc: DISPLAY' "$HOME/.profile" 2>/dev/null; then
  cat >>"$HOME/.profile" <<'PROFILE_DISPLAY'

# okc: DISPLAY for non-interactive login shells as well.
# .bashrc returns early when not interactive, so a command sent to this machine
# would otherwise see no DISPLAY at all and be unable to reach the session.
export DISPLAY=:0
PROFILE_DISPLAY
  say 'added DISPLAY=:0 to .profile, which is what dispatched commands read'
fi

# --- already welcomed ---------------------------------------------------------
#
# The packages are removed in the root half, but the wizard also keys off a marker in
# the user's own config -- and if it is ever reinstalled, this is what stops it asking
# again. A per-user file, written by the user, which is why it is here rather than
# there.
#
# The file must contain "yes"; an empty file is not enough.

mkdir -p "$HOME/.config"
printf 'yes\n' >"$HOME/.config/gnome-initial-setup-done"
say 'marked the welcome wizard as already done'

# --- let root reach this display ----------------------------------------------
#
# The agent runs as root while the session belongs to this user, and the Xauthority
# path depends on the session uid -- brittle, and wrong the moment a machine has a
# different first user. Granting access from inside the session sidesteps all of it,
# so DISPLAY=:0 alone is then enough.
#
# Written by the user, into the user's own home, which is exactly why this half of
# the work is a separate script.

mkdir -p "$HOME/.config/autostart"
cat >"$HOME/.config/autostart/okc-xhost.desktop" <<'AUTOSTART'
[Desktop Entry]
Type=Application
Name=okc: allow root to reach this display
Exec=xhost +SI:localuser:root
Terminal=false
NoDisplay=true
X-GNOME-Autostart-enabled=true
AUTOSTART
say 'root will be able to reach this display from the next session'

# --- node, through nvm --------------------------------------------------------
#
# Per user, which is where nvm puts it and where anyone working here will expect to
# find it.

export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  say 'installing nvm'
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash >/dev/null 2>&1 \
    || say 'WARNING: nvm did not install'
fi

if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  say 'installing node LTS'
  if nvm install --lts >/dev/null 2>&1 && nvm alias default "lts/*" >/dev/null 2>&1; then
    say "node $(node --version), npm $(npm --version)"
  else
    say 'WARNING: node did not install'
  fi
fi

# nvm's installer appends its setup to ~/.bashrc, and Ubuntu's own .bashrc opens
# with:
#
#     case $- in *i*) ;; *) return;; esac
#
# So for any NON-interactive shell -- which is what a command sent to this machine
# is -- .bashrc returns immediately, nvm never loads, and `node` silently resolves to
# the system one instead. That is not a broken install; it is a different node than
# the one this machine was set up with.
#
# ~/.profile has no interactivity guard and IS read by login shells, so it goes there
# too. Guarded, because this re-runs.
if ! grep -q 'okc: load nvm' "$HOME/.profile" 2>/dev/null; then
  cat >>"$HOME/.profile" <<'PROFILE_ADD'

# okc: load nvm for non-interactive login shells as well.
# .bashrc returns early when not interactive, so nvm's own setup never runs for
# commands sent to this machine. Without this, `node` is the system one.
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
PROFILE_ADD
  say 'nvm will load for non-interactive login shells too'
fi

# Proved the way a sent command will see it, rather than the way this script already
# sees it -- those differ, and the difference is the whole point above.
say "a fresh login shell finds: $(bash -lc 'command -v node || echo MISSING') $(bash -lc 'node --version 2>/dev/null')"

say 'toolchain (user) finished'
