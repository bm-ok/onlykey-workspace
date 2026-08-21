//what ../../test/vms/provision-scripts.test.js has to be able to catch.
module.exports = {
    file: 'src/app/vms/provision/scripts.js',
    test: 'test/vms/provision-scripts.test.js',
    breaks: [
        //A SPEC MAY NOT NAME A PATH. What a guest is handed here it runs as root,
        //at first boot.
        ['a spec may name a path, and it is served',
            "        var name = path.basename(String(wanted == null ? '' : wanted));",
            "        var name = String(wanted == null ? '' : wanted);"],

        //NOT BREAKS, AND WORTH THE LINES. Two sabotages were tried here and
        //both changed nothing, because after `path.basename` the name is one
        //segment and joining it to a directory can only land inside that
        //directory: swapping join for resolve, and removing the startsWith
        //check. THE BASENAME IS THE WHOLE GUARD -- which is exactly why the
        //first break above, the one that removes it, is the one that matters.

        ['anything at all may be served from those folders',
            '        if (!SERVABLE.test(name)) {\n            throw new Error(\'"\' + wanted + \'" is not a provisioning file.\');\n        }',
            ''],

        ['a file extension is not checked, only that something is there',
            "var SERVABLE = /\\.(sh|py|js|md)$/;",
            'var SERVABLE = /./;'],

        //The project's copy wins: that is what makes a baseline replaceable.
        ['the app’s copy wins over the project’s',
            '        return [workspaceDir, appDir].filter(function (dir) { return dir && there(dir); });',
            '        return [appDir, workspaceDir].filter(function (dir) { return dir && there(dir); });'],

        ['a host with no workspace folder looks in it anyway',
            '        return [workspaceDir, appDir].filter(function (dir) { return dir && there(dir); });',
            '        return [workspaceDir, appDir];'],

        ['whose copy ran is always reported as the app’s',
            "        return (workspaceDir && String(file).indexOf(workspaceDir) === 0) ? 'the project' : 'the app';",
            "        return 'the app';"],

        //A machine's own choice of script for a stage.
        ['a machine cannot name a different script for a stage',
            '        var chosen = (((vm && vm.spec) || {}).scripts || {})[stage];\n        return resolve(chosen || STAGES[stage] || stage);',
            '        return resolve(STAGES[stage] || stage);'],

        ['a machine’s chosen script skips the path check',
            'return resolve(chosen || STAGES[stage] || stage);',
            "return chosen ? require('path').join(appDir, chosen) : resolve(STAGES[stage] || stage);"],

        //extra.sh usually only exists for a project, and its absence is normal.
        ['asking whether a stage exists says yes to everything',
            '        try { fileFor(vm, stage); return true; } catch (e) { return false; }',
            '        return true;'],

        //Root and user are separate stages.
        ['the user half of a stage runs the root script',
            "    toolchainUser: 'toolchain-user.sh',",
            "    toolchainUser: 'toolchain.sh',"],

        //Which stage a requested filename belongs to.
        ['a filename is matched to the wrong stage',
            '        Object.keys(STAGES).forEach(function (s) { if (!found && STAGES[s] === name) found = s; });',
            '        Object.keys(STAGES).forEach(function (s) { if (!found) found = s; });'],

        //Read fresh on every request, never cached.
        ['a script is read once and cached, so editing one needs a restart',
            '    function raw(vm, stage) { return readFile(fileFor(vm, stage)); }',
            '    var held = {};\n    function raw(vm, stage) { if (!held[stage]) held[stage] = readFile(fileFor(vm, stage)); return held[stage]; }'],

        //What is available, and which copy would be used.
        ['the list has one entry per copy rather than one per name',
            '                if (Object.prototype.hasOwnProperty.call(seen, f)) return;\n                seen[f] = true;',
            ''],

        ['the list offers files that are not servable',
            '            readDir(dir).filter(function (f) { return SERVABLE.test(f); }).sort().forEach(function (f) {',
            '            readDir(dir).sort().forEach(function (f) {'],

        //Render: the script goes in unchanged, between the two.
        ['a machine’s own setup steps are dropped',
            "            steps ? '\\n# --- this machine\\'s own setup steps -------------------------------\\n' + steps : ''",
            "            ''"],

        ['what is SAID about a step is not quoted',
            "            return 'say ' + q('extra step ' + (i + 1) + ': ' + (s.name || s.run)) + '\\n' + s.run + '\\n';",
            "            return 'say ' + 'extra step ' + (i + 1) + ': ' + (s.name || s.run) + '\\n' + s.run + '\\n';"],

        ['the script is not put in at all',
            '            header(vm, where),\n            body,',
            '            header(vm, where),']
    ]
};
