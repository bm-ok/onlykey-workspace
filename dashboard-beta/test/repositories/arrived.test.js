const { test } = require('node:test');
const assert = require('node:assert');

const { diffArrived } = require('../../src/app/repositories/repos/arrived');

//---------------------------------------------------------------------------
//WHAT ARRIVED, worked out from two of GitHub's own lists rather than kept as a
//fact of this app's own. The sweep overwrote every answer and compared nothing,
//so "what is new" had no answer and `whatsNew.arrived` said so.
//---------------------------------------------------------------------------

const ISSUE = (n, over) => Object.assign({ on: 'them/repo', number: n, title: 'issue ' + n, by: 'someone', url: 'u' + n, asked: null }, over || {});
const PULL = (n) => ({ on: 'them/repo', number: n, title: 'pr ' + n, by: 'someone', url: 'p' + n });

test('an issue not in the previous sweep is new', () => {
    const out = diffArrived({ issues: [ISSUE(1)], pulls: [] }, { issues: [ISSUE(1), ISSUE(2)], pulls: [] });
    assert.deepEqual(out.issues.map((i) => [i.number, i.kind]), [[2, 'new']]);
});

test('an issue that has been tagged since is the one worth waking for', () => {
    //NULL BEFORE, SET NOW. This is the thing a person did on purpose.
    const asked = { where: 'a reply', by: 'bmatusiak' };
    const out = diffArrived({ issues: [ISSUE(1)], pulls: [] }, { issues: [ISSUE(1, { asked })], pulls: [] });
    assert.deepEqual(out.issues.map((i) => [i.number, i.kind]), [[1, 'asked']]);
    assert.deepEqual(out.issues[0].asked, asked);
});

test('a tag that was already there is not news, and one withdrawn is not an arrival', () => {
    const asked = { where: 'a reply', by: 'bmatusiak' };
    const same = diffArrived({ issues: [ISSUE(1, { asked })], pulls: [] }, { issues: [ISSUE(1, { asked })], pulls: [] });
    assert.deepEqual(same.issues, []);
    const gone = diffArrived({ issues: [ISSUE(1, { asked })], pulls: [] }, { issues: [ISSUE(1)], pulls: [] });
    assert.deepEqual(gone.issues, []);
});

test('a newer marked reply on an issue already tagged is a new ask', () => {
    //THE ISSUE WAS TAGGED IN ITS BODY, so it was `asked` from the first sweep;
    //the maintainer then answered with another marked comment. That is a
    //person continuing a conversation with the supervisor, and it went
    //unheard once because only "null before" counted.
    const first = { where: 'the issue', by: 'bmatusiak', at: '2026-08-28T07:00:00Z' };
    const later = { where: 'a reply', by: 'bmatusiak', at: '2026-08-28T20:13:18Z' };
    const out = diffArrived({ issues: [ISSUE(17, { asked: first })], pulls: [] },
        { issues: [ISSUE(17, { asked: later })], pulls: [] });
    assert.deepEqual(out.issues.map((i) => [i.number, i.kind]), [[17, 'asked']]);
    assert.deepEqual(out.issues[0].asked, later);

    //THE SAME STAMP TWICE IS THE SAME ASK, however many sweeps see it.
    const same = diffArrived({ issues: [ISSUE(17, { asked: later })], pulls: [] },
        { issues: [ISSUE(17, { asked: later })], pulls: [] });
    assert.deepEqual(same.issues, []);
});

test('a marked comment under a pull request is an ask, and a second one is a second ask', () => {
    //THE REVIEWS WERE READ AND THE COMMENTS WERE NOT, so "okc: change the
    //hex" under a pull request this host had just opened reached nobody.
    const PULL = (n, over) => Object.assign({ on: 'o/r', number: n, title: 'change ' + n }, over || {});
    const first = { where: 'a reply', by: 'bmatusiak', at: '2026-08-28T20:30:00Z' };
    const out = diffArrived({ issues: [], pulls: [PULL(2)] }, { issues: [], pulls: [PULL(2, { asked: first })] });
    assert.deepEqual(out.pulls.map((p) => [p.number, p.kind]), [[2, 'asked']]);
    assert.deepEqual(out.pulls[0].asked, first);

    const later = { where: 'a reply', by: 'bmatusiak', at: '2026-08-28T20:41:00Z' };
    const again = diffArrived({ issues: [], pulls: [PULL(2, { asked: first })] }, { issues: [], pulls: [PULL(2, { asked: later })] });
    assert.deepEqual(again.pulls.map((p) => [p.number, p.kind]), [[2, 'asked']]);

    const same = diffArrived({ issues: [], pulls: [PULL(2, { asked: later })] }, { issues: [], pulls: [PULL(2, { asked: later })] });
    assert.deepEqual(same.pulls, []);
});

test('a pull request that was open and is not listed now is gone, so somebody can ask whether it merged', () => {
    const PULL = (n) => ({ on: 'o/r', number: n, title: 'change ' + n, url: 'u' + n });
    const out = diffArrived({ issues: [], pulls: [PULL(2), PULL(3)] }, { issues: [], pulls: [PULL(3)] });
    assert.deepEqual(out.pulls.map((p) => [p.number, p.kind]), [[2, 'gone']]);
    assert.equal(out.pulls[0].url, 'u2', 'the gone entry lost what was known about it');
});

test('a pull request not seen before is new; a closed issue is nothing', () => {
    const out = diffArrived({ issues: [ISSUE(1), ISSUE(2)], pulls: [PULL(7)] }, { issues: [ISSUE(1)], pulls: [PULL(7), PULL(8)] });
    assert.deepEqual(out.issues, [], 'an issue that closed was reported as arriving');
    assert.deepEqual(out.pulls.map((p) => [p.number, p.kind]), [[8, 'new']]);
});

test('the first sweep reports nothing at all', () => {
    //WITH NO PREVIOUS LIST EVERY OPEN ISSUE IS "NEW", and reporting a hundred
    //arrivals the moment the watch is turned on is the opposite of arriving.
    const out = diffArrived(null, { issues: [ISSUE(1), ISSUE(2)], pulls: [PULL(7)] });
    assert.deepEqual(out, { issues: [], pulls: [] });
    assert.deepEqual(diffArrived(undefined, { issues: [ISSUE(1)] }), { issues: [], pulls: [] });
});

test('the same number on two repositories is two issues', () => {
    const out = diffArrived({ issues: [ISSUE(1)], pulls: [] },
        { issues: [ISSUE(1), ISSUE(1, { on: 'other/repo' })], pulls: [] });
    assert.deepEqual(out.issues.map((i) => i.on), ['other/repo']);
});
