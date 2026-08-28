const { test } = require('node:test');
const assert = require('node:assert');

const allowed = require('../../src/app/supervisor/allowed');

//---------------------------------------------------------------------------
//ANSWERING AN ISSUE IS THE DIRECTION THAT LEAVES THIS HOST.
//
//Everything else about GitHub here reads. This writes, on somebody else's
//repository, under this host's token — so whoever sees it reads it as the
//person who owns the token having said it.
//
//WHAT IS ASSERTED HERE IS THE SHAPE OF THE PERMISSION, not the HTTP. The calls
//themselves are covered against a live GitHub by hand and by ../repositories;
//what a unit test can hold is the thing most likely to rot: which names a model
//may reach, and which it may not.
//---------------------------------------------------------------------------

test('the supervisor may write an answer and may not release one', () => {
    //THE WHOLE DESIGN IN ONE ASSERTION. A draft that the thing which wrote it
    //can also approve is not a draft; it is a post with extra steps.
    assert.equal(allowed.may('issueSay'), true);
    assert.equal(allowed.may('issueClose'), true);

    assert.equal(allowed.may('issueApprove'), false,
        'a model can release its own words, so the approval step is decoration');
    assert.equal(allowed.may('issueDiscard'), false);
});

test('and may see what is already waiting, so it does not write it twice', () => {
    //A READ. Without it, a supervisor that wrote a draft an hour ago and was
    //restarted has no way to know, and writes the same reply again — which a
    //person then reads twice and approves once, wondering what happened to the
    //other one.
    assert.equal(allowed.may('issueDrafts'), true);
});

test('the reading verbs are on the list and the old dead ones are not', () => {
    assert.equal(allowed.may('issues'), true);
    assert.equal(allowed.may('issueRead'), true);
    //`pulls` IS STILL UNPORTED, and saying so here keeps the note at the foot of
    //allowed.js honest: a name on that list is an MCP tool in front of a model,
    //so an unported verb is not a refusal, it is a tool that answers nothing.
    assert.equal(allowed.may('pulls'), false);
});

test('every name on the list is a name, not a sentence', () => {
    //A CHEAP GUARD ON A FILE THAT IS EDITED BY HAND. A key with a space in it,
    //or a stray comment un-commented, becomes a tool nothing answers — and the
    //failure is a model being handed a tool that fails when it is used rather
    //than a list that fails to load.
    Object.keys(allowed.list || {}).forEach((name) => {
        assert.match(name, /^[a-z][A-Za-z0-9]*$/, name + ' is not shaped like an action');
    });
});
