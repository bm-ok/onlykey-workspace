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
        //
        //AND COMPLAINS ON THE WAY OUT WHEN IT FAILS, the way a real one does. A
        //stand-in that fails SILENTLY cannot tell a script that carries the
        //reason home from one that throws it away — which is what this one did,
        //while the host asserted "check that it can reach the marketplace" about
        //every failure there had ever been. `installWhy: ''` is the other case:
        //a failure that really does say nothing.
        const cli = path.join(bin, 'code-server-insiders');
        const why = it.installWhy === undefined
            ? 'getaddrinfo EAI_AGAIN marketplace.visualstudio.com' : it.installWhy;
        const grumble = (it.installFails && why)
            ? 'echo "Error while installing extensions:" >&2\necho "' + why + '" >&2\n' : '';
        //AND IT ANSWERS `--version`, WHICH IS HOW THE SCRIPT KNOWS IT IS WHOLE.
        //
        //A REAL ONE DOES. This stub failed every argument alike when
        //`installFails` was set, so the moment the script started proving a
        //server works before using it, the stub looked like a half-extracted
        //download and the wait ran to its full length. A stand-in that refuses
        //what the real thing answers does not test the code, it tests the stub.
        //
        //BEFORE THE `asked` LINE, so that file stays a record of installs.
        fs.writeFileSync(cli, '#!/bin/sh\n'
            + 'case "$1" in --version) echo 1.136.0-insider; exit 0 ;; esac\n'
            + 'echo "$@" >> "$HOME/asked"\n'
            + grumble + 'exit ' + (it.installFails ? '1' : '0') + '\n');
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

    const out = run(guest.installing(WANT, { seconds: 6 }), home);

    assert.deepEqual(guest.said(out), { done: true, why: 'already there' });
    assert.equal(askedOn(home), '', 'it ran the installer for an extension that was already there');
});

test('and it is installed when it is not there', () => {
    const home = aMachine({ hasServer: true });

    const out = run(guest.installing(WANT, { seconds: 6 }), home);

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

    run(guest.installing(WANT, { seconds: 6 }), home);

    assert.ok(askedOn(home).indexOf('REMOTE-CLI') < 0, 'it used the CLI that needs a running window');
});

test('either flavour of server is found, because either may have connected', () => {
    //INSIDERS KEEPS ITS SERVER SOMEWHERE ELSE, and this app prefers Insiders
    //where both are installed — see EDITORS in ../../src/app/vms/editor/
    //open-editor.js. Looking in one place would work on the machine it was
    //written against and nowhere else.
    ['.vscode-server', '.vscode-server-insiders'].forEach((flavour) => {
        const home = aMachine({ hasServer: true, flavour: flavour });
        assert.equal(guest.said(run(guest.installing(WANT, { seconds: 6 }), home)).done, true, flavour);
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

    const out = run(guest.installing(WANT, { seconds: 6 }), home);

    const it = guest.said(out);
    assert.equal(it.done, false);

    //WHAT THE MACHINE SAID, NOT WHAT THE HOST ASSUMED IT MEANT. This asserted
    //"could not fetch it" — a sentence nobody had read off the machine, because
    //the script ran the install with `>/dev/null 2>&1` and discarded the one
    //fact needed to act on a failure. It sent the only investigation there was
    //into the network, when the machine may equally have been out of disk,
    //holding a lock, or refusing the extension as incompatible with that build.
    assert.match(it.why, /EAI_AGAIN marketplace/,
        'the reason the machine gave did not come back: ' + it.why);

    //AND WHICH SERVER BUILD WAS ASKED, because after an editor upgrade there can
    //be several under there and "it failed" means a different thing for each.
    assert.match(String(it.cli), /code-server-insiders$/, 'it did not say which CLI it used');
});

test('a failure that says nothing is reported as saying nothing, rather than as a guess', () => {
    //THE HONEST ANSWER TO SILENCE. It failed and gave no reason, and that is
    //worth saying as itself rather than filling in with the likeliest story —
    //which is how "check that it can reach the marketplace" came to be printed
    //in the voice of a diagnosis for a failure nobody had looked at.
    const home = aMachine({ hasServer: true, installFails: true, installWhy: '' });

    const it = guest.said(run(guest.installing(WANT, { seconds: 6 }), home));
    assert.equal(it.done, false);
    assert.match(it.why, /gave no reason/);
    assert.doesNotMatch(it.why, /marketplace/, 'it invented a cause for a silent failure');
});

test('and it exits 0 whatever happened, because the caller is mid-press', () => {
    //`execFileSync` THROWS ON A NON-ZERO EXIT, so these three passing at all is
    //the assertion.
    //
    //AND EVERY WAIT IS BOUNDED. The first of these has no server on it at all,
    //so it sits out the whole wait — three minutes of the suite, spent proving
    //something the case above already proves in three seconds.
    run(guest.installing(WANT, { seconds: 3 }), aMachine({}));
    run(guest.installing(WANT, { seconds: 6 }), aMachine({ hasServer: true, installFails: true }));
    run(guest.installing(WANT, { seconds: 6 }), aMachine({ hasServer: true, hasExtension: true }));
});

//---- a server that is still being unpacked ----------------------------------
//
//WHAT ACTUALLY HAPPENED, ON A REAL MACHINE, THE FIRST TIME THIS RAN AFTER A
//REBUILD. VS Code downloads a server into `<build>.staging/` and renames the
//directory when it has finished. This took the first `code-server*` whose PATH
//existed — so it picked the half-extracted tree, and running it died with a node
//MODULE_NOT_FOUND out of server-main.js. The press reported an editor opened and
//VS Code then said the extension was disabled in that workspace.
//
//THE PRESS AFTER A FRESH BUILD IS EXACTLY WHEN THE SERVER IS ARRIVING, so this
//is not a rare race — it is the ordinary case for the one machine that needs it.
//-----------------------------------------------------------------------------

//A DOWNLOAD VS CODE HAS NOT FINISHED WITH: the binary is there and it does not
//work, which is the whole trap. Named `.staging` the way VS Code names it.
function aHalfUnpackedServer(home) {
    const bin = path.join(home, '.vscode-server-insiders', 'cli', 'servers',
        'Insiders-5c9173.staging', 'server', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    const cli = path.join(bin, 'code-server-insiders');
    fs.writeFileSync(cli, '#!/bin/sh\n'
        + 'echo "Error: Cannot find module \'../out/server-main\'" >&2\n'
        + 'echo "  requireStack: [" >&2\n'
        + 'exit 1\n');
    fs.chmodSync(cli, 0o755);
    return cli;
}

test('a server still being unpacked is not used, and is not mistaken for a missing one', () => {
    const home = aMachine({});
    aHalfUnpackedServer(home);

    const it = guest.said(run(guest.installing(WANT, { seconds: 3 }), home));

    //IT WAITED AND THEN SAID SO, which is the honest answer: there is no server
    //it can use YET. Opening again once the window is up does it, and that is
    //what the sentence tells somebody to do.
    assert.equal(it.done, false);
    assert.match(it.why, /had not finished putting its server/);
    assert.equal(askedOn(home), '', 'it ran an installer with a half-extracted server');
});

test('a finished server is used even when a half-unpacked one is sitting beside it', () => {
    //THE STATE A MACHINE IS ACTUALLY IN mid-upgrade, and the one where picking
    //by name alone goes wrong: `.staging` sorts before the finished build.
    const home = aMachine({ hasServer: true });
    aHalfUnpackedServer(home);

    const out = run(guest.installing(WANT, { seconds: 6 }), home);

    assert.equal(guest.said(out).done, true, out);
    assert.match(askedOn(home), /--install-extension/);
});

test('a finished .staging download is left alone too, because its path is about to move', () => {
    //THE CASE RUNNING IT CANNOT CATCH. This one has finished extracting and
    //answers `--version` perfectly — and VS Code is about to rename the
    //directory out from under it, in the middle of an install.
    //
    //WITHOUT THIS TEST THE NAME GUARD WAS DEAD WEIGHT: removing it from the
    //script changed no result, because every other `.staging` fixture here is
    //also broken and the probe rejected them on its own. A guard that no test
    //can tell the absence of is a guard nobody can trust.
    const home = aMachine({});
    const bin = path.join(home, '.vscode-server-insiders', 'cli', 'servers',
        'Insiders-abcdef.staging', 'server', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    const cli = path.join(bin, 'code-server-insiders');
    fs.writeFileSync(cli, '#!/bin/sh\n'
        + 'case "$1" in --version) echo 1.136.0-insider; exit 0 ;; esac\n'
        + 'echo "$@" >> "$HOME/asked"\nexit 0\n');
    fs.chmodSync(cli, 0o755);

    const it = guest.said(run(guest.installing(WANT, { seconds: 3 }), home));

    assert.equal(it.done, false, 'it installed through a directory that is about to be renamed');
    assert.equal(askedOn(home), '', 'it ran an installer inside a .staging directory');
});

test('and a server that is there but broken is not counted as a server', () => {
    //THE GUARD THAT DOES NOT DEPEND ON A NAME. `.staging` is what VS Code calls
    //an unfinished download today; running the thing is what proves it is whole
    //whatever it is called tomorrow.
    const home = aMachine({});
    const bin = path.join(home, '.vscode-server-insiders', 'cli', 'servers', 'Insiders-plain', 'server', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    const cli = path.join(bin, 'code-server-insiders');
    fs.writeFileSync(cli, '#!/bin/sh\nexit 1\n');
    fs.chmodSync(cli, 0o755);

    const it = guest.said(run(guest.installing(WANT, { seconds: 3 }), home));
    assert.equal(it.done, false);
    assert.match(it.why, /had not finished putting its server/);
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
