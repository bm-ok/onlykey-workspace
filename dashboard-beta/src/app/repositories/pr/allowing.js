//---------------------------------------------------------------------------
//WHETHER SOMEBODY ELSE'S PULL REQUEST MAY BE READ BY A MACHINE.
//
//THE RULE THIS EXISTS FOR: nothing arriving from outside is judged until a person
//has looked at it and said so. A judge is a machine that fetches a change and
//runs a worker over it, so a pull request from a stranger is somebody else's code
//about to run on this host. That is a decision a person makes, once, about a
//specific thing they have read.
//
//SO AN ALLOWANCE NAMES THE COMMIT, NOT THE PULL REQUEST. Its author can push
//again a second after it is allowed, and an allowance against the number would
//carry silently onto whatever they pushed next — which is the whole attack, done
//with the permission of the person guarding against it.
//
//---- three answers, because they need three different things done about them --
//
//`stale` is the one worth having a word for. It is not "no": a person has looked
//and formed a view. And it is emphatically not "yes": the thing they looked at is
//gone. Collapsing it into either is how this goes wrong — into "no" and the
//person is asked to look again from nothing, into "yes" and the allowance has
//moved to code nobody read.
//
//---- why it is a module of its own -------------------------------------------
//
//IT WAS A CLOSURE INSIDE ../pr/server.js, reading the record and deciding about
//it in one function, which meant the deciding could only be exercised by a real
//pull request on GitHub with a real person allowing it. The same separation
//./revising.js has, for the same reason this codebase gives everywhere else: the
//deciding is the part that goes wrong, so it takes what it needs as arguments.
//
//THE RECORD IS HANDED IN rather than read here. Where allowances are kept is the
//server's business; what one MEANS is this.
//---------------------------------------------------------------------------

'use strict';

//WHAT AN ALLOWANCE IS FILED UNDER. `on` is owner/repository as GitHub spells it,
//so a fork and its parent cannot share one.
function keyFor(on, number) {
    return String(on || '').trim() + '#' + Number(number);
}

//`said` is what was recorded when somebody allowed it, or null. `sha` is the
//commit the pull request is at NOW, as GitHub last reported it.
function check(said, sha) {
    var now = String(sha || '').trim();

    if (!said) {
        return { allowed: false, stale: false, said: null, why: 'nobody has allowed this pull request to be judged' };
    }

    //NOT KNOWING WHERE IT IS NOW IS NOT AN ALLOWANCE. An allowance is a
    //statement about one commit, so with nothing to match it against there is
    //nothing it can permit — and this is a different sentence from "no", because
    //what is missing is this host's knowledge rather than the person's decision.
    if (!now) {
        return {
            allowed: false, stale: false, said: said,
            why: 'this host does not know which commit the pull request is at, so an allowance cannot be matched to it'
        };
    }

    if (said.sha !== now) {
        return {
            allowed: false, stale: true, said: said,
            why: 'it was allowed at ' + String(said.sha).slice(0, 7) + ' and is now at ' + now.slice(0, 7)
                + ' — the author has pushed since, so what was read is not what is there'
        };
    }

    return { allowed: true, stale: false, said: said, why: null };
}

module.exports = { keyFor: keyFor, check: check };
