const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const makeDoing = require('../../src/app/vms/vbox/doing');
const makeReading = require('../../src/app/vms/vbox/reading');
const { treeOf, GENERATED } = require('../../src/app/vms/vbox/doing');

//---------------------------------------------------------------------------
//starting, stopping, snapshotting and deleting a machine.
//
//NO VirtualBox. Several of these are not one command but an ORDER that has to
//hold, and an order is exactly what a stand-in can check: it records what was
//asked and in what sequence.
//
//THE CLAIMS:
//
//  * deleting a machine asks WHERE IT LIVES before unregistering it, because
//    afterwards there is nothing left to ask — and waits for the SESSION, not
//    the state, since powered-off-is-not-ready is the window a delete is raced
//    in
//  * the previous boot is kept, and keeping it NEVER STOPS A START — a machine
//    that would not boot because a log could not be renamed would be a
//    debugging aid causing the fault it exists to explain
//  * stopping is the BUTTON, not the plug
//  * a sweep deletes only what VirtualBox generated, and NAMES whatever it
//    leaves — deleting a directory is not a thing to be approximately right
//    about
//---------------------------------------------------------------------------

let asked, answers, said, act, read, dir;

beforeEach(() => {
    asked = [];
    answers = {};
    said = [];
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-vbox-'));

    const run = async (args, how) => {
        asked.push(args.join(' '));
        const key = args.join(' ');
        const out = answers[key];
        if (out === undefined) throw new Error('VBoxManage: no such thing: ' + key);
        return typeof out === 'function' ? out() : out;
    };

    const say = {
        info: (t) => said.push(t), warn: (t) => said.push(t),
        good: (t) => said.push(t), bad: (t) => said.push(t)
    };

    read = makeReading(run, { say, sleep: async () => {} });
    act = makeDoing(run, async (fn) => fn(), read, { say });
});

//---------------------------------------------------------------------------
//STARTING, AND THE BOOT BEFORE IT.
//---------------------------------------------------------------------------

test('starting a machine keeps what the last boot said', async () => {
    const boot = path.join(dir, 'serial.log');
    fs.writeFileSync(boot, 'the previous boot');

    answers['showvminfo one --machinereadable'] = 'uartmode1="file,' + boot + '"';
    answers['startvm one --type gui'] = 'started';

    await act.start('one');

    //STARTING AGAIN WRITES OVER IT, and that is exactly the boot somebody wants
    //when a machine will not come up.
    assert.equal(fs.readFileSync(boot.replace(/\.log$/, '.previous.log'), 'utf8'), 'the previous boot');
    assert.ok(asked.includes('startvm one --type gui'));
});

test('and keeping it NEVER stops a start', async () => {
    //A MACHINE THAT WOULD NOT BOOT because a log could not be renamed would be a
    //debugging aid causing the fault it exists to explain.
    //
    //THE FAILURE HAS TO BE ONE THAT THROWS. A path that simply does not exist is
    //answered by a check further up and never reaches the catch — so this asks
    //about a machine VirtualBox will not describe at all, which is what happens
    //while one is being deleted underneath.
    answers['startvm one --type gui'] = 'started';

    await act.start('one');
    assert.ok(asked.includes('startvm one --type gui'), asked.join(' | '));
});

test('and a boot log in a folder that is not there does not stop one either', async () => {
    answers['showvminfo one --machinereadable'] = 'uartmode1="file,' + path.join(dir, 'nope', 'no.log') + '"';
    answers['startvm one --type gui'] = 'started';

    await act.start('one');
    assert.ok(asked.includes('startvm one --type gui'));
});

test('an empty log is not a boot and does not take the only slot there is', async () => {
    const boot = path.join(dir, 'serial.log');
    const previous = path.join(dir, 'serial.previous.log');
    fs.writeFileSync(boot, '');
    fs.writeFileSync(previous, 'a real record');

    answers['showvminfo one --machinereadable'] = 'uartmode1="file,' + boot + '"';
    answers['startvm one --type gui'] = 'started';

    await act.start('one');
    assert.equal(fs.readFileSync(previous, 'utf8'), 'a real record',
        'an empty boot pushed the real one out');
});

test('a machine whose serial goes nowhere has no boot to keep', async () => {
    for (const uart of ['disconnected', 'server,\\\\.\\pipe\\thing', '']) {
        answers['showvminfo one --machinereadable'] = 'uartmode1="' + uart + '"';
        assert.equal(await act.keepThePreviousBoot('one'), null, uart);
    }
});

//---------------------------------------------------------------------------
//STOPPING.
//---------------------------------------------------------------------------

test('stopping is the button, and pulling the plug is a separate choice', async () => {
    answers['controlvm one acpipowerbutton'] = 'ok';
    answers['controlvm one poweroff'] = 'ok';

    await act.stop('one');
    await act.stop('one', true);

    //A GUEST MID-WRITE SHOULD BE ALLOWED TO FINISH.
    assert.deepEqual(asked, ['controlvm one acpipowerbutton', 'controlvm one poweroff']);
});

test('the cable is pulled from outside, not from inside the guest', async () => {
    answers['controlvm one setlinkstate1 off'] = 'ok';
    answers['controlvm one setlinkstate1 on'] = 'ok';

    await act.setLink('one', false);
    await act.setLink('one', true);

    //TURNING AN INTERFACE OFF FROM INSIDE is a different experiment: the machine
    //knows it did it and can undo it. This is what it cannot tell from the rest
    //of the world disappearing.
    assert.deepEqual(asked, ['controlvm one setlinkstate1 off', 'controlvm one setlinkstate1 on']);
});

//---------------------------------------------------------------------------
//THE CONSOLE, WRITTEN SOMEWHERE THIS HOST CAN READ IT.
//---------------------------------------------------------------------------

test('the console goes to a raw file on COM1, which is what the guest writes to', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'okc-serial-')), 'deep', 'one.log');
    answers['modifyvm one --uart1 0x3F8 4 --uartmode1 file ' + file] = 'ok';

    const said = await act.setSerial('one', file);

    //0x3F8 / IRQ 4 IS COM1, which is what `console=ttyS0` means in the guest —
    //so a different port is a console nothing writes to.
    assert.deepEqual(said, { name: 'one', on: true, file });
    assert.ok(asked[0].includes('--uart1 0x3F8 4'), asked[0]);
    //A RAW FILE RATHER THAN A PIPE: a file survives the machine going away, and
    //reading it AFTER a boot that did not finish is the whole point.
    assert.ok(asked[0].includes('--uartmode1 file'), asked[0]);
});

test('and its folder is made first, because VirtualBox will not', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okc-serial-'));
    const file = path.join(root, 'not', 'there', 'yet', 'one.log');
    answers['modifyvm one --uart1 0x3F8 4 --uartmode1 file ' + file] = 'ok';

    await act.setSerial('one', file);

    //A MACHINE THAT WOULD NOT START because its console had nowhere to go would
    //be a debugging aid causing the fault it exists to explain.
    assert.ok(fs.existsSync(path.dirname(file)), 'the folder was not made');
});

test('and it can be turned off again, which is not the same as pointing it nowhere', async () => {
    answers['modifyvm one --uart1 off'] = 'ok';

    assert.deepEqual(await act.setSerial('one', null), { name: 'one', on: false, file: null });
    assert.deepEqual(asked, ['modifyvm one --uart1 off']);
});

test('a machine that is off has nothing on screen, and says so in better words', async () => {
    answers['showvminfo one --machinereadable'] = 'VMState="poweroff"';

    await assert.rejects(() => act.screenshot('one', 'shot.png'),
        /is not running, so it has nothing on screen/);
    assert.ok(!asked.some((a) => /screenshotpng/.test(a)), 'it asked anyway');
});

//---------------------------------------------------------------------------
//SNAPSHOTS ARE A TREE.
//---------------------------------------------------------------------------

const TREE = [
    'SnapshotName="base"',
    'SnapshotUUID="aaa"',
    'SnapshotName-1="after the install"',
    'SnapshotUUID-1="bbb"',
    'SnapshotName-1-1="with the agent"',
    'SnapshotUUID-1-1="ccc"',
    'CurrentSnapshotName="with the agent"',
    'CurrentSnapshotNode="SnapshotName-1-1"'
].join('\n');

test('the key carries its place in the tree, so a parent is the key with its last segment gone', () => {
    const out = treeOf(TREE, {});

    assert.deepEqual(out.snapshots.map((s) => [s.name, s.depth, s.parent]), [
        ['base', 0, null],
        ['after the install', 1, 'SnapshotName'],
        ['with the agent', 2, 'SnapshotName-1']
    ]);
    assert.equal(out.deepest, 2);
});

test('it comes back depth first, so a list rendered in order reads as the tree', () => {
    //WRITTEN OUT OF TREE ORDER ON PURPOSE. With the lines already in depth-first
    //order, a version that simply returned them as they came would produce the
    //same list and this check would prove nothing.
    const out = treeOf([
        'SnapshotName="base"',
        'SnapshotName-1="branch one"',
        'SnapshotName-2="branch two"',
        'SnapshotName-1-1="under one"'
    ].join('\n'), {});

    assert.deepEqual(out.snapshots.map((s) => s.name),
        ['base', 'branch one', 'under one', 'branch two']);
});

test('which one is current is said, and it is the node rather than the name', () => {
    const out = treeOf(TREE, {});
    assert.equal(out.current, 'with the agent');
    assert.equal(out.snapshots.find((s) => s.current).name, 'with the agent');
});

test('when each was taken comes from elsewhere and is carried through', () => {
    const out = treeOf(TREE, { aaa: '2026-01-01T00:00:00Z' });
    assert.equal(out.snapshots[0].taken, '2026-01-01T00:00:00Z');
    assert.equal(out.snapshots[1].taken, null);
});

test('one whose parent is not there is shown flat rather than dropped', () => {
    //IT SHOULD NOT HAPPEN, and dropping it silently would be worse than showing
    //it out of place.
    const out = treeOf('SnapshotName-4-9="an orphan"', {});
    assert.equal(out.snapshots.length, 1);
    assert.equal(out.snapshots[0].name, 'an orphan');
});

test('no snapshots at all is an empty tree, not a failure', async () => {
    //VBoxManage TREATS IT AS AN ERROR. It is not a problem here.
    assert.deepEqual(await act.snapshots('one'),
        { snapshots: [], current: null, currentNode: null, deepest: 0 });
});

test('deleting one is given its own timeout, because a merge must not be abandoned', async () => {
    let how = null;
    const run = async (args, opts) => { how = opts; return 'ok'; };
    const one = makeDoing(run, async (fn) => fn(), read, { say: { warn() {}, info() {}, good() {}, bad() {} } });

    await one.deleteSnapshot('one', 'base');
    //THE MERGE IS PROPORTIONAL TO HOW MUCH CHANGED, and the default would give
    //up part way through — the one moment a disk should not be left alone.
    assert.ok(how.timeout >= 900000, 'it used the default timeout: ' + how.timeout);
});

//---------------------------------------------------------------------------
//DELETING A MACHINE.
//---------------------------------------------------------------------------

test('a machine that is not there is nothing to delete', async () => {
    answers['list vms'] = '';
    assert.deepEqual(await act.destroy('gone'), { existed: false });
    assert.ok(!asked.some((a) => /unregistervm/.test(a)));
});

test('where it lives is asked BEFORE it is unregistered', async () => {
    const folder = path.join(dir, 'one');
    fs.mkdirSync(folder);

    answers['list vms'] = '"one" {a}';
    answers['showvminfo one --machinereadable'] = 'VMState="poweroff"\nSessionState="Unlocked"\nCfgFile="' + path.join(folder, 'one.vbox') + '"';
    answers['unregistervm one --delete'] = 'ok';

    const out = await act.destroy('one');

    //AFTERWARDS THERE IS NOTHING LEFT TO ASK.
    const info = asked.indexOf('showvminfo one --machinereadable');
    const gone = asked.indexOf('unregistervm one --delete');
    assert.ok(info >= 0 && info < gone, asked.join(' | '));
    assert.equal(out.existed, true);
    assert.equal(out.folder, folder);
});

test('one that is running is powered off first, and said out loud', async () => {
    let state = 'running';
    answers['list vms'] = '"one" {a}';
    answers['showvminfo one --machinereadable'] = () =>
        'VMState="' + state + '"\nSessionState="Unlocked"\nCfgFile="' + path.join(dir, 'one', 'one.vbox') + '"';
    answers['controlvm one poweroff'] = () => { state = 'poweroff'; return 'ok'; };
    answers['unregistervm one --delete'] = 'ok';

    await act.destroy('one');

    assert.ok(asked.includes('controlvm one poweroff'), asked.join(' | '));
    assert.match(said.join(' | '), /powering one off \(was "running"\)/);
});

//---------------------------------------------------------------------------
//THE SWEEP IS DELIBERATELY NARROW.
//---------------------------------------------------------------------------

test('only what VirtualBox generated is deleted', () => {
    const folder = path.join(dir, 'sweep');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'one.vbox'), 'x');
    fs.writeFileSync(path.join(folder, 'one.vbox-prev'), 'x');
    fs.writeFileSync(path.join(folder, 'Unattended-one-preseed.cfg'), 'x');
    fs.writeFileSync(path.join(folder, 'thing.viso'), 'x');
    fs.mkdirSync(path.join(folder, 'Logs'));
    fs.writeFileSync(path.join(folder, 'Logs', 'VBox.log'), 'x');

    const left = act.sweepUp(folder);
    assert.deepEqual(left, []);
    assert.equal(fs.existsSync(folder), false, 'the folder was left behind empty');
});

test('and anything else is left alone AND named', () => {
    const folder = path.join(dir, 'sweep2');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'one.vbox'), 'x');
    fs.writeFileSync(path.join(folder, 'notes-somebody-put-here.txt'), 'mine');

    const left = act.sweepUp(folder);

    //DELETING A DIRECTORY IS NOT A THING TO BE APPROXIMATELY RIGHT ABOUT, and
    //somebody may have put a file in there.
    assert.deepEqual(left, ['notes-somebody-put-here.txt']);
    assert.equal(fs.readFileSync(path.join(folder, 'notes-somebody-put-here.txt'), 'utf8'), 'mine');
    assert.match(said.join(' | '), /still holds notes-somebody-put-here\.txt/);
    assert.match(said.join(' | '), /not this app's to delete, so it was left/);
});

test('what counts as generated is a short list, not a guess', () => {
    for (const yes of ['one.vbox', 'one.vbox-prev', 'Unattended-x.sh', 'thing.viso']) {
        assert.equal(GENERATED.test(yes), true, yes);
    }
    for (const no of ['one.vdi', 'notes.txt', 'important.iso', 'snapshot.vdi']) {
        assert.equal(GENERATED.test(no), false, no);
    }
});
