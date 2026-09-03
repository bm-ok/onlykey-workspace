//---------------------------------------------------------------------------
//WHICH REQUEST THIS IS — THE ONE NAME A TAG HAS.
//
//A REQUEST ARRIVES AS A COMMENT AND NOTHING ELSE IDENTIFIES IT. The same person
//can tag the same issue twice, with the same marker and the same words, minutes
//apart, and every field except GitHub's own comment id will be equal. The two
//tags on `0c-coder-lib-agent#1` differed by twenty-two minutes on a
//second-resolution clock and in nothing else.
//
//SO "HAVE I ANSWERED THIS?" WAS NOT A QUESTION THIS APP COULD ASK, and the
//consequence was not academic: the answer to a tag was written as a draft and
//left for somebody to approve — somebody who, by definition, was not at the
//window, because they had just asked from GitHub. It sat there for forty-one
//minutes marked "waiting to be sent" while the person who asked watched a
//thread that never answered.
//
//A TRIGGER IS WHAT MAKES ANSWERING EXACTLY ONCE DECIDABLE, and that is what
//lets an answer go back the way it came without a person in between. See
//`issueSay` in ./server.js: it posts when it is answering a trigger that came
//from GitHub and has not been answered, and drafts otherwise.
//
//THESE ARE PURE AND THEY LIVE HERE FOR THAT REASON. The rule they encode is
//worth a test on its own — ../../../test/github/asking.test.js — and a rule
//that can only be exercised by posting to a real repository is a rule nobody
//checks twice.
//---------------------------------------------------------------------------

//SCOPED BY REPOSITORY AND NUMBER rather than the bare id. Comment ids are
//unique across GitHub, so the scope is belt and braces — but it makes the
//recorded value legible to somebody reading the drawer by eye, and a record
//whose meaning needs a lookup is one that gets misread.
//
//NULL WHEN THERE IS NO ID, AND THAT IS NOT AN ERROR. A comment read from a
//source that did not carry one cannot be answered exactly once, so it does not
//get to claim it was: the caller sees no trigger and drafts, which is the safe
//direction.
function triggerOfComment(on, number, id) {
    if (id == null || id === '') return null;
    if (!on || !(Number(number) > 0)) return null;
    return String(on) + '#' + Number(number) + ':comment:' + String(id);
}

//AND AN ISSUE BODY IS A TRIGGER TOO. Somebody who opens an issue already
//carrying the marker has asked from GitHub just as much as somebody who tagged
//a reply, and there is no comment id because there is no comment. Keyed on the
//issue itself, which is equally stable.
//
//NOT INTERCHANGEABLE WITH A COMMENT'S. An issue whose body is tagged and which
//later carries a tagged reply is TWO requests, and the second is not answered
//by having answered the first — so the two keys must never collide.
function triggerOfIssue(on, number) {
    if (!on || !(Number(number) > 0)) return null;
    return String(on) + '#' + Number(number) + ':issue';
}

module.exports = {
    triggerOfComment: triggerOfComment,
    triggerOfIssue: triggerOfIssue
};
