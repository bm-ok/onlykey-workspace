//what ../../test/vms/dispatch-supervisor.test.js has to be able to catch.
module.exports = {
    file: 'src/app/vms/dispatch/supervisor.js',
    test: 'test/vms/dispatch-supervisor.test.js',
    breaks: [
        //---- the order --------------------------------------------------------

        //A SUPERVISOR IS NEVER ROLLED BACK, so without the refresh it works to
        //whatever it was built with, for as long as it exists.
        ['it supervises by whatever rules it was built with',
            "            'cd ~ && ' + String(it.refresh == null ? 'true' : it.refresh),",
            "            'cd ~',"],

        //A TERMINAL ALREADY OPEN FOLLOWS current.log. Relinking after the turn
        //has started shows the PREVIOUS wake for the length of this one.
        ['the log is relinked after the turn has already started',
            "            'ln -sfn ' + log + ' ' + SUPERVISOR + '/current.log',\n            'timeout 600 bash -lc \\'okc-supervisor -p \"$(cat /tmp/okc-wake.txt)\"'",
            "            'timeout 600 bash -lc \\'okc-supervisor -p \"$(cat /tmp/okc-wake.txt)\"'"],

        ['the watcher follows this one turn, and then nothing',
            "            watcher.watcherFor(SUPERVISOR, SUPERVISOR + '/current.log'),",
            '            watcher.watcherFor(SUPERVISOR, log),'],

        //THE BRIEF IS THE LAST INSTRUCTION THIS HOST GAVE, sitting in /tmp on a
        //machine that is never rolled back.
        ['the brief is left on the machine afterwards',
            "            'rm -f /tmp/okc-wake.txt'",
            "            'true'"],

        ['the brief is removed before the turn reads it',
            "            'ln -sfn ' + log + ' ' + SUPERVISOR + '/current.log',",
            "            'rm -f /tmp/okc-wake.txt',\n            'ln -sfn ' + log + ' ' + SUPERVISOR + '/current.log',"],

        ['the brief is never written at all',
            "            'printf %s ' + q(brief) + ' | base64 -d > /tmp/okc-wake.txt',",
            "            'true',"],

        //---- what a turn produces ----------------------------------------------

        //A SUPERVISOR IS NEVER ROLLED BACK, so the file is still there tomorrow
        //when somebody asks what it did. Down the channel it is gone.
        ['the transcript comes back down the channel instead of to a file',
            "                + ' --output-format stream-json --verbose > ' + log + ' 2>&1\\''",
            "                + ' --output-format stream-json --verbose\\''"],

        ['nothing can be watched while the turn runs',
            "                + ' --output-format stream-json --verbose > ' + log + ' 2>&1\\''",
            "                + ' --output-format json > ' + log + ' 2>&1\\''"],

        //TEN MINUTES IS LONGER THAN ANY TURN THAT HAS WORKED, and a turn that
        //has stopped making progress must not hold the channel for ever.
        ['a turn that has stopped making progress holds the channel for ever',
            "            'timeout 600 bash -lc \\'okc-supervisor -p \"$(cat /tmp/okc-wake.txt)\"'",
            "            'bash -lc \\'okc-supervisor -p \"$(cat /tmp/okc-wake.txt)\"'"],

        //---- what it refuses -----------------------------------------------------

        //THE STAMP BECOMES A FILENAME: a `>` redirect writes to it and a symlink
        //points at it. "It is made by this host" is a property of every caller
        //there is today, not of this function.
        ['any stamp at all becomes a path',
            '        if (!STAMP.test(stamp)) {',
            '        if (false) {'],

        ['a stamp may contain a path or a substitution',
            'var STAMP = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;',
            'var STAMP = /^[\\s\\S]*$/;'],

        //THE ENCODING IS WHAT LETS THE BRIEF BE PROSE WITH QUOTES IN IT. A brief
        //that skipped it carries the one character that ends the quoting.
        ['a brief that never went through base64 is sent anyway',
            '        if (!BASE64.test(brief)) {',
            '        if (false) {'],

        ['anything counts as base64',
            'var BASE64 = /^[A-Za-z0-9+/=\\r\\n]*$/;',
            'var BASE64 = /^[\\s\\S]*$/;'],

        ['the brief is pasted in by hand rather than quoted',
            "            'printf %s ' + q(brief) + ' | base64 -d > /tmp/okc-wake.txt',",
            '            \'printf %s \\\'\' + brief + \'\\\' | base64 -d > /tmp/okc-wake.txt\','],

        //---- and the refusals say which thing was wrong --------------------------

        ['the refusal does not say a stamp becomes a filename',
            "            throw new Error('\"' + stamp + '\" is not a name for a turn. '\n                + 'They are letters, numbers, dots and dashes — it becomes a filename.');",
            "            throw new Error('bad stamp');"],

        ['the refusal does not say the brief must be encoded',
            "            throw new Error('A supervisor brief reaches the machine base64-encoded, and this one is not. '\n                + 'Encoding it is what lets it be prose with quotes in it.');",
            "            throw new Error('bad brief');"]
    ]
};
