//what ../../test/vms/editor-open.test.js has to be able to catch.
//
//EVERY BREAK BELOW PRODUCES A BUTTON THAT SILENTLY DOES NOTHING, which is what
//makes this file worth its checks: none of them is an error anybody sees.
module.exports = {
    file: 'src/app/vms/editor/open-editor.js',
    test: 'test/vms/editor-open.test.js',
    breaks: [
        //---- where the editor is ---------------------------------------------

        //A BUTTON THAT QUIETLY CHANGES WHICH EDITOR IT OPENS the day another one
        //is installed is worse than one that always picks the same.
        ['the preference between the two editors is incidental',
            "    ['Microsoft VS Code Insiders', 'code-insiders'],\n    ['Microsoft VS Code', 'code']",
            "    ['Microsoft VS Code', 'code'],\n    ['Microsoft VS Code Insiders', 'code-insiders']"],

        ['only one of the two editors is ever looked for',
            "    ['Microsoft VS Code Insiders', 'code-insiders'],\n    ['Microsoft VS Code', 'code']",
            "    ['Microsoft VS Code', 'code']"],

        //SOMEBODY WHO CONFIGURED `code-insiders` MEANT THE ONE ON THEIR PATH.
        ['a configured name on PATH is refused for want of a file at that path',
            "            if (!there(configured) && !/[\\\\/]/.test(configured)) {\n                return { command: configured, from: 'configured, on PATH' };\n            }",
            ''],

        ['a configured path that is not there is used anyway',
            "            if (!there(configured)) {\n                throw new Error('The editor is set to ' + configured + ', and there is nothing there.');\n            }",
            ''],

        //THE SECOND HALF MATTERS WHEN THE ANSWER IS WRONG: "not found" is a
        //different fault from "found somewhere unexpected", and the failure
        //message repeats it back.
        ['a guess is reported as though the editor had been found',
            "            from: 'guessed — not found where it installs'",
            "            from: 'found where it installs'"],

        ['the unix install locations are never looked at',
            '        for (var u = 0; u < UNIX.length; u++) {\n            if (there(UNIX[u])) return { command: UNIX[u], from: \'found where it installs\' };\n        }',
            ''],

        //---- how it is started -------------------------------------------------

        //NODE REFUSES TO SPAWN A .cmd DIRECTLY — EINVAL, thrown synchronously.
        //That is the CVE-2024-27980 mitigation, and it fails before the
        //arguments matter.
        ['a .cmd is started directly, which node refuses to do',
            "        if (platform === 'win32' && /\\.(cmd|bat)$/i.test(command)) {",
            '        if (false) {'],

        //THE EDITOR INSTALLS TO A PATH WITH SPACES IN IT and a shell splits on
        //them. Through cmd.exe node quotes each argument and no shell parses the
        //path at all.
        ['the path with spaces is handed to a shell to re-split',
            "            return { file: env.COMSPEC || 'cmd.exe', argv: ['/c', command].concat(args) };",
            "            return { file: env.COMSPEC || 'cmd.exe', argv: ['/c', command + ' ' + args.join(' ')] };"],

        //---- the far end ---------------------------------------------------------

        ['the far end is not escaped, so an address with an @ in it breaks the uri',
            "        return 'vscode-remote://ssh-remote+' + encodeURIComponent(String(remote == null ? '' : remote))",
            "        return 'vscode-remote://ssh-remote+' + String(remote == null ? '' : remote)"],

        ['an absolute path is given a second slash',
            "            + (where.charAt(0) === '/' ? '' : '/') + where;",
            "            + '/' + where;"],

        ['a relative path is given none at all',
            "            + (where.charAt(0) === '/' ? '' : '/') + where;",
            '            + where;'],

        //---- opening it -----------------------------------------------------------

        ['a remote folder is opened as a local path that is not there',
            "        var args = it.remote\n            ? ['--folder-uri', folderUri(it.remote, it.dir), '--new-window']\n            : [it.dir, '--new-window'];",
            "        var args = [it.dir, '--new-window'];"],

        ['nothing to open is spawned anyway',
            "        if (!it.dir) throw new Error('There is no folder to open.');",
            ''],

        //THE EINVAL PATH reaches neither the callback nor the 'error' event —
        //here is the only place it can become something readable.
        ['a synchronous throw escapes as an errno nobody can act on',
            '            } catch (err) {',
            '            } catch (ignored) { throw ignored; } finally { if (false) {'],

        ['the failure does not say what was actually run',
            "            return new Error('Could not start the editor.\\n  tried: ' + attempted",
            "            return new Error('Could not start the editor.' + ('"],

        ['a .cmd failure does not name the reason it is always the reason',
            "            if (err.code === 'EINVAL' && platform === 'win32') {\n                why = ' — Windows will not start a .cmd directly; this should have gone through cmd.exe.';\n            } else if",
            '            if (false) {\n                why = \'\';\n            } else if'],

        ['a missing binary does not say where the editor was looked for',
            "                why = ' — that was not found. The editor was ' + found.from + '.';",
            "                why = '';"],

        //SPAWNING SUCCESSFULLY IS NOT OPENING. cmd.exe starts perfectly well and
        //only then reports that what it was asked to run does not exist.
        ['a launch that failed after spawning is reported as success',
            '                child = exec(spec.file, spec.argv, { windowsHide: true }, function (err, stdout, stderr) {\n                    if (!err || !err.code) return;',
            '                child = exec(spec.file, spec.argv, { windowsHide: true }, function (err, stdout, stderr) {\n                    return;\n                    if (!err || !err.code) return;'],

        ['what the editor said is not carried into the failure',
            "                    err.detail = detail;",
            ''],

        //THE DASHBOARD OPENED A WINDOW, IT DOES NOT OWN IT.
        ['it waits for the editor to close, which is for ever',
            '            var grace = after(GRACE_MS, done);',
            '            var grace = null;'],

        ['a clean exit still waits out the whole grace window',
            '                clear(grace);\n                done();',
            '                if (false) { clear(grace); done(); }'],

        //WITHOUT SETTLING ONCE, a failure arriving after the grace window
        //rejects a promise that already resolved — which node reports as
        //nothing at all.
        ['it can settle twice',
            '                if (settled) return;\n                settled = true;',
            '']
    ]
};
