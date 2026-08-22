const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const makeSignin = require('../../src/app/vms/auth/signin');
const { ESC, BEL } = require('../../src/app/vms/shell/terminal');

//---------------------------------------------------------------------------
//SIGNING A MACHINE'S WORKER IN, FROM HERE.
//
//THE CLAIM WORTH THE MOST: none of it ever runs as the machine's own user. On a
//supervisor that user is holding the credential the machine is THINKING with, so
//asking for a fresh login URL as that user would overwrite it mid-thought — the
//act of getting a new credential would destroy the one in use.
//
//AND THE SECOND: nothing is ever killed by pattern. `pkill -f` matches whole
//command lines, and the shell running this script has the entire script in its
//own argv — so any pattern matching the thing being killed also matches THIS
//process. It killed itself before doing anything and produced no output at all,
//which is the least diagnosable failure available.
//---------------------------------------------------------------------------

let SH = null;
for (const p of ['/usr/bin/sh', '/bin/sh', 'C:/Program Files/Git/usr/bin/sh.exe']) {
    try { if (fs.existsSync(p)) { SH = p; break; } } catch (e) { /* keep looking */ }
}

let auth;
beforeEach(() => { auth = makeSignin(); });

//---- never as the machine's own user -----------------------------------------

test('everything crosses to the desk, and the desk is a different user', () => {
    const s = auth.asDesk('echo hello', 'okc-desk');

    //`-H` SO HOME IS THE DESK'S, which is the entire point — a sign-in writes
    //~/.claude/.credentials.json for whoever runs it.
    assert.match(s, /sudo -n -u 'okc-desk' -H bash -ls/);
    //`-n` SO IT FAILS rather than waiting for a password nobody is there to type.
    assert.match(s, /sudo -n /);
    //`-l` AS WELL AS `-s`: a login shell, so the desk's own profile is read.
    //Without it the sign-in came back "claude: command not found" from a user
    //that could run it by absolute path perfectly well.
    assert.match(s, /bash -ls$/);
});

test('the script crosses as base64, so none of its quoting is re-quoted', () => {
    //THE SCRIPTS ARE FULL OF QUOTES, PIPES, $(...) AND A FIFO. Wrapping them in
    //`sudo -u desk bash -c '...'` means quoting all of that a second time, and
    //this file has already paid once for a pattern that matched itself.
    const script = auth.begin(20);
    const s = auth.asDesk(script, 'okc-desk');

    const b64 = /printf %s '([A-Za-z0-9+/=]+)'/.exec(s);
    assert.ok(b64, 'the script is not base64 on the way over: ' + s.slice(0, 120));
    assert.equal(Buffer.from(b64[1], 'base64').toString('utf8'), script,
        'the script changed on the way to the desk');

    //AND NOTHING OF THE ORIGINAL IS LEFT IN THE COMMAND LINE to be re-parsed.
    assert.equal(s.indexOf('mkfifo'), -1, s.slice(0, 200));
});

test('a desk that is not a user name is refused rather than quoted and hoped for', () => {
    //IT REACHES `sudo -u` AND `/home/<desk>`. Quoting answers "can this end the
    //command", not "is this a user".
    for (const bad of ['../root', 'a b', '$(whoami)', 'root;rm -rf /', '', 'UPPER', '9start']) {
        assert.throws(() => auth.asDesk('echo x', bad), /not a user name/,
            'accepted the desk ' + JSON.stringify(bad));
        assert.throws(() => auth.deskHome(bad), /not a user name/);
    }
    assert.equal(auth.deskHome('okc-desk'), '/home/okc-desk');
});

//---- never killed by pattern ---------------------------------------------------

test('a previous attempt is killed by recorded pid, never by pattern', () => {
    const s = auth.begin(20);

    //ANY PATTERN THAT MATCHES THE THING BEING KILLED also matches this process.
    assert.equal(s.indexOf('pkill'), -1, s);
    assert.equal(s.indexOf('killall'), -1, s);
    assert.match(s, /kill -- -"\$\(cat \$HOME\/\.okc-auth\/pid\)"/);
});

test('the whole process group goes, not just the wrapper', () => {
    //KILLING THE WRAPPER ALONE would leave the worker holding the pipe, and the
    //next attempt would hand its code to the old conversation.
    assert.match(auth.begin(20), /kill -- -"/);
    assert.match(auth.cancel(), /kill -- -"/);
});

test('the old pipe and log go before a new one is made', () => {
    const s = auth.begin(20);
    const at = (w) => { const i = s.indexOf(w); assert.ok(i >= 0, w + ' is not there'); return i; };

    //BOTH WOULD TAKE THE INPUT MEANT FOR THIS ONE, and the URL that came back
    //would authorise the wrong attempt.
    assert.ok(at('kill -- -') < at('rm -f'), s);
    assert.ok(at('rm -f') < at('mkfifo'), s);
});

//---- the conversation ------------------------------------------------------------

test('the pipe is held open by a writer that never writes', () => {
    //WITHOUT ONE the pipe reaches end-of-file the moment it is opened, and the
    //worker exits deciding nobody is there to answer — which looks exactly like
    //a sign-in that failed for its own reasons.
    assert.match(auth.begin(20), /exec 3> \$HOME\/\.okc-auth\/in/);
});

test('it runs under a pseudo-terminal, or it says nothing at all', () => {
    //THE SIGN-IN IS AN INTERACTIVE SCREEN rather than a program that prints and
    //reads. Without a pty it has nowhere to draw, and silence is the hardest
    //thing to act on.
    assert.match(auth.begin(20), /script -qec "claude auth login" \/dev\/null/);
});

test('it polls rather than sleeping a fixed time', () => {
    //SO A FAST ANSWER IS NOT PAID FOR WITH A FIXED WAIT, and a slow one is not
    //cut off early.
    const s = auth.begin(20);
    assert.match(s, /for i in \$\(seq 1 20\); do/);
    assert.match(s, /grep -qE 'https\?:\/\/'/);
});

test('the wait is a number this file settled, whatever arrived', () => {
    //IT BECOMES `seq 1 N` IN A SHELL LOOP: a value that is not a number is a
    //syntax error on a machine, and an enormous one never returns.
    for (const bad of ['; rm -rf /', 'NaN', '', null, undefined, -5, 0]) {
        assert.match(auth.begin(bad), /seq 1 \d+\); do/, 'from ' + JSON.stringify(bad));
        assert.equal(auth.begin(bad).indexOf('rm -rf /'), -1);
    }
    assert.match(auth.begin(99999), /seq 1 300\)/);
    assert.match(auth.code('x', 99999), /seq 1 300\)/);
});

test('a code with a shell fragment in it cannot escape its quotes', () => {
    const s = auth.code("abc'; rm -rf /; echo '", 20);
    assert.match(s, /printf '%s\\n' 'abc'\\''; rm -rf \/; echo '\\'''/);
});

test('a code is written with printf, so one starting with a dash is still a code', () => {
    //`echo -n` IS AN OPTION TO SOME ECHOES AND TEXT TO OTHERS.
    assert.match(auth.code('-abc', 20), /printf '%s\\n' '-abc'/);
});

test('a conversation that is not there says so rather than writing into nothing', () => {
    assert.match(auth.code('x', 20), /\[ -p \$HOME\/\.okc-auth\/in \] \|\| \{ echo "OKC_AUTH_NO_PIPE"; exit 0; \}/);
});

//---- reading what came back --------------------------------------------------------

test('the url survives an OSC 8 hyperlink, which prints it twice', () => {
    //IT CARRIES THE ADDRESS INSIDE AN ESCAPE SEQUENCE and then prints it AGAIN
    //as the visible text. Left in, the URL arrives wrapped and doubled — which
    //looks approximately right, and cannot be clicked, pasted or opened.
    const url = 'https://claude.ai/oauth/authorize?code=abc&state=xyz';
    const out = [
        'OKC_AUTH_LOG_BEGIN',
        ESC + ']8;;' + url + BEL + url + ESC + ']8;;' + BEL,
        'OKC_AUTH_LOG_END',
        'OKC_AUTH_DONE'
    ].join('\n');

    const r = auth.read(out);
    assert.equal(r.url, url);
    assert.equal(r.log, url, 'the log still carries escapes: ' + JSON.stringify(r.log));
});

test('colours and cursor moves do not end up in the url', () => {
    const url = 'https://claude.ai/oauth?x=1';
    const out = ['OKC_AUTH_LOG_BEGIN',
        ESC + '[1;32mVisit:' + ESC + '[0m ' + url + ESC + '[K',
        'OKC_AUTH_LOG_END'].join('\n');

    assert.equal(auth.read(out).url, url);
});

test('a url at the end of a sentence does not collect the full stop', () => {
    //A URL THAT DOES NOT OPEN IS WORSE THAN NONE — it reads as the tool being
    //broken.
    const out = 'OKC_AUTH_LOG_BEGIN\nGo to https://claude.ai/oauth?x=1.\nOKC_AUTH_LOG_END';
    assert.equal(auth.read(out).url, 'https://claude.ai/oauth?x=1');
});

test('the url is taken from the log, not from the diagnostics under it', () => {
    //THE THINGS THAT TELL "still starting" FROM "the program is missing" name
    //programs and paths, and a URL found there would not be the one to visit.
    const out = [
        'OKC_AUTH_LOG_BEGIN', 'OKC_AUTH_LOG_END',
        'OKC_AUTH_WHY_BEGIN', 'claude: https://not-the-one/', 'OKC_AUTH_WHY_END'
    ].join('\n');

    const r = auth.read(out);
    assert.equal(r.url, null, 'it offered a url out of the diagnostics');
    assert.match(r.why, /claude: https:\/\/not-the-one\//);
});

test('an exit status is what says it finished, and its absence is not a guess', () => {
    assert.equal(auth.read('OKC_AUTH_LOG_BEGIN\nworking\nOKC_AUTH_LOG_END').finished, false);

    const done = auth.read('OKC_AUTH_LOG_BEGIN\ndone\nOKC_AUTH_LOG_END\nOKC_AUTH_EXIT 0');
    assert.equal(done.finished, true);
    assert.equal(done.exit, 0);

    const failed = auth.read('OKC_AUTH_LOG_BEGIN\nnope\nOKC_AUTH_LOG_END\nOKC_AUTH_EXIT 1');
    assert.equal(failed.exit, 1, 'a non-zero exit read as no exit');
});

test('the two other outcomes are told apart from silence', () => {
    assert.equal(auth.read('OKC_AUTH_NO_PIPE').noPipe, true);
    assert.equal(auth.read(auth.cancel() + '\nOKC_AUTH_CANCELLED').cancelled, true);
    assert.equal(auth.read('').noPipe, false);
});

test('nothing at all is an empty answer rather than a throw', () => {
    const r = auth.read('');
    assert.deepEqual({ url: r.url, finished: r.finished, log: r.log, why: r.why },
        { url: null, finished: false, log: '', why: '' });
    assert.equal(auth.read(null).url, null);
});

//---- and it is shell -----------------------------------------------------------------

test('every script it builds parses as shell', { skip: SH ? false : 'no sh on this host' }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-auth-'));
    const cases = [auth.begin(20), auth.code("a'b", 20), auth.cancel(), auth.asDesk(auth.begin(5), 'okc-desk')];

    cases.forEach((s, i) => {
        const file = path.join(dir, 'case-' + i + '.sh');
        fs.writeFileSync(file, s);
        assert.doesNotThrow(() => execFileSync(SH, ['-n', file.split('\\').join('/')], { encoding: 'utf8' }),
            'case ' + i + ' is not valid shell');
    });
});
