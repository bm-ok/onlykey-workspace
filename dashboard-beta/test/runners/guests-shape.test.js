const { test } = require('node:test');
const assert = require('node:assert');

const {
    okName, fingerprint, usable, planOf, accountOf, roleFrom, isRole, paused, mayOverturn, ROLES
} = require('../../src/app/runners/guests/shape');

//---------------------------------------------------------------------------
//WHAT A SIGN-IN IS, ASKED WITHOUT KEEPING ONE.
//
//THE CLAIM WORTH THE MOST: `usable`. A machine that CLEARED its own credential
//hands back the right shape with both tokens empty — and the version this comes
//from read a changed fingerprint as a rotation and wrote 280 bytes of empty over
//the 508 that worked. A transient failure on a guest became a permanent one on
//the host, and the token was not recoverable.
//
//AND THE SECOND: a probe may CONDEMN a credential and may not ABSOLVE one. A
//probe reported ready three times about a dead sign-in, because the file was on
//the disk — each yes erasing a no a real run had established, and the queue
//spending another machine on it every time.
//
//AND THE THIRD: nothing here hands back a credential. Every one of these takes
//token text and answers with a boolean, a hash, or a label.
//---------------------------------------------------------------------------

const CRED = (over) => JSON.stringify({
    claudeAiOauth: Object.assign({
        accessToken: 'sk-a-real-looking-token', refreshToken: 'sk-r-another',
        expiresAt: 1234567890, scopes: ['user:inference'], subscriptionType: 'max'
    }, over || {})
});

//---- a name ---------------------------------------------------------------

test('a name is a filename and a label, so it is refused rather than mangled', () => {
    //A NAME THAT ARRIVES BACK DIFFERENT from what was typed is a name somebody
    //cannot find.
    assert.equal(okName('runner1'), true);
    assert.equal(okName('a.judge_key-2'), true);

    assert.equal(okName('runner 1'), false, 'a space');
    assert.equal(okName('../escape'), false, 'it is a path');
    assert.equal(okName('a/b'), false);
    assert.equal(okName('.hidden'), false, 'it must start with a letter or digit');
    assert.equal(okName('-lead'), false);
    assert.equal(okName(''), false);
    assert.equal(okName(null), false);
    assert.equal(okName('a'.repeat(65)), false);
    assert.equal(okName('a'.repeat(64)), true);
});

//---- what a token is, as a number ------------------------------------------

test('the same token fingerprints the same, and a different one differently', () => {
    assert.equal(fingerprint('abc'), fingerprint('abc'));
    assert.notEqual(fingerprint('abc'), fingerprint('abd'));
});

test('and it is short enough to be useless for anything but comparing', () => {
    //SIXTEEN HEX CHARACTERS. Enough to say "this is the same token as before".
    const f = fingerprint(CRED());
    assert.equal(f.length, 16);
    assert.match(f, /^[0-9a-f]{16}$/);
    assert.equal(f.indexOf('sk-'), -1, 'the fingerprint carried part of the token');
});

//---- whether a credential is a credential at all ----------------------------

test('a credential with a token in it is usable', () => {
    assert.equal(usable(CRED()), true);
    assert.equal(usable(CRED({ refreshToken: '' })), true, 'an access token alone is still a credential');
    assert.equal(usable(CRED({ accessToken: '' })), true, 'a refresh token alone is still a credential');
});

test('the right shape with nothing in it is NOT a credential', () => {
    //THIS IS THE ONE THAT COST A TOKEN. A machine that cleared its own sign-in
    //hands back exactly this: shape intact, both tokens empty.
    assert.equal(usable(CRED({ accessToken: '', refreshToken: '' })), false);
    assert.equal(usable(CRED({ accessToken: '   ', refreshToken: '\t' })), false,
        'whitespace was read as a token');
});

test('and everything else in the file is description, which authenticates nothing', () => {
    assert.equal(usable(JSON.stringify({
        claudeAiOauth: { expiresAt: 1, scopes: ['user:inference'], subscriptionType: 'max', rateLimitTier: 'x' }
    })), false);
});

test('a bare credential without the wrapper is read too', () => {
    assert.equal(usable(JSON.stringify({ accessToken: 'sk-a' })), true);
});

test('unparseable is unusable, because a truncated read looks exactly like it', () => {
    //"KEEP WHAT WE HAVE" IS THE RIGHT ANSWER TO BOTH.
    assert.equal(usable('{"claudeAiOauth":{"accessTok'), false);
    assert.equal(usable(''), false);
    assert.equal(usable(null), false);
    assert.equal(usable('[object Object]'), false);
});

//---- what the account is billed as -------------------------------------------

test('the plan is read off the credential, which is where it actually is', () => {
    assert.equal(planOf(CRED()), 'max');
    assert.equal(planOf(CRED({ subscriptionType: '  pro  ' })), 'pro');
});

test('and no plan is null rather than an empty string', () => {
    //`null` READS AS "not recorded" ON THE CARD; '' would draw as a blank label.
    assert.strictEqual(planOf(CRED({ subscriptionType: '' })), null);
    assert.strictEqual(planOf('{not json'), null);
    assert.strictEqual(planOf(null), null);
});

//---- and who a sign-in belongs to --------------------------------------------

test('the account comes from the file beside the credential, not from it', () => {
    const said = accountOf(JSON.stringify({
        oauthAccount: { emailAddress: 'a@b.c', accountUuid: 'u-1', organizationName: 'Somewhere' }
    }));
    assert.deepEqual(said, { email: 'a@b.c', uuid: 'u-1', organization: 'Somewhere' });
});

test('and the several names that file has used for the same fields', () => {
    assert.deepEqual(accountOf(JSON.stringify({ account: { email: 'a@b.c', uuid: 'u-1' } })),
        { email: 'a@b.c', uuid: 'u-1', organization: null });
});

test('one of the two is enough, because either identifies the account', () => {
    //IT IS THE FACT THAT ANSWERS "are these two sign-ins the same account", which
    //decides whether two can be used at once — two sign-ins of one account
    //rotate each other's refresh token.
    assert.deepEqual(accountOf(JSON.stringify({ oauthAccount: { emailAddress: 'a@b.c' } })),
        { email: 'a@b.c', uuid: null, organization: null });
    assert.deepEqual(accountOf(JSON.stringify({ oauthAccount: { accountUuid: 'u-1' } })),
        { email: null, uuid: 'u-1', organization: null });
});

test('but neither is nothing learned, not an empty account', () => {
    assert.strictEqual(accountOf(JSON.stringify({ oauthAccount: { organizationName: 'Somewhere' } })), null);
    assert.strictEqual(accountOf(JSON.stringify({ oauthAccount: {} })), null);
    assert.strictEqual(accountOf('{}'), null);
    assert.strictEqual(accountOf('{not json'), null);
    assert.strictEqual(accountOf(null), null);
});

test('a credential is not an account file, and answers nothing about who it is', () => {
    //LOOKING FOR THE EMAIL IN THE CREDENTIAL is looking in the one place it
    //certainly is not.
    assert.strictEqual(accountOf(CRED()), null);
});

//---- the roles, and the word that used to mean one of them -------------------

test('the old word for a worker is read as one, rather than migrated', () => {
    //AN OLD RECORD NEEDS NO REWRITING TO BE READ. And "guest" was retired
    //because the machine-facing half of this app uses it for the MACHINE.
    assert.equal(roleFrom('guest'), 'worker');
    assert.equal(roleFrom(undefined), 'worker');
});

test('and the ones that exist are kept as themselves', () => {
    assert.equal(roleFrom('worker'), 'worker');
    assert.equal(roleFrom('judge'), 'judge');
    assert.equal(roleFrom('supervisor'), 'supervisor');
    assert.equal(roleFrom('diy'), 'diy');
});

//---- EVERY ROLE, WITHOUT THIS FILE HOLDING A SECOND LIST OF THEM -------------
//
//THE FAILURE THIS IS FOR HAS HAPPENED TWICE. `claudeSignedIn` kept its own copy
//of this mapping — `supervisor ? ... : judge ? ... : 'worker'` — so the Claude
//Judge pane signed somebody in and filed them as a worker. That was repaired by
//adding a branch, and when `diy` arrived the DIY pane did exactly the same
//thing: a credential filed as a worker, which then cannot be lent to the machine
//it was made for, because lending refuses a worker sign-in on a diy machine.
//
//A CREDENTIAL UNDER THE WRONG ROLE IS QUIET. Nothing fails at the moment it is
//kept; it fails later, at a refusal that is correct about a record that is wrong.
//
//SO THIS LOOPS OVER `ROLES` RATHER THAN NAMING THEM. A test with its own list
//goes stale beside the copy it was written to catch.
test('every role this app has survives being read back', () => {
    ROLES.forEach(function (role) {
        assert.equal(roleFrom(role), role, role + ' does not survive roleFrom');
        assert.ok(isRole(role), role + ' is not recognised as a role');
    });

    //INERTNESS: there are roles, and the loop above ran over them.
    assert.ok(ROLES.length >= 4, String(ROLES.length));
});

test('anything unrecognised is a worker, which is the least it could be', () => {
    //DEFAULTING THE OTHER WAY would let a record with a typo in it reach a
    //supervisor machine.
    assert.equal(roleFrom('supervisr'), 'worker');
    assert.equal(roleFrom('SUPERVISOR'), 'worker');
    assert.equal(roleFrom('admin'), 'worker');
});

test('but asking whether something IS a role is a different question', () => {
    //ONE IS FOR READING A RECORD; the other is for refusing what somebody typed.
    assert.equal(isRole('judge'), true);
    assert.equal(isRole('JUDGE'), true);
    assert.equal(isRole('guest'), false, 'the retired word was accepted as something to set');
    assert.equal(isRole('admin'), false);
    assert.equal(isRole(''), false);
});

//---- and whether it is known bad ----------------------------------------------

test('a sign-in a machine reported bad is paused', () => {
    assert.equal(paused({ lastCheck: { ready: false } }), true);
    assert.equal(paused({ lastCheck: { ready: true } }), false);
});

test('never checked is not the same as checked and dead', () => {
    //ONLY ONE OF THEM IS A REASON TO SIGN IN AGAIN.
    assert.equal(paused({}), false);
    assert.equal(paused({ lastCheck: null }), false);
    assert.equal(paused(null), false);
});

//---- two kinds of evidence ------------------------------------------------------

test('a probe may not clear a failure a run established', () => {
    //A PROBE REPORTED READY THREE TIMES ABOUT A DEAD SIGN-IN, because the file
    //was on the disk — and the queue spent another machine each time.
    assert.equal(mayOverturn({ ready: false, how: 'run' }, true, 'probe'), false);
});

test('but a run may clear one a probe established', () => {
    assert.equal(mayOverturn({ ready: false, how: 'probe' }, true, 'run'), true);
});

test('and evidence of the same strength may', () => {
    assert.equal(mayOverturn({ ready: false, how: 'probe' }, true, 'probe'), true);
    assert.equal(mayOverturn({ ready: false, how: 'run' }, true, 'run'), true);
});

test('an older record with no kind on it counts as a run', () => {
    //EVERYTHING WRITTEN BEFORE THIS DISTINCTION EXISTED came from the run path.
    //Guessing `probe` would let the next probe overturn every failure this host
    //had ever recorded.
    assert.equal(mayOverturn({ ready: false }, true, 'probe'), false);
});

test('anything may record a FAILURE, whatever established the last one', () => {
    //ONLY ABSOLVING IS RANKED. A probe that finds a credential missing is worth
    //recording however strong the last good news was.
    assert.equal(mayOverturn({ ready: true, how: 'run' }, false, 'probe'), true);
    assert.equal(mayOverturn({ ready: false, how: 'run' }, false, 'probe'), true);
});

test('and a sign-in nothing has said anything about takes whatever comes', () => {
    assert.equal(mayOverturn(null, true, 'probe'), true);
    assert.equal(mayOverturn(undefined, false, 'probe'), true);
});
