#!/bin/bash
# What this machine is for, as opposed to making it exist.
#
# THIS IS THE ONE TO SWAP. The other scripts make a machine exist and be
# reachable, which is the same job every time. This one is about what kind of
# machine it is -- so point a VM at your own copy and this file stops being
# involved.
#
# What it sets up: a desktop that stays logged in and never locks, a usable
# DISPLAY, docker, and node through nvm as the user rather than as root.
#
# Several things below look fussy and are not. Each is marked, because each one
# was found the hard way.
#
# A header of OKC_* values and `say`/`report` helpers is prepended by the
# dashboard. The VM's own setup steps, if it declares any, are appended after.

set -u

say 'toolchain: starting'

export DEBIAN_FRONTEND=noninteractive
apt-get update -y || true

# --- the basics --------------------------------------------------------------

say 'installing build tools, curl and git'
apt-get install -y \
  build-essential make tar git curl wget unzip pkg-config ca-certificates \
  python3-pip python3-venv \
  usbutils kmod \
  x11-utils x11-xserver-utils dconf-cli \
  || say 'some packages did not install; carrying on'

# --- docker ------------------------------------------------------------------
#
# The user is added to the docker group so docker works without sudo. That takes
# effect on their NEXT login, not this instant -- group membership is read at
# session start.

say 'installing docker'
if apt-get install -y docker.io docker-compose-v2 2>/dev/null || apt-get install -y docker.io; then
  systemctl enable docker 2>/dev/null || true
  systemctl start docker 2>/dev/null || true
  usermod -aG docker "$OKC_USER" || true
  say "docker installed; $OKC_USER is in the docker group from their next login"
else
  say 'WARNING: docker did not install'
fi

# --- device access -----------------------------------------------------------
#
# plugdev for USB devices, dialout for serial ports. Group membership is read when
# a session starts, so like the docker group this applies at their next login.
# Added even when nothing is plugged in: a machine that needs it later should not
# need provisioning again to get it.

if getent group plugdev >/dev/null 2>&1; then
  usermod -aG plugdev "$OKC_USER" || true
fi
if getent group dialout >/dev/null 2>&1; then
  usermod -aG dialout "$OKC_USER" || true
fi
say "$OKC_USER can reach usb and serial devices from their next login"

# --- a desktop that stays logged in and never locks ---------------------------
#
# Three things have to be true, and none is the default:
#   - somebody is logged in                              (autologin)
#   - the session is X11, so DISPLAY=:0 means something   (Wayland off)
#   - it never blanks, locks or idles away                (dconf system db)

if [ -f /etc/gdm3/custom.conf ]; then
  say 'setting up autologin on X11'
  # Edited with a parser rather than sed: the file has sections, and appending a
  # key to the wrong one silently does nothing.
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

# A dconf SYSTEM database rather than per-user gsettings: it applies to whoever
# logs in and survives a profile reset, so the machine cannot quietly start
# locking itself again months later.
install -d -m 0755 /etc/dconf/db/local.d /etc/dconf/profile
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
install -d -m 0755 /etc/dconf/db/local.d/locks
cat >/etc/dconf/db/local.d/locks/00-okc <<'LOCKS'
/org/gnome/desktop/screensaver/lock-enabled
/org/gnome/desktop/screensaver/idle-activation-enabled
/org/gnome/desktop/session/idle-delay
/org/gnome/settings-daemon/plugins/power/sleep-inactive-ac-type
/org/gnome/settings-daemon/plugins/power/sleep-inactive-battery-type
LOCKS

dconf update || say 'WARNING: dconf update failed; the screen may still blank'

# Let root reach the user's display without hunting for an XAUTHORITY file, whose
# path depends on the session uid. Granting access from inside the session
# sidesteps that, so DISPLAY=:0 alone is enough.
#
# Both directory levels get ownership explicitly: `install -d` applies it to the
# LAST component only, and a root-owned ~/.config is not cosmetic -- dconf,
# gsettings and anything saving state write there, and they fail quietly.
install -d -o "$OKC_USER" -g "$OKC_USER" -m 0755 "/home/$OKC_USER/.config"
install -d -o "$OKC_USER" -g "$OKC_USER" -m 0755 "/home/$OKC_USER/.config/autostart"
cat >"/home/$OKC_USER/.config/autostart/okc-xhost.desktop" <<'AUTOSTART'
[Desktop Entry]
Type=Application
Name=okc: allow root to reach this display
Exec=xhost +SI:localuser:root
Terminal=false
NoDisplay=true
X-GNOME-Autostart-enabled=true
AUTOSTART
chown "$OKC_USER:$OKC_USER" "/home/$OKC_USER/.config/autostart/okc-xhost.desktop"

say 'NOTE: autologin, X11 and the no-lock settings apply on the NEXT boot'

# --- DISPLAY for shells ------------------------------------------------------
#
# Guarded, because this script is meant to be run again.

BASHRC="/home/$OKC_USER/.bashrc"
if ! grep -q 'okc: DISPLAY' "$BASHRC" 2>/dev/null; then
  cat >>"$BASHRC" <<'BASHRC_ADD'

# okc: DISPLAY so anything run from a shell can reach the desktop session.
export DISPLAY=:0
BASHRC_ADD
  chown "$OKC_USER:$OKC_USER" "$BASHRC"
  say "added DISPLAY=:0 to $OKC_USER's .bashrc"
else
  say 'DISPLAY is already in .bashrc'
fi

# --- node, through nvm, as the user ------------------------------------------
#
# As the user rather than as root, because that is where nvm puts it and where
# anyone working on this machine will expect to find it.

say "installing nvm and node LTS as $OKC_USER"
runuser -l "$OKC_USER" -c '
  set -e
  export NVM_DIR="$HOME/.nvm"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  fi
  . "$NVM_DIR/nvm.sh"
  nvm install --lts
  nvm alias default "lts/*"
  echo "node $(node --version), npm $(npm --version)"
' || say "WARNING: nvm or node did not install for $OKC_USER"

# nvm's installer appends its setup to ~/.bashrc, and Ubuntu's own .bashrc opens
# with:
#
#     case $- in *i*) ;; *) return;; esac
#
# So for any NON-interactive shell -- which is what a dispatched command is --
# .bashrc returns immediately, nvm never loads, and `node` silently resolves to
# the system one instead. That is not a broken install; it is a different node
# than the one the machine was set up with.
#
# ~/.profile has no interactivity guard and IS read by login shells, so it goes
# there too. Guarded, because this script re-runs.
PROFILE_FILE="/home/$OKC_USER/.profile"
if ! grep -q 'okc: load nvm' "$PROFILE_FILE" 2>/dev/null; then
  cat >>"$PROFILE_FILE" <<'PROFILE_ADD'

# okc: load nvm for non-interactive login shells as well.
# .bashrc returns early when not interactive, so nvm's own setup never runs for
# commands sent to this machine. Without this, `node` is the system one.
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
PROFILE_ADD
  chown "$OKC_USER:$OKC_USER" "$PROFILE_FILE"
fi

# Proved the way a sent command will see it, not the way an interactive shell
# would -- those are different, and the difference is the whole point above.
runuser -l "$OKC_USER" -c 'echo "login shell sees node at $(command -v node || echo MISSING) $(node --version 2>/dev/null)"' || true

say 'toolchain finished'
