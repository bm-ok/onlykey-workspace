var cp = require('child_process');

//---------------------------------------------------------------------------
//THE WINDOW LEFT OVER FROM BEFORE THE MACHINE WAS ROLLED BACK.
//
//WHAT HAPPENS WITHOUT THIS, found by doing it: open the editor on a machine,
//put the machine to sleep, clear it back to base, press open again — every step
//a button in this app. The press reports success, VS Code never connects, no
//server is ever pushed to the guest, and the extension step waits its full
//three minutes for something that was never coming. Measured: asked at 19:15:00,
//gave up at 19:18:08, nothing on the machine at all.
//
//AND THE WINDOW FROM BEFORE IS SITTING IN A MODAL: "Cannot reconnect. Please
//reload the window." Its own log explains the patience — VS Code's remote holds
//a reconnection grace time of 10800000ms, three hours — so it will sit there
//holding a dead connection to a machine that no longer exists in that state for
//the rest of the afternoon.
//
//`--new-window` DOES NOT HELP AND IS ALREADY PASSED. That was the first guess
//and it was wrong; ./open-editor.js has always passed it. Whatever VS Code does
//with a launch aimed at a host it already has a broken window for, it is not
//opening a second one: `--status` shows exactly one window for the host after
//the press, the same one that was there before.
//
//---- SO IT IS ASKED, RATHER THAN GUESSED AT ------------------------------
//
//`code --status` REPORTS BOTH FACTS AND NAMES THE HOST:
//
//      0    313   24700  window [7] (Welcome - workspace [SSH: okc-ok-diy1] - ...)
//      Connection to 'SSH: okc-ok-diy1' could not be established  Canceled
//
//A window, with its process id, and a connection this app can tell is dead —
//for the exact alias it is about to open. That is enough to act on and it is
//read from VS Code rather than inferred from what this app did earlier.
//
//A HEALTHY WINDOW IS LEFT ALONE. Both halves are required: a window for this
//host AND a connection VS Code says could not be established. Somebody with a
//working editor open on their machine pressing the button again gets what they
//have always got.
//---------------------------------------------------------------------------

//WHAT A WINDOW LINE LOOKS LIKE. Three tab-separated numbers — cpu, memory, pid —
//and then the process description. Anchored on `window [n] (` so no other line
//in that listing can match: the same file lists shells whose command line
//happens to contain almost anything, including this app's own.
var WINDOW = /^\s*\S+\s+\S+\s+(\d+)\s+window \[\d+\] \((.*)\)\s*$/;

//---- reading what VS Code said ---------------------------------------------
//
//A PURE FUNCTION OVER THE TEXT, so the parsing is tested without a VS Code and
//without killing anything. Everything that touches a process is injected below.
function read(text, alias) {
    var want = String(alias == null ? '' : alias).trim();
    var out = { alias: want, windows: [], dead: false };
    if (!want) return out;

    //`[SSH: <alias>]` IS HOW VS CODE WRITES IT in a window title, and the
    //brackets are what stop `okc-ok-diy1` matching `okc-ok-diy10`.
    var mark = '[SSH: ' + want + ']';

    //AND THE SENTENCE IT WRITES WHEN THE CONNECTION IS GONE. Matched on the
    //quoted host so a second machine's failure is not read as this one's.
    var deadLine = "Connection to 'SSH: " + want + "' could not be established";

    String(text == null ? '' : text).split('\n').forEach(function (line) {
        if (line.indexOf(deadLine) >= 0) out.dead = true;

        var m = WINDOW.exec(line);
        if (!m) return;
        if (m[2].indexOf(mark) < 0) return;
        out.windows.push({ pid: Number(m[1]), title: m[2] });
    });

    return out;
}

//---- and doing something about it ------------------------------------------

module.exports = function staleWindows(deps) {
    var d = deps || {};
    var exec = d.exec || cp.execFile;
    var platform = d.platform || process.platform;

    //---- THE SAME WAY THE EDITOR IS LAUNCHED, AND FOR THE SAME REASON --------
    //
    //NODE REFUSES TO SPAWN A `.cmd` AND THROWS EINVAL SYNCHRONOUSLY. That is
    //the first thing ./open-editor.js says at the top of the file, it is why
    //`launchSpec` exists, and this asked for `--status` without it: on Windows
    //the editor is `code-insiders.cmd`, so every status call threw before it
    //started, was caught here, and answered "nothing open".
    //
    //WHICH IS THE WORST POSSIBLE ANSWER, because it is also the true one on a
    //machine with nothing open — so the whole feature was a no-op on Windows
    //and looked exactly like a machine that had no stale window. It shipped and
    //was noticed the first time somebody pressed the button.
    //
    //HANDED IN RATHER THAN COPIED. `launchSpec` belongs to the file that
    //launches things; a second version of "how do you run a command on this
    //platform" is the drift that produced this.
    var spec = d.spec || function (command, args) { return { file: command, argv: args }; };

    //ASKING COSTS A SUBPROCESS, so it is only ever asked immediately before an
    //editor is launched at a particular machine — never on a read a pane makes.
    function look(exe, alias) {
        return new Promise(function (resolve) {
            var done = false;
            var finish = function (v) { if (!done) { done = true; resolve(v); } };

            var how = spec(exe, ['--status']);

            //IT NEVER REJECTS. Not being able to ask VS Code what it has open is
            //not a reason to refuse to open an editor — it is a reason to do
            //what this app did before there was any of this.
            try {
                exec(how.file, how.argv, { windowsHide: true, timeout: 20000 }, function (err, out) {
                    if (err && !out) return finish(read('', alias));
                    finish(read(out, alias));
                });
            } catch (e) { finish(read('', alias)); }
        });
    }

    //---- CLOSING THE WINDOW, WHICH IS NOT THE SAME AS ENDING A PROCESS -------
    //
    //`taskkill /PID <the pid --status gave>` WAS TRIED AND REFUSED:
    //
    //  ERROR: The process with PID 24700 could not be terminated.
    //  Reason: This process can only be terminated forcefully (with /F option).
    //
    //THE PID FROM `--status` IS A RENDERER. Every VS Code window runs its own,
    //and a renderer owns no window message loop for taskkill to knock on — so
    //the polite form cannot work and the forceful one kills the renderer out
    //from under a window, which leaves the window there saying it terminated
    //unexpectedly. A different dead window is not an improvement.
    //
    //AND THE PROCESS THAT DOES OWN THE WINDOW OWNS ALL OF THEM. Enumerated on
    //the machine this was found on, the stale window's handle belongs to pid
    //8068 — the main VS Code process, the same one holding the operator's own
    //editor. Closing THAT closes everything they have open.
    //
    //SO IT CLOSES THE WINDOW BY ITS HANDLE. `WM_CLOSE` to the one window whose
    //title carries this machine's alias is exactly what clicking its X does:
    //VS Code decides what to do about it, and every other window is untouched.
    //
    //ONLY THE TITLE DECIDES, and `[SSH: <alias>]` is how VS Code writes it —
    //the brackets are what stop `okc-ok-diy1` matching `okc-ok-diy10`.
    var WM_CLOSE = '0x0010';

    //A NAME OUT OF THE SSH CONFIG, AND STILL NOT TRUSTED. It is about to be put
    //inside a script that runs on this computer, so it is checked against what
    //an alias can be rather than escaped — the same argument ../provision/
    //scripts.js makes about a filename.
    var SAFE = /^[A-Za-z0-9][A-Za-z0-9._@-]*$/;

    function script(alias) {
        return [
            'Add-Type @"',
            'using System;',
            'using System.Runtime.InteropServices;',
            'using System.Text;',
            'public class OkcWin {',
            '  public delegate bool EnumProc(IntPtr h, IntPtr p);',
            '  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);',
            '  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);',
            '  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);',
            '  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);',
            '}',
            '"@',
            '$shut = 0',
            '$cb = [OkcWin+EnumProc]{ param($h,$l)',
            '  $sb = New-Object System.Text.StringBuilder 512',
            '  [void][OkcWin]::GetWindowText($h,$sb,512)',
            '  $t = $sb.ToString()',
            '  if ($t.Contains("[SSH: ' + alias + ']") -and [OkcWin]::IsWindowVisible($h)) {',
            '    [void][OkcWin]::PostMessage($h,' + WM_CLOSE + ',[IntPtr]::Zero,[IntPtr]::Zero)',
            '    $script:shut = $script:shut + 1',
            '  }',
            '  return $true',
            '}',
            '[void][OkcWin]::EnumWindows($cb,[IntPtr]::Zero)',
            'Write-Output ("okc-closed " + $shut)'
        ].join('\n');
    }

    //BASE64 UTF-16LE, WHICH IS WHAT `-EncodedCommand` TAKES. The script has
    //quotes, braces and an `@"` here-string in it; handing that to a shell as a
    //quoted argument is the backslash trap in another costume. Encoded, there is
    //nothing left for anything to parse.
    function encoded(text) {
        return Buffer.from(String(text), 'utf16le').toString('base64');
    }

    function close(alias) {
        var want = String(alias == null ? '' : alias).trim();

        return new Promise(function (resolve) {
            var done = false;
            var finish = function (v) { if (!done) { done = true; resolve(v); } };

            if (!SAFE.test(want)) {
                return finish({ alias: want, closed: false, shut: 0, why: '"' + want + '" is not a machine alias' });
            }

            //ONLY ON WINDOWS IS THERE A WINDOW HANDLE TO POST TO. Elsewhere this
            //says so rather than pretending: the sentence somebody reads then
            //tells them to close it themselves, which is the honest fallback and
            //is what happened before any of this existed.
            if (platform !== 'win32') {
                return finish({
                    alias: want, closed: false, shut: 0,
                    why: 'closing a VS Code window from outside is only wired up on Windows'
                });
            }

            try {
                exec('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded(script(want))],
                    { windowsHide: true, timeout: 30000 }, function (err, out) {
                        var m = /okc-closed (\d+)/.exec(String(out || ''));
                        var shut = m ? Number(m[1]) : 0;
                        finish({
                            alias: want,
                            //IT DID SOMETHING ONLY IF A WINDOW WAS ACTUALLY
                            //ASKED TO GO. A script that ran perfectly and found
                            //nothing has not closed anything, and saying it had
                            //would send the next step off looking in the wrong
                            //place.
                            closed: shut > 0,
                            shut: shut,
                            why: err ? err.message : (shut ? null : 'no window with that machine in its title')
                        });
                    });
            } catch (e) { finish({ alias: want, closed: false, shut: 0, why: e.message }); }
        });
    }

    return { look: look, close: close, read: read, script: script };
};

module.exports.read = read;
