const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const guest = require('../../src/app/vms/editor/on-the-guest');

//---------------------------------------------------------------------------
//THE HALF OF VS CODE THAT LIVES ON THE MACHINE.
//
//AN EDITOR OPENED ON A MACHINE WITH NO CLAUDE IN IT is most of a press. The
//extension runs in the REMOTE extension host, so the one installed on the
//operator's desktop is not the one that window uses — and it says so itself:
//"This extension is disabled in this workspace because it is defined to run in
//the Remote Extension Host."
//
//WHAT IS ACTUALLY BEING TESTED HERE IS A SHELL SCRIPT, which is the one kind of
//output where a mistake produces a DIFFERENT COMMAND THAT RUNS rather than an
//error somebody sees. So it is run — against a fake HOME, with a fake CLI on it
//— rather than compared against an expected string.
//
//A STRING COMPARISON WOULD PASS ON A SCRIPT THAT DOES NOTHING. That is the
//whole reason this file spends the subprocess.
//---------------------------------------------------------------------------

const WANT = 'anthropic.claude-code';

//THE SCRIPT IS `sh`, and it is run as `sh` — the guests are Ubuntu and the
//channel does not promise bash. A `[[` or a `$'...'` that only bash accepts
//would pass every check here except this one.
function run(script, home) {
    return execFileSync('sh', ['-c', script], {
        env: Object.assign({}, process.env, { HOME: home }),
        encoding: 'utf8'
    });
}

//A MACHINE, AS A DIRECTORY. `flavour` is which server VS Code put there —
//Insiders and stable keep theirs in different folders and either may have
//connected.
function aMachine(how) {
    const it = how || {};
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-guest-'));
    const server = path.join(home, it.flavour || '.vscode-server-insiders');

    if (it.hasServer) {
        const bin = path.join(server, 'cli', 'servers', 'Insiders-abc123', 'server', 'bin');
        fs.mkdirSync(bin, { recursive: true });

        //A CLI THAT RECORDS WHAT IT WAS ASKED FOR AND CLAIMS TO HAVE DONE IT.
        const cli = path.join(bin, 'code-server-insiders');
        fs.writeFileSync(cli, '#!/bin/sh\necho "$@" >> "$HOME/asked"\nexit ' + (it.installFails ? '1' : '0') + '\n');
        fs.chmodSync(cli, 0o755);
    }

    if (it.hasExtension) {
        fs.mkdirSync(path.join(server, 'extensions', WANT + '-2.1.251-linux-x64'), { recursive: true });
    }

    return home;
}

const askedOn = (home) => {
    try { return fs.readFileSync(path.join(home, 'asked'), 'utf8'); }
    catch (e) { return ''; }
};

//---- what it does on a machine that has been used before ---------------------

test('an extension already there is left alone, and nothing is fetched', () => {
    //THE COMMON CASE, AND THE WHOLE OF THE SECOND PRESS ONWARDS. Asking first
    //costs one `ls` and saves a network fetch on every open for the rest of the
    //machine's life.
    const home = aMachine({ hasServer: true, hasExtension: true });

    const out = run(guest.installing(WANT), home);

    assert.deepEqual(guest.said(out), { done: true, why: 'already there' });
    assert.equal(askedOn(home), '', 'it ran the installer for an extension that was already there');
});

test('and it is installed when it is not there', () => {
    const home = aMachine({ hasServer: true });

    const out = run(guest.installing(WANT), home);

    assert.deepEqual(guest.said(out), { done: true, why: 'installed it on the machine' });
    assert.match(askedOn(home), new RegExp('--install-extension ' + WANT.replace('.', '\\.')));
});

test('the STANDALONE cli is used, not the one that needs a running window', () => {
    //`remote-cli/code-insiders` TALKS TO A RUNNING WINDOW through
    //VSCODE_IPC_HOOK_CLI and does nothing without it. `code-server-*` is the
    //standalone extension manager and installs with no window at all — which is
    //what this is, since it runs from the host while VS Code is still starting.
    const home = aMachine({ hasServer: true });
    const remote = path.join(home, '.vscode-server-insiders', 'cli', 'servers', 'Insiders-abc123',
        'server', 'bin', 'remote-cli');
    fs.mkdirSync(remote, { recursive: true });
    fs.writeFileSync(path.join(remote, 'code-insiders'), '#!/bin/sh\necho REMOTE-CLI >> "$HOME/asked"\nexit 0\n');
    fs.chmodSync(path.join(remote, 'code-insiders'), 0o755);

    run(guest.installing(WANT), home);

    assert.ok(askedOn(home).indexOf('REMOTE-CLI') < 0, 'it used the CLI that needs a running window');
});

test('either flavour of server is found, because either may have connected', () => {
    //INSIDERS KEEPS ITS SERVER SOMEWHERE ELSE, and this app prefers Insiders
    //where both are installed — see EDITORS in ../../src/app/vms/editor/
    //open-editor.js. Looking in one place would work on the machine it was
    //written against and nowhere else.
    ['.vscode-server', '.vscode-server-insiders'].forEach((flavour) => {
        const home = aMachine({ hasServer: true, flavour: flavour });
        assert.equal(guest.said(run(guest.installing(WANT), home)).done, true, flavour);
    });
});

//---- and on a machine that was just rolled back ------------------------------

test('a machine with no server yet says so, and does not hang for ever', () => {
    //THERE IS NO SERVER ON A CLEAN MACHINE. VS Code puts one there when it
    //connects, seconds AFTER the editor is launched — so on a machine just
    //rolled back to base there is nothing to install with at the moment this
    //runs. The wait is bounded, and running out is an ANSWER rather than a hang:
    //an unsettled wait cannot be reported.
    const home = aMachine({});

    const out = run(guest.installing(WANT, { seconds: 3 }), home);

    const it = guest.said(out);
    assert.equal(it.done, false);
    assert.match(it.why, /had not finished putting its server/);
});

test('and a server that appears WHILE it waits is used', () => {
    //THE WHOLE REASON IT WAITS. This is the case it exists for and the one a
    //fixed sleep would get wrong in both directions.
    const home = aMachine({});

    //THE SERVER LANDS TWO SECONDS IN, which is what VS Code finishing its
    //install looks like from here.
    const script = 'sh -c \'sleep 2; mkdir -p "$HOME/.vscode-server-insiders/cli/servers/x/server/bin"; '
        + 'printf "%s\\n" "#!/bin/sh" "echo \\"\\$@\\" >> \\"\\$HOME/asked\\"" > '
        + '"$HOME/.vscode-server-insiders/cli/servers/x/server/bin/code-server-insiders"; '
        + 'chmod +x "$HOME/.vscode-server-insiders/cli/servers/x/server/bin/code-server-insiders"\' &\n'
        + guest.installing(WANT, { seconds: 30 });

    const out = run(script, home);

    assert.equal(guest.said(out).done, true, out);
    assert.match(askedOn(home), /--install-extension/);
});

test('an install that fails is said, and is still not a failure of the press', () => {
    //THE EDITOR IS OPEN EITHER WAY. Refusing to report a press that worked
    //because a convenience did not is how somebody stops believing what this
    //answers.
    const home = aMachine({ hasServer: true, installFails: true });

    const out = run(guest.installing(WANT), home);

    const it = guest.said(out);
    assert.equal(it.done, false);
    assert.match(it.why, /could not fetch it/);
});

test('and it exits 0 whatever happened, because the caller is mid-press', () => {
    //`execFileSync` THROWS ON A NON-ZERO EXIT, so these three passing at all is
    //the assertion.
    run(guest.installing(WANT), aMachine({}) , 0);
    run(guest.installing(WANT), aMachine({ hasServer: true, installFails: true }));
    run(guest.installing(WANT), aMachine({ hasServer: true, hasExtension: true }));
});

//---- what may be put in it --------------------------------------------------

test('an extension id is publisher.name, and anything else is refused', () => {
    //REFUSED RATHER THAN QUOTED CAREFULLY. This string is interpolated into a
    //command that runs on a machine, and the set of things that are extension
    //ids is small and easy to state.
    assert.doesNotThrow(() => guest.installing('anthropic.claude-code'));
    assert.doesNotThrow(() => guest.installing('ms-vscode-remote.remote-ssh'));

    [';rm -rf /', 'a b', 'no-dot', '$(whoami).x', '"; echo hi; "', '', null, '../../etc/passwd']
        .forEach((bad) => {
            assert.throws(() => guest.installing(bad), /is not an extension id/, JSON.stringify(bad));
        });
});

test('and the script it builds carries no backslash at all', () => {
    //../../CLAUDE.md: a backslash typed into a heredoc arrives HALVED, and a
    //shell script is the one place a halved escape produces a different command
    //that runs rather than an error. Nothing here needs one, so nothing here
    //has one — and this is what keeps that true through the next edit.
    assert.equal(guest.installing(WANT).indexOf('\\'), -1);
});

//---- reading what it said ----------------------------------------------------

test('the answer is matched out of the noise, not sliced off the end', () => {
    //A GUEST SHELL PRINTS THINGS NOBODY ASKED FOR — a motd, a warning about a
    //locale, whatever a profile echoes. Same reason ../../src/app/vms/sealed/
    //deliver.js matches rather than slices.
    assert.equal(guest.said('Welcome to Ubuntu\nokc-extension installed\nlogout').done, true);
});

test('and nothing recognisable is not silently a success', () => {
    assert.deepEqual(guest.said('command not found'), { done: false, why: null });
    assert.deepEqual(guest.said(''), { done: false, why: null });
    assert.deepEqual(guest.said(null), { done: false, why: null });
});
