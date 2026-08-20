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
//IT KEEPS ITS OWN CHOICE NOW, in ../core/state, which is what makes this a
//plugin rather than a view onto somebody else's setting. Somebody picks a
//workspace here; this remembers it; everything downstream asks this. The picking,
//the keeping and the answering are one plugin's job, so a different one of any of
//them changes one folder.
//
//AND IT ADOPTS THE DASHBOARD'S ON A FIRST RUN, rather than starting empty. That
//app is still open on a folder and still answering most of this window's
//questions; coming up with nothing selected would mean a pane comparing branches
//in one workspace beside a pane listing repositories in another, with nothing on
//screen saying why. So the borrowed answer is the DEFAULT and the kept one wins
//once there is one — and the day core/workspaces moves across, the fallback is
//the only part that goes.
//
//AND IT IS NOT ASKED FOR EVERY CALL. `folderOf` runs for every diff, every file
//list and every log — three times a keystroke on a pane that is being read —
//and each would be a round trip down the relay. Held for a few seconds, which is
//far shorter than anybody changes workspace and far longer than one pane's worth
//of questions.
//---------------------------------------------------------------------------

var HELD = 3000;

plugin.consumes = ['app', 'okc', 'state'];
plugin.provides = ['workspace'];
async function plugin(imports, register) {
    var okc = imports.okc;
    //WHICH FOLDER IS OPEN IS A FACT ABOUT THIS HOST, not about a workspace —
    //so it goes in the app's drawer. Putting it in the workspace's would be a
    //workspace remembering that it is the one open, which is circular and, on a
    //fresh run with no workspace, unreadable.
    var kept = imports.state.app.doc('workspace');

    var was = null;
    var at = 0;

    //WHAT THE DASHBOARD IS OPEN ON. Not an error when it cannot be reached —
    //this is a default, and a default that throws is not one.
    async function borrowed() {
        try {
            var said = await okc.call('status', {});
            return (said && said.workspace && said.workspace.dir) || null;
        } catch (e) { return null; }
    }

    async function dir() {
        if (was && Date.now() - at < HELD) return was;

        var mine = kept.read({});
        var open = mine && mine.dir;

        if (!open) open = await borrowed();
        if (!open) throw new Error('no workspace is open, so there is nothing to read');

        was = open;
        at = Date.now();
        return open;
    }

    //CHOSEN, AND KEPT. The one act this plugin has, and the reason it owns the
    //value rather than reading somebody else's.
    //
    //IT CHECKS BEFORE IT KEEPS. A workspace that is not a folder is a setting
    //that breaks every pane downstream with an error about somewhere that does
    //not exist, at the moment somebody is least expecting one.
    function use(open) {
        var want = String(open == null ? '' : open).trim();
        if (!want) throw new Error('Which folder?');
        if (!fs.existsSync(want)) throw new Error('There is no folder at "' + want + '".');
        if (!fs.statSync(want).isDirectory()) throw new Error('"' + want + '" is a file, not a folder.');

        kept.write({ dir: want, at: new Date().toISOString() });
        was = want;
        at = Date.now();
        return want;
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

    //AND ../core/state IS TOLD WHERE WE ARE, rather than asking. It keeps a
    //drawer per workspace and cannot consume this plugin to find out which —
    //this one already consumes it, and each waiting on the other is a graph that
    //does not resolve. So the answer is pushed, and because `state.here` resolves
    //it on every call, changing workspace changes the drawer with nothing
    //subscribing and nothing reloading.
    imports.state.follow(function () { return dir().catch(function () { return null; }); });

    await register(null, {
        workspace: {
            dir: dir,
            use: use,
            repos: repos,
            folderOf: folderOf,
            //WHETHER THIS IS THIS APP'S CHOICE OR THE OTHER APP'S, which the
            //picker has to be able to say. "Open on the same folder as the
            //dashboard" and "open on the folder somebody chose here" look
            //identical from a path.
            chosen: function () { return !!(kept.read({}) || {}).dir; },
            //SO A TEST OR A RELOAD DOES NOT READ A STALE FOLDER. Nothing calls
            //this in ordinary use; it exists because a cache with no way to drop
            //it is a cache somebody works around.
            forget: function () { was = null; at = 0; }
        }
    });
}
module.exports = plugin;
