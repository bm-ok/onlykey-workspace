const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const makeSupervisor = require('../../src/app/vms/dispatch/supervisor');
const makeWatcher = require('../../src/app/vms/dispatch/watcher');

//---------------------------------------------------------------------------
//ONE TURN OF THE SUPERVISOR, as the machine will receive it.
//
//BUILT HERE RATHER THAN IN THE ACTION THAT SENDS IT, and that is the claim this
//file exists to hold: shell assembled inside an action is shell nothing can look
//at without waking a supervisor to watch what happens. A `continue` outside a
//loop and a self-matching `pkill` both reached a machine in this project that
//way. Built here it can be printed, checked with `bash -n`, and read by somebody
//who is not currently debugging it.
//---------------------------------------------------------------------------

let SH = null;
for (const p of ['/usr/bin/sh', '/bin/sh', 'C:/Program Files/Git/usr/bin/sh.exe']) {
    try { if (fs.existsSync(p)) { SH = p; break; } } catch (e) { /* keep looking */ }
}

let sup;
beforeEach(() => {
    const payloads = { watch: () => '//the watcher\n' };
    sup = makeSupervisor({ watcher: makeWatcher({ payloads }) });
});

const B64 = Buffer.from("wake up. there's work, and it's yours.").toString('base64');
const of = (over) => sup.turn(Object.assign({
    stamp: '2026-08-22T04-08-57', brief: B64, refresh: 'echo okc-skill-refreshed'
}, over || {}));

//---- the order, which is the whole of it ------------------------------------

test('it refreshes the skill before it does anything else', () => {
    const s = of();
    //SO IT SUPERVISES BY THIS HOST'S CURRENT RULES. A supervisor is never rolled
    //back, so without this it works to whatever it was built with.
    assert.ok(s.indexOf('okc-skill-refreshed') < s.indexOf('okc-supervisor -p'), s);
    assert.match(s, /^cd ~ && echo okc-skill-refreshed$/m);
});

test('the brief is decoded, used, and removed', () => {
    const s = of();

    const write = s.indexOf('base64 -d > /tmp/okc-wake.txt');
    const read = s.indexOf('cat /tmp/okc-wake.txt');
    const gone = s.indexOf('rm -f /tmp/okc-wake.txt');

    assert.ok(write >= 0 && read >= 0 && gone >= 0, s);
    assert.ok(write < read, 'it reads the brief before writing it');
    assert.ok(read < gone, 'it removes the brief before reading it');
});

test('the log is relinked before the turn runs, not after', () => {
    const s = of();
    //A TERMINAL ALREADY OPEN FOLLOWS current.log. Relinking after the turn
    //started would show the previous wake for the length of this one.
    assert.ok(s.indexOf('ln -sfn') < s.indexOf('okc-supervisor -p'), s);
    //AND IT FOLLOWS current.log RATHER THAN THIS TURN'S FILE, so a terminal left
    //open shows every wake instead of one and then silence.
    assert.ok(s.includes('$HOME/.okc-supervisor/current.log'), s);
});

test("the turn's transcript goes to a file, not back down the channel", () => {
    const s = of();
    //WHAT A TURN PRODUCES reaches the host through the supervisor API rather
    //than through stdout — and a supervisor is never rolled back, so the file is
    //still there tomorrow when somebody asks what it did.
    assert.match(s, />\s*\$HOME\/\.okc-supervisor\/turns\/2026-08-22T04-08-57\.log 2>&1/);
    assert.match(s, /--output-format stream-json --verbose/);
});

test('a turn that stops making progress does not hold the channel for ever', () => {
    //TEN MINUTES IS LONGER THAN ANY TURN THAT HAS WORKED.
    assert.match(of(), /timeout 600 bash -lc/);
});

//---- what it refuses ---------------------------------------------------------

test('a stamp that is not a name is refused, because it becomes a filename', () => {
    //IT IS MADE BY THIS HOST — which is a property of every caller there is
    //today, not of this function. A `>` redirect writes to it and a symlink
    //points at it.
    for (const bad of ['../../etc/passwd', 'a/b', '$(whoami)', 'a b', "a'b", '', '.hidden', 'a;b']) {
        assert.throws(() => of({ stamp: bad }), /is not a name for a turn/,
            'accepted the stamp ' + JSON.stringify(bad));
    }
});

test('a brief that has not been base64-encoded is refused', () => {
    //THE ENCODING IS WHAT LETS IT BE PROSE WITH QUOTES IN IT. A brief that
    //skipped it carries the one character that would end the quoting around it.
    assert.throws(() => of({ brief: "wake up, it's yours" }), /base64-encoded/);
    assert.throws(() => of({ brief: 'a`id`b' }), /base64-encoded/);
    assert.throws(() => of({ brief: '$(whoami)' }), /base64-encoded/);
});

test('and real base64 goes through, including padding and wrapping', () => {
    assert.doesNotThrow(() => of({ brief: B64 }));
    assert.doesNotThrow(() => of({ brief: 'YWJj\nZGVm\n' }));
    assert.doesNotThrow(() => of({ brief: '' }));
});

//---- and it is shell -----------------------------------------------------------

test('what it produces parses as shell', { skip: SH ? false : 'no sh on this host' }, () => {
    //A `continue` OUTSIDE A LOOP AND A SELF-MATCHING `pkill` BOTH REACHED A
    //MACHINE in this project. That is what building it here rather than inside
    //an action is for, and it is only worth anything if somebody looks.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-sup-'));
    const file = path.join(dir, 'turn.sh');
    fs.writeFileSync(file, of());

    assert.doesNotThrow(() => execFileSync(SH, ['-n', file.split('\\').join('/')], { encoding: 'utf8' }));
});

test('the brief survives the round trip through a real shell', { skip: SH ? false : 'no sh on this host' }, () => {
    const text = "wake up. there's work, and it's $HOME's, `honestly`.";
    const brief = Buffer.from(text).toString('base64');

    const line = of({ brief }).split('\n').find((l) => l.startsWith('printf %s '));
    assert.ok(line, 'nothing writes the brief');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-sup-'));
    const out = path.join(dir, 'wake.txt').split('\\').join('/');

    execFileSync(SH, ['-c', line.replace('/tmp/okc-wake.txt', out)], { encoding: 'utf8' });
    assert.equal(fs.readFileSync(out, 'utf8'), text);
});
