const { test } = require('node:test');
const assert = require('node:assert');

const R = require('../../src/app/vms/dispatch/runs');

//---------------------------------------------------------------------------
//A RUN'S RECORD ON THE MACHINE, and the three questions asked about it.
//
//THE CLAIM WORTH THE MOST: there are THREE states, not two. A missing `status`
//used to mean running, full stop — which is only true while something is still
//there to write one. A run that was killed, or that never started, has no status
//and no process, and reporting that as "running" is a watcher that waits forever
//for a result nobody is going to produce.
//
//AND THE SECOND: an id is a NAME, not a path and not a shell fragment. `stop`
//and `output` take one back from a caller, so an id of "../.." reaches another
//run's directory whether or not it is quoted properly. Quoting cannot answer
//that; a shape can.
//---------------------------------------------------------------------------

//---- an id is a name -----------------------------------------------------------

test('the ids it makes are readable, sortable, and pass its own check', () => {
    const id = R.newId(new Date('2026-08-22T04:08:57.123Z'));
    assert.equal(id, 'run-2026-08-22T04-08-57');
    //NOT A UUID: this is a name somebody types back to ask what happened to it.
    assert.equal(R.checkId(id), id);
});

test('an id that is a path is refused, in every shape that reaches another run', () => {
    for (const bad of ['../other', 'a/../b', '..', 'run-1/../run-2', '/etc/passwd', 'a/b']) {
        assert.throws(() => R.checkId(bad), /is not a run id/, 'accepted ' + JSON.stringify(bad));
    }
});

test('an id that is a shell fragment is refused', () => {
    //QUOTING WOULD NOT ANSWER THIS EITHER. `q(id).slice(1, -1)` puts the id bare
    //into the middle of a script held together only by the escaping still inside
    //it — a trick every reader has to re-derive, and one that says nothing about
    //where the id points.
    for (const bad of ['a;rm -rf /', '$(whoami)', '`id`', 'a b', "a'b", 'a|b', '', '-flag']) {
        assert.throws(() => R.checkId(bad), /is not a run id/, 'accepted ' + JSON.stringify(bad));
    }
});

test('stop and output refuse a bad id rather than building a script with it', () => {
    assert.throws(() => R.stop('../other'), /is not a run id/);
    assert.throws(() => R.output('$(whoami)'), /is not a run id/);
});

//---- stopping one ---------------------------------------------------------------

test('it asks politely first and insists afterwards', () => {
    const s = R.stop('run-1');
    const term = s.indexOf('kill -TERM');
    const kill = s.indexOf('kill -KILL');

    //TERM LETS A WORKER FINISH THE LINE IT IS WRITING; KILL covers one that
    //ignores it.
    assert.ok(term >= 0 && kill >= 0, s);
    assert.ok(term < kill, 'it reaches for KILL before TERM: ' + s);
    assert.match(s, /sleep 1/);
});

test('it kills the whole process group, not just the leader', () => {
    const s = R.stop('run-1');
    //A WORKER SPAWNS CHILDREN. Killing only the leader leaves them running with
    //nothing watching them.
    assert.match(s, /kill -TERM -- -"\$P"/);
    assert.match(s, /kill -KILL -- -"\$P"/);
    //AND FALLS BACK to the bare pid for a run that never became a group leader.
    assert.match(s, /kill -TERM "\$P"/);
});

test('it tells the three outcomes apart', () => {
    const s = R.stop('run-1');
    //"IT WAS STOPPED" IS NOT "IT WAS ALREADY GONE" IS NOT "IT WOULD NOT DIE".
    //A caller that cannot tell them apart reports the last one as success.
    for (const word of ['okc-stop-nopid', 'okc-stop-gone', 'okc-stop-refused', 'okc-stop-done']) {
        assert.ok(s.includes(word), 'it cannot report ' + word + ': ' + s);
    }
});

test('stopping a run does not shut the machine down', () => {
    //THAT IS THE QUEUE'S BUSINESS, and it does it when the run ends.
    const s = R.stop('run-1');
    assert.equal(s.indexOf('poweroff'), -1, s);
    assert.equal(s.indexOf('shutdown'), -1, s);
    assert.equal(s.indexOf('halt'), -1, s);
});

//---- what one printed ------------------------------------------------------------

test('output tails the run it was asked for, by a number it controls', () => {
    assert.match(R.output('run-1'), /tail -n 40 .*\/run-1\/out\.log/);
    assert.match(R.output('run-1', 5), /tail -n 5 /);
});

test('a line count that is not a number does not become one', () => {
    //A COUNT ARRIVING FROM A PANE IS A STRING, and an empty one must not turn
    //into `tail -n NaN` or into a shell fragment.
    for (const bad of ['; rm -rf /', 'NaN', '', null, undefined, -1, 0, 1.5e9 + 'x']) {
        const s = R.output('run-1', bad);
        assert.match(s, /tail -n \d+ /, 'from ' + JSON.stringify(bad) + ': ' + s);
        assert.equal(s.indexOf('rm -rf'), -1, s);
    }
    assert.match(R.output('run-1', 12.9), /tail -n 12 /);
});

test('a run with no output says so rather than failing', () => {
    assert.match(R.output('run-1'), /\|\| echo "okc: no output for that run"/);
});

//---- every run on the machine ------------------------------------------------------

test('it reports three states, and a killed run is not called running', () => {
    const s = R.list();
    assert.match(s, /state=finished/);
    assert.match(s, /state=running/);
    assert.match(s, /state=lost/);
    //THE PID IS CHECKED. No status and nothing alive is `lost` — reporting that
    //as running is a watcher that waits forever for a result nobody will write.
    assert.match(s, /kill -0 "\$\(cat "\$d\/pid"\)"/);
});

test('what it prints, it parses back', () => {
    const line = ['okc-run', 'run-1', 'finished', '0', '2026-08-22T04:08:57Z', '120', 'do the thing'].join(R.SEP);
    assert.deepEqual(R.runs(line), [{
        id: 'run-1', state: 'finished', exit: 0,
        started: '2026-08-22T04:08:57Z', outputLines: 120, task: 'do the thing'
    }]);
});

test('a run that is still going has no exit code, rather than a code of zero', () => {
    const line = ['okc-run', 'run-1', 'running', '', '2026-08-22T04:08:57Z', '3', 'x'].join(R.SEP);
    //`Number('')` IS 0, which reads as "it finished, successfully".
    assert.equal(R.runs(line)[0].exit, null);
});

test('a task containing the separator character does not become two runs', () => {
    //IT USED TO BE A PIPE, and a task with one in it — a shell one-liner, a
    //table, a regex — pushed extra fields into the line and the parser took the
    //task as everything up to the first pipe.
    const task = 'grep a | sort | uniq -c';
    const line = ['okc-run', 'run-1', 'finished', '0', 'when', '1', task].join(R.SEP);

    const got = R.runs(line);
    assert.equal(got.length, 1);
    assert.equal(got[0].task, task, 'the task was cut at a pipe');
});

test('a task that somehow still carries the separator comes back whole', () => {
    //THE REJOIN, HELD DIRECTLY. The machine flattens the separator out before
    //printing, so this cannot arrive today — which means the only way to prove
    //the parser's half is to hand it one. A sabotage that replaced the rejoin
    //with `f[6]` SURVIVED the first sweep of this file, because the case the
    //rejoin exists for was the one case never fed to it.
    const task = 'left' + R.SEP + 'right';
    const line = ['okc-run', 'run-1', 'finished', '0', 'when', '1', task].join(R.SEP);

    const got = R.runs(line);
    assert.equal(got.length, 1, 'one run became ' + got.length);
    assert.equal(got[0].task, task, 'the task was cut at the separator');
    //AND THE FIELDS BEFORE IT ARE STILL THE FIELDS.
    assert.equal(got[0].state, 'finished');
    assert.equal(got[0].outputLines, 1);
});

test('the separator the SHELL emits is the one the parser splits on', () => {
    //THE PAIRING THAT ACTUALLY MATTERS, and the one nothing held. Every other
    //test here builds its lines from R.SEP and reads them with R.SEP, so both
    //halves move together and stay self-consistent while the real pairing —
    //machine to parser — is broken. A sabotage that changed SEP to a pipe
    //SURVIVED the first sweep of this file for exactly that reason.
    const printf = R.list().split('\n').find((l) => l.includes('S=$(printf'));
    assert.ok(printf, 'the script does not define a separator at all');

    const octal = printf.match(/printf "\\0([0-7]{1,3})"/);
    assert.ok(octal, 'the separator is not an octal escape printf understands: ' + printf);

    //`\0` THEN UP TO THREE OCTAL DIGITS. `\0037` is `\003` followed by a 7.
    assert.equal(parseInt(octal[1], 8), R.SEP.charCodeAt(0),
        'the machine emits a different character from the one the parser splits on');
});

test('the separator is a character prose cannot contain', () => {
    //A UNIT SEPARATOR IS NOT A CHARACTER PROSE HAS. A pipe is — a shell
    //one-liner, a table, a regex — which is what it used to be.
    assert.equal(R.SEP.length, 1);
    assert.ok(R.SEP.charCodeAt(0) < 32,
        'the separator is printable (' + JSON.stringify(R.SEP) + '), so a task can contain it');
});

test('and the machine flattens the separator out of the task anyway', () => {
    //BOTH BELT AND BRACES. The shell replaces newlines and the separator before
    //printing, so one run cannot look like two even before the parser sees it.
    //String.raw, because this is a string ABOUT backslashes and writing it as a
    //regex literal means escaping each one twice — which is how the first
    //version of this line came to assert something that could not occur.
    assert.ok(R.list().includes(String.raw`tr "\n\037"`), R.list());
});

test('anything that is not one of its lines is ignored', () => {
    const noise = [
        'Warning: something from ssh',
        'okc-run-but-not-really',
        ['okc-run', 'run-1', 'finished', '0', 'b', '1', 't'].join(R.SEP),
        ''
    ].join('\n');

    assert.deepEqual(R.runs(noise).map((r) => r.id), ['run-1']);
});

test('lines arriving with carriage returns still parse', () => {
    const line = ['okc-run', 'run-1', 'finished', '0', 'b', '1', 't'].join(R.SEP) + '\r';
    assert.equal(R.runs(line).length, 1);
});

test('newest first, because that is the one being asked about', () => {
    const mk = (id, started) => ['okc-run', id, 'finished', '0', started, '1', 't'].join(R.SEP);
    const out = [mk('a', '2026-01-01'), mk('c', '2026-03-01'), mk('b', '2026-02-01')].join('\n');

    assert.deepEqual(R.runs(out).map((r) => r.id), ['c', 'b', 'a']);
});

test('nothing at all parses to nothing, not to a broken row', () => {
    assert.deepEqual(R.runs(''), []);
    assert.deepEqual(R.runs(null), []);
    assert.deepEqual(R.runs(undefined), []);
});
