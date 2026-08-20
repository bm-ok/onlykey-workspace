var fs = require('fs');
var path = require('path');

//---------------------------------------------------------------------------
//the workspace: which folder is open, and what is in it.
//
//THE ONE THING THAT TURNS A NAME INTO A PATH. Everything else in this app says
//`local-repo-a` and means it — a name somebody picked out of a list, or typed at
//a command line. Exactly one place may turn that into somewhere on a disk, and
//it is this one, because a caller that can hand over a path can hand over any
//path and the things downstream RUN PROGRAMS in whatever they are given.
//
//IT WENT IN ../git FIRST, WHICH WAS THE WRONG SHELF. That plugin runs git; it
//should not also be the thing that decides what a repository is or where the
//workspace lives. Two plugins away from now something else needs the same
//answer — the repos pane, the branches pane, whatever reads a file out of a
//checkout — and each would have grown its own copy of the folder scan, which is
//the shape of every "second opinion about state" bug this project has had.
//
//WHERE THE FOLDER COMES FROM, FOR NOW. `core/workspaces` has not moved across,
//so the open folder is read from the dashboard's `status`. That is deliberate
//and it is the honest source: it is the folder the app is actually open on,
//rather than a second idea of it kept here. When that plugin moves, this file is
//the only one that changes.
//
//AND IT IS NOT ASKED FOR EVERY CALL. `folderOf` runs for every diff, every file
//list and every log — three times a keystroke on a pane that is being read —
//and each would be a round trip down the relay. Held for a few seconds, which is
//far shorter than anybody changes workspace and far longer than one pane's worth
//of questions.
//---------------------------------------------------------------------------

var HELD = 3000;

plugin.consumes = ['app', 'okc'];
plugin.provides = ['workspace'];
async function plugin(imports, register) {
    var okc = imports.okc;

    var was = null;
    var at = 0;

    async function dir() {
        if (was && Date.now() - at < HELD) return was;
        var said = await okc.call('status', {});
        var open = said && said.workspace && said.workspace.dir;
        if (!open) throw new Error('no workspace is open, so there is nothing to read');
        was = open;
        at = Date.now();
        return open;
    }

    //A FOLDER WITH A .git IN IT, one level down. Asked of the disk rather than
    //kept in a list, because a list is a thing that can be wrong about what is
    //really there — and being wrong about that is how something ends up running
    //a command in a folder that is not a repository.
    async function repos() {
        var open = await dir();
        var out = [];
        var entries;
        try { entries = fs.readdirSync(open, { withFileTypes: true }); }
        catch (e) { throw new Error('the workspace folder cannot be read: ' + e.message); }

        entries.forEach(function (entry) {
            if (!entry.isDirectory() || entry.name[0] === '.') return;
            var full = path.join(open, entry.name);
            if (fs.existsSync(path.join(full, '.git'))) out.push({ name: entry.name, dir: full });
        });
        return out;
    }

    //A NAME IN, A FOLDER OUT, AND A REFUSAL FOR EVERYTHING ELSE.
    //
    //It compares against what is actually in the workspace rather than checking
    //the string for `..` and separators, and that is the whole point: a deny list
    //is a list somebody has to have got right, and an allow list is the disk. A
    //name that is not one of these folders is not a folder, whatever it looks
    //like.
    //
    //THE REFUSAL NAMES THE REAL ONES, because "no such repository" leaves
    //somebody guessing at spelling in a workspace they may not have opened.
    async function folderOf(name) {
        var want = String(name == null ? '' : name).trim();
        if (!want) throw new Error('Which repository?');

        var all = await repos();
        var found = all.filter(function (r) { return r.name === want; })[0];
        if (!found) {
            throw new Error('There is no repository called "' + want + '" in this workspace. There is: '
                + (all.map(function (r) { return r.name; }).join(', ') || 'none'));
        }
        return found.dir;
    }

    await register(null, {
        workspace: {
            dir: dir,
            repos: repos,
            folderOf: folderOf,
            //SO A TEST OR A RELOAD DOES NOT READ A STALE FOLDER. Nothing calls
            //this in ordinary use; it exists because a cache with no way to drop
            //it is a cache somebody works around.
            forget: function () { was = null; at = 0; }
        }
    });
}
module.exports = plugin;
