var fs = require('fs');
var os = require('os');
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

plugin.consumes = ['app', 'okc', 'state', 'log'];
plugin.provides = ['workspace'];
async function plugin(imports, register) {
    var okc = imports.okc;
    var log = imports.log.on('workspace');
    var state = imports.state;
    var actions = imports.app.host && imports.app.host.actions;
    //WHICH FOLDER IS OPEN IS A FACT ABOUT THIS HOST, not about a workspace —
    //so it goes in the app's drawer. Putting it in the workspace's would be a
    //workspace remembering that it is the one open, which is circular and, on a
    //fresh run with no workspace, unreadable.
    var kept = imports.state.app.doc('workspace');

    var was = null;
    var at = 0;

    //WHAT THE DASHBOARD IS OPEN ON. Not an error when it cannot be reached —
    //this is a default, and a default that throws is not one.
    //
    //AND IT SAYS WHEN IT IS BORROWING, which it did not, and that silence cost a
    //whole session of not knowing. Nothing here had ever chosen a workspace, so
    //EVERY call to `dir()` went down the relay to `status` — and because the
    //relay was always up, nothing ever hinted at it. The board, the drill
    //results, the task store, anything through `state.here`: all of it was
    //standing on one relayed answer, and none of it was in the count of relayed
    //ACTIONS because it is not an action anybody calls.
    //
    //It surfaced by turning the other app off and watching a pane go dark that
    //had no business going dark. A dependency that only shows up when it breaks
    //is one that should announce itself while it works.
    var saidBorrowing = false;
    async function borrowed() {
        try {
            var said = await okc.call('status', {});
            var open = (said && said.workspace && said.workspace.dir) || null;
            if (open && !saidBorrowing) {
                saidBorrowing = true;
                log.warn('no workspace has been chosen here, so this app is using the one the '
                    + 'dashboard has open: ' + open + '. Everything kept per workspace depends on '
                    + 'that app answering. Choose one in the Workspace tab to stand on its own.');
            }
            return open;
        } catch (e) { return null; }
    }

    async function dir() {
        if (was && Date.now() - at < HELD) return was;

        var mine = kept.read({});
        var open = mine && mine.dir;

        //A CLOSE IS NOT AN ABSENCE. See `close()`: borrowing is what this app
        //does when it has never chosen one, and somebody who has just closed one
        //has chosen. Without this, closing put the other app's folder back
        //within three seconds.
        if (!open && !(mine && mine.closed)) open = await borrowed();
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

        //KEPT ALONGSIDE THE ONES SEEN BEFORE. Choosing is also remembering: a
        //list of two folders somebody switches between is the ordinary case, and
        //making them type the path again each time is how one gets typed wrong.
        var mine = shaped(kept.read({}));
        kept.write({ dir: want, at: new Date().toISOString(), known: withOne(mine.known, want) });
        was = want;
        at = Date.now();
        saidBorrowing = false;
        return want;
    }

    //REMEMBERING A FOLDER IS NOT MOVING INTO IT, and for a while it was.
    //
    //`workspaceAdd` called `use`, so the pane's two buttons — "Remember it" and
    //"Remember and open it" — did the same thing, and the first of them switched
    //the entire app to another folder with no confirm dialog in front of it.
    //Everything on every other tab became a statement about somewhere else
    //because somebody filed a path for later.
    //
    //THE TWO ACTS ARE SEPARATE BECAUSE SETTING UP IS SEPARATE FROM MOVING. Three
    //folders can be lined up in one sitting while the one being worked in stays
    //open; and the act that DOES change what this app is about is then a single
    //act with a single dialog, which is what makes it possible to warn about.
    //
    //THE CHECKS ARE `use`'s, deliberately. A path that is not a folder is worth
    //refusing at the moment it is typed rather than at the moment it is opened,
    //which may be days later and somewhere else in the window.
    function add(open) {
        var want = String(open == null ? '' : open).trim();
        if (!want) throw new Error('Which folder?');
        if (!fs.existsSync(want)) throw new Error('There is no folder at "' + want + '".');
        if (!fs.statSync(want).isDirectory()) throw new Error('"' + want + '" is a file, not a folder.');

        var mine = shaped(kept.read({}));
        var had = mine.known.some(function (k) { return k && k.dir === want; });
        kept.write({ dir: mine.dir, at: mine.at, closed: mine.closed, known: withOne(mine.known, want) });
        //`stillOpen` AND NOT `open`, because the action answers with `all()`
        //merged over this and `all().open` is a BOOLEAN. Two fields describing
        //different things under one name, and the more useful one loses — which
        //is how the caller ends up reading `true` as a path.
        return { added: want, already: had, stillOpen: mine.dir || null };
    }

    //---- the ones this app knows about --------------------------------------
    //
    //A LIST OF FOLDERS SOMEBODY CHOSE, not a scan of the disk. Nothing goes
    //looking for workspaces: one is a folder a person points at, and a scan
    //would offer folders nobody meant.
    function shaped(raw) {
        return {
            dir: (raw && raw.dir) || null,
            at: (raw && raw.at) || null,
            //WHETHER SOMEBODY CLOSED IT ON PURPOSE. On the shape rather than
            //read ad hoc, so a writer that goes through here cannot drop it —
            //`add` did, which turned "remember a folder" into "start borrowing
            //the other app's again".
            closed: !!(raw && raw.closed),
            known: (raw && Array.isArray(raw.known)) ? raw.known : []
        };
    }

    function withOne(known, want) {
        var out = known.filter(function (k) { return k && k.dir !== want; });
        var had = known.filter(function (k) { return k && k.dir === want; })[0];
        return out.concat([{ dir: want, added: (had && had.added) || new Date().toISOString() }]);
    }

    //HOW MANY REPOSITORIES ARE IN ONE, asked of the disk. A count kept in the
    //list would be a number that is right on the day it was written.
    function reposIn(where) {
        try {
            return fs.readdirSync(where, { withFileTypes: true }).filter(function (e) {
                return e.isDirectory() && e.name[0] !== '.'
                    && fs.existsSync(path.join(where, e.name, '.git'));
            }).length;
        } catch (e) { return null; }
    }

    //---- looking around the disk for one ------------------------------------
    //
    //THE PLACES A LOOK STARTS FROM. Every drive that answers on Windows, and the
    //one root everywhere else. Asked by trying each letter rather than by
    //shelling out to anything: a drive that is not there simply does not answer,
    //and a mapped drive that has gone away answers the same as one that never
    //existed, which is the honest result.
    function roots() {
        var out = [];
        if (path.sep === '\\') {
            'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(function (letter) {
                var drive = letter + ':\\';
                try { if (fs.existsSync(drive)) out.push({ name: letter + ':', dir: drive }); }
                catch (e) { /* a drive that refuses to be asked is not one to offer */ }
            });
        }
        if (!out.length) out.push({ name: '/', dir: path.sep });
        return out;
    }

    //WHERE A LOOK STARTS WHEN NOBODY SAID. Beside the workspace that is open,
    //because the next one is very often its neighbour; the home folder when
    //there is none, because that is where somebody's work usually is.
    function startsAt() {
        var mine = shaped(kept.read({}));
        var known = mine.dir || (mine.known.length ? mine.known[mine.known.length - 1].dir : null);
        if (known) {
            var up = path.dirname(known);
            if (up && up !== known && fs.existsSync(up)) return up;
        }
        return os.homedir();
    }

    //ONE FOLDER, LISTED, WITH THE ONLY FACT THAT MATTERS FOR THIS CHOICE.
    //
    //`repos` is the count a folder WOULD have as a workspace, which is what
    //makes this better than the desktop's own dialog rather than merely a
    //replacement for it: the answer to "is this the folder?" is on screen before
    //anything is chosen. `isRepo` catches the other mistake — pointing at a
    //repository instead of at the folder that holds several.
    function browse(where) {
        var at = String(where == null ? '' : where).trim() || startsAt();
        var stat;
        try { stat = fs.statSync(at); }
        catch (e) { throw new Error('There is nothing at "' + at + '" to look in.'); }
        if (!stat.isDirectory()) throw new Error('"' + at + '" is a file, not a folder.');

        var entries;
        try { entries = fs.readdirSync(at, { withFileTypes: true }); }
        catch (e) { throw new Error('That folder cannot be read: ' + e.message); }

        var out = [];
        entries.forEach(function (entry) {
            //A DIRENT THAT IS A LINK says it is neither a file nor a directory,
            //so a junction — which is most of what is interesting on Windows —
            //would be missing from the list entirely.
            var full = path.join(at, entry.name);
            var isDir = entry.isDirectory();
            if (!isDir && entry.isSymbolicLink()) {
                try { isDir = fs.statSync(full).isDirectory(); } catch (e) { isDir = false; }
            }
            if (!isDir || entry.name[0] === '.') return;
            var repos = null, isRepo = false;
            try { isRepo = fs.existsSync(path.join(full, '.git')); } catch (e) { isRepo = false; }
            repos = reposIn(full);
            out.push({ name: entry.name, dir: full, repos: repos, isRepo: isRepo });
        });
        out.sort(function (a, b) { return a.name.localeCompare(b.name); });

        var up = path.dirname(at);
        return {
            at: at,
            //A ROOT IS ITS OWN PARENT, which is how a list of drives ends up
            //offering to go up into itself forever.
            up: (up && up !== at) ? up : null,
            here: reposIn(at),
            entries: out,
            roots: roots()
        };
    }

    //EVERY ONE THIS APP KNOWS, AND WHICH IS OPEN.
    //
    //`borrowed` IS ON THE ANSWER, and it is the field this whole thing was
    //written for: it says the folder is the other app's rather than one chosen
    //here, which is the difference between an app that stands on its own and one
    //that looks like it does.
    async function all() {
        var mine = shaped(kept.read({}));
        var open = null;
        try { open = await dir(); } catch (e) { open = null; }

        var known = mine.known.slice();
        //THE BORROWED ONE IS SHOWN, and shown as borrowed. Leaving it out would
        //make the list disagree with every other pane in the window.
        if (open && !known.some(function (k) { return k.dir === open; })) {
            known = known.concat([{ dir: open, added: null }]);
        }

        return {
            open: !!open,
            borrowed: !!open && open !== mine.dir,
            current: open ? { name: path.basename(open), dir: open } : null,
            where: open ? await state.here.where().catch(function () { return null; }) : null,
            known: known.map(function (k) {
                var there = false;
                try { there = fs.existsSync(k.dir) && fs.statSync(k.dir).isDirectory(); } catch (e) { there = false; }
                return {
                    name: path.basename(k.dir),
                    dir: k.dir,
                    added: k.added,
                    current: k.dir === open,
                    //CHOSEN HERE, or standing in for one. A person looking at
                    //two rows needs to know which of them this app actually owns.
                    mine: k.dir === mine.dir,
                    there: there,
                    repos: there ? reposIn(k.dir) : null
                };
            })
        };
    }

    //CLOSING IS NOT FORGETTING. It puts down the folder that is open and leaves
    //it on the list, because the ordinary reason to close one is to open another
    //and come back.
    //CLOSING IS A DECISION, AND FOR A WHILE IT DID NOT STICK.
    //
    //`close()` wrote `dir: null`, and the very next `dir()` found nothing chosen
    //and fell through to `borrowed()` — which asks the app being ported from
    //what IT has open and adopts that. So closing a workspace put the window
    //back to "serving …" within three seconds, on a folder nobody had chosen
    //here, with every gated tab enabled again and `state.here` pointing at that
    //folder's drawer. The one way to tell was the `borrowed` field, which
    //nothing read.
    //
    //BORROWING IS FOR HAVING NEVER CHOSEN, not for having chosen to stop. So a
    //deliberate close is recorded as one, and the borrow is skipped while it
    //stands. Opening anything clears it, because opening is the other decision.
    function close() {
        var mine = shaped(kept.read({}));
        kept.write({ dir: null, at: new Date().toISOString(), known: mine.known, closed: true });
        was = null;
        at = 0;
        return { open: false };
    }

    function forgetOne(which) {
        var want = String(which == null ? '' : which).trim();
        var mine = shaped(kept.read({}));
        var left = mine.known.filter(function (k) { return k.dir !== want; });

        //FORGETTING THE ONE THAT IS OPEN CLOSES IT TOO, because a workspace that
        //is open and not on the list is a state with no way back to it.
        var stillOpen = mine.dir === want ? null : mine.dir;
        //FORGETTING THE OPEN ONE CLOSES IT, and closing it is a decision — same
        //as `close()`, or the borrow would put another folder in its place.
        kept.write({
            dir: stillOpen, at: new Date().toISOString(),
            closed: stillOpen ? mine.closed : true,
            known: left
        });
        if (!stillOpen) { was = null; at = 0; }
        return { forgotten: mine.known.length - left.length, open: !!stillOpen };
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

    //---- the surface --------------------------------------------------------
    //
    //THIS PLUGIN HAD NO ACTIONS AT ALL, which is why the borrowing above could
    //not be ended: the service could be told which folder to use and nothing
    //could tell it. Every workspace verb in the window went down the relay, so
    //picking one HERE was not a thing the app could do.
    var undo = [];
    if (actions) {
        undo.push(actions.define('workspaces', {
            about: 'Every workspace this app knows, which one is open, and whether it chose it',
            run: all
        }));

        undo.push(actions.define('workspaceUse', {
            about: 'Open a workspace — a folder of git repositories',
            takes: ['dir'],
            run: async function (args) {
                var a = args || {};
                //THE LARGEST ACT THIS APP TAKES, AND IT LEFT NO TRACE. Every
                //other line in the events — a task, a branch, a reply — is a
                //statement about the open folder, so a run of them that spans a
                //switch reads as one story about one project and is two. It was
                //noticed by opening an empty workspace and finding the events
                //unchanged: `remembered` was there and `opened` was not.
                var before = null;
                try { before = await dir(); } catch (e) { before = null; }
                var open = use(a.dir);
                log.good('opened ' + open + (before && before !== open ? ' — was ' + before : '')
                    + '. What is armed follows the folder, so this one is set to whatever it was set to.');
                return all();
            }
        }));

        //ADDING IS NOT OPENING, and the answer says which happened. See `add`.
        undo.push(actions.define('workspaceAdd', {
            about: 'Remember a folder of repositories, leaving the open one alone. workspaceUse opens it',
            takes: ['dir'],
            run: async function (args) {
                var a = args || {};
                var out = add(a.dir);
                log.info('remembered "' + out.added + '"'
                    + (out.already ? ', which was already on the list' : '')
                    + '. The workspace that is open did not change.');
                return Object.assign(out, await all());
            }
        }));

        //---- LOOKING FOR ONE, WHICH IS NOT THE SAME AS KNOWING ITS PATH ------
        //
        //A WORKSPACE USED TO BE CHOSEN BY TYPING AN ABSOLUTE PATH into the one
        //field in this window that cannot be checked as it is typed — a trailing
        //slash, a backslash eaten by something on the way, the wrong drive. The
        //app being ported from opens the desktop's own folder dialog, and that
        //cannot be ported: this window is served over http, so it is a REMOTE
        //page and nw injects nothing into it (../core/shot/main.js says why that
        //is worth keeping). ../core/window/main.js reaches the native dialog from
        //the node side, and this is the other half — the one that also works in
        //an ordinary browser tab, where there is no nw to reach.
        //
        //AND IT ANSWERS THE QUESTION THE NATIVE DIALOG CANNOT. What makes a
        //folder the right one here is what is INSIDE it, so every candidate is
        //listed with the number of git repositories one level down. Choosing
        //stops being a guess followed by a pane that says nothing is there.
        //
        //REFUSED DOWN THE PIPE. This enumerates the person's disk. Nothing on a
        //machine, in a script or in a model needs to go looking through it, and
        //the one caller is a person deciding where their work is.
        undo.push(actions.define('folderList', {
            about: 'What is inside a folder, for choosing a workspace: subfolders, and how many git repositories each holds',
            takes: ['at'],
            run: async function (args) {
                var a = args || {};
                if (a._overTheWire || a._driven) {
                    throw new Error('Looking through this computer\'s folders is done at the window, by the person '
                        + 'whose computer it is. What a workspace IS can be asked for down the pipe — `workspaces` '
                        + 'lists the ones this app knows.');
                }
                return browse(a.at);
            }
        }));

        undo.push(actions.define('workspaceClose', {
            about: 'Put down the workspace that is open, leaving it on the list',
            run: async function () {
                var before = null;
                try { before = await dir(); } catch (e) { before = null; }
                close();
                log.info('closed ' + (before || 'the workspace')
                    + '. It stays on the list, and what was set for it stays with it.');
                return all();
            }
        }));

        undo.push(actions.define('workspaceForget', {
            about: 'Take a workspace off this app\'s list. The folder itself is untouched',
            takes: ['dir'],
            run: async function (args) {
                var a = args || {};
                //THE FOLDER IS NOT TOUCHED, and the message says so, because
                //"forget" beside a path is a word somebody can read as delete.
                var out = forgetOne(a.dir);
                log.info('forgot "' + a.dir + '". The folder itself was not changed.');
                return Object.assign(out, await all());
            }
        }));
    }

    await register(null, {
        workspace: {
            dir: dir,
            use: use,
            add: add,
            all: all,
            close: close,
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
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
