var fs = require('fs');
var path = require('path');
var child = require('child_process');

//---------------------------------------------------------------------------
//git, on the repositories in the workspace.
//
//ONE PLACE THAT RUNS git, so nothing else has to. Every pane that wants a diff,
//a branch list or a log asks here — and the day any of that needs to change, it
//changes once. The app being ported from learned this the other way round: the
//rule there is that only `machines/` may drive VBoxManage, written down because
//a second opinion about a machine's state was the bug it kept producing. Two
//things running git is the same bug with a different binary.
//
//IT IS THE LOCAL REPOSITORIES AND NOTHING ELSE. Not GitHub — that is a token and
//an API and lives elsewhere. This is the folders on this disk.
//
//---- what makes this safe, and it is not the allowlist ---------------------
//
//NO SHELL. EVER. `spawn` with an ARRAY, so a branch called `x;rm -rf /` is a
//branch called `x;rm -rf /` — an argument, handed to git, which says there is no
//such ref. Nothing here builds a command out of a string, and nothing here may
//start doing so: the moment a `${}` goes inside a command, every branch name in
//the workspace becomes something a person could type to run anything.
//
//This app has already paid for that lesson twice at the other end — `$(...)` on
//a VirtualBox installer command line is expanded by VirtualBox first, so a
//fingerprint check written that way compared empty to empty and PASSED, and a
//self-matching `pkill -f` killed itself. Both survived review.
//
//A REPO IS A NAME, NEVER A PATH. Callers say `local-repo-a`, and ../workspace is
//the one thing that turns that into somewhere on a disk. A path from a caller is
//a path to anywhere at all, and this runs a program in whatever it is given —
//which is why the resolving lives with the workspace and not here.
//
//AND WRITING IS A SEPARATE DOOR. `run` reads and only reads; a plugin that could
//commit, push or reset by the same call that lists branches is one where a
//mistake in a pane is a mistake in a repository.
//
//THE DOOR IS BUILT NOW, and it is five named functions rather than a second
//allowlist — see the block above `WRITES`. What holds across all of them:
//nothing touches the working tree, nothing creates a commit, and nothing moves a
//ref in a way that loses commits unless a caller asked for that by name. There
//is no merge, no rebase and no reset behind any of them.
//
//FOUR OF THE FIVE ONLY MOVE A REF ON THIS DISK. `push` is the exception and has
//its own block, because it PUBLISHES — and the worst a mistake in it costs is
//not a local branch.
//
//---- the surface, which is a contract --------------------------------------
//
//WHAT `git` PROVIDES IS THE WHOLE OF WHAT ANYTHING ELSE MAY DEPEND ON, and that
//is what makes this replaceable rather than merely tidy. Anything that provides
//these names, with these shapes, IS this plugin as far as the rest of the app is
//concerned — a different implementation, a remote one, a fake in a test — and
//nothing that consumes `git` has to be told.
//
//    repos are named, never pathed         a caller says `local-repo-a`
//    run(repo, args)     -> { code, stdout, stderr, cut }
//    branches(repo)      -> [name]
//    head(repo)          -> name
//    has(repo, ref)      -> boolean
//    files(repo, b, h)   -> [{ file, added, removed, binary }]
//    commits(repo, b, h) -> [{ sha, who, at, subject }]
//    diff(repo, b, h, f) -> text
//    fileAt(repo, ref, f)-> text, or null when the file is not at that ref
//
//`b` AND `h` ARE BASE AND HEAD, in that order, and a replacement has to mean the
//same thing by them: what HEAD carries that BASE does not. Swapping them silently
//is a diff that reads backwards, with every addition shown as a removal.
//---------------------------------------------------------------------------

//WHAT MAY BE ASKED. Not a safety boundary on its own — the two rules above are
//that — but the thing that keeps this honest about what it is FOR. Anything not
//here is a capability somebody has to decide to add.
var READS = [
    'diff', 'log', 'branch', 'show', 'status',
    'rev-parse', 'rev-list', 'merge-base', 'for-each-ref', 'ls-files', 'cat-file', 'cherry',

    //`merge-tree` IS HERE AND IT IS THE ONE ENTRY THAT NEEDS AN ARGUMENT.
    //
    //`git merge-tree --write-tree a b` answers "would these conflict, and in
    //which files" without merging anything — and the flag says `write`, so it
    //belongs on this list only if what it writes is harmless. It is: it writes
    //TREE AND BLOB OBJECTS into the object database and nothing else. It moves
    //no ref, touches no working tree, and changes nothing any command would
    //read back. The objects it leaves are unreferenced and are collected like
    //any other garbage.
    //
    //That is a different kind of thing from `commit`, `push` or `reset`, each of
    //which changes what a repository IS. If that distinction ever stops holding
    //— a future flag that updates a ref, say — this entry comes off the list.
    'merge-tree'
];

//---------------------------------------------------------------------------
//AND `remote` IS DELIBERATELY NOT IN THAT LIST.
//
//../repositories needs to know where a repository came from before it can ask
//GitHub anything, and the obvious move is to add `remote` above. That would be
//wrong, and the way it is wrong is worth writing down: `run` gates on the
//SUBCOMMAND, and `git remote add`, `git remote set-url` and `git remote remove`
//all have the same one. One word in that list would open three writes — and
//`set-url` is the one that quietly points a repository somewhere else, which is
//the whole trust chain this app has with GitHub.
//
//So the capability is "tell me where origin is", not "run git remote". Fixed
//argv, no caller input in it at all, and nothing to widen later by accident.
//---------------------------------------------------------------------------
var ORIGIN = ['remote', 'get-url', 'origin'];

//A COMMAND THAT NEVER RETURNS WOULD TAKE THE PANE WITH IT. `git log` on a
//repository being written to by something else can block on a lock; ten seconds
//is far past anything this asks for and far short of somebody giving up.
var PATIENCE = 10000;

//ENOUGH FOR A DIFF SOMEBODY READS, and a lid so a generated file cannot hand
//back sixty megabytes to be turned into a string. What is dropped is said.
var MOST = 4 * 1024 * 1024;

plugin.consumes = ['app', 'log', 'workspace'];
plugin.provides = ['git'];
async function plugin(imports, register) {
    var log = imports.log.on('git');

    //WHICH FOLDER, ASKED OF ../workspace. This used to read the dashboard's
    //`status` and scan for `.git` itself, which put two jobs in one plugin: this
    //one RUNS git, and what a repository is and where the workspace lives is a
    //fact about the workspace. The next plugin needing the same answer would have
    //grown a second copy of the scan — which is the shape of every "second
    //opinion about state" bug this project has had.
    var workspace = imports.workspace;

    function spawnGit(cwd, args) {
        return new Promise(function (resolve) {
            //NO `shell: true`, AND NO STRING. See the header. If this ever needs
            //to become a string, it does not.
            var p = child.spawn('git', args, { cwd: cwd, windowsHide: true });
            var out = '', err = '', cut = false, done = false;

            var timer = setTimeout(function () {
                if (done) return;
                try { p.kill(); } catch (e) { /* already gone */ }
                resolve({ code: null, stdout: out, stderr: 'git did not answer within ' + (PATIENCE / 1000) + 's', cut: cut });
            }, PATIENCE);

            p.stdout.on('data', function (b) {
                if (out.length > MOST) { cut = true; return; }
                out += b;
            });
            p.stderr.on('data', function (b) { if (err.length < 64000) err += b; });
            p.on('error', function (e) {
                done = true; clearTimeout(timer);
                resolve({ code: null, stdout: '', stderr: 'git could not be started: ' + e.message, cut: false });
            });
            p.on('close', function (code) {
                done = true; clearTimeout(timer);
                resolve({ code: code, stdout: out, stderr: err.trim(), cut: cut });
            });
        });
    }

    //ONE COMMAND, IN ONE REPOSITORY.
    //
    //WRITING IS NOT BUILT AND THIS IS WHERE IT WOULD GO. The refusal below is
    //the door: adding `commit` to READS would open it by accident, which is
    //exactly why the message says what it says rather than "not allowed". When
    //something needs to write, it wants its own function with its own gate — a
    //pane that can commit by the same call it lists branches with is a pane
    //where a mistake is a mistake in a repository.
    async function run(repo, args) {
        var list = [].concat(args || []).map(String);
        if (!list.length) throw new Error('Which git command?');

        if (READS.indexOf(list[0]) < 0) {
            throw new Error('`git ' + list[0] + '` is not something this reads with. It knows: '
                + READS.join(', ') + '. Anything that WRITES to a repository is a door that is not built '
                + 'here yet, and adding it to that list is not how to build it.');
        }

        var cwd = await workspace.folderOf(repo);
        var said = await spawnGit(cwd, list);
        if (said.code !== 0 && said.stderr) log.warn(repo + ': git ' + list[0] + ' — ' + said.stderr.split('\n')[0]);
        return said;
    }

    //---- where a repository came from --------------------------------------
    //
    //THE URL IS PARSED HERE AND NOWHERE ELSE, because there are four spellings
    //of the same thing and every caller that parses it itself gets three of them
    //right. All four are `owner/repo` on github.com:
    //
    //    https://github.com/o/r.git      git@github.com:o/r.git
    //    https://github.com/o/r          ssh://git@github.com/o/r.git
    //
    //ANYTHING THAT IS NOT GITHUB IS SAID RATHER THAN GUESSED AT. `kind` is
    //'github' or the host it actually is, so ../repositories can report "origin
    //is gitlab.com, which this cannot ask about" instead of building a GitHub
    //API path out of it and getting a 404 that means nothing.
    //
    //A URL CAN CARRY A CREDENTIAL — `https://user:token@github.com/o/r` is a
    //perfectly ordinary remote — so `url` is NOT returned. What comes back is
    //the host, the owner and the repository, which is what anybody actually
    //wanted, and the one shape that cannot leak what somebody pasted into a
    //remote three months ago.
    async function origin(repo) {
        var cwd = await workspace.folderOf(repo);
        var said = await spawnGit(cwd, ORIGIN);
        if (said.code !== 0) return null;

        var url = String(said.stdout || '').trim();
        if (!url) return null;

        var host = null, owner = null, name = null;
        var m = url.match(/^[a-z+]+:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.+)$/i)
            || url.match(/^(?:[^@]*@)?([^:/]+):(.+)$/);
        if (m) {
            host = m[1].toLowerCase();
            var rest = m[2].replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '').split('/');
            if (rest.length >= 2) {
                name = rest.pop();
                owner = rest.pop();
            }
        }

        return {
            host: host,
            owner: owner,
            repo: name,
            kind: host === 'github.com' ? 'github' : (host || 'unknown')
        };
    }

    //---- every branch here, and how it stands against origin ---------------
    //
    //ONE PROCESS FOR THE WHOLE REPOSITORY, not one per branch. A pane draws this
    //on a timer and a `git` per branch is how a panel comes to spawn forty
    //processes a minute.
    async function tracked(repo) {
        var rows = {};

        var local = await run(repo, ['for-each-ref',
            '--format=%(refname:short)\t%(objectname:short)\t%(upstream:short)\t%(upstream:track)',
            'refs/heads/']);
        String(local.stdout || '').split('\n').forEach(function (line) {
            if (!line.trim()) return;
            var bits = line.split('\t');
            if (!bits[0]) return;
            rows[bits[0]] = {
                branch: bits[0], local: bits[1] || null,
                upstream: bits[2] || null, track: bits[3] || '', remote: null
            };
        });

        //MATCHED BY NAME. A repository with no origin has none of these, and
        //every branch then reads "only here", which is exactly what it is.
        var remotes = { stdout: '' };
        try {
            //THE FULL REFNAME, NOT THE SHORT ONE. `%(refname:short)` turns
            //`refs/remotes/origin/HEAD` into `origin` — git's shortening rule,
            //not a typo — so stripping an `origin/` prefix left the string
            //"origin" and a phantom branch by that name appeared in the panel,
            //sitting on whatever commit the default was at.
            remotes = await run(repo, ['for-each-ref', '--format=%(refname)\t%(objectname:short)', 'refs/remotes/origin/']);
        } catch (e) { /* no origin, or no fetch has ever happened */ }

        String(remotes.stdout || '').split('\n').forEach(function (line) {
            if (!line.trim()) return;
            var bits = line.split('\t');
            var name = String(bits[0] || '').replace(/^refs\/remotes\/origin\//, '');
            //A SYMBOLIC REF, NOT A BRANCH. Listing it would put a duplicate of
            //the default branch in the panel under a name nobody has.
            if (!name || name === 'HEAD') return;
            if (rows[name]) rows[name].remote = bits[1] || null;
            else rows[name] = { branch: name, local: null, upstream: null, track: '', remote: bits[1] || null };
        });

        var names = Object.keys(rows);
        for (var i = 0; i < names.length; i++) {
            var r = rows[names[i]];
            var ahead = /ahead (\d+)/.exec(r.track);
            var behind = /behind (\d+)/.exec(r.track);
            r.ahead = ahead ? Number(ahead[1]) : null;
            r.behind = behind ? Number(behind[1]) : null;

            //COUNTED FROM THE COMMITS WHEN GIT HAS NOTHING TO SAY.
            //
            //`%(upstream:track)` is empty for a branch with no upstream
            //configured, which is EVERY branch this app makes — so a genuinely
            //diverged branch fell through to "different", the panel painted it
            //amber, and amber means "the button will move it". The button would
            //then refuse, correctly and after the fact, on a promise the colour
            //had already made.
            if (r.local && r.remote && r.local !== r.remote && r.ahead === null && r.behind === null) {
                r.ahead = await countBetween(repo, 'refs/remotes/origin/' + r.branch, r.branch);
                r.behind = await countBetween(repo, r.branch, 'refs/remotes/origin/' + r.branch);
            }

            r.state = !r.remote ? 'only here'
                : !r.local ? 'only on origin'
                    : r.local === r.remote ? 'same'
                        : (r.ahead && r.behind) ? 'diverged'
                            : r.ahead ? 'ahead'
                                : r.behind ? 'behind'
                                    //NEITHER SIDE HAS A COMMIT THE OTHER LACKS AND YET THE SHAS
                                    //DIFFER — a rebase, an amend, a squash. Said as itself rather
                                    //than guessed at.
                                    : 'different';
        }

        return rows;
    }

    //HOW MANY COMMITS `to` HAS THAT `from` HAS NOT.
    async function countBetween(repo, from, to) {
        try {
            var said = await run(repo, ['rev-list', '--count', from + '..' + to]);
            if (said.code !== 0) return null;
            var n = Number(String(said.stdout || '').trim());
            return isNaN(n) ? null : n;
        } catch (e) { return null; }
    }

    //---- what a branch still carries, BY CONTENT rather than by sha ---------
    //
    //THE SINGLE MOST CONFUSING THING ABOUT WORKING THROUGH PULL REQUESTS, and
    //the app being ported from got it wrong everywhere in the same way.
    //
    //GitHub usually SQUASHES a merge: the commits on the branch become one new
    //commit, with a new sha, on the target. The original commits still sit on
    //the branch, untouched. Every `rev-list --count base..branch` then says the
    //branch carries unmerged work — truthfully, by sha — about work that landed
    //a week ago. So a board says "1 commit no default branch has", and deleting
    //the branch demands `force` as though something were about to be lost.
    //
    //`git cherry` is the tool for exactly this. It compares PATCH IDS, so a
    //commit whose changes are already applied — squashed, rebased, cherry-picked,
    //however it got there — is marked `-`, and only genuinely new work is `+`.
    //
    //CACHED ON THE PAIR OF COMMITS, WITH NO CLOCK IN IT. The answer is a pure
    //function of two commits: if neither has moved it cannot have changed, and if
    //either has, the key is different. So a panel that asks every few seconds
    //spawns nothing at all in the steady state, and recomputes the moment
    //something actually moves — which no time-based cache can promise.
    var landed = {};
    var landedCount = 0;

    async function unlanded(repo, base, branch) {
        var a = await run(repo, ['rev-parse', String(base)]);
        var b = await run(repo, ['rev-parse', String(branch)]);
        if (a.code !== 0 || b.code !== 0) return null;

        var at = String(a.stdout || '').trim();
        var to = String(b.stdout || '').trim();
        if (at === to) return 0;

        var key = repo + '|' + at + '|' + to;
        if (key in landed) return landed[key];

        var out = null;
        var said = await run(repo, ['cherry', String(base), String(branch)]);
        if (said.code === 0) {
            //`+` IS A COMMIT WHOSE CHANGE IS NOT IN BASE. `-` is one that is,
            //under a different sha. An empty answer means the branch adds nothing.
            out = String(said.stdout || '').split('\n')
                .filter(function (l) { return l.trim().indexOf('+') === 0; }).length;
        }

        //BOUNDED, because the key includes commits and commits keep being made.
        //Far more than a session needs, and nothing here is expensive to redo.
        if (landedCount > 500) { landed = {}; landedCount = 0; }
        landed[key] = out;
        landedCount++;
        return out;
    }

    //---- would these two conflict, and where -------------------------------
    //
    //ASKED WITHOUT MERGING ANYTHING. See `merge-tree` in READS for why a flag
    //called `--write-tree` is allowed on a plugin that refuses to write.
    //
    //THREE ANSWERS, NOT TWO. `clean: null` is "could not tell" — an unrelated
    //history, a missing object, a ref that will not resolve — and it must not
    //read as clean. A pane that paints "no conflicts" over an unanswerable
    //question is worse than one that says it does not know.
    async function wouldConflict(repo, ours, theirs) {
        var a = await run(repo, ['rev-parse', String(ours)]);
        var b = await run(repo, ['rev-parse', String(theirs)]);
        if (a.code !== 0 || b.code !== 0) {
            return { clean: null, files: [], why: 'one of the two could not be read' };
        }

        var said = await run(repo, ['merge-tree', '--write-tree',
            String(a.stdout || '').trim(), String(b.stdout || '').trim()]);
        if (said.code === 0) return { clean: true, files: [], why: null };

        //A NON-ZERO EXIT HERE IS THE ANSWER rather than a failure, and the paths
        //are in what it printed.
        var text = String(said.stdout || '') + '\n' + String(said.stderr || '');
        var seen = {};
        text.split('\n').forEach(function (l) {
            var m = /^\d{6} [0-9a-f]+ [123]\t(.+)$/.exec(l.trim());
            if (m) seen[m[1]] = 1;
        });
        var files = Object.keys(seen);
        if (files.length) return { clean: false, files: files, why: null };

        //NON-ZERO WITH NOTHING THAT LOOKS LIKE A CONFLICT LISTING is a real
        //failure, and is reported as not knowing rather than as "clean".
        var last = text.split('\n').filter(function (l) { return l.trim(); }).pop();
        return { clean: null, files: [], why: last || 'git would not say' };
    }

    //=======================================================================
    //THE WRITE DOOR.
    //
    //NOT AN ALLOWLIST, AND THAT IS THE WHOLE DESIGN. `run` gates on a
    //subcommand, and a subcommand is not a capability: adding `branch` to READS
    //would open `branch -D` along with `branch --list`, and `remote` would open
    //`set-url`. So every write is ITS OWN FUNCTION WITH ITS OWN GATE, fixed
    //argv, and nothing here takes a command from a caller.
    //
    //THREE THINGS ARE TRUE OF EVERY ONE OF THEM, and together they are what
    //makes this safe rather than merely careful:
    //
    //  1. NOTHING TOUCHES THE WORKING TREE. No checkout, no reset, no merge, no
    //     stash, no clean. Every write below moves a REF and nothing else — so
    //     no act of this app can destroy uncommitted work, on any branch, ever.
    //     That is a property of the argv, not a promise in a comment.
    //
    //  2. NOTHING CREATES OR REWRITES A COMMIT. History is made by people and
    //     by workers on machines; this app moves labels around.
    //
    //  3. NOTHING MOVES A REF THAT WOULD LOSE COMMITS, unless the caller asked
    //     for that in so many words. `fastForward` refuses anything that is not
    //     one, and `removeBranch` will not use `-D` unless `force` is passed.
    //
    //WHAT IS NOT HERE IS AS MUCH THE POINT. There is no push, no commit, no
    //merge, no rebase, no `reset`. `pr` will need a push and it will get its own
    //function and its own argument, added deliberately.
    //
    //AND THE POLICY GATE IS NOT HERE EITHER. Whether a branch may be written to
    //— a line is protected, a default is protected — is a question about what
    //this app is FOR, and it belongs with the thing that knows what a line is.
    //This plugin knows what git will accept. See ../repositories/branches.
    //=======================================================================

    //EVERY WAY THIS PLUGIN CAN CHANGE A REPOSITORY, IN ONE LIST, so a test can
    //assert the list matches what is callable and a new one has to be argued for
    //in a diff. Same shape as EXITS in ../keys/server.js, for the same reason.
    var WRITES = ['fetch', 'fastForward', 'makeBranch', 'removeBranch', 'push'];

    //A NAME GIT WILL ACCEPT, CHECKED BEFORE ANYTHING IS CREATED. Asked of git
    //itself rather than guessed at with a regex — the rules are genuinely
    //intricate (no `..`, no trailing `.lock`, no `@{`, no control characters,
    //no component starting with a dot) and a home-made check is one that is
    //subtly wrong in a way nobody notices until a name is refused deep inside
    //something else.
    async function nameIsOk(repo, name) {
        var said = await spawnGit(await workspace.folderOf(repo),
            ['check-ref-format', '--branch', String(name)]);
        return said.code === 0;
    }

    //---- fetch --------------------------------------------------------------
    //
    //THE ONLY ONE THAT TALKS TO A NETWORK, and it writes nothing but
    //`refs/remotes/origin/*`. No local branch moves, so a fetch can never be the
    //thing that loses work — it only changes what this app KNOWS.
    //
    //`--prune` MATTERS AND IS ON. Without it a branch deleted on the far end
    //stays in `refs/remotes/origin/` for ever, and every pane that compares
    //against origin goes on reporting a branch that is gone as one that is
    //behind.
    async function fetch(repo) {
        var cwd = await workspace.folderOf(repo);
        var said = await spawnGit(cwd, ['fetch', '--quiet', '--prune', 'origin']);
        if (said.code !== 0) {
            var why = String(said.stderr || '').split('\n').filter(Boolean)[0] || 'git would not say why';
            //NO ORIGIN IS NOT A FAILURE, it is an answer. A repository nobody has
            //given a remote is an ordinary thing to have in a workspace.
            return { fetched: false, why: why };
        }
        log.info(repo + ': fetched from origin');
        return { fetched: true, why: null };
    }

    //---- fast-forward -------------------------------------------------------
    //
    //ONLY EVER A FAST-FORWARD, checked twice and by two different means.
    //
    //FIRST, IS IT ONE. `merge-base --is-ancestor here there` asks git whether the
    //current tip is contained in the target. If it is not, the branch has
    //commits the target has not got and moving it would drop them — refused,
    //named, and the caller is told to look at Conflicts.
    //
    //SECOND, THE COMPARE-AND-SWAP. `update-ref <ref> <new> <old>` refuses unless
    //the ref is still at `<old>`. So a branch that moved between the check and
    //the write — a worker pushing, somebody committing — loses the race safely
    //rather than being overwritten. Without the third argument this would be a
    //`git push --force` with extra steps.
    async function fastForward(repo, branch, toRef) {
        var here = await run(repo, ['rev-parse', String(branch)]);
        var there = await run(repo, ['rev-parse', String(toRef)]);
        if (here.code !== 0) return { moved: false, why: 'there is no branch called "' + branch + '" here' };
        if (there.code !== 0) return { moved: false, why: 'there is nothing at "' + toRef + '" to move to' };

        var was = String(here.stdout || '').trim();
        var want = String(there.stdout || '').trim();
        if (was === want) return { moved: false, was: was, why: null, already: true };

        var contained = await run(repo, ['merge-base', '--is-ancestor', was, want]);
        if (contained.code !== 0) {
            return {
                moved: false, was: was,
                why: 'it has moved here as well, so this is not a fast-forward — nothing was touched. See Conflicts.'
            };
        }

        var said = await spawnGit(await workspace.folderOf(repo),
            ['update-ref', 'refs/heads/' + String(branch), want, was]);
        if (said.code !== 0) {
            return { moved: false, was: was, why: String(said.stderr || '').split('\n')[0] || 'the ref moved underneath this' };
        }

        log.good(repo + ': ' + branch + ' fast-forwarded to ' + want.slice(0, 7));
        return { moved: true, was: was, now: want, why: null };
    }

    //---- making a branch ----------------------------------------------------
    //
    //`git branch <name> <start>` AND NOT `checkout -b`. The second would move the
    //working tree, which rule 1 above forbids — and this app makes branches in
    //repositories somebody may be working in.
    async function makeBranch(repo, name, from) {
        if (!(await nameIsOk(repo, name))) {
            return { made: false, why: '"' + name + '" is not a name git will accept for a branch' };
        }
        if (await has(repo, String(name))) {
            //ALREADY THERE IS NOT AN ERROR when this is called across several
            //repositories: two of three having it is the ordinary way a cut gets
            //finished after being interrupted.
            return { made: false, already: true, why: null };
        }

        var start = await run(repo, ['rev-parse', String(from)]);
        if (start.code !== 0) return { made: false, why: 'there is nothing at "' + from + '" to cut from' };

        var said = await spawnGit(await workspace.folderOf(repo),
            ['branch', String(name), String(from)]);
        if (said.code !== 0) {
            return { made: false, why: String(said.stderr || '').split('\n')[0] || 'git would not say why' };
        }

        log.good(repo + ': cut ' + name + ' from ' + from);
        return { made: true, at: String(start.stdout || '').trim(), why: null };
    }

    //---- removing one -------------------------------------------------------
    //
    //`-d` REFUSES A BRANCH THAT IS NOT MERGED, and that refusal is the feature.
    //`-D` is only reached when a caller passes `force`, which is a word somebody
    //had to type — and the pane that offers it says what is being given up.
    //
    //THE WORKING TREE AGAIN: git refuses to delete the branch that is checked
    //out, and that refusal is left to speak for itself rather than being
    //pre-empted here, because git's message names the branch and the repository.
    async function removeBranch(repo, name, opts) {
        var force = !!(opts && opts.force);
        if (!(await has(repo, String(name)))) return { removed: false, already: true, why: null };

        var said = await spawnGit(await workspace.folderOf(repo),
            ['branch', force ? '-D' : '-d', String(name)]);
        if (said.code !== 0) {
            var why = String(said.stderr || '').split('\n').filter(Boolean)[0] || 'git would not say why';
            return { removed: false, why: why, unmerged: /not fully merged/i.test(why) };
        }

        log.warn(repo + ': deleted ' + name + (force ? ', forced' : ''));
        return { removed: true, why: null };
    }

    //=======================================================================
    //PUSH: THE ONE WRITE WITH EFFECTS OUTSIDE THIS HOST.
    //
    //The other four move a ref on this disk, and the worst a mistake in them
    //costs is a local branch. This one PUBLISHES — it puts commits somewhere
    //other people read, and there is no undo button here for that.
    //
    //SO IT IS NARROWER THAN THE OTHERS, and the narrowing is in the argv:
    //
    //  ONE BRANCH, TO THE SAME NAME. The refspec is written out in full —
    //  `refs/heads/X:refs/heads/X` — so there is no branch this can reach that
    //  the caller did not name, and no chance of git's own guessing rules
    //  choosing a destination. `push origin X` is not the same command.
    //
    //  NEVER FORCED. No `--force`, no `--force-with-lease`, no `+` on the
    //  refspec. The far end refuses a non-fast-forward and THAT REFUSAL IS THE
    //  FEATURE: it means this can only ever ADD commits to a branch, never
    //  remove one that somebody else pushed.
    //
    //  NOTHING ELSE. No `--delete`, no `--tags`, no `--mirror`, no `--all`.
    //  Each of those is a way to remove something at the far end, which is the
    //  category this refuses to be in.
    //
    //  ONLY `origin`. Not a URL, not a caller-named remote — a URL from a caller
    //  is somewhere else entirely, and a remote name is one `set-url` away from
    //  being one.
    //
    //---- and the token is not an argument ---------------------------------
    //
    //IT ARRIVES IN THE CHILD'S ENVIRONMENT AND IS READ BY A HELPER. `env` and
    //`helper` come from the caller, which got them from ../keys — this plugin
    //never asks for a credential, never holds one, and could not tell you what
    //is in the object it is handed. See `envForPush` and `credentialHelper`
    //there for why the other two ways are worse.
    //
    //`credential.helper=` IS CLEARED FIRST, and that empty value matters: it
    //resets the list, so a credential manager configured on this machine cannot
    //answer instead with somebody else's account. Appending without clearing
    //would leave the machine's helper first in line.
    //
    //`GIT_TERMINAL_PROMPT=0` so a wrong credential fails instead of stopping to
    //ask a person who is not there — which, unattended, is a call that hangs
    //until it times out.
    //=======================================================================
    async function push(repo, branch, opts) {
        var o = opts || {};
        var name = String(branch || '').trim();
        if (!name) return { pushed: false, why: 'there is no branch to push' };
        if (!(await has(repo, name))) return { pushed: false, why: 'there is no branch called "' + name + '" here' };

        var helper = o.helper ? String(o.helper).split('\\').join('/') : null;
        var args = ['-C', await workspace.folderOf(repo)];
        if (helper) {
            args.push('-c', 'credential.helper=');
            args.push('-c', 'credential.helper=!node "' + helper + '"');
        }
        args.push('push', 'origin', 'refs/heads/' + name + ':refs/heads/' + name);

        var said = await spawnAt(args, Object.assign({}, o.env || {}, {
            OKC_GIT_USER: 'x-access-token',
            GIT_TERMINAL_PROMPT: '0'
        }));

        if (said.code !== 0) {
            var text = String(said.stderr || '') + '\n' + String(said.stdout || '');
            var first = text.split('\n').filter(Boolean)[0] || 'git would not say why';
            return {
                pushed: false,
                //A REJECTION IS AN ANSWER, NOT A FAILURE. It means the far end
                //has commits this does not, and the fix is to fetch rather than
                //to try harder.
                rejected: /non-fast-forward|rejected|fetch first/i.test(text),
                why: first
            };
        }

        log.good(repo + ': pushed ' + name + ' onward');
        return { pushed: true, why: null };
    }

    //THE ONLY SPAWN THAT TAKES AN ENVIRONMENT, and it exists for `push` alone.
    //Kept separate from `spawnGit` so that adding an env to anything else is a
    //deliberate act rather than a parameter that was already there.
    function spawnAt(args, env) {
        return new Promise(function (resolve) {
            var p = child.spawn('git', args, {
                windowsHide: true,
                //A PUSH IS A NETWORK ROUND TRIP and can honestly take a while;
                //ten seconds is right for a local read and wrong here.
                env: Object.assign({}, process.env, env || {})
            });
            var out = '', err = '', done = false;
            var timer = setTimeout(function () {
                if (done) return;
                try { p.kill(); } catch (e) { /* already gone */ }
                resolve({ code: null, stdout: out, stderr: 'git did not answer within 120s' });
            }, 120000);
            p.stdout.on('data', function (b) { if (out.length < 64000) out += b; });
            p.stderr.on('data', function (b) { if (err.length < 64000) err += b; });
            p.on('error', function (e) {
                done = true; clearTimeout(timer);
                resolve({ code: null, stdout: '', stderr: 'git could not be started: ' + e.message });
            });
            p.on('close', function (code) {
                done = true; clearTimeout(timer);
                resolve({ code: code, stdout: out, stderr: err.trim() });
            });
        });
    }

    function lines(text) {
        return String(text || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    }

    //---- what the panes actually ask for ----------------------------------

    async function branches(repo) {
        //THE REFS THEMSELVES, not `git branch`'s decorated output. That prints a
        //`*` beside the current one and indents the rest, so anything reading it
        //is parsing a display format that exists for people.
        var said = await run(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
        return lines(said.stdout);
    }

    async function head(repo) {
        var said = await run(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
        return lines(said.stdout)[0] || null;
    }

    //TWO RANGES, AND THEY ARE NOT INTERCHANGEABLE. This is the trap; both spell
    //a comparison and git means something different by each, depending on the
    //command.
    //
    //FOR A DIFF, THREE DOTS. `git diff base..head` is "everything in head that
    //base does not have RIGHT NOW", so it grows when somebody else commits to
    //base — a diff that answers a question nobody asked. `git diff base...head`
    //is from where they parted to head: the change being proposed and nothing
    //else. That is what a pull request shows.
    //
    //FOR A LOG, TWO DOTS. `git log base...head` is SYMMETRIC — commits on either
    //side that the other does not have — so it hands back base's commits as well.
    //Measured on a real branch: three dots gave twenty commits for a one-line
    //change, two dots gave one. The first version of this used three for both and
    //the numbers said so: a repository reported twenty commits and one changed
    //file, and another reported three commits with nothing changed at all.
    function diffRange(base, head) { return String(base) + '...' + String(head); }
    function logRange(base, head) { return String(base) + '..' + String(head); }

    async function diff(repo, base, head, file) {
        var args = ['diff', diffRange(base, head)];
        //`--` IS NOT OPTIONAL. It is what tells git the rest is a path and not a
        //revision, so a file called `master` is a file and not a branch.
        if (file) args = args.concat(['--', String(file)]);
        var said = await run(repo, args);
        if (said.code !== 0) throw new Error(said.stderr || 'git could not read that comparison');
        return said.cut ? said.stdout + '\n[…this diff is longer than this app will read]' : said.stdout;
    }

    async function files(repo, base, head) {
        var said = await run(repo, ['diff', '--numstat', diffRange(base, head)]);
        if (said.code !== 0) throw new Error(said.stderr || 'git could not read that comparison');

        return lines(said.stdout).map(function (l) {
            var bits = l.split('\t');
            //A BINARY FILE ANSWERS "-" FOR BOTH COUNTS, which is a fact about the
            //file rather than a number missing. Kept as null and marked, because
            //"0 lines changed" and "not a thing with lines" are different news.
            var added = bits[0] === '-' ? null : Number(bits[0]);
            var removed = bits[1] === '-' ? null : Number(bits[1]);
            return { file: bits[2], added: added, removed: removed, binary: added === null && removed === null };
        }).filter(function (f) { return f.file; });
    }

    async function commits(repo, base, head) {
        //A SEPARATOR NOTHING IN A COMMIT MESSAGE CONTAINS. Tabs and pipes turn up
        //in subjects; a unit separator does not.
        var SEP = String.fromCharCode(31);
        var said = await run(repo, [
            'log', '--no-merges', '--date=iso-strict',
            '--pretty=format:%h' + SEP + '%an' + SEP + '%ad' + SEP + '%s',
            logRange(base, head)
        ]);
        if (said.code !== 0) throw new Error(said.stderr || 'git could not read that range');

        return lines(said.stdout).map(function (l) {
            var bits = l.split(SEP);
            return { sha: bits[0], who: bits[1], at: bits[2], subject: bits[3] };
        });
    }

    //ONE FILE AS IT IS AT ONE REF, which is what side by side is made of. A
    //diff says what changed; two whole files say what the thing IS on each side,
    //and those are different readings — a reviewer follows the second when the
    //change is small and the surrounding code is the question.
    //
    //MISSING IS AN ANSWER, NOT A FAILURE. A file added on the head does not exist
    //on the base and a deleted one is the other way round; both are ordinary, and
    //both make `git show` exit non-zero. `null` says "not there", which the caller
    //can draw as an empty side rather than as an error.
    //
    //`ref:path` IS ONE ARGUMENT and git parses it — the colon is git's, not a
    //shell's. Still one array element, so a path with a space is a path with a
    //space.
    async function fileAt(repo, ref, file) {
        if (!file) throw new Error('Which file?');
        var said = await run(repo, ['show', String(ref) + ':' + String(file)]);
        if (said.code !== 0) return null;
        return said.cut ? said.stdout + '\n[…this file is longer than this app will read]' : said.stdout;
    }

    //WHETHER A REPOSITORY HAS BOTH SIDES, which is the question that decides
    //whether a comparison means anything there. Answered per repository because
    //a line across three repositories is often only in two of them, and that is
    //an answer rather than an error.
    async function has(repo, ref) {
        var said = await run(repo, ['rev-parse', '--verify', '--quiet', String(ref)]);
        return said.code === 0;
    }

    //---- and the same thing, by name ---------------------------------------
    //
    //A SERVICE FOR THE PANES AND ACTIONS FOR EVERYTHING ELSE. The rule this port
    //runs on is that an action goes where its pane is; these have no pane, so
    //they sit with the service they read — the same place `events` ended up, for
    //the same reason. What they add is that a person, a drill or a model can ask
    //the same questions the panes ask, which is the property every action here is
    //supposed to have.
    //
    //NOT `gitBranches`. That name is the dashboard's and answers something richer
    //— which branches are protected, which a machine is holding, which may be
    //worked on. Shadowing it with a plain list of refs would LOSE those answers
    //while looking like it had gained something.
    var actions = imports.app.host && imports.app.host.actions;
    var undo = [];

    if (actions) {
        //NO "LIST THE REPOSITORIES" ACTION, DELIBERATELY. `gitRepos` already
        //exists and answers a different question — what a machine may clone, and
        //from where — so a second one would be a near-duplicate distinguished
        //only by a worse name. Asking any of these with a repository that is not
        //there already answers it: the refusal names every one that is.
        undo.push(actions.define('gitFiles', {
            about: 'What changed between two branches in one repository, as a list of files',
            takes: ['repo', 'base', 'head'],
            run: async function (a) {
                var got = await files(a.repo, a.base, a.head);
                return { repo: a.repo, base: a.base, head: a.head, files: got, count: got.length };
            }
        }));

        undo.push(actions.define('gitDiff', {
            about: 'The diff between two branches in one repository, in full. --file for one file',
            takes: ['repo', 'base', 'head', 'file'],
            run: async function (a) {
                return { repo: a.repo, base: a.base, head: a.head, file: a.file || null,
                    diff: await diff(a.repo, a.base, a.head, a.file) };
            }
        }));

        undo.push(actions.define('gitLog', {
            about: 'The commits one branch carries that another does not, in one repository',
            takes: ['repo', 'base', 'head'],
            run: async function (a) {
                var got = await commits(a.repo, a.base, a.head);
                return { repo: a.repo, base: a.base, head: a.head, commits: got, count: got.length };
            }
        }));
    }

    await register(null, {
        onDestroy: function () { while (undo.length) undo.pop()(); },
        git: {
            //NOT `workspace` AND NOT `repos`. Those were here while this plugin
            //did both jobs, and re-exporting them would leave two doors to one
            //answer — the thing that makes a second copy easy to write later.
            //Consume ../workspace for those.
            run: run,
            branches: branches,
            head: head,
            diff: diff,
            files: files,
            commits: commits,
            fileAt: fileAt,
            has: has,
            origin: origin,
            tracked: tracked,
            unlanded: unlanded,
            countBetween: countBetween,
            wouldConflict: wouldConflict,

            //---- the write door. See the block above it. ----------------
            WRITES: WRITES,
            fetch: fetch,
            fastForward: fastForward,
            makeBranch: makeBranch,
            removeBranch: removeBranch,
            push: push,
            //HANDED OUT SO NOBODY GUESSES AT IT. A caller that wants to say what
            //this can do should say what this SAYS it can do.
            READS: READS
        }
    });
}
module.exports = plugin;
