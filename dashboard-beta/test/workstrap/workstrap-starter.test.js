const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const AT = path.join(__dirname, '..', '..', 'src', 'app', 'workstrap', 'starter', 'workspace_claude.md');
const BOOT = path.join(__dirname, '..', '..', 'src', 'app', 'vms', 'provision', 'scripts', 'normal-boot.sh');
const GUESTAPI = path.join(__dirname, '..', '..', 'src', 'app', 'workstrap', 'guestapi.js');

//---------------------------------------------------------------------------
//THE STARTER IS SHIPPED, SO IT IS EVERY WORKSPACE'S FIRST WORDS.
//
//It goes into okc-bootstrap.tar and into the app's own bundle, which means a
//workspace that has never been written up gets this text and nothing else. That
//makes it one of the few documents here that has to be true of a project nobody
//has seen yet.
//---------------------------------------------------------------------------

test('the starter names no project, because every workspace gets it', () => {
    //THE DRIFT THIS GUARDS HAS ALREADY HAPPENED ONCE, in a delivery contract
    //and a supervisor skill: a rule about GitHub's behaviour went in naming the
    //repositories it happened to be found on, and both files ship in the tar. A
    //fresh workspace would have opened with a contract citing somebody else's
    //project and an incident that never happened to them.
    //
    //THE STARTER IS THE MOST EXPOSED FILE OF THE LOT, because it is addressed to
    //a reader who has just arrived and has no way to tell a general instruction
    //from a leftover.
    const text = fs.readFileSync(AT, 'utf8');
    const named = text.match(/onlykey|trustcrypto|bm-ok|romanz|trezor|teensy|lib-agent/gi) || [];

    assert.deepEqual(named, [],
        'the starter names a specific project: ' + named.join(', '));
});

test('and it asks to be filled in, which is the whole point of shipping it', () => {
    //A TEMPLATE THAT ONLY HAS HEADINGS gets skimmed and left. What makes this
    //one work is that it says what the file is FOR and that filling it in is
    //part of the work — so the first machine to learn something has been told,
    //before it learns it, where to put it.
    const text = fs.readFileSync(AT, 'utf8');

    assert.match(text, /finalis/i, 'nothing about getting the workspace ready to run');
    assert.match(text, /test/i, 'nothing about how to test');
    assert.match(text, /run/i, 'nothing about how to run it');

    //AND THE ONE RULE IT MUST CARRY. This file is shared between machines and is
    //read by everything that opens the workspace, so a secret written into it is
    //a secret handed to every guest.
    assert.match(text, /secret/i, 'the starter does not say to keep secrets out of it');
});

test('every machine is given it at boot, and a failed fetch never stops the boot', () => {
    const boot = fs.readFileSync(BOOT, 'utf8');

    assert.match(boot, /workstrap/, 'normal-boot.sh does not fetch the workspace notes');
    assert.match(boot, /workspace\/CLAUDE\.md/, 'the notes are not written where a guest will read them');

    //WRITTEN ASIDE AND MOVED. A fetch that dies halfway must leave the notes
    //that were already there rather than half a document — a truncated
    //CLAUDE.md is worse than a stale one, because it reads as complete.
    assert.match(boot, /CLAUDE\.md\.new/, 'the notes are written straight over the live file');

    //NEVER FATAL. A machine with no notes can still do its work; one that
    //refused to finish booting over a missing document could not. `set -u` is on
    //in that script, so an unguarded failure would be the end of the boot.
    const block = boot.slice(boot.indexOf('workstrap'));
    assert.match(block, /carrying on without them/,
        'a failed fetch does not say it is carrying on, so it probably is not');
});

test('the tar the repository ships carries the starter, not a workspace\'s own notes', () => {
    //THE DRIFT THIS EXISTS TO CATCH, AND IT HAS ALREADY HAPPENED ONCE: a
    //delivery contract and a supervisor skill went into this tar naming the
    //repositories they happened to be found on, so a fresh workspace would have
    //opened carrying somebody else's project.
    //
    //NOTES ARE THE MOST LIKELY TO REPEAT IT, because being project-specific is
    //their whole job. `bootstrapShip` rewrites the committed tar and asks for
    //the starter deliberately; `bootstrapFile`, which is somebody keeping their
    //own set, carries what their workspace actually says. One line apart, and
    //only one of them is committed.
    const tar = fs.readFileSync(path.join(__dirname, '..', '..', 'okc-bootstrap.tar'));
    const starter = fs.readFileSync(AT, 'utf8');

    //READ OUT OF THE TAR BY HAND rather than with a library: it is a plain
    //ustar archive of small text files, and pulling one entry out is a header
    //walk. A test that needed a dependency to check the shipped artifact is one
    //that gets skipped.
    let at = 0;
    let found = null;
    while (at + 512 <= tar.length) {
        const name = tar.slice(at, at + 100).toString('utf8').replace(/\0.*$/, '');
        const size = parseInt(tar.slice(at + 124, at + 136).toString('utf8').replace(/\0.*$/, '').trim() || '0', 8);
        if (!name) break;
        if (name === 'workspace_claude.md') {
            found = tar.slice(at + 512, at + 512 + size).toString('utf8');
            break;
        }
        at += 512 + Math.ceil(size / 512) * 512;
    }

    assert.ok(found, 'the shipped tar carries no workspace notes at all');
    assert.equal(found, starter,
        'the shipped tar carries notes that are not the starter — most likely one workspace\'s own, '
            + 'which every new workspace would then open with');
});

test('a supervisor may not read it, and the three that open the code may', () => {
    //THE SUPERVISOR CANNOT SEE THE CODE. That is the design and its own skill
    //leads with it — so it has no workspace to finalise, no tests to run and
    //nothing to build, and this document is about nothing else. Handing it over
    //would give the one role deliberately kept away from the code a file
    //entirely about the code, which it would then reason from.
    //
    //THE SAME FENCE ../runners/handback KEEPS, and worth a test for the same
    //reason: widening it is one word, and nothing else here would notice.
    const guestapi = require('../../src/app/workstrap/guestapi');
    const door = guestapi({ read: async () => ({ text: '', mine: false }), say: () => ({ warn() {} }) });

    const asked = (tags) => door.may({ name: 'a-machine', tags: tags });

    assert.equal(asked(['supervisor']), false, 'a supervisor was given the workspace notes');
    assert.equal(asked(['worker']), true);
    assert.equal(asked(['judge']), true);
    assert.equal(asked(['diy']), true);

    //A MACHINE THAT IS BOTH does both, one at a time — ../vms/ours/roles
    //answers membership rather than equality, which is why this is asked
    //through it rather than by reading the tag list here.
    assert.equal(asked(['worker', 'judge']), true);

    //AND AN UNLABELLED BOX IS NOT A ROLE. It gets no credential either, for the
    //same reason: silence is not an answer.
    assert.equal(asked([]), false);
});

test('the guest door offers one document and no way to name another', () => {
    //THE REASON THIS PLUGIN HAS A ROUTE OF ITS OWN. `/provision/*` resolves
    //whatever name it is given against a search path, which is right for a
    //folder of scripts written to be handed out — and would serve
    //machines.json, github-drafts.json, meter.json and every contract the moment
    //the root of `.okc` were added to it. The notes live at that root, so they
    //get one route that takes no argument at all.
    const src = fs.readFileSync(GUESTAPI, 'utf8');
    const paths = (src.match(/path: '[^']+'/g) || []);

    assert.deepEqual(paths, ["path: '/workstrap'"],
        'the workstrap door offers more than the one document: ' + paths.join(', '));

    assert.ok(!/\*/.test(paths.join('')), 'the route takes a wildcard, so a guest can name a file');
});
