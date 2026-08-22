const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { q, heredoc } = require('../../src/app/vms/shell/quoting');

//---------------------------------------------------------------------------
//GETTING SOMEBODY ELSE'S TEXT ONTO A MACHINE WITHOUT IT BECOMING A COMMAND.
//
//THE FAILURE IS NOT AN ERROR, which is what makes this worth checking hard: a
//quoting mistake does not produce a broken command that fails loudly, it
//produces a DIFFERENT command that runs.
//
//AND THE CHECKS ARE RUN THROUGH A REAL SHELL where they can be. Asserting that
//a string LOOKS right is asserting my own understanding of quoting back at
//myself — which is exactly the understanding that would be wrong. `sh` is the
//thing that will actually read this, so it is what gets asked.
//---------------------------------------------------------------------------

//git bash ships one here on this machine; a host without it skips the shell
//half rather than failing, and the string checks still run.
let SH = null;
for (const p of ['/usr/bin/sh', '/bin/sh', 'C:/Program Files/Git/usr/bin/sh.exe']) {
    try { if (fs.existsSync(p)) { SH = p; break; } } catch (e) { /* keep looking */ }
}

//What the shell makes of it: run `printf %s <word>` and read back the bytes.
function shellReads(word) {
    return execFileSync(SH, ['-c', 'printf %s ' + word], { encoding: 'utf8' });
}

const NASTY = [
    ["it's", 'a single quote, the only byte that can end the quoting'],
    ['$HOME', 'a variable'],
    ['$(whoami)', 'a substitution'],
    ['`id`', 'an old-style substitution'],
    ['a\\b', 'a backslash'],
    ['"double"', 'double quotes'],
    ['; rm -rf /', 'a command separator'],
    ['&& echo no', 'a conjunction'],
    ['a | b', 'a pipe'],
    ['*', 'a glob'],
    ['~root', 'a tilde'],
    ["''", 'two quotes'],
    ["'\\''", 'the escape sequence itself'],
    ['line one\nline two', 'a newline'],
    ['  spaced  ', 'leading and trailing spaces'],
    ['', 'nothing at all'],
    ['#comment', 'a comment marker'],
    ['a\tb', 'a tab']
];

//---- one shell word ----------------------------------------------------------

test('a real shell reads back exactly what went in, whatever was in it', { skip: SH ? false : 'no sh on this host' }, () => {
    //ASKING THE THING THAT WILL ACTUALLY READ IT. A string that merely looks
    //correctly quoted is my own understanding asserted back at me.
    for (const [text, what] of NASTY) {
        assert.equal(shellReads(q(text)), text, 'the shell changed it — ' + what + ': ' + JSON.stringify(text));
    }
});

test('nothing inside is expanded, in one word', { skip: SH ? false : 'no sh on this host' }, () => {
    //ONE WORD, not several. `set -- <q>` then counting is how you tell a
    //correctly quoted string from one the shell split on whitespace.
    //ONE ARGV ELEMENT. `sh -c` takes anything after the script as $0 onwards, so
    //splitting this in two silently ran `set --` with nothing to echo.
    const out = execFileSync(SH, ['-c', 'set -- ' + q('a b  c\td') + '; echo $#'], { encoding: 'utf8' }).trim();
    assert.equal(out, '1', 'the shell split it into ' + out + ' words');
});

test('a substitution does not run', { skip: SH ? false : 'no sh on this host' }, () => {
    const marker = 'okc-canary-' + 'not-run';
    const out = shellReads(q('$(echo ' + marker + ')'));
    assert.equal(out, '$(echo ' + marker + ')');
    assert.ok(!out.includes(marker + '\n'), out);
});

test('the escaping is the standard close-escape-reopen, and only for quotes', () => {
    assert.equal(q('plain'), "'plain'");
    assert.equal(q("it's"), "'it'\\''s'");
    //NO OTHER CHARACTER IS TOUCHED. A list of things to escape is something that
    //can be incomplete; inside single quotes there is exactly one.
    assert.equal(q('$`\\"'), "'$`\\\"'");
});

test('a null byte is refused rather than silently truncating the command', () => {
    //A SHELL STRING IS NUL-TERMINATED. This would not be escaped wrongly — the
    //command would be CUT OFF at it and run what came before.
    assert.throws(() => q('safe' + String.fromCharCode(0) + '; rm -rf /'), /null byte/);
});

test('a missing value is an empty word, not the text "null"', () => {
    assert.equal(q(null), "''");
    assert.equal(q(undefined), "''");
});

//---- a whole file --------------------------------------------------------------

test('a file arrives byte for byte, through a real shell', { skip: SH ? false : 'no sh on this host' }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-heredoc-'));
    const file = (dir + '/out.txt').split('\\').join('/');

    const body = [
        'a task with $HOME in it',
        'and `backticks`',
        "and 'quotes' and \"more\"",
        'and a \\backslash',
        'and OKC_TASK_EOF_NOT_QUITE'
    ].join('\n');

    execFileSync(SH, ['-c', heredoc(file, body, 'OKC_TASK_EOF')], { encoding: 'utf8' });

    //NOTHING INSIDE WAS EXPANDED. The marker is quoted — `<<'TAG'` — which is
    //what stops $, backticks and backslashes being evaluated on the way in.
    assert.equal(fs.readFileSync(file, 'utf8'), body + '\n');
});

test('a body containing the marker on its own line is refused, and says which line', () => {
    //A HEREDOC ENDS AT ITS DELIMITER, WHEREVER IT APPEARS. Everything after it
    //would be executed as shell — not an error, a different program.
    assert.throws(() => heredoc('/tmp/x', 'before\nOKC_TASK_EOF\nrm -rf /', 'OKC_TASK_EOF'), (e) => {
        assert.match(e.message, /reading exactly "OKC_TASK_EOF"/);
        assert.match(e.message, /Change that line/);
        return true;
    });
});

test('the marker as part of a longer line is fine, because a heredoc needs the whole line', () => {
    assert.doesNotThrow(() => heredoc('/tmp/x', 'see OKC_TASK_EOF for details', 'OKC_TASK_EOF'));
    assert.doesNotThrow(() => heredoc('/tmp/x', '  OKC_TASK_EOF', 'OKC_TASK_EOF'));
});

test('a marker line with a carriage return on it is still a marker', () => {
    //A BODY THAT ARRIVED WITH WINDOWS LINE ENDINGS has "TAG\r" where the shell —
    //reading the file it lands in — still sees the marker. A check that missed
    //this would pass here and end the heredoc early on the machine.
    assert.throws(() => heredoc('/tmp/x', 'a\r\nOKC_TASK_EOF\r\nrm -rf /', 'OKC_TASK_EOF'),
        /reading exactly "OKC_TASK_EOF"/);
});

test('the marker is quoted in the output, so nothing in the body expands', () => {
    const out = heredoc('/tmp/x', 'hello', 'OKC_TASK_EOF');
    assert.ok(out.includes("<<'OKC_TASK_EOF'"), out);
    assert.ok(!out.includes('<<OKC_TASK_EOF'), 'the marker is unquoted, so the body would be expanded: ' + out);
});

test('a marker that could not survive being quoted is refused', () => {
    //A TAG WITH A SPACE OR A QUOTE would fail as a shell syntax error a long way
    //from here; one with a regex character in it would make the check itself
    //wrong, if the check were built from it.
    for (const bad of ['has space', "has'quote", 'lower', 'has.dot', '', '9LEADING']) {
        assert.throws(() => heredoc('/tmp/x', 'body', bad), /not usable as a heredoc marker/,
            'accepted the marker ' + JSON.stringify(bad));
    }
});

test('the check does not depend on the tag having no regex characters in it', () => {
    //BUILDING A PATTERN OUT OF A VALUE is how a check comes to depend on that
    //value's shape. The tag rule above makes it moot today; this holds the line
    //comparison itself.
    assert.doesNotThrow(() => heredoc('/tmp/x', 'A_B', 'AXB'));
    assert.throws(() => heredoc('/tmp/x', 'AXB', 'AXB'), /reading exactly/);
});

test('an empty body still writes a file rather than nothing', () => {
    const out = heredoc('/tmp/x', '', 'OKC_PROMPT_EOF');
    assert.equal(out, "cat > /tmp/x <<'OKC_PROMPT_EOF'\n\nOKC_PROMPT_EOF");
});
