const { test } = require('node:test');
const assert = require('node:assert');

const { forkSyncFrom } = require('../../src/app/repositories/repos/fork-sync.js');

//---------------------------------------------------------------------------
//WHAT A "SYNC FORK" PRESS WOULD ACTUALLY PULL FROM.
//
//THE BUG THIS PINS WAS FOUND ON THE RUNNING APP AND IS WORTH KEEPING WHOLE,
//because it is the kind that reads as correct in every check that does not put
//the two sentences side by side.
//
//`python-onlykey` here is `bm-ok/0c-coder-python-onlykey`, forked from
//`0c-coder/python-onlykey`, which is forked from `trustcrypto/python-onlykey`.
//Pointed at the project, the Repos pane drew:
//
//    button: "Sync fork from trustcrypto"
//    action: "GitHub can only sync a fork from its own immediate parent,
//             which is 0c-coder/python-onlykey"
//
//One repository, one moment, two answers. The card took both the label and the
//enablement from `behindTarget.on` -- where work GOES -- while the press it
//fires can only ever merge from the PARENT.
//
//AND ITS TWIN, so neither comes back: ../../src/app/repositories/repos/sync.js
//made the same mistake and got the opposite symptom. It gated on the same wrong
//field, and because `behindTarget` is not computed at all when a repository
//sends work to itself, its button was disabled on every card in the workspace,
//permanently. One question asked in the wrong place twice; one button died and
//one lied.
//---------------------------------------------------------------------------

const SELF = 'bm-ok/0c-coder-python-onlykey';
const PARENT = '0c-coder/python-onlykey';
const PROJECT = 'trustcrypto/python-onlykey';

test('a fork of a fork pointed at the project cannot be synced, and says which repository it could be', () => {
    const said = forkSyncFrom({ repo: 'python-onlykey', parent: PARENT }, { on: PROJECT, behind: 4 });

    assert.equal(said.canSync, false, 'the press was offered for a gap it cannot close');

    //THE LABEL IS BUILT FROM `from`, so this is the field that decides whether
    //the button names a repository GitHub will accept.
    assert.equal(said.from, PARENT, 'the label would name the wrong repository');
    assert.notEqual(said.from, PROJECT);

    //BOTH REPOSITORIES BY NAME. "It cannot be done" leaves somebody looking for
    //which of three repositories is meant; the whole failure was two names being
    //confused for each other.
    assert.match(said.why, /only sync a fork from its immediate parent/);
    assert.ok(said.why.includes(PARENT), 'the parent is not named');
    assert.ok(said.why.includes(PROJECT), 'the gap being measured is not named');
});

test('behind does not enter into it — a gap it cannot close is refused however large', () => {
    //`behind` IS A SEPARATE QUESTION AND WAS THE ONE BEING ASKED. The live
    //repository happened to be level, which disabled the button for an unrelated
    //reason and hid the fault; four commits behind is the case that would have
    //enabled it and pressed straight into the action's refusal.
    [0, 1, 400].forEach(function (n) {
        const said = forkSyncFrom({ parent: PARENT }, { on: PROJECT, behind: n });
        assert.equal(said.canSync, false, 'behind ' + n + ' changed whether the press was possible');
    });
});

test('the ordinary case is untouched: work goes to the immediate parent', () => {
    const said = forkSyncFrom({ parent: PARENT }, { on: PARENT, behind: 2 });

    assert.equal(said.canSync, true);
    assert.equal(said.from, PARENT);

    //NO SENTENCE AT ALL, so the card falls through to what it always said. This
    //is the assertion that the fix did not change the case that was working:
    //`arduino-1.6.5-r5-teensy_127` sends work to its own parent and drew "Sync
    //fork from bmatusiak" before any of this, and must still.
    assert.equal(said.why, null, 'the ordinary case grew a refusal');
});

test('a fork that sends work to itself is the ordinary case too', () => {
    //THIS IS EVERY REPOSITORY IN THE WORKSPACE THIS WAS FOUND IN. The card does
    //not draw at all there -- `behindTarget` is null, so nothing asks -- but the
    //answer must not depend on that, because "the caller does not call me" is
    //not a guarantee anybody maintains.
    const said = forkSyncFrom({ parent: PARENT }, { on: SELF, behind: 3 });
    assert.equal(said.canSync, false, 'a fork cannot merge-upstream from itself');
    assert.equal(said.from, PARENT);
});

test('a repository that is not a fork is an ordinary state, not a failure', () => {
    const said = forkSyncFrom({ repo: 'onlykey-testing', parent: null }, { on: PROJECT, behind: 1 });

    assert.equal(said.canSync, false);
    assert.equal(said.from, null, 'a repository with no parent must not name one');
    assert.match(said.why, /not a fork of anything/);

    //AND IT MUST NOT THROW ON A MISSING GAP EITHER. The card guards this today
    //by returning null, which is a caller's habit rather than a promise.
    assert.doesNotThrow(function () { forkSyncFrom({}, null); });
    assert.equal(forkSyncFrom({}, null).canSync, false);
});
