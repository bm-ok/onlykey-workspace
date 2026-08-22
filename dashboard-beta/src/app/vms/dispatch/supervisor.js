var quoting = require('../shell/quoting');
var q = quoting.q;

//---------------------------------------------------------------------------
//ONE TURN OF THE SUPERVISOR, as the machine will receive it.
//
//HERE RATHER THAN IN THE ACTION THAT SENDS IT. Everything below is shell heading
//for a guest, and shell assembled inside an action is shell nothing can look at
//without waking a supervisor to watch what happens — which is how a `continue`
//outside a loop and a self-matching `pkill` both reached a machine in this
//project. Built here, it can be printed, checked with `bash -n`, and read by
//somebody who is not currently debugging it.
//
//---- what it does, in order, and each line is load-bearing ----------------
//
//  the skill is refreshed, so it supervises by this host's current rules
//  the watcher is written, so a person can stand behind it
//  the brief is decoded from base64 — it is prose with apostrophes in it, and it
//    is heading for a `bash -c` inside an ssh command
//  current.log is relinked to this turn, so a terminal already open follows it
//  the turn runs, writing stream-json to this turn's own file
//  the brief is removed
//
//THE TRANSCRIPT GOES TO A FILE, NOT DOWN THE CHANNEL. It used to come back as
//prose at the end, and exactly one thing read it: the skill-refresh marker,
//which is echoed before any of this and still arrives. What a turn PRODUCES
//reaches the host through the supervisor API rather than through stdout, so
//nothing downstream loses anything — and a supervisor is never rolled back, so
//the file is still there tomorrow when somebody asks what it did.
//
//`timeout 600` IS KEPT. A turn that has stopped making progress must not hold
//the channel for ever, and ten minutes is longer than any turn that has worked.
//---------------------------------------------------------------------------

var SUPERVISOR = '$HOME/.okc-supervisor';

//THE STAMP BECOMES A FILENAME, so it is held to a shape rather than trusted.
//It is made by this host, but it lands in a path that a `>` redirect writes to
//and a symlink points at — and "it is made by this host" is a property of every
//caller there is today, not of the function.
var STAMP = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

//AND THE BRIEF IS BASE64 by the time it reaches here, which is the whole reason
//it survives being prose with apostrophes in it. Checked rather than assumed:
//the character it must not contain is exactly the one that would end the quoting
//around it, and base64 has no such character — so a brief that is not base64 is
//a brief that has not been through the encoding this line depends on.
var BASE64 = /^[A-Za-z0-9+/=\r\n]*$/;

module.exports = function supervisor(deps) {
    var d = deps || {};
    var watcher = d.watcher;

    function turn(input) {
        var it = input || {};
        var stamp = String(it.stamp == null ? '' : it.stamp);
        var brief = String(it.brief == null ? '' : it.brief);

        if (!STAMP.test(stamp)) {
            throw new Error('"' + stamp + '" is not a name for a turn. '
                + 'They are letters, numbers, dots and dashes — it becomes a filename.');
        }

        if (!BASE64.test(brief)) {
            throw new Error('A supervisor brief reaches the machine base64-encoded, and this one is not. '
                + 'Encoding it is what lets it be prose with quotes in it.');
        }

        var log = SUPERVISOR + '/turns/' + stamp + '.log';

        return [
            'cd ~ && ' + String(it.refresh == null ? 'true' : it.refresh),
            'mkdir -p ' + SUPERVISOR + '/turns',

            //FOLLOWS current.log RATHER THAN THIS TURN'S FILE, so a terminal
            //left open shows every wake instead of one and then silence.
            watcher.watcherFor(SUPERVISOR, SUPERVISOR + '/current.log'),

            //QUOTED THROUGH ./quoting.js RATHER THAN BY HAND. The value is
            //base64 and cannot contain a quote, which is what made the
            //hand-written version safe — but that is a fact about the CALLER,
            //and the check above is what makes it a fact about this function.
            //
            //WITH THAT CHECK IN PLACE THIS CALL CHANGES NOTHING, and that is
            //worth saying rather than leaving it to look load-bearing: pasting
            //the value in by hand produces a byte-identical line. It was tried
            //as a sabotage and survived, exactly as ./runs.js records for its
            //`..` check. It stays because it is what would catch the guard above
            //being weakened by an edit that looked harmless.
            'printf %s ' + q(brief) + ' | base64 -d > /tmp/okc-wake.txt',

            'ln -sfn ' + log + ' ' + SUPERVISOR + '/current.log',
            'timeout 600 bash -lc \'okc-supervisor -p "$(cat /tmp/okc-wake.txt)"'
                + ' --output-format stream-json --verbose > ' + log + ' 2>&1\'',

            //REMOVED WHATEVER HAPPENED. The brief is what this host asked for and
            //it has been read by now; leaving it in /tmp is a copy of the last
            //instruction sitting on a machine that is never rolled back.
            'rm -f /tmp/okc-wake.txt'
        ].join('\n');
    }

    return { turn: turn, SUPERVISOR: SUPERVISOR };
};

module.exports.SUPERVISOR = SUPERVISOR;
