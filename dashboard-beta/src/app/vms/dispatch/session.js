var quoting = require('./quoting');
var q = quoting.q;
var into = quoting.into;

//---------------------------------------------------------------------------
//READING THE CLAUDE SESSION INSIDE A RUNNER.
//
//A machine runs Claude Code; Claude Code appends everything it does to a
//transcript on that machine's disk. That file is the handle — the same one a
//supervising session uses to watch a sibling on the host, except here it is on
//the other side of the channel.
//
//THE READER ITSELF IS ./guest/session.js AND RUNS THERE, not here. This file is
//the two halves that stay on the host: how it is asked, and how the answer is
//taken.
//
//STRICTLY READ-ONLY, and that is a rule rather than an accident of the current
//implementation. A supervisor that writes into the tree a worker is editing is
//how one session's notes end up inside another's commit — a real thing that
//happened here, and the day's worst coordination failure.
//
//DELTAS, NOT DUMPS. The bookmark is a line number in the transcript and the
//caller passes back the one it was given. A watcher that re-reads from the top
//spends its context re-deriving what it already reported — which for an agent is
//the whole cost, and for a long-running task is most of it.
//---------------------------------------------------------------------------

//HOW MUCH OF ANY ONE LINE COMES BACK. Stated here and PASSED, rather than agreed
//in two places — ./guest/session.js carries only a default, for somebody running
//it by hand.
var CLIP = 200;

module.exports = function session(deps) {
    var d = deps || {};
    var payloads = d.payloads;

    //THROUGH STDIN RATHER THAN THE COMMAND LINE, so no quoting has to survive
    //both this file and the guest's login shell — and so nothing is installed on
    //the machine and nothing is left behind.
    //
    //THROUGH ./quoting.js FOR BOTH HALVES. The version this comes from spelled
    //out its own single-quote escaping and its own heredoc, which meant the
    //marker check that stands between somebody's text and the rest of a script
    //being executed applied everywhere except here.
    function command(mode, args) {
        var argv = [String(mode == null ? 'list' : mode)]
            .concat(args || [])
            .concat([CLIP]);

        return into('node - ' + argv.map(q).join(' '), payloads.session(), 'OKC_SESSION_EOF');
    }

    return { command: command, CLIP: CLIP };
};

//---- taking the answer -----------------------------------------------------
//
//THE LAST LINE THAT PARSES AS JSON. The login shell may print anything before it
//— a motd, an nvm notice — and a watcher that took the FIRST line would break on
//a machine somebody had customised.
//
//`redact` IS APPLIED AT THE BOUNDARY, before anything is kept here.
//
//A worker can read its own credential — it cannot authenticate otherwise — and
//it runs as the user that owns the file. So a token can reach its output through
//an env dump, a stack trace, or a stray `cat`, and this transcript is pulled to
//the host and KEPT. That makes it not a moment of exposure but a FILING,
//permanently. Cleaned on the way in is the only place it can be stopped;
//anywhere later is after it has already been written down.
module.exports.answer = function answer(output, redact) {
    var clean = typeof redact === 'function' ? redact(String(output == null ? '' : output))
        : String(output == null ? '' : output);

    var lines = clean.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);

    for (var i = lines.length - 1; i >= 0; i--) {
        if (lines[i].charAt(0) !== '{') continue;
        try { return JSON.parse(lines[i]); } catch (e) { /* keep looking */ }
    }

    return { ok: false, error: 'the machine did not answer with anything readable' };
};

module.exports.CLIP = CLIP;
