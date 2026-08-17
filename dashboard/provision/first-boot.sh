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

# One log for every script, root's and the user's alike. Created here, owned by the
# user, so the user-half scripts can append to the same file instead of falling back
# to /tmp and splitting the record in two.
touch /var/log/okc-provision.log 2>/dev/null || true
chown "$OKC_USER:$OKC_USER" /var/log/okc-provision.log 2>/dev/null || true
chmod 0644 /var/log/okc-provision.log 2>/dev/null || true

# --- so a boot can be watched from outside ------------------------------------
#
# THE ONE THING NOTHING HERE COULD SEE. Between the power going on and the agent
# dialling in, this machine is silent: no log line, no channel, nothing to ask.
# A machine that hangs in that window is a spinning splash screen in a screenshot
# and no other evidence at all, which is exactly what happened -- eleven minutes
# on the Ubuntu logo, and VirtualBox's own log had nothing to say because from
# outside a guest that boots and then sits there looks perfectly healthy.
#
# The kernel writes to ttyS0 from its very first line, before the network and
# before systemd. VirtualBox copies that to a file on the host -- see vmSerial --
# so the whole boot can be read afterwards without anything running in here.
#
# tty0 IS KEPT FIRST so the machine's screen still shows the boot, which is what
# vmScreenshot photographs. Losing `quiet splash` is deliberate too: a splash
# screen is a picture of nothing, and the messages it hides are the ones somebody
# is looking for by the time they are taking a screenshot at all.
#
# A DROP-IN RATHER THAN AN EDIT. Ubuntu's grub-mkconfig reads /etc/default/grub
# and then everything in /etc/default/grub.d, so this adds a file instead of
# rewriting one the distribution owns -- which makes it idempotent, obvious to
# anybody looking, and removable in one line.
#
# Allowed to fail. A machine with no serial console is a machine that is harder
# to debug; a machine with a broken grub is not a machine.
if [ -d /etc/default/grub.d ] || mkdir -p /etc/default/grub.d 2>/dev/null; then
  cat > /etc/default/grub.d/99-okc-console.cfg <<'GRUBCFG'
# Written by the dashboard. The guest's console goes to the screen AND to the
# first serial port, which VirtualBox writes to a file on the host.
GRUB_CMDLINE_LINUX_DEFAULT="console=tty0 console=ttyS0,115200n8"
GRUB_TERMINAL="console serial"
GRUB_SERIAL_COMMAND="serial --unit=0 --speed=115200"
GRUBCFG
  if update-grub >/dev/null 2>&1 || grub-mkconfig -o /boot/grub/grub.cfg >/dev/null 2>&1; then
    say 'the console will be readable from the host, from the next boot'
  else
    rm -f /etc/default/grub.d/99-okc-console.cfg
    say 'WARNING: could not rebuild grub, so the console stays inside the machine'
  fi
fi


export DEBIAN_FRONTEND=noninteractive

# --- fetching a stage --------------------------------------------------------
#
# Stages are written to their own directory, never to /root/okc-<name>. The installer
# downloads THIS script to a file in /root and is executing it right now; a stage
# written to that same path would overwrite it mid-run, and bash -- which reads a
# script incrementally by byte offset -- would carry on at the old offset inside the
# new content. That silently re-ran part of this file and skipped the rest.
#
# Returns 0 if fetched, 1 if it could not be, and 2 if there is no such script.
# Telling those apart matters: some scripts are optional, and retrying ten times for
# one that does not exist wastes a hundred seconds before saying so.
fetch_stage () {
  local script="$1" target="$2"
  local url="$OKC_BASE/provision/$script?vm=$OKC_VM"

  local attempt code
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    # -w gives the status. Without -f a 404 body is written to the file, which is
    # why it is only trusted when the code is 200.
    code=$(curl -sS --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" -o "$target" -w '%{http_code}' "$url" 2>/dev/null || echo 000)
    [ "$code" = "200" ] && return 0
    if [ "$code" = "404" ]; then
      rm -f "$target"
      return 2
    fi
    say "the dashboard is not answering yet (got $code); retrying in 10s"
    sleep 10
  done

  say "gave up fetching $script"
  return 1
}

# Run as root. For anything system-wide: packages, services, /etc.
stage () {
  local script="$1"
  install -d -m 0700 /root/okc-stages
  local target="/root/okc-stages/$script"

  fetch_stage "$script" "$target"
  local got=$?
  [ $got -eq 0 ] || return $got

  say "running $script as root"
  if bash "$target"; then
    say "$script finished"
  else
    say "$script failed"
    return 1
  fi
}

# Run as the user. For anything that belongs to them: their shell files, their
# home, anything installed per-user.
#
# Genuinely as the user, not root pretending. Doing this work as root and fixing
# ownership afterwards is how a root-owned file ends up in a home directory, where
# it breaks things quietly -- dconf and anything else saving state write there.
#
# Under /tmp rather than /root, because the user cannot read /root at all.
stage_user () {
  local script="$1"
  local dir=/tmp/okc-stages
  install -d -m 0755 "$dir"
  local target="$dir/$script"

  fetch_stage "$script" "$target"
  local got=$?
  [ $got -eq 0 ] || return $got

  chown "$OKC_USER:$OKC_USER" "$target"
  chmod 0700 "$target"

  say "running $script as $OKC_USER"
  # A login shell, so it sees what the user's own shell would -- which is the whole
  # point of running it as them.
  if runuser -l "$OKC_USER" -c "bash '$target'"; then
    say "$script finished"
  else
    say "$script failed"
    return 1
  fi
}

# Says what happened, including that there was nothing to do.
report_stage () {
  case "$2" in
    0) : ;;   # it spoke for itself
    2) say "there is no $1, so there is nothing to do for that" ;;
    *) say "$1 did not finish; the machine is still usable" ;;
  esac
}

# --- reachable ---------------------------------------------------------------

# `|| true` throughout: a mirror being briefly unavailable should not abandon a
# machine half-built. The checks afterwards decide whether it worked.
apt-get -o DPkg::Lock::Timeout=600 update -y || true
apt-get -o DPkg::Lock::Timeout=600 install -y openssh-server curl ca-certificates python3 || true

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
# Because everything here runs as the user -- the agent included -- and some of what
# it is asked to do genuinely needs root. Nothing can type a password for it, so
# without this an agent could not install a package or write to /etc at all.
#
# The point is that privilege is asked for per command rather than held all the time:
# `sudo` where it is needed, ordinary user everywhere else.
#
# Passwordless is a deliberate trade, judged low risk because of what this machine is:
# a throwaway. It exists to be provisioned, used and deleted, it holds nothing that
# matters, and it can be rebuilt from nothing in one action. The thing being protected
# by a sudo password -- a long-lived system with something to lose -- is not this.
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

# Host keys first. `sshd -t` refuses to validate anything at all without them, and at
# this point in an install they may not have been generated yet -- the package's own
# setup does it later or on first boot. That made the check below fail for a reason
# that had nothing to do with the config, and the config was then thrown away.
#
# `ssh-keygen -A` creates only the ones that are missing, so it is safe to run again,
# and a machine with no host keys could not accept ssh anyway.
ssh-keygen -A >/dev/null 2>&1 || say 'could not generate ssh host keys'

# And the privilege separation directory, for the same reason and found the same
# way. `sshd -t` refuses with "Missing privilege separation directory: /run/sshd"
# when it is absent -- which it is during an install, because /run is a tmpfs
# populated at boot and the ssh service is what normally creates this. So the
# check failed, the config was deleted, and the machine came up with
# `permitrootlogin without-password` while the install reported success.
#
# The same trap twice now: sshd -t answering about its own surroundings rather
# than about the file being tested. Anything it needs is made first, so that when
# it does refuse, the refusal is about the config.
mkdir -p /run/sshd 2>/dev/null && chmod 0755 /run/sshd 2>/dev/null || say 'could not make /run/sshd'

install -d -m 0755 /etc/ssh/sshd_config.d
cat >/etc/ssh/sshd_config.d/10-okc.conf <<'SSHCFG'
PermitRootLogin no
PermitEmptyPasswords no
MaxAuthTries 3
LoginGraceTime 20
SSHCFG

# Checked before restarting. A bad config plus a restart is a machine with no ssh at
# all, which is the one failure that cannot be fixed remotely.
#
# The reason is captured and reported rather than swallowed: "did not check out" with
# no detail is a guess, and this exact step failed once for a reason the message could
# not have revealed.
if ssh_why=$(sshd -t 2>&1); then
  systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null || true

  # READ BACK what sshd will actually use, rather than reporting that a file was
  # written. Those are different claims, and the gap between them is where this
  # went wrong twice: the file was written both times, and both times something
  # else removed it or ignored it, while the log said the machine was tightened.
  #
  # Asked of sshd rather than of the file, because the file is our copy of the
  # intention and this is the answer.
  ssh_now=$(sshd -T 2>/dev/null | grep -i '^permitrootlogin' | awk '{print $2}')
  if [ "$ssh_now" = "no" ]; then
    say 'ssh is tightened: no root login, no empty passwords'
  else
    say "WARNING: ssh still says permitrootlogin=${ssh_now:-unknown}, so the machine is NOT tightened"
  fi
else
  rm -f /etc/ssh/sshd_config.d/10-okc.conf
  say "WARNING: ssh would not accept that config, so it was removed. sshd said: ${ssh_why:-nothing}"
fi

# --- the agent that dials the dashboard --------------------------------------
#
# The dashboard listens and this machine dials in, not the other way round. So a
# reboot is an ordinary reconnect rather than something anyone has to handle, and
# the dashboard can run things here without needing a way in.

say 'installing the agent that dials the dashboard'

if curl -fsSL --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" "$OKC_BASE/provision/agent.py?vm=$OKC_VM" -o /usr/local/sbin/okc-agent.py; then
  chmod 755 /usr/local/sbin/okc-agent.py

  # The token goes in a file readable only by root, not into the unit, because
  # `systemctl cat` prints a unit to anyone who asks.
  install -m 600 /dev/null /etc/okc-agent.env
  cat > /etc/okc-agent.env <<ENV
OKC_VM=$OKC_VM
OKC_TOKEN=$OKC_TOKEN
OKC_HOST=$OKC_HOST
OKC_CHANNEL_PORT=$OKC_CHANNEL_PORT
OKC_CA=$OKC_CA
# Who the agent runs commands as. It is root itself, so without this every command
# sent here would be root's.
OKC_USER=$OKC_USER
ENV

  cat > /etc/systemd/system/okc-agent.service <<UNIT
[Unit]
Description=Dial the dashboard and stay connected

# NOT network-online.target, and the Wants is the part that mattered.
#
# `Wants=network-online.target` does not mean "start me once the network is up";
# it PULLS THAT TARGET IN, which on a desktop Ubuntu drags in
# NetworkManager-wait-online and blocks the boot until it is satisfied or times
# out. So this service was the reason a machine sat at the Ubuntu splash for
# minutes -- and the worse the network, the longer it sat, which is exactly
# backwards for the one service whose job is to report that the machine is
# having trouble.
#
# It does not need the network to be up. It retries for ever with a backoff and
# a reboot is an ordinary reconnect, so starting early and failing twice costs
# nothing and starting late costs the operator their visibility.
#
# AND NOT time-sync.target EITHER, which was tried and hung a machine solid.
#
# The reasoning was sound: this agent speaks TLS, a certificate is only valid
# between two dates, and a machine whose clock is wrong reports a certificate
# error rather than a time one. So it was ordered after time-sync.target, which
# systemd-time-wait-sync holds open until the clock is synchronised.
#
# That job waits with NO LIMIT. On a machine whose clock is set by the guest
# additions rather than by timesyncd, it never finishes — so the agent never
# started, the machine never dialled in, and it sat there with a working desktop
# looking perfectly healthy. Exactly the failure the paragraph above describes,
# repeated one line below it.
#
# The clock is made right EARLY instead, by things that cannot block a boot —
# see toolchain.sh. Nothing here waits on a target that has no timeout.
After=network.target

[Service]
# As the user, not root. Nothing the agent does needs root, and running it as root
# only because it could is how work ends up owned by root in somebody's home.
# Anything privileged says sudo in the command instead.
User=$OKC_USER
Group=$OKC_USER

# Read by systemd, which is root, BEFORE dropping to the user -- so the token can
# stay in a file the user cannot open.
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
  # RESTART, not start.
  #
  # `start` does nothing to a service that is already running, so re-running this
  # on a live machine rewrote the agent and its environment and then left the old
  # process running against them -- reporting success while changing nothing that
  # was actually in effect. Found the hard way: after the channel moved to TLS the
  # agent was reinstalled, said it had started, and went on failing to connect
  # because the running copy was still the plain-socket one from before.
  systemctl restart okc-agent.service 2>/dev/null || systemctl start okc-agent.service 2>/dev/null || true
  say 'the agent will dial in on the next boot'
else
  say 'WARNING: could not fetch the agent, so this machine will not dial in'
fi

# --- run on every boot from now on -------------------------------------------
#
# Installed rather than run: this boot has already had the whole first-boot
# treatment, and normal-boot.sh is for the ordinary ones after it.

if curl -fsSL --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" "$OKC_BASE/provision/normal-boot.sh?vm=$OKC_VM" -o /usr/local/sbin/okc-normal-boot; then
  chmod +x /usr/local/sbin/okc-normal-boot
  cat > /etc/systemd/system/okc-boot.service <<UNIT
[Unit]
Description=Tell the dashboard this machine is up
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
# As the user too. It reports in and reads a few facts; none of that needs root.
User=$OKC_USER
Group=$OKC_USER
EnvironmentFile=/etc/okc-agent.env
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
# Four scripts, in order, and every one allowed to fail: a machine with no toolchain
# is still a usable machine that can be reached and provisioned again, whereas one
# with no agent is not.
#
# Root and user are separate scripts rather than one script switching user
# mid-flight. Which of the two something needs is not a detail -- packages and
# services are root's, and a shell file or a per-user install is the user's, and
# mixing them is how a home directory ends up owned by root.
#
# The app's pair first, so every machine has the same baseline. Then the project's
# pair, which ADDS to it rather than replacing it.

stage toolchain.sh;      report_stage 'the toolchain' $?

# A SCREEN, ONLY IF THIS MACHINE WAS BUILT TO HAVE ONE.
#
# Every machine is installed from the server image, so a desktop is something
# ADDED here rather than something stripped out later. Most runners never show
# anybody anything, and the display stack is most of what they would otherwise
# spend their boot and their memory on.
#
# Before the user's half, because the user's shell files and anything per-user
# may want a DISPLAY to exist.
if [ "${OKC_DESKTOP:-yes}" = yes ]; then
  stage desktop.sh;      report_stage 'the desktop' $?
  stage wallpaper.sh;    report_stage 'the wallpaper' $?
else
  say 'this machine was built with no display, so no desktop is being installed'
fi

stage_user toolchain-user.sh; report_stage "the user's toolchain" $?

# A SUPERVISOR GETS THE APP'S HALF AND STOPS THERE.
#
# The project's pair is what a machine needs in order to do WORK: its
# repositories, its build inputs, its devices. A supervisor is never given a
# task — the queue will not hand one to a machine carrying the supervisor tag —
# so all of that is weight it carries and never uses, and half of it is setup for
# hardware that is not plugged into it.
#
# What it gets instead is slim and is the app's own: node is already here from
# toolchain-user.sh, and supervisor-user.sh adds Claude Code. That is the whole
# of it, because deciding what work to give needs nothing else.
if [ "${OKC_SUPERVISOR:-no}" = yes ]; then
  say 'this machine is a supervisor, so the project setup is skipped -- it takes no tasks'
  # The user half first: the desk's profile points at the claude it installs, so
  # the root half has something to point at.
  stage_user supervisor-user.sh; report_stage 'the supervisor setup' $?
  stage supervisor.sh;           report_stage 'the sign-in desk' $?
else
  stage extra.sh;          report_stage "this project's extra setup" $?
  stage_user extra-user.sh;    report_stage "this project's extra user setup" $?
fi

say 'first boot finished'
report online
