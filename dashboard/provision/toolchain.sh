#!/bin/bash
# What this machine is for — the ROOT half.
#
# System-wide things only: packages, services, group membership, files under /etc.
# Anything belonging to the user is in toolchain-user.sh, which runs as them.
#
# The split is not tidiness. Doing user-space work as root and fixing ownership
# afterwards is how a root-owned file ends up in a home directory, where it fails
# quietly -- dconf, gsettings and anything else saving state write there.
#
# THIS IS THE BASELINE, and every machine gets it. A project adds to it with
# extra.sh rather than replacing it.
#
# A header of OKC_* values and `say`/`report` helpers is prepended by the dashboard.

set -u

say 'toolchain (root): starting'

export DEBIAN_FRONTEND=noninteractive
apt-get update -y || true

# --- packages ----------------------------------------------------------------

say 'installing build tools, curl and git'
apt-get install -y \
  build-essential make tar git curl wget unzip pkg-config ca-certificates \
  python3-pip python3-venv \
  usbutils kmod \
  x11-utils x11-xserver-utils dconf-cli \
  || say 'some packages did not install; carrying on'

# --- docker ------------------------------------------------------------------

say 'installing docker'
if apt-get install -y docker.io docker-compose-v2 2>/dev/null || apt-get install -y docker.io; then
  systemctl enable docker 2>/dev/null || true
  systemctl start docker 2>/dev/null || true
  usermod -aG docker "$OKC_USER" || true
  say 'docker installed'
else
  say 'WARNING: docker did not install'
fi

# --- device access -----------------------------------------------------------
#
# plugdev for USB, dialout for serial. Added even when nothing is plugged in, so a
# machine that needs it later does not need provisioning again.

for group in plugdev dialout; do
  getent group "$group" >/dev/null 2>&1 && usermod -aG "$group" "$OKC_USER" || true
done

# Group membership is read when a session starts, so none of the three above apply
# to a shell that is already open.
say "$OKC_USER is in docker, plugdev and dialout from their next login"

# --- a desktop that stays logged in and never locks ---------------------------
#
# Three things have to be true, and none is the default:
#   - somebody is logged in                              (autologin)
#   - the session is X11, so DISPLAY=:0 means something   (Wayland off)
#   - it never blanks, locks or idles away                (dconf system db)

if [ -f /etc/gdm3/custom.conf ]; then
  say 'setting up autologin on X11'
  # A config parser rather than sed: the file has sections, and appending a key to
  # the wrong one silently does nothing.
  python3 - "$OKC_USER" <<'PYCONF'
import configparser, sys
user = sys.argv[1]
path = '/etc/gdm3/custom.conf'
cp = configparser.ConfigParser()
cp.optionxform = str
cp.read(path)
if not cp.has_section('daemon'):
    cp.add_section('daemon')
cp.set('daemon', 'AutomaticLoginEnable', 'true')
cp.set('daemon', 'AutomaticLogin', user)
# DISPLAY=:0 is not a stable target under Wayland, and anything driving the GUI
# depends on it.
cp.set('daemon', 'WaylandEnable', 'false')
with open(path, 'w') as fh:
    cp.write(fh, space_around_delimiters=False)
print('gdm3 set to log in', user, 'automatically, on X11')
PYCONF
else
  say 'no /etc/gdm3/custom.conf, so no autologin to configure — not a desktop image?'
fi

say 'turning off the screensaver, the lock screen and idle blanking'

# A dconf SYSTEM database rather than per-user gsettings: it applies to whoever logs
# in and survives a profile reset, so the machine cannot quietly start locking itself
# again months later.
install -d -m 0755 /etc/dconf/db/local.d /etc/dconf/profile /etc/dconf/db/local.d/locks
cat >/etc/dconf/profile/user <<'PROFILE'
user-db:user
system-db:local
PROFILE

cat >/etc/dconf/db/local.d/00-okc <<'DCONF'
[org/gnome/desktop/screensaver]
lock-enabled=false
idle-activation-enabled=false

[org/gnome/desktop/session]
idle-delay=uint32 0

[org/gnome/settings-daemon/plugins/power]
sleep-inactive-ac-type='nothing'
sleep-inactive-battery-type='nothing'
idle-dim=false
DCONF

# LOCKS, not just defaults. The profile puts user-db first, so without these
# anything already in the user's own dconf wins and the machine starts locking
# itself again.
cat >/etc/dconf/db/local.d/locks/00-okc <<'LOCKS'
/org/gnome/desktop/screensaver/lock-enabled
/org/gnome/desktop/screensaver/idle-activation-enabled
/org/gnome/desktop/session/idle-delay
/org/gnome/settings-daemon/plugins/power/sleep-inactive-ac-type
/org/gnome/settings-daemon/plugins/power/sleep-inactive-battery-type
LOCKS

dconf update || say 'WARNING: dconf update failed; the screen may still blank'

say 'NOTE: autologin, X11 and the no-lock settings apply on the NEXT boot'
say 'toolchain (root) finished'
