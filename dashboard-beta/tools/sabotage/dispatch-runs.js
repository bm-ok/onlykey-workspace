//what ../../test/vms/dispatch-runs.test.js has to be able to catch.
module.exports = {
    file: 'src/app/vms/dispatch/runs.js',
    test: 'test/vms/dispatch-runs.test.js',
    breaks: [
        //---- an id is a name -------------------------------------------------

        //`stop` AND `output` TAKE AN ID BACK FROM A CALLER. An id of "../.."
        //reaches another run's directory whether or not it is quoted properly —
        //quoting cannot answer that, a shape can.
        ['any id at all is built into a script',
            '    if (!ID.test(name) || name.indexOf(\'..\') >= 0) {',
            '    if (false) {'],

        ['an id may contain a path',
            "    var ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;",
            '    var ID = /^[^\\0]*$/;'],

        ['a dotted traversal gets through the shape check',
            "    if (!ID.test(name) || name.indexOf('..') >= 0) {",
            '    if (!ID.test(name)) {'],

        ['the refusal does not say what a run id looks like',
            "        throw new Error('\"' + name + '\" is not a run id. They look like \"'\n            + 'run-2026-08-22T04-08-57\" — letters, numbers, dots and dashes.');",
            "        throw new Error('bad id');"],

        ['stop builds a script without checking the id at all',
            '    var name = checkId(id);\n    return [\n        \'set -u\',',
            "    var name = String(id);\n    return [\n        'set -u',"],

        ['output builds a script without checking the id at all',
            '    var name = checkId(id);\n    var n = Number(lines);',
            '    var name = String(id);\n    var n = Number(lines);'],

        //---- stopping one ----------------------------------------------------

        //TERM LETS A WORKER FINISH THE LINE IT IS WRITING.
        ['it goes straight to KILL, with no chance to finish a line',
            "        'kill -TERM -- -\"$P\" 2>/dev/null || kill -TERM \"$P\" 2>/dev/null || true',",
            ''],

        ['it asks politely and never insists',
            "        '  kill -KILL -- -\"$P\" 2>/dev/null || kill -KILL \"$P\" 2>/dev/null || true',",
            ''],

        //A WORKER SPAWNS CHILDREN. Killing only the leader leaves them running
        //with nothing watching them.
        ['only the leader is killed, so its children keep running',
            "        'kill -TERM -- -\"$P\" 2>/dev/null || kill -TERM \"$P\" 2>/dev/null || true',",
            "        'kill -TERM \"$P\" 2>/dev/null || true',"],

        //"IT WAS STOPPED" IS NOT "IT WAS ALREADY GONE" IS NOT "IT WOULD NOT
        //DIE". A caller that cannot tell them apart reports the last as success.
        ['a run that would not die is reported as stopped',
            '        \'kill -0 "$P" 2>/dev/null && echo "okc-stop-refused" || echo "okc-stop-done"\'',
            '        \'echo "okc-stop-done"\''],

        ['a run that was already gone is not told apart from one that was stopped',
            '        \'if ! kill -0 "$P" 2>/dev/null; then echo "okc-stop-gone"; exit 0; fi\',',
            ''],

        //STOPPING A RUN IS NOT SHUTTING THE MACHINE DOWN. That is the queue's
        //business, and it does it when the run ends.
        ['stopping a run shuts the machine down',
            '        \'kill -0 "$P" 2>/dev/null && echo "okc-stop-refused" || echo "okc-stop-done"\'',
            '        \'poweroff\''],

        //---- what one printed -------------------------------------------------

        ['the line count is whatever arrived, rather than a number this file made',
            '    var n = Number(lines);\n    if (!(n > 0)) n = 40;',
            '    var n = lines == null ? 40 : lines;'],

        ['a run with no output fails instead of saying so',
            '        + \' || echo "okc: no output for that run"\';',
            "        + '';"],

        //---- every run on the machine ------------------------------------------

        //THREE STATES, NOT TWO. A killed run reported as running is a watcher
        //that waits forever for a result nobody will write.
        ['a run that was killed is reported as still running',
            "        '    state=lost',",
            "        '    state=running',"],

        ['a finished run is not told apart from a running one',
            "        '    state=finished',",
            "        '    state=running',"],

        //`Number('')` IS 0, which reads as "it finished, successfully".
        ['a run still going reports an exit code of zero',
            "                exit: f[3] === '' || f[3] == null ? null : Number(f[3]),",
            '                exit: Number(f[3]),'],

        //THE SEPARATOR IS A CHARACTER PROSE DOES NOT HAVE. A pipe is not.
        ['the separator is a character a task can contain',
            '    var SEP = String.fromCharCode(31);',
            "    var SEP = '|';"],

        ['a task containing the separator is cut short',
            '                task: f.slice(6).join(SEP).trim()',
            '                task: (f[6] || \'\').trim()'],

        ['the machine does not flatten the separator out of the task',
            '        \'  first=$(head -c 160 "$d/task.txt" 2>/dev/null | tr "\\\\n\\\\037" "  ")\',',
            '        \'  first=$(head -c 160 "$d/task.txt" 2>/dev/null)\','],

        //NEWEST FIRST, because that is the one being asked about.
        ['the runs come back oldest first',
            '        .sort(function (a, b) { return String(b.started).localeCompare(String(a.started)); });',
            '        .sort(function (a, b) { return String(a.started).localeCompare(String(b.started)); });'],

        ['anything on the connection is parsed as a run',
            '        .filter(function (l) { return l.indexOf(MARK + SEP) === 0; })',
            '        .filter(function (l) { return l.length > 0; })']
    ]
};
