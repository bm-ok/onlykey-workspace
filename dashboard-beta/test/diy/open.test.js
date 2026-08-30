const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const actionsPlugin = require('../../src/app/core/actions/main');
const diyPlugin = require('../../src/app/diy/server');
const roles = require('../../src/app/vms/ours/roles');

//---------------------------------------------------------------------------
//THE ONE PRESS.
//
//FOUR ACTS TO THE APP AND ONE ACT TO THE PERSON. Take the machine out of the
//pool, bring it up, lay the cut on it, lend it the sign-in, open it. What this
//file holds is the two claims that make it one press rather than a macro:
//
//  * EVERY STEP IS SKIPPED IF IT IS ALREADY TRUE. Otherwise the second press of
//    the day re-lays a workspace over work in progress and lends a credential
//    that is already there — and both of those are quiet.
//  * IT TAKES THE ONLY CANDIDATE AND REFUSES BETWEEN TWO. One free diy machine
//    is not a choice — asking which of the one was how this pane made the
//    simplest case, a person with exactly what they need, the slow one. Two is
//    a choice nobody else can make, because which machine has last week's work
//    on its disk is not a fact this app holds, and there the refusal carries
//    the list: it is the moment somebody is least likely to know what there is.
//
//NOTHING HERE TOUCHES A MACHINE. Every action it calls is a stand-in that
//records the call, so the ORDER is what is being tested — which is the part
//that cannot be seen by reading, and the part that costs a rolled-back disk
//when it is wrong.
//---------------------------------------------------------------------------

let kept, called, vms, guests;

function doc() {
    return Promise.resolve({
        read: function (fallback) { return kept === null ? fallback : JSON.parse(JSON.stringify(kept)); },
        write: function (v) { kept = JSON.parse(JSON.stringify(v)); return v; }
    });
}

//THE MACHINE AS THE REGISTER HOLDS IT. `forTasks: false` is kept back,
//`connected` is dialled in, `branch` is what it claims.
//TAGGED `diy`, WHICH IS THE POOL. A person's seat has to be a machine the queue
//will never pick up, and that tag is what says so — see ../../src/app/vms/ours/
//roles.js, which keeps `diy` out of `takesQueuedWork` for exactly that reason.
//AND THE RECORD OF IT, WHICH IS A SMALLER THING. `running` and `connected` are
//not written down anywhere — the register holds what a machine IS, and those two
//are facts about right now, answered by asking VirtualBox and the channel. A
//stand-in that puts them on a record is a stand-in that agrees with a bug.
const asRecord = (vm) => {
    const rec = Object.assign({}, vm);
    delete rec.running;
    delete rec.connected;
    return rec;
};

//`baseSnapshot` BECAUSE A BUILT MACHINE HAS ONE. It is what "roll it back"
//means, and a fixture without it is a machine that finished provisioning and
//never had its starting point taken — which is a real state, and is the one the
//"nowhere to roll back to" case below sets on purpose rather than the default.
const VM = (over) => Object.assign({
    name: 'beta-diy1', running: false, connected: false, baseSnapshot: 'base',
    forTasks: undefined, branch: null, holdsCredential: false, tags: ['diy']
}, over || {});

beforeEach(() => {
    kept = null;
    called = [];
    vms = { 'beta-diy1': VM() };
    guests = [
        { name: 'diy-b1', role: 'diy', has: true, holder: null },
        { name: 'super-a2', role: 'supervisor', has: true, holder: null }
    ];
});

async function anApp() {
    let actions = null;
    await actionsPlugin({}, async (_e, s) => { actions = s.actions; });

    //THE ACTIONS THE PRESS LEANS ON, EACH RECORDING AND EACH MOVING THE WORLD
    //THE WAY THE REAL ONE WOULD — a stand-in that records but does not change
    //what the next step reads would let "skip if already true" pass by never
    //becoming true.
    const stub = (name, fn) => actions.define(name, { about: name, run: async (a) => { called.push(name); return fn ? fn(a || {}) : {}; } });

    stub('vmForTasks', (a) => { vms[a.name].forTasks = false; return { name: a.name }; });
    stub('vmStart', (a) => { vms[a.name].running = true; return { name: a.name }; });
    stub('vmAwait', (a) => { vms[a.name].connected = true; return { name: a.name }; });
    stub('vmWorkspace', (a) => { vms[a.name].branch = a.branch; return { name: a.name }; });
    stub('guestLend', (a) => { vms[a.machine].holdsCredential = true; return { name: a.name }; });
    //---- AND THE OTHER END OF THE PRESS ---------------------------------
    //
    //EACH MOVES THE WORLD THE WAY THE REAL ONE WOULD, same as the four above.
    //A `vmCredentialsForget` that records but does not clear `holdsCredential`
    //would let "wake it and lend the sign-in back" pass by never having taken
    //one away.
    stub('vmCredentialsForget', (a) => {
        vms[a.name].holdsCredential = false;
        guests.forEach((g) => { if (g.holder === a.name) g.holder = null; });
        return { name: a.name };
    });
    stub('vmStop', (a) => { vms[a.name].running = false; vms[a.name].connected = false; return { name: a.name }; });
    stub('vmSnapshotRestore', (a) => {
        //WHAT A ROLLBACK ACTUALLY DOES TO A RECORD — see
        //../../src/app/runners/machines/restoring.js. The branch goes, the
        //credential goes, and the machine is clean again.
        Object.assign(vms[a.name], {
            branch: null, holdsCredential: false, dirty: false,
            dirtySince: null, cleanSince: '2026-01-01T00:00:00.000Z'
        });
        return { name: a.name };
    });

    stub('guests', () => ({ guests: guests }));
    stub('credentialsHeld', () => ({ guests: guests }));
    stub('branchBoard', () => ({ branches: [{ name: 'diy/flat', in: ['a', 'b'], cut: true }, { name: 'diy/other', in: ['a'], cut: true }] }));

    await diyPlugin({
        app: { host: { actions } },
        log: { on: () => ({ info: () => {}, good: () => {}, warn: () => {}, bad: () => {} }) },
        editor: { open: async (it) => { called.push('editor.open'); return { opened: it.dir, on: it.remote, using: 'code' }; } },
        ssh: {
            ensure: () => ({}), writeConfig: () => 'ssh_config', ensureInclude: () => ({ added: false }),
            readingOf: (vm) => ({ name: vm.name, address: '10.0.0.2', user: 'okc', alias: 'okc-' + vm.name, usesOurKey: true })
        },
        //THE REAL ROLE RULES, NOT A GUESS AT THEM. A stand-in answering
        //`canBe` with its own idea of what a tag means is a stand-in that
        //passes while the app disagrees with it — so the register's own reader
        //is used, which is the one thing here that must not be faked.
        ours: {
            //`get` THROWS FOR A MACHINE THAT IS NOT THERE, exactly as the real
            //one does. The stand-in used to answer `undefined`, which is how a
            //seat pointing at a deleted machine passed here and took the whole
            //action down in the app.
            get: (n) => {
                if (!vms[n]) throw new Error('"' + n + '" is not a virtual machine this app made, so it will not touch it.');
                //AND IT ANSWERS A RECORD, which is what the real one answers.
                //Handing back the live object made the sabotage survive: put
                //`ours.get` back into the press and every test still passed,
                //because this said the machine was running and the app it was
                //testing believed it.
                return asRecord(vms[n]);
            },
            //AND `read` IS THE RECORD, `all` IS THE RECORD PLUS RIGHT NOW —
            //which is the whole distinction the pane got wrong. A stand-in that
            //put `running` on both would have let the bug pass.
            read: () => Object.keys(vms).map((k) => asRecord(vms[k])),
            all: async () => ({
                available: true,
                vms: Object.keys(vms).map((k) => Object.assign({}, vms[k], { live: true }))
            }),
            canBe: roles.canBe,
            kindsOf: roles.kindsOf
        },
        repoWorkspaces: { folderFor: () => '/home/okc/workspace' },
        state: { here: { doc: doc } }
    }, async () => {});

    return actions;
}

const start = (actions, over) =>
    actions.call('diyStart', Object.assign({ title: 'flat workspace layout', cut: 'diy/flat' }, over || {}));

//---- who may press it ------------------------------------------------------

test('the command line is refused, and told where the button is', async () => {
    const actions = await anApp();
    const it = await start(actions);

    await assert.rejects(
        () => actions.call('diyOpen', { id: it.id, _overTheWire: true }),
        (e) => {
            assert.match(e.message, /person's press/i);
            assert.match(e.message, /DIY/);
            return true;
        }
    );
    assert.equal(called.filter((c) => c === 'editor.open').length, 0);
});

//---- the whole sequence, in order ------------------------------------------

test('from cold it does all five, in order', async () => {
    const actions = await anApp();
    const it = await start(actions);

    const said = await actions.call('diyOpen',
        { id: it.id, machine: 'beta-diy1', signIn: 'diy-b1', _fromTest: true });

    //THE ORDER IS THE CLAIM. Laying the workspace before the machine has
    //dialled in has nothing to talk to; lending the sign-in before the
    //workspace puts a credential on a machine that may still fail to set up.
    assert.deepEqual(
        called.filter((c) => c !== 'credentialsHeld' && c !== 'branchBoard' && c !== 'guests'),
        ['vmForTasks', 'vmStart', 'vmAwait', 'vmWorkspace', 'guestLend', 'editor.open']
    );

    assert.equal(said.machine, 'beta-diy1');
    assert.equal(said.cut, 'diy/flat');
    assert.equal(said.opened, '/home/okc/workspace');
    assert.equal(said.on, 'okc-beta-diy1');

    //AND IT SAYS WHAT IT DID. A press that performs five acts on real machines
    //and answers "ok" is one nobody can check afterwards.
    assert.ok(said.did.length >= 5, said.did.join(' | '));
    assert.match(said.note, /kept beta-diy1 back/);
});

test('the second press does nothing but open it', async () => {
    const actions = await anApp();
    const it = await start(actions);

    await actions.call('diyOpen', { id: it.id, machine: 'beta-diy1', signIn: 'diy-b1', _fromTest: true });
    called = [];

    await actions.call('diyOpen', { id: it.id, _fromTest: true });

    //THIS IS WHAT MAKES IT THE SAME PRESS TWICE. Re-laying a workspace over
    //work in progress moves the host's checkouts about and re-clones on the
    //machine; re-lending a credential that is already there is a second
    //credential movement nobody asked for. Both are quiet when they happen.
    assert.deepEqual(called.filter((c) => c !== 'credentialsHeld' && c !== 'branchBoard'), ['editor.open']);
});

//---- AND THE TWO FACTS THAT ARE NOT WRITTEN DOWN ---------------------------
//
//`running` AND `connected` ARE NOT ON A RECORD. The register holds what a
//machine IS — its name, its tags, its branch, whether it is holding a
//credential — and asking a record whether it is running answers `undefined`,
//which is falsy, which reads as "no".
//
//SO THE PRESS STARTED A MACHINE THAT WAS ALREADY UP, and then waited for it to
//dial in a second time. Closing VS Code and pressing again took four minutes
//and moved a running machine, instead of opening an editor.
//
//THE OTHER THREE STEPS SKIPPED CORRECTLY, which is what hid it: the workspace
//was not re-laid and the credential was not re-lent, so the press looked like
//it was skipping what it had already done.
//
//IT IS A STAND-IN BUG AS MUCH AS AN APP ONE. This file's `ours` used to answer
//`read()` with objects carrying `running`, so every test here agreed with an
//app that was wrong. `read()` now strips the two live facts and `all()` is the
//only place they exist — the same split the real register has.

test('a machine that is already up is not started again', async () => {
    //ALREADY RUNNING AND DIALLED IN before anybody presses anything, which is
    //what a machine looks like on the second morning.
    vms['beta-diy1'] = VM({ running: true, connected: true });
    const actions = await anApp();
    const it = await start(actions);

    await actions.call('diyOpen', { id: it.id, machine: 'beta-diy1', signIn: 'diy-b1', _fromTest: true });

    assert.equal(called.indexOf('vmStart'), -1, 'it started a machine that was already running');
    assert.equal(called.indexOf('vmAwait'), -1, 'it waited for a machine that had already dialled in');
    assert.equal(called.filter((c) => c === 'editor.open').length, 1, 'it never reached the editor');
});

test('and the pane is told what it is doing, not what was written down', async () => {
    //THE CLAIM UNDER THE ONE ABOVE, stated where a stand-in cannot satisfy it
    //by accident: `read()` here strips the live facts, so this passes only if
    //the action asked `all()`.
    const actions = await anApp();
    vms['beta-diy1'] = VM({ running: true, connected: true });

    const said = await actions.call('diy', {});

    assert.ok(said.machines.length, 'no machines in the pool at all');
    assert.equal(said.machines[0].running, true,
        'the pool drew a running machine as off — it is reading the record, not asking');
});

test('it remembers the machine and the sign-in, so it only asks once', async () => {
    const actions = await anApp();
    const it = await start(actions);

    await actions.call('diyOpen', { id: it.id, machine: 'beta-diy1', signIn: 'diy-b1', _fromTest: true });

    const list = await actions.call('diy', {});
    const mine = list.items[0];
    assert.equal(mine.machine.name, 'beta-diy1');
    assert.equal(mine.machine.running, true);
});

test('a machine already up and on the branch is only opened', async () => {
    const actions = await anApp();
    vms['beta-diy1'] = VM({ running: true, connected: true, forTasks: false, branch: 'diy/flat', holdsCredential: true });

    const it = await start(actions);
    await actions.call('diyOpen', { id: it.id, machine: 'beta-diy1', _fromTest: true });

    assert.deepEqual(called.filter((c) => c !== 'credentialsHeld' && c !== 'branchBoard'), ['editor.open']);
});

//---- what it refuses to guess ----------------------------------------------

test('with no cut there is nowhere for the work to go', async () => {
    const actions = await anApp();
    const it = await actions.call('diyStart', { title: 'no cut on this' });

    await assert.rejects(
        () => actions.call('diyOpen', { id: it.id, machine: 'beta-diy1', _fromTest: true }),
        /no branch cut, so there is nowhere for the work to go/
    );
    assert.equal(called.filter((c) => c === 'editor.open').length, 0);
});

//---- WHAT IS NOT A DECISION ------------------------------------------------
//
//IT USED TO REFUSE HERE, AND NAME THE ONE MACHINE IT MEANT. Which reads as
//careful and is not: with one diy machine and one diy sign-in, the refusal —
//and the dialog the pane put in front of it — asked a question whose only
//correct answer was already on the screen behind it. The pane drew "none yet"
//against a workspace that had everything, and the press asked which of the one.
//
//SO: ONE CANDIDATE IS THE ANSWER, TWO IS A QUESTION. Which one has last week's
//work on its disk is not a fact this app holds, so it will not pick between
//two — but it will not pretend one is a choice either.

test('one free diy machine is not a decision, so it takes it', async () => {
    const actions = await anApp();
    const it = await start(actions);

    const said = await actions.call('diyOpen', { id: it.id, _fromTest: true });

    assert.equal(said.machine, 'beta-diy1');
    assert.ok(said.did.some((d) => /beta-diy1/.test(d) && /free/.test(d)),
        'it did not say which machine it took: ' + JSON.stringify(said.did));

    //AND IT IS REMEMBERED, so the second press is not a second decision.
    const list = await actions.call('diy', {});
    assert.equal(list.items[0].machine.name, 'beta-diy1');
});

test('one free diy sign-in is not a decision either', async () => {
    const actions = await anApp();
    const it = await start(actions);

    const said = await actions.call('diyOpen', { id: it.id, _fromTest: true });

    assert.equal(said.signIn, 'diy-b1');
    assert.ok(called.indexOf('guestLend') >= 0, 'it never lent one');
    assert.equal(called.filter((c) => c === 'editor.open').length, 1, 'it did not reach the editor');
});

test('but TWO free machines is a question, and the refusal carries both', async () => {
    vms['beta-diy2'] = VM({ name: 'beta-diy2' });
    const actions = await anApp();
    const it = await start(actions);

    await assert.rejects(
        () => actions.call('diyOpen', { id: it.id, _fromTest: true }),
        (e) => {
            assert.match(e.message, /has no machine yet/);
            //THE LIST IS THE POINT. This is the moment somebody is least likely
            //to know which machines exist, and a refusal they have to go to
            //another tab to act on is one that costs the press.
            assert.match(e.message, /beta-diy1/);
            assert.match(e.message, /beta-diy2/);
            return true;
        }
    );
    assert.equal(called.filter((c) => c === 'editor.open').length, 0);
});

test('and TWO free sign-ins, which names them and not the supervisor', async () => {
    const actions = await anApp();
    guests.push({ name: 'diy-b2', role: 'diy', has: true, holder: null });
    const it = await start(actions);

    await assert.rejects(
        () => actions.call('diyOpen', { id: it.id, _fromTest: true }),
        (e) => {
            assert.match(e.message, /no sign-in chosen/);
            assert.match(e.message, /diy-b1/);
            assert.match(e.message, /diy-b2/);
            //A SUPERVISOR SIGN-IN IS NOT A THING TO OFFER HERE. Lending one to
            //a runner is refused downstream anyway, and offering it makes the
            //refusal something the person walks into.
            assert.ok(!/super-a2/.test(e.message), e.message);
            return true;
        }
    );

    //AND IT STOPPED BEFORE THE EDITOR, having already done the earlier steps —
    //which is correct: they are what it could do, and each is skipped next time.
    assert.equal(called.filter((c) => c === 'editor.open').length, 0);
});

//---- AND WHAT NOTHING AT ALL LOOKS LIKE ------------------------------------
//
//"NONE FREE" AND "TWO FREE" ARE THE SAME REFUSAL WITH DIFFERENT ADVICE, and the
//advice is the whole value: one of them is a press away and the other needs a
//machine built or a key added. The version before this said "this host has no
//machines to take" for a host with three, none tagged.

test('no diy machine says what would make one, rather than that there are none', async () => {
    vms = { 'beta-worker1': VM({ name: 'beta-worker1', tags: ['worker'] }) };
    const actions = await anApp();
    const it = await start(actions);

    await assert.rejects(
        () => actions.call('diyOpen', { id: it.id, _fromTest: true }),
        (e) => {
            assert.match(e.message, /tagged "diy"/);
            //A WORKER IS NOT AN ALTERNATIVE and the refusal says why: the queue
            //takes it back underneath you.
            assert.ok(!/beta-worker1/.test(e.message), 'it offered a worker: ' + e.message);
            return true;
        }
    );
});

test('every diy machine already taken is a different sentence again', async () => {
    const actions = await anApp();
    const mine = await start(actions);
    await actions.call('diyOpen', { id: mine.id, _fromTest: true });

    //A SECOND CUT, because one piece of work per cut is a separate rule and
    //this test is not about it.
    const other = await actions.call('diyStart', { title: 'something else', cut: 'diy/other' });

    await assert.rejects(
        () => actions.call('diyOpen', { id: other.id, _fromTest: true }),
        /already taken by something else/
    );
});

test('no diy sign-in points at Keys, and says a worker key will not do', async () => {
    const actions = await anApp();
    guests = [{ name: 'worker-b2', role: 'worker', has: true, holder: null }];
    const it = await start(actions);

    await assert.rejects(
        () => actions.call('diyOpen', { id: it.id, _fromTest: true }),
        (e) => {
            assert.match(e.message, /Claude DIY/);
            assert.ok(!/worker-b2/.test(e.message), 'it offered a worker key: ' + e.message);
            return true;
        }
    );
});

test('a machine that is not in the register is refused by name', async () => {
    const actions = await anApp();
    const it = await start(actions);

    await assert.rejects(
        () => actions.call('diyOpen', { id: it.id, machine: 'nope', _fromTest: true }),
        /no machine called "nope"/
    );
});

test('nothing is remembered when the press falls over', async () => {
    const actions = await anApp();
    //NO DIY SIGN-IN, so it gets as far as step 6 and stops there. It has to
    //fall over somewhere REAL: the steps before this one have already run and
    //changed the machine, which is exactly the state this claim is about.
    guests = [{ name: 'worker-b2', role: 'worker', has: true, holder: null }];
    const it = await start(actions);

    await assert.rejects(() => actions.call('diyOpen', { id: it.id, machine: 'beta-diy1', _fromTest: true }));

    //WRITTEN AFTER, NOT BEFORE. A piece of work claiming a sign-in that was
    //never lent is a seat that draws as ready and cannot be opened.
    const list = await actions.call('diy', {});
    assert.equal(list.items[0].signIn, null);
    assert.equal(list.items[0].machine, null, 'it remembered a machine it never finished taking');
});

//---- STOPPING FOR THE DAY, AND THROWING THE DISK AWAY -----------------------
//
//TWO ACTS, DELIBERATELY NOT ONE. The queue only has the one: a worker finishes
//and `putAway` takes the credential, stops the machine and rolls it back,
//because between tasks a machine should hold nothing. A person's seat is the
//opposite — the whole point of it is that what is on that disk is theirs and
//stays theirs until they say so.
//
//SO SLEEPING RELEASES THE KEY AND STOPS THE MACHINE AND NOTHING ELSE. The
//credential comes home because it is the one thing that is NOT the person's: it
//is lent, it is finite, and a machine powered off for a week holding one is a
//week the queue cannot use it.

test('sleeping takes the sign-in back and stops the machine, and rolls nothing back', async () => {
    const actions = await anApp();
    const it = await start(actions);
    await actions.call('diyOpen', { id: it.id, _fromTest: true });
    called = [];

    await actions.call('diySleep', { id: it.id });

    assert.ok(called.indexOf('vmCredentialsForget') >= 0, 'it left a live credential on a machine it powered off');
    assert.ok(called.indexOf('vmStop') >= 0, 'it did not stop the machine');
    assert.equal(called.indexOf('vmSnapshotRestore'), -1, 'it rolled back an afternoon of work');
    assert.equal(called.indexOf('vmWorkspace'), -1);
});

test('and the KEY GOES FIRST, while the machine can still be spoken to', async () => {
    //THE ROLLBACK WOULD REMOVE THE FILE ANYWAY — but a machine that fails to
    //shut down would then sit there holding a LIVE credential. Taking it back
    //means it stops existing on that disk, not that the register stops saying
    //so. Same order and same reason as ../../src/app/queue/putting.js.
    const actions = await anApp();
    const it = await start(actions);
    await actions.call('diyOpen', { id: it.id, _fromTest: true });
    called = [];

    await actions.call('diySleep', { id: it.id });

    const key = called.indexOf('vmCredentialsForget');
    const stop = called.indexOf('vmStop');
    assert.ok(key >= 0 && stop >= 0, called.join(' | '));
    assert.ok(key < stop, 'it powered the machine off before taking the credential back');
});

test('the seat KEEPS the machine when it sleeps, because the work is still on it', async () => {
    //HANDING IT TO ANOTHER PIECE OF WORK would be handing over somebody's
    //afternoon. Waking it is the whole point of sleeping rather than clearing.
    const actions = await anApp();
    const it = await start(actions);
    await actions.call('diyOpen', { id: it.id, _fromTest: true });

    await actions.call('diySleep', { id: it.id });

    const said = await actions.call('diy', {});
    assert.equal(said.items[0].machine.name, 'beta-diy1');
    assert.equal(said.machines[0].usedBy, 'flat workspace layout', 'it let another seat take the machine');
});

test('and waking it is the press that already exists, laying nothing down again', async () => {
    //`diyOpen` SKIPS EVERY STEP THAT IS ALREADY TRUE, so a slept machine wakes,
    //takes its sign-in back and opens. The workspace is not laid a second time —
    //re-laying one over work in progress is the quiet failure that whole rule
    //exists for.
    const actions = await anApp();
    const it = await start(actions);
    await actions.call('diyOpen', { id: it.id, _fromTest: true });
    await actions.call('diySleep', { id: it.id });
    called = [];

    await actions.call('diyOpen', { id: it.id, _fromTest: true });

    assert.ok(called.indexOf('vmStart') >= 0, 'it did not wake the machine');
    assert.equal(called.indexOf('vmWorkspace'), -1, 'it laid the workspace over work in progress');
    assert.ok(called.indexOf('guestLend') >= 0, 'it never lent the sign-in back');
    assert.equal(called.filter((c) => c === 'editor.open').length, 1);
});

test('sleeping a seat with no machine is refused rather than reported done', async () => {
    const actions = await anApp();
    const it = await start(actions);

    await assert.rejects(() => actions.call('diySleep', { id: it.id }), /no machine/);
});

//---- and the one that discards a disk --------------------------------------

test('clearing rolls it back, and takes the key back BEFORE it does', async () => {
    //THE ROLLBACK WOULD DISCARD THE CREDENTIAL FILE WITH THE DISK. Taking it
    //back first is what brings the REFRESHED one home — a session in there
    //rotates the token, and this host handing out one several rotations behind
    //is a failure already on record.
    const actions = await anApp();
    const it = await start(actions);
    await actions.call('diyOpen', { id: it.id, _fromTest: true });
    called = [];

    await actions.call('diyClear', { id: it.id });

    const key = called.indexOf('vmCredentialsForget');
    const rolled = called.indexOf('vmSnapshotRestore');
    assert.ok(key >= 0, 'it discarded the credential with the disk');
    assert.ok(rolled >= 0, 'it did not roll the machine back');
    assert.ok(key < rolled, 'it rolled back before taking the credential home');
});

test('and it is rolled back AT REST, because VirtualBox will not do it running', async () => {
    const actions = await anApp();
    const it = await start(actions);
    await actions.call('diyOpen', { id: it.id, _fromTest: true });
    called = [];

    await actions.call('diyClear', { id: it.id });

    assert.ok(called.indexOf('vmStop') < called.indexOf('vmSnapshotRestore'),
        'it tried to restore a snapshot under a running machine');
});

test('the seat LETS GO of a machine it cleared, so the pool has it back', async () => {
    //IT HOLDS NOTHING OF THIS PIECE OF WORK ANY MORE, so keeping its name would
    //hold it out of the pool for a seat with no claim on it — see `freeIn`.
    const actions = await anApp();
    const it = await start(actions);
    await actions.call('diyOpen', { id: it.id, _fromTest: true });

    await actions.call('diyClear', { id: it.id });

    const said = await actions.call('diy', {});
    assert.equal(said.items[0].machine, null, 'the seat still claims a machine it gave back');
    assert.equal(said.items[0].signIn, null);
    assert.equal(said.machines[0].usedBy, null, 'the machine is still held out of the pool');
});

test('a machine with nowhere to roll back to is REFUSED, not quietly powered off', async () => {
    //OTHERWISE IT SHUTS DOWN, LEAVES THE DISK EXACTLY AS DIRTY AS IT WAS, and
    //reports success at having cleared it.
    vms['beta-diy1'] = VM({ baseSnapshot: null });
    const actions = await anApp();
    const it = await start(actions);
    await actions.call('diyOpen', { id: it.id, _fromTest: true });
    called = [];

    await assert.rejects(() => actions.call('diyClear', { id: it.id }), /no base snapshot/);
    assert.equal(called.indexOf('vmSnapshotRestore'), -1);
    assert.equal(called.indexOf('vmStop'), -1, 'it powered a machine off it could not clear');
});

test('and the cut is never touched by either of them', async () => {
    //THE THING SOMEBODY IS MOST AFRAID OF when pressing a button that says it
    //discards everything. The branch and everything pushed to it are on THIS
    //host; nothing here goes near them.
    const actions = await anApp();
    const it = await start(actions);
    await actions.call('diyOpen', { id: it.id, _fromTest: true });

    await actions.call('diyClear', { id: it.id });

    const said = await actions.call('diy', {});
    assert.equal(said.items[0].cut, 'diy/flat', 'clearing the machine took the cut with it');
});
