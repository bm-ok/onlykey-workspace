var fs = require('fs');
var path = require('path');

//---------------------------------------------------------------------------
//TELLING VS CODE THAT A MACHINE IS LINUX, SO IT STOPS ASKING.
//
//THE FIRST TIME Remote-SSH IS POINTED AT A HOST IT HAS NOT SEEN, it puts up
//"Select the platform of the remote host" and waits. Nothing continues until
//somebody answers — no server is installed, no extension runs, no folder opens.
//So the one press this app has for getting into a machine ends on a dialog, and
//it ends there again for every machine that is ever built.
//
//THERE IS EXACTLY ONE PLACE THE ANSWER CAN LIVE. `remote.SSH.remotePlatform` is
//declared `"scope": "application"` by the Remote-SSH extension, and an
//application-scoped setting is read ONLY from the operator's own user
//settings.json. Not workspace settings, not a .code-workspace file, not folder
//settings, and there is no command-line flag for it. So there is no cleverer
//place to put this and no way to carry it in the launch — which is worth saying
//because a .code-workspace file on the guest IS the right home for other things
//and is not for this one.
//
//---- WHY THIS IS ALLOWED TO TOUCH A PERSONAL FILE -------------------------
//
//../../core/ssh ALREADY DOES THE SAME THING and says why: `ensureInclude` adds
//one Include line to the operator's own ssh config, because without it the
//machines this app makes cannot be reached by name. This is the same bargain
//one layer up, and it is held to the same shape:
//
//  * IT ADDS, AND NEVER REWRITES. One entry goes in. Everything else in the
//    file comes out byte for byte, including the parts this has no opinion on.
//  * IT REFUSES RATHER THAN REPAIRS. A settings.json that does not parse is one
//    with comments or a trailing comma in it — both legal in what VS Code
//    reads, neither legal in JSON — and the honest answer to a file we cannot
//    read is to leave it alone and say so, not to normalise it into something
//    that loses the comments.
//  * IT CHECKS ITS OWN WORK BEFORE WRITING. The edited text is parsed back and
//    compared against the old document plus exactly one entry. Anything else
//    and nothing is written. This is the guard that makes string surgery on
//    somebody's editor config a reasonable thing to do at all.
//  * AND IT KEEPS A COPY of what was there before it, next to the original.
//
//WHAT IT WILL NOT DO IS ANSWER ANYTHING BUT `linux`. Every machine this app
//builds is Ubuntu — ../../provision installs it — so there is no case where the
//answer is in doubt, and a version of this that took the platform as an
//argument would be a way to write the wrong one.
//---------------------------------------------------------------------------

var KEY = 'remote.SSH.remotePlatform';
var LINUX = 'linux';

//WHERE VS CODE KEEPS IT, PER FLAVOUR. Insiders is a different install with a
//different settings file, and this app prefers Insiders when both are there —
//see EDITORS in ./open-editor.js. Writing the entry into the stable one while
//launching Insiders is a fix that changes nothing, silently.
function folderName(insiders) {
    return insiders ? 'Code - Insiders' : 'Code';
}

module.exports = function remotePlatform(deps) {
    var d = deps || {};
    var env = d.env || process.env;
    var platform = d.platform || process.platform;
    var home = d.home || function () { return env.HOME || env.USERPROFILE || ''; };

    var readFile = d.readFile || function (p) { return fs.readFileSync(p, 'utf8'); };
    var writeFile = d.writeFile || function (p, text) {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, text);
    };
    var there = d.there || function (p) {
        try { return fs.existsSync(p); } catch (e) { return false; }
    };
    var say = d.say || function () {
        var to = { good: function () {}, warn: function () {}, info: function () {}, bad: function () {} };
        return to;
    };

    //---- which settings.json ----------------------------------------------
    //
    //TOLD BY THE COMMAND THAT IS ABOUT TO BE LAUNCHED, rather than by looking
    //for a settings file. Both flavours can be installed and only one is being
    //started, and the one being started is the only one whose answer matters.
    function settingsFile(command) {
        var insiders = /insiders/i.test(String(command || ''));
        var flavour = folderName(insiders);
        var at = home();

        if (platform === 'win32') {
            //`at` CHECKED BEFORE IT IS JOINED. `path.join('', 'AppData', ...)`
            //is not empty — it is a RELATIVE path, and a relative path here
            //means writing a settings file into whatever the working directory
            //happens to be. In a test run that is the repository.
            var appData = env.APPDATA || (at ? path.join(at, 'AppData', 'Roaming') : '');
            if (!appData) return null;
            return path.join(appData, flavour, 'User', 'settings.json');
        }
        //AND AN ABSOLUTE PATH OR NOTHING, whatever the system. Everything below
        //hangs off `at`, and an empty one produces a path relative to wherever
        //this happens to be running.
        if (!at) return null;
        if (platform === 'darwin') {
            return path.join(at, 'Library', 'Application Support', flavour, 'User', 'settings.json');
        }
        return path.join(at, '.config', flavour, 'User', 'settings.json');
    }

    //---- the edit, as a function of text ----------------------------------
    //
    //PURE, AND SEPARATE FROM THE DISK, because this is the half that can damage
    //something and the half that is worth being able to test against every
    //shape of file somebody might have. It answers `{ text, why }`, and a null
    //`text` means "do not write" — with `why` saying which kind of nothing it
    //is, since "already correct" and "could not read it" both write nothing and
    //are not remotely the same news.
    function edit(text, alias) {
        if (!alias) return { text: null, why: 'no machine was named' };

        var raw = String(text == null ? '' : text);
        var entry = JSON.stringify(String(alias)) + ': ' + JSON.stringify(LINUX);

        //NOTHING THERE YET IS THE EASY CASE, and it happens on a workstation
        //where VS Code has been installed and never configured.
        if (!raw.trim()) {
            return {
                text: '{\n    ' + JSON.stringify(KEY) + ': {\n        ' + entry + '\n    }\n}\n',
                why: 'wrote a settings file, which did not exist'
            };
        }

        var was;
        try { was = JSON.parse(raw); }
        catch (e) { return { text: null, why: 'it is not plain JSON — it has comments or a trailing comma in it, so nothing was touched' }; }

        if (!was || typeof was !== 'object' || Array.isArray(was)) {
            return { text: null, why: 'the settings file is not an object' };
        }

        var map = was[KEY];
        if (map && (typeof map !== 'object' || Array.isArray(map))) {
            return { text: null, why: KEY + ' is already set to something that is not a list of hosts' };
        }
        if (map && map[alias] === LINUX) return { text: null, why: 'already there' };

        var next = place(raw, entry, !!map);
        if (next === null) return { text: null, why: 'there was nowhere obvious to put it, so nothing was touched' };

        //---- AND THE CHECK THAT MAKES THE SURGERY SAFE --------------------
        //
        //PARSE IT BACK AND COMPARE. What should come out is the document that
        //went in, plus one entry, and nothing else moved. If a brace was found
        //in a string literal, or the file had a shape this did not expect, the
        //comparison fails and nothing is written — which is the difference
        //between editing somebody's config and gambling with it.
        var now;
        try { now = JSON.parse(next); }
        catch (e) { return { text: null, why: 'the edit would not have parsed, so nothing was touched' }; }

        var want = JSON.parse(raw);
        want[KEY] = Object.assign({}, want[KEY] || {});
        want[KEY][alias] = LINUX;

        if (!same(now, want)) {
            return { text: null, why: 'the edit would have changed something else, so nothing was touched' };
        }

        return { text: next, why: map ? 'added it' : 'added the setting' };
    }

    //---- putting one entry in without moving anything else ----------------
    //
    //STRING SURGERY RATHER THAN RE-SERIALISING. `JSON.stringify` of the parsed
    //object would be correct and would also reformat the whole file — somebody
    //else's indentation, their grouping, their one-line objects, all replaced
    //because this wanted to add a line.
    function place(raw, entry, hasMap) {
        var open;

        if (hasMap) {
            //THE KEY AS A KEY, WHICH IS THE ONE FOLLOWED BY A COLON AND A BRACE.
            //`indexOf` on the name alone finds it inside a VALUE first if
            //somebody has the string anywhere above — a note to themselves, a
            //setting that names the setting — and then the next `{` belongs to
            //something else entirely. The check at the end of `edit` catches
            //that and refuses, which is safe and is still a press that did not
            //work; matching properly means it does.
            var found = new RegExp(escape(JSON.stringify(KEY)) + '\\s*:\\s*\\{').exec(raw);
            if (!found) return null;
            open = found.index + found[0].length - 1;
        } else {
            open = raw.indexOf('{');
        }
        if (open < 0) return null;

        var pad = indentAfter(raw, open);
        var eol = eolAfter(raw, open);
        var rest = raw.slice(open + 1);
        var line = hasMap ? entry : JSON.stringify(KEY) + ': { ' + entry + ' }';

        //AN EMPTY OBJECT HAS NOTHING TO PUT A COMMA IN FRONT OF, and `{\n x,\n}`
        //is a trailing comma, which is the one thing JSON will not have.
        if (/^\s*\}/.test(rest)) {
            return raw.slice(0, open + 1) + ' ' + line + ' ' + rest.replace(/^\s*/, '');
        }
        return raw.slice(0, open + 1) + eol + pad + line + ',' + rest;
    }

    //THE FILE'S OWN LINE ENDING, which is what this got wrong on the first real
    //file it was pointed at. Inserting a bare newline after the brace lands the
    //new line BETWEEN the `{` and its `\r`, so the added entry ends up carrying
    //a stray carriage return and the line above it loses one.
    //
    //THE CHECK IN `edit` CANNOT CATCH THIS, which is the part worth knowing.
    //JSON does not care about line endings, so the result parses, compares
    //equal, and is written — and the only thing wrong with it is that somebody's
    //config now has two kinds of line ending in it and the next tool to touch it
    //reports the whole file as changed. It was found by running the edit against
    //a real settings.json and reading the diff, which is the only place it shows.
    function eolAfter(raw, open) {
        var m = /^(\r?\n)/.exec(raw.slice(open + 1));
        if (m) return m[1];
        return raw.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
    }

    //THE KEY HAS DOTS IN IT, and a dot in a regular expression is anything at
    //all. Building a pattern out of a name without this is how a match lands
    //somewhere adjacent to where it was meant to.
    function escape(s) {
        return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    //THE FILE'S OWN INDENTATION, taken from the line after the brace rather
    //than assumed. Somebody using two spaces should not get four back.
    function indentAfter(raw, open) {
        var m = /^\r?\n([ \t]*)/.exec(raw.slice(open + 1));
        return m ? m[1] : '    ';
    }

    //DEEP EQUAL, ORDER-BLIND. Adding a key that was not there puts it where this
    //chose to put it and where JavaScript would have put it last, so comparing
    //serialised forms would fail on a correct edit.
    function same(a, b) {
        if (a === b) return true;
        if (typeof a !== typeof b) return false;
        if (a === null || b === null) return false;
        if (typeof a !== 'object') return false;
        if (Array.isArray(a) !== Array.isArray(b)) return false;

        if (Array.isArray(a)) {
            if (a.length !== b.length) return false;
            for (var i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
            return true;
        }

        var ka = Object.keys(a);
        var kb = Object.keys(b);
        if (ka.length !== kb.length) return false;
        for (var k = 0; k < ka.length; k++) {
            if (!Object.prototype.hasOwnProperty.call(b, ka[k])) return false;
            if (!same(a[ka[k]], b[ka[k]])) return false;
        }
        return true;
    }

    //---- and the same thing, against the disk -----------------------------
    //
    //IT NEVER THROWS. This runs on the way to opening an editor, and a machine
    //somebody can get into with one extra click is far better than a press that
    //refuses because it could not write a convenience. Everything it declines to
    //do it says out loud instead.
    function ensure(alias, command) {
        var file = settingsFile(command);
        if (!file) return { added: false, file: null, why: 'there is no settings file to write to on this system' };

        var current = '';
        try { if (there(file)) current = readFile(file); }
        catch (e) { return { added: false, file: file, why: 'it could not be read: ' + e.message }; }

        var out = edit(current, alias);
        if (!out.text) return { added: false, file: file, why: out.why };

        try {
            //A COPY OF WHAT WAS THERE, kept beside it and only when there was
            //something to keep. It is the operator's editor config and this is
            //an edit they did not ask for by name.
            if (current) writeFile(file + '.okc-backup', current);
            writeFile(file, out.text);
        } catch (e) {
            return { added: false, file: file, why: 'it could not be written: ' + e.message };
        }

        say('editor').good('told VS Code that ' + alias + ' is Linux, so it will not ask — ' + file);
        return { added: true, file: file, why: out.why, alias: alias };
    }

    return { ensure: ensure, edit: edit, settingsFile: settingsFile, KEY: KEY };
};

module.exports.KEY = KEY;
