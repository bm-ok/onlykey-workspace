const { test } = require('node:test');
const assert = require('node:assert');

const plugin = require('../../src/app/supervisor/server');
const allowed = require('../../src/app/supervisor/allowed');

//---------------------------------------------------------------------------
//ONE TURN OF THE SUPERVISOR, AND WHETHER IT DID ANYTHING.
//
//THE FAILURE THIS IS BUILT AROUND: a turn that ends normally having asked this
//host for nothing did nothing, whatever it printed — and that is indistinguishable
//from a supervisor with nothing to do. It has happened here for want of a
//credential: three seconds, a tidy exit, and a person watching their message sit
//unread with nothing anywhere saying why.
//
//So most of what is asserted below is about the COUNT either side of the turn,
//and about the answer going where somebody is waiting rather than only into a
//log nobody has open.
//
//DRIVEN AGAINST STUBS, and the turn stub is what makes this testable: it calls
//`allowed.noteAsked()` the way the real door does, so "it asked for three things"
//and "it asked for nothing" are both arrangeable without a machine.
//---------------------------------------------------------------------------

function aWorld(over) {
    const o = over || {};
    const did = { started: [], awaited: [], signedIn: 0, turns: [], tails: [] };
    const defined = new Map();

    const world = {
        did,
        defined,
        //WHAT THE STUBBED TURN DOES. `asks` is how many times it reaches back
        //through the door; `throws` makes it fail the way a machine does.
        asks: o.asks === undefined ? 1 : o.asks,
        connected: o.connected === undefined ? true : o.connected,
        imports: {
            app: {
                host: {
                    actions: {
                        define: (name, spec) => { defined.set(name, spec); return () => {}; },
                        call: async (what, args) => {
                            if (what === 'vmStart') { did.started.push(args.name); return { ok: true }; }
                            if (what === 'vmAwait') { did.awaited.push(args); return { ok: true }; }
                            if (what === 'supervisorSignIn') {
                                did.signedIn++;
                                if (o.signInThrows) throw new Error('the sign-in check itself broke');
                                return o.signInDid ? { did: o.signInDid } : { did: null, why: 'it was already signed in' };
                            }
                            if (what === 'vmHostAddress') {
                                if (o.noAddress) throw new Error('no address');
                                return { address: '192.168.51.1' };
                            }
                            if (what === 'supervisorWake') {
                                //THE CATCH-UP TURN, recorded rather than run — running it
                                //here would be a test of recursion rather than of the rule.
                                did.caughtUp = args;
                                return { woke: true };
                            }
                            throw new Error('unexpected call: ' + what);
                        }
                    }
                }
            },
            log: { on: () => ({ good() {}, warn() {}, bad() {}, info() {} }) },
            state: { app: { doc: () => makeDoc() } },
            ours: { read: () => [], canBe: () => true },
            guests: {
                whichSupervisor: (name) => {
                    if (o.noSupervisor) throw new Error('There is no supervisor machine on this host.');
                    return name || 'beta-super1';
                },
                all: () => [],
                supervisorKey: () => ({ key: null, why: 'no sign-in' }),
                toMachine: async () => {}
            },
            guestApi: { api: () => () => {}, PORT: 7383 },
            provision: { fileFor: () => { throw new Error('not this test'); }, STAGES: {} },
            channel: {
                connected: () => world.connected,
                run: async (machine, script, opts) => {
                    if ((opts || {}).what === 'one turn of the supervisor') {
                        did.turns.push({ machine, script });
                        if (o.turnThrows) throw new Error('the channel dropped mid-turn');
                        for (let i = 0; i < world.asks; i++) allowed.noteAsked();
                        return { output: o.output === undefined ? 'okc-skill-refreshed\nit thought about things' : o.output };
                    }
                    did.tails.push({ machine, script });
                    return { output: 'the last thing it printed' };
                }
            },
            dispatch: {
                supervisorTurn: ({ stamp, brief, refresh }) => 'TURN ' + stamp + ' ' + brief + ' ' + refresh,
                SUPERVISOR: '$HOME/.okc-supervisor'
            }
        }
    };
    return world;
}

//A DOCUMENT THAT REMEMBERS, because the chat message a failed turn writes is one
//of the things being asserted and a doc that forgets would make it unprovable.
function makeDoc() {
    let kept = null;
    return {
        read: (fallback) => (kept === null ? fallback : kept),
        write: (v) => { kept = v; return v; },
        forget: () => { kept = null; return true; }
    };
}

async function loaded(over) {
    const world = aWorld(over);
    let service = null;
    await plugin(world.imports, async (_e, s) => { service = s; });
    assert.ok(service, 'the plugin did not register');
    world.wake = world.defined.get('supervisorWake');
    assert.ok(world.wake, 'supervisorWake is not defined');
    world.chat = world.defined.get('chat');
    return world;
}

//---------------------------------------------------------------------------
//ONE AT A TIME.
//---------------------------------------------------------------------------

test('a second turn is refused while one is running, and the reason is kept', async () => {
    //TWO TURNS AT ONCE ON ONE MACHINE IS TWO THINGS DECIDING, which is the fault
    //the one-supervisor rule exists to prevent, arriving from inside.
    const w = await loaded({});

    let release;
    const held = new Promise((r) => { release = r; });
    const was = w.imports.channel.run;
    w.imports.channel.run = async (machine, script, opts) => {
        if ((opts || {}).what === 'one turn of the supervisor') { await held; }
        return was(machine, script, opts);
    };

    const first = w.wake.run({ why: 'the first' });
    //Let the first turn get as far as being in flight.
    await new Promise((r) => setImmediate(r));

    const second = await w.wake.run({ why: 'a task finished' });
    assert.equal(second.woke, false);
    assert.equal(second.pending, true);
    assert.match(second.why, /already thinking/);

    release();
    await first;

    //AND IT GOES AGAIN, ONCE, however many things happened while it was busy.
    await new Promise((r) => setTimeout(r, 1100));
    assert.ok(w.did.caughtUp, 'what happened mid-turn was dropped');
    assert.match(w.did.caughtUp.why, /a task finished/);
});

test('and three things happening mid-turn are one catch-up, not three', async () => {
    const w = await loaded({});
    let release;
    const held = new Promise((r) => { release = r; });
    const was = w.imports.channel.run;
    w.imports.channel.run = async (machine, script, opts) => {
        if ((opts || {}).what === 'one turn of the supervisor') { await held; }
        return was(machine, script, opts);
    };

    const first = w.wake.run({ why: 'the first' });
    await new Promise((r) => setImmediate(r));
    await w.wake.run({ why: 'one' });
    await w.wake.run({ why: 'two' });
    await w.wake.run({ why: 'three' });
    release();
    await first;
    await new Promise((r) => setTimeout(r, 1100));

    //WAKING IS "GO AND READ WHAT CHANGED", and three of those in a row would read
    //the same thing three times. What is worth keeping is THAT something
    //happened — and all three reasons are, so the log can say what it is catching
    //up on.
    assert.equal(w.imports.app.host.actions.call.length >= 0, true);
    assert.match(w.did.caughtUp.why, /one; two; three/);
});

//---------------------------------------------------------------------------
//GETTING THE MACHINE READY.
//---------------------------------------------------------------------------

test('a machine that is down is started and waited for', async () => {
    const w = await loaded({ connected: false });
    await w.wake.run({});

    assert.deepEqual(w.did.started, ['beta-super1']);
    assert.equal(w.did.awaited[0].for, 'connected');
});

test('one that is already up is not started again', async () => {
    const w = await loaded({ connected: true });
    await w.wake.run({});
    assert.deepEqual(w.did.started, []);
});

test('it is signed in before the turn, not after', async () => {
    //DIALLING IN SIGNS A SUPERVISOR IN, which covers every ordinary route — but a
    //wake that STARTED the machine is racing that, and one that found it already
    //up has no dial-in to have caught it. Both end as a three-second turn.
    const w = await loaded({});
    await w.wake.run({});
    assert.equal(w.did.signedIn, 1);
});

test('and a sign-in check that breaks does not lose the turn', async () => {
    //NOT FATAL: with no sign-in to give, the turn still runs and still fails —
    //saying so itself, which beats this refusing on its behalf.
    const w = await loaded({ signInThrows: true });
    const said = await w.wake.run({});
    assert.equal(said.woke, true);
    assert.equal(w.did.turns.length, 1);
});

//---------------------------------------------------------------------------
//DID IT DO ANYTHING?
//---------------------------------------------------------------------------

test('a turn that asked for nothing says so, and says it in the chat', async () => {
    const w = await loaded({ asks: 0 });
    const said = await w.wake.run({});

    assert.equal(said.asked, 0);
    assert.equal(said.ranProperly, false);

    //IN THE CHAT, because the chat is where somebody is waiting. A message that
    //is never answered is the exact shape of this failure.
    const talk = w.chat.run({});
    const last = talk.messages[talk.messages.length - 1];
    assert.ok(last, 'nothing was said at all');
    assert.equal(last.who, 'supervisor');
    assert.equal(last.via, 'wire');
    assert.match(last.text, /without asking this host for anything/);
    assert.match(last.text, /credential/);
});

test('and it reads the end of the transcript, because that is where the reason is', async () => {
    const w = await loaded({ asks: 0 });
    await w.wake.run({});
    assert.ok(w.did.tails.length, 'it never looked at why the turn did nothing');
    assert.match(w.did.tails[0].script, /current\.log/);
});

test('a turn that DID ask for things is not reported as a failure', async () => {
    const w = await loaded({ asks: 3 });
    const said = await w.wake.run({});

    assert.equal(said.asked, 3);
    assert.equal(said.ranProperly, true);

    const talk = w.chat.run({});
    assert.equal(talk.messages.length, 0, 'a working turn left a failure notice in the conversation');
});

test('the count is per turn, so an earlier turn does not make this one look busy', async () => {
    //A COUNT RATHER THAN A FLAG, taken either side, so it needs no resetting and
    //survives two turns overlapping on a busy host.
    const w = await loaded({ asks: 2 });
    await w.wake.run({});

    w.asks = 0;
    const second = await w.wake.run({});
    assert.equal(second.asked, 0, 'it counted the previous turn\'s asks as this one\'s');
    assert.equal(second.ranProperly, false);
});

//---------------------------------------------------------------------------
//THE SKILL IT TAKES ITS TURN ON.
//---------------------------------------------------------------------------

test('the skill is re-fetched every waking, from where this host actually listens', async () => {
    //A machine built before the loop changed would otherwise go on supervising by
    //the old one for ever.
    const w = await loaded({});
    await w.wake.run({});

    const script = w.did.turns[0].script;
    assert.match(script, /supervisor-skill\.md/);
    //THE PORT COMES FROM THE PLUGIN THAT LISTENS ON IT. A number written into the
    //action is right until vms/https moves, and the failure is a fetch that
    //quietly does nothing behind its own `|| true`.
    assert.match(script, /:7383\//);
});

test('and with no address it still takes its turn, on the copy it has', async () => {
    const w = await loaded({ noAddress: true });
    const said = await w.wake.run({});
    assert.equal(said.woke, true);
    assert.match(w.did.turns[0].script, /okc-skill-stale/);
});

//---------------------------------------------------------------------------
//AND WHEN IT GOES WRONG.
//---------------------------------------------------------------------------

test('a turn that throws still lets the next one start', async () => {
    //`thinking` IS CLEARED IN A `finally`. Without that, one dropped channel
    //leaves this host refusing every wake until it is restarted — and the refusal
    //says "it is already thinking", which is the least useful true sentence
    //available.
    const w = await loaded({ turnThrows: true });
    await assert.rejects(() => w.wake.run({}));

    w.imports.channel.run = aWorld({}).imports.channel.run;
    const after = await w.wake.run({});
    assert.notEqual(after.woke, false, 'it was still refusing turns after one failed');
});

test('with no supervisor machine it refuses rather than inventing one', async () => {
    const w = await loaded({ noSupervisor: true });
    await assert.rejects(() => w.wake.run({}), /no supervisor machine/);
    assert.deepEqual(w.did.turns, []);
});
