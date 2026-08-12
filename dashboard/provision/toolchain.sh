#!/bin/bash
# Whatever this machine needs in order to be useful.
#
# THIS IS THE ONE TO SWAP. The other three scripts are about making a machine
# exist and be reachable, which is the same job every time. This one is about what
# the machine is for, which is different every time -- so it is a separate file
# rather than a section of first-boot.sh, and replacing it is the intended way to
# make a different kind of machine.
#
# What ships here installs nothing beyond the basics of building anything at all.
# It is a starting point, not a recommendation: point a VM at your own copy and
# this file stops being involved.
#
# A header of OKC_* variables and a `say` helper is prepended by the dashboard.
# The VM's own `setup` steps, if it declares any, are appended after this file --
# so a small addition needs no new script at all.

set -u

say "toolchain: installing the basics"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y || true

# Enough to fetch, unpack and compile something. Nothing language-specific and
# nothing project-specific: a machine that needs a particular runtime says so in
# its own script or its setup steps.
apt-get install -y \
  build-essential \
  git \
  curl \
  wget \
  unzip \
  pkg-config \
  ca-certificates \
  || say "some packages did not install; carrying on"

# Run as the user rather than as root where it matters, because a tree owned by
# root is a machine the operator cannot work in.
say "toolchain: done as root; anything user-owned goes below"

if id "$OKC_USER" >/dev/null 2>&1; then
  install -d -o "$OKC_USER" -g "$OKC_USER" "/home/$OKC_USER/work"
  say "made /home/$OKC_USER/work, owned by $OKC_USER"
fi

say "toolchain finished"
