const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');

const { script, folderFor, FOLDER } = require('../../src/app/repositories/repos/workspace');

//---------------------------------------------------------------------------
//THE SCRIPT THAT LAYS OUT A MACHINE'S WORKSPACE.
//
//IT RUNS NOTHING. It builds a string and hands it back, which is what makes it
//checkable here: everything this file claims is a claim about TEXT, and the text
//is what a machine is about to run as root's neighbour.
//
//THE CLAIM WORTH THE MOST: the token is not in a remote url. It would work, and
//it would then be in `git remote -v`, in `.git/config`, and in the text of every
//error git prints about that remote — which is the sort of place a secret gets
//copied out of into a screenshot.
//
//AND THE SECOND: every value crosses into a script. A repository or branch name
//is not something this file gets to assume the shape of, and a quoting mistake
//does not produce a broken command that fails loudly — it produces a DIFFERENT
//command that runs.
//---------------------------------------------------------------------------

const TOKEN = 'okc-tok-NOTHINGELSEISSHAPEDLIKETHIS-0123456789';

//WHAT WOULD ACTUALLY RUN, with the script's own comments taken out.
//
//A CHECK THAT SEARCHES THE WHOLE TEXT finds the script's explanation of why it
//does NOT do a thing, and passes. That is a test which goes on passing when the
//comment survives and the code does not — so anything asserting an absence asks
//this instead.
const lines = (s) => String(s).split(String.fromCharCode(10));
const runs = (s) => lines(s).filter((l) => !/^\s*#/.test(l)).join(String.fromCharCode(10));

const OPTS = (over) => Object.assign({
    repos: ['repo-a', 'repo-b'],
    branch: 'work/the-thing',
    origin: 'https://192.168.1.5:7373',
    machine: 'kit-1',
    token: TOKEN,
    ca: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----'
}, over || {});

//---- what it must not contain -----------------------------------------------

test('the token is nowhere near a remote url', () => {
    const s = script(OPTS());

    //ONCE, AND ON THE LINE THAT FILLS THE CREDENTIAL STORE. It is written into a
    //temporary file that is then moved into place, so the line itself does not
    //name the store — which is why this checks the write and the move rather
    //than matching a filename on one line.
    const carries = lines(s).filter((l) => l.includes(TOKEN));
    assert.equal(carries.length, 1, 'the token appears ' + carries.length + ' times');
    assert.match(carries[0], /^printf .* >> "\$tmp"$/);
    assert.match(s, /mv "\$tmp" "\$HOME\/\.git-credentials"/);

    //AND THE REMOTE IS CLEAN ENOUGH TO SHOW ANYBODY.
    //
    //THE CREDENTIAL LINE IS `user:token@host` BY CONSTRUCTION — that is what a
    //git credential store holds, and it is the one place the token belongs. So
    //the claim is not "the string token@ appears nowhere"; it is that the URL
    //GIT IS GIVEN carries none. `$ORIGIN` is that URL, and every remote is built
    //from it.
    assert.match(s, /git remote set-url origin "\$url"/);
    assert.match(s, /url="\$ORIGIN\/git\/\$repo"/);
    assert.match(s, /git clone --quiet "\$url"/);

    const origin = lines(s).filter((l) => /^ORIGIN=/.test(l))[0];
    assert.equal(origin, "ORIGIN='https://192.168.1.5:7373'",
        'the origin every remote is built from carries a credential');
});

test('and the credential line is the machine as itself', () => {
    //SO A PUSH IS ATTRIBUTABLE, and a stolen line is useful for exactly one
    //machine.
    const s = script(OPTS());
    assert.match(s, /https:\/\/kit-1:okc-tok-[^@]+@192\.168\.1\.5:7373/);
});

//---- and that it is a script a shell will accept ------------------------------

test('the whole thing parses as a POSIX shell script', () => {
    //THE CHECK THAT COSTS NOTHING AND CATCHES THE MOST. A generated script with
    //an unbalanced quote is not a broken command that fails loudly — it is a
    //different command, and this is the one place it can be caught before a
    //machine runs it.
    for (const opts of [
        OPTS(),
        OPTS({ ca: null, task: null }),
        OPTS({ readOnly: true, task: 'do the thing' }),
        OPTS({ on: { 'repo-a': 'pull/13', 'repo-b': 'main' } }),
        OPTS({ repos: [] })
    ]) {
        const s = script(opts);
        try {
            execFileSync('sh', ['-n'], { input: s, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        } catch (e) {
            assert.fail('sh -n refused the script: ' + String(e.stderr || e.message) + '\n---\n' + s);
        }
    }
});

test('and it survives names a shell would have opinions about', () => {
    //A REPOSITORY OR BRANCH NAME is not something this file gets to assume the
    //shape of.
    const s = script(OPTS({
        repos: ["it's-a-repo", 'repo;rm -rf ~', 'repo $HOME'],
        branch: "work/it's; echo pwned"
    }));

    execFileSync('sh', ['-n'], { input: s, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

    //NOTHING CLOSED ITS OWN QUOTING.
    assert.equal(/^\s*rm -rf ~/m.test(s), false, 'a repository name became a command');
    assert.equal(/^\s*echo pwned/m.test(s), false, 'a branch name became a command');
});

//---- the read-only sign --------------------------------------------------------

test('a read-only machine gets a pre-push hook that says why', () => {
    //SAID HERE AS WELL AS ENFORCED ON THE HOST. The host's pre-receive hook is
    //the guard; this is so a worker finds out at the moment it tries rather than
    //at the end of an hour's work.
    const s = script(OPTS({ readOnly: true }));

    assert.match(s, /READ_ONLY='1'/);
    assert.match(s, /cat > \.git\/hooks\/pre-push/);
    assert.match(s, /refused: this machine is working in a line, read-only/);
    assert.match(s, /hand anything that has to leave back as an/);
    assert.match(s, /okc-artifact <file>/);
});

test('and one that is not has any old hook removed', () => {
    //A MACHINE THAT WAS READ-ONLY AND IS NOT ANY MORE must not keep the sign —
    //it would refuse pushes the host would now accept.
    const s = script(OPTS({ readOnly: false }));

    assert.match(s, /READ_ONLY=''/);
    assert.match(s, /rm -f \.git\/hooks\/pre-push/);
});

test('the sign is a sign, not the rule — both branches are always emitted', () => {
    //A WORKER CAN REMOVE IT: it is an ordinary file in a checkout it owns, and
    //that is fine, because removing it does not get the push through. The script
    //decides at RUN time from READ_ONLY, so the same text serves both.
    const s = script(OPTS({ readOnly: true }));
    assert.match(s, /if \[ -n "\$READ_ONLY" \]; then/);
    assert.match(s, /else\n    rm -f \.git\/hooks\/pre-push/);
});

//---- which branch, in which repository -------------------------------------------

test('one branch everywhere is the ordinary shape, and emits no case', () => {
    //EVERY EXISTING PATH THROUGH HERE IS A WORKING SETUP, and none of them
    //should change shape because reading became possible.
    const s = script(OPTS());

    assert.equal(s.includes('case "$repo" in'), false);
    assert.match(s, /branch='work\/the-thing'/);
});

test('and reading puts each repository on its own', () => {
    //THE CHANGE LIVES ON ONE BRANCH IN ONE REPOSITORY, and the others are there
    //so a judge can answer whether anything else needed changing too.
    const s = script(OPTS({ on: { 'repo-a': 'pull/13', 'repo-b': 'main' } }));

    assert.match(s, /case "\$repo" in/);
    assert.match(s, /'repo-a'\) branch='pull\/13' ;;/);
    assert.match(s, /'repo-b'\) branch='main' ;;/);
    assert.match(s, /esac/);
});

test('a case rather than a second loop, because both names go through q', () => {
    //NEITHER CAN THEN BE SPLIT on a separator that turns out to be legal in one
    //of them.
    const s = script(OPTS({ repos: ["a repo"], on: { 'a repo': "a branch" } }));
    execFileSync('sh', ['-n'], { input: s, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    assert.match(s, /'a repo'\) branch='a branch' ;;/);
});

//---- the note the machine carries --------------------------------------------------

test('what a machine is set up for is written where it keeps it', () => {
    //IT SURVIVES THE DASHBOARD RESTARTING and cannot go stale the way a registry
    //entry can — a machine reverted by hand loses the file along with the
    //workspace, which is exactly right.
    const s = script(OPTS({ task: { uid: 'u7', number: 7, branch: 'work/the-thing' } }));

    assert.match(s, /cat > "\$HOME\/\.okc-task"/);
    assert.match(s, /"uid":"u7"/);
});

test('and a machine set up for nothing has any old note removed', () => {
    const s = script(OPTS({ task: null }));
    assert.match(s, /rm -f "\$HOME\/\.okc-task"/);
    assert.equal(s.includes('.okc-task" <<'), false);
});

test('a note carrying quotes cannot end its own heredoc', () => {
    const s = script(OPTS({ task: "it's \"quoted\" and has 'both'" }));
    execFileSync('sh', ['-n'], { input: s, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
});

//---- the authority -------------------------------------------------------------------

test('the certificate is written from here rather than fetched', () => {
    //THIS SCRIPT ARRIVES OVER THE CHANNEL, which the machine already proved
    //itself on and which is itself encrypted — so it needs no fingerprint check.
    const s = script(OPTS());

    assert.match(s, /cat <<'OKC_CA_PEM' > \/tmp\/okc-ca\.pem/);
    assert.match(s, /-----BEGIN CERTIFICATE-----/);
    assert.match(s, /install -m 0644 \/tmp\/okc-ca\.pem/);
    assert.match(s, /rm -f \/tmp\/okc-ca\.pem/);
});

test('and git is pointed at it, rather than told to verify nothing', () => {
    //NOT http.sslVerify=false, which would leave git accepting any certificate
    //at all — including one belonging to whoever is between this machine and the
    //host, which is the entire thing being defended against.
    const s = script(OPTS());

    assert.match(s, /git config --global http\.sslCAInfo "\$OKC_CA_FILE"/);

    //ASKED OF WHAT WOULD RUN, not of the whole text — the script carries a
    //comment saying why sslVerify=false is NOT used, and a plain search for the
    //word finds its own explanation. A test that matches a comment is a test
    //that passes when the comment survives and the code does not.
    assert.equal(/sslVerify/.test(runs(s)), false, 'it turned certificate checking off');
});

test('no authority supplied says so rather than writing an empty one', () => {
    const s = script(OPTS({ ca: null }));
    assert.match(s, /# no authority was supplied/);
    assert.equal(s.includes('OKC_CA_PEM'), false);
});

//---- and the shell details that have bitten ------------------------------------------

test('the read-only note in the summary is shell, not a template hole', () => {
    //`${READ_ONLY:+ (read-only)}` HAS TO REACH THE SHELL AS ITSELF. In a
    //JavaScript template a dollar before a brace is an interpolation, so it has
    //to be assembled — and getting it wrong emits nothing at all, silently.
    const s = script(OPTS());
    assert.match(s, /\$\{READ_ONLY:\+ \(read-only\)\}/);
});

test('and the credential line writes a newline, not a literal backslash-n', () => {
    //`printf '%s\n'` NEEDS THE TWO CHARACTERS. Typed into a template it becomes
    //a real newline, which would end the printf and put the credential on a line
    //of its own as a command.
    const s = script(OPTS());
    const line = s.split('\n').filter((l) => l.includes('printf'))[0];

    assert.ok(line, 'there is no printf line');
    assert.match(line, /printf '%s\\n'/);
    assert.ok(line.includes(TOKEN), 'the credential is not on the printf line');
});

test('a repository that fails is skipped, and the rest carry on', () => {
    //THE UNROLLED VERSION USED `continue` OUTSIDE A LOOP, which the shell
    //refuses — so a single failure derailed the whole script instead of
    //reporting one repository and carrying on.
    const s = script(OPTS());

    assert.match(s, /^for repo in /m);
    assert.match(s, /^done$/m);
    assert.ok(s.split('\n').filter((l) => /continue/.test(l)).length >= 4);
    assert.match(s, /exit \$failed/);
});

test('nothing is run before the workspace folder exists', () => {
    const s = script(OPTS());
    assert.ok(s.indexOf('mkdir -p "$WS"') < s.indexOf('for repo in'));
    assert.ok(s.indexOf('git config --global credential.helper store') < s.indexOf('for repo in'),
        'it reached the network before git knew how to authenticate');
});

//---- where the work lives -------------------------------------------------------------

test('the folder is the machine\'s business, not this app\'s', () => {
    assert.equal(folderFor(null), FOLDER);
    assert.equal(folderFor({}), FOLDER);
    assert.equal(folderFor({ folder: '/srv/work' }), '/srv/work');

    assert.match(script(OPTS({ folder: '/srv/work' })), /WS="\/srv\/work"/);
});
