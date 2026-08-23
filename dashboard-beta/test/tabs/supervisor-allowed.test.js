const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const allowed = require('../../src/app/supervisor/allowed');

//---------------------------------------------------------------------------
//WHAT A SUPERVISOR MAY ASK THIS HOST FOR.
//
//THIS IS THE FENCE THAT COUNTS. There are three — the MCP server on the machine
//offers only these verbs as tools, Claude Code is launched there with every
//built-in denied, and this one refuses anything off the list whatever asked. The
//first two live where a supervisor could reach them; this one does not, which is
//why the file on the machine being edited gains nothing.
//
//AN ALLOWLIST, NOT A FILTER, and the consequence is the point: adding an action
//to this app adds nothing to what a supervisor can do. A deny-list, or a rule
//like "anything that only reads", would grant each new capability on the day it
//was written, by somebody not thinking about supervisors at all.
//---------------------------------------------------------------------------

test('there is a list, and it is not empty', () => {
    //A GATE THAT LETS EVERYTHING THROUGH and a gate with nothing behind it look
    //identical from one assertion.
    assert.ok(Object.keys(allowed.MAY).length > 40,
        'only ' + Object.keys(allowed.MAY).length + ' verbs — this file is meant to hold about fifty');
});

test('every verb carries the reason it is on the list', () => {
    //THE REASON IS NOT DECORATION: it is shown to the supervisor when it asks
    //what it may do, so it can choose without guessing — and it is what somebody
    //adding a line here has to be able to write.
    for (const [what, why] of Object.entries(allowed.MAY)) {
        assert.equal(typeof why, 'string', what + ' has no reason');
        assert.ok(why.trim().length > 15, what + ' has a reason too short to be one: ' + JSON.stringify(why));
    }
});

//---- what is deliberately absent ---------------------------------------------
//
//EACH OF THESE IS A DECISION rather than an oversight, and each is written down
//in the header of the file. A test is what stops one arriving by accident.

test('it may not approve anything, including what it wrote itself', () => {
    //APPROVING IS ALREADY REFUSED OVER THE WIRE, and a supervisor is over the
    //wire. It may PROPOSE — the saves are on the list — and a person reads it.
    for (const no of ['jobApprove', 'promptApprove', 'contractApprove']) {
        assert.equal(allowed.may(no), false, no + ' is on the list');
    }
    //AND THE PROPOSING HALF IS, or it could not do its job at all.
    for (const yes of ['jobSave', 'promptSave', 'contractSave']) {
        assert.equal(allowed.may(yes), true, yes + ' is not on the list');
    }
});

test('it may not delete anything', () => {
    //A PROJECT MANAGER THAT CAN THROW WORK AWAY is one bad turn from an empty
    //board, and nothing it does needs it.
    for (const no of ['taskRemove', 'branchDelete', 'branchDeleteRemote', 'jobForget', 'prCutForget']) {
        assert.equal(allowed.may(no), false, no + ' is on the list');
    }
});

test('it may not touch a machine, being one itself', () => {
    //GIVING IT THE POWER TO START, SNAPSHOT OR DELETE MACHINES makes it the
    //administrator of the thing it runs on.
    const machines = Object.keys(allowed.MAY).filter((k) => /^vm/.test(k));
    assert.deepEqual(machines, [], 'a vm verb reached the list: ' + machines.join(', '));

    for (const no of ['vmList', 'vmStart', 'vmRemove', 'vmDispatch', 'vmShell']) {
        assert.equal(allowed.may(no), false, no + ' is on the list');
    }
});

test('it may not see a credential or a key', () => {
    //"A MODEL MAY KNOW SOMETHING WAS DONE IN THE KEYS TAB WITHOUT KNOWING WHAT"
    //is the rule this app is built to. It does not need to see one to use one.
    const keys = Object.keys(allowed.MAY).filter((k) => /credential|key|token|secret|sign/i.test(k));
    assert.deepEqual(keys, [], 'something key-shaped reached the list: ' + keys.join(', '));
});

test('it may open a pull request and may not land one', () => {
    //THE LINE RATHER THAN AN ABSENCE OF ONE. Landing changes what everybody else
    //builds on, and everything before it is reversible from GitHub.
    assert.equal(allowed.may('prCutMake'), true, 'it cannot send work out at all');
    assert.equal(allowed.may('prComment'), true);
    assert.equal(allowed.may('prCutLand'), false, 'it can merge');
    assert.equal(allowed.may('prCutUpdate'), false, 'it can close somebody else\'s pull requests');
});

test('it may not judge its own delivery', () => {
    //A SUPERVISOR JUDGING ITS OWN WORK is a worker marking its own homework. It
    //may QUEUE a judgement, which is somebody else doing it.
    assert.equal(allowed.may('taskJudge'), false);
    assert.equal(allowed.may('judgementQueue'), true, 'it cannot ask for work to be judged at all');
});

//---- how it answers ------------------------------------------------------------

test('a word nobody put on the list is refused, prototype or not', () => {
    //`MAY[what]` WOULD ANSWER WITH SOMETHING FROM Object'S PROTOTYPE, and a
    //lookup that says yes to a word nobody wrote is the whole of this failing.
    for (const no of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf', '']) {
        assert.equal(allowed.may(no), false, JSON.stringify(no) + ' got through');
    }
    assert.equal(allowed.may(null), false);
    assert.equal(allowed.may(undefined), false);
});

test('the refusal says what it MAY do, and never what else exists', () => {
    const said = allowed.refuse('vmRemove');

    //THE THING READING IT IS A MODEL that will otherwise try the same call again
    //with a different spelling.
    assert.match(said, /may not ask for "vmRemove"/);
    assert.match(said, /What it may ask for: /);
    assert.match(said, /named list rather than a filter/);

    //AND IT NEVER HINTS AT WHAT ELSE THIS HOST CAN DO.
    for (const secret of ['vmCreate', 'claudeSignIn', 'prCutLand', 'taskRemove']) {
        assert.equal(said.includes(secret), false, 'the refusal named ' + secret);
    }
});

test('what it is told is sorted, so two answers can be compared', () => {
    const names = allowed.list().map((x) => x.what);
    assert.deepEqual(names, names.slice().sort(), 'the order is not stable');
    assert.equal(names.length, Object.keys(allowed.MAY).length);
    assert.ok(allowed.list().every((x) => x.why), 'a verb was listed with no reason');
});

//---- and it lives in the app, not in core ----------------------------------------

test('it is app logic and sits where app logic sits', () => {
    //THE APP BEING PORTED FROM KEPT THIS IN core/, where it was the only thing in
    //core that knew every verb this particular app happens to have — a scaffold
    //lifted into another project would have carried it.
    assert.ok(fs.existsSync(path.join(__dirname, '..', '..', 'src', 'app', 'supervisor', 'allowed.js')));
    assert.equal(fs.existsSync(path.join(__dirname, '..', '..', 'src', 'app', 'core', 'supervisor')), false,
        'a core/supervisor has appeared');
});

//---- and what the PERSON is shown is the same list -------------------------
//
//TWO READINGS OF ONE FENCE IS HOW A PANE LIES ABOUT A PERMISSION. The Supervisor
//tab's "What it may do" is the only place a person checks what a machine running
//a model is allowed to ask this host for, so it being a SEPARATE list assembled
//from the same data would be a list that agrees until somebody edits one of
//them — and the failure would look like nothing at all.
//
//So `supervisorMay` calls `allowed.list()` and renames one key, and this is the
//assertion that it goes on doing that.

test('the pane is shown exactly what the supervisor is told', async () => {
    const plugin = require('../../src/app/supervisor/server');

    //THE ACTION TABLE STOOD IN FOR, because what is being checked is the answer
    //this plugin defines rather than anything the host does with it.
    const defined = new Map();
    let service = null;
    await plugin({
        app: { host: { actions: { define: (name, spec) => { defined.set(name, spec); return () => {}; } } } },
        log: { on: () => ({ good() {}, warn() {}, bad() {}, info() {} }) },
        state: { app: { doc: () => ({ get: () => ({}), set() {} }) } },
        ours: {},
        //REGISTERING THE DOOR IS NOT WHAT THIS IS ABOUT, so it is accepted and
        //dropped. A stub that threw would make this a test of the door.
        guestApi: { api: () => () => {} }
    }, async (_e, s) => { service = s; });

    assert.ok(service, 'the plugin did not register');
    const may = defined.get('supervisorMay');
    assert.ok(may, 'supervisorMay is not defined, so the pane has nothing behind it');

    const said = may.run({});
    const shown = said.may.map((r) => r.action + ' :: ' + r.why);
    const told = allowed.list().map((r) => r.what + ' :: ' + r.why);

    assert.deepEqual(shown, told,
        'the pane and the supervisor are being handed different lists — one of them is wrong and neither says which');
    assert.equal(said.count, told.length);

    //AND IT HANDS OUT NO WRITE. The pane says "read only" in two places; if a
    //write ever appears, that sentence becomes the lie instead.
    assert.equal(defined.has('supervisorMaySet'), false);
    assert.ok(/read only/i.test(said.note), 'the answer stopped saying it cannot be written');
});
