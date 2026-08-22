const { test } = require('node:test');
const assert = require('node:assert');

const { concludedIn, concludedAcross } = require('../../src/app/queue/concluding');

//---------------------------------------------------------------------------
//WHAT A JUDGE CONCLUDED.
//
//THE CLAIM WORTH THE MOST: all three vocabularies, because a reader that knows
//two of them records a judge that followed its instructions exactly as having
//reached no conclusion. That happened — RECOMMEND: NO, after three and a half
//minutes of reading and twelve thousand characters.
//
//AND THE SECOND: mapped, not kept. Downstream asks one question of this field —
//is this a rejection — and an unrecognised word reads as "not a rejection",
//which is the wrong way round for the one lane that is about somebody else's
//code arriving.
//---------------------------------------------------------------------------

//---- the three lanes -------------------------------------------------------

test('a change going out says accept or reject', () => {
    assert.equal(concludedIn('RECOMMENDATION: accept'), 'accept');
    assert.equal(concludedIn('RECOMMENDATION: reject'), 'reject');
});

test('a question about code says true, false or unclear', () => {
    assert.equal(concludedIn('CLAIM: true'), 'true');
    assert.equal(concludedIn('CLAIM: false'), 'false');
    assert.equal(concludedIn('CLAIM: unclear'), 'unclear');
});

test('a pull request that arrived says yes or no, and it means the same thing', () => {
    //THE WORD THE PROMPT ASKS FOR. Not a synonym invented here.
    assert.equal(concludedIn('RECOMMEND: YES'), 'accept');
    assert.equal(concludedIn('RECOMMEND: NO'), 'reject');
});

test('unclear stays unclear rather than becoming a rejection', () => {
    //"NOT ACCEPTED" AND "REJECTED" ARE DIFFERENT ANSWERS, and the gate reads
    //them differently.
    assert.equal(concludedIn('CLAIM: unclear'), 'unclear');
});

//---- how it is written -----------------------------------------------------

test('it is the last line of a long answer, and is still found', () => {
    const survey = ['I read three repositories.', '', 'The change is sound.', '', 'RECOMMENDATION: accept'].join('\n');
    assert.equal(concludedIn(survey), 'accept');
});

test('case and spacing are the model\'s business, not this reader\'s', () => {
    assert.equal(concludedIn('recommendation:   accept  '), 'accept');
    assert.equal(concludedIn('  Claim: TRUE'), 'true');
});

//---- and what is NOT a conclusion ------------------------------------------

test('a paragraph discussing whether to accept concludes nothing', () => {
    //ANCHORED TO A WHOLE LINE. A reader that matched mid-sentence would file a
    //discussion as a verdict.
    assert.equal(concludedIn('My RECOMMENDATION: accept it only if the tests pass first.'), null);
    assert.equal(concludedIn('I would recommend: accept, but see below'), null);
});

test('a word it cannot act on is no conclusion, not a guess', () => {
    assert.equal(concludedIn('RECOMMENDATION: maybe'), null);
    assert.equal(concludedIn('CLAIM: probably'), null);
});

test('a verdict line a person wrote is not a judge concluding', () => {
    //`VERDICT:` IS THE PERSON'S WORD, recorded separately and by a different
    //act. ../judge/judgements.js shows it; this must not record it as the
    //judge's own answer.
    assert.equal(concludedIn('VERDICT: accept'), null);
});

test('nothing, and nothing readable, are both null', () => {
    assert.equal(concludedIn(''), null);
    assert.equal(concludedIn(null), null);
    assert.equal(concludedIn(undefined), null);
    assert.equal(concludedIn('it read the change and said nothing about it'), null);
});

//---- across everything that came back --------------------------------------

test('the first file that concludes anything is the answer', () => {
    const files = { 'survey.md': 'a lot of prose', 'verdict.md': 'RECOMMENDATION: reject', 'notes.md': 'CLAIM: true' };
    const got = concludedAcross(
        [{ file: 'survey.md' }, { file: 'verdict.md' }, { file: 'notes.md' }],
        (f) => files[f]);

    //READING ON PAST THE FIRST would let a later file's discussion overwrite it.
    assert.equal(got, 'reject');
});

test('a file that cannot be read is skipped, not fatal', () => {
    const got = concludedAcross(
        [{ file: 'gone.md' }, { file: 'verdict.md' }],
        (f) => { if (f === 'gone.md') throw new Error('it is not there'); return 'RECOMMEND: NO'; });

    assert.equal(got, 'reject', 'one unreadable file lost a conclusion sitting in the next one');
});

test('nothing handed back is no conclusion', () => {
    assert.equal(concludedAcross([], () => ''), null);
    assert.equal(concludedAcross(null, () => ''), null);
});

test('files that say nothing are no conclusion, not an empty string', () => {
    //`null` AND `''` ARE DIFFERENT DOWNSTREAM: one is "it would not say", the
    //other is a value.
    assert.strictEqual(concludedAcross([{ file: 'a' }], () => 'prose'), null);
});
