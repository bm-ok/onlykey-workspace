const { test } = require('node:test');
const assert = require('node:assert');

const asking = require('../../src/app/repositories/repos/asking');

//---------------------------------------------------------------------------
//A TAG IS ANSWERED ON GITHUB, AND ANSWERED ONCE.
//
//THE FAILURE THIS EXISTS FOR. A trusted person tagged an issue from GitHub and
//the supervisor wrote the reply as a DRAFT — which waits at the window for
//somebody to press "Send it". The person who asked was not at the window; they
//were on GitHub, where they had just asked. The reply sat unsent for forty-one
//minutes and the thread looked like it had been ignored.
//
//THE FIX RESTS ENTIRELY ON THESE TWO FUNCTIONS. `issueSay` sends without a
//person when it is answering a trigger that came from GitHub and has not been
//answered before; everything else about that decision is already proved by
//`mayAnswer`, which re-reads the thread and refuses unless somebody trusted
//tagged it. So what is left to get wrong is the identity of the request — and
//that is what is asserted here.
//
//WHY IT CANNOT BE TESTED THROUGH THE ACTION. Exercising `issueSay` posts a
//comment on a real repository under this host's token. A rule that can only be
//checked by publishing is a rule that gets checked once.
//---------------------------------------------------------------------------

test('two tags on one issue are two different requests', () => {
    //THE WHOLE MECHANISM IN ONE ASSERTION. bmatusiak tagged
    //`0c-coder-lib-agent#1` twice, twenty-two minutes apart, with the same
    //marker and the same intent. Every field of those two records was equal
    //except GitHub's comment id — so anything keyed on who, or on what was
    //said, or on a second-resolution clock, would have called the second tag a
    //repeat of the first and never answered it.
    const first = asking.triggerOfComment('bm-ok/0c-coder-lib-agent', 1, 3344556677);
    const second = asking.triggerOfComment('bm-ok/0c-coder-lib-agent', 1, 3344559999);

    assert.notEqual(first, second);
    assert.ok(first, 'a comment with an id has a trigger');
});

test('and the same tag read twice is the same request', () => {
    //THE OTHER HALF, AND THE ONE THAT PREVENTS A DUPLICATE REPLY. The sweep
    //re-reads a thread every few minutes and `mayAnswer` reads it again before
    //answering. Those are three readings of one comment, and if they did not
    //agree on its name, "already answered" could never be true.
    assert.equal(
        asking.triggerOfComment('bm-ok/0c-coder-lib-agent', 1, 3344556677),
        asking.triggerOfComment('bm-ok/0c-coder-lib-agent', 1, 3344556677));

    //INCLUDING ACROSS THE TYPE GITHUB HANDED BACK. JSON numbers this large are
    //fine in JavaScript, but a paged read, a cache, or a hand-written fixture
    //can turn one into a string — and a trigger that changes shape with its
    //source is a trigger that stops matching itself.
    assert.equal(
        asking.triggerOfComment('bm-ok/0c-coder-lib-agent', 1, 3344556677),
        asking.triggerOfComment('bm-ok/0c-coder-lib-agent', 1, '3344556677'));
});

test('an issue body and a comment on it are never the same request', () => {
    //SOMEBODY WHO OPENS A TAGGED ISSUE HAS ASKED, and so has somebody who
    //tags a reply on it later. Answering the first must not mark the second as
    //dealt with — that is a request silently dropped, which is the same failure
    //this whole change is about, arriving from the other side.
    const body = asking.triggerOfIssue('bm-ok/0c-coder-lib-agent', 1);
    const reply = asking.triggerOfComment('bm-ok/0c-coder-lib-agent', 1, 1);

    assert.notEqual(body, reply);
    assert.equal(body, asking.triggerOfIssue('bm-ok/0c-coder-lib-agent', 1));
});

test('the same number in two repositories is two requests', () => {
    //EVERY REPOSITORY HAS AN ISSUE #1. Keying on the number alone would let an
    //answer on one repository mark an unrelated request on another as spent,
    //and the one that vanishes is the one nobody is watching.
    assert.notEqual(
        asking.triggerOfIssue('bm-ok/0c-coder-lib-agent', 1),
        asking.triggerOfIssue('trustcrypto/python-onlykey', 1));

    assert.notEqual(
        asking.triggerOfComment('bm-ok/0c-coder-lib-agent', 1, 42),
        asking.triggerOfComment('trustcrypto/python-onlykey', 1, 42));
});

test('no id means no trigger, which means it is not sent unread', () => {
    //FAILING TOWARDS THE DRAFT. A comment with no id cannot be answered exactly
    //once, so it does not get to claim it was. `issueSay` reads a missing
    //trigger as "nothing on GitHub asked for this" and writes a draft — which
    //costs somebody a press, where the other direction costs a duplicate reply
    //on a stranger's issue that cannot be unsaid.
    assert.equal(asking.triggerOfComment('bm-ok/0c-coder-lib-agent', 1, null), null);
    assert.equal(asking.triggerOfComment('bm-ok/0c-coder-lib-agent', 1, undefined), null);
    assert.equal(asking.triggerOfComment('bm-ok/0c-coder-lib-agent', 1, ''), null);

    //AND NEITHER HALF INVENTS A KEY OUT OF A MISSING SUBJECT.
    assert.equal(asking.triggerOfComment('', 1, 42), null);
    assert.equal(asking.triggerOfIssue('bm-ok/0c-coder-lib-agent', 0), null);
    assert.equal(asking.triggerOfIssue(null, 1), null);
});

test('a trigger says what it is when somebody reads the drawer', () => {
    //THE RECORD IS READ BY PEOPLE. `github-spoken` is where somebody goes to
    //find out what went out in their name, and a row whose subject is an opaque
    //number is a row that gets skipped.
    assert.equal(
        asking.triggerOfComment('bm-ok/0c-coder-lib-agent', 1, 3344556677),
        'bm-ok/0c-coder-lib-agent#1:comment:3344556677');

    assert.equal(
        asking.triggerOfIssue('bm-ok/0c-coder-lib-agent', 1),
        'bm-ok/0c-coder-lib-agent#1:issue');
});
