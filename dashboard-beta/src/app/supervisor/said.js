//---------------------------------------------------------------------------
//WHAT THE PERSON AND THE SUPERVISOR SAY TO EACH OTHER.
//
//Everything else in this app is a record of what was DONE — a task written, a
//branch cut, a run finished. This is the other half: what was asked for and what
//was said about it, in the order it was said.
//
//A FILE, NOT A SOCKET. Both ends are already asking this host things on their
//own rhythm — the window redraws every few seconds, a supervisor asks what is
//new when it has finished thinking — so the thing between them has to survive
//both of them being away. A supervisor is switched off most of the time and a
//window is closed most of the night; a conversation that exists only while both
//are connected loses whichever half arrived first.
//
//NUMBERED, AND THE NUMBER IS THE WHOLE PROTOCOL. Every line gets one that never
//repeats, which is what makes "what is new since I last looked" answerable
//without either side remembering anything except one integer.
//
//WHO SAID IT IS RECORDED AND NEVER INFERRED, and never taken from an argument.
//A line from a supervisor arrives over the wire with the machine's own token; a
//line from the person arrives through the window. The one question this record
//has to answer six weeks later is who asked for a thing, and an answer either
//end could forge is not an answer.
//
//NOT A TRANSCRIPT. What a supervisor's model said to ITSELF while thinking is
//its session, kept per task. This is only what it chose to say out loud, which
//is a much shorter and much more useful list.
//
//---- one document, where the app being ported from keeps a jsonl ------------
//
//OVER THERE IT IS APPEND-ONLY LINES, argued for on the grounds that an
//interrupted write costs one line rather than the file. That reasoning is sound
//and the conclusion does not carry, because ../core/state writes beside and
//RENAMES INTO PLACE: an interrupted write costs nothing at all, since the file
//that was there is still the file that is there.
//
//So this is one document and the append is done in memory. What is given up is
//O(1) writes, and a conversation is capped at 20,000 characters a message and
//is meant to stay something a person can read — rewriting a few hundred short
//lines is not a cost worth a second storage idiom in this app for.
//---------------------------------------------------------------------------

//WHO MAY SPEAK, and there are exactly two kinds. A third would need a reason and
//a column, and neither exists yet.
var WHO = { person: true, supervisor: true };

//AND WHERE IT CAME FROM, which is a different question from who said it.
//
//"You" covers a person typing in the window, a person at the command line, and a
//drill exercising this record — and they are worth telling apart. A drill's
//lines used to say so by starting with "drill:", which is a convention living in
//the TEXT of a message: it cannot be relied on, it cannot be styled, and it is
//the sort of thing somebody's real message eventually starts with by accident.
//
//Recorded from HOW THE CALL ARRIVED rather than from anything it claims. The
//window shows it, so a line that came from a drill looks like one at a glance
//and cannot be dressed up as a person typing.
var VIA = { window: true, cli: true, test: true, wire: true };

//Long enough for a supervisor to explain itself, short enough that this stays
//something a person reads. A model that needs more than this is writing a
//document, and a document belongs on a branch.
var MOST = 20000;

module.exports = function said(doc, readDoc, fromDoc) {
    function lines() {
        var kept = doc.read({ lines: [] });
        return (kept && kept.lines) || [];
    }

    function lastNumber() {
        var all = lines();
        return all.length ? (Number(all[all.length - 1].n) || all.length) : 0;
    }

    function say(what) {
        var w = what || {};

        if (!Object.prototype.hasOwnProperty.call(WHO, w.who)) {
            throw new Error('"' + w.who + '" is not somebody who talks here. It is a person or a supervisor.');
        }
        var via = w.via || 'window';
        if (!Object.prototype.hasOwnProperty.call(VIA, via)) {
            throw new Error('"' + via + '" is not a way in. It is ' + Object.keys(VIA).join(', ') + '.');
        }

        var text = String(w.text == null ? '' : w.text).trim();
        if (!text) throw new Error('There is nothing to say.');
        if (text.length > MOST) {
            throw new Error('that is ' + text.length + ' characters, and the most a message takes is '
                + MOST + '. Put anything longer where it belongs — a task brief, or a file on a branch.');
        }

        var line = {
            n: lastNumber() + 1,
            at: new Date().toISOString(),
            who: w.who,
            via: via,
            //WHICH MACHINE, when it was a supervisor. Two are not supposed to run
            //at once, and this is what would show it if they did.
            from: w.from || null,
            //WHAT IT IS ABOUT, when it is about something: a task number, a cut,
            //an issue. Free text on purpose — a note beside a message, not an
            //index.
            about: w.about || null,
            text: text
        };

        var all = lines();
        all.push(line);
        doc.write({ lines: all });
        return line;
    }

    //---- what has actually been read ---------------------------------------
    //
    //A MESSAGE WRITTEN DOWN IS NOT A MESSAGE DELIVERED, and the difference is
    //the whole reason this needs saying: a supervisor is switched off most of
    //the time, so a line sitting here may have been read a second ago or may be
    //waiting for a machine to boot. From the person's side those look identical,
    //which makes the tab read as a chat where the other end is ignoring you.
    //
    //A POINTER, NOT A FLAG PER LINE. The numbering already answers it — a
    //message is read when its number is at or below the last one handed to the
    //supervisor.
    function readMark() {
        var m = readDoc.read({});
        return { n: Number(m && m.n) || 0, at: (m && m.at) || null, by: (m && m.by) || null };
    }

    function markRead(n, by) {
        var upTo = Number(n) || 0;
        var was = readMark();
        //NEVER BACKWARDS. A supervisor asking with an old bookmark is re-reading,
        //not un-reading, and a receipt that flickers off is worse than none.
        if (upTo <= was.n) return was;
        var now = { n: upTo, at: new Date().toISOString(), by: by || null };
        readDoc.write(now);
        return now;
    }

    //---- reading it back ---------------------------------------------------
    //
    //`since` IS EXCLUSIVE. It is what the other end was last told, so asking
    //twice with the same number must not deliver the same message twice.
    //
    //TRIMMED FROM THE FRONT, keeping the most recent, and what was dropped is
    //COUNTED rather than quietly lost — an end that reads a trimmed feed and
    //believes it saw everything is worse off than one told it missed six.
    function since(n, opts) {
        var o = opts || {};
        var from = Number(n) || 0;
        var all = lines().filter(function (m) { return Number(m.n) > from; });

        //OLDEST FIRST, because a conversation read newest-first is not a
        //conversation. Trimmed from the FRONT when there is too much: an end
        //that has been away for a week wants what was said last.
        var limit = Math.max(1, Math.min(1000, Number(o.limit) || 200));
        var rows = all.slice(-limit);

        var budget = Math.max(0, Number(o.bytes) || 0);
        if (budget) {
            //NEWEST FIRST WHILE CHOOSING, oldest first when handing back.
            //Working backwards is what makes "keep the most recent that fit" one
            //pass.
            var kept = [];
            var used = 0;
            for (var i = rows.length - 1; i >= 0; i--) {
                var one = rows[i];
                var size = JSON.stringify(one).length;
                if (used + size > budget) {
                    //ROOM FOR THE LAST ONE EVEN IF IT IS ENORMOUS. A feed that
                    //answers "nothing" because the newest message is long is the
                    //same failure in a smaller place, so the most recent is
                    //always sent, shortened.
                    if (!kept.length) {
                        kept.unshift(Object.assign({}, one, {
                            text: shorten(one.text, Math.max(400, budget - 200))
                        }));
                    }
                    break;
                }
                used += size;
                kept.unshift(one);
            }
            rows = kept;
        }

        return {
            messages: rows,
            //THE LAST NUMBER SEEN rather than the last delivered, so a trimmed
            //answer does not silently skip the middle.
            bookmark: rows.length ? Number(rows[rows.length - 1].n) : from,
            missed: all.length - rows.length
        };
    }

    //TRIMMED FROM THE FRONT for the same reason the list is: the end of a long
    //message is what it concluded.
    function shorten(text, to) {
        var s = String(text == null ? '' : text);
        if (s.length <= to) return s;
        return '…(' + (s.length - to) + ' characters before this)…\n' + s.slice(-to);
    }

    function all() { return lines(); }

    //---- where the PERSON is reading from ----------------------------------
    //
    //NOT A DELETION. "Clear" threw the conversation away, and a conversation
    //with a supervisor is the record of what was asked for and why — the one
    //place that says why a task exists at all. Tidying a screen is not a reason
    //to destroy that, and once it is gone there is nowhere to get it back from.
    //
    //So the tidying is a BOOKMARK: everything at or below it stays exactly where
    //it is and stops being drawn. Move it back to zero and the whole thing is
    //there again — there is no separate "unhide".
    //
    //KEPT ON THE HOST, like the read receipt, because it is a fact about this
    //installation rather than about one window: a reading position that resets
    //on every restart is one nobody would bother setting.
    //
    //AND IN ITS OWN DOCUMENT, because it is the OPPOSITE pointer into the same
    //list. One says "the machine has seen up to here", this says "the person
    //does not want to see before here"; they move independently, and one
    //document holding both would eventually have one overwrite the other.
    function fromMark() {
        var m = fromDoc ? fromDoc.read({}) : {};
        return { n: Number(m && m.n) || 0, at: (m && m.at) || null, by: (m && m.by) || null };
    }

    function markFrom(n, by) {
        var at = Math.max(0, Number(n) || 0);
        var line = { n: at, at: new Date().toISOString(), by: by || null };
        if (fromDoc) fromDoc.write(line);
        return line;
    }

    //THROWN AWAY DELIBERATELY, AND ONLY EVER WHOLE: half a conversation reads
    //worse than none, and there is nothing here worth keeping selectively.
    function clear() {
        var n = lines().length;
        doc.write({ lines: [] });
        readDoc.write({ n: 0, at: new Date().toISOString(), by: null });
        //AND THE READING BOOKMARK WITH IT. Numbering restarts at one, so a
        //bookmark left at twelve would hide the next twelve things said — an
        //empty thread that fills up and still shows nothing.
        if (fromDoc) fromDoc.write({ n: 0, at: new Date().toISOString(), by: null });
        return n;
    }

    return {
        say: say, all: all, since: since, lastNumber: lastNumber,
        readMark: readMark, markRead: markRead, clear: clear,
        fromMark: fromMark, markFrom: markFrom,
        WHO: Object.keys(WHO), VIA: Object.keys(VIA), MOST: MOST
    };
};
