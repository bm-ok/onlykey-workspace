#!/bin/bash
# Run once, as root, on a brand new machine.
#
# Deliberately almost empty. The only things here are what this app needs to be
# able to reach the machine at all -- an ssh server, and a key if one was given.
# Anything a particular machine needs belongs in toolchain.sh, which is the one
# meant to be swapped.
#
# A header of OKC_* variables and a `say` helper is prepended by the dashboard.

set -u

say "first boot: making the machine reachable"

export DEBIAN_FRONTEND=noninteractive

# `|| true` throughout: a mirror being briefly unavailable should not abandon a
# machine half-built. The checks afterwards are what decide whether it worked.
apt-get update -y || true
apt-get install -y openssh-server curl ca-certificates || true

systemctl enable --now ssh 2>/dev/null || systemctl enable --now sshd 2>/dev/null || true

if command -v sshd >/dev/null 2>&1 || systemctl is-active --quiet ssh 2>/dev/null; then
  say "ssh is up"
else
  say "WARNING: no ssh server is running, so nothing will be able to log in remotely"
fi

# --- the key, if there is one -------------------------------------------------

if [ -n "${OKC_SSH_KEY:-}" ]; then
  home="/home/$OKC_USER"
  say "adding an ssh key for $OKC_USER"
  install -d -m 700 "$home/.ssh"
  # Appended, not overwritten: a machine may already have keys that matter.
  printf '%s\n' "$OKC_SSH_KEY" >> "$home/.ssh/authorized_keys"
  chmod 600 "$home/.ssh/authorized_keys"
  chown -R "$OKC_USER:$OKC_USER" "$home/.ssh"
else
  say "no ssh key was given, so a password is the only way in"
fi

say "first boot finished"
