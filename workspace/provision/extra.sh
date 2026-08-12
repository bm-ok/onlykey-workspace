#!/bin/bash
# This project's extra setup. It runs AFTER the app's toolchain, and adds to it.
#
# So there is nothing here about build tools, docker, a desktop session or node --
# the app's toolchain.sh already did those, and every machine gets them whether or
# not this file exists. Duplicating them here would mean two places to change and
# two chances to disagree.
#
# What IS here is only ours, and all of it genuinely needs root: a kernel module to
# build against, a particular device to flash, a udev rule for one vendor id, and a
# memory setting without which the emulator will not start. None of that belongs in a
# generic tool, which is why this file lives outside the app.
#
# Anything of ours that belongs to the user is in extra-user.sh, which runs as them.
#
# A header of OKC_* values and `say`/`report` helpers is prepended by the dashboard.

set -u

say 'extra (root): this project has more to add'

export DEBIAN_FRONTEND=noninteractive

# --- kernel build inputs -----------------------------------------------------
#
# For building a USB device controller out of tree. linux-headers is the part that
# matters; linux-source frequently has no package for a given kernel, which is
# normal rather than a failure.

say "installing kernel build inputs for $(uname -r)"
apt-get -o DPkg::Lock::Timeout=600 install -y --no-install-recommends "linux-headers-$(uname -r)" \
  || say "WARNING: no linux-headers for $(uname -r) — an out-of-tree module cannot be built"

if apt-get -o DPkg::Lock::Timeout=600 install -y --no-install-recommends "linux-source-$(uname -r | cut -d- -f1)" 2>/dev/null; then
  say 'linux-source is installed'
else
  say 'no linux-source package for this kernel, which is normal — fetch it from the archive if it is needed'
fi

if [ -d "/lib/modules/$(uname -r)/build" ]; then
  say "the kernel build tree is present for $(uname -r)"
else
  say "WARNING: no kernel build tree for $(uname -r), so a module build will fail"
fi

# During an install, the kernel running is the installer's and the one that will boot
# may be newer -- so headers can be right for the running kernel by luck rather than
# because they were asked for. Saying both makes a later mismatch obvious instead of
# something to discover while a build fails.
say "headers were installed for $(uname -r); after a reboot check that uname -r still matches"

# --- access to the flashing target -------------------------------------------
#
# Only the bootloader rule lives here. Rules for the device itself come from the
# project's own setup script, and two sources of truth for the same device
# permissions is how they drift apart.

say 'granting access to the flashing target'
cat >/etc/udev/rules.d/49-okc-bootloader.rules <<'RULES'
# The bootloader this project flashes through (16c0:0478).
# Rules for the device itself are installed by the project's own setup script,
# deliberately not from here.
SUBSYSTEM=="usb", ATTRS{idVendor}=="16c0", ATTRS{idProduct}=="0478", MODE="0660", GROUP="plugdev", TAG+="uaccess"
KERNEL=="hidraw*", ATTRS{idVendor}=="16c0", ATTRS{idProduct}=="0478", MODE="0660", GROUP="plugdev", TAG+="uaccess"
RULES
udevadm control --reload-rules 2>/dev/null || true
udevadm trigger 2>/dev/null || true

# --- allow a low address to be mapped ----------------------------------------
#
# Without this the emulator segfaults on start, and the crash does not say why.
# Written as a sysctl file so it survives a reboot.

say 'allowing low memory mapping'
echo 'vm.mmap_min_addr = 4096' >/etc/sysctl.d/60-okc-mmap.conf
sysctl -p /etc/sysctl.d/60-okc-mmap.conf >/dev/null 2>&1 \
  || say 'could not apply vm.mmap_min_addr now; it applies on the next boot'

# --- the USB gadget is deliberately NOT here ---------------------------------
#
# The project owns it end to end: it builds the controller out of tree, installs it,
# loads the modules, writes its own udev rules and enables the unit that rebuilds the
# gadget at boot. An earlier attempt to do it from a provisioning script modprobed a
# module the distribution does not ship, printed a warning, and missed the memory
# setting above -- reinventing, badly, something already solved.

say 'the usb gadget is set up by the project itself, not from here'

say 'extra (root) finished'
