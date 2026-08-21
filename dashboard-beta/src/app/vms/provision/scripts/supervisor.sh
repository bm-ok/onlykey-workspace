#!/bin/bash
# A supervisor machine, the root half: the sign-in desk.
#
# THE PROBLEM THIS SOLVES. A Claude sign-in writes to ~/.claude/.credentials.json
# of whoever runs it. The supervisor RUNS as a credential — it is a machine whose
# whole job is to think — so signing in again as that user would overwrite the
# credential it is working with, mid-thought. Asking for a fresh login URL would
# be the thing that broke it.
#
# So there is a second user here, and it exists to do exactly one thing: hold a
# sign-in conversation and produce a credential. Its home is its own, so its
# ~/.claude is not the supervisor's; nothing it does can touch what the
# supervisor is holding, and the desk can be used while the supervisor works.
#
# ONE MACHINE PROVIDES EVERY SIGN-IN. Runners used to be borrowed one at a time
# to be signed in and then wiped — a machine brought up, a person waited on, a
# machine put away, per credential. All of it happens here instead: this is the
# only machine that ever holds a sign-in conversation, and every credential this
# host keeps — a worker's or a supervisor's — comes off this desk.
#
# NO PASSWORD, NO SUDO, NO SHELL LOGIN. The desk user is not a person and not an
# administrator. It cannot become root, and nothing dials in as it: the dashboard
# reaches it through the machine's own user, which has sudo.
#
# A header of OKC_* values and `say`/`report` helpers is prepended by the
# dashboard, so OKC_VM, OKC_USER, say and report are defined even though nothing
# in this file defines them.

set -u

DESK=okc-signin

say "supervisor (root): setting up the sign-in desk as \"$DESK\""

# --- the desk user ------------------------------------------------------------
#
# --disabled-password rather than a locked account with a password hash: nothing
# ever logs in as this, it is only ever reached with `sudo -u`.
if id "$DESK" >/dev/null 2>&1; then
  say "supervisor: the desk user \"$DESK\" is already here"
else
  adduser --disabled-password --gecos 'okc sign-in desk' "$DESK" >/dev/null 2>&1 \
    && say "supervisor: made the desk user \"$DESK\"" \
    || say "supervisor: WARNING: could not make the desk user \"$DESK\""
fi

# --- what the desk needs in order to sign in ----------------------------------
#
# The claude CLI, which lives under the machine user's nvm. A home directory is
# 0750 on Ubuntu, so the desk cannot even traverse it, and `claude` is
# unreachable by any path.
#
# 0751 RATHER THAN 0755, and the difference is the point: 1 is traverse, 4 is
# LIST. The desk can follow a path it already knows -- the node it runs -- and
# cannot read the machine user's home to find out what else is in there. The
# credential that matters is 0600 and owned by that user, so it stays unreadable
# either way; this only makes the interpreter reachable.
#
# The alternative was a second nvm, a second node and a second copy of Claude
# Code for this user. That is a minute of install and a second thing to keep
# current, to avoid one traverse bit.
chmod 0751 "/home/$OKC_USER" 2>/dev/null \
  && say "supervisor: /home/$OKC_USER is traversable, so the desk can run the claude it finds there" \
  || say "supervisor: WARNING: could not make /home/$OKC_USER traversable — the desk will not find claude"

# The path to it, written into the desk's own profile so a login shell there has
# it. Resolved now rather than guessed: nvm's directory carries the node version,
# which changes.
CLAUDE_BIN=$(su - "$OKC_USER" -c 'command -v claude' 2>/dev/null || true)
if [ -n "$CLAUDE_BIN" ]; then
  CLAUDE_DIR=$(dirname "$CLAUDE_BIN")

  # ON THE PATH FOR EVERY USER, not only for a login shell.
  #
  # The desk's profile is read by a LOGIN shell, and the dashboard sends it a
  # script on stdin -- which is not one. The first version put the directory in
  # ~/.profile and the sign-in came back "claude: command not found", exit 127,
  # from a user that could run it perfectly well by absolute path.
  #
  # A link rather than a copy, and it costs nothing: claude here is a native
  # binary, so nothing has to find node to run it.
  ln -sf "$CLAUDE_BIN" /usr/local/bin/claude 2>/dev/null \
    && say "supervisor: claude is on the path for every user here, via /usr/local/bin/claude -> $CLAUDE_BIN" \
    || say 'supervisor: WARNING: could not link claude into /usr/local/bin'

  # And in the desk's profile as well, for anybody who opens a login shell as it
  # to see what is going on.
  if ! grep -q 'okc: where the claude' "/home/$DESK/.profile" 2>/dev/null; then
    {
      echo ''
      echo '# okc: where the claude the sign-in desk uses lives. It belongs to the'
      echo '# machine user; this desk only executes it, and keeps its own ~/.claude.'
      echo "export PATH=\"$CLAUDE_DIR:\$PATH\""
    } >> "/home/$DESK/.profile"
    chown "$DESK:$DESK" "/home/$DESK/.profile" 2>/dev/null || true
  fi
else
  say 'supervisor: WARNING: claude is not installed yet, so the desk has nothing to sign in with'
fi

# --- and it starts empty ------------------------------------------------------
#
# Whatever a previous sign-in left. A credential is taken off this desk and kept
# on the host the moment it exists, so anything still here is a leftover — and a
# leftover credential on a machine is the state this whole app is arranged to
# avoid.
# `.claude.json` as well as `.claude`: the first holds the account that signed
# in — email, uuid, billing — and the second holds the credential. Neither is
# this machine's to keep.
rm -rf "/home/$DESK/.claude" "/home/$DESK/.claude.json" "/home/$DESK/.okc-auth" 2>/dev/null || true

say 'supervisor: the sign-in desk is ready'
