//---------------------------------------------------------------------------
//THE HALF OF VS CODE THAT LIVES ON THE MACHINE.
//
//../editor/open-editor.js starts an editor on THIS computer. What that editor
//then does is push a server onto the guest and run every extension THERE — so
//an extension installed on this desktop is not installed for the window you are
//looking at, and says so: "This extension is disabled in this workspace because
//it is defined to run in the Remote Extension Host."
//
//THAT IS THE WHOLE PROBLEM THIS FILE EXISTS FOR. A person opened their machine,
//found claude missing from an editor whose entire purpose is claude, and had no
//way to fix it from the app.
//
//---- WHY IT IS A SHELL SCRIPT AND NOT A SERVICE ---------------------------
//
//BECAUSE THE THING THAT DOES THE WORK IS ON THE GUEST. The VS Code server ships
//its own CLI, and that CLI is the extension manager — it resolves the right
//build for the guest's platform, fetches it, unpacks it and writes the registry.
//Reimplementing any of that here would mean this app deciding what a linux-x64
//build of somebody else's extension is.
//
//SO THIS BUILDS A COMMAND AND SOMEBODY ELSE RUNS IT, which is the shape
//../../repositories/repos/workspace.js already uses: a pure function that
//returns shell, and a caller with a channel.
//
//---- AND WHY IT WAITS ------------------------------------------------------
//
//THERE IS NO SERVER ON A CLEAN MACHINE. VS Code installs one the first time it
//connects, which is seconds AFTER the editor is launched — so on a machine that
//has just been rolled back to its base snapshot there is nothing to install
//with at the moment this runs.
//
//THE WAIT IS ON THE GUEST, IN ONE COMMAND, rather than the host asking over and
//over. One round trip that finishes when the thing it is waiting for happens,
//which is what ../../runners/machines' `vmAwait` is for the states it covers.
//
//IT ALWAYS EXITS 0. Opening an editor is the press; having claude inside it is
//what makes the press worth pressing, and neither is a reason to report a
//failure at something that worked. What happened is said on a line instead.
//---------------------------------------------------------------------------

//BOTH FLAVOURS, BECAUSE EITHER MAY HAVE CONNECTED. Insiders keeps its server in
//`.vscode-server-insiders` and stable in `.vscode-server`, and this app prefers
//Insiders where both are installed — see EDITORS in ./open-editor.js. A glob
//costs nothing and asking the host which one it launched would be a second
//reading of a fact the guest already has in front of it.
var SERVERS = '"$HOME"/.vscode-server*';

//WHAT IT SAYS, ON ITS OWN LINE. A guest shell prints things nobody asked for, so
//the caller matches this rather than reading the last line — the same reason
//../sealed/deliver.js matches rather than slices.
var SAYS = 'okc-extension';

//THREE MINUTES. A server download onto a fresh machine is tens of seconds on a
//good line and minutes on a bad one, and the cost of being wrong in each
//direction is not the same: waiting too long delays a press that has already
//opened the editor, giving up too early leaves somebody exactly where they
//started with no idea why.
var WAIT_SECONDS = 180;

//---- the script ------------------------------------------------------------
//
//NO BACKSLASH ANYWHERE IN HERE, deliberately. See ../../../CLAUDE.md: this file
//is edited through tools that halve them, and a shell script is the one place
//where a halved escape produces a DIFFERENT COMMAND THAT RUNS rather than an
//error somebody sees.
function installing(what, how) {
    var it = String(what || '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9][A-Za-z0-9._-]*$/.test(it)) {
        //REFUSED HERE RATHER THAN QUOTED CAREFULLY. An extension id is
        //`publisher.name` and nothing else; anything that is not one has no
        //business being interpolated into a command that runs on a machine.
        throw new Error('"' + what + '" is not an extension id. They are "publisher.name".');
    }

    var seconds = (how && how.seconds) || WAIT_SECONDS;
    var every = 3;

    return [
        'set -u',
        'WANT=' + JSON.stringify(it),
        '',
        '# ALREADY THERE IS THE COMMON CASE, and it is the whole of the second',
        '# press onwards. Asking first costs one `ls` and saves a network fetch.',
        'if ls -d ' + SERVERS + '/extensions/"$WANT"-* >/dev/null 2>&1; then',
        '  echo ' + SAYS + ' already-there',
        '  exit 0',
        'fi',
        '',
        '# THE SERVER ARRIVES AFTER THE EDITOR CONNECTS, so on a machine that was',
        '# just rolled back there is nothing to install with yet. Waited for here,',
        '# on the machine, rather than by the host asking over and over.',
        'waited=0',
        'CLI=""',
        'while [ "$waited" -lt ' + seconds + ' ]; do',
        '  CLI=$(ls -1 ' + SERVERS + '/cli/servers/*/server/bin/code-server* 2>/dev/null | head -1)',
        '  if [ -n "$CLI" ]; then break; fi',
        '  sleep ' + every,
        '  waited=$((waited + ' + every + '))',
        'done',
        '',
        '# NOT A FAILURE. The editor is open either way; this is the difference',
        '# between an editor with claude in it and one without.',
        'if [ -z "$CLI" ]; then',
        '  echo ' + SAYS + ' no-server',
        '  exit 0',
        'fi',
        '',
        '# `code-server-*`, NOT `remote-cli/code-*`. The remote-cli one talks to a',
        '# RUNNING window through VSCODE_IPC_HOOK_CLI and does nothing without it;',
        '# this one is the standalone manager and installs with no window at all.',
        'if "$CLI" --install-extension "$WANT" >/dev/null 2>&1; then',
        '  echo ' + SAYS + ' installed',
        'else',
        '  echo ' + SAYS + ' failed',
        'fi',
        'exit 0'
    ].join('\n');
}

//---- and reading what it said ----------------------------------------------
//
//MATCHED, NOT SLICED, and turned into a sentence here so the caller does not
//keep its own copy of what each word means.
function said(output) {
    var m = new RegExp(SAYS + ' (\\S+)').exec(String(output || ''));
    var word = m ? m[1] : null;

    if (word === 'installed') return { done: true, why: 'installed it on the machine' };
    if (word === 'already-there') return { done: true, why: 'already there' };
    if (word === 'no-server') {
        return {
            done: false,
            why: 'VS Code had not finished putting its server on the machine, so there was nothing to '
                + 'install with yet. Opening it again once the window is up will do it.'
        };
    }
    if (word === 'failed') {
        return { done: false, why: 'the machine could not fetch it — check that it can reach the marketplace' };
    }
    return { done: false, why: null };
}

module.exports = { installing: installing, said: said, SAYS: SAYS, WAIT_SECONDS: WAIT_SECONDS };
