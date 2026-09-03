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
//THE APP THIS WAS PORTED FROM held every git read in one file, with
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

//---- HOW LONG AN ANSWER IS BELIEVED, AND WHY IT IS NOW LONG ---------------
//
//THIS WAS TWO SECONDS AND IT SAVED NOTHING. Two seconds covers one draw — no
//single board read asks git the same thing twice — and every draw after it paid
//in full. The panes are read every eight to ten seconds, so the window between
//them was never once a hit: the drawer reported a healthy hit rate the whole
//time, because the hits were all INSIDE a draw, and git ran flat out anyway.
//
//MEASURED: 167 git processes in 45 seconds with the app sitting idle on one tab,
//about 3.7 a second, every one of them re-answering a question whose answer had
//not changed. `repositories` alone is twelve processes and something asks for it
//every eight seconds.
//
//SO THE ANSWER IS KEPT UNTIL SOMETHING SAYS OTHERWISE, and the something already
//exists: (1) ../../git announces its own writes, and (2) `fs.watch` on each
//`.git` and `.git/refs` catches a person in a terminal. Both were already wired
//to `forget`. The clock was not protecting anything they do not — it was
//throwing away good answers on a timer and calling it safety.
//
//AND IT IS ONLY TRUSTED WHERE THE WATCH ACTUALLY RUNS. That is the whole of the
//objection this file used to raise against a longer window — "a number that only
//looks safe while the watcher works is a number that hides the day the watcher
//stops" — and it is answered by not applying the number there. `fs.watch` throws
//on a `.git` that is a file, and fires nothing at all on some network shares; a
//repository whose watch did not start keeps the old two-second behaviour and
//re-reads. Nothing is trusted for five minutes on the strength of a watcher that
//was never listening.
var KEPT = 300000;

//WHAT AN UNWATCHED REPOSITORY GETS, which is what every repository used to get:
//long enough that one draw does not ask twice, and nothing more.
var FRESH = 2000;

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

    //KEPT UNTIL SOMETHING SAYS OTHERWISE, for a repository whose watch is
    //running — see the header, and `drawerFor` below.
    var rows = imports.cached.whileFresh('refs', KEPT);

    //AND THE OLD BEHAVIOUR FOR ONE THAT IS NOT BEING WATCHED: long enough that a
    //single draw does not ask twice, and nothing more.
    var quick = imports.cached.whileFresh('refs-unwatched', FRESH);

    //WHICH REPOSITORIES ARE ACTUALLY BEING LISTENED TO. Set when `fs.watch`
    //started, not when it was tried — see `watch` at the bottom of this file.
    var listening = {};
    var origins = imports.cached.byStamp('origins');

    var undo = [];

    //---- one read per repository, and everything else derived from it -------

    //EVERY BRANCH, WHERE IT IS HERE, AND WHERE ORIGIN HAS IT. Two git processes
    //for a whole repository however many branches it has. See ../../git.
    //---- WHICH DRAWER A REPOSITORY'S ANSWERS GO IN ------------------------
    //
    //TWO WINDOWS, CHOSEN PER REPOSITORY, because the long one is only honest
    //where something is listening. `listening` is set when `fs.watch` actually
    //started — not when it was attempted. It throws on a `.git` that is a file
    //and fires nothing at all on some network shares, and a repository in either
    //state must not be trusted for five minutes on the strength of a watcher
    //that was never there.
    //
    //THAT IS THE WHOLE OF THE SAFETY, and it is what makes the long window
    //defensible where this file previously argued it was not.
    function drawerFor(name) { return listening[name] ? rows : quick; }

    async function of(repo) {
        var name = String(repo);
        return await drawerFor(name).get(name, function () { return git.tracked(name); });
    }

    //---- where a repository came from --------------------------------------
    //
    //KEYED ON `.git/config`, NOT ON A CLOCK, and the difference is one a test
    //caught rather than one anybody reasoned out.
    //
    //THIS WAS A SIXTY-SECOND WINDOW, argued for on the grounds that origin
    //cannot change through this app at all — ../../git's url read is fixed argv
    //with no set-url door. That is true and it is not the question. A PERSON can
    //change it, in a terminal, and ../repos has a whole panel about noticing:
    //what it knows about a remote goes stale the moment origin moves, and its
    //own comment says the dangerous shape is not an empty panel but a FULL one
    //describing somewhere else. A window makes that panel wrong for a minute.
    //
    //LEANING ON THE WATCH FOR IT WOULD BE WORSE. The watch does see `config`,
    //so this would have worked in the running app and failed exactly where the
    //watch had not been set up — the case this file's own header warns about: a
    //number that only looks safe while the watcher works is a number that hides
    //the day the watcher stops.
    //
    //SO IT IS KEYED ON THE FILE THE ANSWER COMES FROM. A stat is a fraction of
    //a millisecond against a git process, so a draw asking four times still
    //spawns once — and the answer cannot be stale, because a changed remote is
    //a changed file is a different key. See `byStamp` in ../../core/cached, and
    //note it is the kind that is never written to disk.
    async function stampOf(repo) {
        var dir = await workspace.folderOf(repo);
        var st = fs.statSync(path.join(dir, '.git', 'config'));
        return st.mtimeMs + ':' + st.size;
    }

    async function origin(repo) {
        var name = String(repo);

        var stamp = null;
        try { stamp = await stampOf(name); }
        catch (e) {
            //NO STAMP MEANS NO KEY, AND NO KEY MEANS NO CACHE. A repository
            //mid-clone, a `.git` that is a file, a permission — any of them
            //would otherwise pool every repository under one constant key.
            return await git.origin(name).catch(function () { return null; });
        }

        return await origins.get(name + '|' + stamp, function () {
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
        return await drawerFor(name).get('head:' + name, function () {
            return git.head(name).catch(function () { return null; });
        });
    }

    //---- THE COMMIT A REF IS AT, IN FULL -----------------------------------
    //
    //`of()` ALREADY HAS ONE OF THESE AND IT IS THE WRONG ONE. The ref walk asks
    //for `%(objectname:short)`, and ../repos compares this value against a sha
    //GITHUB gave it — forty characters — to say whether this host is in step
    //with its fork. A short sha never equals a long one, so answering this from
    //the walk would report every repository as permanently out of step, with a
    //panel that looks exactly as it should apart from being wrong.
    //
    //IT WAS `git.run` STRAIGHT OUT OF ../repos, and that is why it is here now.
    //One `rev-parse` per repository per draw, going round this plugin entirely —
    //so a board whose every other answer came out of a drawer still spawned
    //three processes to ask where three default branches were, every time,
    //including on the calls where nothing else was worked out at all.
    //
    //KEPT IN THE SAME DRAWER AS EVERYTHING ELSE, so one write invalidates the
    //lot together. Under a key that cannot collide with a repository name or
    //with `head:`.
    var shaKeys = {};

    async function sha(repo, ref) {
        var name = String(repo);
        var want = String(ref);
        var key = 'sha:' + name + ':' + want;
        //REMEMBERED PER REPOSITORY, because the drawer forgets by exact key and
        //a repository can be asked about more than one ref. Without this list
        //`forget` would have nothing to name, and a stale sha would outlive the
        //write that changed it — which is the one failure a ref cache must not
        //have.
        (shaKeys[name] = shaKeys[name] || {})[key] = true;

        return await drawerFor(name).get(key, function () {
            return git.run(name, ['rev-parse', want]).then(function (said) {
                return said.code === 0 ? (String(said.stdout || '').trim() || null) : null;
            }, function () { return null; });
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

    //---- the two expensive answers, keyed on the commits they are about -----
    //
    //BOTH ARE PURE FUNCTIONS OF TWO COMMITS: if neither has moved the answer
    //cannot have changed, and if either has, the key is different. So they are
    //`byContent` — no clock, and the one kind worth keeping across a restart,
    //because `merge-tree` on a real repository is not cheap and its answer for
    //two given commits is true for ever.
    //
    //THEY LIVE HERE BECAUSE THIS IS WHERE THE SHAS ALREADY ARE, and that is the
    //whole point rather than a convenience.
    //
    //`git.unlanded` USED TO CACHE ITSELF AND PAID MORE FOR ITS KEY THAN IT
    //SAVED: two `rev-parse` processes to resolve the pair, run on a cache HIT as
    //well as a miss. Nine branches in three repositories is eighteen processes
    //per draw that bought nothing, for ever. ../branches carries a note about
    //being cured of exactly this and `unlanded` was simply missed.
    //
    //`wouldConflict` HAD NO CACHE AT ALL, while a comment in ../branches said it
    //did — three processes per diverged branch, every fifteen seconds, on the
    //pane most likely to sit unchanged for days.
    //
    //THE MEMO CAME OUT OF ../../git TOO. Two caches for one answer is one that
    //drifts, and the drifted one is whichever nobody reads.
    var landed = imports.cached.byContent('landed');
    var merges = imports.cached.byContent('merges');

    //A BRANCH NAME TO WHERE IT IS, out of the read this plugin already did.
    //Null for anything that is not a branch of this repository — a tag, a sha,
    //`HEAD~3` — which is the signal to hand the whole question back to
    //../../git rather than guess at it.
    function shaIn(rows, ref) {
        var name = String(ref).replace(/^refs\/remotes\/origin\//, '');
        var row = rows[name];
        if (!row) return null;
        return String(ref).indexOf('refs/remotes/origin/') === 0 ? row.remote : row.local;
    }

    //HOW MUCH OF `branch` IS GENUINELY NOT IN `base`, BY CONTENT. See the long
    //note in ../../git: GitHub squashes, so counting by sha says a branch
    //carries work that landed a week ago.
    async function unlanded(repo, base, branch) {
        var name = String(repo);
        var rows = await of(name);
        var at = shaIn(rows, base), to = shaIn(rows, branch);

        //NOT SOMETHING THIS CAN KEY. ../../git resolves any ref and is asked to.
        if (!at || !to) return await git.unlanded(name, base, branch);
        if (at === to) return 0;

        return await landed.get(name + '|' + at + '|' + to, function () {
            return git.unlanded(name, base, branch);
        });
    }

    //WOULD THESE TWO CONFLICT, AND WHERE. Three answers, and `clean: null` means
    //"could not tell" — kept like any other, because re-running merge-tree to be
    //told again that it cannot tell is the most expensive way to learn nothing.
    async function wouldConflict(repo, ours, theirs) {
        var name = String(repo);
        var rows = await of(name);
        var a = shaIn(rows, ours), b = shaIn(rows, theirs);

        if (!a || !b) return await git.wouldConflict(name, ours, theirs);

        return await merges.get(name + '|' + a + '|' + b, function () {
            return git.wouldConflict(name, ours, theirs);
        });
    }

    //---- when to stop believing any of it ----------------------------------

    //BOTH DRAWERS, ALWAYS. Which one a repository's answers went into depends on
    //whether its watch was running when they were worked out, and that can change
    //— a watch can die. Forgetting only the one it would go in TODAY would leave
    //yesterday's answer in the other, which is the shape of a cache that is wrong
    //exactly once and never again reproducible.
    function forget(repo) {
        if (repo === undefined) { rows.empty(); quick.empty(); origins.empty(); shaKeys = {}; return; }
        var name = String(repo);
        [rows, quick].forEach(function (d) {
            d.forget(name);
            d.forget('head:' + name);
            Object.keys(shaKeys[name] || {}).forEach(function (k) { d.forget(k); });
        });
        //AND EVERY REF THIS REPOSITORY WAS ASKED THE COMMIT OF. See `sha` above:
        //the drawer forgets by exact key, so the keys have to be remembered or a
        //stale sha outlives the write that moved it.
        Object.keys(shaKeys[name] || {}).forEach(function (k) { rows.forget(k); });
        delete shaKeys[name];
        //ORIGIN IS KEYED ON `.git/config`, so there is nothing here to forget:
        //a changed remote is already a different key. Emptying it on every ref
        //write would throw away a correct answer for nothing.
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
                //AND A WATCH THAT DIES STOPS BEING TRUSTED, which is the half
                //that makes the long window safe. `listening` is what `drawerFor`
                //reads; dropping it here puts this repository back on the
                //two-second window from the next read onwards, rather than
                //leaving five minutes of answers behind a watcher that has
                //stopped saying anything.
                w.on('error', function () {
                    try { w.close(); } catch (e2) { /* gone */ }
                    if (listening[name]) {
                        delete listening[name];
                        forget(name);
                        log.warn('the watch on ' + name + ' stopped, so its reads go back to being re-read');
                    }
                });
                watching.push(w);
                //SET WHEN IT STARTED, NOT WHEN IT WAS TRIED. `fs.watch` throws
                //below on a `.git` that is a file, and the whole point of
                //`drawerFor` is that a repository nobody is listening to is not
                //trusted for five minutes.
                listening[name] = true;
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
            sha: sha,
            origin: origin,
            hasBranch: hasBranch,
            hasRemote: hasRemote,

            //THE TWO EXPENSIVE ONES, keyed on the commits they are about. See
            //the block above them.
            unlanded: unlanded,
            wouldConflict: wouldConflict,

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
