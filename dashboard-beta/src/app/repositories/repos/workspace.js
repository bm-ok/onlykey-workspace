var quoting = require('../../vms/shell/quoting');

//---------------------------------------------------------------------------
//LAYING OUT A MACHINE'S WORKSPACE: every repository, on one branch, pointed
//back here.
//
//THIS FILE BUILDS A SHELL SCRIPT AND RETURNS IT. It runs nothing and knows
//nothing about machines — whoever asked hands it to the machine, over the
//channel that machine is already dialled in on. Keeping it a STRING means it
//can be read, printed and pasted into a terminal to debug, which a sequence of
//remote calls could not be.
//
//---- the token is not put in a remote url ---------------------------------
//
//It would work, and it would then be in `git remote -v`, in `.git/config`, and
//in the text of every error git prints about that remote — which is the sort of
//place a secret gets copied out of into a screenshot. Git's own credential store
//holds it instead, in one file the machine already could have read, and the
//remotes stay clean enough to show anybody.
//
//---- and every value crosses into a script --------------------------------
//
//`q` is ../../vms/shell/quoting's, not a second copy. A repository or a branch
//name is not something this file gets to assume the shape of, and a quoting
//mistake here does not produce a broken command that fails loudly — it produces
//a DIFFERENT command that runs.
//---------------------------------------------------------------------------

var q = quoting.q;

//THE DEFAULT. Named for what it is rather than after any project, and
//overridable per machine — `spec.folder` — because where work lives is a
//machine's business and not this app's.
var FOLDER = '$HOME/workspace';

//BUILT RATHER THAN TYPED, both of them. A `$` immediately before a `{` inside a
//JavaScript template is an interpolation, so the shell's own `${VAR:+...}` has
//to be assembled — and a backslash-n typed into a template is a real newline,
//where what the shell needs is the two characters.
var DOLLAR = String.fromCharCode(36);
var BACKSLASH_N = String.fromCharCode(92) + 'n';

function folderFor(spec) { return (spec && spec.folder) || FOLDER; }

//---- how each repository is put on its branch ------------------------------
//
//A REAL LOOP OVER THE NAMES, rather than the same block written out once per
//repository. The unrolled version used `continue` to skip a repository that
//failed, which is only meaningful INSIDE a loop — outside one the shell refuses
//it, so a single failure derailed the whole script instead of reporting one
//repository and carrying on.
function eachRepo(repos, on) {
    return '\nfor repo in ' + repos.map(q).join(' ') + '; do\n'
        + '  url="$ORIGIN/git/$repo"\n'
        + '  cd "$WS" || { failed=1; continue; }\n'
        + perRepoBranch(on) + '\n'
        + [
            '  if [ -d "$repo/.git" ]; then',
            '    cd "$repo" || { failed=1; continue; }',
            '    # The address can move -- a rebuilt host, a different port -- and a stale',
            '    # remote fails as "could not resolve", which points at the network rather',
            '    # than at the thing that actually changed.',
            '    git remote set-url origin "$url"',
            '    if ! git fetch --quiet origin </dev/null; then',
            '      echo "$repo: could not fetch from the host"; failed=1; continue',
            '    fi',
            '  else',
            '    if ! git clone --quiet "$url" "$repo" </dev/null; then',
            '      echo "$repo: could not clone from the host"; failed=1; continue',
            '    fi',
            '    cd "$repo" || { failed=1; continue; }',
            '  fi',
            '',
            '  # Three ways onto the branch, and the order matters.',
            '  #',
            '  # An existing LOCAL branch is checked out as it is and never reset to the',
            '  # host\'s copy: on a second visit that copy is behind by exactly the commits',
            '  # made here and not yet pushed, so resetting to it would throw away the work',
            '  # that made the name worth reusing. Uncommitted changes make git refuse the',
            '  # switch, which is also correct -- that is somebody\'s work, and this is a',
            '  # button, not a decision to discard it.',
            '  if git show-ref --verify --quiet "refs/heads/$branch"; then',
            '    if ! git checkout --quiet "$branch" </dev/null; then',
            '      echo "$repo: could not switch to $branch -- there may be uncommitted changes"; failed=1; continue',
            '    fi',
            '  elif git show-ref --verify --quiet "refs/remotes/origin/$branch"; then',
            '    git checkout --quiet -b "$branch" --track "origin/$branch" </dev/null',
            '  else',
            '    git checkout --quiet -b "$branch" </dev/null',
            '  fi',
            '',
            '  # READ-ONLY, SAID HERE AS WELL AS ENFORCED ON THE HOST.',
            '  #',
            '  # The host\'s pre-receive hook is the guard: it runs in a directory no guest',
            '  # can reach and cannot be edited, skipped or pushed past. This is not that.',
            '  # This is so a worker finds out at the moment it tries, in the repository it',
            '  # is in, rather than at the end of an hour\'s work in a rejection.',
            '  #',
            '  # A worker CAN remove this -- it is an ordinary file in a checkout it owns --',
            '  # and that is fine, because removing it does not get the push through. The',
            '  # two are not the same defence written twice; one is a rule and this is a sign.',
            '  if [ -n "$READ_ONLY" ]; then',
            '    mkdir -p .git/hooks',
            '    cat > .git/hooks/pre-push <<\'OKC_NO_PUSH\'',
            '#!/bin/sh',
            'echo "refused: this machine is working in a line, read-only." >&2',
            'echo "work is merged into a line, never pushed to it. commit freely -- your" >&2',
            'echo "commits stay here -- and hand anything that has to leave back as an" >&2',
            'echo "artifact instead: okc-artifact <file>" >&2',
            'exit 1',
            'OKC_NO_PUSH',
            '    chmod +x .git/hooks/pre-push',
            '  else',
            '    rm -f .git/hooks/pre-push',
            '  fi',
            '',
            '  echo "$repo: on $(git rev-parse --abbrev-ref HEAD) at $(git log -1 --format=%h 2>/dev/null || echo '
                + '\'nothing yet\')' + DOLLAR + '{READ_ONLY:+ (read-only)}"',
            'done'
        ].join('\n');
}

//---- not every repository on the same branch, when it is being READ --------
//
//A machine set up to WORK is on one branch everywhere: that is what a line of
//work is, and it is what the machine is allowed to push. A machine set up to
//READ an arrived pull request is not that. The change lives on one branch in ONE
//repository and the others are there so a judge can answer the question a
//single-repository view cannot: does anything else need a change this pull
//request is missing.
//
//WITHOUT IT THIS EMITS NOTHING and the loop is exactly what it was, which is
//deliberate: every existing path through here is a working setup and none of
//them should change shape because reading became possible.
//
//A `case` RATHER THAN A SECOND LOOP OVER PAIRS, because repository names and
//branch names both go through `q` and neither can then be split on a separator
//that turns out to be legal in one of them.
function perRepoBranch(on) {
    var names = Object.keys(on || {});
    if (!names.length) return '';

    return '  case "$repo" in\n'
        + names.map(function (r) { return '  ' + q(r) + ') branch=' + q(on[r]) + ' ;;'; }).join('\n')
        + '\n  esac';
}

//---- the authority, written from here rather than fetched ------------------
//
//This script arrives over the channel, which the machine already proved itself
//on and which is itself encrypted — so handing the certificate down that path
//needs no fingerprint check. The install has to fetch and pin it because at that
//point no such path exists yet; here one does, and using it is both simpler and
//stronger.
function theAuthority(ca) {
    if (!ca) return '# no authority was supplied; whatever is already on this machine is used';

    return [
        'sudo -n mkdir -p "$(dirname "$OKC_CA_FILE")" 2>/dev/null || mkdir -p "$(dirname "$OKC_CA_FILE")" 2>/dev/null || true',
        'cat <<\'OKC_CA_PEM\' > /tmp/okc-ca.pem',
        String(ca).trim(),
        'OKC_CA_PEM',
        'sudo -n install -m 0644 /tmp/okc-ca.pem "$OKC_CA_FILE" 2>/dev/null || install -m 0644 /tmp/okc-ca.pem "$OKC_CA_FILE" 2>/dev/null || true',
        'rm -f /tmp/okc-ca.pem'
    ].join('\n');
}

//---- which task this machine is set up for, written where it keeps it ------
//
//The dashboard is restarted for every change to it, and a task that was out on a
//machine at that moment goes back in the queue — correctly, because a fresh
//process knows nothing about what was in flight. Without this, that is the end
//of it: the machine sits set up on a branch nobody is claiming, and the queue
//offers the same work to a second machine.
//
//SO THE MACHINE CARRIES THE ANSWER. It survives the dashboard restarting, it
//survives the agent reconnecting, and it cannot go stale the way a registry
//entry can — a machine reverted by hand loses the file along with everything
//else, which is exactly right, because it has also lost the workspace.
//
//Read back when it dials in — see ../../queue/redial.
function theNote(task) {
    if (!task) return 'rm -f "$HOME/.okc-task"';

    return 'cat > "$HOME/.okc-task" <<\'OKC_TASK_NOTE\'\n'
        + JSON.stringify(task) + '\n'
        + 'OKC_TASK_NOTE';
}

function script(what) {
    var it = what || {};
    var dir = it.folder || FOLDER;
    var origin = it.origin;
    var caFile = it.caFile || '/etc/okc/ca.pem';

    //WITHOUT THE SCHEME, for the line `grep -vF` matches on.
    var host = String(origin).replace(/^https?:\/\//, '');

    return [
        'set -u',
        'failed=0',
        'WS="' + dir + '"',
        'branch=' + q(it.branch),
        'ORIGIN=' + q(origin),
        'READ_ONLY=' + q(it.readOnly ? '1' : ''),
        'OKC_CA_FILE=' + q(caFile),
        '',
        theAuthority(it.ca),
        '',
        'mkdir -p "$WS"',
        'cd "$WS" || { echo "could not use $WS"; exit 1; }',
        '',
        theNote(it.task),
        '',
        '# Written before anything reaches the network, so the first clone already has',
        '# what it needs and git never stops to ask a question nobody is there to answer.',
        'umask 077',
        'touch "$HOME/.git-credentials"',
        'chmod 600 "$HOME/.git-credentials"',
        'git config --global credential.helper store',
        '# Replaced rather than appended: this line is this host, and a file that',
        '# accumulated one per visit would keep offering credentials for hosts that are',
        '# gone, oldest first.',
        'tmp=$(mktemp)',
        'grep -vF ' + q(host) + ' "$HOME/.git-credentials" > "$tmp" 2>/dev/null || true',
        'printf \'%s' + BACKSLASH_N + '\' ' + q(withCredentials(origin, it.machine, it.token)) + ' >> "$tmp"',
        'mv "$tmp" "$HOME/.git-credentials"',
        'chmod 600 "$HOME/.git-credentials"',
        '',
        '# Git verifies the dashboard against the same authority everything else does.',
        '#',
        '# NOT http.sslVerify=false, which is how a self-signed certificate is usually',
        '# made to work and would leave git accepting any certificate at all -- including',
        '# one belonging to whoever is between this machine and the host, which is the',
        '# entire thing being defended against.',
        'git config --global http.sslCAInfo "$OKC_CA_FILE"',
        '',
        '# So a commit made here is attributable to the machine that made it, rather',
        '# than to whatever git guesses from the hostname -- and git refuses to commit',
        '# at all until it has these.',
        'git config --global user.name ' + q(it.machine) + ' 2>/dev/null || true',
        'git config --global user.email ' + q(it.machine + '@localhost') + ' 2>/dev/null || true',
        'git config --global --add safe.directory \'*\' 2>/dev/null || true',
        eachRepo(it.repos || [], it.on),
        '',
        'echo "workspace is $WS on branch $branch"',
        'exit $failed',
        ''
    ].join('\n');
}

//THE ONE LINE THE CREDENTIAL STORE HOLDS. The machine's own name and its own
//token, against this host — so a push is attributable and a stolen line is
//useful for exactly one machine.
function withCredentials(origin, machine, token) {
    return String(origin).replace('://', '://' + machine + ':' + token + '@');
}

module.exports = {
    script: script,
    folderFor: folderFor,
    FOLDER: FOLDER,
    q: q
};
