const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const looksLike = require('../src/app/core/secret/looks-like');
const secret = require('../src/app/core/secret/main');

//---------------------------------------------------------------------------
//what a secret looks like, and keeping one so the file is not enough.
//
//THE GAP THIS FILE EXISTS FOR. Redaction was written three times — two patterns
//in core/log, four in core/events, nine in the app being ported from — and the
//live log did not catch a GitHub token at ALL, while the durable record caught
//one only by accident, through a rule about anything long and random.
//
//So the checks below are about the vocabulary being ONE, and about the two
//policies over it staying different on purpose: narrow enough for a guest's
//output, blunt enough for something kept for ever.
//---------------------------------------------------------------------------

//EVERY PREFIX GITHUB ISSUES. Written out rather than generated, because the
//point is that each one is named somewhere — a loop over a list this file also
//defines would be the same mistake in one place instead of two.
const GITHUB = [
    'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
    'gho_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
    'ghu_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
    'ghs_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
    'ghr_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
    'github_pat_11ABCDEFG0abcdefghijkl_MNOPQRSTUVWXYZ0123456789abcdefghijklmn'
];

const ANTHROPIC = [
    'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
    'sk-ant-oat01-ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210'
];

//---- the gap that was found ------------------------------------------------

test('a GitHub token does not survive the LIVE log policy', () => {
    for (const t of GITHUB) {
        const out = looksLike.redact('pushed onward with ' + t + ' and it worked');
        assert.ok(!out.includes(t), t.slice(0, 12) + '… survived — this is the gap core/log had');
    }
});

test('an Anthropic key does not survive either policy', () => {
    for (const k of ANTHROPIC) {
        assert.ok(!looksLike.redact(k).includes(k));
        assert.ok(!looksLike.redact(k, 'durable').includes(k));
    }
});

test('a credential that names itself goes, whatever shape the value is', () => {
    for (const line of [
        'GITHUB_TOKEN=whatever-this-is',
        'ANTHROPIC_API_KEY: abc123',
        'Authorization: Bearer opaque-string',
        'password = hunter2',
        'api_key: 12345'
    ]) {
        const out = looksLike.redact(line);
        assert.match(out, /<redacted>/, line + ' was left as it was');
    }
});

test('a token in a remote URL goes, and the host stays', () => {
    const out = looksLike.redact('fatal: could not read from https://x:ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345@github.com/o/r');
    assert.ok(!out.includes('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'));
    //THE HOST IS THE USEFUL HALF. A line saying a push failed to <redacted> is a
    //line nobody can act on.
    assert.match(out, /github\.com/);
});

//---------------------------------------------------------------------------
//THE TWO POLICIES ARE DIFFERENT ON PURPOSE.
//
//The live log carries a guest's output — commit hashes, base64, long
//identifiers. Redacting anything long and random there makes it useless for the
//thing it exists for. A durable record is kept for ever and takes the opposite
//trade. Collapsing the two, in either direction, is the failure.
//---------------------------------------------------------------------------

test('the live policy leaves a commit hash alone, and the durable one does not', () => {
    const line = 'merged 3f2a1b8c9d4e5f6a7b8c9d0e1f2a3b4c5d6e7f80 into master';

    assert.match(looksLike.redact(line), /3f2a1b8c9d4e5f6a7b8c9d0e1f2a3b4c5d6e7f80/,
        'the live log redacted a commit hash — a log of <redacted> is not a log');
    assert.ok(!looksLike.redact(line, 'durable').includes('3f2a1b8c9d4e5f6a7b8c9d0e1f2a3b4c5d6e7f80'),
        'the durable record kept something long and random, which is what it must not do');
});

test('`durable` is opt-in, so the blunt rules cannot arrive by accident', () => {
    const url = 'fetched https://example.invalid/a/very/long/path?with=queries';
    assert.match(looksLike.redact(url), /a\/very\/long\/path/, 'the live policy applied a durable rule');
    assert.ok(!looksLike.redact(url, 'durable').includes('a/very/long/path'));
});

//AND THE VOCABULARY IS ONE. Both policies start from the same list, so a shape
//added for one is caught by the other — which is the whole point of moving it.
test('everything the narrow policy catches, the blunt one catches too', () => {
    for (const t of GITHUB.concat(ANTHROPIC)) {
        assert.ok(!looksLike.redact(t, 'durable').includes(t),
            t.slice(0, 12) + '… survives the durable policy but not the live one');
    }
});

//---- inertness -------------------------------------------------------------

//A REDACTOR THAT REDACTS EVERYTHING PASSES EVERY CHECK ABOVE and is worthless.
test('ordinary text comes back untouched', () => {
    const plain = 'runner2 came up in 41s and claimed work/fix-the-thing';
    assert.equal(looksLike.redact(plain), plain);
    assert.equal(looksLike.redact('', 'durable'), '');
    assert.equal(looksLike.redact(null), '');
});

test('there is more than one shape in each list', () => {
    assert.ok(looksLike.CREDENTIALS.length >= 8, 'the credential vocabulary lost entries on the way here');
    assert.ok(looksLike.GREEDY.length >= 3);
});

//---------------------------------------------------------------------------
//KEEPING ONE.
//
//WHAT IS ASSERTED IS THE ROUND TRIP AND THE MARK, not that DPAPI was used —
//these run on whatever machine they run on, and a test that demands Windows is a
//test that is skipped on the machine somebody actually reads the output on.
//---------------------------------------------------------------------------

const somewhere = () => fs.mkdtempSync(path.join(os.tmpdir(), 'okc-secret-'));

test('what is written comes back, and says which protection it got', () => {
    const file = path.join(somewhere(), 'token');
    const sealed = secret.write(file, Buffer.from('sk-ant-not-a-real-one'));

    assert.equal(secret.read(file).toString(), 'sk-ant-not-a-real-one');
    assert.equal(sealed, secret.WINDOWS, 'it claimed a protection it did not apply');
    assert.equal(secret.isSealed(file), secret.WINDOWS);
});

//A FILE WRITTEN BEFORE THE SEALING EXISTED, OR ON ANOTHER PLATFORM, must read as
//itself rather than being fed to the decryptor and failing as corruption. That
//is what the mark is for.
test('an unsealed file reads as itself rather than as corruption', () => {
    const file = path.join(somewhere(), 'old');
    fs.writeFileSync(file, 'plain-old-token');

    assert.equal(secret.isSealed(file), false);
    assert.equal(secret.read(file).toString(), 'plain-old-token');
});

test('what lands on disk is not the cleartext, where sealing is real', (t) => {
    if (!secret.WINDOWS) return t.skip('sealing is file permissions here, and there is nothing to look at');

    const file = path.join(somewhere(), 'token');
    secret.write(file, Buffer.from('sk-ant-not-a-real-one'));

    const raw = fs.readFileSync(file).toString('utf8');
    assert.ok(!raw.includes('sk-ant-not-a-real-one'), 'the cleartext is sitting in the file');
    assert.ok(raw.startsWith(secret.MARK), 'it is not marked, so the next read will treat it as plaintext');
});
