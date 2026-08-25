const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const outline = require('../../src/app/tests/outline');

//---------------------------------------------------------------------------
//the catalogue, and whether it still describes this app.
//
//A GENERATED FILE NOBODY REGENERATES IS WORSE THAN NO FILE. It is a list of
//claims about this app that used to be right, read by somebody with no reason to
//doubt it — and `outline.md` is the closest thing here to a specification: every
//suite, test and check, in the order a person uses the app.
//
//SO A STALE OUTLINE IS A FAILING TEST rather than a thing to remember, and the
//fix it prints is the whole fix. That is the only reason this file exists; there
//is no interesting arithmetic in it.
//
//IT IS ALSO THE CHEAPEST WAY TO NOTICE A SUITE THAT STOPPED LOADING. `build()`
//reads the REGISTRY, not the files, so a drill file that throws on require
//registers nothing and the counts move — where a version that grepped for `it(`
//would go on printing a file that had stopped working.
//---------------------------------------------------------------------------

test('the outline still matches the suites that register', () => {
    const made = outline.build();
    const there = fs.existsSync(outline.FILE) ? fs.readFileSync(outline.FILE, 'utf8') : '';

    assert.equal(outline.flat(there), outline.flat(made.text),
        'src/app/tests/outline.md no longer matches the suites. Update it:\n'
        + '       node src/app/tests/outline.js --write');
});

//---------------------------------------------------------------------------
//AND A `requires()` THAT NAMES NOTHING IS A BROKEN EDGE THAT BREAKS SILENTLY.
//
//Suites are matched by NAME. Rename a folder and every `requires()` pointing at
//the old one simply stops finding anything — no error, no warning, and dirt
//quietly stops spreading to the suites that were relying on it. Which is the
//failure mode where a green board means less than it did the day before.
//---------------------------------------------------------------------------
test('every suite stands on one that exists', () => {
    const made = outline.build();
    assert.deepEqual(made.broken, [],
        'a suite requires something no suite provides, so the edge points at nothing');
});

//---------------------------------------------------------------------------
//AND IT COUNTED SOMETHING.
//
//The inertness guard the rest of this suite keeps. `build()` throws when the
//folders and the registry disagree, so the dangerous shape is not an exception —
//it is both halves quietly going to zero, which would make the two checks above
//pass by describing nothing.
//---------------------------------------------------------------------------
test('and it is describing an app rather than nothing', () => {
    const made = outline.build();
    assert.ok(made.suites >= 8, `only ${made.suites} suites registered`);
    assert.ok(made.checks >= 100, `only ${made.checks} checks registered`);
});
