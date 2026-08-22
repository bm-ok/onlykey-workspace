const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const makePayloads = require('../../src/app/vms/dispatch/payloads');
const makeSession = require('../../src/app/vms/dispatch/session');
const { answer, CLIP } = require('../../src/app/vms/dispatch/session');

const GUEST = path.join(__dirname, '..', '..', 'src', 'app', 'vms', 'dispatch', 'guest');
const READER = path.join(GUEST, 'session.js');

//---------------------------------------------------------------------------
//READING THE CLAUDE SESSION INSIDE A RUNNER.
//
//THE CLAIM WORTH THE MOST: it is strictly READ-ONLY. A supervisor that writes
//into the tree a worker is editing is how one session's notes end up inside
//another's commit — a real thing that happened here.
//
//AND THE SECOND: the answer is the LAST line that parses. The login shell may
//print a motd or an nvm notice first, and a watcher that took the first line
//would break on a machine somebody had customised.
//
//THE READER IS RUN FOR REAL HERE, against a transcript written to a temp
//directory. It is a file now rather than a string in a source file, which is
//what makes that possible at all.
//---------------------------------------------------------------------------

let sess, payloads;
beforeEach(() => {
    payloads = makePayloads({ dir: GUEST });
    sess = makeSession({ payloads });
});

//---- how it is asked ---------------------------------------------------------

test('the program reaches node through stdin, not the command line', () => {
    const s = sess.command('list');
    //SO NO QUOTING HAS TO SURVIVE BOTH THIS FILE AND THE GUEST'S LOGIN SHELL —
    //and so nothing is installed on the machine and nothing is left behind.
    assert.match(s, /^node - 'list' '200' <<'OKC_SESSION_EOF'\n/);
    assert.ok(s.trimEnd().endsWith('\nOKC_SESSION_EOF'), s.slice(-80));
});

test('what it sends is the reader on disk, unaltered', () => {
    assert.ok(sess.command('list').includes(fs.readFileSync(READER, 'utf8')),
        'the reader was changed on the way to the machine');
});

test('every argument is quoted, including ones that are not strings', () => {
    const s = sess.command('tail', ['abc-123', 40, 20]);
    assert.match(s, /^node - 'tail' 'abc-123' '40' '20' '200' <<'OKC_SESSION_EOF'\n/);
});

test('a session id that is a shell fragment cannot escape its quotes', () => {
    const s = sess.command('tail', ["a'; rm -rf /; echo '"]);
    const first = s.split('\n')[0];
    //THE ONLY BYTE THAT CAN END THE QUOTING is a single quote, and it is escaped.
    assert.ok(first.includes("'a'\\''; rm -rf /; echo '\\'''"), first);
});

test('the clip length is stated by the host rather than agreed twice', () => {
    //./guest/session.js CARRIES ONLY A DEFAULT, for somebody running it by hand.
    assert.equal(CLIP, 200);
    assert.ok(sess.command('list').split('\n')[0].endsWith("'200' <<'OKC_SESSION_EOF'"));
});

test('a reader containing the marker would be refused rather than truncated', () => {
    //THE SAME GUARD AS EVERY OTHER HEREDOC IN THIS GROUP. The version this comes
    //from wrote this one by hand, so the marker check applied everywhere except
    //here.
    const bad = makeSession({ payloads: { session: () => 'a\nOKC_SESSION_EOF\nrm -rf /' } });
    assert.throws(() => bad.command('list'), /reading exactly "OKC_SESSION_EOF"/);
});

//---- how the answer is taken --------------------------------------------------

test('the last line that parses is the answer, whatever came before it', () => {
    const out = [
        'Welcome to Ubuntu 24.04 LTS',
        'nvm: version 20 in use',
        '{"ok":false,"error":"an older line"}',
        '{"ok":true,"sessions":[]}'
    ].join('\n');

    assert.deepEqual(answer(out), { ok: true, sessions: [] });
});

test('a half-written line before the answer does not become the answer', () => {
    const out = '{"ok":true,"partial"\n{"ok":true,"sessions":[]}';
    assert.deepEqual(answer(out), { ok: true, sessions: [] });
});

test('nothing readable is said plainly rather than thrown', () => {
    assert.deepEqual(answer('Permission denied\nconnection closed'),
        { ok: false, error: 'the machine did not answer with anything readable' });
    assert.equal(answer('').ok, false);
    assert.equal(answer(null).ok, false);
});

test('the output is redacted before anything is kept', () => {
    //A WORKER CAN READ ITS OWN CREDENTIAL — it cannot authenticate otherwise —
    //and this transcript is pulled to the host and KEPT. That makes it not a
    //moment of exposure but a FILING, permanently. Cleaned on the way in is the
    //only place it can be stopped.
    const seen = [];
    const redact = (s) => { seen.push(s); return s.split('sk-secret').join('<hidden>'); };

    const got = answer('{"ok":true,"token":"sk-secret"}', redact);

    assert.equal(seen.length, 1, 'the output was not passed through the redactor');
    assert.equal(got.token, '<hidden>');
    assert.equal(JSON.stringify(got).indexOf('sk-secret'), -1);
});

//---- and the reader itself, run for real ----------------------------------------

function transcript(home, lines) {
    const dir = path.join(home, '.claude', 'projects', 'a-project');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'sess-abc.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    return dir;
}

function run(home, args) {
    const out = execFileSync(process.execPath, [READER].concat(args.map(String)), {
        encoding: 'utf8',
        env: Object.assign({}, process.env, { HOME: home, USERPROFILE: home })
    });
    return answer(out);
}

test('it lists what is on the machine', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-sess-'));
    transcript(home, [
        { type: 'user', timestamp: '2026-08-22T04:00:00Z', cwd: '/home/okc/work', message: { content: 'do the thing' } },
        { type: 'assistant', timestamp: '2026-08-22T04:01:00Z', aiTitle: 'Doing the thing', message: { content: [{ type: 'text', text: 'on it' }] } }
    ]);

    const r = run(home, ['list']);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.sessions.length, 1);
    assert.equal(r.sessions[0].id, 'sess-abc');
    assert.equal(r.sessions[0].title, 'Doing the thing');
    assert.equal(r.sessions[0].cwd, '/home/okc/work');
});

test('it reports what the worker did, and what is not worth reporting', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-sess-'));
    transcript(home, [
        { type: 'assistant', timestamp: '2026-08-22T04:01:00Z', message: { content: [{ type: 'text', text: 'starting' }] } },
        { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }] } },
        { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/a/b.js' } }] } },
        { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't3', name: 'Write', input: { file_path: '/a/c.js' } }] } }
    ]);

    const r = run(home, ['tail', 'sess-abc', 0, 40]);
    assert.equal(r.ok, true, JSON.stringify(r));

    const kinds = r.entries.map((e) => e.kind);
    assert.ok(kinds.includes('ran'), JSON.stringify(r.entries));
    assert.ok(kinds.includes('wrote'), JSON.stringify(r.entries));
    //A READ OF A FILE IT ALREADY HAD IS NOT NEWS, and a tool result is tens of
    //kilobytes. Carrying that across is what makes a watcher expensive.
    assert.equal(kinds.includes('read'), false, JSON.stringify(r.entries));
});

test('the bookmark is a line number, and asking again from it returns nothing new', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-sess-'));
    transcript(home, [
        { type: 'assistant', message: { content: [{ type: 'text', text: 'one' }] } },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'two' }] } }
    ]);

    const first = run(home, ['tail', 'sess-abc', 0, 40]);
    assert.equal(first.entries.length, 2);

    //A WATCHER THAT RE-READS FROM THE TOP spends its context re-deriving what it
    //already reported.
    const again = run(home, ['tail', 'sess-abc', first.bookmark, 40]);
    assert.deepEqual(again.entries, []);
    assert.equal(again.bookmark, first.bookmark);
});

test('a prefix matching two sessions is an error, never a guess', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-sess-'));
    const dir = transcript(home, [{ type: 'assistant', message: { content: [{ type: 'text', text: 'x' }] } }]);
    fs.copyFileSync(path.join(dir, 'sess-abc.jsonl'), path.join(dir, 'sess-abd.jsonl'));

    //SILENTLY WATCHING THE WRONG ONE produces confident wrong reports, which is
    //the failure this is meant to prevent rather than commit.
    const r = run(home, ['tail', 'sess-', 0, 40]);
    assert.equal(r.ok, false);
    assert.match(r.error, /matches 2 sessions/);
});

test('a machine with no sessions says so rather than answering emptily', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-sess-'));
    const r = run(home, ['tail', '', 0, 40]);
    assert.equal(r.ok, false);
    assert.match(r.error, /no claude sessions on this machine/);
});

test('a long line is clipped to what the host asked for', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-sess-'));
    transcript(home, [
        { type: 'assistant', message: { content: [{ type: 'text', text: 'x'.repeat(500) }] } }
    ]);

    const r = run(home, ['tail', 'sess-abc', 0, 40, 20]);
    assert.equal(r.entries[0].text.length, 21, r.entries[0].text);   //20 plus the ellipsis
    assert.ok(r.entries[0].text.endsWith('…'));
});

test('it writes nothing at all on the machine it reads', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-sess-'));
    transcript(home, [{ type: 'assistant', message: { content: [{ type: 'text', text: 'x' }] } }]);

    const before = walk(home);
    run(home, ['tail', 'sess-abc', 0, 40]);
    //STRICTLY READ-ONLY. A supervisor that writes into the tree a worker is
    //editing is how one session's notes end up inside another's commit.
    assert.deepEqual(walk(home), before, 'the reader changed something on the machine');
});

function walk(dir) {
    const out = [];
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) out.push(...walk(full).map((x) => name + '/' + x));
        else out.push(name + ':' + st.size + ':' + st.mtimeMs);
    }
    return out.sort();
}
