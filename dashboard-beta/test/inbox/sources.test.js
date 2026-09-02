const { test } = require('node:test');
const assert = require('node:assert');

const actionsPlugin = require('../../src/app/core/actions/main');
const inboxPlugin = require('../../src/app/inbox/server');

//---------------------------------------------------------------------------
//WHO ANSWERS FOR WHAT IS WAITING ON A PERSON.
//
//../../src/app/inbox used to consume every plugin that might have something to
//say and reach into each of them. Now they register. What that buys is two
//things, and the second is the one worth a test:
//
//  * the inbox's `consumes` line is `app` and `log`, so no name added anywhere
//    can close a loop through it
//  * A SOURCE THAT CANNOT ANSWER IS NAMED rather than absent
//
//The second is the whole promise of the list. "Nothing is waiting on you" and
//"nothing could be asked" look identical from the outside and mean opposite
//things, and the first version of this got it wrong in the expensive direction:
//the library's source called an async reader synchronously, threw on every
//call, and was swallowed by a `catch` whose comment read "the library is not
//answering". An unapproved job never once reached the list, and the count
//somebody would have trusted was always zero.
//
//IT WAS FOUND BY THIS DESIGN, on the first run after the move, because the
//refusal names the source. That is what these check.
//---------------------------------------------------------------------------

async function anInbox() {
    let actions = null;
    await actionsPlugin({}, async (_e, s) => { actions = s.actions; });

    const said = [];
    const logger = {
        info: (t) => said.push(t), good: (t) => said.push(t),
        warn: (t) => said.push(t), bad: (t) => said.push(t)
    };

    let inbox = null;
    await inboxPlugin(
        { app: { host: { actions } }, log: { on: () => logger } },
        async (_e, s) => { inbox = s.inbox; }
    );

    return { inbox, actions, said, ask: () => actions.call('inbox', {}) };
}

//---- registering ----------------------------------------------------------

test('a source is asked, and what it says arrives on the list', async () => {
    const { inbox, ask } = await anInbox();

    inbox.source({
        name: 'a shelf nobody has read',
        waiting: () => [inbox.item('job to approve', 'do the work',
            'Nothing can run it until somebody reads it.',
            inbox.at('Worker', 'Jobs', 'do-the-work'), { id: 'do-the-work' })]
    });

    const out = await ask();
    assert.equal(out.count, 1);
    assert.equal(out.items[0].what, 'do the work');
    //WHERE TO GO IS PART OF THE ITEM. One that cannot say is one somebody has to
    //go and find, which is most of the work it exists to save.
    assert.deepStrictEqual(out.items[0].where, { view: 'Worker', pane: 'Jobs', pick: 'do-the-work' });
});

test('a source that is async is awaited, which is the bug this design found', async () => {
    const { inbox, ask } = await anInbox();

    //THE EXACT SHAPE THAT WAS BROKEN: a reader that returns a promise. The old
    //arrangement handed it straight to `.filter`.
    inbox.source({
        name: 'a shelf that reads from disk',
        waiting: async () => {
            const rows = await Promise.resolve([{ id: 'p1', name: 'a prompt', approved: false }]);
            return rows.map((r) => inbox.item('prompt to approve', r.name, 'why',
                inbox.at('Judge', 'Prompts', r.id), { id: r.id }));
        }
    });

    const out = await ask();
    assert.equal(out.count, 1, 'an async source was not awaited');
    assert.equal(out.items[0].what, 'a prompt');
});

//---- and when one cannot answer -------------------------------------------

test('a source that throws is NAMED, and does not become "nothing is waiting"', async () => {
    const { inbox, ask, said } = await anInbox();

    inbox.source({ name: 'the one that works', waiting: () => [] });
    inbox.source({
        name: 'the one that cannot',
        waiting: () => { throw new Error('(shelf.all(...) || []).filter is not a function'); }
    });

    const out = await ask();

    //THE COUNT IS STILL HONEST -- nothing was found -- but the list says why it
    //could be wrong, which is the difference the whole design turns on.
    assert.equal(out.count, 0);
    const named = out.notCounted.filter((n) => n.indexOf('the one that cannot') === 0);
    assert.equal(named.length, 1, 'a source that threw was not named in notCounted');
    assert.match(named[0], /filter is not a function/, 'the reason was dropped, so nobody can act on it');

    //AND IT IS IN THE LOG TOO, because a person reading the pane and a person
    //reading the log are looking for the same fault.
    assert.ok(said.some((t) => t.indexOf('the one that cannot') >= 0), 'nothing was logged about it');
});

test('one source failing does not stop the others being asked', async () => {
    const { inbox, ask } = await anInbox();

    inbox.source({ name: 'first', waiting: () => { throw new Error('no'); } });
    inbox.source({
        name: 'second',
        waiting: () => [inbox.item('k', 'still counted', 'why', inbox.at('Queue'))]
    });

    const out = await ask();
    assert.equal(out.count, 1, 'a throwing source swallowed the ones after it');
    assert.equal(out.items[0].what, 'still counted');
});

//---- what nobody has registered yet ---------------------------------------

test('the sources nobody has written are still named, and always', async () => {
    const { ask } = await anInbox();

    const out = await ask();
    //WITH NO SOURCES AT ALL the answer must not read as "nothing needs you".
    assert.equal(out.count, 0);
    assert.ok(out.notCounted.length >= 4,
        'an inbox with no sources claimed to have looked everywhere');
    assert.match(out.note, /not yet reading/);
});

test('a source that declares what it is NOT reading has that counted too', async () => {
    const { inbox, ask } = await anInbox();

    inbox.source({
        name: 'changes',
        waiting: () => [],
        notReading: ['changes written and not sent']
    });

    const out = await ask();
    assert.ok(out.notCounted.indexOf('changes written and not sent') >= 0,
        'a gap a source owns was not carried through');
});

//---------------------------------------------------------------------------
//AND THE LIST OF GAPS HAS TO SHRINK, WHICH IT DID NOT.
//
//`STILL_TO_COME` says of itself that it "only shrinks — each line leaves here
//on the day the plugin that owns it registers a source of its own". Nothing
//removed lines. Every one of them was reported whether or not a source had
//since been written, so the inbox went on saying it was not reading changes
//sent and not merged while ../../src/app/repositories/pr had a source doing
//exactly that, worded slightly differently, at the foot of its file.
//
//THAT IS THE WORST THING THIS LIST CAN DO. Its whole purpose is to say where
//the answer is incomplete; a stale line makes it UNDERSTATE itself, and an
//answer that understates itself is one nobody trusts when it says zero.
//---------------------------------------------------------------------------

test('a gap a source covers stops being reported as a gap', async () => {
    const { inbox, ask } = await anInbox();

    const before = await ask();
    assert.ok(before.notCounted.indexOf('changes sent and not merged') >= 0,
        'the fixture does not have the gap this is about');

    inbox.source({
        name: 'changes that are out and not merged',
        covers: 'changes sent and not merged',
        waiting: () => []
    });

    const after = await ask();
    assert.equal(after.notCounted.indexOf('changes sent and not merged'), -1,
        'the inbox still says it cannot see something a registered source reads');
    //AND ONLY THAT ONE. Covering a gap says nothing about the others.
    assert.ok(after.notCounted.indexOf('changes written and not sent') >= 0);
});

test('a gap comes back when the source that covered it goes', async () => {
    //WORKED OUT AT ANSWER TIME rather than by deleting the line, so the list
    //describes what THIS app, as it is running now, cannot see. A server half
    //that failed to reload is one whose sources are gone, and the gaps are
    //real again.
    const { inbox, ask } = await anInbox();

    const stop = inbox.source({
        name: 'changes that are out and not merged',
        covers: 'changes sent and not merged',
        waiting: () => []
    });
    assert.equal((await ask()).notCounted.indexOf('changes sent and not merged'), -1);

    stop();
    assert.ok((await ask()).notCounted.indexOf('changes sent and not merged') >= 0,
        'the gap stayed closed after the source that closed it was gone');
});

test('a source covering a gap nobody listed is refused', async () => {
    //A `covers` WITH A TYPO IN IT CLOSES NOTHING, silently — which is the same
    //failure this whole mechanism exists to stop, one level down.
    const { inbox } = await anInbox();
    assert.throws(() => inbox.source({
        name: 'something',
        covers: 'changes sent and not merged yet',
        waiting: () => []
    }), /not one of the gaps/);
});

test('covering several at once is allowed, and each has to be real', async () => {
    const { inbox, ask } = await anInbox();

    inbox.source({
        name: 'two of them',
        covers: ['changes sent and not merged', 'changes written and not sent'],
        waiting: () => []
    });

    const out = await ask();
    assert.equal(out.notCounted.indexOf('changes sent and not merged'), -1);
    assert.equal(out.notCounted.indexOf('changes written and not sent'), -1);

    assert.throws(() => inbox.source({
        name: 'one real one not',
        covers: ['repositories whose remote points nowhere', 'something nobody wrote down'],
        waiting: () => []
    }), /not one of the gaps/);
});

//---- the refusals ---------------------------------------------------------

test('a source with no name is refused, because a refusal has to name one', async () => {
    const { inbox } = await anInbox();
    assert.throws(() => inbox.source({ waiting: () => [] }), /needs a name/);
});

test('a source with nothing to ask is refused', async () => {
    const { inbox } = await anInbox();
    assert.throws(() => inbox.source({ name: 'empty' }), /must say what is waiting/);
});

test('two plugins cannot answer under one name', async () => {
    const { inbox } = await anInbox();
    inbox.source({ name: 'twice', waiting: () => [] });
    //NOT A TIDINESS RULE. `notCounted` says which source could not be read, and
    //two of them under one name makes that sentence point at either.
    assert.throws(() => inbox.source({ name: 'twice', waiting: () => [] }), /already a source/);
});

test('a source can be taken away again, which is what a reload does', async () => {
    const { inbox, ask } = await anInbox();

    const stop = inbox.source({
        name: 'temporary',
        waiting: () => [inbox.item('k', 'here for now', 'why', inbox.at('Queue'))]
    });
    assert.equal((await ask()).count, 1);

    stop();
    //THE SERVER HALF IS REBUILT ON EVERY SAVE. A source that could not be
    //removed would be counted twice after one edit, and four times after two.
    assert.equal((await ask()).count, 0);
    assert.deepStrictEqual(inbox.sources(), []);
});

//---- and the same count, split by the tab it is on -------------------------
//
//A BADGE IS A FACT ABOUT THE TAB ROW, and this is the only place that can work
//it out: the items are here, and each already says which tab it is on because it
//has to say where to GO. So the totals fall out of the list rather than out of a
//second list of what belongs where, which would be the thing that drifts.

test('the count is split by tab, so one poller can badge the whole row', async () => {
    const { inbox, ask } = await anInbox();

    inbox.source({
        name: 'two places at once',
        waiting: () => [
            inbox.item('a', 'one', 'why', inbox.at('Worker', 'Jobs')),
            inbox.item('b', 'two', 'why', inbox.at('Worker', 'Prompts')),
            inbox.item('c', 'three', 'why', inbox.at('Judge'))
        ]
    });

    const out = await ask();
    assert.equal(out.count, 3);
    assert.deepStrictEqual(out.byTab, { Worker: 2, Judge: 1 });
});

test('a tab with nothing waiting is ABSENT, which is how the window clears it', async () => {
    const { inbox, ask } = await anInbox();

    let holding = true;
    inbox.source({
        name: 'goes away',
        waiting: () => (holding ? [inbox.item('a', 'one', 'why', inbox.at('Queue'))] : [])
    });

    assert.deepStrictEqual((await ask()).byTab, { Queue: 1 });

    //THE HALF THAT ROTS. A tab whose last errand was dealt with has to drop to
    //nothing, and the window can only do that by seeing it disappear from here —
    //so `byTab` is the WHOLE answer for every tab that has anything, never a
    //list of changes. A badge that only ever counts up is one people stop
    //believing.
    holding = false;
    assert.deepStrictEqual((await ask()).byTab, {},
        'a tab with nothing waiting was still named, so its badge could never come off');
});

test('an item with nowhere to go is still counted, but badges no tab', async () => {
    const { inbox, ask } = await anInbox();

    //IT IS STILL AN ERRAND. Not being able to say where it is makes it worse to
    //act on, not less true — and silently dropping it would make the total
    //disagree with the list somebody is reading.
    inbox.source({
        name: 'lost',
        waiting: () => [inbox.item('a', 'nowhere', 'why', {})]
    });

    const out = await ask();
    assert.equal(out.count, 1);
    assert.deepStrictEqual(out.byTab, {});
});
