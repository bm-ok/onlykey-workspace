const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const makePayloads = require('../../src/app/vms/dispatch/payloads');
const makeWatcher = require('../../src/app/vms/dispatch/watcher');

const GUEST = path.join(__dirname, '..', '..', 'src', 'app', 'vms', 'dispatch', 'guest');

//---------------------------------------------------------------------------
//THE FILES THAT RUN ON A MACHINE RATHER THAN HERE.
//
//THE CLAIM WORTH THE MOST: what arrives on the machine is WHAT SOMEBODY WROTE.
//These are read as text and written into a guest, so bundling them would send a
//guest babel's output with this app's own module graph folded into it — and
//`watch-guest.js` would arrive requiring modules that are not there.
//
//AND THE SECOND: a missing or empty payload is refused AT LOAD, not at the
//moment a guest is waiting for it. Otherwise it surfaces as a guest that starts,
//is sent a file that does nothing, and reports success — twenty minutes into
//somebody's run.
//---------------------------------------------------------------------------

test('all three are on disk, and every one of them parses as node', () => {
    //REAL FILES RATHER THAN STRINGS IN A SOURCE FILE is the whole reason this
    //check can exist. `node --check` on a string inside a template literal is
    //not a thing anybody does.
    for (const name of ['job-api.js', 'job-runner.js', 'watch-guest.js']) {
        const file = path.join(GUEST, name);
        assert.ok(fs.existsSync(file), name + ' is not there');
        assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', file]),
            name + ' does not parse, and a guest would be sent it anyway');
    }
});

test('they are copied to dist rather than bundled', () => {
    //WEBPACK MUST NOT FOLD THEM IN. The PAYLOADS list is what carries them, and
    //a payload dropped from it fails as an ENOENT deep inside something else.
    const config = fs.readFileSync(path.join(__dirname, '..', '..', 'webpack.config.js'), 'utf8');
    assert.match(config, /'dispatch', 'guest'\), to: 'guest'/,
        'the guest payloads are not in the PAYLOADS list, so they never reach dist');
});

test('what it reads is what is on disk, byte for byte', () => {
    const p = makePayloads({ dir: GUEST });
    assert.equal(p.watch(), fs.readFileSync(path.join(GUEST, 'watch-guest.js'), 'utf8'));
    assert.equal(p.runner(), fs.readFileSync(path.join(GUEST, 'job-runner.js'), 'utf8'));
    assert.equal(p.api(), fs.readFileSync(path.join(GUEST, 'job-api.js'), 'utf8'));
});

test('a missing payload is refused at load, and says where it should be', () => {
    assert.throws(() => makePayloads({ dir: path.join(GUEST, 'nowhere') }), (e) => {
        assert.match(e.message, /missing job-api\.js/);
        //IT NAMES THE MECHANISM, because "file not found" about a path under
        //dist tells nobody that a list in webpack.config.js is what fills it.
        assert.match(e.message, /PAYLOADS list in webpack\.config\.js/);
        return true;
    });
});

test('an empty payload is refused too, because it is worse than a missing one', () => {
    //IT COPIES, IT WRITES, AND THE GUEST RUNS NOTHING while everything reports
    //success.
    assert.throws(() => makePayloads({
        dir: GUEST,
        read: (p) => (p.endsWith('watch-guest.js') ? '   \n  ' : 'x')
    }), /watch-guest\.js is empty/);
});

//---- the watcher ---------------------------------------------------------------

test('it writes the watcher and a launcher, and makes the launcher executable', () => {
    const w = makeWatcher({ payloads: makePayloads({ dir: GUEST }) });
    const s = w.watcherFor('/home/okc/.okc-runs/run-1', '/home/okc/.okc-runs/run-1/out.log');

    //TWO FILES RATHER THAN ONE because the pipe is shell and the parsing is
    //node, and putting node inside a quoted shell string is how that file's
    //contents get corrupted.
    assert.match(s, /cat > \/home\/okc\/\.okc-runs\/run-1\/watch\.js <<'OKC_WATCH_EOF'/);
    assert.match(s, /cat > \/home\/okc\/\.okc-runs\/run-1\/okc-watch <<'OKC_WATCH_SH_EOF'/);
    assert.match(s, /chmod \+x \/home\/okc\/\.okc-runs\/run-1\/okc-watch/);
    assert.match(s, /^mkdir -p \/home\/okc\/\.okc-runs\/run-1$/m);
});

test('the watcher it sends is the real file, unaltered', () => {
    const w = makeWatcher({ payloads: makePayloads({ dir: GUEST }) });
    const s = w.watcherFor('/d', '/d/out.log');
    const real = fs.readFileSync(path.join(GUEST, 'watch-guest.js'), 'utf8');

    assert.ok(s.includes(real), 'the watcher was changed on the way to the machine');
});

test('it follows by name, so a relinked log is picked up rather than sat on', () => {
    const w = makeWatcher({ payloads: makePayloads({ dir: GUEST }) });
    const s = w.watcherFor('/d', '/d/current.log');

    //-F FOLLOWS BY NAME. When the supervisor relinks current.log to its next
    //turn, a terminal already open carries on; with -f it would sit on a file
    //nothing writes to again — open, silent, and looking exactly like a model
    //that has stopped working.
    assert.match(s, /tail -n \+1 -F "\/d\/current\.log"/);
    assert.equal(s.includes('tail -n +1 -f '), false, 'it follows the handle rather than the name');
});

test('it starts from the beginning, so opening it late still shows what happened', () => {
    const w = makeWatcher({ payloads: makePayloads({ dir: GUEST }) });
    assert.match(w.watcherFor('/d', '/d/out.log'), /tail -n \+1 /);
});

test('a watcher payload containing the marker would be refused rather than truncated', () => {
    //THE HEREDOC GUARD APPLIES TO OUR OWN FILES TOO. This one is ours, so it is
    //a check on the wiring rather than on somebody's prose — but the day
    //watch-guest.js gains a line reading OKC_WATCH_EOF, the failure would
    //otherwise be shell running the rest of it.
    const w = makeWatcher({ payloads: { watch: () => 'a\nOKC_WATCH_EOF\nrm -rf /' } });
    assert.throws(() => w.watcherFor('/d', '/d/out.log'), /reading exactly "OKC_WATCH_EOF"/);
});
