const { test } = require('node:test');
const assert = require('node:assert');

const { compose } = require('../../src/app/repositories/pr/story');

//THE STORY OF A CUT, NEWEST FIRST: what came in, what went out, what was
//decided between. The initiator is at the bottom.

const BITS = {
    hostLogin: 'me',
    rec: {
        source: 'fix/x', target: 'main', opened: '2026-08-28T20:24:00Z', by: 'super1',
        refreshed: '2026-08-28T21:40:00Z', touched: '2026-08-28T22:00:00Z',
        pulls: [{ repo: 'b', number: 2, into: 'o/b', state: 'open', url: 'u', head: 'o:fix/x', reviews: { approved: 1, changesRequested: 0 } }]
    },
    note: { made: '2026-08-28T19:12:00Z', by: 'super1', cutFrom: 'HEAD', reason: 'o/a#17 asks for off-white' },
    issue: {
        on: 'o/a', number: 17, title: 'off white', by: 'maint', at: '2026-08-28T06:00:00Z', url: 'iu',
        reading: { kind: 'request' },
        said: [
            { at: '2026-08-28T20:12:00Z', by: 'me', body: 'Checked this before writing', url: 'c1', reading: { kind: 'evidence' } },
            { at: '2026-08-28T20:13:00Z', by: 'maint', body: 'okc: it must be in repo b', url: 'c2', reading: { kind: 'request' } }
        ]
    },
    tasks: [{ number: 34, title: 'make it off-white', created: '2026-08-28T20:17:00Z', updated: '2026-08-28T20:18:00Z', state: 'done', commits: 1, becauseOf: 'J32', machine: 'w1' }],
    judgements: [
        { ref: 'J33', written: '2026-08-28T20:19:00Z', read: '2026-08-28T20:22:00Z', state: 'done', concluded: null, question: 'does it hold' },
        { ref: 'J34', written: '2026-08-28T20:56:00Z', read: '2026-08-28T21:01:00Z', state: 'done', concluded: 'reject' }
    ],
    events: [
        { at: '2026-08-28T20:15:00Z', tags: ['supervisor', 'super1'], text: 'waking it — o/a#17 was tagged by maint' },
        { at: '2026-08-28T20:17:50Z', tags: ['supervisor', 'super1'], text: 'it said: queued #34 on fix/x' },
        { at: '2026-08-28T20:48:00Z', tags: ['github', 'o/b'], text: 'replied on #2, approved at the window' },
        { at: '2026-08-28T20:49:00Z', tags: ['github', 'o/zzz'], text: 'replied on #2, approved at the window' },
        { at: '2026-08-28T20:50:00Z', tags: ['git', 'b'], text: 'reachable, and the token may use its code' }
    ]
};

test('newest first, the initiator last', () => {
    const s = compose(BITS);
    assert.equal(s[s.length - 1].text, 'opened o/a#17 — "off white" (tagged in the issue)');
    assert.equal(s[s.length - 1].dir, 'in');
    assert.match(s[0].text, /^b #2 is open — reviews: 1 approved, 0 changes requested — head fix\/x$/);
    for (let i = 1; i < s.length; i++) assert.ok(s[i - 1].at >= s[i].at, 'not in order at ' + i);
});

test('in and out are told apart: the maintainer\'s tag is in, this host\'s reply is out', () => {
    const s = compose(BITS);
    //A TAG IS IN EVEN WHEN THE LOGIN IS THIS HOST'S OWN.
    const same = compose(Object.assign({}, BITS, { hostLogin: 'maint' }));
    assert.equal(same.find((e) => /tagged on o\/a#17/.test(e.text)).dir, 'in');
    const tag = s.find((e) => /tagged on o\/a#17/.test(e.text));
    assert.equal(tag.dir, 'in'); assert.equal(tag.who, 'maint');
    const mine = s.find((e) => /^replied on o\/a#17/.test(e.text));
    assert.equal(mine.dir, 'out'); assert.equal(mine.who, 'me');
    const opened = s.find((e) => /^opened b #2 into main/.test(e.text));
    assert.equal(opened.dir, 'out');
    assert.ok(s.some((e) => /pushed the branch onto/.test(e.text)));
});

test('the machine work is there: the cut, the task landing, the judgements concluding', () => {
    const s = compose(BITS).map((e) => e.text);
    assert.ok(s.some((t) => /^cut the branch from HEAD — o\/a#17 asks/.test(t)));
    assert.ok(s.some((t) => /^task #34 written because of J32/.test(t)));
    assert.ok(s.some((t) => /^task #34 landed — 1 commit/.test(t)));
    assert.ok(s.some((t) => t === 'J34 concluded: reject'));
    assert.ok(s.some((t) => t === 'J33 finished without a conclusion'));
});

test('only the events about this cut, and a pull request number only under its own repository', () => {
    const s = compose(BITS);
    assert.ok(s.some((e) => e.kind === 'supervisor' && e.dir === 'in' && /waking it/.test(e.text)));
    assert.ok(s.some((e) => e.kind === 'supervisor' && e.dir === 'out' && /queued #34/.test(e.text)));
    const replies = s.filter((e) => /^replied on #2/.test(e.text));
    assert.equal(replies.length, 1, 'the reply on a different repository\'s #2 was counted');
    assert.ok(!s.some((e) => /reachable/.test(e.text)));
});

test('nothing in, nothing out', () => {
    assert.deepEqual(compose({}), []);
    assert.deepEqual(compose(null), []);
});
