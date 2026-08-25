const { test } = require('node:test');
const assert = require('node:assert');

const { keyFor, check } = require('../../src/app/repositories/pr/allowing');

//---------------------------------------------------------------------------
//WHETHER SOMEBODY ELSE'S PULL REQUEST MAY BE READ BY A MACHINE.
//
//THE CLAIM WORTH THE MOST, and it is the reason the rule is written this way: an
//allowance names the COMMIT, not the pull request. A judge fetches a change and
//runs a worker over it, so a pull request from a stranger is somebody else's code
//about to run on this host — and its author can push again a second after it is
//allowed. An allowance recorded against the NUMBER would carry silently onto
//whatever they pushed next, which is the whole attack, carried out with the
//permission of the person guarding against it.
//
//AND THREE ANSWERS RATHER THAN TWO. `stale` is not "no" — a person has looked and
//formed a view — and it is emphatically not "yes", because the thing they looked
//at is gone. Collapsing it either way is the fault: into "no" and somebody is
//asked to start again from nothing, into "yes" and the allowance has moved to
//code nobody read.
//
//IT HAD NO TEST AT ALL. The deciding was a closure inside ../pr/server.js that
//read the record and judged it in one function, so exercising it meant a real
//pull request on GitHub and a real person allowing it. The drill that asked these
//questions could not load — it required `repos/allowed`, which this app does not
//have — so this rule was carried by nothing.
//---------------------------------------------------------------------------

const SHA = 'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111';
const MOVED = 'bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222';

const allowedAt = (sha) => ({ on: 'someone/their-fork', number: 7, sha: sha, by: 'a person', at: '2026-08-25T00:00:00.000Z' });

//---- nothing is allowed until somebody says so -------------------------------

test('a pull request nobody has allowed is not judgeable', () => {
    const said = check(null, SHA);

    assert.equal(said.allowed, false);
    assert.equal(said.stale, false, 'never having been allowed reads as stale, which claims somebody looked');
    assert.equal(said.said, null);
    assert.match(said.why, /nobody has allowed/);
});

test('and that is true whatever commit it is at', () => {
    assert.equal(check(null, '').allowed, false);
    assert.equal(check(undefined, SHA).allowed, false);
});

//---- an allowance is about one commit ----------------------------------------

test('an allowance at the commit it is still at permits it', () => {
    const said = check(allowedAt(SHA), SHA);

    assert.equal(said.allowed, true);
    assert.equal(said.stale, false);
    assert.equal(said.why, null, 'a yes carries a reason, which reads as a refusal to anything checking `why`');
    assert.equal(said.said.by, 'a person', 'it does not carry who allowed it, which is the record of the decision');
});

test('and the same allowance does not carry onto what the author pushed next', () => {
    //THE ONE THAT MATTERS. This is the attack: allow it, then push.
    const said = check(allowedAt(SHA), MOVED);

    assert.equal(said.allowed, false,
        'an allowance given for one commit permitted a different one — the author can push after being allowed, and this is what stops that reaching a machine');
    assert.equal(said.stale, true);
    assert.match(said.why, /^it was allowed at aaaa111 and is now at bbbb222/);
    assert.match(said.why, /the author has pushed since/);
});

test('and a single character of difference is enough', () => {
    //NOT A PREFIX COMPARISON. Shortening a sha for display is a thing this app
    //does everywhere, and comparing the shortened form is an easy way to write
    //this that would accept a commit whose first seven characters collide.
    const near = SHA.slice(0, -1) + 'b';

    assert.equal(check(allowedAt(SHA), near).allowed, false);
    assert.equal(check(allowedAt(SHA), near).stale, true);
});

//---- and not knowing where it is now is its own answer ------------------------

test('not knowing which commit it is at is not an allowance, and not staleness either', () => {
    //A DIFFERENT SENTENCE FROM BOTH. What is missing here is this host's
    //knowledge, not the person's decision — so it must not read as "they have not
    //looked" and it must certainly not read as "yes".
    const said = check(allowedAt(SHA), null);

    assert.equal(said.allowed, false);
    assert.equal(said.stale, false, 'a host that cannot see the commit reported the allowance as stale, which blames the author for pushing');
    assert.match(said.why, /does not know which commit/);
    assert.equal(said.said.sha, SHA, 'it dropped the allowance it holds, so nothing can say what was allowed');
});

test('and an empty string is the same as not knowing, not a commit that differs', () => {
    assert.equal(check(allowedAt(SHA), '   ').stale, false);
    assert.equal(check(allowedAt(SHA), '').allowed, false);
});

//---- what one is filed under --------------------------------------------------

test('an allowance is filed under the repository AND the number', () => {
    //A FORK AND ITS PARENT BOTH HAVE A #7.
    assert.equal(keyFor('someone/their-fork', 7), 'someone/their-fork#7');
    assert.notEqual(keyFor('someone/their-fork', 7), keyFor('me/mine', 7));
    assert.notEqual(keyFor('someone/their-fork', 7), keyFor('someone/their-fork', 8));
});

test('and the number is a number, however it arrives', () => {
    //THE COMMAND LINE HANDS EVERYTHING OVER AS A STRING, so "7" and 7 have to be
    //one allowance — otherwise allowing it at the window and asking about it from
    //the command line are about two different things.
    assert.equal(keyFor('a/b', '7'), keyFor('a/b', 7));
    assert.equal(keyFor('  a/b  ', 7), keyFor('a/b', 7), 'a padded name files a second allowance nothing will find');
});
