var crypto = require('crypto');

//---------------------------------------------------------------------------
//WHETHER A MACHINE CHANGED THE NOTES — WHICH IS NOT "DO THEY DIFFER".
//
//THE OBVIOUS CHECK IS WRONG AND WOULD UNDO PEOPLE'S WORK. Comparing what is on
//the machine against what the host has now says "different" in two completely
//different situations:
//
//  a seat booted this morning with v1, touched nothing, and the host is at v3
//  because a judge improved the notes at lunchtime
//
//  a seat booted this morning with v1 and somebody wrote three paragraphs into
//  it
//
//The first is a machine holding an old copy. The second is the whole feature.
//A check that cannot tell them apart proposes reverting every change approved
//since that machine booted, and calls it an edit.
//
//SO THERE ARE THREE VALUES, NOT TWO:
//
//    base    what this machine was GIVEN, recorded by the guest door as it
//            served the file -- the only place that knows exactly which string
//            went to which machine
//    host    what the host has now
//    guest   what is on the machine at shutdown
//
//AND THE ANSWER IS ABOUT base, NOT ABOUT host. `guest === base` means untouched,
//whatever the host has become since, and that is silent. Only `guest !== base`
//is an edit at all.
//
//---- FORWARD ONLY ---------------------------------------------------------
//
//A CHANGE CAN ONLY BE APPLIED WHERE ITS BASE IS STILL THE NEWEST. An edit made
//on top of v1 while the host moved to v3 is a FORK: applying it would drop v2
//and v3 without anybody deciding to. It is still a real change and it is still
//worth having -- it goes to a person with both sides shown, and it never lands
//on its own.
//
//WHICH MAKES THE STORED DOCUMENT MONOTONIC. Every version kept is newer than
//the one before it, and nothing here can move it back.
//---------------------------------------------------------------------------

//SHA-256 AND NOT A LENGTH OR A TIMESTAMP. Two edits of the same size are
//ordinary -- correcting a word, swapping a command -- and mtime on a guest is
//whatever that machine's clock says, which is not this host's.
function hashOf(text) {
    if (text == null) return null;
    return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

//---- THE FIVE ANSWERS -----------------------------------------------------
//
//NAMED RATHER THAN BOOLEAN, because the caller does something different for
//each and a pair of flags would be re-derived differently at each call site.
//
//    'untouched'    guest === base. Silence.
//    'no base'      this machine was never recorded as being given anything, so
//                   an edit cannot be told from a stale copy. Says so; proposes
//                   nothing. The safe direction, and the same rule the reply
//                   door keeps: a check that could not run has not been passed.
//    'nothing'      no notes came back at all -- the file is missing or empty.
//                   Not a deletion: a machine that never had them looks
//                   identical to one that removed them, and removing the
//                   workspace's notes is not something to infer.
//    'changed'      a real edit, made on top of what the host still has.
//    'forked'       a real edit, made on top of something the host has moved on
//                   from. A person sees both.
function changedOf(it) {
    var a = it || {};
    var base = a.base == null ? null : String(a.base);
    var host = a.host == null ? null : String(a.host);
    var guest = a.guest == null ? null : String(a.guest);

    if (guest === null || !guest.trim()) {
        return { is: 'nothing', why: 'nothing came back from the machine, so there is nothing to compare.' };
    }

    if (base === null) {
        return {
            is: 'no base',
            why: 'this host did not record what that machine was given, so a change on it cannot be told '
                + 'apart from the copy it booted with. Nothing is proposed.'
        };
    }

    if (guest === base) {
        return { is: 'untouched', why: 'the machine has exactly what it was given.' };
    }

    //THE FORK TEST IS AGAINST base, NOT AGAINST A CLOCK. "Has the host moved
    //since this machine was served" is exactly `host !== base`, and it needs no
    //timestamps from either side to answer.
    if (host !== base) {
        return {
            is: 'forked',
            why: 'the machine changed the notes, and this host has changed them too since that machine '
                + 'was given its copy. Applying one would drop the other, so both are kept for a person.'
        };
    }

    return { is: 'changed', why: 'the machine changed the notes, on top of what this host still has.' };
}

//WHETHER THE CALLER SHOULD KEEP THIS AT ALL. One place, so "changed" and
//"forked" cannot drift into being handled differently by accident: both are
//real edits and both are worth recording; only one of them could ever be
//applied without somebody reading it.
function worthKeeping(is) { return is === 'changed' || is === 'forked'; }

module.exports = {
    hashOf: hashOf,
    changedOf: changedOf,
    worthKeeping: worthKeeping
};
