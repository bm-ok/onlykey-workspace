const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const makeArchive = require('../../src/app/queue/archive');

//---------------------------------------------------------------------------
//WHAT A RUN SAID, KEPT AFTER THE MACHINE IT SAID IT ON IS GONE.
//
//`taskProgress` and `judgementFindings` answer WHAT HAPPENED. This drawer is
//the only thing that answers WHY — the transcript of the run itself, fetched
//off the machine before it is put away precisely so the question can be asked
//once the machine has been rolled back.
//
//IT WAS BEING FILLED FOR A READER THAT DID NOT EXIST. Every run's output has
//been kept here since the queue was ported, and no door opened it: `taskLog`
//and `judgementLog` were on the supervisor's tool list and answered nothing.
//
//AND THE COST WAS ALREADY PAID. J26 came back empty on 27 August because the
//runner started `claude` with no input and gave up in sixteen seconds. From
//outside that is identical to a judge that read the change and found nothing —
//and the second is an answer, while the first is a machine fault that happens
//again on the next attempt. The transcript said so in one line.
//---------------------------------------------------------------------------

let at, archive, redacted;

beforeEach(() => {
    at = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-logs-'));
    redacted = [];
    archive = makeArchive(
        () => at,
        //THE REDACTION IS HANDED IN rather than reached for, and this records
        //that it was ASKED — see the note in ../../src/app/queue/server.js: this
        //is the boundary where a machine's output stops being a moment and
        //becomes a filing, so it is the one place a token must not survive.
        (text) => { redacted.push(text); return String(text).split('sk-ant-secret').join('[redacted]'); }
    );
});

test('nothing kept reads as nothing kept, and not as an empty log', () => {
    assert.deepEqual(archive.list('task-1'), []);

    const one = archive.read('task-1', 'run-1', {});
    //`found: false` AND A REASON, rather than a throw or an empty string. An
    //empty string is what a run that printed nothing looks like, and those are
    //different answers to the question being asked.
    assert.equal(one.found, false);
    assert.match(one.why, /nothing was kept/i);
});

test('what a run said comes back, and the tail is the end of it', () => {
    archive.keep('task-1', 'run-1', { output: 'one\ntwo\nthree\nfour\nfive\n', machine: 'runner-1', exit: 0 });

    const kept = archive.list('task-1');
    assert.equal(kept.length, 1);
    assert.equal(kept[0].run, 'run-1');
    assert.ok(kept[0].bytes > 0);

    const one = archive.read('task-1', 'run-1', { lines: 2 });
    assert.equal(one.found, true);
    assert.equal(one.lines, 6);
    //THE TAIL, BECAUSE OUTPUT ENDS WITH WHAT HAPPENED. A run that died says so
    //in its last line, and the first two hundred lines are the toolchain.
    assert.match(one.text, /five/);
    assert.doesNotMatch(one.text, /^one$/m);
});

test('a token in a machine\'s output does not become a file on this host', () => {
    archive.keep('task-1', 'run-1', { output: 'signing in with sk-ant-secret now\n' });

    assert.ok(redacted.length, 'the output was filed without being offered for redaction');
    const one = archive.read('task-1', 'run-1', {});
    assert.doesNotMatch(one.text, /sk-ant-secret/);
    assert.match(one.text, /\[redacted\]/);
});

test('two attempts at one thing are two runs, not one overwritten', () => {
    archive.keep('task-1', 'run-1', { output: 'first attempt\n', exit: 1 });
    archive.keep('task-1', 'run-2', { output: 'second attempt\n', exit: 0 });

    //THE FIRST ATTEMPT IS THE EVIDENCE when the second one worked and nobody
    //knows why the first did not.
    assert.equal(archive.list('task-1').length, 2);
    assert.match(archive.read('task-1', 'run-1', {}).text, /first/);
    assert.match(archive.read('task-1', 'run-2', {}).text, /second/);
});

test('a judgement and a task are two drawers, keyed by what holds the uid', () => {
    //ONE DRAWER, TWO KINDS. A judgement's log is a run's log and is filed the
    //same way; what differs is only which record carries the uid. Somebody
    //looking for it should not have to know which kind of work produced it.
    archive.keep('task-1', 'run-1', { output: 'a task ran\n' });
    archive.keep('judge-1', 'run-1', { output: 'a judgement ran\n' });

    assert.match(archive.read('task-1', 'run-1', {}).text, /a task ran/);
    assert.match(archive.read('judge-1', 'run-1', {}).text, /a judgement ran/);
});

test('what was kept outlives the record that pointed at it', () => {
    archive.keep('task-1', 'run-1', { output: 'it said this\n' });

    //READ FROM THE DIRECTORY rather than from whatever record points at it, so
    //a log whose task was thrown away is still findable. What was produced
    //outlives the note about it, which is the right way round — and
    //`taskRemove` says so about itself.
    //`has` IS PER RUN, not per task: it answers whether THIS attempt was kept,
    //which is what stops one being written over.
    assert.equal(archive.has('task-1', 'run-1'), true);
    assert.equal(archive.has('task-1', 'run-2'), false);
    assert.match(archive.read('task-1', 'run-1', {}).text, /it said this/);
});
