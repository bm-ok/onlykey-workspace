var fs = require('fs');
var path = require('path');

var header = require('./header');
var q = header.q;

//---------------------------------------------------------------------------
//WHICH FILE A MACHINE GETS FOR A STAGE.
//
//THE SCRIPTS ARE FILES RATHER THAN STRINGS IN HERE ON PURPOSE: they are meant
//to be swapped. A machine's spec can name a different file for any stage, so
//making a different KIND of machine is editing or replacing a script rather
//than changing this app.
//
//READ FRESH ON EVERY REQUEST, NEVER CACHED, so editing one takes effect on the
//next boot with nothing to restart. That is the one place in this app where not
//caching is the point rather than an omission.
//---------------------------------------------------------------------------

//THE STAGES, and which file each uses unless a machine says otherwise. Adding
//one here is the only place a new stage needs registering.
//
//ROOT AND USER ARE SEPARATE STAGES, not one script switching user mid-flight.
//Which of the two something needs is not a detail: packages and /etc are root's,
//a shell file or a per-user install is the user's, and mixing them is how a home
//directory ends up owned by root.
var STAGES = {
    firstBoot: 'first-boot.sh',
    toolchain: 'toolchain.sh',
    toolchainUser: 'toolchain-user.sh',
    normalBoot: 'normal-boot.sh',

    //A SCREEN, ONLY IF THE MACHINE WAS BUILT TO HAVE ONE. Every machine is
    //installed from the same server image, which has no desktop at all — so a
    //desktop is ADDED by this rather than something a machine is born with and a
    //runner has to have stripped out.
    desktop: 'desktop.sh',
    //The picture on it, which is the one part that is taste rather than plumbing.
    wallpaper: 'wallpaper.sh',

    //THE PROJECT'S ADDITIONS, run after the app's. A machine works perfectly
    //well without either.
    //
    //NOT RUN ON A SUPERVISOR. A supervisor takes no tasks, so the project's half
    //— its repositories, its build inputs, its devices — is setup for work that
    //will never happen there.
    extra: 'extra.sh',
    extraUser: 'extra-user.sh',

    //WHAT A SUPERVISOR GETS INSTEAD, and it is the app's own rather than a
    //project's: Claude Code, and nothing else. A supervisor is a machine this
    //app knows the purpose of, so what it needs is not a project's business.
    //
    //The root half builds the SIGN-IN DESK — a second user whose only job is to
    //hold a sign-in conversation, so asking for a login URL never touches the
    //credential the supervisor is working with.
    supervisor: 'supervisor.sh',
    supervisorUser: 'supervisor-user.sh',

    //NOT SHELL, and served without a header for that reason — its values arrive
    //through the service unit first-boot.sh writes for it.
    agent: 'agent.py',

    //---- what a supervisor's model is given -------------------------------
    //
    //THE TOOL SERVER IS THE WHOLE SURFACE. It speaks MCP on stdin and stdout and
    //offers one tool per verb of the supervisor API — no shell, no file, no
    //fetch. A server rather than a permission, deliberately.
    mcp: 'okc-mcp.js',
    //And how to use it: the loop, what a task has to say, what it may never do.
    skill: 'supervisor-skill.md',
    //And the one a WORKER gets. Different audience entirely: the supervisor's is
    //about deciding what work there is, this one is about doing a piece of it on
    //a machine that will be rolled back underneath you.
    workerSkill: 'worker-skill.md',
    //AND A JUDGE'S, WHICH IS NOT THE WORKER'S WITH A NOTE ON IT. The two
    //deliverables are exactly inverted: a worker's is the branch and an artifact
    //is the footnote; a judge's IS the artifact, and the branch is somebody
    //else's work it must not touch. One file was going to both, and it was the
    //worker's — so a judge was being told, in the one document that says what it
    //is, to commit and push. The host refused it, which made the fault cost
    //turns instead of damage, and taught it nothing about what to do instead.
    judgeSkill: 'judge-skill.md',
    //AND THE GATE IN FRONT OF EVERY TOOL CALL. Deny by default: only the
    //dashboard's own tools are let through, so anything a future Claude Code
    //adds is refused the day it ships rather than the day somebody notices.
    toolGate: 'okc-only-hook.js'
};

//FOUR KINDS: shell and python are run, a node program is run, and a markdown
//file is read by a model. The guard is about what may be SERVED from these
//folders, so it grows with them rather than meaning "scripts only".
var SERVABLE = /\.(sh|py|js|md)$/;

//---- THE THREE THE APP DOES NOT SHIP -------------------------------------
//
//Every other stage above has a file beside this one that the app carries. These
//three do not: a skill is a workspace's, kept in its provision folder and
//carried in the bundle a new workspace is set up from.
//
//THE REPO HELD EACH OF THEM TWICE and that is why they went. A copy beside this
//file and a copy in the tar are two documents with one name, and two copies
//drift the moment one is edited — the app's supervisor skill was ten thousand
//characters behind the one actually in use, so anybody reading the repo to learn
//how a supervisor works was reading the stale one.
//
//THE REPO STILL HAS THEM. They are in `okc-bootstrap.tar`, which is checked in
//and is what a fresh workspace is built from — one copy, and the one that is
//true. See ../../bootstrap/bundle.js, which makes the same argument about the
//library.
var SKILL_FILES = { 'supervisor-skill.md': true, 'worker-skill.md': true, 'judge-skill.md': true };

//---- A SKILL HAS ONE NAME AGAIN, AND BRIEFLY HAD THREE --------------------
//
//`supervisor-skill.md` is the file, in a provision folder, served to a machine
//that fetches it at the head of every turn. A bundle used to carry the same
//document as `skills/supervisor.md`, so unpacking one into a workspace put its
//skills under a name nothing here looked for — carried, and never read.
//
//THE FIX WAS A TABLE MAPPING ONE SPELLING TO THE OTHER, and it worked, and it
//left a skill with three possible names: the bundle's, the workspace's and the
//app's. ../../bootstrap/bundle.js carries them under their real names now, so
//the table is gone and there is one spelling everywhere. An old bundle is still
//importable — the translation lives in the READER over there, which is the one
//place that has to know what a bundle used to look like.

module.exports = function scripts(deps) {
    var d = deps || {};

    //WHAT THE APP SHIPS, and WHAT THE PROJECT BRINGS.
    //
    //Two ways to use the second, different on purpose. `extra.sh` runs AFTER the
    //app's toolchain and ADDS to it — the usual one, where the app guarantees a
    //baseline and the project adds only what it needs. Any other name REPLACES
    //the app's file of that name outright, for when the baseline itself is wrong
    //for a project.
    //
    //THE PROJECT'S IS FIRST, so a replacement wins.
    var appDir = d.appDir;

    //WHERE THE PROJECT'S HALF IS, ASKED EACH TIME RATHER THAN FIXED AT STARTUP.
    //
    //It may be a plain path or a function that returns one. A function because
    //the folder is the OPEN WORKSPACE's, which is not known when this module is
    //built and changes when somebody opens a different one — a value read once
    //would be a stale answer for every workspace after the first.
    //
    //`null` IS AN ORDINARY ANSWER: no workspace open yet, or a project that
    //brings no scripts of its own. `searchPath` drops it.
    var askedFor = d.workspaceDir || null;
    function workspaceDirNow() {
        var at = typeof askedFor === 'function' ? askedFor() : askedFor;
        return at || null;
    }

    //---- AND WHAT A PERSON WROTE AT THE WINDOW, WHICH BEATS BOTH ------------
    //
    //THE RULE THE REST OF THIS APP ALREADY FOLLOWS. A contract, a prompt, a
    //job's script -- everything somebody authors -- is kept in the app's own
    //drawer, and what is checked in is a shipped DEFAULT. Skills were the one
    //exception: `skillSave` wrote back over whichever file it had read, which in
    //a checkout is the app's own copy under a build output, so an edit made at
    //the window was reverted by the next rebuild with nothing said.
    //
    //FIRST, FOR THE SAME REASON THE PROJECT'S HALF BEATS THE APP'S: the more
    //specific answer wins, and "what the person running this wrote" is the most
    //specific there is.
    //
    //A FUNCTION FOR THE SAME REASON TOO -- ../core/state settles where its
    //drawer is at run time, and a value read once here would be read before it
    //had settled.
    var mineAsked = d.keptDir || null;
    function keptDirNow() {
        var at = typeof mineAsked === 'function' ? mineAsked() : mineAsked;
        return at || null;
    }

    var there = d.there || function (p) {
        try { return fs.existsSync(p); } catch (e) { return false; }
    };
    var readFile = d.readFile || function (p) { return fs.readFileSync(p, 'utf8'); };
    var readDir = d.readDir || function (p) { return fs.readdirSync(p); };

    function searchPath() {
        return [keptDirNow(), workspaceDirNow(), appDir].filter(function (dir) { return dir && there(dir); });
    }

    //ONLY EVER A PLAIN FILENAME, AND ONLY INSIDE ONE OF THOSE DIRECTORIES.
    //
    //A spec is configuration, but it is still not allowed to name a PATH:
    //"../../something" would otherwise serve any file on this host to a guest.
    //The basename is the whole guard, and it is taken before anything is joined
    //— a check done after joining is a check that has already lost.
    function resolve(wanted) {
        var name = path.basename(String(wanted == null ? '' : wanted));

        if (!SERVABLE.test(name)) {
            throw new Error('"' + wanted + '" is not a provisioning file.');
        }

        var dirs = searchPath();
        for (var i = 0; i < dirs.length; i++) {
            var file = path.join(dirs[i], name);

            //THE SECOND CHECK CANNOT FAIL WHILE THE FIRST IS THERE, and that is
            //worth saying rather than leaving it to look load-bearing.
            //
            //`path.basename` has already reduced this to one segment, so joining
            //it to a directory can only land inside that directory — it was
            //tried as a sabotage and nothing changed, because there is nothing
            //there to break. It stays because it is the check somebody would
            //look for, and because it is what would catch the basename above
            //being weakened by an edit that looked harmless.
            if (file.indexOf(dirs[i]) === 0 && there(file)) return file;
        }

        //---- AND A SKILL HAS NO SHIPPED COPY TO FALL BACK ON ---------------
        //
        //THE APP USED TO CARRY ONE OF EACH and no longer does: the three skills
        //are a workspace's, kept in its own folder and carried in the bundle a
        //new workspace is set up from. Keeping a second copy beside this file
        //meant the repo held each of them twice, and two copies of a document
        //drift the moment one is edited — which is exactly what happened, with
        //the app's supervisor skill ten thousand characters behind the one being
        //used.
        //
        //SO THE REFUSAL HAS TO SAY WHERE ONE COMES FROM. "There is no
        //provisioning script called supervisor-skill.md" is true and unactionable
        //for the one file a supervisor fetches at the head of every turn.
        if (SKILL_FILES[name]) {
            throw new Error('This workspace has no "' + name + '", and the app does not carry one to fall back '
                + 'on — the three skills belong to a workspace and are set up from the bundle. Import one with '
                + 'bootstrapImport, or copy the file into this workspace\'s provision folder.');
        }

        throw new Error('There is no provisioning script called "' + name + '".');
    }

    //WHICH FILE A MACHINE GETS FOR A STAGE: its own choice, or the default.
    function fileFor(vm, stage) {
        var chosen = (((vm && vm.spec) || {}).scripts || {})[stage];
        return resolve(chosen || STAGES[stage] || stage);
    }

    //DOES A STAGE EXIST AT ALL? `extra.sh` usually only exists for a project,
    //and its absence is NORMAL rather than a problem — which is why this is a
    //question anything can ask instead of an error anything has to catch.
    function has(vm, stage) {
        try { fileFor(vm, stage); return true; } catch (e) { return false; }
    }

    //EVERY SCRIPT AVAILABLE, and which copy of it would actually be used.
    function list() {
        var seen = {};
        var out = [];

        searchPath().forEach(function (dir) {
            readDir(dir).filter(function (f) { return SERVABLE.test(f); }).sort().forEach(function (f) {
                //FIRST DIRECTORY WINS, and the workspace is first.
                if (Object.prototype.hasOwnProperty.call(seen, f)) return;
                seen[f] = true;
                out.push({ file: f, from: sourceOf(path.join(dir, f)) });
            });
        });

        return out;
    }

    //---- WHAT THIS WORKSPACE'S OWN FOLDER HOLDS ---------------------------
    //
    //ONLY THE KEPT ONE, AND DELIBERATELY NOT THE SEARCH PATH. `list` above
    //answers "what would be served", which folds in the app's shipped copies —
    //right for a pane, wrong for a bundle. A bundle carrying the app's own
    //`first-boot.sh` would PIN it: every workspace made from that bundle would
    //start with a copy that stops tracking the app the day either changes, and
    //nothing would say so.
    //
    //So this is the workspace's half and nothing else: the scripts somebody put
    //there, and the skills they approved. What the app ships travels with the
    //app.
    function kept() {
        var at = keptDirNow();
        if (!at) return [];

        var names;
        try { names = readDir(at); }
        catch (e) { return []; }   //no folder yet is no files, not a failure

        return names.filter(function (f) { return SERVABLE.test(f); }).sort().map(function (f) {
            return { name: f, text: readFile(path.join(at, f)) };
        });
    }

    //WHERE A SCRIPT CAME FROM, so the log can say whose copy ran.
    function sourceOf(file) {
        var ws = workspaceDirNow();
        return (ws && String(file).indexOf(ws) === 0) ? 'the project' : 'the app';
    }

    //WHICH STAGE A REQUESTED FILENAME BELONGS TO, so a request for one by name
    //works with either the stage's default or a swapped-in one.
    function stageOfFile(name) {
        var found = null;
        Object.keys(STAGES).forEach(function (s) { if (!found && STAGES[s] === name) found = s; });
        return found;
    }

    //SERVED EXACTLY AS IT IS ON DISK, for anything that is not shell.
    function raw(vm, stage) { return readFile(fileFor(vm, stage)); }

    //THE HEADER, THE SCRIPT, AND THEN THE MACHINE'S OWN EXTRA STEPS if it
    //declared any — so a small addition does not need a whole new file.
    //
    //THE SCRIPT GOES IN UNCHANGED, between the two. That is what keeps it
    //runnable by hand on the machine: the header only defines things, and the
    //steps only come after.
    function render(stage, vm, where) {
        var body = readFile(fileFor(vm, stage));

        var steps = (((vm && vm.spec) || {}).setup || []).map(function (s, i) {
            //THE LABEL IS QUOTED AND THE STEP IS NOT. A step IS shell — that is
            //what somebody typed it as — but what we say ABOUT it is a value.
            return 'say ' + q('extra step ' + (i + 1) + ': ' + (s.name || s.run)) + '\n' + s.run + '\n';
        }).join('\n');

        return [
            header(vm, where),
            body,
            steps ? '\n# --- this machine\'s own setup steps -------------------------------\n' + steps : ''
        ].join('\n');
    }

    //---- files this HOST reads, which are never served to a guest ----------
    //
    //SERVABLE IS THE WRONG GATE FOR THESE, and deliberately so: it governs what
    //may go down the wire to a machine, and the autoinstall template never does.
    //It is read here and handed to VBoxManage on this host.
    //
    //SO IT IS ASKED FOR BY A NAME THIS FILE KNOWS, not by a filename a caller
    //supplies. `resolve` can afford to take a name from a spec because
    //`path.basename` plus SERVABLE fences it in; this has neither, so there is
    //nothing for a spec to reach through. The key is a constant in the code.
    //
    //IT STILL USES THE SEARCH PATH, so a project can replace the template the
    //same way it can replace any script — that is the point of having one.
    var HOST_FILES = {
        //VirtualBox's own autoinstall template plus one block: the installer's
        //journal streamed to the serial port, and ssh into the installer
        //environment. Between "installing" and "it dialled in" there was no
        //evidence of any kind, and a machine that hangs in that window looks
        //exactly like one that is working.
        autoinstall: 'autoinstall-user-data'
    };

    function hostFile(which) {
        var name = HOST_FILES[which];
        if (!name) throw new Error('"' + which + '" is not a file this host reads.');

        var dirs = searchPath();
        for (var i = 0; i < dirs.length; i++) {
            var file = path.join(dirs[i], name);
            if (there(file)) return file;
        }
        throw new Error('There is no "' + name + '" in ' + (dirs.join(' or ') || 'any provisioning directory') + '.');
    }

    return {
        resolve: resolve, fileFor: fileFor, has: has, list: list, kept: kept,
        sourceOf: sourceOf, stageOfFile: stageOfFile, raw: raw, render: render,
        searchPath: searchPath,
        hostFile: hostFile, readFile: readFile,
        HOST_FILES: HOST_FILES,
        STAGES: STAGES
    };
};

module.exports.STAGES = STAGES;
module.exports.SERVABLE = SERVABLE;
