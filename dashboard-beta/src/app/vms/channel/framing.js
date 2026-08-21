//---------------------------------------------------------------------------
//NEWLINE-DELIMITED JSON, AND NOTHING ELSE.
//
//No dependency beyond what every language already has, trivial to re-implement
//in a guest in whatever it happens to have, and — the reason it was chosen —
//IT SURVIVES A SOCKET DYING MID-LINE, because the framing is the newline. Half
//a message is simply a message that has not arrived yet.
//
//A CHUNK IS NOT A MESSAGE, and that is the whole of what this file is for. TCP
//gives you bytes: one write can arrive as three chunks, three writes can arrive
//as one, and both happen the moment a guest is busy. Anything that reads a
//chunk as a message works perfectly until the machine is under load.
//---------------------------------------------------------------------------

//A LINE BIG ENOUGH FOR A BUILD'S OUTPUT CHUNK, small enough that a runaway guest
//cannot exhaust memory on this side.
var MAX_LINE = 4 * 1024 * 1024;

//---- what a fault is -------------------------------------------------------
//
//RETURNED RATHER THAN THROWN. Every one of these ends the session, and the
//caller is the only thing holding a socket to end — so this says what happened
//and lets the socket layer be the only place that knows how to hang up.
function fault(why) { return { fault: why }; }

module.exports = function framing(opts) {
    var o = opts || {};
    var max = o.max || MAX_LINE;

    //ONE OF THESE PER SOCKET. The buffer is the half-line that has not finished
    //arriving, and it is the only state there is.
    var buffer = '';

    //EVERYTHING COMPLETE THAT HAS ARRIVED, in order, and what is left over stays
    //here for the next chunk.
    function take(chunk) {
        buffer += chunk;

        var out = [];
        var cut;
        while ((cut = buffer.indexOf('\n')) !== -1) {
            var line = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 1);

            //A BLANK LINE IS NOT A MESSAGE. Anything writing these by hand ends
            //up sending one, and it is not worth hanging up over.
            if (!line.trim()) continue;

            var msg;
            try { msg = JSON.parse(line); }
            catch (e) { return { messages: out, fault: 'sent something that was not JSON' }; }

            //JSON's TOP LEVEL IS NOT ALWAYS AN OBJECT. `null`, `7` and `"hi"`
            //all parse, and every reader downstream would then be reading
            //properties off something that has none — a fault a guest can cause
            //by writing one character.
            if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
                return { messages: out, fault: 'sent something that was not a message' };
            }

            out.push(msg);
        }

        //THE CHECK IS ON WHAT IS LEFT OVER, not on what arrived.
        //
        //Measuring the whole buffer before splitting it counts complete lines
        //towards a limit that is about ONE line — so a machine sending a lot of
        //perfectly good output quickly is hung up on for "sent a line that never
        //ended", which is the one explanation that is not true. What must be
        //bounded is the unfinished remainder, because that is the part this side
        //is holding with no end in sight.
        if (buffer.length > max) return { messages: out, fault: 'sent a line that never ended' };

        return { messages: out };
    }

    //FOR WRITING ONE. Here rather than at each call site so that the framing is
    //decided in exactly one place: a message written without its newline is a
    //message the far end waits for forever, and it looks like a hang.
    function line(msg) { return JSON.stringify(msg) + '\n'; }

    //WHAT IS STILL UNFINISHED, for a test and for a log line about a machine that
    //went away mid-sentence.
    function pending() { return buffer.length; }

    return { take: take, line: line, pending: pending, MAX_LINE: max };
};

module.exports.MAX_LINE = MAX_LINE;
module.exports.fault = fault;
