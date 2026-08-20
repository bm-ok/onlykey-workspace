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
//A REPO IS A NAME, NEVER A PATH. Callers say `local-repo-a`; this resolves it
//against what is actually in the workspace. A path from a caller is a path to
//anywhere on the disk, and this runs a program.
//
//AND IT READS. Writing is a separate door and it is not built — see `run`. A
//plugin that could commit, push or reset by the same call that lists branches is
//one where a mistake in a pane is a mistake in a repository.
//---------------------------------------------------------------------------

//WHAT MAY BE ASKED. Not a safety boundary on its own — the two rules above are
//that — but the thing that keeps this honest about what it is FOR. Anything not
//here is a capability somebody has to decide to add.
var READS = [
    'diff', 'log', 'branch', 'show', 'status',
    'rev-parse', 'merge-base', 'for-each-ref', 'ls-files', 'cat-file'
];

//A COMMAND THAT NEVER RETURNS WOULD TAKE THE PANE WITH IT. `git log` on a
//repository being written to by something else can block on a lock; ten seconds
//is far past anything this asks for and far short of somebody giving up.
var PATIENCE = 10000;

//ENOUGH FOR A DIFF SOMEBODY READS, and a lid so a generated file cannot hand
//back sixty megabytes to be turned into a string. What is dropped is said.
var MOST = 4 * 1024 * 1024;

plugin.consumes = ['app', 'log', 'okc'];
plugin.provides = ['git'];
async function plugin(imports, register) {
    var log = imports.log.on('git');
    var okc = imports.okc;

    //WHERE THE WORKSPACE IS, BORROWED FOR NOW. `core/workspaces` has not moved
    //across, so the folder comes from the dashboard's `status` — which is the
    //one it is actually open on, rather than a second idea of it kept here. When
    //that plugin moves, this asks it instead and nothing else changes.
    async function workspace() {
        var said = await okc.call('status', {});
        var dir = said && said.workspace && said.workspace.dir;
        if (!dir) throw new Error('no workspace is open, so there are no repositories to read');
        return dir;
    }

    //A FOLDER WITH A .git IN IT, one level down. That is what a repository is
    //here, and asking the disk means the answer cannot drift from what is really
    //there — which is the failure mode of keeping a list.
    async function repos() {
        var dir = await workspace();
        var out = [];
        var names;
        try { names = fs.readdirSync(dir, { withFileTypes: true }); }
        catch (e) { throw new Error('the workspace folder cannot be read: ' + e.message); }

        names.forEach(function (entry) {
            if (!entry.isDirectory() || entry.name[0] === '.') return;
            var full = path.join(dir, entry.name);
            if (fs.existsSync(path.join(full, '.git'))) out.push({ name: entry.name, dir: full });
        });
        return out;
    }

    //A NAME IN, A FOLDER OUT, and a refusal for anything that is not one of
    //them. This is the only place a path is produced, so it is the only place
    //that has to be right about it.
    async function folderOf(repo) {
        var want = String(repo == null ? '' : repo).trim();
        if (!want) throw new Error('Which repository?');

        var all = await repos();
        var found = all.filter(function (r) { return r.name === want; })[0];
        if (!found) {
            throw new Error('There is no repository called "' + want + '" in this workspace. There is: '
                + (all.map(function (r) { return r.name; }).join(', ') || 'none'));
        }
        return found.dir;
    }

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

        var cwd = await folderOf(repo);
        var said = await spawnGit(cwd, list);
        if (said.code !== 0 && said.stderr) log.warn(repo + ': git ' + list[0] + ' — ' + said.stderr.split('\n')[0]);
        return said;
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

    //THREE DOTS, WHICH IS WHAT A PULL REQUEST SHOWS. `base..head` is "everything
    //in head that is not in base right now" — so it changes when base moves, and
    //a diff that grows because somebody else committed to master is a diff that
    //answers a question nobody asked. `base...head` is what head has done SINCE
    //THEY PARTED, which is the change being proposed and nothing else.
    function range(base, head) { return String(base) + '...' + String(head); }

    async function diff(repo, base, head, file) {
        var args = ['diff', range(base, head)];
        //`--` IS NOT OPTIONAL. It is what tells git the rest is a path and not a
        //revision, so a file called `master` is a file and not a branch.
        if (file) args = args.concat(['--', String(file)]);
        var said = await run(repo, args);
        if (said.code !== 0) throw new Error(said.stderr || 'git could not read that comparison');
        return said.cut ? said.stdout + '\n[…this diff is longer than this app will read]' : said.stdout;
    }

    async function files(repo, base, head) {
        var said = await run(repo, ['diff', '--numstat', range(base, head)]);
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
            range(base, head)
        ]);
        if (said.code !== 0) throw new Error(said.stderr || 'git could not read that range');

        return lines(said.stdout).map(function (l) {
            var bits = l.split(SEP);
            return { sha: bits[0], who: bits[1], at: bits[2], subject: bits[3] };
        });
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
            workspace: workspace,
            repos: repos,
            run: run,
            branches: branches,
            head: head,
            diff: diff,
            files: files,
            commits: commits,
            has: has,
            //HANDED OUT SO NOBODY GUESSES AT IT. A caller that wants to say what
            //this can do should say what this SAYS it can do.
            READS: READS
        }
    });
}
module.exports = plugin;
