const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const concluding = require('../../src/app/queue/concluding');

const SKILL = path.join(__dirname, '..', '..', 'src', 'app', 'vms', 'provision', 'scripts', 'judge-skill.md');
const text = fs.readFileSync(SKILL, 'utf8');

//---------------------------------------------------------------------------
//WHAT A JUDGE IS TOLD TO WRITE, AGAINST WHAT THIS APP CAN READ.
//
//THE DOCUMENT AND THE PARSER ARE TWO HALVES OF ONE AGREEMENT and nothing held
//them together. The skill said to give a conclusion "in plain words" and offered
//`accept`, `reject`, `pending` — and `pending` is not a word any lane of
//../../src/app/queue/concluding.js accepts, and none of the three carried the
//prefix that reader anchors on. A judge following it exactly would have been
//recorded as having concluded nothing.
//
//WHICH HAS ALREADY HAPPENED ONCE, to the earlier reader: a judgement that read
//for three and a half minutes and wrote twelve thousand characters ended in
//`RECOMMEND: NO`, which the reader of the day did not know, and was filed as
//reaching no conclusion. The comment at the top of concluding.js is about that.
//
//SO THE EXAMPLES IN THE SKILL ARE RUN THROUGH THE REAL READER. If somebody
//edits either half, this fails rather than a judgement quietly meaning nothing.
//---------------------------------------------------------------------------

//EVERY LINE THE SKILL PRESENTS AS A CONCLUSION TO WRITE. Taken out of the
//indented block, which is how the document offers them.
function offered() {
    return text.split('\n')
        .map((l) => l.trim())
        .filter((l) => /^(RECOMMENDATION|CLAIM|RECOMMEND):/.test(l));
}

test('the skill offers conclusions at all, so this is not passing on an empty list', () => {
    assert.ok(offered().length >= 7, 'found ' + offered().length + ' conclusion lines in the skill');
});

test('every conclusion the skill tells a judge to write is one this app can read', () => {
    for (const line of offered()) {
        const said = concluding.concludedIn ? concluding.concludedIn(line) : null;
        assert.ok(said, 'the skill tells a judge to write "' + line + '" and nothing reads it');
    }
});

test('the three lanes each land on a value the app acts on', () => {
    //`RECOMMEND: yes|no` IS MAPPED rather than kept — downstream asks one
    //question, is this a rejection, and a lane whose words it does not know
    //reads as "not a rejection", which is the wrong way round.
    assert.equal(concluding.concludedIn('RECOMMENDATION: accept'), 'accept');
    assert.equal(concluding.concludedIn('RECOMMENDATION: reject'), 'reject');
    assert.equal(concluding.concludedIn('RECOMMEND: yes'), 'accept');
    assert.equal(concluding.concludedIn('RECOMMEND: no'), 'reject');
    assert.equal(concluding.concludedIn('CLAIM: unclear'), 'unclear');
});

test('the skill does not offer a word the reader has never accepted', () => {
    //`pending` READ AS AN INSTRUCTION IS WORSE THAN NO INSTRUCTION: it is
    //plausible, it is what a careful judge would want to say, and it files as
    //nothing at all.
    assert.doesNotMatch(text, /^\s*(RECOMMENDATION|CLAIM|RECOMMEND):\s*pending/im);
});

test('and it says the line must be exactly that, since a sentence about it is not one', () => {
    //THE READER ANCHORS TO A WHOLE LINE ON PURPOSE, so a paragraph discussing
    //whether to recommend acceptance is not filed as having recommended it. A
    //skill that did not say so would produce judgements that read perfectly and
    //conclude nothing.
    assert.equal(concluding.concludedIn('I would recommend: accept, on balance'), null);
    assert.match(text, /on its own line/i);
});
