const { test } = require('node:test');
const assert = require('node:assert');

const chain = require('../../src/app/library/chain');

//---------------------------------------------------------------------------
//    task <- job <- prompt <- contract
//
//WHETHER A CHAIN COULD RUN RIGHT NOW. These rules decide whether something a
//person has not read is handed to a machine, so they are worth exercising
//against literals rather than only through a library with three stores behind
//it.
//
//THE CLAIM THAT MATTERS: three things are approved, not two, and the third
//arrives through the second. A job asks its PROMPT whether it is usable rather
//than reaching past it to the contract — so the chain points one way and there
//is one place that knows how the links join.
//---------------------------------------------------------------------------

const contract = (extra) => Object.assign({ id: 'read-only', name: 'read only', approved: true, kind: 'task' }, extra || {});
const prompt = (extra) => Object.assign({ id: 'p1', name: 'the brief', approved: true, lapsed: false, kind: 'task', contractId: 'read-only' }, extra || {});
const job = (extra) => Object.assign({ id: 'j1', name: 'the job', approved: true, lapsed: false, there: true, kind: 'task', promptId: 'p1' }, extra || {});

const resolve = (j, p, c) => chain.jobsWith(j, chain.promptsWith(p, c));

//---------------------------------------------------------------------------
//THE WHOLE CHAIN, END TO END.
//---------------------------------------------------------------------------

test('everything approved is runnable, and says nothing is wrong', () => {
    const [it] = resolve([job()], [prompt()], [contract()]);

    assert.equal(it.runnable, true);
    assert.equal(it.whyNot, null);
    assert.deepEqual(it.prompt, { id: 'p1', name: 'the brief', approved: true, usable: true, whyNot: null });
});

test('a contract that is not approved stops the job, two links away', () => {
    const [it] = resolve([job()], [prompt()], [contract({ approved: false })]);

    assert.equal(it.runnable, false);
    //SAID IN FULL. "Its prompt is not usable" would send somebody to the prompt
    //to find it perfectly fine, with the actual fault mentioned nowhere they
    //were sent.
    assert.match(it.whyNot, /its prompt "the brief" runs under a contract that is not ready/);
    assert.match(it.whyNot, /its contract "read only" is not approved/);
});

test('a prompt that is not approved says so, without mentioning contracts', () => {
    const [it] = resolve([job()], [prompt({ approved: false })], [contract()]);

    assert.equal(it.runnable, false);
    assert.equal(it.whyNot, 'its prompt "the brief" is not approved');
});

test('a job that is not approved is the first thing said, not the last', () => {
    //ITS OWN FAULT BEFORE ANYTHING ELSE'S. A reader sent down the chain for a
    //fault that is right here has been sent the wrong way.
    const [it] = resolve([job({ approved: false })], [prompt({ approved: false })], [contract({ approved: false })]);
    assert.equal(it.whyNot, 'not approved');
});

test('a missing script outranks everything, because nothing can run', () => {
    const [it] = resolve([job({ there: false, approved: false })], [prompt()], [contract()]);
    assert.equal(it.whyNot, 'its script is missing');
    assert.equal(it.runnable, false);
});

test('edited since approved is its own sentence, not "not approved"', () => {
    const [it] = resolve([job({ approved: false, lapsed: true })], [prompt()], [contract()]);
    assert.equal(it.whyNot, 'edited since it was approved');

    const [p] = chain.promptsWith([prompt({ approved: false, lapsed: true })], [contract()]);
    assert.equal(p.whyNot, 'edited since it was approved');
});

//---------------------------------------------------------------------------
//A LINK THAT HAS GONE IS NOT A LINK THAT WAS NEVER THERE.
//---------------------------------------------------------------------------

test('a prompt pointing at a contract that was forgotten says it is gone', () => {
    const [p] = chain.promptsWith([prompt()], []);

    assert.equal(p.missingContract, true);
    assert.equal(p.usable, false);
    assert.equal(p.whyNot, 'its contract is gone');
});

test('a job pointing at a prompt that was forgotten says it is gone', () => {
    const [it] = resolve([job()], [], []);

    assert.equal(it.missingPrompt, true);
    assert.equal(it.runnable, false);
    assert.equal(it.whyNot, 'its prompt is gone');
});

test('a prompt under NO contract is usable on its own', () => {
    const [p] = chain.promptsWith([prompt({ contractId: null })], []);

    assert.equal(p.usable, true);
    assert.equal(p.missingContract, false);
    assert.equal(p.contract, null);
    assert.equal(p.whyNot, null);
});

test('a job with NO prompt is runnable on its own', () => {
    const [it] = resolve([job({ promptId: null })], [], []);

    assert.equal(it.runnable, true);
    assert.equal(it.missingPrompt, false);
    assert.equal(it.prompt, null);
});

//---------------------------------------------------------------------------
//WHAT A MACHINE MAY BE OFFERED.
//---------------------------------------------------------------------------

test('something set aside is kept from a machine and shown to a person', () => {
    const rows = [job(), job({ id: 'j2', setAside: true })];

    //"WHAT IS HERE" AND "WHAT MAY BE USED" ARE DIFFERENT QUESTIONS, and the
    //second one is the guest's.
    assert.equal(chain.offeredTo(rows, { fromMachine: true }).length, 1);
    assert.equal(chain.offeredTo(rows, {}).length, 2);
    assert.equal(chain.offeredTo(rows).length, 2);
});

test('absent means in use here too', () => {
    const rows = [job()];
    assert.equal(rows[0].setAside, undefined);
    assert.equal(chain.offeredTo(rows, { fromMachine: true }).length, 1);
});

//---------------------------------------------------------------------------
//TWO LIBRARIES, ASKED FOR BY NAME.
//---------------------------------------------------------------------------

test('nothing said returns both, so a plain listing never hides half of what exists', () => {
    const rows = [job(), job({ id: 'j2', kind: 'judge' })];

    assert.equal(chain.ofKind(rows).length, 2);
    assert.equal(chain.ofKind(rows, undefined).length, 2);
    assert.equal(chain.ofKind(rows, '').length, 2);
});

test('and asking by name gives one, with every row carrying its kind either way', () => {
    const rows = [job(), job({ id: 'j2', kind: 'judge' })];

    assert.deepEqual(chain.ofKind(rows, 'task').map(r => r.id), ['j1']);
    assert.deepEqual(chain.ofKind(rows, 'judge').map(r => r.id), ['j2']);
    //ANYTHING THAT IS NOT judge IS task — see the store.
    assert.deepEqual(chain.ofKind(rows, 'nonsense').map(r => r.id), ['j1']);
});

//---------------------------------------------------------------------------
//THE LIST IS READ AS A LIST.
//---------------------------------------------------------------------------

test('the code is not carried in a listing, but how long it is, is', () => {
    const [it] = chain.jobsWith([job({ code: 'a\nb\nc' })], [prompt()], {
        lines: (j) => String(j.code || '').split('\n').length
    });

    assert.equal(it.code, undefined, 'a listing carried the whole script');
    assert.equal(it.lines, 3);
});
