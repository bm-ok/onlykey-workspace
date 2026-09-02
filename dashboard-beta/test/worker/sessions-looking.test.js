const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', 'src', 'app');
const looking = require(path.join(APP, 'worker', 'sessions', 'looking.js'));
const { mustNotHave, transcriptIn, summarise, basename, NEVER } = looking;

const entry = (name, size) => ({ name, size: size == null ? 10 : size, type: 'file' });

//---------------------------------------------------------------------------
//1. WHAT MUST NEVER BE IN ONE.
//
//The exclusion that keeps a credential out of a session archive lives in
//job-api.js -- a file the HOST writes ONTO the guest, which the agent doing the
//work can read and edit. These are the same check on the end a guest cannot
//edit.
//---------------------------------------------------------------------------

test('an ordinary archive has nothing that must not be there', () => {
    const ok = [
        entry('.claude/settings.json'),
        entry('.claude/projects/-home-okc-work/abc.jsonl', 900),
        entry('.claude/history.jsonl')
    ];
    assert.deepEqual(mustNotHave(ok), []);
});

test('a credential in the archive is found, wherever in it it sits', () => {
    //THE ARCHIVE IS MADE RELATIVE TO $HOME so the ordinary spelling is
    //`.claude/.credentials.json` — but a differently built tar could put it at
    //`./`, or deeper, and it is the FILE being refused rather than one spelling
    //of where it sat.
    const spellings = [
        '.claude/.credentials.json',
        './.claude/.credentials.json',
        'home/okc/.claude/.credentials.json',
        '.credentials.json',
        'somewhere/odd/.credentials.json'
    ];
    for (const name of spellings) {
        assert.deepEqual(mustNotHave([entry('.claude/settings.json'), entry(name)]), [name],
            name + ' was not found');
    }
});

test('a windows-style separator does not smuggle one past the check', () => {
    const name = '.claude\\.credentials.json';
    assert.deepEqual(mustNotHave([entry(name)]), [name]);
});

test('what is found is NAMED, so the refusal can say what it found', () => {
    //A boolean would make the refusal "it was refused", which is not actionable.
    const found = mustNotHave([entry('a/.credentials.json'), entry('b/.credentials.json')]);
    assert.equal(found.length, 2);
    assert.deepEqual(found, ['a/.credentials.json', 'b/.credentials.json']);
});

test('a file merely NAMED like one is not mistaken for it, in either direction', () => {
    //`credentials.json` without the dot is not the file, and
    //`.credentials.json.bak` is not either. Being too eager here would refuse
    //real archives, which trains people to turn the check off.
    const near = ['credentials.json', '.credentials.json.bak', 'my.credentials.json', 'creds.json'];
    for (const name of near) {
        assert.deepEqual(mustNotHave([entry(name)]), [], name + ' was refused and should not be');
    }
});

test('nothing, and rubbish, are not credentials', () => {
    for (const nothing of [null, undefined, []]) assert.deepEqual(mustNotHave(nothing), []);
    assert.deepEqual(mustNotHave([null, undefined, {}, { name: null }]), []);
});

test('the list of what may never be in one is not empty', () => {
    //INERTNESS. Emptying NEVER makes every assertion above pass while the check
    //protects nothing — the most dangerous shape a security check has.
    assert.ok(NEVER.length >= 1);
    assert.ok(NEVER.indexOf('.credentials.json') >= 0);
});

//---------------------------------------------------------------------------
//2. WHICH TRANSCRIPT.
//---------------------------------------------------------------------------

test('the biggest transcript is the one being carried on', () => {
    //A run resumed into an existing project folder leaves more than one, and the
    //one with something in it is the conversation.
    const entries = [
        entry('.claude/projects/-home-okc-work/small.jsonl', 12),
        entry('.claude/projects/-home-okc-work/real.jsonl', 90000),
        entry('.claude/settings.json', 400)
    ];
    assert.equal(transcriptIn(entries).name, '.claude/projects/-home-okc-work/real.jsonl');
});

test('an archive with no transcript says so by answering null', () => {
    assert.equal(transcriptIn([entry('.claude/settings.json')]), null);
    assert.equal(transcriptIn([]), null);
    assert.equal(transcriptIn(null), null);
});

test('a jsonl that is not under projects/ is not the transcript', () => {
    assert.equal(transcriptIn([entry('.claude/history.jsonl', 900000)]), null);
});

//---------------------------------------------------------------------------
//3. WHAT HAPPENED IN IT, READ DEFENSIVELY.
//---------------------------------------------------------------------------

const turn = (over) => JSON.stringify(Object.assign({
    timestamp: '2026-08-01T00:00:00Z',
    message: { model: 'claude-opus-5', usage: { input_tokens: 10, output_tokens: 5 }, content: [] }
}, over));

test('a half-written last line is skipped and everything before it still counts', () => {
    //A run killed mid-write leaves one. Ending the read there would throw away
    //the whole conversation over its final byte.
    const text = [turn(), turn(), '{"message":{"content":['].join('\n');
    assert.equal(summarise(text).turns, 2);
});

test('blank lines and rubbish are not turns', () => {
    const text = ['', '   ', 'not json at all', turn(), ''].join('\n');
    assert.equal(summarise(text).turns, 1);
});

test('nothing at all summarises to nothing, rather than throwing', () => {
    for (const nothing of ['', null, undefined]) {
        const out = summarise(nothing);
        assert.equal(out.turns, 0);
        assert.equal(out.model, null);
    }
});

test('the first and last timestamps are when it ran', () => {
    const text = [
        turn({ timestamp: '2026-08-01T10:00:00Z' }),
        turn({ timestamp: '2026-08-01T10:05:00Z' }),
        turn({ timestamp: '2026-08-01T10:40:00Z' })
    ].join('\n');
    const out = summarise(text);
    assert.equal(out.from, '2026-08-01T10:00:00Z');
    assert.equal(out.to, '2026-08-01T10:40:00Z');
});

test('a synthetic turn is not reported as the model somebody used', () => {
    //Claude writes `<synthetic>` for a turn it made up rather than one a model
    //produced, and it is a small lie in the field people read first.
    const text = [
        turn({ message: { model: '<synthetic>', content: [] } }),
        turn({ message: { model: 'claude-opus-5', content: [] } })
    ].join('\n');
    assert.equal(summarise(text).model, 'claude-opus-5');
});

test('tools are counted and ordered by how much they were used', () => {
    const used = (name, file) => turn({
        message: { content: [{ type: 'tool_use', name, input: file ? { file_path: file } : {} }] }
    });
    const text = [used('Read', '/a'), used('Read', '/b'), used('Bash'), used('Read', '/a')].join('\n');
    const out = summarise(text);
    assert.deepEqual(out.tools, [{ name: 'Read', n: 3 }, { name: 'Bash', n: 1 }]);
    assert.deepEqual(out.touched.sort(), ['/a', '/b']);
});

test('what was touched is bounded, and says how much was left out', () => {
    //Written into a record read on every draw. A worker that touched four
    //hundred files would otherwise put all four hundred in it — and a bare 40
    //would read as "that is all of them".
    const many = [];
    for (let i = 0; i < 55; i++) {
        many.push(turn({ message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/f' + i } }] } }));
    }
    const out = summarise(many.join('\n'));
    assert.equal(out.touched.length, 40);
    assert.equal(out.moreTouched, 15);
});

test('tokens are added up across turns, cache included', () => {
    const text = [
        turn({ message: { usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 900 }, content: [] } }),
        turn({ message: { usage: { input_tokens: 50, output_tokens: 5 }, content: [] } })
    ].join('\n');
    assert.deepEqual(summarise(text).tokens, { in: 150, out: 25, cache: 900 });
});

test('api errors are counted rather than hidden among the turns', () => {
    const text = [turn(), turn({ isApiErrorMessage: true }), turn()].join('\n');
    const out = summarise(text);
    assert.equal(out.errors, 1);
    assert.equal(out.turns, 3);
});

test('a turn whose content is not a list does not stop the read', () => {
    //Nothing here is trusted: this came off a machine running a script somebody
    //wrote, and an agent could have edited it.
    const text = [
        turn({ message: { content: 'a string' } }),
        turn({ message: { content: null } }),
        turn({ message: null }),
        JSON.stringify('a bare string'),
        JSON.stringify(42),
        turn()
    ].join('\n');
    assert.doesNotThrow(() => summarise(text));
    assert.ok(summarise(text).turns >= 1);
});

test('basename handles both separators and no separator at all', () => {
    assert.equal(basename('a/b/c.json'), 'c.json');
    assert.equal(basename('a\\b\\c.json'), 'c.json');
    assert.equal(basename('c.json'), 'c.json');
    assert.equal(basename(''), '');
    assert.equal(basename(null), '');
});
