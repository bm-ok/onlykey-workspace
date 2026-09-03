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
