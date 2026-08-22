//what ../../test/vms/dispatch-script.test.js has to be able to catch.
module.exports = {
    file: 'src/app/vms/dispatch/script.js',
    test: 'test/vms/dispatch-script.test.js',
    breaks: [
        //---- the credential ---------------------------------------------------

        //ENV IS WHAT A TRANSCRIPT DUMPS, and the output of a run is captured to
        //this host and KEPT. A credential reaching agent-visible output is
        //copied out and filed by design.
        ['the machine token is exported into the run environment',
            "            lines.push('export OKC_BASE OKC_RUN');",
            "            lines.push('OKC_TOKEN=' + q(it.token));\n            lines.push('export OKC_BASE OKC_RUN OKC_TOKEN');"],

        ['the credential file is written before the umask that protects it',
            "            'umask 077',\n            heredoc(dir + '/auth', String(it.vm) + ':' + String(it.token), 'OKC_AUTH_EOF'),",
            "            heredoc(dir + '/auth', String(it.vm) + ':' + String(it.token), 'OKC_AUTH_EOF'),\n            'umask 077',"],

        ['a run with no job is handed the credential anyway',
            '        if (it.job) out.push(theJob(dir, it));',
            '        out.push(theJob(dir, it));'],

        //---- everything somebody else wrote goes through a guarded heredoc -----

        //A TASK IS WRITTEN BY A PERSON OR BY ANOTHER AGENT. A line reading like
        //the marker ends the file early and the rest is executed as shell.
        ['the task is put on the command line instead of in a file',
            "        out.push(heredoc(dir + '/task.txt', it.task, 'OKC_TASK_EOF'));",
            "        out.push('echo ' + q(it.task) + ' > ' + dir + '/task.txt');"],

        //THE ONE HEREDOC THE VERSION THIS COMES FROM WROTE INLINE, without the
        //marker check.
        ['the run script is written without the marker check',
            "        out.push(heredoc(dir + '/run.sh', runSh(dir, it, rules), 'OKC_RUN_EOF'));",
            "        out.push('cat > ' + dir + \"/run.sh <<'OKC_RUN_EOF'\\n\" + runSh(dir, it, rules) + '\\nOKC_RUN_EOF');"],

        //A FOLDER WITH A SPACE IN IT is the bug that started all of this: a
        //shell-quoted path inside a single-quoted -c argument ends that argument.
        ['the folder is not quoted, so one with a space in it breaks the run',
            "        lines.push('cd ' + q(it.folder) + ' 2>/dev/null || cd \"$HOME\"');",
            '        lines.push(\'cd \' + it.folder + \' 2>/dev/null || cd "$HOME"\');'],

        ['the folder the dispatch itself changes to is not quoted either',
            "        out.push('cd ' + q(it.folder) + ' 2>/dev/null || cd \"$HOME\"');",
            '        out.push(\'cd \' + it.folder + \' 2>/dev/null || cd "$HOME"\');'],

        //---- the three kinds ---------------------------------------------------

        ['a run can be a job and a shell command at once',
            '        if (kinds.length > 1) {',
            '        if (false) {'],

        //A JOB LOOKS LIKE IT SHOULD BE EXEMPT AND IS NOT: job-api.js hands it
        //`claude()`. This exact mistake was made while porting and caught by
        //diffing against the app this came from.
        ['a job is dispatched to a machine with no worker on it',
            '        if (!it.shell) {',
            '        if (!it.shell && !it.job) {'],

        ['a brief is dispatched to a machine with no worker on it',
            '        if (!it.shell) {',
            '        if (false) {'],

        ['a shell run is refused for want of a worker it does not use',
            '        if (!it.shell) {',
            '        if (true) {'],

        //STREAMED, RATHER THAN ONE BLOB AT THE END. `--output-format json`
        //leaves out.log empty for the whole run and then complete: a
        //twenty-minute worker is a file of zero bytes and a machine that is on.
        ['the worker writes one blob at the end, so nothing can be watched',
            "            + ' --dangerously-skip-permissions --output-format stream-json --verbose'",
            "            + ' --dangerously-skip-permissions --output-format json'"],

        //---- the record ---------------------------------------------------------

        //THE CHANNEL IS HOW IT WAS ASKED, NOT WHAT HOLDS IT UP. And setsid is
        //what puts the run in one process group, which is what stop() relies on.
        ['the run dies with the connection that started it',
            "        out.push('nohup setsid bash ' + dir + '/run.sh > /dev/null 2>&1 &');",
            "        out.push('bash ' + dir + '/run.sh');"],

        ['the run is not given a session of its own, so stopping it leaves children',
            "        out.push('nohup setsid bash ' + dir + '/run.sh > /dev/null 2>&1 &');",
            "        out.push('nohup bash ' + dir + '/run.sh > /dev/null 2>&1 &');"],

        //WITHOUT ITS PID a run that was killed reads as "running" forever,
        //because the status file it would have written is what never got written.
        ['the run does not record its own pid',
            "        lines.push('echo $$ > ' + dir + '/pid');",
            ''],

        ['the run does not record what became of it',
            "        lines.push('echo $? > ' + dir + '/status');",
            ''],

        ['a run that dies in its first second is a directory nobody can account for',
            "        out.push('date -u +%Y-%m-%dT%H:%M:%SZ > ' + dir + '/started');",
            ''],

        ['it does not say which run it started',
            "        out.push('echo okc-dispatched ' + id);",
            "        out.push('echo okc-dispatched');"],

        ['the id is built into paths without being checked',
            '        var id = runsOf.checkId(it.id);',
            '        var id = String(it.id);'],

        //SOMETHING THAT WANTS TO SEE THE WORK would otherwise have to know an id
        //that did not exist a moment ago.
        ['there is no fixed name for whichever run is happening now',
            "        out.push('ln -sfn ' + dir + ' ' + RUNS + '/current');",
            ''],

        //---- the contract --------------------------------------------------------

        //A PATH PROVES NOTHING about what the worker was told, read six weeks
        //later.
        ['the contract is referenced rather than carried',
            "            out.push(heredoc(rules, it.contract, 'OKC_CONTRACT_EOF'));",
            ''],

        ['the worker is never given the rules it was dispatched under',
            "            + (rules ? ' --append-system-prompt-file ' + rules : '')",
            "            + ''"],

        ['a run with no contract points at a file that was never written',
            "        var rules = it.contract ? dir + '/contract.md' : null;",
            "        var rules = dir + '/contract.md';"],

        //---- the way back ---------------------------------------------------------

        //THE MACHINE GOES BACK TO ITS BASE SNAPSHOT when the work ends: a file
        //left on the disk did not survive, a file handed over did.
        ['a task cannot hand anything back',
            '        if (it.base) out.push(theWayBack(dir, it.base));',
            ''],

        ['the run directory is not on PATH, so okc-artifact is not a command',
            "        lines.push('PATH=' + dir + ':$PATH');",
            ''],

        //BEST EFFORT, ALWAYS EXITS 0. A line that could not be delivered must
        //never fail the work it was describing.
        ['a line that could not be delivered fails the work it was describing',
            "            '  \"' + base + '/provision/say\" >/dev/null 2>&1 || true',\n            'exit 0',",
            "            '  \"' + base + '/provision/say\"',"],

        //A MACHINE BUILT LAST MONTH would otherwise work to last month's rules.
        //THE FETCH ITSELF, not the mkdir beside it. Removing only the mkdir
        //leaves the curl line — and the url in it — sitting there for a test to
        //find, which is how this break SURVIVED the first sweep of this file.
        ['the skill is never fetched, so a worker runs to whatever it was built with',
            '        lines.push(\'  "\' + base + \'/provision/runner-skill.md?vm=${OKC_VM}" 2>/dev/null || true\');',
            '']
    ]
};
