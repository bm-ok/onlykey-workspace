#!/bin/bash
# Run once, at the end of the install. The installer is told about this script and
# no other; it decides what else to fetch and in what order.
#
# It has two jobs. First, make the machine reachable at all -- an ssh server, a key
# if one was given, and the agent that dials the dashboard. Then hand over to
# toolchain.sh, which is the swappable one, and install normal-boot.sh for every
# boot after this.
#
# "First boot" is a slight lie worth knowing about: this runs in the installer's
# post-install stage, before the installed system has ever booted. So `systemctl
# enable --now` may not be able to start anything here -- what matters is that
# `enable` persists, and the services come up on the first real boot.
#
# A header of OKC_* values and `say`/`report` helpers is prepended by the dashboard.

set -u

say "first boot: making the machine reachable"
report installing

export DEBIAN_FRONTEND=noninteractive

# --- fetch and run another script -------------------------------------------
#
# Written to its own directory, NOT to /root/okc-<name>. The installer downloads
# THIS script to a file in /root and is executing it right now; if a stage were
# written to that same path, bash -- which reads a script incrementally by byte
# offset -- would carry on at the old offset inside the new content. That produced
# a partial re-run of this script's tail and silently skipped everything after it.
stage () {
  local script="$1"
  local target="/root/okc-stages/$script"
  install -d /root/okc-stages

  say "fetching $script"
  local ok=""
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsSL "$OKC_BASE/provision/$script?vm=$OKC_VM" -o "$target"; then ok=yes; break; fi
    if wget -qO "$target" "$OKC_BASE/provision/$script?vm=$OKC_VM"; then ok=yes; break; fi
    say "the dashboard is not answering yet; retrying in 10s"
    sleep 10
  done

  if [ -z "$ok" ]; then
    say "gave up fetching $script"
    return 1
  fi

  say "running $script"
  if bash "$target"; then
    say "$script finished"
  else
    say "$script failed"
    return 1
  fi
}

# --- reachable ---------------------------------------------------------------

# `|| true` throughout: a mirror being briefly unavailable should not abandon a
# machine half-built. The checks afterwards decide whether it worked.
apt-get update -y || true
apt-get install -y openssh-server curl ca-certificates python3 || true

systemctl enable --now ssh 2>/dev/null || systemctl enable --now sshd 2>/dev/null || true
systemctl enable ssh 2>/dev/null || true

if command -v sshd >/dev/null 2>&1; then
  say 'ssh is installed'
else
  say 'WARNING: no ssh server, so nothing will be able to log in remotely'
fi

# Only written when there is a key to put in it. An authorized_keys that exists and
# is empty reads as configured and authorises nobody, which gets diagnosed as "ssh
# is broken" rather than "no key was ever installed".
if [ -n "${OKC_SSH_KEY:-}" ]; then
  home="/home/$OKC_USER"
  say "adding your ssh key for $OKC_USER"
  install -d -o "$OKC_USER" -g "$OKC_USER" -m 0700 "$home/.ssh"
  AUTH="$home/.ssh/authorized_keys"
  touch "$AUTH"
  # Appended and de-duplicated. This script is meant to be run again, so it must
  # neither pile up copies of the same key nor discard one added by hand.
  if grep -qxF "$OKC_SSH_KEY" "$AUTH"; then
    say 'your key was already there'
  else
    printf '%s\n' "$OKC_SSH_KEY" >>"$AUTH"
    say 'your key is installed, so ssh and VS Code Remote can connect without a password'
  fi
  chmod 0600 "$AUTH"
  chown -R "$OKC_USER:$OKC_USER" "$home/.ssh"
else
  say 'no ssh key was given, so a password is the only way in'
fi

# --- sudo without a password -------------------------------------------------
#
# So the user can do privileged things unattended. The agent runs as root and does
# not need this; a person or a script working as the user does.
#
# Validated before it is trusted, and discarded if it does not parse: an invalid
# file in /etc/sudoers.d breaks sudo for everyone, and that machine has to be
# rescued from a console rather than fixed over ssh. Written under a temporary name
# so a bad file is never in place even briefly.

say "giving $OKC_USER sudo without a password"
SUDO_TMP=/etc/sudoers.d/.okc-new
printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$OKC_USER" >"$SUDO_TMP"
chmod 0440 "$SUDO_TMP"
if visudo -cf "$SUDO_TMP" >/dev/null 2>&1; then
  mv "$SUDO_TMP" /etc/sudoers.d/50-okc
  say 'sudo needs no password now'
else
  rm -f "$SUDO_TMP"
  say 'WARNING: that sudoers file did not parse, so it was not installed'
fi

# --- tighten ssh -------------------------------------------------------------
#
# A drop-in rather than an edit to sshd_config, so a package upgrade does not fight
# it. Password login is left ON deliberately: it is the only way in when no key was
# given, and turning it off here would lock out exactly that case.

say 'tightening ssh'
install -d -m 0755 /etc/ssh/sshd_config.d
cat >/etc/ssh/sshd_config.d/10-okc.conf <<'SSHCFG'
PermitRootLogin no
PermitEmptyPasswords no
MaxAuthTries 3
LoginGraceTime 20
SSHCFG
# Checked before restarting. A bad config plus a restart is a machine with no ssh
# at all, which is the one failure that cannot be fixed remotely.
if sshd -t 2>/dev/null; then
  systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null || true
  say 'ssh is tightened: no root login, no empty passwords'
else
  rm -f /etc/ssh/sshd_config.d/10-okc.conf
  say 'WARNING: that ssh config did not check out, so it was removed'
fi

# --- the agent that dials the dashboard --------------------------------------
#
# The dashboard listens and this machine dials in, not the other way round. So a
# reboot is an ordinary reconnect rather than something anyone has to handle, and
# the dashboard can run things here without needing a way in.

say 'installing the agent that dials the dashboard'

if curl -fsSL "$OKC_BASE/provision/agent.py?vm=$OKC_VM" -o /usr/local/sbin/okc-agent.py; then
  chmod 755 /usr/local/sbin/okc-agent.py

  # The token goes in a file readable only by root, not into the unit, because
  # `systemctl cat` prints a unit to anyone who asks.
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

  systemctl daemon-reload 2>/dev/null || true
  systemctl enable okc-agent.service 2>/dev/null || true
  systemctl start okc-agent.service 2>/dev/null || true
  say 'the agent will dial in on the next boot'
else
  say 'WARNING: could not fetch the agent, so this machine will not dial in'
fi

# --- run on every boot from now on -------------------------------------------
#
# Installed rather than run: this boot has already had the whole first-boot
# treatment, and normal-boot.sh is for the ordinary ones after it.

if curl -fsSL "$OKC_BASE/provision/normal-boot.sh?vm=$OKC_VM" -o /usr/local/sbin/okc-normal-boot; then
  chmod +x /usr/local/sbin/okc-normal-boot
  cat > /etc/systemd/system/okc-boot.service <<UNIT
[Unit]
Description=Tell the dashboard this machine is up
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/okc-normal-boot
RemainAfterExit=no

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload 2>/dev/null || true
  systemctl enable okc-boot.service 2>/dev/null || true
  say 'every boot will now check in with the dashboard'
fi

# --- what this machine is for ------------------------------------------------
#
# Last, and allowed to fail: a machine with no toolchain is still a usable machine
# that can be reached and re-provisioned, whereas one with no agent is not.
stage toolchain.sh || say 'carrying on without the toolchain; run it again later'

say 'first boot finished'
report online
