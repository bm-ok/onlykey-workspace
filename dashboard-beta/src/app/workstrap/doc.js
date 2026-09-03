var fs = require('fs');
var path = require('path');

//---------------------------------------------------------------------------
//THE WORKSPACE'S NOTES, READ AND WRITTEN.
//
//ITS OWN FILE SO IT CAN BE TESTED WITHOUT A WORKSPACE. Everything here is a
//decision — which copy answers, what happens when there is no workspace open,
//whether an unreadable file is an error or an absence — and every one of them
//is reachable from a unit test only if the filesystem and the drawer are
//injected. See ../repositories/repos/asking.js for the same shape and the same
//reason.
//---------------------------------------------------------------------------

//THE NAME AS THE PERSON WHO ASKED FOR IT WROTE IT. It sits at the root of the
//workspace drawer rather than under `provision/`, and the reason is in
//./server.js: the provisioning search path serves any file in the folders it
//looks at, so the root of `.okc` must never be one of them.
var NAME = 'workspace_claude.md';

module.exports = function doc(deps) {
    var d = deps || {};
    var dirNow = d.dirNow;
    var starter = d.starter;

    var readFile = d.readFile || function (at) { return fs.readFileSync(at, 'utf8'); };
    var writeFile = d.writeFile || function (at, text) { return fs.writeFileSync(at, text); };
    var there = d.there || function (at) {
        try { return fs.existsSync(at); } catch (e) { return false; }
    };

    if (typeof dirNow !== 'function') throw new Error('workstrap needs to be told where the workspace drawer is.');
    if (typeof starter !== 'function') throw new Error('workstrap needs the starter, or a workspace with no notes has nothing to answer with.');

    //WHERE IT WOULD BE, OR NULL WHEN NO WORKSPACE IS OPEN. Null rather than a
    //throw: "there is no workspace" is an ordinary state of this app and every
    //caller here has something sensible to do about it.
    async function at() {
        var dir = await dirNow();
        return dir ? path.join(dir, NAME) : null;
    }

    //---- WHAT A MACHINE IS GIVEN ------------------------------------------
    //
    //THE STARTER IS AN ANSWER, NOT A FAILURE. A workspace nobody has written up
    //yet still has a machine opening it in a minute's time, and handing that
    //machine nothing teaches it nothing — the starter at least tells it what
    //the file is and asks it to fill it in.
    //
    //`mine` IS THE PART THAT MATTERS and is why this does not just return a
    //string. "Somebody wrote this about this project" and "this is the same
    //text every empty workspace gets" are different claims, and they are
    //indistinguishable once both are just text.
    async function read() {
        var file = await at();

        //AN UNREADABLE FILE IS NOT AN ABSENT ONE, and this is the one place the
        //difference could be swallowed. A workspace whose notes cannot be read
        //— a permission, a half-written file, a folder where a file should be —
        //must not quietly answer with the starter, because that reads as "this
        //project has never been written up" when what is true is "what was
        //written cannot be reached".
        if (file && there(file)) {
            var text = readFile(file);
            return { text: String(text), mine: true, at: file };
        }

        return { text: starter(), mine: false, at: file };
    }

    async function write(text) {
        var file = await at();
        if (!file) {
            throw new Error('No workspace is open, so there is nowhere to keep its notes.');
        }
        writeFile(file, String(text));
        return file;
    }

    return { read: read, write: write, at: at, NAME: NAME };
};

module.exports.NAME = NAME;
