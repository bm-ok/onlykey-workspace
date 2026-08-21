var fs = require('fs');
var path = require('path');

//---------------------------------------------------------------------------
//what the repositories on this disk say right now — read once, for everybody.
//
//THE PROBLEM THIS EXISTS FOR IS A PLACEMENT ONE. Four plugins in this group each
//consume `git` and each asks it the same handful of questions on its own timer:
//
//    branches/server.js   tracked x2  head  branches  has x4
//    repos/server.js      tracked x2  head  branches  origin x4
//    conflicts/server.js  tracked
//    pr/server.js         origin x4
//
//NOBODY OWNS THE ANSWER, SO EVERYBODY ASKS. And `tracked` already reads every
//local ref AND every remote ref in one pass, which means `branches`, `head` and
//`has` are separate git processes for facts the same `for-each-ref` has already
//got in hand.
//
//THE APP BEING PORTED FROM DID NOT HAVE THIS PROBLEM AND IT IS WORTH SAYING WHY.
//../../../../dashboard/repos/branches.js held every git read in one file, with
//one memo over the three raw reads and one `forgetRefs()`. That file WAS the
//isolation. This app split those reads across four plugins and the shared layer
//is the half that did not come with them — so the board takes seven seconds and
//a trace of the original found 39% of its samples inside `spawn`.
//
//So the owner comes back, as a plugin rather than as a file, and the mechanism
//it uses is ../../core/cached rather than a memo of its own.
//
//---- what makes it safe to reuse an answer -------------------------------
//
//A CLOCK, WHICH IS THE ONE KIND ../../core/cached WARNS ABOUT — and it is the
//right kind here for a reason worth stating: reading the refs to find out
//whether a cached ref read is still good costs exactly what the read costs.
//There is no content to key on that is cheaper than the answer. See the header
//of ../../core/cached/drawers.js.
//
//SO THE WINDOW IS SMALL AND IT IS NOT WHAT KEEPS THIS CORRECT. Two things do:
//
//  1. ../../git ANNOUNCES ITS OWN WRITES. Anything whose subcommand is not in
//     its READS list has written, decided from the argv rather than remembered
//     by each write function, so a write door added later announces itself with
//     nobody having to make it.
//
//  2. AND A PERSON WITH A TERMINAL IS WATCHED FOR. `git checkout -b` in a shell
//     is invisible to (1), and it is the ordinary way branches appear here. The
//     old app had no answer to this at all beyond its one-second window.
//
//THE WINDOW IS THEREFORE A BACKSTOP, not the mechanism: `fs.watch` misses events
//on some filesystems and fires none at all on a few network ones. Two seconds is
//"no single draw asks twice" — it is deliberately not tuned up, because a number
//that only looks safe while the watcher works is a number that hides the day the
//watcher stops.
//---------------------------------------------------------------------------

//LONG ENOUGH TO COVER ONE DRAW, short enough that a missed watch event is a
//blink rather than a wrong board.
var FRESH = 2000;

//WHERE A REPOSITORY CAME FROM changes when somebody edits `.git/config`, which
//the watch below sees. It cannot change through this app at all — ../../git's
//`ORIGIN` is `remote get-url` with fixed argv and there is no set-url door — so
//this is the one read here that a longer window genuinely fits.
var ORIGIN_FRESH = 60000;

//A GIT WRITE TOUCHES MANY FILES. One `fetch --prune` rewrites packed-refs, a
//dozen loose refs and FETCH_HEAD; invalidating per event would empty the drawer
//a dozen times and, worse, do it while the same write is still going.
var SETTLE = 150;

plugin.consumes = ['app', 'log', 'git', 'workspace', 'cached'];
plugin.provides = ['refs'];
async function plugin(imports, register) {
    var git = imports.git;
    var workspace = imports.workspace;
    var log = imports.log.on('refs');

    var rows = imports.cached.whileFresh('refs', FRESH);
    var origins = imports.cached.whileFresh('origins', ORIGIN_FRESH);

    var undo = [];

    //---- one read per repository, and everything else derived from it -------

    //EVERY BRANCH, WHERE IT IS HERE, AND WHERE ORIGIN HAS IT. Two git processes
    //for a whole repository however many branches it has. See ../../git.
    async function of(repo) {
        var name = String(repo);
        return await rows.get(name, function () { return git.tracked(name); });
    }

    async function origin(repo) {
        var name = String(repo);
        return await origins.get(name, function () {
            return git.origin(name).catch(function () { return null; });
        });
    }

    //DERIVED, NOT ASKED. `git branch` is a second process for a list the read
    //above already has.
    async function branches(repo) {
        var all = await of(repo);
        return Object.keys(all)
            .filter(function (b) { return !!all[b].local; })
            .sort(function (a, b) { return a.localeCompare(b); });
    }

    //---- the two questions that look like `git.has` and are not -------------
    //
    //`git.has(repo, ref)` RESOLVES ANY REF — a sha, a tag, `HEAD~3`. This cannot
    //answer that from a list of branches, and the dangerous half is the NEGATIVE:
    //a tag is a perfectly good ref and is not in here, so "not a branch" derived
    //from this list would be returned as "does not exist" and a caller would go
    //on to refuse something that is really there.
    //
    //SO THESE ARE DIFFERENT FUNCTIONS WITH DIFFERENT NAMES, rather than a
    //cheaper `has`. Every call site in this group that reads `git.has(...)`
    //means one of these two; anything that genuinely means "resolve this ref"
    //keeps asking ../../git, and should.
    async function hasBranch(repo, name) {
        var all = await of(repo);
        var row = all[String(name)];
        return !!(row && row.local);
    }

    async function hasRemote(repo, name) {
        var all = await of(repo);
        var row = all[String(name).replace(/^refs\/remotes\/origin\//, '')];
        return !!(row && row.remote);
    }

    //WHICH BRANCH THE WORKING TREE IS ON. The one thing here that is NOT in the
    //ref walk — `for-each-ref` lists refs, and HEAD is a symbolic ref to one of
    //them — so it is its own process, kept in the same drawer under a key that
    //cannot collide with a repository name.
    async function head(repo) {
        var name = String(repo);
        return await rows.get('head:' + name, function () {
            return git.head(name).catch(function () { return null; });
        });
    }

    //EVERY BRANCH IN EVERY REPOSITORY AND WHERE IT IS, which is the shape the
    //board wants: a lookup rather than a process per branch.
    async function heads(repos) {
        var found = repos || await workspace.repos();
        var at = {};
        for (var i = 0; i < found.length; i++) {
            var name = found[i].name || found[i];
            at[name] = {};
            try {
                var all = await of(name);
                Object.keys(all).forEach(function (b) { at[name][b] = all[b].local || null; });
            } catch (e) { /* a repository with no refs yet answers nothing, which is correct */ }
        }
        return at;
    }

    //---- when to stop believing any of it ----------------------------------

    function forget(repo) {
        if (repo === undefined) { rows.empty(); origins.empty(); return; }
        var name = String(repo);
        rows.forget(name);
        rows.forget('head:' + name);
        origins.forget(name);
    }

    //A FOLDER, BACK TO THE NAME THIS APP CALLS IT. ../../git announces where it
    //wrote, because that is what it has; everything here is named.
    var byDir = {};
    async function learnFolders() {
        try {
            var found = await workspace.repos();
            byDir = {};
            found.forEach(function (r) { byDir[path.resolve(r.dir)] = r.name; });
            return found;
        } catch (e) { return []; }
    }

    function nameFor(dir) {
        if (!dir) return null;
        var at = path.resolve(String(dir));
        if (byDir[at]) return byDir[at];
        //A WRITE INSIDE A REPOSITORY rather than at its root — ../../git runs in
        //the repository folder, but this stays true if that ever changes.
        var names = Object.keys(byDir);
        for (var i = 0; i < names.length; i++) {
            if (at.indexOf(names[i] + path.sep) === 0) return byDir[names[i]];
        }
        return null;
    }

    //(1) THIS APP WROTE. See ../../git's `wrote`.
    undo.push(git.wrote(function (said) {
        var name = nameFor(said && said.dir);
        //AN UNRECOGNISED FOLDER DROPS EVERYTHING rather than nothing. Being
        //over-eager costs one re-read; being wrong costs a board that says a
        //branch is somewhere it is not, right after the button that moved it.
        forget(name === null ? undefined : name);
    }));

    //(2) SOMEBODY ELSE WROTE — a terminal, an editor, another checkout of the
    //same folder. `git checkout -b` in a shell is the ordinary way a branch
    //appears here and (1) cannot see it.
    var watching = [];
    var soon = null;
    var pending = {};

    function touched(name) {
        pending[name] = true;
        if (soon) return;
        soon = setTimeout(function () {
            soon = null;
            var names = Object.keys(pending);
            pending = {};
            names.forEach(forget);
        }, SETTLE);
        if (soon.unref) soon.unref();
    }

    //WHAT ACTUALLY CHANGES AN ANSWER HERE. An object write, an index write and a
    //lock file do not, and a repository being worked in writes those constantly
    //— so this filters rather than dropping the drawer on every event.
    //
    //A FILENAME FROM `fs.watch` IS RELATIVE TO THE DIRECTORY BEING WATCHED, and
    //there are two of them. `git branch x` under the `.git/refs` watch arrives
    //as `heads/x`, NOT as `refs/heads/x` — so testing both against one set of
    //patterns silently dropped every ref write, which is the only kind this
    //watch exists for. It cost a green-looking watcher that noticed nothing.
    function matters(file, underRefs) {
        if (!file) return true;
        var f = String(file).replace(/\\/g, '/');
        if (/\.lock$/.test(f)) return false;
        //EVERYTHING UNDER `refs/` IS A REF. There is nothing else in there.
        if (underRefs) return true;
        return /^refs(\/|$)/.test(f) || /^packed-refs$/.test(f)
            || /^HEAD$/.test(f) || /^config$/.test(f);
    }

    var watched = {};
    function watch(name, dir) {
        //ONCE PER REPOSITORY. `warm` may be called again — by hand, or after a
        //workspace changes — and a second set of watches on the same folder is
        //a second invalidation for every event, for ever.
        if (watched[name]) return;
        watched[name] = true;

        var git_ = path.join(dir, '.git');

        //TWO WATCHES, NOT ONE RECURSIVE ONE OVER `.git`. Recursive would also
        //cover `objects/`, which is where a repository writes constantly and
        //where nothing changes an answer here — and on a large repository that
        //is a great many events to filter for nothing.
        [[git_, false], [path.join(git_, 'refs'), true]].forEach(function (pair) {
            var at = pair[0], underRefs = pair[1];
            try {
                var w = fs.watch(at, { recursive: underRefs }, function (_e, file) {
                    if (matters(file, underRefs)) touched(name);
                });
                //A WATCH THAT DIES MUST NOT TAKE THE APP WITH IT. Losing one
                //means falling back to the window, which is what it is for.
                w.on('error', function () { try { w.close(); } catch (e) { /* gone */ } });
                watching.push(w);
            } catch (e) {
                //A `.git` THAT IS A FILE is a worktree or a submodule, and there
                //is nothing to watch. Said once, not per event.
                log.info('not watching ' + name + ': ' + e.message);
            }
        });
    }

    //---- everything it needs, at the start of the app ----------------------
    //
    //SO THE FIRST BOARD IS NOT THE SLOWEST ONE. Nothing depends on this having
    //finished — every read above works whether or not it ran — and it is
    //deliberately not awaited by `register`, because a workspace that is slow to
    //read must not hold up the rest of the graph starting.
    async function warm() {
        var found = await learnFolders();
        for (var i = 0; i < found.length; i++) {
            watch(found[i].name, found[i].dir);
            try { await of(found[i].name); await head(found[i].name); await origin(found[i].name); }
            catch (e) { /* a repository that will not answer is not a reason to stop */ }
        }
        return found.length;
    }

    imports.app.on('start', function () {
        warm().then(function (n) {
            if (n) log.info('read ' + n + ' repositories, and watching them');
        }, function (e) { log.info('could not read the workspace yet: ' + e.message); });
    });

    await register(null, {
        refs: {
            of: of,
            branches: branches,
            head: head,
            heads: heads,
            origin: origin,
            hasBranch: hasBranch,
            hasRemote: hasRemote,

            //FOR A CALLER THAT JUST WROTE THROUGH SOMETHING THAT IS NOT
            //../../git — the GitHub half, a person pressing sync. Ordinary
            //writes need nobody to call this.
            forget: forget,
            warm: warm
        },
        onDestroy: function () {
            while (undo.length) undo.pop()();
            if (soon) { clearTimeout(soon); soon = null; }
            while (watching.length) { try { watching.pop().close(); } catch (e) { /* gone */ } }
            watched = {};
        }
    });
}
module.exports = plugin;
