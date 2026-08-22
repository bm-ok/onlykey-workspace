var quoting = require('../shell/quoting');
var terminal = require('../shell/terminal');

var q = quoting.q;
var plain = terminal.plain;

//---------------------------------------------------------------------------
//SIGNING A MACHINE'S WORKER IN, FROM HERE.
//
//THE SIGN-IN IS A CONVERSATION: the worker prints a URL, a person visits it and
//authorises, and a code comes back. That is TWO EXCHANGES WITH ONE PROCESS,
//which a single command cannot do — so the process is started detached with its
//input coming from a pipe that stays open, and the code is written into that
//pipe afterwards.
//
//STARTED HERE rather than by somebody opening a terminal on the machine, because
//the whole point is that the host runs this. A person opening the machine and
//typing is the thing every other part of this replaced.
//
//---- and none of it ever runs as the machine's own user -------------------
//
//A sign-in writes `~/.claude/.credentials.json` for whoever runs it. On a
//supervisor that user is holding the credential the machine is THINKING with, so
//asking for a fresh login URL as that user would overwrite it mid-thought: the
//act of getting a new credential would destroy the one in use.
//
//So a supervisor machine has a SECOND USER — the sign-in desk — whose only job
//is to hold this conversation. Its home is its own, its `~/.claude` is its own,
//and everything here happens there. See `asDesk`.
//---------------------------------------------------------------------------

//WHERE THE SIGN-IN KEEPS ITS PIPE AND ITS OUTPUT, on the machine.
var DIR = '$HOME/.okc-auth';

//HOW LONG TO WAIT, BOUNDED BY THIS FILE rather than by whatever arrived. It
//becomes `seq 1 N` in a shell loop, so a value that is not a number is a
//syntax error on a machine, and one that is enormous is a command that never
//returns.
function seconds(n) {
    var s = Math.floor(Number(n));
    if (!(s > 0)) return 20;
    return Math.min(s, 300);
}

module.exports = function signin() {

    //---- start it, and wait just long enough to have something to say -------
    //
    //THE WAIT IS HERE RATHER THAN IN THE CALLER because the answer to "sign this
    //machine in" IS the URL — returning immediately and making somebody ask
    //again would be a worse version of the same round trip.
    function begin(wait) {
        return [
            'set -u',
            'mkdir -p ' + DIR,

            //A PREVIOUS ATTEMPT LEFT A PIPE AND A PROCESS; both would take the
            //input meant for this one, and the URL that came back would
            //authorise the wrong attempt.
            //
            //KILLED BY RECORDED PID, NEVER BY PATTERN. `pkill -f` matches whole
            //command lines, and the shell running this script has the ENTIRE
            //script in its own argv — including the line that launches the
            //sign-in. So any pattern that matches the thing being killed also
            //matches THIS process, and the script kills itself before doing
            //anything at all. It produced no output whatsoever, which is the
            //least diagnosable failure available: gone before it could say so.
            //Bracketing the pattern fixed only the first of the two places the
            //text appears, which is why the second attempt failed identically.
            //
            //A NEGATIVE PID KILLS THE PROCESS GROUP, which is what setsid made
            //it — killing the wrapper alone would leave the worker holding the
            //pipe.
            'if [ -f ' + DIR + '/pid ]; then kill -- -"$(cat ' + DIR + '/pid)" 2>/dev/null || true; fi',
            'rm -f ' + DIR + '/in ' + DIR + '/log ' + DIR + '/status',
            'mkfifo ' + DIR + '/in',

            //HELD OPEN BY A WRITER THAT NEVER WRITES. Without one the pipe
            //reaches end-of-file the moment it is opened, and the worker exits
            //deciding nobody is there to answer — which looks exactly like a
            //sign-in that failed for its own reasons.
            "setsid bash -c 'exec 3> " + DIR + '/in; while [ -p ' + DIR + "/in ]; do sleep 1; done' > /dev/null 2>&1 &",

            //UNDER A PSEUDO-TERMINAL, because the sign-in is an interactive
            //SCREEN rather than a program that prints and reads. Without one it
            //has nowhere to draw and says nothing at all — which is not a
            //failure with a reason, it is silence, and silence is the hardest
            //thing to act on.
            //
            //`script` is util-linux and is already on any machine that has a
            //shell. -q so its own chatter stays out of the log, -e so the
            //worker's exit status is the one recorded rather than script's.
            "setsid bash -c 'script -qec \"claude auth login\" /dev/null < " + DIR + '/in > ' + DIR
                + '/log 2>&1; echo $? > ' + DIR + "/status' > /dev/null 2>&1 &",
            'echo $! > ' + DIR + '/pid',

            //POLLED RATHER THAN SLEPT AT, so a fast answer is not paid for with
            //a fixed wait, and a slow one is not cut off early.
            'for i in $(seq 1 ' + seconds(wait) + '); do',
            "  if grep -qE 'https?://' " + DIR + '/log 2>/dev/null; then break; fi',
            '  if [ -f ' + DIR + '/status ]; then break; fi',
            '  sleep 1',
            'done',

            'echo OKC_AUTH_LOG_BEGIN',
            'cat ' + DIR + '/log 2>/dev/null',
            'echo OKC_AUTH_LOG_END',
            '[ -f ' + DIR + '/status ] && echo "OKC_AUTH_EXIT $(cat ' + DIR + '/status)"',

            //SAID WHEN THERE IS NOTHING ELSE TO SAY. An empty log is the least
            //actionable answer available — it does not distinguish "still
            //starting" from "the program is missing" from "it wrote to a
            //terminal we are not holding" — so the things that tell those apart
            //are reported alongside it.
            'echo OKC_AUTH_WHY_BEGIN',
            'echo "script: $(command -v script || echo MISSING)"',
            'echo "claude: $(command -v claude || echo MISSING)"',
            'echo "pid: $(cat ' + DIR + '/pid 2>/dev/null || echo none) alive: $(kill -0 "$(cat '
                + DIR + '/pid 2>/dev/null || echo 0)" 2>/dev/null && echo yes || echo no)"',
            'echo "logsize: $(wc -c < ' + DIR + '/log 2>/dev/null || echo none)"',
            'echo OKC_AUTH_WHY_END',
            'echo OKC_AUTH_DONE'
        ].join('\n');
    }

    //---- the code, into the pipe the worker is reading ----------------------
    //
    //Then the same poll: it either finishes, or it says why not, and either way
    //the answer is its own output rather than an assumption about what silence
    //meant.
    function code(value, wait) {
        return [
            'set -u',
            '[ -p ' + DIR + '/in ] || { echo "OKC_AUTH_NO_PIPE"; exit 0; }',

            //`printf '%s\n'` RATHER THAN `echo`, because a code beginning with a
            //dash is an option to some echoes and text to others.
            "printf '%s\\n' " + q(value) + ' > ' + DIR + '/in',

            'for i in $(seq 1 ' + seconds(wait) + '); do',
            '  [ -f ' + DIR + '/status ] && break',
            '  sleep 1',
            'done',
            'echo OKC_AUTH_LOG_BEGIN',
            'cat ' + DIR + '/log 2>/dev/null',
            'echo OKC_AUTH_LOG_END',
            '[ -f ' + DIR + '/status ] && echo "OKC_AUTH_EXIT $(cat ' + DIR + '/status)"',
            'echo OKC_AUTH_DONE'
        ].join('\n');
    }

    function cancel() {
        return [
            'if [ -f ' + DIR + '/pid ]; then kill -- -"$(cat ' + DIR + '/pid)" 2>/dev/null || true; fi',
            'rm -f ' + DIR + '/in ' + DIR + '/log ' + DIR + '/status ' + DIR + '/pid',
            'echo OKC_AUTH_CANCELLED'
        ].join('\n');
    }

    //---- reading what came back ---------------------------------------------
    function read(output) {
        //THROUGH ../shell/terminal.js FIRST. What comes back is what a terminal
        //would have been asked to DRAW, and the URL arrives inside an OSC 8
        //hyperlink — wrapped in escapes and printed twice.
        var s = plain(output);

        var log = between(s, 'OKC_AUTH_LOG_BEGIN', 'OKC_AUTH_LOG_END');
        var why = between(s, 'OKC_AUTH_WHY_BEGIN', 'OKC_AUTH_WHY_END');
        var exit = /OKC_AUTH_EXIT (\d+)/.exec(s);

        //THE FIRST http(s) URL IT PRINTED, and only from the LOG rather than
        //from the whole answer — the diagnostics below it name programs and
        //paths, and a URL found there would not be the one to visit.
        var url = (log.match(/https?:\/\/\S+/) || [null])[0];

        return {
            //TRAILING PUNCTUATION TRIMMED, because a URL at the end of a
            //sentence collects the full stop — and a URL that does not open is
            //worse than none, since it reads as the tool being broken.
            url: url ? url.replace(/[.,)\]}'"]+$/, '') : null,
            finished: !!exit,
            exit: exit ? Number(exit[1]) : null,
            log: log,
            why: why,
            noPipe: /OKC_AUTH_NO_PIPE/.test(s),
            cancelled: /OKC_AUTH_CANCELLED/.test(s)
        };
    }

    function between(s, a, b) {
        var i = s.indexOf(a);
        var j = s.indexOf(b);
        if (i < 0 || j <= i) return '';
        return s.slice(i + a.length, j).trim();
    }

    //---- and it runs as the desk, never as the machine's own user ------------
    //
    //THROUGH BASE64, WHICH IS NOT DECORATION. The scripts above are full of
    //quotes, pipes, `$(...)` and a fifo; wrapping them in `sudo -u desk bash -c
    //'...'` means quoting all of that a SECOND time, and this file has already
    //paid once for a pattern that matched itself. Base64 has no metacharacters,
    //so the script crosses unchanged and the shell that runs it is the desk's
    //own.
    //
    //`-H` so HOME is the desk's, which is the entire point. `-n` so it fails
    //rather than waiting for a password nobody is there to type. `-l` as well as
    //`-s`: a LOGIN shell, so the desk's own profile is read — without it the
    //script runs with whatever PATH sudo hands over, and the sign-in came back
    //"claude: command not found" from a user that could run it by absolute path
    //perfectly well.
    function asDesk(script, desk) {
        var who = String(desk == null ? '' : desk);

        //A DESK IS A USER NAME. It reaches `sudo -u` and `/home/<desk>`, so it
        //is held to the shape a user name has rather than quoted and hoped for
        //— quoting answers "can this end the command", not "is this a user".
        if (!/^[a-z_][a-z0-9_-]*$/.test(who)) {
            throw new Error('"' + who + '" is not a user name, so there is no sign-in desk to run this as.');
        }

        return 'printf %s ' + q(Buffer.from(String(script), 'utf8').toString('base64'))
            + ' | base64 -d | sudo -n -u ' + q(who) + ' -H bash -ls';
    }

    //THE DESK'S OWN HOME. `$HOME` in the scripts above is expanded by the shell
    //the desk runs, so it is already right — this is for the caller that has to
    //read a credential out of the desk's home FROM OUTSIDE IT.
    function deskHome(desk) {
        var who = String(desk == null ? '' : desk);
        if (!/^[a-z_][a-z0-9_-]*$/.test(who)) {
            throw new Error('"' + who + '" is not a user name.');
        }
        return '/home/' + who;
    }

    return {
        begin: begin,
        code: code,
        cancel: cancel,
        read: read,
        asDesk: asDesk,
        deskHome: deskHome,
        DIR: DIR
    };
};

module.exports.DIR = DIR;
