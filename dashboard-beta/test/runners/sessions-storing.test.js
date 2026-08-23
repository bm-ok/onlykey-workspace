const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', 'src', 'app');
const makeStoring = require(path.join(APP, 'runners', 'sessions', 'storing.js'));
const { okId } = makeStoring;

//AGAINST THE REAL FILESYSTEM, in a temp folder. What is being checked here is
//what ends up on disk and what comes back off it, and a stand-in for `fs` would
//be checking the stand-in.
function storeIn(opts) {
    const o = opts || {};
    const at = o.noWorkspace ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'okc-sessions-'));
    const store = makeStoring({
        root: async () => at,
        inspect: o.inspect || ((bytes) => ({ inside: { turns: 1, bytes: bytes.length }, refuse: [], checked: true })),
        most: o.most
    });
    return { store, at };
}

const SOME = Buffer.from('pretend this is a tar.gz');

//---------------------------------------------------------------------------
//1. THE REFUSALS, AND THE ORDER THEY HAPPEN IN.
//---------------------------------------------------------------------------

test('a credential in the archive is refused, and NOTHING is written', () => {
    //THE ORDER IS THE WHOLE POINT. Writing first and checking after would put
    //the thing being refused on disk, in the folder it was being kept out of.
    const { store, at } = storeIn({
        inspect: () => ({ inside: {}, refuse: ['.claude/.credentials.json'], checked: true })
    });

    return assert.rejects(
        () => store.keep('worker--cut--thing', SOME, {}),
        (e) => /credentials\.json/.test(e.message) && /Nothing was kept/.test(e.message)
    ).then(() => {
        assert.deepEqual(fs.readdirSync(at), [], 'something was written for a refused archive');
    });
});

test('the refusal names the file and points at where the exclusion belongs', () => {
    const { store } = storeIn({
        inspect: () => ({ inside: {}, refuse: ['.credentials.json'], checked: true })
    });
    return assert.rejects(() => store.keep('k', SOME, {}), /job-api\.js/);
});

test('an archive that could not be OPENED is refused, not kept with a note', async () => {
    //"could not check" must not arrive looking like "checked and clean". An
    //archive that will not parse has no entries, so asking whether a credential
    //is in it answers no — and an archive nothing can read cannot be handed back
    //to a machine either, so what would be kept is bytes nobody has looked at.
    const { store, at } = storeIn({
        inspect: () => ({ inside: { unreadable: 'it is not a tar' }, refuse: [], checked: false })
    });

    await assert.rejects(() => store.keep('k', SOME, {}),
        (e) => /could not be checked/.test(e.message) && /it is not a tar/.test(e.message));
    assert.deepEqual(fs.readdirSync(at), [], 'an unreadable archive was written anyway');
});

test('an inspector that forgets to say whether it looked is treated as not having looked', async () => {
    //FAIL CLOSED. A check whose default is "it was fine" stops existing the
    //first time somebody adds a return path that does not set the flag.
    const { store } = storeIn({ inspect: () => ({ inside: { turns: 1 }, refuse: [] }) });
    await assert.rejects(() => store.keep('k', SOME, {}), /could not be checked/);
});

test('an empty archive, an oversized one and a bad id are each refused by name', async () => {
    const { store } = storeIn({ most: 100 });
    await assert.rejects(() => store.keep('k', Buffer.alloc(0), {}), /nothing in it/);
    await assert.rejects(() => store.keep('k', Buffer.alloc(200), {}), /the most this takes/);
    await assert.rejects(() => store.keep('k', SOME, { id: 'not a session id!' }), /not a session id/);
});

test('no workspace open is refused rather than dropped', async () => {
    //"kept" and "there was nowhere to keep it" are different answers, and this
    //is a record of something on a machine that is about to be rolled back.
    const { store } = storeIn({ noWorkspace: true });
    await assert.rejects(() => store.keep('k', SOME, {}), /no workspace is open/);
});

test('a session id is optional, because the first run may not have one yet', () => {
    assert.equal(okId(null), true);
    assert.equal(okId(''), true);
    assert.equal(okId('0199a1b2-c3d4-7e8f-9012-3456789abcde'), true);
    assert.equal(okId('../../etc/passwd'), false);
    assert.equal(okId('has a space'), false);
});

//---------------------------------------------------------------------------
//2. REPLACED, NOT ADDED TO.
//---------------------------------------------------------------------------

test('a second keep replaces the archive rather than keeping both', async () => {
    //THE OPPOSITE OF THE ARTIFACTS BESIDE IT, and right for the same underlying
    //reason: an artifact is a delivery and losing either of two loses work; a
    //session is a conversation, and the newer copy is the older one plus what
    //happened since.
    const { store, at } = storeIn();
    await store.keep('worker--cut--thing', Buffer.from('first'), {});
    await store.keep('worker--cut--thing', Buffer.from('second and longer'), {});

    const dir = path.join(at, 'worker--cut--thing');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['about.json', 'claude.tgz']);
    assert.equal(fs.readFileSync(path.join(dir, 'claude.tgz'), 'utf8'), 'second and longer');
});

test('resuming is counted, and when it was first kept survives', async () => {
    const { store } = storeIn();
    const one = await store.keep('k', SOME, {});
    assert.equal(one.runs, 1);

    const two = await store.keep('k', SOME, {});
    assert.equal(two.runs, 2);
    assert.equal(two.first, one.first, 'the first time it was kept was overwritten');
});

//---------------------------------------------------------------------------
//3. WHAT IS CARRIED FORWARD, AND WHAT IS NOT.
//---------------------------------------------------------------------------

test('who signed it accumulates, so a sign-in thrown away is still named', async () => {
    //Built from what is on disk rather than from the sign-in list, which is the
    //point of writing it here at all.
    const { store } = storeIn();
    await store.keep('k', SOME, { guest: 'someone' });
    const two = await store.keep('k', SOME, { guest: 'somebody-else' });
    assert.deepEqual(two.guests.sort(), ['somebody-else', 'someone']);
});

test('the sign-in for THIS run is blanked rather than inherited', async () => {
    //A run with no sign-in named is a run signed by whatever this host used to
    //keep, and inheriting the previous name would state something untrue about
    //who paid for it — while `guests` still remembers both.
    const { store } = storeIn();
    await store.keep('k', SOME, { guest: 'someone' });
    const two = await store.keep('k', SOME, {});
    assert.equal(two.guest, null);
    assert.deepEqual(two.guests, ['someone']);
});

test('what it is about is carried forward when a later run does not say', async () => {
    const { store } = storeIn();
    await store.keep('k', SOME, { lane: 'worker', about: 'work/thing', taskId: 't1', number: 4 });
    const two = await store.keep('k', SOME, {});
    assert.equal(two.lane, 'worker');
    assert.equal(two.about, 'work/thing');
    assert.equal(two.taskId, 't1');
    assert.equal(two.number, 4);
});

test('the machine and the run are NOT carried forward, because they are this run', async () => {
    const { store } = storeIn();
    await store.keep('k', SOME, { machine: 'kit-1', run: 'r-1' });
    const two = await store.keep('k', SOME, {});
    assert.equal(two.machine, null);
    assert.equal(two.run, null);
});

//---------------------------------------------------------------------------
//4. READING IT BACK.
//---------------------------------------------------------------------------

test('nothing kept reads as null rather than throwing', async () => {
    const { store } = storeIn();
    assert.equal(await store.get('never-kept'), null);
    assert.equal(await store.has('never-kept'), false);
});

test('an older record has its lane and subject recovered from its own name', async () => {
    //Read-time and idempotent, rather than by rewriting files. A record written
    //before these were kept has neither, and they are exactly what a panel needs
    //to say what it is looking at.
    const { store, at } = storeIn();
    const dir = path.join(at, 'worker--cut--fix_thing');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'claude.tgz'), SOME);
    fs.writeFileSync(path.join(dir, 'about.json'), JSON.stringify({ kept: '2026-01-01' }));

    const back = await store.get('worker--cut--fix_thing');
    assert.equal(back.lane, 'worker');
    assert.equal(back.about, 'fix_thing');
});

test('a uid from before subject keying keeps null rather than inventing a subject', async () => {
    const { store } = storeIn();
    await store.keep('some-plain-uid', SOME, {});
    const back = await store.get('some-plain-uid');
    assert.equal(back.lane, null);
    assert.equal(back.about, null);
});

test('an interrupted keep still finds the archive, without its record', async () => {
    //What was produced outlives the note about it, which is the right way round.
    const { store, at } = storeIn();
    const dir = path.join(at, 'k');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'claude.tgz'), SOME);

    const back = await store.get('k');
    assert.ok(back);
    assert.equal(back.bytes, SOME.length);
});

test('a record whose about.json is rubbish does not lose the archive', async () => {
    const { store, at } = storeIn();
    const dir = path.join(at, 'k');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'claude.tgz'), SOME);
    fs.writeFileSync(path.join(dir, 'about.json'), '{ this is not json');

    const back = await store.get('k');
    assert.ok(back, 'the archive was lost because its summary would not parse');
    assert.equal(back.bytes, SOME.length);
});

//---------------------------------------------------------------------------
//5. THE LIST, AND FORGETTING.
//---------------------------------------------------------------------------

test('everything kept is listed, newest first', async () => {
    const { store } = storeIn();
    await store.keep('a', SOME, {});
    await new Promise(r => setTimeout(r, 5));
    await store.keep('b', SOME, {});

    const all = await store.everything();
    assert.equal(all.length, 2);
    assert.ok(String(all[0].kept) >= String(all[1].kept), 'not newest first');
});

test('no workspace lists nothing rather than throwing', async () => {
    const { store } = storeIn({ noWorkspace: true });
    assert.deepEqual(await store.everything(), []);
});

test('forgetting one takes both files and says what it freed', async () => {
    const { store, at } = storeIn();
    await store.keep('k', SOME, {});
    const gone = await store.forget('k');

    assert.equal(gone.forgotten, 'k');
    assert.equal(gone.bytes, SOME.length);
    assert.equal(await store.get('k'), null);
    assert.deepEqual(fs.readdirSync(at), []);
});

test('forgetting what is not there is refused rather than reported as done', async () => {
    const { store } = storeIn();
    await assert.rejects(() => store.forget('never-kept'), /no session kept/);
});

test('a key with a slash in it cannot write outside its folder', async () => {
    //The key is a folder name and comes from ./keying.js, which makes it safe —
    //this is the second half of that, on the end that touches a disk.
    //CHECKED BY WHERE IT LANDED, not by what the name looks like. `..` survives
    //as ordinary characters in a folder called `.._escaped`, which is harmless —
    //what matters is that resolving it stays under the drawer.
    const { store, at } = storeIn();

    for (const nasty of ['../escaped', '../../escaped', 'a/b/c', '/absolute', 'C:\\somewhere']) {
        const dir = await store.dirFor(nasty);
        assert.ok(path.resolve(dir).startsWith(path.resolve(at) + path.sep),
            '"' + nasty + '" resolved to ' + dir + ', which is outside ' + at);
    }

    await store.keep('../escaped', SOME, {});
    assert.equal(fs.readdirSync(at).length, 1, 'more than one folder was made');
    assert.equal(fs.readdirSync(path.dirname(at)).filter(n => n === 'escaped').length, 0,
        'something was written beside the drawer rather than inside it');
});
