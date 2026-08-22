const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { sealFor, fingerprint, VERSION } = require('../../src/app/vms/sealed/sealing');

//---------------------------------------------------------------------------
//THE TWO HALVES, RUN AGAINST EACH OTHER.
//
//../../src/app/vms/sealed/sealing.js keeps the guest's half as well, so a round
//trip can be proved without a machine — and ./sealed-sealing.test.js does that.
//WHAT THAT CANNOT CATCH is the two halves DRIFTING APART, because it is one file
//agreeing with itself.
//
//THE OTHER HALF IS A REAL FILE that is sent to a guest and run there:
//../../src/app/vms/provision/scripts/okc-credential.js. It is node with no
//dependencies, so it can be run HERE, as a subprocess, against a temporary home
//— which is the whole protocol exercised end to end with nothing virtualised.
//
//THE FAILURE THIS IS FOR: "a machine built last month runs last month's half of
//a protocol this file changed today, and the failure is a decryption error on a
//machine at two in the morning". The payload is SENT rather than installed for
//exactly that reason; this is the check that the thing being sent still agrees.
//---------------------------------------------------------------------------

const GUEST = path.join(__dirname, '..', '..', 'src', 'app', 'vms', 'provision', 'scripts', 'okc-credential.js');

const SECRET = 'sk-ant-oat01-NOTHINGELSEISSHAPEDLIKETHIS-0123456789abcdef';
const CRED = JSON.stringify({
    claudeAiOauth: { accessToken: SECRET, refreshToken: SECRET + '-r', subscriptionType: 'max' }
});

let home;

beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-guest-')); });
afterEach(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch (e) { /* gone */ } });

//RUN AS THE GUEST WOULD, with HOME pointed somewhere disposable. `HOME` is what
//the payload reads, so this is the same code path a machine takes.
function asTheGuest(what, stdin) {
    return execFileSync(process.execPath, [GUEST, what], {
        env: Object.assign({}, process.env, { HOME: home, USERPROFILE: home }),
        input: stdin === undefined ? '' : stdin,
        encoding: 'utf8'
    });
}

//---- the whole protocol, end to end ------------------------------------------

test('the guest makes a key, the host seals to it, and the credential lands', async () => {
    const said = asTheGuest('begin');

    //MATCHED RATHER THAN SLICED: what comes back has framing around it on a real
    //machine, and a key is recognisable.
    const pub = (said.match(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/) || [])[0];
    assert.ok(pub, 'the guest half did not publish a key: ' + said);

    const sealed = sealFor(pub, CRED);
    const done = asTheGuest('finish', JSON.stringify(sealed));

    //THE FINGERPRINT IT ENDED UP WITH, which is how the two sides agree without
    //either printing the thing itself.
    const placed = done.match(/okc-credential-placed ([0-9a-f]{16})/);
    assert.ok(placed, 'the guest half did not say it took the credential: ' + done);
    assert.equal(placed[1], fingerprint(CRED), 'what landed is not what was sealed');

    //AND IT IS ACTUALLY ON DISK, where the CLI will look for it.
    const landed = fs.readFileSync(path.join(home, '.claude', '.credentials.json'), 'utf8');
    assert.equal(landed, CRED);
});

test('and the two halves agree on the version, without either being told', () => {
    //THE ONE SHAPE BOTH SIDES AGREE ON. A change to either has to be a change to
    //both, and this is what says so out loud.
    const guest = fs.readFileSync(GUEST, 'utf8');
    assert.ok(guest.includes("'" + VERSION + "'"),
        'the guest half does not carry ' + VERSION + ', so a handover would be refused on the machine');
});

//---- and what the guest half refuses ---------------------------------------------

test('a sealed reply with no key waiting for it is refused, not half-applied', () => {
    //`finish` WITHOUT `begin`. Nothing should be written on a path where there is
    //no private half to open anything with.
    const sealed = sealFor(require('../../src/app/vms/sealed/sealing').aPair().pem, CRED);

    assert.throws(() => asTheGuest('finish', JSON.stringify(sealed)));
    assert.equal(fs.existsSync(path.join(home, '.claude', '.credentials.json')), false,
        'something was written by a handover that could not be opened');
});

test('a reply sealed to somebody else does not land', () => {
    asTheGuest('begin');

    const somebodyElse = require('../../src/app/vms/sealed/sealing').aPair();
    const sealed = sealFor(somebodyElse.pem, CRED);

    assert.throws(() => asTheGuest('finish', JSON.stringify(sealed)));
    assert.equal(fs.existsSync(path.join(home, '.claude', '.credentials.json')), false);
});

test('and the private half does not survive a finish, whether or not it worked', () => {
    //IT EXISTS FOR THE SECONDS BETWEEN THE TWO STEPS. A long-lived key on disk
    //would open every credential the machine is ever handed.
    asTheGuest('begin');
    const kept = path.join(home, '.okc-handover');
    assert.equal(fs.existsSync(kept), true, 'the guest kept no key between the two steps');

    const somebodyElse = require('../../src/app/vms/sealed/sealing').aPair();
    try { asTheGuest('finish', JSON.stringify(sealFor(somebodyElse.pem, CRED))); } catch (e) { /* expected */ }

    const left = fs.existsSync(kept) ? fs.readdirSync(kept) : [];
    assert.deepEqual(left, [], 'a key that could open a credential was left on the machine after a failure');
});

test('a second finish has nothing to open with, so a replay lands nothing', () => {
    const pub = asTheGuest('begin').match(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/)[0];
    const sealed = JSON.stringify(sealFor(pub, CRED));

    asTheGuest('finish', sealed);
    fs.rmSync(path.join(home, '.claude', '.credentials.json'));

    assert.throws(() => asTheGuest('finish', sealed),
        undefined, 'a recorded handover could be replayed onto the machine later');
});

test('and it says what to do rather than only failing', () => {
    let said = '';
    try { asTheGuest('mumble'); } catch (e) { said = String(e.stderr || '') + String(e.stdout || ''); }
    assert.match(said, /begin.*finish/s);
});
