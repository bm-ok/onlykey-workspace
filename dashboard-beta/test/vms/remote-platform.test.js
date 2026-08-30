const { test } = require('node:test');
const assert = require('node:assert');

const makePlatforms = require('../../src/app/vms/editor/remote-platform');

//---------------------------------------------------------------------------
//TELLING VS CODE A MACHINE IS LINUX — see ../../src/app/vms/editor/
//remote-platform.js.
//
//WHAT THIS FILE IS ACTUALLY GUARDING is not the feature. The feature saves one
//click. What it guards is THE OPERATOR'S OWN settings.json, which this app has
//no business damaging in order to save that click — so most of what is below is
//about what happens when the file is not the shape it hoped for.
//
//THE CLAIM WORTH THE MOST: it adds one entry and everything else comes out byte
//for byte. Re-serialising the parsed object would be correct JSON and would
//also throw away somebody's indentation, their grouping and their one-line
//objects — a config that comes back reformatted after an unrelated press is a
//config nobody trusts this app near again.
//
//AND THE SECOND: a file it cannot read is a file it does not touch. VS Code
//reads JSONC, so comments and trailing commas are legal in there and illegal in
//JSON.parse. "Normalise it" would build cleanly, pass, and delete somebody's
//comments the first time it ran on a real machine.
//---------------------------------------------------------------------------

//NO DISK ANYWHERE IN HERE. `edit` is a function of text, which is why it is
//separate from the half that writes.
const edits = () => makePlatforms({ platform: 'win32', env: {}, home: () => 'C:\\home' });

//---- the ordinary case ------------------------------------------------------

test('it adds one host to a setting that is already there', () => {
    const before = [
        '{',
        '    "editor.fontSize": 14,',
        '    "remote.SSH.remotePlatform": {',
        '        "okc-runner1": "linux"',
        '    },',
        '    "git.confirmSync": false',
        '}'
    ].join('\n');

    const out = edits().edit(before, 'okc-ok-diy1');
    const now = JSON.parse(out.text);

    assert.equal(now['remote.SSH.remotePlatform']['okc-ok-diy1'], 'linux');
    //AND THE ONE THAT WAS THERE IS STILL THERE. An "add" that replaces the map
    //is how somebody loses every host they have answered for.
    assert.equal(now['remote.SSH.remotePlatform']['okc-runner1'], 'linux');
    assert.equal(now['editor.fontSize'], 14);
    assert.equal(now['git.confirmSync'], false);
});

test('and everything it did not touch comes back unchanged, character for character', () => {
    //THE CLAIM THAT SEPARATES THIS FROM stringify(parse(x)). Diffing the two
    //texts should show ONE added line and nothing else — not a reformat that
    //happens to parse to the same thing.
    const before = [
        '{',
        '  "a.setting": {"kept": "on one line"},',
        '  "remote.SSH.remotePlatform": {',
        '    "okc-runner1": "linux"',
        '  },',
        '  "z.setting": [1,2,3]',
        '}'
    ].join('\n');

    const out = edits().edit(before, 'okc-diy1');

    const wasLines = before.split('\n');
    const nowLines = out.text.split('\n');
    assert.equal(nowLines.length, wasLines.length + 1, out.text);

    const added = nowLines.filter((l) => wasLines.indexOf(l) < 0);
    assert.equal(added.length, 1, 'more than one line differs: ' + JSON.stringify(added));
    assert.match(added[0], /okc-diy1/);

    //INCLUDING THE INDENTATION, which is two spaces here and four in the file
    //this was written against.
    assert.match(added[0], /^ {4}"okc-diy1": "linux",$/);
});

//---- and the shapes a real settings file comes in ---------------------------

test('no setting at all means adding the setting', () => {
    const out = edits().edit('{\n    "editor.fontSize": 14\n}', 'okc-diy1');
    const now = JSON.parse(out.text);

    assert.equal(now['remote.SSH.remotePlatform']['okc-diy1'], 'linux');
    assert.equal(now['editor.fontSize'], 14);
});

test('no file at all means writing one', () => {
    const out = edits().edit('', 'okc-diy1');
    assert.equal(JSON.parse(out.text)['remote.SSH.remotePlatform']['okc-diy1'], 'linux');
    assert.match(out.why, /did not exist/);
});

test('an empty document, and an empty setting, both of which have no comma to hang off', () => {
    //`{\n  "x": "linux",\n}` IS A TRAILING COMMA and JSON will not have it. Both
    //of these produced one in the version before the empty case existed.
    assert.equal(JSON.parse(edits().edit('{}', 'okc-diy1').text)['remote.SSH.remotePlatform']['okc-diy1'], 'linux');

    const out = edits().edit('{\n    "remote.SSH.remotePlatform": {}\n}', 'okc-diy1');
    assert.equal(JSON.parse(out.text)['remote.SSH.remotePlatform']['okc-diy1'], 'linux');
});

test('already answered is nothing to do, and says so as its own kind of nothing', () => {
    //"ALREADY CORRECT" AND "COULD NOT READ IT" BOTH WRITE NOTHING and are not
    //remotely the same news, which is why `why` exists at all.
    const out = edits().edit('{\n    "remote.SSH.remotePlatform": {\n        "okc-diy1": "linux"\n    }\n}', 'okc-diy1');
    assert.equal(out.text, null);
    assert.equal(out.why, 'already there');
});

//---- what it refuses to touch ----------------------------------------------

test('a settings file with COMMENTS in it is left alone', () => {
    //VS CODE READS JSONC. Comments are legal in there and illegal in JSON.parse,
    //so "parse it and write it back" would silently delete them — and somebody
    //would find out weeks later, from a file they did not know this app opens.
    const before = [
        '{',
        '    // the size that stops my eyes hurting',
        '    "editor.fontSize": 14,',
        '    "remote.SSH.remotePlatform": { "okc-runner1": "linux" }',
        '}'
    ].join('\n');

    const out = edits().edit(before, 'okc-diy1');
    assert.equal(out.text, null);
    assert.match(out.why, /comments or a trailing comma/);
});

test('and one with a trailing comma, which is the same legality and the same answer', () => {
    const out = edits().edit('{\n    "editor.fontSize": 14,\n}', 'okc-diy1');
    assert.equal(out.text, null);
    assert.match(out.why, /comments or a trailing comma/);
});

test('and one where the setting is not a list of hosts', () => {
    //SOMEBODY MAY HAVE PUT A STRING THERE. Merging into it would mean deciding
    //what they meant.
    const out = edits().edit('{\n    "remote.SSH.remotePlatform": "linux"\n}', 'okc-diy1');
    assert.equal(out.text, null);
    assert.match(out.why, /not a list of hosts/);
});

test('and anything that is not an object at the top', () => {
    assert.equal(edits().edit('[1, 2, 3]', 'okc-diy1').text, null);
    assert.equal(edits().edit('"just a string"', 'okc-diy1').text, null);
});

test('and it will not write an entry for nothing', () => {
    const out = edits().edit('{}', '');
    assert.equal(out.text, null);
    assert.match(out.why, /no machine/);
});

test('a file with WINDOWS line endings keeps them, and gains no others', () => {
    //THE ONE THE ROUND-TRIP CHECK CANNOT CATCH. Inserting a bare newline after
    //the brace lands the new line between the `{` and its `\r` — the entry
    //carries a stray carriage return, the line above loses one, and the result
    //parses perfectly, compares equal, and is written.
    //
    //IT ONLY SHOWS IN A DIFF. Which is where it was found: running the edit
    //against a real settings.json and reading the change rather than the answer.
    const before = '{\r\n    "editor.fontSize": 14,\r\n    "remote.SSH.remotePlatform": {\r\n        "okc-runner1": "linux"\r\n    }\r\n}\r\n';

    const out = edits().edit(before, 'okc-diy1');
    assert.ok(out.text, out.why);

    const wasCRLF = (before.match(/\r\n/g) || []).length;
    const nowCRLF = (out.text.match(/\r\n/g) || []).length;
    assert.equal(nowCRLF, wasCRLF + 1, 'it did not add exactly one line');

    //AND NOT ONE BARE NEWLINE ANYWHERE, which is the actual damage.
    assert.equal((out.text.match(/[^\r]\n/g) || []).length, 0,
        'it mixed line endings into the file: ' + JSON.stringify(out.text));

    assert.equal(JSON.parse(out.text)['remote.SSH.remotePlatform']['okc-diy1'], 'linux');
});

test('and a file with unix line endings does not gain a carriage return', () => {
    const before = '{\n    "remote.SSH.remotePlatform": {\n        "okc-runner1": "linux"\n    }\n}\n';
    const out = edits().edit(before, 'okc-diy1');

    assert.ok(out.text, out.why);
    assert.equal((out.text.match(/\r/g) || []).length, 0, 'it put a carriage return in a unix file');
});

//---- the guard that makes string surgery reasonable at all -----------------

test('a brace inside a STRING does not become the place it writes', () => {
    //THE FAILURE THIS EXISTS FOR. `indexOf('{')` does not know about string
    //literals, so a setting whose VALUE contains a brace — a terminal argument,
    //a path template, a format string — can be found first. The edit is parsed
    //back and compared before anything is written, so this comes out as a
    //refusal rather than as a corrupted file.
    const before = '{\n    "terminal.x": "a { brace in a value",\n    "editor.fontSize": 14\n}';
    const out = edits().edit(before, 'okc-diy1');

    //EITHER IT PLACED IT CORRECTLY OR IT WROTE NOTHING. What must not happen is
    //a text that is neither.
    if (out.text === null) {
        assert.ok(out.why, 'it declined without saying why');
    } else {
        const now = JSON.parse(out.text);
        assert.equal(now['remote.SSH.remotePlatform']['okc-diy1'], 'linux');
        assert.equal(now['terminal.x'], 'a { brace in a value');
        assert.equal(now['editor.fontSize'], 14);
    }
});

test('the key name appearing as a VALUE is not mistaken for the setting', () => {
    //`indexOf` ON THE NAME ALONE FINDS THE DECOY FIRST, and then the next brace
    //belongs to whatever came after it. The round-trip check catches that and
    //refuses — which is safe, and is still a press that did not work. So the key
    //is matched as a key: the one followed by a colon and a brace.
    const before = [
        '{',
        '    "a.note": "remote.SSH.remotePlatform",',
        '    "b.thing": { "nested": 1 },',
        '    "remote.SSH.remotePlatform": { "okc-runner1": "linux" }',
        '}'
    ].join('\n');

    const out = edits().edit(before, 'okc-diy1');
    assert.ok(out.text, 'it refused a file it should have been able to edit: ' + out.why);

    const now = JSON.parse(out.text);
    assert.equal(now['remote.SSH.remotePlatform']['okc-diy1'], 'linux');
    assert.equal(now['remote.SSH.remotePlatform']['okc-runner1'], 'linux');
    //AND THE DECOY IS UNTOUCHED, both of them.
    assert.equal(now['a.note'], 'remote.SSH.remotePlatform');
    assert.deepEqual(now['b.thing'], { nested: 1 });
});

test('whatever it writes parses, and is the old document plus exactly one entry', () => {
    //SAID OVER SEVERAL SHAPES AT ONCE, because the property is the point and any
    //one example is a case. Nothing here may lose a key or change a value.
    const shapes = [
        '{}',
        '{\n    "a": 1\n}',
        '{\n  "a": 1,\n  "remote.SSH.remotePlatform": {"b": "linux"}\n}',
        '{\n\t"a": {"deep": {"deeper": [1, {"x": null}]}}\n}',
        '{\n    "remote.SSH.remotePlatform": {\n        "one": "linux",\n        "two": "linux"\n    }\n}'
    ];

    shapes.forEach((before) => {
        const out = edits().edit(before, 'okc-diy1');
        assert.ok(out.text, 'declined a shape it should have handled: ' + before + ' — ' + out.why);

        const was = JSON.parse(before);
        const now = JSON.parse(out.text);

        //EVERY KEY THAT WAS THERE IS STILL THERE, with the same value.
        Object.keys(was).forEach((k) => {
            if (k === 'remote.SSH.remotePlatform') return;
            assert.deepEqual(now[k], was[k], k + ' changed in: ' + before);
        });

        //AND EVERY HOST THAT WAS ANSWERED FOR IS STILL ANSWERED FOR.
        Object.keys(was['remote.SSH.remotePlatform'] || {}).forEach((h) => {
            assert.equal(now['remote.SSH.remotePlatform'][h], 'linux', h + ' was lost in: ' + before);
        });

        assert.equal(now['remote.SSH.remotePlatform']['okc-diy1'], 'linux');
        //AND NOTHING ELSE ARRIVED.
        assert.equal(Object.keys(now).length, Object.keys(was).length + (was['remote.SSH.remotePlatform'] ? 0 : 1));
    });
});

//---- which settings.json, which is a whole answer on its own ----------------

test('Insiders and stable are different installs with different files', () => {
    //WRITING THE ENTRY INTO THE STABLE ONE WHILE LAUNCHING INSIDERS is a fix
    //that changes nothing, silently — and this app prefers Insiders where both
    //are installed, so it is the likely way round rather than the unlikely one.
    const p = makePlatforms({ platform: 'win32', env: { APPDATA: 'C:\\a' }, home: () => 'C:\\home' });

    assert.match(p.settingsFile('C:\\x\\Microsoft VS Code Insiders\\bin\\code-insiders.cmd'), /Code - Insiders/);
    assert.match(p.settingsFile('C:\\x\\Microsoft VS Code\\bin\\code.cmd'), /[\\/]Code[\\/]/);
    assert.match(p.settingsFile('code-insiders'), /Code - Insiders/);
    assert.match(p.settingsFile('code'), /[\\/]Code[\\/]/);
});

test('and it knows where each system keeps it', () => {
    //SEPARATOR-BLIND ON PURPOSE. `path.join` follows the machine this is RUNNING
    //on, not the platform passed in — which is right, because this only ever
    //works out a path for the computer the editor is being started on. Pinning
    //the separator here would be asserting which machine ran the suite.
    const at = (platform, env) => makePlatforms({ platform: platform, env: env || {}, home: () => '/home/me' })
        .settingsFile('code').replace(/\\/g, '/');

    assert.equal(at('linux'), '/home/me/.config/Code/User/settings.json');
    assert.match(at('darwin'), /^\/home\/me\/Library\/Application Support\/Code\/User\/settings\.json$/);
    assert.match(at('win32', { APPDATA: 'C:\\a' }), /^C:\/a\/Code\/User\/settings\.json$/);
});

//---- and against a disk, which is the only part that can lose anything ------

test('it keeps a copy of what was there before it writes', () => {
    //IT IS THE OPERATOR'S EDITOR CONFIG and this is an edit they did not ask for
    //by name. The copy costs nothing and is the difference between a mistake and
    //a loss.
    const disk = { 'C:\\a\\Code\\User\\settings.json': '{\n    "editor.fontSize": 14\n}' };
    const p = makePlatforms({
        platform: 'win32', env: { APPDATA: 'C:\\a' }, home: () => 'C:\\home',
        there: (f) => Object.prototype.hasOwnProperty.call(disk, f),
        readFile: (f) => disk[f],
        writeFile: (f, text) => { disk[f] = text; }
    });

    const said = p.ensure('okc-diy1', 'code');

    assert.equal(said.added, true);
    assert.equal(disk['C:\\a\\Code\\User\\settings.json.okc-backup'], '{\n    "editor.fontSize": 14\n}');
    assert.equal(JSON.parse(disk['C:\\a\\Code\\User\\settings.json'])['remote.SSH.remotePlatform']['okc-diy1'], 'linux');
});

test('and there is nothing to copy when there was no file', () => {
    const disk = {};
    const p = makePlatforms({
        platform: 'win32', env: { APPDATA: 'C:\\a' }, home: () => 'C:\\home',
        there: (f) => Object.prototype.hasOwnProperty.call(disk, f),
        readFile: (f) => disk[f],
        writeFile: (f, text) => { disk[f] = text; }
    });

    assert.equal(p.ensure('okc-diy1', 'code').added, true);
    assert.equal(disk['C:\\a\\Code\\User\\settings.json.okc-backup'], undefined,
        'it wrote a backup of a file that did not exist');
});

test('a disk that will not be written to is answered, not thrown', () => {
    //THIS RUNS ON THE WAY TO OPENING AN EDITOR. A machine somebody can get into
    //with one extra click is far better than a press that refuses because it
    //could not save them the click.
    const p = makePlatforms({
        platform: 'win32', env: { APPDATA: 'C:\\a' }, home: () => 'C:\\home',
        there: () => false,
        readFile: () => '',
        writeFile: () => { throw new Error('EACCES'); }
    });

    const said = p.ensure('okc-diy1', 'code');
    assert.equal(said.added, false);
    assert.match(said.why, /could not be written/);
});

test('and a file that cannot be read is the same kind of answer', () => {
    const p = makePlatforms({
        platform: 'win32', env: { APPDATA: 'C:\\a' }, home: () => 'C:\\home',
        there: () => true,
        readFile: () => { throw new Error('EACCES'); },
        writeFile: () => { throw new Error('should not have been reached'); }
    });

    const said = p.ensure('okc-diy1', 'code');
    assert.equal(said.added, false);
    assert.match(said.why, /could not be read/);
});
