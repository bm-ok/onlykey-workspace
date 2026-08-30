//---------------------------------------------------------------------------
//WHAT A SIGN-IN IS, ASKED WITHOUT KEEPING ONE.
//
//Every function here TAKES credential text and hands back a fact about it — a
//boolean, sixteen hex characters, a plan name, an email. None of them hands back
//the credential, none of them logs it, and none of them puts it in an error
//message. That is not tidiness: this app's rule is that a model may know
//something was done in the Keys tab without knowing WHAT was done, and this is
//the file where that rule is either kept or lost.
//
//SEPARATED FROM THE STORE SO IT CAN BE ASKED WITHOUT A HOST. Every claim below
//is about a string, so the tests are about strings — and the alternative is
//adding real sign-ins to a host to see how they are treated, which is a
//throwaway credential the QUEUE can pick up fifteen seconds later and hand to a
//machine. See ./lending, which is separated for the same reason.
//---------------------------------------------------------------------------

var crypto = require('crypto');

//---- a name --------------------------------------------------------------
//
//A NAME HAS TO BE A FILENAME, and it is shown in a list somebody reads. Refused
//rather than mangled, because a name that arrives back different from what was
//typed is a name somebody cannot find.
var NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

function okName(name) { return NAME.test(String(name == null ? '' : name)); }

//---- what a token IS, as a number ----------------------------------------
//
//SIXTEEN HEX CHARACTERS OF SHA256. Enough to say "this is the same token as
//before" and useless for anything else — which is exactly the trade wanted:
//comparing two credentials without either of them being readable.
function fingerprint(text) {
    return crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 16);
}

//---- whether a credential is a credential at all --------------------------
//
//A Claude sign-in is `{ claudeAiOauth: { accessToken, refreshToken, ... } }` and
//the two tokens are the whole point of it. Everything else in the file — scopes,
//subscriptionType, rateLimitTier, the expiry dates — is DESCRIPTION, and a file
//carrying only those authenticates nothing.
//
//THIS EXISTS BECAUSE ONE OF THOSE OVERWROTE A WORKING SIGN-IN. A judgement ran
//on a machine, failed to authenticate, and the CLI on that machine appears to
//have CLEARED its own credential file — leaving the shape intact and both tokens
//empty. The read-back saw a different fingerprint, concluded the machine had
//refreshed it, and wrote 280 bytes of empty over the 508 that worked. Every
//attempt afterwards reported `authMethod: "none"`, which is exactly honest: the
//file had no auth in it. A transient failure on a guest had been turned into a
//permanent one on the host, and the token was not recoverable.
//
//SHAPE ONLY, NEVER CONTENT. This asks whether the two fields are non-empty
//strings and nothing else — it does not validate a token, judge its age, or look
//at what it says. Anything cleverer would be this host deciding a credential is
//bad, and only a machine's attempt is proof of that.
function usable(text) {
    try {
        var o = JSON.parse(String(text));
        var c = o.claudeAiOauth || o;
        return !!(String(c.accessToken || '').trim() || String(c.refreshToken || '').trim());
    } catch (e) {
        //UNPARSEABLE IS UNUSABLE. A truncated read looks exactly like this, and
        //"keep what we have" is the right answer to both.
        return false;
    }
}

//---- what the account is billed as ----------------------------------------
//
//UNLIKE THE EMAIL, THIS *IS* IN THE CREDENTIAL: `claudeAiOauth.subscriptionType`,
//beside the tokens. So it needs nothing from a machine and is knowable for every
//sign-in this host has ever held.
//
//RECORDED AT WRITE TIME RATHER THAN READ ON DEMAND, exactly as the fingerprint
//is. The alternative is decrypting a sealed token every time somebody looks at
//the list — and the list is drawn by a paint function, so "every time somebody
//looks" means every few seconds for as long as the window is open.
function planOf(text) {
    try {
        var o = JSON.parse(String(text));
        var c = o.claudeAiOauth || o;
        return String(c.subscriptionType || '').trim() || null;
    } catch (e) {
        return null;
    }
}

//---- and who a sign-in belongs to ------------------------------------------
//
//NOT IN THE CREDENTIAL, AND NOT DERIVABLE FROM IT. `.credentials.json` holds
//seven fields — two tokens, two dates, scopes, plan, rate limit tier — and none
//of them names an account. The access token is an opaque string rather than a
//JWT, so there is no payload to read either. Looking for the email in the
//credential is looking in the one place it certainly is not.
//
//WHERE IT ACTUALLY IS: Claude Code writes `~/.claude.json` beside the
//credential, and after a sign-in that file holds the account. This app has been
//reading that file for a while, to DELETE it, on the grounds that account
//details sitting on a machine's disk are a thing this host is not otherwise
//recording. That reasoning still holds. What was wrong was throwing away the
//answer on the way past.
//
//NON-SECRET, AND KEPT SEPARATELY FOR THAT REASON. An email address identifies
//rather than authenticates: it goes in the list that everything reads, and it is
//the one fact that answers "are these two sign-ins the same account" — which
//decides whether two of them can be used at once, because two sign-ins of one
//account rotate each other's refresh token.
function accountOf(raw) {
    try {
        var o = JSON.parse(String(raw));
        var a = o.oauthAccount || o.account || null;
        if (!a) return null;

        var email = String(a.emailAddress || a.email || '').trim() || null;
        var uuid = String(a.accountUuid || a.uuid || '').trim() || null;
        if (!email && !uuid) return null;

        return { email: email, uuid: uuid, organization: String(a.organizationName || '').trim() || null };
    } catch (e) {
        return null;
    }
}

//---- three roles, and the word that used to mean one of them ---------------
//
//`guest` WAS THE OLD NAME FOR A WORKER. It is still what old records say, and it
//is read as `worker` rather than migrated — an old record needs no rewriting to
//be read.
//
//The word was retired because the machine-facing half of this app already uses
//"guest" for the virtual MACHINE, so one word meant a credential in one file and
//a computer in the next.
//
//ANYTHING UNRECOGNISED IS A WORKER, which is the least-privileged of the three:
//a worker sign-in may only go to a runner. Defaulting the other way would let a
//record with a typo in it reach a supervisor machine.
//`diy` IS THE HUMAN'S. Same disk as a worker and the same job API, and a
//separate identity because the person's afternoon should not be billed to the
//pool the queue draws from -- and because the queue's workers and the person
//have to be able to be signed in at the same time.
var ROLES = ['worker', 'judge', 'supervisor', 'diy'];

function roleFrom(said) {
    return said === 'supervisor' ? 'supervisor'
        : said === 'judge' ? 'judge'
            : said === 'diy' ? 'diy'
                : 'worker';
}

function isRole(said) { return ROLES.indexOf(String(said || '').toLowerCase()) >= 0; }

//---- and whether it is known bad -------------------------------------------
//
//"IT IS THERE" AND "IT WORKS" ARE DIFFERENT QUESTIONS. A credential's own dates
//say when its refresh token expires, and that is not the same as it working: a
//refresh ROTATES the token, so a copy taken before another machine refreshed is
//already superseded while still looking fine. The only proof is a worker being
//handed it and reporting whether it can authenticate.
function paused(g) { return !!(g && g.lastCheck && g.lastCheck.ready === false); }

//---- two kinds of evidence, and they are not worth the same ----------------
//
//  probe   the credential was placed and the worker was asked whether it is
//          signed in. It reads a file and answers. It says the BYTES ARRIVED.
//  run     the worker was given work and called the API. It says the ACCOUNT
//          WORKS, which is the only question anybody is actually asking.
//
//A PROBE SAID YES ABOUT A CREDENTIAL THAT WAS DEAD, three times, and each yes
//erased a no that a real run had established. A sign-in failed a judgement with
//"OAuth session expired and could not be refreshed", was correctly paused, and
//was then un-paused ten minutes later by the placement probe of the very next
//job — which reported ready, because the file was on the disk. The queue then
//spent another machine on it.
//
//SO A PROBE MAY CONDEMN A CREDENTIAL AND MAY NOT ABSOLVE ONE. Anything can
//record a failure; only the stronger kind of evidence can clear a failure the
//stronger kind established.
//
//This is the same rule the rest of this app already follows about machines — ask
//the thing itself, and prefer what actually happened to what was inferred. It
//was simply never applied to the credential's own record.
var STRENGTH = { probe: 1, run: 2 };

//OLDER RECORDS ARE READ AS `run`, because everything written before this
//distinction existed came from the run path. Guessing `probe` there would let
//the next probe overturn every failure this host had ever recorded.
function mayOverturn(had, ready, how) {
    if (!had || had.ready !== false || ready !== true) return true;
    return (STRENGTH[how] || 1) >= (STRENGTH[(had && had.how) || 'run'] || 2);
}

module.exports = {
    okName: okName,
    fingerprint: fingerprint,
    usable: usable,
    planOf: planOf,
    accountOf: accountOf,
    roleFrom: roleFrom,
    isRole: isRole,
    paused: paused,
    mayOverturn: mayOverturn,
    ROLES: ROLES,
    STRENGTH: STRENGTH
};
