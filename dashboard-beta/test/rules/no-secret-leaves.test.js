const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { scrub, secretName } = require('../../src/app/core/okc/scrub');

//NOTHING LEAVES THIS HOST CARRYING A SECRET. vmList carried every machine's
//bootstrap token and login out until somebody happened to read a --json
//answer. This is the rule that makes that class of leak impossible: every
//answer that crosses the wire is scrubbed by field name.

test('a field whose name says secret is held, wherever it sits', () => {
    const out = scrub({
        name: 'w1',
        spec: { cpus: 2, token: 'sekrit', password: 'okc', user: 'okc' },
        keys: [{ ghToken: 'abc', fingerprint: 'ccbb82cf' }, { apiKey: 'k', secret: 's' }],
        nested: { deeper: { privateKey: '-----BEGIN', note: 'fine' } }
    });
    assert.equal(out.spec.token, '[held]');
    assert.equal(out.spec.password, '[held]');
    assert.equal(out.spec.cpus, 2);
    assert.equal(out.spec.user, 'okc');
    assert.equal(out.keys[0].ghToken, '[held]');
    assert.equal(out.keys[0].fingerprint, 'ccbb82cf', 'a fingerprint is not a secret');
    assert.equal(out.keys[1].apiKey, '[held]');
    assert.equal(out.keys[1].secret, '[held]');
    assert.equal(out.nested.deeper.privateKey, '[held]');
    assert.equal(out.nested.deeper.note, 'fine');
    assert.ok(!/sekrit|BEGIN|abc/.test(JSON.stringify(out)));
});

test('names that describe a secret without being one stay', () => {
    const out = scrub({ holdsCredential: true, hasToken: true, tokenName: 'worker-b2', isSecret: false, fingerprint: 'x' });
    assert.deepEqual(out, { holdsCredential: true, hasToken: true, tokenName: 'worker-b2', isSecret: false, fingerprint: 'x' });
    assert.equal(secretName('holdsCredential'), false);
    assert.equal(secretName('token'), true);
    assert.equal(secretName('accessToken'), true);
    assert.equal(secretName('githubToken'), true);
});

test('empty, null and false secrets are left as they are, so absence still reads as absence', () => {
    const out = scrub({ token: null, password: '', secret: false });
    assert.deepEqual(out, { token: null, password: '', secret: false });
});

test('the original is untouched, cycles do not hang it, and leaves pass through', () => {
    const rec = { spec: { token: 'sekrit' } };
    rec.self = rec;
    const out = scrub(rec);
    assert.equal(rec.spec.token, 'sekrit', 'the host\'s own record was scrubbed');
    assert.equal(out.spec.token, '[held]');
    assert.equal(scrub('a string'), 'a string');
    assert.equal(scrub(7), 7);
    assert.equal(scrub(null), null);
    const d = new Date(0);
    assert.equal(scrub({ at: d }).at, d);
});

//AND THE WIRE ACTUALLY USES IT: the one handler every answer goes through.
test('the okc:call handler scrubs what it replies with', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'core', 'okc', 'server.js'), 'utf8');
    const at = src.indexOf("client.on('okc:call'");
    assert.ok(at > 0, 'the handler moved');
    const handler = src.slice(at, at + 600);
    assert.match(handler, /scrub\(result\)/, 'the wire replies without scrubbing');
});
