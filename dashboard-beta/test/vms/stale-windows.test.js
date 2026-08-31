const { test } = require('node:test');
const assert = require('node:assert');

const makeStale = require('../../src/app/vms/editor/stale-windows');

//---------------------------------------------------------------------------
//THE WINDOW LEFT OVER FROM BEFORE A ROLLBACK.
//
//FOUND BY DOING IT, on a real machine: open the editor, sleep the machine,
//clear it to base, press open again. The press reported success, VS Code never
//connected, no server was ever pushed, and the extension step waited its full
//three minutes — asked at 19:15:00, gave up at 19:18:08, nothing on the guest.
//The window from before was sitting in "Cannot reconnect. Please reload the
//window." with a reconnection grace time of three hours.
//
//THE TEXT BELOW IS THE REAL ANSWER `code-insiders --status` GAVE at that
//moment, trimmed. It is a fixture rather than an invention because every field
//this parses is a format somebody else owns: made-up spacing would pass here and
//match nothing on the day it ran.
//---------------------------------------------------------------------------

//Tabs between the three numbers, exactly as VS Code writes them.
const STATUS = [
    'Version:          Code - Insiders 1.136.0-insider (d5ceefbe, 2026-08-28T16:34:03Z)',
    'OS Version:       Windows_NT x64 10.0.26200',
    'CPUs:             AMD Ryzen 7 260 w/ Radeon 780M Graphics         (16 x 3793)',
    'Memory (System):  31.31GB (10.83GB free)',
    'Processes:',
    '    0\t   251\t  5888\twindow [2] (cuts.json - onlykey-project - Visual Studio Code - Insiders)',
    '    0\t   329\t 11876\twindow [1] (Dashboard-beta - onlykey-claude - Visual Studio Code - Insiders)',
    '    0\t   313\t 24700\twindow [7] (Welcome - workspace [SSH: okc-ok-diy1] - Visual Studio Code - Insiders)',
    '    0\t    11\t 28404\t       C:\\Windows\\system32\\conhost.exe 0x4',
    'Workspace Stats: ',
    '|  Window (cuts.json - onlykey-project - Visual Studio Code - Insiders)',
    '|    Folder (onlykey-claude): 2315 files',
    "Connection to 'SSH: okc-ok-diy1' could not be established  Canceled"
].join('\n');

const read = makeStale.read;

test('it finds the window for a machine, with the process id it will close', () => {
    const it = read(STATUS, 'okc-ok-diy1');

    assert.equal(it.windows.length, 1, 'it did not find the one window for this machine');
    assert.equal(it.windows[0].pid, 24700);
    assert.match(it.windows[0].title, /\[SSH: okc-ok-diy1\]/);
});

test('and knows the connection is dead, which is what makes closing it right', () => {
    //BOTH HALVES ARE REQUIRED before anything is closed. A window on its own is
    //somebody working; a window plus a connection VS Code says it could not
    //establish is a window that cannot recover on its own.
    assert.equal(read(STATUS, 'okc-ok-diy1').dead, true);
});

test('a machine with no window of its own gets nothing, even while another is broken', () => {
    const it = read(STATUS, 'okc-ok-runner1');
    assert.equal(it.windows.length, 0);
    assert.equal(it.dead, false, 'it read another machine\'s failed connection as this one\'s');
});

test('the other windows are not this machine\'s, however busy the listing is', () => {
    //THE LISTING CARRIES SHELLS whose command line contains almost anything —
    //this app's own command line was in it, with the machine name inside — so
    //the match is anchored on `window [n] (` rather than searched for anywhere.
    const noisy = STATUS + '\n'
        + '    0\t     7\t 33384\t       "C:\\Program Files\\Git\\bin\\bash.exe" -c "ssh okc-ok-diy1 [SSH: okc-ok-diy1]"';

    const it = read(noisy, 'okc-ok-diy1');
    assert.equal(it.windows.length, 1, 'a shell command line was read as a window: '
        + JSON.stringify(it.windows));
    assert.equal(it.windows[0].pid, 24700);
});

test('a name that is a prefix of another is not confused with it', () => {
    //`okc-ok-diy1` AND `okc-ok-diy10` ARE DIFFERENT MACHINES, and the brackets
    //are the whole of what keeps them apart.
    const two = STATUS.replace('[SSH: okc-ok-diy1]', '[SSH: okc-ok-diy10]')
        .replace("'SSH: okc-ok-diy1'", "'SSH: okc-ok-diy10'");

    assert.equal(read(two, 'okc-ok-diy1').windows.length, 0);
    assert.equal(read(two, 'okc-ok-diy1').dead, false);
    assert.equal(read(two, 'okc-ok-diy10').windows.length, 1);
});

test('nothing said, and nothing asked about, are both answers rather than throws', () => {
    assert.deepEqual(read('', 'okc-ok-diy1'), { alias: 'okc-ok-diy1', windows: [], dead: false });
    assert.deepEqual(read(STATUS, ''), { alias: '', windows: [], dead: false });
    assert.deepEqual(read(null, null), { alias: '', windows: [], dead: false });
});

//---- and what it does with a process ---------------------------------------

test('it closes the WINDOW, not the process the pid belongs to', () => {
    //`taskkill /PID <the pid --status gave>` WAS TRIED ON A REAL MACHINE AND
    //REFUSED: "This process can only be terminated forcefully (with /F option)."
    //Those pids are RENDERERS -- one per window, owning no window message loop
    //-- and forcing one leaves the window there saying it terminated
    //unexpectedly, which is a different dead window rather than an improvement.
    //
    //THE PROCESS THAT OWNS THE WINDOW OWNS ALL OF THEM. Enumerated on that same
    //machine, the stale window's handle belonged to the main VS Code process,
    //the one also holding the operator's own editor.
    const ran = [];
    const stale = makeStale({
        platform: 'win32',
        exec: (file, argv, opts, done) => { ran.push({ file, argv }); done(null, 'okc-closed 1'); }
    });

    return stale.close('okc-ok-diy1').then((said) => {
        assert.equal(ran.length, 1);
        assert.equal(ran[0].file, 'powershell');
        assert.ok(!JSON.stringify(ran).includes('taskkill'),
            'it went back to ending a process instead of closing a window');
        assert.equal(said.closed, true);
        assert.equal(said.shut, 1);
    });
});

test('and the script it runs closes only the window carrying that machine', () => {
    const stale = makeStale({ platform: 'win32', exec: () => {} });
    const text = stale.script('okc-ok-diy1');

    //WM_CLOSE IS WHAT CLICKING THE X SENDS. VS Code then decides what to do
    //about it, which is the difference between closing a window and shooting it.
    assert.match(text, /PostMessage\(\$h,0x0010/);
    assert.match(text, /\[SSH: okc-ok-diy1\]/);

    //THE BRACKETS ARE THE WHOLE GUARD against okc-ok-diy1 matching
    //okc-ok-diy10, and against a window with the name loose in its title.
    assert.ok(!text.includes('Contains("okc-ok-diy1")'),
        'it matches the bare name, which would take a window it was not asked about');
});

test('a name that is not a machine alias is refused before it reaches a script', () => {
    //IT IS ABOUT TO BE PUT INSIDE A SCRIPT THAT RUNS ON THIS COMPUTER, so it is
    //checked against what an alias can be rather than escaped.
    const ran = [];
    const stale = makeStale({
        platform: 'win32',
        exec: (file, argv, opts, done) => { ran.push(file); done(null, 'okc-closed 9'); }
    });

    return stale.close('okc"; Remove-Item C:/ -Recurse; "').then((said) => {
        assert.equal(said.closed, false);
        assert.deepEqual(ran, [], 'it ran something for a name that is not an alias');
        assert.match(said.why, /not a machine alias/);
    });
});

test('a script that runs and finds nothing has not closed anything', () => {
    //SAYING IT HAD would send whatever comes next off looking in the wrong
    //place: the window is still there and still holding the machine.
    const stale = makeStale({
        platform: 'win32',
        exec: (file, argv, opts, done) => { done(null, 'okc-closed 0'); }
    });

    return stale.close('okc-ok-diy1').then((said) => {
        assert.equal(said.closed, false);
        assert.equal(said.shut, 0);
        assert.match(said.why, /no window with that machine/);
    });
});

test('and a close that fails is reported rather than thrown', () => {
    const stale = makeStale({
        platform: 'win32',
        exec: (file, argv, opts, done) => { done(new Error('Access is denied.')); }
    });

    return stale.close('okc-ok-diy1').then((said) => {
        assert.equal(said.closed, false);
        assert.match(said.why, /Access is denied/);
    });
});

test('off Windows it says so rather than pretending', () => {
    //THERE IS NO WINDOW HANDLE TO POST TO. The sentence somebody reads then
    //tells them to close it themselves, which is the honest fallback.
    const stale = makeStale({ platform: 'linux', exec: () => { throw new Error('should not run'); } });

    return stale.close('okc-ok-diy1').then((said) => {
        assert.equal(said.closed, false);
        assert.match(said.why, /only wired up on Windows/);
    });
});

test('asking goes through cmd.exe on Windows, because node will not start a .cmd', () => {
    //THE TRAP THIS APP ALREADY KNEW ABOUT AND THIS WALKED INTO ANYWAY. node
    //refuses to spawn a `.cmd` and throws EINVAL SYNCHRONOUSLY — it is the first
    //thing ../../src/app/vms/editor/open-editor.js says at the top of the file,
    //and it is why `launchSpec` exists.
    //
    //ASKING WITHOUT IT FAILED SILENTLY. The throw was caught and answered
    //"nothing open" — which is also the true answer on a machine that has
    //nothing open, so the whole feature was a no-op on Windows and looked
    //exactly like working. It was noticed the first time somebody pressed the
    //button, not by any test, because the tests around `open` inject a stale
    //stub and never reach this call.
    const ran = [];
    const stale = makeStale({
        platform: 'win32',
        spec: (command, args) => ({ file: 'C:/Windows/cmd.exe', argv: ['/c', command].concat(args) }),
        exec: (file, argv, opts, done) => { ran.push([file].concat(argv).join(' ')); done(null, STATUS); }
    });

    return stale.look('C:/x/code-insiders.cmd', 'okc-ok-diy1').then((seen) => {
        assert.deepEqual(ran, ['C:/Windows/cmd.exe /c C:/x/code-insiders.cmd --status'],
            'it asked without going through cmd.exe, which throws EINVAL on a .cmd');
        assert.equal(seen.windows.length, 1, 'it did not read the answer it got');
    });
});

test('asking VS Code and being refused is an empty answer, not a failure', () => {
    //NOT BEING ABLE TO ASK is not a reason to refuse to open an editor. It is a
    //reason to do what this app did before any of this existed.
    const stale = makeStale({
        exec: (file, argv, opts, done) => { done(new Error('ENOENT'), ''); }
    });

    return stale.look('code', 'okc-ok-diy1').then((seen) => {
        assert.deepEqual(seen, { alias: 'okc-ok-diy1', windows: [], dead: false });
    });
});

test('and one that throws on the spot is too', () => {
    const stale = makeStale({
        exec: () => { throw new Error('EINVAL'); }
    });

    return stale.look('code.cmd', 'okc-ok-diy1').then((seen) => {
        assert.equal(seen.windows.length, 0);
    });
});
