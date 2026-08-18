'use strict'

// Laying out a machine's workspace: every repository, on one branch, pointed
// back here.
//
// This file builds a shell script and returns it. It runs nothing and knows
// nothing about machines -- the server hands it to whichever machine asked, over
// the channel that machine is already dialled in on. Keeping it a string means
// it can be read, printed and pasted into a terminal to debug, which a sequence
// of remote calls could not be.
//
// THE TOKEN IS NOT PUT IN A REMOTE URL. It would work, and it would then be in
// `git remote -v`, in `.git/config`, and in the text of every error git prints
// about that remote -- which is the sort of place a secret gets copied out of
// into a screenshot. Git's own credential store holds it instead, in one file
// the machine already could have read, and the remotes stay clean enough to
// show anybody.

// Single-quoted for the shell, with the escape for a quote inside one. Every
// value below crosses into a script, and a repository or branch name is not
// something this file gets to assume the shape of.
const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`

// The default. Named for what it is rather than after any project, and
// overridable per machine -- `spec.folder` -- because where work lives is a
// machine's business and not this app's.
const FOLDER = '$HOME/workspace'

function script ({ repos, branch, on = null, folder = FOLDER, origin, machine, token, ca, caFile = '/etc/okc/ca.pem', readOnly = false, task = null }) {
  const dir = folder || FOLDER

  // A real loop over the names, rather than the same block written out once per
  // repository. The unrolled version used `continue` to skip a repository that
  // failed, which is only meaningful inside a loop -- outside one the shell
  // refuses it, so a single failure derailed the whole script instead of
  // reporting one repository and carrying on.
  // NOT EVERY REPOSITORY ON THE SAME BRANCH, when it is being read rather than
  // worked in.
  //
  // A machine set up to WORK is on one branch everywhere: that is what a line of
  // work is, and it is what the machine is allowed to push. A machine set up to
  // READ an arrived pull request is not that. The change lives on one branch in
  // ONE repository -- `pull/13` in local-repo-a and nowhere else -- and the
  // other repositories are there so a judge can answer the question a
  // single-repository view cannot: does anything else need a change this pull
  // request is missing.
  //
  // `on` is that map, repository to branch. Without it this emits NOTHING and
  // the loop is exactly what it was, which is deliberate: every existing path
  // through here is a working setup and none of them should change shape
  // because reading became possible.
  //
  // A `case` rather than a second loop over pairs, because repository names and
  // branch names both go through `q` and neither can then be split on a
  // separator that turns out to be legal in one of them.
  const perRepo = on && Object.keys(on).length
    ? `  case "$repo" in
${Object.entries(on).map(([r, b]) => `  ${q(r)}) branch=${q(b)} ;;`).join('\n')}
  esac`
    : ''

  const each = `
for repo in ${repos.map(q).join(' ')}; do
  url="$ORIGIN/git/$repo"
  cd "$WS" || { failed=1; continue; }
${perRepo}

  if [ -d "$repo/.git" ]; then
    cd "$repo" || { failed=1; continue; }
    # The address can move -- a rebuilt host, a different port -- and a stale
    # remote fails as "could not resolve", which points at the network rather
    # than at the thing that actually changed.
    git remote set-url origin "$url"
    if ! git fetch --quiet origin </dev/null; then
      echo "$repo: could not fetch from the host"; failed=1; continue
    fi
  else
    if ! git clone --quiet "$url" "$repo" </dev/null; then
      echo "$repo: could not clone from the host"; failed=1; continue
    fi
    cd "$repo" || { failed=1; continue; }
  fi

  # Three ways onto the branch, and the order matters.
  #
  # An existing LOCAL branch is checked out as it is and never reset to the
  # host's copy: on a second visit that copy is behind by exactly the commits
  # made here and not yet pushed, so resetting to it would throw away the work
  # that made the name worth reusing. Uncommitted changes make git refuse the
  # switch, which is also correct -- that is somebody's work, and this is a
  # button, not a decision to discard it.
  if git show-ref --verify --quiet "refs/heads/$branch"; then
    if ! git checkout --quiet "$branch" </dev/null; then
      echo "$repo: could not switch to $branch -- there may be uncommitted changes"; failed=1; continue
    fi
  elif git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
    git checkout --quiet -b "$branch" --track "origin/$branch" </dev/null
  else
    git checkout --quiet -b "$branch" </dev/null
  fi

  # READ-ONLY, SAID HERE AS WELL AS ENFORCED ON THE HOST.
  #
  # The host's pre-receive hook is the guard: it runs in a directory no guest can
  # reach and cannot be edited, skipped or pushed past. This is not that. This is
  # so a worker finds out at the moment it tries, in the repository it is in,
  # rather than at the end of an hour's work in a rejection from a server.
  #
  # A worker CAN remove this -- it is an ordinary file in a checkout it owns --
  # and that is fine, because removing it does not get the push through. The two
  # are not the same defence written twice; one is a rule and this is a sign.
  if [ -n "$READ_ONLY" ]; then
    mkdir -p .git/hooks
    cat > .git/hooks/pre-push <<'OKC_NO_PUSH'
#!/bin/sh
echo "refused: this machine is working in a line, read-only." >&2
echo "work is merged into a line, never pushed to it. commit freely -- your" >&2
echo "commits stay here -- and hand anything that has to leave back as an" >&2
echo "artifact instead: okc-artifact <file>" >&2
exit 1
OKC_NO_PUSH
    chmod +x .git/hooks/pre-push
  else
    rm -f .git/hooks/pre-push
  fi

  echo "$repo: on $(git rev-parse --abbrev-ref HEAD) at $(git log -1 --format=%h 2>/dev/null || echo 'nothing yet')${'$'}{READ_ONLY:+ (read-only)}"
done`

  return `set -u
failed=0
WS="${dir}"
branch=${q(branch)}
ORIGIN=${q(origin)}
READ_ONLY=${q(readOnly ? '1' : '')}
OKC_CA_FILE=${q(caFile)}

# The authority, written from here rather than fetched.
#
# This script arrives over the channel, which the machine already proved itself
# on and which is itself encrypted -- so handing the certificate down that path
# needs no fingerprint check. The install has to fetch and pin it because at that
# point no such path exists yet; here one does, and using it is both simpler and
# stronger.
${ca ? `sudo -n mkdir -p "$(dirname "$OKC_CA_FILE")" 2>/dev/null || mkdir -p "$(dirname "$OKC_CA_FILE")" 2>/dev/null || true
cat <<'OKC_CA_PEM' > /tmp/okc-ca.pem
${String(ca).trim()}
OKC_CA_PEM
sudo -n install -m 0644 /tmp/okc-ca.pem "$OKC_CA_FILE" 2>/dev/null || install -m 0644 /tmp/okc-ca.pem "$OKC_CA_FILE" 2>/dev/null || true
rm -f /tmp/okc-ca.pem` : '# no authority was supplied; whatever is already on this machine is used'}

mkdir -p "$WS"
cd "$WS" || { echo "could not use $WS"; exit 1; }

# WHICH TASK THIS MACHINE IS SET UP FOR, written where the machine keeps it.
#
# The dashboard is restarted for every change to it, and a task that was out on
# a machine at that moment goes back in the queue -- correctly, because a fresh
# process knows nothing about what was in flight. Without this, that is the end
# of it: the machine sits set up on a branch nobody is claiming, and the queue
# offers the same work to a second machine.
#
# So the machine carries the answer. It survives the dashboard restarting, it
# survives the agent reconnecting, and it cannot go stale the way a registry
# entry can -- a machine reverted by hand loses the file along with everything
# else, which is exactly right, because it has also lost the workspace.
#
# Read back when it dials in. See the hello handler in server.js.
${task ? `cat > "$HOME/.okc-task" <<'OKC_TASK_NOTE'
${JSON.stringify(task)}
OKC_TASK_NOTE` : 'rm -f "$HOME/.okc-task"'}

# Written before anything reaches the network, so the first clone already has
# what it needs and git never stops to ask a question nobody is there to answer.
umask 077
touch "$HOME/.git-credentials"
chmod 600 "$HOME/.git-credentials"
git config --global credential.helper store
# Replaced rather than appended: this line is this host, and a file that
# accumulated one per visit would keep offering credentials for hosts that are
# gone, oldest first.
tmp=$(mktemp)
grep -vF ${q(origin.replace(/^https?:\/\//, ''))} "$HOME/.git-credentials" > "$tmp" 2>/dev/null || true
printf '%s\\n' ${q(`${origin.replace('://', `://${machine}:${token}@`)}`)} >> "$tmp"
mv "$tmp" "$HOME/.git-credentials"
chmod 600 "$HOME/.git-credentials"

# So a commit made here is attributable to the machine that made it, rather
# than to whatever git guesses from the hostname -- and git refuses to commit
# at all until it has these.
# Git verifies the dashboard against the same authority everything else does.
#
# NOT http.sslVerify=false, which is how a self-signed certificate is usually
# made to work and would leave git accepting any certificate at all -- including
# one belonging to whoever is between this machine and the host, which is the
# entire thing being defended against.
git config --global http.sslCAInfo "$OKC_CA_FILE"

git config --global user.name ${q(machine)} 2>/dev/null || true
git config --global user.email ${q(`${machine}@localhost`)} 2>/dev/null || true
git config --global --add safe.directory '*' 2>/dev/null || true
${each}

echo "workspace is $WS on branch $branch"
exit $failed
`
}

module.exports = { script, FOLDER, folderFor: spec => (spec && spec.folder) || FOLDER, q }
