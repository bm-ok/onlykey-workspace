const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const AT = path.join(__dirname, '..', '..', 'src', 'app', 'vms', 'provision',
    'scripts', 'autoinstall-user-data');

//---------------------------------------------------------------------------
//THE AUTOINSTALL TEMPLATE'S CONDITIONALS HAVE TO BALANCE.
//
//VBoxManage FILLS THIS FILE IN AND SCANS IT AS TEXT. It has never heard of a
//YAML `#`, so every VBOX_COND marker counts whether it is commented out or not,
//and an unmatched one is not a warning: the install does not start at all.
//
//    VBoxManage.exe: error: Missing (COND_END)
//    code E_FAIL (0x80004005), component UnattendedWrap, interface IUnattended
//
//THE MACHINE IS ALREADY GONE BY THEN. `vmRebuild` unregisters and deletes the
//old one before it makes the new one, so a template that cannot be parsed
//leaves a created-but-never-installed shell and nothing to go back to. That is
//what makes this worth a test rather than a careful read.
//
//AND IT WAS BROKEN TWICE IN FIVE MINUTES, BY A COMMENT ABOUT ITSELF. Removing
//the `packages:` block left a note explaining what had gone -- and the note
//named the conditional it was about, delimiters and all, which is an opener
//with no end. The fix for that quoted the error message above verbatim, which
//is an end with no opener. Neither is visible to a reader who knows YAML; both
//stop every install on the host.
//
//SO THE RULE IS: no marker in a comment carries its delimiters. This test does
//not enforce that spelling -- it enforces the thing that spelling protects,
//which is what a rule should hold.
//---------------------------------------------------------------------------

const OPEN = /@@VBOX_COND_(?!END@@|ELSE@@)[A-Z_]+@@/g;

function markers(text) {
    return text.match(/@@VBOX_COND[A-Z_]*@@/g) || [];
}

test('every conditional in the autoinstall template is closed', () => {
    const text = fs.readFileSync(AT, 'utf8');
    const all = markers(text);

    //INERTNESS FIRST. A template that has stopped using conditionals at all
    //would pass every assertion below having proved nothing, and this file is
    //exactly the kind that gets rewritten wholesale.
    assert.ok(all.length >= 6, 'only ' + all.length + ' conditional markers were found');

    let depth = 0;
    all.forEach((m) => {
        if (m === '@@VBOX_COND_END@@') depth -= 1;
        else if (m !== '@@VBOX_COND_ELSE@@') depth += 1;

        //AN END BEFORE ITS OPENER is the other way to be unbalanced, and a
        //count of each would not catch it.
        assert.ok(depth >= 0, 'a COND_END appears before anything it could close');
    });

    assert.equal(depth, 0, 'the template ends inside ' + depth + ' unclosed conditional(s)');
});

test('an ELSE only appears inside a conditional', () => {
    const text = fs.readFileSync(AT, 'utf8');

    let depth = 0;
    markers(text).forEach((m) => {
        if (m === '@@VBOX_COND_ELSE@@') {
            assert.ok(depth > 0, 'a COND_ELSE appears outside any conditional');
            return;
        }
        depth += m === '@@VBOX_COND_END@@' ? -1 : 1;
    });
});

test('nothing asks the installer to fetch packages', () => {
    //THE FAILURE THIS FILE WAS CHANGED FOR. A live-server install has no
    //package index but the CD's, so a `packages:` list resolves to
    //`E: Unable to locate package ...` and exit 100 -- which reads as a
    //download failure and is not one. Everything this app puts on a machine is
    //installed after boot by ./toolchain.sh and ./desktop.sh, where apt works.
    //
    //THE KEY AT COLUMN ZERO OR TWO, not the word anywhere: the note in that
    //file discusses `packages:` at length and must go on being allowed to.
    const lines = fs.readFileSync(AT, 'utf8').split('\n');
    const asks = lines.filter((l) => /^\s{0,4}packages:/.test(l));

    assert.deepEqual(asks, [],
        'the template asks the installer for packages: ' + asks.join(' | '));
});
