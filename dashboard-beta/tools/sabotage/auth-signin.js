//what ../../test/vms/auth-signin.test.js has to be able to catch.
module.exports = {
    file: 'src/app/vms/auth/signin.js',
    test: 'test/vms/auth-signin.test.js',
    breaks: [
        //---- never as the machine's own user ----------------------------------

        //A SIGN-IN WRITES ~/.claude/.credentials.json FOR WHOEVER RUNS IT. On a
        //supervisor that user is holding the credential the machine is thinking
        //with, so the act of getting a new one would destroy the one in use.
        ["the sign-in runs as the machine's own user",
            "        return 'printf %s ' + q(Buffer.from(String(script), 'utf8').toString('base64'))\n            + ' | base64 -d | sudo -n -u ' + q(who) + ' -H bash -ls';",
            "        return String(script);"],

        ['the desk gets the caller\'s home rather than its own',
            "            + ' | base64 -d | sudo -n -u ' + q(who) + ' -H bash -ls';",
            "            + ' | base64 -d | sudo -n -u ' + q(who) + ' bash -ls';"],

        //`-n` SO IT FAILS rather than waiting for a password nobody is there to
        //type.
        ['sudo waits for a password nobody is there to type',
            "            + ' | base64 -d | sudo -n -u ' + q(who) + ' -H bash -ls';",
            "            + ' | base64 -d | sudo -u ' + q(who) + ' -H bash -ls';"],

        //`-l` AS WELL AS `-s`. Without a login shell the script runs with
        //whatever PATH sudo hands over, and the sign-in came back "claude:
        //command not found" from a user that could run it by absolute path.
        ['the desk gets whatever PATH sudo hands over',
            "            + ' | base64 -d | sudo -n -u ' + q(who) + ' -H bash -ls';",
            "            + ' | base64 -d | sudo -n -u ' + q(who) + ' -H bash -s';"],

        //THE SCRIPTS ARE FULL OF QUOTES, PIPES, $(...) AND A FIFO. Wrapping them
        //in `bash -c '...'` means quoting all of that a second time.
        ['the script is re-quoted on the way to the desk instead of encoded',
            "        return 'printf %s ' + q(Buffer.from(String(script), 'utf8').toString('base64'))\n            + ' | base64 -d | sudo -n -u ' + q(who) + ' -H bash -ls';",
            "        return 'sudo -n -u ' + q(who) + ' -H bash -lc ' + q(String(script));"],

        //IT REACHES `sudo -u` AND `/home/<desk>`. Quoting answers "can this end
        //the command", not "is this a user".
        ['any desk name at all is used',
            "        if (!/^[a-z_][a-z0-9_-]*$/.test(who)) {\n            throw new Error('\"' + who + '\" is not a user name, so there is no sign-in desk to run this as.');\n        }",
            ''],

        ['a desk name that is a path becomes a home directory',
            "        if (!/^[a-z_][a-z0-9_-]*$/.test(who)) {\n            throw new Error('\"' + who + '\" is not a user name.');\n        }\n        return '/home/' + who;",
            "        return '/home/' + who;"],

        //---- never killed by pattern --------------------------------------------

        //ANY PATTERN THAT MATCHES THE THING BEING KILLED also matches the shell
        //running this script, because that shell has the whole script in its own
        //argv. It killed itself before doing anything and said nothing at all.
        ['the previous attempt is killed by pattern',
            '            \'if [ -f \' + DIR + \'/pid ]; then kill -- -"$(cat \' + DIR + \'/pid)" 2>/dev/null || true; fi\',\n            \'rm -f \' + DIR + \'/in \' + DIR + \'/log \' + DIR + \'/status\',',
            "            'pkill -f \"claude auth login\" 2>/dev/null || true',\n            'rm -f ' + DIR + '/in ' + DIR + '/log ' + DIR + '/status',"],

        //KILLING THE WRAPPER ALONE leaves the worker holding the pipe, and the
        //next attempt hands its code to the old conversation.
        ['only the wrapper is killed, so the worker keeps the pipe',
            '            \'if [ -f \' + DIR + \'/pid ]; then kill -- -"$(cat \' + DIR + \'/pid)" 2>/dev/null || true; fi\',\n            \'rm -f \' + DIR + \'/in \' + DIR + \'/log \' + DIR + \'/status\',',
            '            \'if [ -f \' + DIR + \'/pid ]; then kill "$(cat \' + DIR + \'/pid)" 2>/dev/null || true; fi\',\n            \'rm -f \' + DIR + \'/in \' + DIR + \'/log \' + DIR + \'/status\','],

        ['cancelling leaves the process group running',
            '            \'if [ -f \' + DIR + \'/pid ]; then kill -- -"$(cat \' + DIR + \'/pid)" 2>/dev/null || true; fi\',\n            \'rm -f \' + DIR + \'/in \' + DIR + \'/log \' + DIR + \'/status \' + DIR + \'/pid\',',
            "            'rm -f ' + DIR + '/in ' + DIR + '/log ' + DIR + '/status ' + DIR + '/pid',"],

        //---- the conversation -----------------------------------------------------

        //WITHOUT A WRITER the pipe reaches end-of-file the moment it is opened,
        //and the worker exits deciding nobody is there to answer.
        ['the pipe is not held open, so the worker decides nobody is there',
            '            "setsid bash -c \'exec 3> " + DIR + \'/in; while [ -p \' + DIR + "/in ]; do sleep 1; done\' > /dev/null 2>&1 &",',
            ''],

        //WITHOUT A PTY the sign-in has nowhere to draw and says nothing at all.
        //Silence is the hardest thing to act on.
        ['the sign-in runs with nowhere to draw',
            '            "setsid bash -c \'script -qec \\"claude auth login\\" /dev/null < " + DIR + \'/in > \' + DIR\n                + \'/log 2>&1; echo $? > \' + DIR + "/status\' > /dev/null 2>&1 &",',
            '            "setsid bash -c \'claude auth login < " + DIR + \'/in > \' + DIR\n                + \'/log 2>&1; echo $? > \' + DIR + "/status\' > /dev/null 2>&1 &",'],

        //POLLED RATHER THAN SLEPT AT, so a fast answer is not paid for with a
        //fixed wait and a slow one is not cut off early.
        ['it sleeps a fixed time instead of watching for the url',
            "            \"  if grep -qE 'https?://' \" + DIR + '/log 2>/dev/null; then break; fi',",
            ''],

        //IT BECOMES `seq 1 N` IN A SHELL LOOP: a value that is not a number is a
        //syntax error on a machine.
        ['the wait is whatever arrived rather than a number',
            '    var s = Math.floor(Number(n));\n    if (!(s > 0)) return 20;\n    return Math.min(s, 300);',
            '    return n;'],

        ['there is no upper bound, so a huge wait never returns',
            '    return Math.min(s, 300);',
            '    return s;'],

        //A CODE ARRIVES FROM A PERSON. The only byte that can end the quoting is
        //a single quote.
        ['the code is pasted in rather than quoted',
            '            "printf \'%s\\\\n\' " + q(value) + \' > \' + DIR + \'/in\',',
            '            "printf \'%s\\\\n\' \'" + value + "\' > " + DIR + \'/in\','],

        //`echo -n` IS AN OPTION TO SOME ECHOES AND TEXT TO OTHERS.
        ['a code beginning with a dash becomes an option',
            '            "printf \'%s\\\\n\' " + q(value) + \' > \' + DIR + \'/in\',',
            "            'echo ' + q(value) + ' > ' + DIR + '/in',"],

        ['writing into a conversation that is not there is not noticed',
            '            \'[ -p \' + DIR + \'/in ] || { echo "OKC_AUTH_NO_PIPE"; exit 0; }\',',
            ''],

        //---- reading what came back --------------------------------------------------

        //OSC 8 CARRIES THE ADDRESS INSIDE AN ESCAPE and prints it AGAIN as the
        //visible text. Left in, the URL arrives wrapped and doubled — which
        //looks approximately right and cannot be opened.
        ['what a terminal was sent is taken as text',
            '        var s = plain(output);',
            "        var s = String(output == null ? '' : output);"],

        //A URL AT THE END OF A SENTENCE COLLECTS THE FULL STOP, and a url that
        //does not open reads as the tool being broken.
        ['a url at the end of a sentence keeps the full stop',
            "            url: url ? url.replace(/[.,)\\]}'\"]+$/, '') : null,",
            '            url: url,'],

        //THE DIAGNOSTICS NAME PROGRAMS AND PATHS. A url found there is not the
        //one to visit.
        ['the url is taken from anywhere in the answer',
            "        var url = (log.match(/https?:\\/\\/\\S+/) || [null])[0];",
            "        var url = (s.match(/https?:\\/\\/\\S+/) || [null])[0];"],

        ['a sign-in that has not finished is reported as finished',
            '            finished: !!exit,',
            '            finished: true,'],

        ['a non-zero exit is reported as no exit at all',
            '            exit: exit ? Number(exit[1]) : null,',
            '            exit: null,']
    ]
};
