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

function script ({ repos, branch, folder = FOLDER, origin, machine, token }) {
  const dir = folder || FOLDER

  // A real loop over the names, rather than the same block written out once per
  // repository. The unrolled version used `continue` to skip a repository that
  // failed, which is only meaningful inside a loop -- outside one the shell
  // refuses it, so a single failure derailed the whole script instead of
  // reporting one repository and carrying on.
  const each = `
for repo in ${repos.map(q).join(' ')}; do
  url="$ORIGIN/git/$repo"
  cd "$WS" || { failed=1; continue; }

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

  echo "$repo: on $(git rev-parse --abbrev-ref HEAD) at $(git log -1 --format=%h 2>/dev/null || echo 'nothing yet')"
done`

  return `set -u
failed=0
WS="${dir}"
branch=${q(branch)}
ORIGIN=${q(origin)}

mkdir -p "$WS"
cd "$WS" || { echo "could not use $WS"; exit 1; }

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
git config --global user.name ${q(machine)} 2>/dev/null || true
git config --global user.email ${q(`${machine}@localhost`)} 2>/dev/null || true
git config --global --add safe.directory '*' 2>/dev/null || true
${each}

echo "workspace is $WS on branch $branch"
exit $failed
`
}

module.exports = { script, FOLDER, folderFor: spec => (spec && spec.folder) || FOLDER, q }
