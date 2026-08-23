const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', 'src', 'app');
const makeDesk = require(path.join(APP, 'runners', 'guests', 'desk.js'));

//---------------------------------------------------------------------------
//WHICH MACHINE HOLDS THE SIGN-IN DESK.
//
//THE CLAIM: every Claude sign-in this host holds comes off ONE machine, at a
//user that exists for nothing else. Runners used to be borrowed one at a time to
//be signed in and then wiped — a machine brought up, a person waited on, a
//machine put away, per credential.
//
//So a runner being refused is not a technicality, and the refusal says why at
//length. The app being ported from shortened that sentence once and a drill
//noticed the explanation had gone.
//---------------------------------------------------------------------------

const sup = (name, over) => Object.assign({ name, tags: ['supervisor'] }, over || {});
const runner = (name, over) => Object.assign({ name, tags: ['worker'] }, over || {});

function deskWith(rows, up) {
    const all = rows || [];
    return makeDesk({
        ours: {
            read: () => all,
            get: (n) => {
                const found = all.filter(v => v.name === n)[0];
                if (!found) throw new Error('"' + n + '" is not a virtual machine this app made.');
                return found;
            }
        },
        connected: (n) => (up || []).indexOf(n) >= 0
    });
}

//---------------------------------------------------------------------------
//1. WITH NOTHING TO ASK.
//---------------------------------------------------------------------------

test('no supervisor at all is refused, and says how to get one', () => {
    const d = deskWith([runner('kit-1')]);
    assert.throws(() => d.which(), /no supervisor machine on this host.*Supervisor machine.*box ticked/s);
});

test('and it says what a supervisor is FOR, not just that one is missing', () => {
    const d = deskWith([]);
    assert.throws(() => d.which(), /a user that exists for nothing else/);
});

//---------------------------------------------------------------------------
//2. A RUNNER IS REFUSED, AT LENGTH.
//---------------------------------------------------------------------------

test('asking a runner for a sign-in desk is refused with the whole reason', () => {
    //THE ONE THAT WAS SHORTENED ONCE AND CAUGHT BY A DRILL. "Not a supervisor
    //machine" answers what and not why, and the why is the thing this app
    //deliberately moved.
    const d = deskWith([sup('super-1'), runner('kit-1')]);

    assert.throws(() => d.which('kit-1'), (e) =>
        /is a runner/.test(e.message)
        && /only a supervisor machine has a sign-in desk/.test(e.message)
        && /handed a credential when it works and never asks for one/.test(e.message));
});

test('a machine this app did not make is refused by the register', () => {
    const d = deskWith([sup('super-1')]);
    assert.throws(() => d.which('somebody-elses'), /not a virtual machine this app made/);
});

//---------------------------------------------------------------------------
//3. PICKING ONE.
//---------------------------------------------------------------------------

test('one supervisor is the answer, running or not', () => {
    //Not folded in with starting it: bringing a machine up is a minute of
    //waiting, and a function that sometimes does it is one nobody can predict.
    const d = deskWith([sup('super-1'), runner('kit-1')]);
    assert.equal(d.which(), 'super-1');
});

test('naming the supervisor explicitly gives that one', () => {
    const d = deskWith([sup('super-1'), sup('super-2')], ['super-1']);
    assert.equal(d.which('super-2'), 'super-2');
});

test('two supervisors and one up picks the one that is up', () => {
    const d = deskWith([sup('super-1'), sup('super-2')], ['super-2']);
    assert.equal(d.which(), 'super-2');
});

test('two supervisors and neither up is asked about rather than guessed', () => {
    //A sign-in is a person at a browser. Sending them to the wrong machine
    //wastes the one part of this that nothing can automate.
    const d = deskWith([sup('super-1'), sup('super-2')], []);
    assert.throws(() => d.which(), /more than one supervisor machine \(super-1, super-2\). Say which one/);
});

test('two supervisors and BOTH up is also asked about', () => {
    const d = deskWith([sup('super-1'), sup('super-2')], ['super-1', 'super-2']);
    assert.throws(() => d.which(), /Say which one/);
});

//---------------------------------------------------------------------------
//4. WHAT COUNTS AS A SUPERVISOR.
//---------------------------------------------------------------------------

test('the tag is what decides, whatever else the machine carries', () => {
    const d = deskWith([sup('super-1', { tags: ['test', 'SUPERVISOR'] })]);
    assert.equal(d.which(), 'super-1', 'the tag was not matched case-insensitively');
});

test('a machine with no tags at all is not one', () => {
    const d = deskWith([{ name: 'bare' }, sup('super-1')]);
    assert.equal(d.which(), 'super-1');
    assert.equal(d.isSupervisor({ name: 'bare' }), false);
});

test('a tag that merely contains the word does not count', () => {
    //`supervisor-ish` is not the supervisor tag, and a machine carrying it must
    //not become the one place every credential on this host comes from.
    const d = deskWith([{ name: 'nearly', tags: ['supervisorish'] }]);
    assert.throws(() => d.which(), /no supervisor machine/);
});
