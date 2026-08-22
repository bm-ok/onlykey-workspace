const { test } = require('node:test');
const assert = require('node:assert');

const { bootstrapLine, normalFingerprint } = require('../../src/app/vms/provision/bootstrap');

//---------------------------------------------------------------------------
//THE ONE COMMAND LINE AN INSTALL IS TRUSTED WITH.
//
//A machine being installed holds nothing — no certificate, no authority, no
//token — and this line is what gets it from there to holding all of them. Every
//claim below is one that, if it were false, would leave the install either dead
//twenty-five minutes in or, worse, successful while having checked nothing.
//
//THE CLAIM WORTH THE MOST: the setup script carries the machine's token, and it
//is not fetched until the authority has been checked. If that order ever
//reverses, the check is decoration and the token goes to whoever answered.
//
//AND THE SECOND: no `$` survives into the line. VirtualBox pastes it inside a
//double-quoted argument, so the OUTER shell expands substitutions before bash
//ever sees them. The version that got this wrong compared an empty string to an
//empty string, PASSED, and would have accepted any authority at all.
//---------------------------------------------------------------------------

const CA = 'http://192.168.51.63:7318/ca.pem';
const SCRIPT = 'https://192.168.51.63:7317/provision/first-boot.sh?vm=one&ticket=abc123';
const PRINT = 'aa:BB:cc:DD:ee:FF:00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99';

function line(over) {
    return bootstrapLine(Object.assign({ caUrl: CA, scriptUrl: SCRIPT, fingerprint: PRINT }, over || {}));
}

//---- the order, which is the whole design -----------------------------------

test('the authority is fetched, then checked, and only then anything carrying a secret', () => {
    const l = line();

    const gotCa = l.indexOf(CA);
    const checked = l.indexOf(normalFingerprint(PRINT));
    const gotScript = l.indexOf(SCRIPT);

    assert.ok(gotCa >= 0, 'the authority is never fetched');
    assert.ok(checked >= 0, 'the fingerprint is never compared');
    assert.ok(gotScript >= 0, 'the setup script is never fetched');

    assert.ok(gotCa < checked, 'it checks a fingerprint before fetching anything to check');
    assert.ok(checked < gotScript,
        'the token-carrying script is fetched before the authority is checked, so the check is decoration');
});

test('and there is no fallback to plain http if the check fails', () => {
    const l = line();
    //A FALLBACK IS A WAY TO BE PUSHED ONTO THE UNPROTECTED PATH by whoever is
    //doing the pushing. After the refusal the line exits; it does not try again
    //without verification.
    const refused = l.indexOf('REFUSED the certificate authority');
    assert.ok(refused >= 0);
    assert.match(l.slice(refused), /^[^;]*;\s*exit 1;/,
        'something happens after the refusal other than stopping: ' + l.slice(refused, refused + 160));
});

//---- the rules that are not obvious -----------------------------------------

test('no dollar sign survives into the line', () => {
    //THE OUTER SHELL EXPANDS IT FIRST. A loop counter arrives empty and a
    //substitution runs on the wrong side — and `got=$(...)` compared empty to
    //empty, which PASSES.
    assert.equal(line().indexOf('$'), -1, 'a $ reached the line and will be expanded by the wrong shell');
});

test('the fingerprint is compared with a pipeline into grep, never through a variable', () => {
    const l = line();
    assert.match(l, /openssl x509 [^;]*-fingerprint -sha256 \| tr -d ':' \| tr 'A-Z' 'a-z' \| grep -q '/);
    assert.equal(l.indexOf('got='), -1, 'it assigns a variable, which the outer shell expands to nothing');
});

test('it is a plain argument list, because a leading parenthesis is a syntax error', () => {
    //VirtualBox pastes this unquoted into its own template. The install dies at
    //the very end with nothing saying why.
    assert.ok(!/^\s*\(/.test(line()));
});

test('both curl and wget fetch both things, because curl is not in the installer', () => {
    const l = line();
    //curl IS NOT IN THE INSTALLER'S TARGET on Ubuntu desktop. The fallback was
    //kept on the first fetch and dropped from the second, and the install ran
    //for twenty-five minutes before saying "the dashboard is not reachable" —
    //a sentence about the network, describing a missing program.
    for (const url of [CA, SCRIPT]) {
        for (const tool of ['curl', 'wget']) {
            assert.match(l, new RegExp(tool + "[^;]*'" + url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'"),
                tool + ' never fetches ' + url);
        }
    }
});

test('neither tool is told to skip verification when it fetches the secret', () => {
    const l = line();
    //THE SAME INSTRUCTION SPELLED TWICE, which is the whole difference between
    //this and the version that failed.
    assert.ok(l.includes('--cacert /etc/okc/ca.pem'), 'curl does not check the setup script');
    assert.ok(l.includes('--ca-certificate=/etc/okc/ca.pem'), 'wget does not check the setup script');

    for (const off of ['--insecure', '--no-check-certificate', ' -k ']) {
        assert.equal(l.indexOf(off), -1, 'it disables the verification it exists to do: ' + off);
    }
});

//---- telling the two failures apart -----------------------------------------

test('a file that was never fetched is not reported as a substituted authority', () => {
    const l = line();
    //A DIFFERENT FAULT WITH A DIFFERENT CAUSE. Without this, a machine that
    //simply had no way to download anything is accused of substitution.
    const empty = l.indexOf('if [ ! -s /etc/okc/ca.pem ]');
    const mismatch = l.indexOf('REFUSED the certificate authority');
    assert.ok(empty >= 0, 'an empty authority file is not noticed at all');
    assert.ok(empty < mismatch, 'the emptiness check must come before the fingerprint accusation');
    assert.match(l, /could not fetch the certificate authority at all/);
});

test('and a missing setup script says what state the machine is in', () => {
    //"No such file or directory" and "exit code: 127" describe the symptom and
    //name neither the cause nor what the machine now is.
    assert.match(line(), /the operating system is installed but nothing has been set up on it/);
});

test('every failure stops the install rather than carrying on', () => {
    const l = line();
    //Three refusals, three exits: no authority, wrong authority, no script.
    assert.equal((l.match(/exit 1;/g) || []).length, 3, l);
});

//---- what it refuses to build -----------------------------------------------

test('it refuses to build a line with no fingerprint, rather than grepping for nothing', () => {
    //AN EMPTY PATTERN MATCHES EVERYTHING. This is the exact shape of the bug
    //this file exists to make impossible, so it is refused rather than built.
    assert.throws(() => line({ fingerprint: '' }), /needs the fingerprint/);
    assert.throws(() => line({ fingerprint: null }), /needs the fingerprint/);
    assert.throws(() => line({ fingerprint: ':::' }), /needs the fingerprint/);
});

test('it refuses a url that would smuggle a substitution into the line', () => {
    //A COMMENT IS NOT A CHECK. Both of the mistakes this guards against have
    //already been made once here.
    assert.throws(() => line({ caUrl: 'http://h/$(whoami)/ca.pem' }), /expands it before/);
    assert.throws(() => line({ scriptUrl: 'https://h/x.sh?vm=$name' }), /expands it before/);
});

test('it refuses a url that turns verification off', () => {
    assert.throws(() => line({ scriptUrl: 'https://h/x.sh?a=--insecure' }), /turns off the verification/);
});

test('it refuses to build without somewhere to fetch from', () => {
    assert.throws(() => line({ caUrl: '' }), /certificate authority from/);
    assert.throws(() => line({ scriptUrl: '' }), /setup script from/);
});

//---- the fingerprint as openssl will print it -------------------------------

test('the fingerprint is compared in the form the pipeline produces', () => {
    //openssl PRINTS UPPER CASE WITH COLONS; the pipeline strips and lowercases.
    //A fingerprint compared in the form it was stored in matches nothing, and
    //the install refuses a certificate that was correct.
    assert.equal(normalFingerprint('AA:BB:cc'), 'aabbcc');
    assert.equal(normalFingerprint('  AA:BB  '), 'aabb');

    const l = line();
    assert.ok(l.includes("grep -q 'aabbccddeeff"), l.slice(l.indexOf('grep -q'), l.indexOf('grep -q') + 90));
    assert.equal(l.indexOf('AA:BB'), -1, 'the stored form reached the line and would match nothing');
});
