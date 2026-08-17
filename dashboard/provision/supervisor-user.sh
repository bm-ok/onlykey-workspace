#!/bin/bash
# What a SUPERVISOR machine gets, and it is deliberately almost nothing.
#
# A runner is given tasks: it clones repositories, builds things, flashes devices,
# and needs a project's whole toolchain to do any of that. A supervisor is given
# none of those, ever — the queue will not hand it a task, by the tag it was built
# with — so everything a task needs is weight it carries and never uses.
#
# What it does instead is decide. It runs Claude Code, talks to this dashboard
# over an API of its own, and asks for work to be created, given and judged. So
# what it needs is: node, which the app's toolchain-user.sh already installed
# through nvm, and Claude Code.
#
# WHY THIS IS THE APP'S SCRIPT AND NOT THE PROJECT'S. The project's extra-user.sh
# also installs Claude Code, and this is not a copy of it that got left behind:
# a supervisor does not run the project's provisioning at all — see
# first-boot.sh — because "this project" is exactly what a supervisor is not
# about. A machine that supervises is a machine this app knows the purpose of,
# which makes what it needs the app's business rather than a project's.
#
# NO CREDENTIAL IS INSTALLED HERE, for the same reason as everywhere else: a key
# baked into provisioning ends up in every snapshot of every machine built from
# this point. A supervisor is lent one from the guest list — see core/guests.js —
# and it is taken back afterwards.
#
# A header of OKC_* values and `say`/`report` helpers is prepended by the
# dashboard, so OKC_VM, OKC_BASE, say and report are defined even though nothing
# in this file defines them.

set -u

say "supervisor: setting up $OKC_VM as a supervisor, not a runner"

# --- somewhere to think ------------------------------------------------------
#
# One folder, made by the user, and nothing cloned into it. A supervisor holds no
# repositories: what it works on is the dashboard's own board, over the wire.

mkdir -p "$HOME/supervisor"
say "supervisor: its own folder is $HOME/supervisor"

# --- the one thing it actually runs -------------------------------------------
#
# A login shell, so nvm's node and its global prefix are the ones used. Without it
# npm is either missing or the distribution's, and a global install lands
# somewhere root owns and this user cannot run.

say 'supervisor: installing claude code'
if bash -lc 'command -v claude >/dev/null 2>&1'; then
  say "supervisor: claude is already here: $(bash -lc 'claude --version 2>/dev/null' | head -1)"
else
  if bash -lc 'npm install -g @anthropic-ai/claude-code >/dev/null 2>&1'; then
    say "supervisor: claude installed: $(bash -lc 'claude --version 2>/dev/null' | head -1)"
  else
    say 'supervisor: WARNING: could not install claude -- this machine cannot supervise anything until it is'
  fi
fi

# --- the only way it may talk to the dashboard --------------------------------
#
# A COMMAND, BECAUSE A MODEL WILL NOT REMEMBER A CURL LINE. What is behind it is
# a strict allowlist on the host -- see core/supervisor.js -- and this is the
# thing that makes it usable: `okc` on its own says what it may do, `okc <what>`
# does one of them.
#
# THIS IS NOT THE DASHBOARD'S CLI. okc.js is the whole action surface and is not
# on this machine; nothing here can reach it. This wrapper can ask for exactly
# what the host is willing to answer and nothing else, and the host decides that,
# not this file -- a supervisor that edited its own wrapper would gain nothing.
#
# The token is already on this machine: the agent has it, every provisioning
# script is handed it. Written here as its own file, readable only by this user,
# so the command does not carry it on a command line where `ps` would show it.

mkdir -p "$HOME/.okc" "$HOME/.local/bin"
chmod 700 "$HOME/.okc"
umask 077
cat > "$HOME/.okc/env" <<ENVEOF
OKC_VM='$OKC_VM'
OKC_BASE='$OKC_BASE'
OKC_TOKEN='$OKC_TOKEN'
OKC_CA='$OKC_CA'
ENVEOF
chmod 600 "$HOME/.okc/env"

cat > "$HOME/.local/bin/okc" <<'CLIEOF'
#!/bin/bash
# Ask the dashboard for something a supervisor is allowed to ask for.
#
#   okc                       what this machine may ask for, and what each takes
#   okc <what>                do one of them, with no arguments
#   okc <what> '<json>'       do one of them, with arguments as a JSON object
#
# Everything not on that list does not exist here. The list is the host's, not
# this file's.
set -u
. "$HOME/.okc/env"

what=${1:-}
body=${2:-}

# --fail-with-body, not -f. With -f curl throws the body away on any error status
# and prints "curl: (22) ... error: 403" -- so a refusal that carefully explains
# what a supervisor may ask for instead arrived as a number. The whole point of
# the refusal is that the thing reading it can act on it.
if [ -z "$what" ]; then
  curl -sS --fail-with-body --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" \
    "$OKC_BASE/supervisor?vm=$OKC_VM"
  exit $?
fi

curl -sS --fail-with-body --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" \
  -H 'content-type: application/json' \
  --data "${body:-{\}}" \
  "$OKC_BASE/supervisor/do?vm=$OKC_VM&what=$what"
CLIEOF
chmod 700 "$HOME/.local/bin/okc"

# On the path for a login shell. Ubuntu's own .profile adds ~/.local/bin when it
# exists, and it did not exist when .profile was read -- so it is said here as
# well rather than relying on the next login.
if ! grep -q 'okc: the supervisor command' "$HOME/.profile" 2>/dev/null; then
  {
    echo ''
    echo '# okc: the supervisor command'
    echo 'case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) PATH="$HOME/.local/bin:$PATH" ;; esac'
    echo 'export PATH'
  } >> "$HOME/.profile"
fi

say 'supervisor: it can ask the dashboard for work with the okc command'

# --- what it can reach --------------------------------------------------------
#
# Reported rather than assumed, and each of these has been wrong before while
# looking right from a root shell. The dashboard address is the one that matters:
# a supervisor that cannot reach it is a machine sitting on its hands, and that
# looks exactly like one that is thinking.

say "supervisor: node:   $(bash -lc 'node --version 2>/dev/null || echo MISSING')"
say "supervisor: claude: $(bash -lc 'claude --version 2>/dev/null || echo MISSING')"

# THE SAME CALL `say` MAKES, with its exit code looked at rather than thrown
# away. `say` is deliberately never fatal and never noisy about failing, which is
# right for logging and useless as a check — so this asks the one endpoint that
# certainly exists, over TLS, with this machine's own token, and reports what
# happened. There is no /ping to call: inventing one would be a second answer to
# "can it reach the dashboard" that only this script would ever use.
if curl -fsS --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" --max-time 10 --get \
     --data-urlencode 'text=supervisor: checking it can reach the dashboard' \
     "$OKC_BASE/provision/say?vm=$OKC_VM" >/dev/null 2>&1; then
  say "supervisor: the dashboard answers at $OKC_BASE, and this machine is who it says it is"
else
  say "supervisor: WARNING: no answer from $OKC_BASE -- it cannot ask for work from there yet"
fi

say 'supervisor: ready to be told what it may do'
