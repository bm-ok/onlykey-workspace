#!/bin/bash
# Fetched and run by the installer, at the very end of an unattended install.
#
# It runs as root, once, with no operator present. Its whole job is to fetch the
# other scripts and run them in order -- so which of them a machine gets, and
# what is in them, can change without touching the installer or this app.
#
# Swappable: name a different script in the VM's spec and that one arrives here
# instead. Nothing below is specific to any project.
#
# A header of OKC_* variables and a `say` helper is prepended before this line by
# the dashboard. Run it by hand and the defaults in that header still apply.

set -u

say "unattended stage starting on $(hostname)"
report installing

# --- fetch and run one script from the dashboard ------------------------------
#
# Retried, because this is the only moment the install depends on the dashboard
# being reachable, and a restart or a slow bridge would otherwise waste the whole
# install with nothing to show for it.
stage () {
  local script="$1"
  local target="/root/okc-$script"

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
    report failed
    return 1
  fi

  say "running $script"
  if bash "$target"; then
    say "$script finished"
  else
    say "$script failed"
    report failed
    return 1
  fi
}

# Order matters, and only the first is required. A machine with no toolchain is a
# usable machine; a machine with no ssh server is not reachable at all.
stage first-boot.sh || exit 1
stage toolchain.sh || say "carrying on without the toolchain"

# --- run on every boot from now on -------------------------------------------
#
# Installed rather than run: this is the script for ordinary boots, and this boot
# has already had the whole first-boot treatment.
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
  systemctl daemon-reload
  systemctl enable okc-boot.service
  say "every boot will now check in with the dashboard"
fi

say "unattended stage finished"
report online
