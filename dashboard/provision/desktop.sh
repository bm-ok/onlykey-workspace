#!/bin/bash
# A screen, for the machines that are meant to have one.
#
# Every machine here is installed from the SERVER image, which has no desktop at
# all. That is the way round it has to be: most machines never show anybody
# anything, and a display manager, a session and a compositor are most of what
# they would otherwise spend their boot and their memory on. Two machines coming
# up at once is what wedges this host, and most of what they compete over is a
# desktop nobody is looking at.
#
# So this is what a machine gets when somebody ticked the box. It is not
# decoration: a task with no job leaves its machine running at a desktop for
# whoever wrote the task, and the Runners tab tells them "anything needing a
# screen will work". This is what makes that sentence true.
#
# DELIBERATELY SMALL. Xorg, a window manager that does nothing, and a display
# manager that logs the user straight in — a few hundred megabytes rather than
# the two gigabytes a full desktop costs. What is wanted is a DISPLAY that
# exists, stays logged in and never locks, so that anything needing a screen
# works. Anything more is a preference, and belongs in the project's extra.sh.
#
# THREE THINGS HAVE TO BE TRUE, and none is the default:
#   - somebody is logged in                          (autologin)
#   - the session is X11, so DISPLAY=:0 means something
#   - it never blanks, locks or idles away
#
# A header of OKC_* values and `say`/`report` helpers is prepended by the dashboard.

set -u

# Asked, not guessed. This script is only fetched when the machine was built to
# have a screen, and the check is here as well so that running it by hand on a
# machine that was not cannot quietly turn it into something else.
if [ "${OKC_DESKTOP:-yes}" != yes ]; then
  say 'this machine was built with no display, so no desktop is being installed'
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive

say 'installing a small desktop: Xorg, openbox and a display manager'
apt-get -o DPkg::Lock::Timeout=600 update -y || true
apt-get -o DPkg::Lock::Timeout=600 install -y \
  xorg openbox lightdm lightdm-gtk-greeter \
  x11-utils x11-xserver-utils xterm dconf-cli \
  || say 'some of the desktop packages did not install; carrying on'

if ! command -v Xorg >/dev/null 2>&1; then
  say 'WARNING: there is no X server after installing, so this machine has no screen'
  exit 1
fi

# --- logged in, and stays that way -------------------------------------------
#
# lightdm rather than gdm: it is a fraction of the size, its autologin is three
# lines, and it does not drag a whole desktop environment in behind it. The
# config is a drop-in rather than an edit, so an upgrade replacing the main file
# cannot quietly undo this.
install -d -m 0755 /etc/lightdm/lightdm.conf.d
cat > /etc/lightdm/lightdm.conf.d/50-okc-autologin.conf <<CONF
# Written by the dashboard. This machine is a runner: it logs itself in so that
# anything needing DISPLAY=:0 works without somebody typing a password into a
# screen nobody is watching.
[Seat:*]
autologin-user=$OKC_USER
autologin-user-timeout=0
autologin-session=openbox
user-session=openbox
CONF

# The user must be allowed to log in without a password prompt from the
# autologin group's point of view. On Ubuntu this group exists already; making it
# is harmless where it does not.
groupadd -f autologin 2>/dev/null || true
usermod -aG autologin "$OKC_USER" 2>/dev/null || true

# WHICH DISPLAY MANAGER, AND THAT THERE SHOULD BE ONE AT ALL.
#
# Two things a desktop image has already decided and a server image has not, and
# without them everything above is installed and never runs:
#
#   - the default target is multi-user.target on a server, so nothing graphical
#     is ever started. graphical.target is what pulls in the display manager.
#
#   - Debian's display-manager machinery asks WHICH manager to use through
#     debconf, and DEBIAN_FRONTEND=noninteractive answers nothing — so
#     /etc/X11/default-display-manager is missing and `systemctl is-enabled
#     lightdm` says "indirect", which is a word meaning "somebody else decides
#     and nobody did".
#
# Found on a machine that had lightdm, openbox and Xorg all installed, no X
# running, and a card in the dashboard correctly saying the desktop was not up.
echo /usr/sbin/lightdm > /etc/X11/default-display-manager
systemctl enable lightdm 2>/dev/null || true
systemctl set-default graphical.target >/dev/null 2>&1 || true
say "lightdm will log $OKC_USER straight in, into openbox, from the next boot"

# --- something on the background ---------------------------------------------
#
# openbox draws nothing, so the session is a black rectangle — which is
# indistinguishable from a machine that has not started X, from a machine that
# has crashed, and from a screenshot taken too early. Every one of those has been
# mistaken for the others in this project already, including by the tool.
#
# SO THE BACKGROUND SAYS WHICH MACHINE IT IS. A wallpaper here is not decoration:
# a screenshot of a runner is the instrument used when nothing else can answer,
# and one that names itself answers "which machine am I looking at" without
# anybody having to know.
#
# MADE ON THE MACHINE, not fetched. Nothing in this project downloads assets at
# run time, and a wallpaper that has to be served is a wallpaper that is missing
# on the day the dashboard is not answering.
if command -v convert >/dev/null 2>&1 || apt-get -o DPkg::Lock::Timeout=600 install -y imagemagick feh >/dev/null 2>&1; then
  install -d -m 0755 /usr/share/backgrounds
  # The dashboard's own colours, so a runner's screen and the window that
  # manages it look like one thing. The name is large enough to read in a
  # screenshot that has been scaled down, which is how they are usually read.
  convert -size 1920x1080 \
    -define gradient:angle=150 gradient:'#0a0d12'-'#16202c' \
    -gravity center \
    -font DejaVu-Sans -pointsize 140 -fill '#58a6ff' -annotate +0-40 "$OKC_VM" \
    -font DejaVu-Sans -pointsize 44 -fill '#5b6672' -annotate +0+70 'a dashboard runner' \
    /usr/share/backgrounds/okc.png 2>/dev/null \
    || convert -size 1920x1080 xc:'#0a0d12' /usr/share/backgrounds/okc.png 2>/dev/null \
    || true
fi

# --- and it never blanks or locks --------------------------------------------
#
# A blanked screen is indistinguishable from a machine that has stopped
# responding, which is exactly the confusion this whole project keeps paying for.
# X's own screensaver and DPMS are the two that matter; there is no session
# manager here with opinions of its own.
install -d -m 0755 "/home/$OKC_USER/.config/openbox"
cat > "/home/$OKC_USER/.config/openbox/autostart" <<'AUTOSTART'
# Written by the dashboard. Nothing dims, blanks or locks: a dark screen and a
# hung machine look identical in a screenshot, and screenshots are how this app
# tells them apart.
xset s off
xset s noblank
xset -dpms
AUTOSTART
chown -R "$OKC_USER:$OKC_USER" "/home/$OKC_USER/.config"

say 'the desktop is installed and will come up logged in, and will not blank'
