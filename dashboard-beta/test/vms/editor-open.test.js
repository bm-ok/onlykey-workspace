const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');

const makeEditor = require('../../src/app/vms/editor/open-editor');

//---------------------------------------------------------------------------
//OPENING THE WORK IN VS CODE, WHEREVER THE WORK IS.
//
//EVERYTHING HERE THAT LOOKS LIKE SUPERSTITION WAS MEASURED, because the obvious
//version of this produces a button that silently does nothing. The three that
//cost the most:
//
//  * node REFUSES to spawn a .cmd, and throws EINVAL SYNCHRONOUSLY — before any
//    callback and before any 'error' event, so error handling written the normal
//    way never runs at all.
//  * spawning successfully is NOT opening. cmd.exe starts perfectly well and
//    only then reports that what it was asked to run does not exist.
//  * `code` is frequently not on PATH, and Insiders is a different binary.
//
//NOTHING HERE SPAWNS ANYTHING, and nothing waits out the grace window. Both are
//injected, so a failure is a failure rather than a suite that takes a second and
//a half per case and hangs when something never settles.
//---------------------------------------------------------------------------

let spawned, fake, clock, said, files, wrote;

function fakeChild() {
    const c = new EventEmitter();
    c.unref = () => { c.unreffed = true; };
    return c;
}

function editor(over) {
    return makeEditor(Object.assign({
        exec: (file, argv, opts, cb) => {
            spawned.push({ file, argv, opts });
            fake.cb = cb;
            fake.child = fakeChild();
            return fake.child;
        },
        //SEPARATORS NORMALISED, because `path.join` produces backslashes on
        //Windows and forward slashes elsewhere — the real `fs.existsSync` and
        //the real `path.join` agree with each other, and a fixture written in
        //one spelling has to meet both.
        there: (p) => files.has(String(p).split('\\').join('/')),
        env: { LOCALAPPDATA: 'C:/Users/x/AppData/Local', ProgramFiles: 'C:/Program Files', COMSPEC: 'C:/Windows/cmd.exe' },
        //NO PATH TO A REAL settings.json, AND NO REAL WRITER EITHER. `open` now
        //tells VS Code the far end is Linux on its way past — see
        //../../src/app/vms/editor/remote-platform.js — and a harness that leaves
        //those two on the defaults is a suite that edits whoever ran it's
        //editor config. Belt and braces: no home for a path to be built from,
        //and a writer that records instead of writing.
        home: () => '',
        readFile: () => { throw new Error('a test read the real settings.json'); },
        writeFile: (p, text) => { wrote.push({ file: p, text: text }); },
        platform: 'win32',
        after: (ms, fn) => { const t = { ms, fn, live: true }; clock.push(t); return t; },
        clear: (t) => { if (t) t.live = false; },
        say: () => {
            const to = {
                good: (m) => said.push('good ' + m), bad: (m) => said.push('bad ' + m),
                info: (m) => said.push(m), warn: (m) => said.push('warn ' + m), on: () => to
            };
            return to;
        }
    }, over || {}));
}

//A BOUND ON EVERY WAIT. An unsettled promise HANGS rather than fails, and a hang
//cannot be reported: the sabotage that stops a failed launch being reported was
//caught only because the sweep has a sixty-second timeout of its own, and
//"caught (hung)" is a minute spent to learn what a failed assertion says at
//once. The bound belongs in the test, not in the harness around it.
function within(what, p) {
    return Promise.race([
        p,
        new Promise((_, no) => setTimeout(
            () => no(new Error(what + ' never settled — nothing resolved it and nothing rejected it')),
            2000).unref())
    ]);
}

const fire = (ms) => {
    const t = clock.find((x) => x.live && x.ms === ms);
    assert.ok(t, 'nothing was waiting ' + ms + 'ms');
    t.live = false;
    t.fn();
};

beforeEach(() => { spawned = []; fake = {}; clock = []; said = []; files = new Set(); wrote = []; });

//---- where the editor is ------------------------------------------------------

test('Insiders wins where both are installed, so the choice is fixed not incidental', () => {
    files.add('C:/Users/x/AppData/Local/Programs/Microsoft VS Code Insiders/bin/code-insiders.cmd');
    files.add('C:/Users/x/AppData/Local/Programs/Microsoft VS Code/bin/code.cmd');

    //A BUTTON THAT QUIETLY CHANGES WHICH EDITOR IT OPENS the day another one is
    //installed is worse than one that always picks the same and can be told
    //otherwise.
    const r = editor().discover();
    assert.match(r.command, /code-insiders\.cmd$/);
    assert.equal(r.from, 'found where it installs');
});

test('a configured bare name is a name on PATH, not a path that is missing', () => {
    //SOMEBODY WHO CONFIGURED `code-insiders` MEANT THE ONE ON THEIR PATH, and
    //refusing it for want of a file at that relative path refuses what they
    //asked for.
    assert.deepEqual(editor().discover('code-insiders'), { command: 'code-insiders', from: 'configured, on PATH' });
});

test('a configured path that is not there is refused, and says so', () => {
    assert.throws(() => editor().discover('C:/nope/code.cmd'), /set to C:\/nope\/code\.cmd, and there is nothing there/);
});

test('a configured path that is there is used as given', () => {
    files.add('C:/mine/code.cmd');
    assert.deepEqual(editor().discover('C:/mine/code.cmd'), { command: 'C:/mine/code.cmd', from: 'configured' });
});

test('nothing found is a guess that SAYS it is a guess', () => {
    //THE SECOND HALF MATTERS WHEN THE ANSWER IS WRONG. "Not found" is a
    //different fault from "found somewhere unexpected", and the failure message
    //repeats it back.
    const win = editor().discover();
    assert.equal(win.command, 'code.cmd');
    assert.match(win.from, /^guessed/);

    const nix = editor({ platform: 'linux' }).discover();
    assert.equal(nix.command, 'code');
    assert.match(nix.from, /^guessed/);
});

test('a unix install is found where it installs', () => {
    files.add('/snap/bin/code');
    const r = editor({ platform: 'linux', env: {} }).discover();
    assert.equal(r.command, '/snap/bin/code');
    assert.equal(r.from, 'found where it installs');
});

//---- how it is started ---------------------------------------------------------

test('a .cmd goes through cmd.exe, because node will not start one directly', () => {
    //IT THROWS EINVAL, SYNCHRONOUSLY. That is the CVE-2024-27980 mitigation, and
    //it fails before the arguments matter.
    const spec = editor().launchSpec('C:/Program Files/Microsoft VS Code/bin/code.cmd', ['/a/b', '--new-window']);
    assert.equal(spec.file, 'C:/Windows/cmd.exe');
    assert.deepEqual(spec.argv, ['/c', 'C:/Program Files/Microsoft VS Code/bin/code.cmd', '/a/b', '--new-window']);
});

test('and the path with spaces in it is never handed to a shell', () => {
    //`{ shell: true }` IS THE OTHER WAY OUT AND IS NOT USED: the editor installs
    //to a path with spaces, and a shell splits on them. Through cmd.exe, node
    //quotes each argument and no shell parses the path at all.
    const spec = editor().launchSpec('C:/Program Files/Microsoft VS Code/bin/code.cmd', []);
    assert.equal(spec.argv[1], 'C:/Program Files/Microsoft VS Code/bin/code.cmd',
        'the path was split or quoted rather than passed as one argument');
});

test('anything that is not a .cmd is started directly', () => {
    assert.deepEqual(editor({ platform: 'linux' }).launchSpec('/snap/bin/code', ['/a']),
        { file: '/snap/bin/code', argv: ['/a'] });
});

//---- the far end -----------------------------------------------------------------

test('the far end is one string, and an absolute path is not given a second slash', () => {
    const e = editor();
    assert.equal(e.folderUri('okc@192.168.51.63', '/home/okc/work'),
        'vscode-remote://ssh-remote+okc%40192.168.51.63/home/okc/work');
    //A RELATIVE PATH STILL GETS ONE.
    assert.equal(e.folderUri('okc@h', 'work'), 'vscode-remote://ssh-remote+okc%40h/work');
});

//---- opening it -------------------------------------------------------------------

test('a local folder is opened directly, in a new window', () => {
    files.add('/snap/bin/code');
    editor({ platform: 'linux', env: {} }).open({ dir: '/home/okc/work' });

    assert.deepEqual(spawned[0].argv, ['/home/okc/work', '--new-window']);
});

test('a remote folder goes through VS Code\'s own remote', () => {
    files.add('/snap/bin/code');
    editor({ platform: 'linux', env: {} }).open({ dir: '/home/okc/work', remote: 'okc@h' });

    assert.deepEqual(spawned[0].argv,
        ['--folder-uri', 'vscode-remote://ssh-remote+okc%40h/home/okc/work', '--new-window']);
});

test('no folder is refused before anything is discovered or spawned', () => {
    assert.throws(() => editor().open({}), /no folder to open/);
    assert.deepEqual(spawned, []);
});

test('it resolves on the grace window, because the editor outlives this call', () => {
    //WAITING FOR IT TO CLOSE WOULD HANG FOR EVER — the dashboard opened a
    //window, it does not own it.
    files.add('/snap/bin/code');
    const p = editor({ platform: 'linux', env: {} }).open({ dir: '/a' });

    fire(1500);
    return within('open()', p).then((r) => {
        //`platform` SAYS WHAT IT DID ABOUT THE "which platform is this host"
        //dialog — see ../../src/app/vms/editor/remote-platform.js. A local
        //folder has no host to have a platform, so it says so rather than
        //leaving the field off and making its absence mean two things.
        assert.deepEqual(r, {
            opened: '/a', on: null, using: '/snap/bin/code', found: 'found where it installs',
            platform: 'nothing remote to say it about'
        });
        assert.equal(fake.child.unreffed, true, 'it held the process it does not own');
    });
});

//---- and the dialog it stops before it appears --------------------------------
//
//REMOTE-SSH ASKS "Select the platform of the remote host" the first time it is
//pointed at a host it has not seen, and WAITS. No server is installed, no
//extension runs, no folder opens. So the one press this app has for getting into
//a machine ended on a dialog, for every machine ever built.

test('a remote open tells VS Code the far end is Linux, BEFORE it starts', () => {
    //BEFORE, BECAUSE REMOTE-SSH READS IT AT CONNECT TIME. Written afterwards it
    //would be correct for the next press and useless for this one — and this one
    //is the press somebody is watching.
    const order = [];
    files.add('/snap/bin/code');

    editor({
        platform: 'linux', env: {},
        exec: (file, argv, opts, cb) => {
            order.push('launched');
            spawned.push({ file, argv, opts });
            fake.cb = cb;
            fake.child = fakeChild();
            return fake.child;
        },
        platforms: { ensure: (alias) => { order.push('told about ' + alias); return { added: true, why: 'added it' }; } }
    }).open({ dir: '/home/okc/workspace', remote: 'okc-ok-diy1' });

    assert.deepEqual(order, ['told about okc-ok-diy1', 'launched']);
});

test('and a LOCAL open says nothing about a platform, because there is no host', () => {
    //AN ENTRY FOR A LOCAL FOLDER would put a name in somebody's settings that
    //nothing ever reads.
    files.add('/snap/bin/code');
    let asked = 0;

    editor({
        platform: 'linux', env: {},
        platforms: { ensure: () => { asked++; return { added: true }; } }
    }).open({ dir: '/a' });

    assert.equal(asked, 0, 'it wrote a remote platform entry for a folder on this computer');
});

test('and it opens the editor anyway when it could not write the entry', () => {
    //THE WORST CASE IS THE DIALOG SOMEBODY WAS ALREADY GETTING. A press that
    //refuses because it could not save a click is worse than the click.
    files.add('/snap/bin/code');

    editor({
        platform: 'linux', env: {},
        platforms: { ensure: () => ({ added: false, file: '/x/settings.json', why: 'it could not be written: EACCES' }) }
    }).open({ dir: '/a', remote: 'okc-h' });

    assert.equal(spawned.length, 1, 'it did not start the editor');
    //AND IT SAID SO, naming the file, because the fix is one line somebody can type.
    assert.ok(said.some((l) => /warn .*may ask which platform/.test(l)), said.join(' | '));
});

test('a clean exit resolves at once rather than waiting out the grace', () => {
    files.add('/snap/bin/code');
    const p = editor({ platform: 'linux', env: {} }).open({ dir: '/a' });

    fake.child.emit('exit', 0);
    return within('open()', p).then(() => {
        assert.equal(clock.find((t) => t.ms === 1500).live, false, 'the grace timer was left running');
    });
});

test('a synchronous EINVAL becomes something readable, which is the only place it can', () => {
    //THROWN BEFORE ANY CALLBACK AND BEFORE ANY 'error' EVENT, so error handling
    //written the normal way never runs at all.
    files.add('C:/Program Files/Microsoft VS Code/bin/code.cmd');
    const e = editor({
        exec: () => { const err = new Error('spawn EINVAL'); err.code = 'EINVAL'; throw err; }
    });

    return within('open()', e.open({ dir: 'C:/work' })).then(
        () => assert.fail('it reported success for a spawn that threw'),
        (err) => {
            assert.match(err.message, /Could not start the editor/);
            assert.match(err.message, /tried: C:\/Windows\/cmd\.exe \/c/);
            assert.match(err.message, /Windows will not start a \.cmd directly/);
        });
});

test('spawning is not opening: a non-zero exit is reported with what it said', () => {
    //cmd.exe STARTS PERFECTLY WELL and only then reports that what it was asked
    //to run does not exist, so resolving on spawn reports success for a button
    //that did nothing.
    files.add('/snap/bin/code');
    const p = editor({ platform: 'linux', env: {} }).open({ dir: '/a' });

    const err = new Error('Command failed');
    err.code = 1;
    fake.cb(err, '', "'code' is not recognized as an internal or external command\nmore noise");

    return within('open()', p).then(
        () => assert.fail('a failed launch resolved'),
        (e) => {
            assert.match(e.message, /it said: 'code' is not recognized/);
            assert.equal(e.message.includes('more noise'), false, 'it carried the whole of stderr');
        });
});

test('a missing binary says where the editor was looked for', () => {
    const e = editor({ platform: 'linux', env: {} });   //nothing on disk, so a guess
    const p = e.open({ dir: '/a' });

    const err = new Error('spawn code ENOENT');
    err.code = 'ENOENT';
    fake.cb(err, '', '');

    return within('open()', p).then(
        () => assert.fail('a missing editor resolved'),
        (x) => assert.match(x.message, /that was not found\. The editor was guessed/));
});

test('it says it opened once, not once per route that could have said so', () => {
    //WHAT THE `settled` GUARD ACTUALLY PROTECTS, which is not the promise.
    //Resolving or rejecting an already-settled promise is a no-op in JS, so
    //removing the guard changes nothing a caller can see — and a sabotage that
    //removed it SURVIVED for exactly that reason. What it does change is the
    //LOG: two routes reach `done`, and both would write the line.
    files.add('/snap/bin/code');
    const p = editor({ platform: 'linux', env: {} }).open({ dir: '/a' });

    fire(1500);                      //the grace window resolves it
    fake.child.emit('exit', 0);      //and then the process exits cleanly too

    return within('open()', p).then(() => {
        const good = said.filter((m) => /^good VS Code was asked to open it/.test(m));
        assert.equal(good.length, 1, 'it reported opening ' + good.length + ' times for one press');
    });
});

test('it settles exactly once, whatever arrives afterwards', () => {
    files.add('/snap/bin/code');
    const p = editor({ platform: 'linux', env: {} }).open({ dir: '/a' });

    fake.child.emit('exit', 0);
    //EVERY LATER ROUTE IS A NO-OP. Without that, a failure arriving after the
    //grace window would reject a promise that had already resolved — which node
    //reports as nothing at all.
    fake.child.emit('error', Object.assign(new Error('too late'), { code: 'ENOENT' }));
    const err = new Error('also too late'); err.code = 1;
    fake.cb(err, '', 'nope');

    return within('open()', p).then((r) => assert.equal(r.opened, '/a'));
});

test('what it says names the folder and the far end', () => {
    files.add('/snap/bin/code');
    const p = editor({ platform: 'linux', env: {} }).open({ dir: '/a', remote: 'okc@h' });
    fire(1500);

    return within('open()', p).then(() => {
        assert.ok(said.some((m) => /Opening \/a on okc@h in VS Code/.test(m)), said.join(' | '));
        assert.ok(said.some((m) => /good VS Code was asked to open it/.test(m)), said.join(' | '));
    });
});
