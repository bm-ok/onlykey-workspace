const { test } = require('node:test');
const assert = require('node:assert');

const plugin = require('../../src/app/worker/sessions/server');

//---------------------------------------------------------------------------
//WHAT WORKERS REMEMBER, JOINED TO THE BOARD THAT NO LONGER HAS ALL OF IT.
//
//A SESSION OUTLIVES ITS TASK ON PURPOSE. What a worker did is worth reading
//after somebody decides the work was not — so this joins two lists and the join
//is allowed to fail on one side. An orphan is a ROW, not a gap, and a memory
//that outlives its task and cannot then be deleted is kept twice over.
//
//THE BOARD IS ASKED FOR BY NAME rather than consumed. ../../../src/app/queue
//says of itself that nothing consumes it, "so none of these can be a cycle",
//and making this the first consumer would spend that property to read one list.
//These tests stub the action table for the same reason the code uses it.
//---------------------------------------------------------------------------

function aWorld(over) {
    const o = over || {};
    const did = { forgot: [], asked: [] };
    const defined = new Map();

    return {
        did,
        defined,
        imports: {
            app: {
                host: {
                    actions: {
                        define: (name, spec) => { defined.set(name, spec); return () => {}; },
                        call: async (what) => {
                            did.asked.push(what);
                            if (what !== 'tasks') throw new Error('unexpected call: ' + what);
                            if (o.boardThrows) throw new Error('the board is not answering');
                            return { tasks: o.tasks || [] };
                        }
                    }
                }
            },
            log: { on: () => ({ good() {}, warn() {}, bad() {}, info() {} }) },
            ours: { read: () => [], get: () => null },
            channel: { run: async () => ({ output: '' }), connected: () => true },
            dispatch: { sessionCommand: () => '', sessionAnswer: () => ({ ok: true }) },
            //THE STORE IS THE REAL SHAPE and stubbed at its edge: `everything`
            //and `forget` are both async, which is the half a synchronous stub
            //would quietly get right and the real one would not.
            state: {
                here: {
                    doc: async () => ({ read: (f) => f, write: (v) => v }),
                    open: async () => true,
                    where: async () => (o.noWorkspace ? null : 'C:/state/here')
                },
                app: { doc: () => ({ read: (f) => f, write: (v) => v }) }
            },
            archive: { store: () => ({ list: () => [], read: () => null, has: () => false, everything: () => [] }) },
            whatIsOn: { whatIsOn: () => null },
            guestApi: { api: () => () => {} },
            //THE DOOR THE ANNOUNCEMENT IS REGISTERED AT, owned by
            //src/app/runners/runs. Stubbed to hand back an undo the way the real
            //one does, because the plugin pushes it onto the same list it tears
            //everything else down with.
            briefings: { says: () => () => {} }
        }
    };
}

//THE STORE IS REPLACED AFTER LOADING rather than mocked through `state`, because
//what is under test is the JOIN and the refusals around it — not the tar file.
async function loaded(over) {
    const o = over || {};
    const w = aWorld(o);
    let service = null;
    await plugin(w.imports, async (_e, s) => { service = s; });
    assert.ok(service, 'the plugin did not register');

    w.sessions = w.defined.get('sessions');
    w.forget = w.defined.get('sessionForget');
    assert.ok(w.sessions && w.forget, 'the two actions are not defined');
    return w;
}

//---- WHAT THIS FILE DOES NOT COVER, SAID RATHER THAN LEFT TO BE ASSUMED ----
//
//The plugin builds its store internally from `state.here`, so nothing here can
//arrange a session that EXISTS — which means the interesting half of the join is
//untested: an orphan carrying nulls beside a live task carrying its title and
//branch, and `lane` being filled in only where the board answers for it.
//
//That wants a real workspace directory with real session folders in it, which is
//../sessions-storing's business rather than this file's. What is covered here is
//the shape around the join: the refusals, the empty state, the board being asked
//for by name, and a board that will not answer not taking the list down.
//
//It is written down because a test file that looks complete is worse than a
//short one — the next person reads the names and believes the join is held.

//---------------------------------------------------------------------------
//THE JOIN.
//---------------------------------------------------------------------------

test('the board is asked for by name, not consumed as a service', async () => {
    //IF THIS EVER BECOMES A GRAPH EDGE, queue/server.js's header stops being
    //true and an unresolved name there takes down the whole graph.
    const w = await loaded({});
    await w.sessions.run({});
    assert.ok(w.did.asked.includes('tasks'), 'it did not ask the table for the board');

    const src = require('node:fs').readFileSync(
        require('node:path').join(__dirname, '..', '..', 'src', 'app', 'worker', 'sessions', 'server.js'), 'utf8');
    const consumes = /plugin\.consumes\s*=\s*\[([^\]]*)\]/.exec(src)[1];
    assert.equal(/['"]queue['"]/.test(consumes), false,
        'sessions now consumes queue — queue/server.js says nothing does, and that is what keeps it acyclic');
});

test('a board that will not answer still lists what is on disk', async () => {
    //EVERY SESSION IS STILL THERE AND STILL WORTH LISTING. What is lost is the
    //title and the branch, and the rows say so by carrying nulls.
    const w = await loaded({ boardThrows: true });
    const said = await w.sessions.run({});
    assert.ok(Array.isArray(said.sessions));
    assert.ok(said.note);
});

test('nothing kept reads as a state, not as an error', async () => {
    const w = await loaded({});
    const said = await w.sessions.run({});
    assert.deepEqual(said.sessions, []);
    assert.equal(said.bytes, 0);
    assert.match(said.note, /Nothing yet/);
});

//---------------------------------------------------------------------------
//THROWING ONE AWAY.
//---------------------------------------------------------------------------

test('a task that is gone can still have its memory thrown away', async () => {
    //A MEMORY THAT OUTLIVES ITS TASK AND CANNOT THEN BE DELETED IS KEPT TWICE
    //OVER. The uid is what the pane holds, so the uid has to work on its own.
    const w = await loaded({ tasks: [] });
    await assert.rejects(() => w.forget.run({ id: 'gone-uid' }),
        (e) => {
            //IT REACHES THE STORE AND THE STORE REFUSES, which is the right
            //refusal: "there is no session kept under that name" is about what
            //is on disk, not about the board.
            assert.match(e.message, /no session kept/);
            return true;
        });
});

test('and it is found by task number as well as by uid', async () => {
    //THE PANE HOLDS UIDS AND A PERSON AT THE COMMAND LINE HAS "#42". Both are
    //what somebody has in front of them.
    const w = await loaded({ tasks: [{ uid: 'u1', id: 'T42', number: 42, title: 'a task', branch: 'fix/x' }] });
    await assert.rejects(() => w.forget.run({ id: '42' }), /no session kept/);
    await assert.rejects(() => w.forget.run({ id: 'T42' }), /no session kept/);
    await assert.rejects(() => w.forget.run({ id: 'u1' }), /no session kept/);
});
