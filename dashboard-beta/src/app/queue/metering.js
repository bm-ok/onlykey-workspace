//---------------------------------------------------------------------------
//WHAT A RUN COST, READ BEFORE THE MACHINE IS PUT AWAY.
//
//A run's transcript lives ON THE MACHINE, and the machine is restored to its
//base snapshot the moment the work around it ends. So this is the only window in
//which the numbers exist at all — afterwards there is an exit code on this host
//and nothing else.
//
//---- and whether the sign-in was the problem ------------------------------
//
//IT ANSWERS TWO QUESTIONS FROM ONE READ, and the second is the one that changes
//what happens to the WORK. A run that could not authenticate did not fail — it
//never started — and the difference decides whether the task is finished or
//waiting.
//
//Both callers already have the run they just finished, so this is the one place
//that sees the output and knows which sign-in was on the machine.
//
//---- never fatal, and never in the way ------------------------------------
//
//A RUN THAT HAPPENED AND WAS NOT METERED is a gap in a total. A run that FAILED
//because the metering did is work lost for bookkeeping. One catch around the
//whole of it, and nothing downstream reads what it returns.
//---------------------------------------------------------------------------

//WHAT AN AUTHENTICATION FAILURE SOUNDS LIKE. Deliberately a list of phrases
//rather than a code: what comes back is a model's prose about its own trouble,
//and it says the same thing several ways.
var SAYS = /failed to authenticate|oauth|invalid_grant|unauthor|api key|credit balance|401/i;
var FATAL = /^(error|fatal)/i;

//---- AND WHAT IS THIS HOST REFUSING, WHICH IS NOT THE SIGN-IN --------------
//
//A GUEST TALKS TO TWO THINGS AND ONLY ONE OF THEM IS ANTHROPIC. It calls the
//model, and it calls back to THIS dashboard over https with its own machine
//token. Both can answer 401, and they mean opposite things: one is "your Claude
//sign-in is no good", the other is "this host will not serve that route".
//
//IT COST A WORKING CREDENTIAL. A judgement ran for three minutes, thirty turns,
//a dollar of model time, wrote its report — and then handed it back to a route
//this app did not serve. The guest said, accurately:
//
//    Error: the dashboard answered 401: {"error":"This host does not answer to
//    that."}
//
//which starts with "Error" and contains "401", so it was read as an
//authentication failure. The sign-in that had just done the work was paused,
//"nothing will spend a machine on it again until it is replaced", and the
//finished judgement was re-queued as never read.
//
//MATCHED ON WHAT THE GUEST CALLS IT. The message names the responder — this
//app's own words, written by ../../vms/dispatch/guest/job-api.js and
//../../vms/https/server.js — so the test is whose 401 it was rather than a
//guess at the shape of somebody else's error.
var OURS = /the dashboard answered|this host does not answer/i;

//AT MOST THREE, AT MOST 600 CHARACTERS. This ends up in a log line a person
//reads; the whole of a model's complaint is not that.
var MOST_LINES = 3;
var MOST_CHARS = 600;

var NEWLINE = String.fromCharCode(10);

//---- what one line says about authentication -------------------------------
//
//TWO SHAPES, BECAUSE THE OUTPUT HAS TWO. A stream-json line is an object and
//says so structurally; anything else is plain text, and there the only safe
//signal is a line that starts by announcing itself as an error AND mentions
//something authentication-shaped. Matching the phrases alone on plain text would
//catch a worker DISCUSSING an api key, which is a thing workers do.
function authTrouble(line) {
    //THIS HOST'S OWN REFUSAL IS NEVER THE SIGN-IN'S FAULT. Checked before
    //anything else, and for both shapes, because a guest reports our 401 as
    //plain text and can also carry it inside a stream-json result.
    if (OURS.test(line)) return null;

    if (line.charAt(0) !== '{') {
        return FATAL.test(line) && SAYS.test(line) ? line : null;
    }

    var o = null;
    try { o = JSON.parse(line); } catch (e) { return null; }
    if (!o) return null;

    //EVERY WAY THE CLI SAYS "THIS WENT WRONG". Several, because it has said it
    //several ways across versions, and a run that failed to authenticate while
    //this file recognised only last month's shape is a machine spent for nothing.
    var errored = o.is_error === true
        || o.is_api_error_message === true
        || (typeof o.error === 'string' && o.error.trim())
        || (o.error && typeof o.error === 'object')
        || o.subtype === 'error_during_execution';

    if (!errored) return null;

    var bits = [];
    function say(v) { if (typeof v === 'string' && v.trim()) bits.push(v.trim()); }

    say(o.result);
    say(typeof o.error === 'string' ? o.error : (o.error && (o.error.message || o.error.type)));

    var content = (o.message && Array.isArray(o.message.content)) ? o.message.content : [];
    for (var i = 0; i < content.length; i++) say(content[i] && (content[i].text || content[i].content));

    var said = bits.join(' ');

    //IT WENT WRONG IS NOT THE SAME AS IT COULD NOT SIGN IN. A run fails for
    //every ordinary reason; only the ones that sound like authentication pause a
    //sign-in, because pausing one wrongly stops every machine using it.
    return said && SAYS.test(said) ? said : null;
}

//---- and the last thing it said about the whole run ------------------------
//
//THE LAST `result` LINE. The CLI ends a run with one, carrying the turns, the
//duration, the tokens and what it cost. A run can print more than one and the
//last is the one about the whole of it.
//
//PARSED LINE BY LINE AS WHOLE JSON rather than by regex over the file:
//half-reading somebody else's format is how a number silently becomes the wrong
//number. A line the tail cut in half simply does not parse, which is expected.
function lastResult(text) {
    var last = null;
    String(text == null ? '' : text).split(NEWLINE).forEach(function (line) {
        var trimmed = line.trim();
        if (trimmed.charAt(0) !== '{' || trimmed.indexOf('"result"') < 0) return;
        try {
            var e = JSON.parse(trimmed);
            if (e && e.type === 'result') last = e;
        } catch (err) { /* a line the tail cut in half, which is expected */ }
    });
    return last;
}

function troubleIn(text) {
    return String(text == null ? '' : text).split(NEWLINE)
        .map(function (x) { return x.trim(); })
        .filter(Boolean)
        .map(authTrouble)
        .filter(Boolean)
        .slice(0, MOST_LINES)
        .join(' ')
        .slice(0, MOST_CHARS);
}

module.exports = function metering(deps) {
    var d = deps || {};
    var call = d.call;

    //WHO HOLDS THE SIGN-IN ON THIS MACHINE, and where a reading is recorded.
    //Injected because neither has moved yet — and because attributing a cost is
    //a question about credentials, which is not this plugin's subject.
    var holderOf = d.holderOf || function () { return null; };
    var pause = d.pause || function () {};
    var record = d.record || function () { return null; };

    async function meterRun(to, machine, runId, about) {
        var it = about || {};
        var failedAuthAs = null;

        try {
            var said = await call('vmRunOutput', { name: machine, run: runId, lines: 60 });
            var text = String((said && (said.output || said.tail)) || '');

            //THE METER'S OWN JOB MATTERS MORE THAN THIS NOTE, so the sign-in
            //check has a catch of its own: a run that was metered and whose
            //credential trouble went unreported is better than neither.
            try {
                var trouble = troubleIn(text);
                if (trouble) {
                    var on = holderOf(machine);
                    if (on) {
                        //PAUSED RATHER THAN REVOKED. A sign-in that cannot
                        //authenticate stops being lent out, and nothing spends a
                        //machine on it again until somebody replaces it — which
                        //is a different act from deciding it is gone.
                        pause(on, { ready: false, on: machine, why: trouble, how: 'run' });
                        to.bad(it.ref + ' could not authenticate as "' + on + '" — that sign-in is paused, '
                            + 'and nothing will spend a machine on it again until it is replaced: '
                            + trouble.slice(0, 160));
                        failedAuthAs = on;
                    }
                }
            } catch (e) { /* the meter's own job matters more than this note */ }

            var last = lastResult(text);
            if (!last) return { row: null, failedAuthAs: failedAuthAs };

            //ATTRIBUTED TO THE SIGN-IN THAT RAN IT, asked rather than assumed —
            //a machine holds whichever credential was lent to it, and that is
            //the account this is billed to.
            var row = record({
                key: holderOf(machine),
                machine: machine,
                kind: it.kind,
                about: it.about,
                ref: it.ref,
                result: last
            });

            if (row && row.cost != null) {
                to.info(it.ref + ' cost ' + Number(row.cost).toFixed(4) + ' USD on '
                    + (row.key || 'an unrecorded sign-in'));
            }

            return { row: row, failedAuthAs: failedAuthAs };
        } catch (e) {
            //NEVER FATAL. A run that happened and was not metered is a gap in a
            //total; a run that failed because the metering did is work lost for
            //bookkeeping.
            to.warn('could not read what ' + runId + ' cost: ' + e.message);
            return { row: null, failedAuthAs: failedAuthAs };
        }
    }

    return { meterRun: meterRun, authTrouble: authTrouble, lastResult: lastResult, troubleIn: troubleIn };
};

module.exports.authTrouble = authTrouble;
module.exports.lastResult = lastResult;
module.exports.troubleIn = troubleIn;
module.exports.SAYS = SAYS;
