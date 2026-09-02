const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', 'src', 'app');
const cli = require(path.join(APP, 'judge', 'cli.js'));

//---------------------------------------------------------------------------
//HOW A JUDGEMENT'S FILES PRINT, PINNED TO WHAT THE ACTION ACTUALLY ANSWERS.
//
//WRITTEN BECAUSE IT BROKE AND NOTHING NOTICED. `judgementFindings` stopped
//folding the judgement's own facts in beside the files — `reads`, `state` and
//`verdict` are `judging`'s to answer — and the printer went on reading them. It
//printed:
//
//    J4  undefined  undefined
//
//NOTHING FAILED. Reading a missing field off an object is `undefined`, and
//`'  ' + undefined` is a perfectly good string. `npm run check` was green, 2841
//tests were green, and the only sign was the word on the line — seen because
//somebody ran the command and read the output.
//
//THE FOURTH HALF HAD NO TESTS AT ALL. `main.js`, `server.js` and `window.js` are
//covered; `cli.js` is where an answer becomes something a person reads, and it
//was the one half nothing exercised.
//
//---- so the shapes here are COPIED FROM THE ACTION, not invented -------------
//
//Both are what ../../src/app/judge/server.js returns from `judgementFindings`:
//the list form and the one-file form. If either grows a field this printer wants,
//it is added here first and the test says why.
//---------------------------------------------------------------------------

//WHAT THE ACTION ANSWERS WITH, LISTING WHAT WAS HANDED BACK.
//
//TWO NAMES PER FILE AND THEY ARE NOT INTERCHANGEABLE. A file is kept as
//`<run>--<name>`, so `file` is what is on disk and `name` is what the job was
//TOLD to write. Show the second; ask by the first.
//
//THE FIRST VERSION OF THIS FIXTURE HAD ONLY THE ON-DISK NAME, copied from what
//the action answered at the time — and the test failed, correctly, because the
//printer fits a name into forty columns and the run prefix is thirty-four of
//them. It printed `job-check-a-claim-20260902211533--CLAI…`: everything except
//the part somebody needs in order to ask for it.
const A_LIST = {
    ref: 'J4',
    files: [{
        name: 'CLAIM.md',
        file: 'job-check-a-claim-20260902211533--CLAIM.md',
        bytes: 5310,
        kept: '2026-09-02T21:16:04.000Z'
    }],
    note: 'Ask again with a file name to read one in full.'
};

//AND READING ONE IN FULL.
const A_FILE = {
    ref: 'J4',
    file: 'job-check-a-claim-20260902211533--CLAIM.md',
    bytes: 5310,
    text: '# The claim\n\nCLAIM: true\n'
};

function printed(said) {
    return cli.print.judgementFindings(said);
}

test('listing what was handed back names no field the action does not answer', () => {
    const out = printed(A_LIST);

    //THE WHOLE POINT OF THIS FILE. A printer reading a field that is not there
    //puts the word in front of somebody rather than failing.
    assert.ok(!/undefined/.test(out),
        'the printer read a field judgementFindings does not answer with:\n' + out);
    assert.ok(!/\[object Object\]/.test(out),
        'the printer concatenated an object into a line:\n' + out);

    //AND IT SAYS THE THINGS SOMEBODY ASKED FOR.
    assert.ok(out.includes('J4'), 'which judgement these belong to is not on the answer');
    assert.ok(/1 file\(s\)/.test(out), 'how many files came back is not said: ' + out);
    assert.ok(out.includes('CLAIM.md'), 'the file is not named');
    assert.ok(out.includes('5 KB'), 'the size is not said, so nothing warns before reading a large one');
    assert.ok(out.includes(A_LIST.note), 'the note telling somebody how to read one is missing');
});

test('reading one in full names no missing field either', () => {
    const out = printed(A_FILE);

    assert.ok(!/undefined/.test(out),
        'the one-file form read a field the action does not answer with:\n' + out.slice(0, 200));
    assert.ok(!/\[object Object\]/.test(out), 'an object was concatenated into a line');

    assert.ok(out.includes('J4'));
    assert.ok(out.includes('CLAIM.md'));

    //THE FILE ITSELF, WHICH IS WHAT WAS ASKED FOR. A header with no body would be
    //this printer answering a different question.
    assert.ok(out.includes('CLAIM: true'), 'the file body did not print');
});

test('a judgement that handed nothing back prints its reason and no blank columns', () => {
    //THE ORDINARY EMPTY CASE, and it is a real answer rather than a gap: a judge
    //that read the change and found nothing has said something.
    const out = printed({
        ref: 'J9',
        files: [],
        note: 'It read the change and handed nothing back. That is an answer.'
    });

    assert.ok(!/undefined/.test(out), 'the empty case prints undefined:\n' + out);
    assert.ok(/0 file\(s\)/.test(out), 'the count is not said when it is zero: ' + out);
    assert.ok(out.includes('That is an answer'), 'the reason is not printed');
});
