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
apt-get -o DPkg::Lock::Timeout=600 update -y || true

# --- packages ----------------------------------------------------------------

say 'installing build tools, curl and git'
# `virtualbox-guest-utils` IS THE USER-SPACE HALF OF THE GUEST ADDITIONS, and it
# is here rather than in the installer for the reason ../autoinstall-user-data
# sets out: the installer has no package index, and this runs where apt works.
#
# NOT COMPILED. Ubuntu already ships the kernel half -- vboxguest and vboxsf --
# so there is nothing to build and no need for dkms or linux-headers. What this
# adds is the mount helper a shared folder needs and the time sync.
#
# ON EVERY MACHINE, not only ones with a screen: a share does not need a
# desktop. The X-only parts are in ./desktop.sh.
apt-get -o DPkg::Lock::Timeout=600 install -y \
  build-essential make tar git curl wget unzip pkg-config ca-certificates \
  python3-pip python3-venv \
  usbutils kmod \
  virtualbox-guest-utils \
  x11-utils x11-xserver-utils dconf-cli \
  || say 'some packages did not install; carrying on'

# --- the clock ---------------------------------------------------------------
#
# THE ONE THING THE GUEST ADDITIONS DO THAT A HEADLESS RUNNER ACTUALLY NEEDS.
#
# Everything else they offer is about somebody sitting in front of the machine:
# the mouse not being trapped, the clipboard, dragging files in, resizing the
# window. A runner holding a terminal uses none of it. Time is different — a
# machine whose clock is wrong cannot verify this host's certificate, argues with
# apt, and writes commits and logs that cannot be lined up with anything.
#
# And the virtual clock DOES drift: measured here at six and a half minutes
# behind after one boot. What keeps the system clock right is NTP, which is
# Ubuntu's default and is made explicit here because a default is a thing that
# changes in the next release, and this one fails quietly and expensively.
say 'making sure the clock keeps itself right'
timedatectl set-ntp true 2>/dev/null || true
systemctl enable --now systemd-timesyncd 2>/dev/null || true

# NOT systemd-time-wait-sync, WHICH WAS TRIED AND HUNG A MACHINE.
#
# It looks like the right answer: it holds time-sync.target until the clock is
# genuinely synchronised, so anything ordered after it starts with a clock it can
# trust. What it actually does is wait with NO LIMIT — and on a machine whose
# clock is set by the guest additions rather than by timesyncd, that condition
# never arrives. The machine booted, brought up its desktop, and never started
# the agent. It looked perfectly healthy and was unreachable.
#
# So it is explicitly disabled rather than left to chance, because enabling it is
# the obvious-looking fix somebody will reach for again.
systemctl disable systemd-time-wait-sync.service 2>/dev/null || true

# WHAT ACTUALLY KEEPS THE CLOCK RIGHT, and neither can block a boot:
#
#   the guest additions   VBoxService sets it from the host, needs no network,
#                         and is why a machine with no NTP still tells the time
#   timesyncd             corrects it against the network as it runs
#
# The virtual clock does drift — measured at six and a half minutes behind after
# one boot — so this matters. It is fixed within the first minute, and nothing is
# ordered behind it.
#
# Note that NTPSynchronized only ever reports timesyncd, so a machine whose clock
# has been set correctly by the additions still reads "no". That is how three
# machines looked broken in one evening while telling the time perfectly well.

if timedatectl 2>/dev/null | grep -q 'synchronized: yes'; then
  say 'the clock is synchronised'
else
  say 'the clock is not synchronised yet — the boot will wait for it from now on'
fi

# --- docker ------------------------------------------------------------------

say 'installing docker'
if apt-get -o DPkg::Lock::Timeout=600 install -y docker.io docker-compose-v2 2>/dev/null || apt-get -o DPkg::Lock::Timeout=600 install -y docker.io; then
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

if [ "${OKC_DESKTOP:-yes}" != yes ]; then
  # SAID, NOT SKIPPED SILENTLY. "No desktop was set up" is a fact about what this
  # machine was built to be — declared when it was made, and read here from the
  # header — and it is the first thing somebody wonders about when nothing
  # appears on its screen.
  say 'this machine was built with no display, so there is no desktop to set up'
elif [ -f /etc/gdm3/custom.conf ]; then
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
  # This machine WAS meant to have a screen and has no display manager. Not the
  # same as the case above and it must not read the same: this is a desktop
  # machine that did not get a desktop, which is a fault, and the machine will
  # come up with nothing on it.
  say 'WARNING: this machine was built to have a display and there is no /etc/gdm3/custom.conf — it will boot to nothing. Was it installed from a server image?'
fi

# --- no welcome wizard, no tour ----------------------------------------------
#
# "Welcome to Ubuntu" and the first-run setup wizard both open over the desktop on
# first login and wait for somebody to click through them. On a machine nobody sits
# at, that is a session permanently occupied by a dialog -- and anything driving the
# GUI finds the wizard instead of what it expected.
#
# Purged rather than hidden, because a package that is not installed cannot come back
# after an update.

say 'removing the welcome wizard and the tour'
apt-get -o DPkg::Lock::Timeout=600 purge -y gnome-initial-setup gnome-tour 2>/dev/null \
  || say 'the welcome packages were not installed, or could not be removed'

# Belt and braces: if either survives -- held by a dependency, or reinstalled later --
# a matching file in /etc/xdg/autostart with Hidden=true stops it starting. This is
# the documented way to suppress a system autostart entry, and it costs nothing when
# the package is already gone.
install -d -m 0755 /etc/xdg/autostart
for entry in gnome-initial-setup-first-login gnome-tour; do
  cat >"/etc/xdg/autostart/$entry.desktop" <<AUTOSTOP
[Desktop Entry]
Type=Application
Name=$entry (disabled by okc)
Exec=/bin/true
Hidden=true
X-GNOME-Autostart-enabled=false
NoDisplay=true
AUTOSTOP
done
say 'neither will start on login even if reinstalled'

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
