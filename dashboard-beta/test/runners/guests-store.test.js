const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const makeStore = require('../../src/app/runners/guests/store');
const { fingerprint } = require('../../src/app/runners/guests/shape');

//---------------------------------------------------------------------------
//THE SIGN-INS THIS HOST HOLDS.
//
//THE CLAIM WORTH THE MOST: nothing that REPORTS ever hands back a token. `all()`
//is what the window, the command line and a drill get, and `token()` is the one
//door — for the handover that puts a credential on a machine, and nothing else.
//
//AND THE SECOND: a credential that came back EMPTY does not overwrite a working
//one. Different is not the same as newer, and a machine that cleared its own
//sign-in hands back a new fingerprint with nothing in it.
//
//AND THE THIRD: one sealed file per identity. A single JSON file holding every
//token means one going bad takes the others with it.
//
//THE SECRET IS A STAND-IN HERE, not DPAPI — this is about what the store DOES
//with a sealed file, not about the sealing. It records every read and write, so
//the tests can say when a token was opened and when it was not.
//---------------------------------------------------------------------------

const CRED = (over) => JSON.stringify({
    claudeAiOauth: Object.assign({
        accessToken: 'sk-a-one', refreshToken: 'sk-r-one', subscriptionType: 'max'
    }, over || {})
});

const EMPTY = JSON.stringify({ claudeAiOauth: { accessToken: '', refreshToken: '', subscriptionType: 'max' } });

let home, opened, sealedTo, chosenName, clock;

beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'guests-'));
    opened = [];
    sealedTo = [];
    chosenName = null;
    clock = 0;
});

afterEach(() => {
    try { fs.rmSync(home, { recursive: true, force: true }); } catch (e) { /* gone */ }
});

//A STAND-IN THAT MARKS WHAT IT WROTE, so a test can tell a sealed file from one
//somebody dropped in — and can say whether the store ever opened one.
const MARK = 'sealed:';

function store(over) {
    return makeStore(Object.assign({
        dir: () => path.join(home, 'guests'),
        secret: {
            write: (file, buf) => {
                sealedTo.push(file);
                fs.mkdirSync(path.dirname(file), { recursive: true });
                fs.writeFileSync(file, MARK + buf.toString('utf8'), 'utf8');
                return true;
            },
            read: (file) => {
                opened.push(file);
                const raw = fs.readFileSync(file, 'utf8');
                return Buffer.from(raw.indexOf(MARK) === 0 ? raw.slice(MARK.length) : raw, 'utf8');
            }
        },
        chosen: () => chosenName,
        now: () => '2026-08-2' + (clock++) + 'T00:00:00Z'
    }, over || {}));
}

//---- what is here, and what is never in it --------------------------------

test('nothing that reports hands back a token', () => {
    const s = store();
    s.add({ name: 'a', token: CRED() });

    const row = s.all()[0];
    const said = JSON.stringify(row);

    assert.equal(said.indexOf('sk-a-one'), -1, 'a token was in the list every caller reads');
    assert.equal(said.indexOf('sk-r-one'), -1);
    assert.equal(row.token, undefined);
    //WHAT IT DOES SAY is enough to answer every question the pane asks.
    assert.equal(row.name, 'a');
    assert.equal(row.role, 'worker');
    assert.equal(row.has, true);
    assert.equal(row.plan, 'max');
    assert.equal(row.fingerprint, fingerprint(CRED()));
});

test('and reading the list never opens a sealed file', () => {
    //THE LIST IS DRAWN BY A PAINT FUNCTION, so "every time somebody looks" means
    //every few seconds for as long as the window is open.
    const s = store();
    s.add({ name: 'a', token: CRED() });
    opened.length = 0;

    s.all(); s.all(); s.get('a');
    assert.deepEqual(opened, [], 'it opened a credential to draw a list');
});

test('the one door that hands back a value is token(), for the handover', () => {
    const s = store();
    s.add({ name: 'a', token: CRED() });

    assert.equal(s.token('a'), CRED());
    assert.equal(opened.length, 1);
});

test('and it refuses a name it does not hold rather than reading a path', () => {
    assert.throws(() => store().token('nope'), /There is no guest called "nope"/);
});

//---- one sealed file per identity -------------------------------------------

test('each token is its own sealed file, named after the guest', () => {
    //A SINGLE JSON FILE HOLDING EVERY TOKEN means one going bad takes the others
    //with it, and removing one is rewriting a list rather than deleting a file.
    const s = store();
    s.add({ name: 'a', token: CRED() });
    s.add({ name: 'b', token: CRED({ accessToken: 'sk-a-two' }) });

    assert.deepEqual(sealedTo.map((f) => path.basename(f)).sort(), ['a.json', 'b.json']);
    assert.equal(fs.existsSync(path.join(home, 'guests', 'a.json')), true);
});

test('the record itself carries no token', () => {
    const s = store();
    s.add({ name: 'a', token: CRED() });

    const raw = fs.readFileSync(path.join(home, 'guests', 'guests.json'), 'utf8');
    assert.equal(raw.indexOf('sk-a-one'), -1, 'the list on disk carried the credential');
    assert.match(raw, /"fingerprint"/);
});

test('a sign-in whose file was removed by hand says so instead of claiming a token', () => {
    //READ FROM THE FILE rather than trusted from the record.
    const s = store();
    s.add({ name: 'a', token: CRED() });
    fs.rmSync(path.join(home, 'guests', 'a.json'));

    assert.equal(s.get('a').has, false);
    assert.deepEqual(s.freeFor('worker'), []);
});

test('and a host that has never held one reads as empty, not as broken', () => {
    const s = store();
    assert.deepEqual(s.all(), []);
    assert.equal(s.get('a'), null);
});

//---- adding ------------------------------------------------------------------

test('a name that is not a name is refused rather than mangled', () => {
    assert.throws(() => store().add({ name: '../escape', token: CRED() }),
        /is not a name for a guest/);
    assert.equal(fs.existsSync(path.join(home, 'guests')), false, 'it wrote something first');
});

test('a credential that arrived as an object is kept as one, not as its shadow', () => {
    //String(token) TURNS AN OBJECT INTO "[object Object]" — and then seals it,
    //fingerprints it, and reports the guest as added. The way you find out is a
    //machine answering "not signed in" weeks later.
    const s = store();
    s.add({ name: 'a', token: JSON.parse(CRED()) });

    assert.equal(s.token('a'), CRED());
    assert.equal(s.get('a').plan, 'max');
});

test('and the shadow itself is refused by name, so nothing keeps it', () => {
    assert.throws(() => store().add({ name: 'a', token: '[object Object]' }),
        /arrived as the words "\[object Object\]"/);
});

test('nothing to keep is refused', () => {
    assert.throws(() => store().add({ name: 'a', token: '' }), /needs a Claude token/);
    assert.throws(() => store().add({ name: 'a' }), /needs a Claude token/);
});

test('a name already here is refused, because replacing one silently takes it away', () => {
    const s = store();
    s.add({ name: 'a', token: CRED() });

    assert.throws(() => s.add({ name: 'a', token: CRED({ accessToken: 'sk-a-two' }) }),
        /already a guest called "a"/);
    assert.equal(s.token('a'), CRED(), 'the credential in use was overwritten');
});

test('one namespace across all three roles, because they are files in one folder', () => {
    const s = store();
    s.add({ name: 'a', token: CRED(), role: 'supervisor' });
    assert.throws(() => s.add({ name: 'a', token: CRED(), role: 'worker' }), /already a guest called/);
});

test('an unrecognised role is added as a worker, which is the least it could be', () => {
    const s = store();
    s.add({ name: 'a', token: CRED(), role: 'admin' });
    assert.equal(s.get('a').role, 'worker');
});

//---- removing ------------------------------------------------------------------

test('forgetting one takes the file with it', () => {
    const s = store();
    s.add({ name: 'a', token: CRED() });
    s.forget('a');

    assert.equal(fs.existsSync(path.join(home, 'guests', 'a.json')), false);
    assert.deepEqual(s.all(), []);
});

test('but not one that is out on a machine', () => {
    //REMOVING IT HERE would leave a credential on a machine with nothing on this
    //host knowing it is there.
    const s = store();
    s.add({ name: 'a', token: CRED() });
    s.lentTo('a', 'kit-1', { kind: 'worker' });

    assert.throws(() => s.forget('a'), /is on kit-1 right now/);
    assert.equal(fs.existsSync(path.join(home, 'guests', 'a.json')), true);
});

test('and one that was never here is named, not silently fine', () => {
    assert.throws(() => store().forget('nope'), /There is no guest called "nope"/);
});

//---- lending it out ---------------------------------------------------------------

test('a sign-in goes out to a machine of its own kind, and is recorded as out', () => {
    const s = store();
    s.add({ name: 'a', token: CRED() });
    s.lentTo('a', 'kit-1', { kind: ['worker', 'judge'] });

    const row = s.get('a');
    assert.equal(row.holder, 'kit-1');
    assert.equal(row.lastGivenTo, 'kit-1');
    assert.ok(row.lastGiven);
});

test('and the rule is enforced HERE, at the one point that records a holder', () => {
    //RATHER THAN AT EACH OF THE SEVERAL PLACES THAT HAND ONE OVER.
    const s = store();
    s.add({ name: 'a', token: CRED(), role: 'supervisor' });

    assert.throws(() => s.lentTo('a', 'kit-1', { kind: 'worker' }), /No tag changes this/);
    assert.equal(s.get('a').holder, null, 'it recorded a holder it had just refused');
});

test('the boolean callers that predate three roles still work', () => {
    const s = store();
    s.add({ name: 'a', token: CRED(), role: 'supervisor' });
    s.lentTo('a', 'sup-1', { supervisor: true });
    assert.equal(s.get('a').holder, 'sup-1');
});

//---- and taking it back --------------------------------------------------------------

test('a token that came back changed is the one worth keeping', () => {
    //THE CLI REFRESHES AS A WORKER RUNS, so what comes off a machine is newer
    //than what went on — and the path before this deleted it.
    const s = store();
    s.add({ name: 'a', token: CRED() });
    s.lentTo('a', 'kit-1', { kind: 'worker' });

    const fresh = CRED({ accessToken: 'sk-a-rotated' });
    const out = s.backFrom('a', { token: fresh });

    assert.equal(out.rotated, true);
    assert.equal(out.refused, null);
    assert.equal(s.token('a'), fresh);
    assert.equal(s.get('a').fingerprint, fingerprint(fresh));
    assert.equal(s.get('a').holder, null);
});

test('and one that came back unchanged does not re-seal a file for nothing', () => {
    const s = store();
    s.add({ name: 'a', token: CRED() });
    s.lentTo('a', 'kit-1', { kind: 'worker' });
    sealedTo.length = 0;

    const out = s.backFrom('a', { token: CRED() });

    assert.equal(out.rotated, false);
    assert.deepEqual(sealedTo, []);
    assert.equal(s.get('a').refreshed, null, 'an unchanged handover moved the date the SECRET changed');
});

test('a credential handed back EMPTY does not overwrite a working one', () => {
    //DIFFERENT IS NOT THE SAME AS NEWER. A machine that cleared its own sign-in
    //hands back a new fingerprint with nothing in it — and storing that is not
    //keeping up with a rotation, it is destroying the only copy.
    const s = store();
    s.add({ name: 'a', token: CRED() });
    s.lentTo('a', 'kit-1', { kind: 'worker' });

    const out = s.backFrom('a', { token: EMPTY });

    assert.equal(out.rotated, false);
    assert.match(out.refused, /no access token and no refresh token in it/);
    assert.match(out.refused, /was KEPT and nothing was overwritten/);
    assert.equal(s.token('a'), CRED(), 'the working credential was overwritten with an empty one');
    assert.equal(s.get('a').holder, null, 'the machine was left holding it');
});

test('but when what is held is ALREADY unusable there is nothing to protect', () => {
    //THIS STOPS THE REFUSAL BECOMING A DOOR THAT CANNOT BE OPENED, for a host
    //recovering from exactly this.
    const s = store();
    s.add({ name: 'a', token: EMPTY });
    s.lentTo('a', 'kit-1', { kind: 'worker' });

    const other = JSON.stringify({ claudeAiOauth: { accessToken: '', refreshToken: '' } });
    const out = s.backFrom('a', { token: other });

    assert.equal(out.rotated, true);
    assert.equal(out.refused, null);
});

test('the plan travels with the token, so a stale label is not kept', () => {
    const s = store();
    s.add({ name: 'a', token: CRED({ subscriptionType: 'pro' }) });
    assert.equal(s.get('a').plan, 'pro');

    s.lentTo('a', 'kit-1', { kind: 'worker' });
    s.backFrom('a', { token: CRED({ accessToken: 'sk-a-2', subscriptionType: 'max' }) });

    assert.equal(s.get('a').plan, 'max');
});

test('handing one back with no token at all just ends the loan', () => {
    const s = store();
    s.add({ name: 'a', token: CRED() });
    s.lentTo('a', 'kit-1', { kind: 'worker' });

    const out = s.backFrom('a', {});
    assert.equal(out.holder, null);
    assert.equal(out.rotated, false);
});

//---- what a machine found out about it -----------------------------------------------

test('what a machine reported is kept whole, against the one that was tried', () => {
    const s = store();
    s.add({ name: 'a', token: CRED() });

    s.checked('a', { ready: false, on: 'kit-1', why: 'OAuth session expired', code: 1, how: 'run' });

    const check = s.get('a').lastCheck;
    assert.equal(check.ready, false);
    assert.equal(check.on, 'kit-1');
    assert.equal(check.why, 'OAuth session expired');
    assert.equal(check.code, 1);
    assert.equal(check.how, 'run');
    assert.ok(check.at);
});

test('an exit code of zero is kept, because "it ran and said no" is a real answer', () => {
    const s = store();
    s.add({ name: 'a', token: CRED() });
    s.checked('a', { ready: false, code: 0 });
    assert.strictEqual(s.get('a').lastCheck.code, 0);
});

test('and no code at all is null rather than missing', () => {
    const s = store();
    s.add({ name: 'a', token: CRED() });
    s.checked('a', { ready: false });
    assert.strictEqual(s.get('a').lastCheck.code, null);
});

test('a probe cannot clear a failure a run established', () => {
    //IT DID, THREE TIMES, because the file was on the disk — and the queue spent
    //another machine each time.
    const s = store();
    s.add({ name: 'a', token: CRED() });
    s.checked('a', { ready: false, why: 'OAuth session expired', how: 'run' });

    s.checked('a', { ready: true, how: 'probe' });

    assert.equal(s.get('a').lastCheck.ready, false, 'a placement probe un-paused a dead sign-in');
    assert.equal(s.get('a').lastCheck.why, 'OAuth session expired');
    assert.deepEqual(s.freeFor('worker'), []);
});

test('but a run can, and nothing is thrown either way', () => {
    //PLACING A CREDENTIAL IS ALLOWED TO SUCCEED. This is only about what the
    //record is permitted to conclude from it.
    const s = store();
    s.add({ name: 'a', token: CRED() });
    s.checked('a', { ready: false, how: 'run' });
    s.checked('a', { ready: true, how: 'run' });

    assert.equal(s.get('a').lastCheck.ready, true);
    assert.equal(s.freeFor('worker').length, 1);
});

test('saying nothing about readiness records nothing', () => {
    const s = store();
    s.add({ name: 'a', token: CRED() });
    s.checked('a', { on: 'kit-1' });
    assert.equal(s.get('a').lastCheck, null);
});

//---- what an identity is FOR ------------------------------------------------------------

test('changing a role is a label change, and the token does not move', () => {
    //NOTHING IS RE-SEALED AND NOTHING IS RE-READ, which is how you can tell it
    //was a relabelling and not a replacement.
    const s = store();
    s.add({ name: 'a', token: CRED() });
    const was = s.get('a').fingerprint;
    sealedTo.length = 0; opened.length = 0;

    s.roleOf('a', 'judge');

    assert.equal(s.get('a').role, 'judge');
    assert.equal(s.get('a').fingerprint, was);
    assert.deepEqual(sealedTo, []);
    assert.deepEqual(opened, []);
});

test('but not while it is out on a machine', () => {
    //IT WAS LENT UNDER THE RULE THAT THE ROLES MATCH; changing it underneath
    //would leave that machine holding the wrong one.
    const s = store();
    s.add({ name: 'a', token: CRED() });
    s.lentTo('a', 'kit-1', { kind: 'worker' });

    assert.throws(() => s.roleOf('a', 'judge'), /is out on kit-1/);
    assert.equal(s.get('a').role, 'worker');
});

test('and not the one the supervisor is set to use', () => {
    //MOVING THE IDENTITY OUT FROM UNDER IT would leave the supervisor pointing
    //at a sign-in it may no longer hold — discovered the next time it was woken.
    const s = store();
    s.add({ name: 'a', token: CRED(), role: 'supervisor' });
    chosenName = 'a';

    assert.throws(() => s.roleOf('a', 'worker'), /is the sign-in the supervisor is set to use/);
});

test('a role nothing recognises is refused, including the retired word', () => {
    const s = store();
    s.add({ name: 'a', token: CRED() });

    assert.throws(() => s.roleOf('a', 'guest'), /is not a role/);
    assert.throws(() => s.roleOf('a', 'admin'), /is not a role/);
    assert.equal(s.get('a').role, 'worker');
});

test('and setting it to what it already is changes nothing', () => {
    const s = store();
    s.add({ name: 'a', token: CRED() });
    s.lentTo('a', 'kit-1', { kind: 'worker' });

    //NOT REFUSED FOR BEING OUT, because nothing is changing.
    assert.equal(s.roleOf('a', 'worker').role, 'worker');
});

//---- learning whose a sign-in is ------------------------------------------------------

test('an account is learned once and never overwritten', () => {
    //A MACHINE IS NOT THE AUTHORITY on whose credential this is: it reports what
    //it saw, and the sign-in is the one that was watched by a person.
    const s = store();
    s.add({ name: 'a', token: CRED() });

    assert.equal(s.noteAccount('a', { email: 'one@b.c', uuid: 'u1' }).learned, true);
    assert.equal(s.get('a').account.email, 'one@b.c');

    const again = s.noteAccount('a', { email: 'two@b.c', uuid: 'u2' });
    assert.equal(again.learned, false);
    assert.equal(s.get('a').account.email, 'one@b.c', 'a machine overwrote what a person signed in as');
});

test('one recorded at sign-in is not learned over either', () => {
    const s = store();
    s.add({ name: 'a', token: CRED(), account: { email: 'signed@in.c' } });
    assert.equal(s.noteAccount('a', { email: 'seen@on.machine' }).learned, false);
});

test('and nothing to learn is said rather than written', () => {
    const s = store();
    s.add({ name: 'a', token: CRED() });

    assert.deepEqual(s.noteAccount('a', null), { learned: false, why: 'nothing to learn' });
    assert.deepEqual(s.noteAccount('a', { organization: 'x' }), { learned: false, why: 'nothing to learn' });
    assert.equal(s.noteAccount('nope', { email: 'a@b.c' }).learned, false);
});

//---- filling in what was not recorded at the time ----------------------------------------

test('a plan missing from an old record is read out of the sealed token, once', () => {
    const s = store();
    s.add({ name: 'a', token: CRED() });

    //AN OLD RECORD: written before anything read the plan.
    const file = path.join(home, 'guests', 'guests.json');
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete rows[0].plan;
    fs.writeFileSync(file, JSON.stringify(rows), 'utf8');

    assert.equal(s.ensurePlans(), 1);
    assert.equal(s.get('a').plan, 'max');

    //GUARDED, AND THEN FREE. Nothing is opened on a host where every record
    //already says what it is — and the caller is reached from a paint function.
    opened.length = 0;
    assert.equal(s.ensurePlans(), 0);
    assert.deepEqual(opened, []);
});

test('and one whose file is gone records null rather than being retried for ever', () => {
    //`null` IS A RECORDED ANSWER. Left `undefined` it stays in the missing list
    //and every call opens a sealed file for it again — and the caller is reached
    //from a paint function.
    //
    //TWO RECORDS, because the guard asks whether ANY plan is readable and the
    //loop then fills in every one that is blank. With only the fileless record
    //here the guard returns early and this claim is never reached — which is
    //what a first draft of this test did.
    const s = store();
    s.add({ name: 'a', token: CRED() });
    s.add({ name: 'gone', token: CRED({ accessToken: 'sk-a-2' }) });

    const file = path.join(home, 'guests', 'guests.json');
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    rows.forEach((r) => { delete r.plan; });
    fs.writeFileSync(file, JSON.stringify(rows), 'utf8');
    fs.rmSync(path.join(home, 'guests', 'gone.json'));

    assert.equal(s.ensurePlans(), 2);
    assert.equal(s.get('a').plan, 'max');

    //ASSERTED ON THE RECORD, NOT ON THE PROJECTION. `all()` maps `plan:
    //g.plan || null`, so a field that was never written and one recorded as null
    //are the same answer from outside — and "recorded as null" is the whole
    //claim. A first draft of this asserted through `get()` and could not see the
    //difference; a sweep found it by leaving the field blank and passing.
    assert.strictEqual(onDisk().gone.plan, null,
        'a sign-in whose file is gone was left blank, so every later call reads for it again');
});

test('and a host where nothing is missing opens and writes nothing at all', () => {
    //THE CALLER IS REACHED FROM A PAINT FUNCTION, so this runs every few seconds
    //for as long as the window is open. Opening nothing is not enough on its own
    //— the `continue` below already does that — and what the guard saves is the
    //read-and-write of the record.
    const s = store();
    s.add({ name: 'a', token: CRED() });

    const before = fs.statSync(path.join(home, 'guests', 'guests.json')).mtimeMs;
    opened.length = 0;

    assert.equal(s.ensurePlans(), 0);
    assert.deepEqual(opened, []);
    assert.equal(fs.statSync(path.join(home, 'guests', 'guests.json')).mtimeMs, before,
        'it rewrote the record with nothing to record');
});

//THE RECORD AS IT IS ON DISK, keyed by name. Some claims here are about what was
//WRITTEN rather than about what is reported, and the two are deliberately not
//the same shape.
function onDisk() {
    const rows = JSON.parse(fs.readFileSync(path.join(home, 'guests', 'guests.json'), 'utf8'));
    return rows.reduce((n, r) => { n[r.name] = r; return n; }, {});
}

//---- which supervisor sign-in is being used ------------------------------------------------

test('a host with none says so, and says where to make one', () => {
    const said = store().supervisorKey();
    assert.equal(said.key, null);
    assert.match(said.why, /no supervisor sign-in at all/);
});

test('one is not ambiguous, and is not called a decision', () => {
    //REPORTED AS chosen: null so nothing calls a default a choice — the pane
    //says "the only one" rather than "in use".
    const s = store();
    s.add({ name: 'sup', token: CRED(), role: 'supervisor' });

    const said = s.supervisorKey();
    assert.equal(said.key.name, 'sup');
    assert.equal(said.chosen, null);
    assert.equal(said.why, null);
});

test('two and no choice is a question for a person', () => {
    const s = store();
    s.add({ name: 'one', token: CRED(), role: 'supervisor' });
    s.add({ name: 'two', token: CRED({ accessToken: 'sk-a-2' }), role: 'supervisor' });

    const said = s.supervisorKey();
    assert.equal(said.key, null);
    assert.match(said.why, /there are 2 supervisor sign-ins and none is chosen/);
});

test('"what is there to hand over" and "what is in use" are different questions', () => {
    //READING ONE AS THE OTHER made the pane show no identity in use at the exact
    //moment one was.
    const s = store();
    s.add({ name: 'sup', token: CRED(), role: 'supervisor' });
    s.lentTo('sup', 'sup-1', { kind: 'supervisor' });

    const said = s.supervisorKey();
    assert.equal(said.key, null, 'it offered an identity that is already on a machine');
    assert.equal(said.inUse.name, 'sup');
    assert.equal(said.out, 'sup-1');
});

test('a chosen one that was thrown away is said, not silently replaced', () => {
    //THE SETTING NAMES AN IDENTITY SOMEBODY PICKED, and the honest answer is
    //that it is gone.
    const s = store();
    s.add({ name: 'other', token: CRED(), role: 'supervisor' });
    chosenName = 'gone';

    const said = s.supervisorKey();
    assert.equal(said.key, null);
    assert.equal(said.chosen, 'gone');
    assert.match(said.why, /"gone" is not kept here any more/);
});

test('and the chosen one is handed over when it is free', () => {
    const s = store();
    s.add({ name: 'one', token: CRED(), role: 'supervisor' });
    s.add({ name: 'two', token: CRED({ accessToken: 'sk-a-2' }), role: 'supervisor' });
    chosenName = 'two';

    const said = s.supervisorKey();
    assert.equal(said.key.name, 'two');
    assert.equal(said.chosen, 'two');
    assert.equal(said.why, null);
});

//---- and what the queue asks -----------------------------------------------------------------

test('the queue is answered from the same list everything else reads', () => {
    const s = store();
    s.add({ name: 'a', token: CRED() });
    s.add({ name: 'b', token: CRED({ accessToken: 'sk-a-2' }) });
    s.add({ name: 'j', token: CRED({ accessToken: 'sk-a-3' }), role: 'judge' });
    s.checked('b', { ready: false, how: 'run' });

    assert.deepEqual(s.forQueue(), {
        worker: { free: 1, paused: ['b'] },
        judge: { free: 1, paused: [] }
    });
    assert.deepEqual(s.pausedFor('worker').map((g) => g.name), ['b']);
});
