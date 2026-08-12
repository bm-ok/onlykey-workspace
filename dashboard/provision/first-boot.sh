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

# --- dial the dashboard, now and on every boot --------------------------------
#
# The dashboard listens and this machine dials in, not the other way round. So a
# reboot is an ordinary reconnect rather than something anyone has to handle, and
# the dashboard can run things here without needing a way in.
#
# Python 3, because Ubuntu already has it. Installing a runtime first would mean
# the thing that reports progress could not report the failure to install it.

say 'installing the agent that dials the dashboard'
apt-get install -y python3 >/dev/null 2>&1 || true

if curl -fsSL "$OKC_BASE/provision/agent.py?vm=$OKC_VM" -o /usr/local/sbin/okc-agent.py; then
  chmod 755 /usr/local/sbin/okc-agent.py

  # The token goes in a file read only by root, not into the unit, because
  # `systemctl show` and `systemctl cat` print a unit to anyone who asks.
  install -m 600 /dev/null /etc/okc-agent.env
  cat > /etc/okc-agent.env <<ENV
OKC_VM=$OKC_VM
OKC_TOKEN=$OKC_TOKEN
OKC_HOST=$OKC_HOST
OKC_CHANNEL_PORT=$OKC_CHANNEL_PORT
ENV

  cat > /etc/systemd/system/okc-agent.service <<UNIT
[Unit]
Description=Dial the dashboard and stay connected
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=/etc/okc-agent.env
ExecStart=/usr/bin/python3 /usr/local/sbin/okc-agent.py
# It reconnects on its own, but if it dies outright systemd should bring it back --
# a machine nobody can reach is the one state that cannot report itself.
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload
  systemctl enable --now okc-agent.service
  say 'the agent is running; this machine should now show as connected'
else
  say 'WARNING: could not fetch the agent, so this machine will not dial in'
fi

say "first boot finished"
