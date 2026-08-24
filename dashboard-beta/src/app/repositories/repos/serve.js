var fs = require('fs');
var path = require('path');
var zlib = require('zlib');
var spawn = require('child_process').spawn;

//---------------------------------------------------------------------------
//THE WORKSPACE'S REPOSITORIES, SERVED SO A MACHINE CAN CLONE THEM.
//
//Node and git, nothing else. Git's own transport is a pair of programs —
//`upload-pack` reads, `receive-pack` writes — and the HTTP protocol is a thin
//wrapper around piping them: ask what refs exist, then stream a packfile. So
//this spawns the same git that is already on the host and gets out of the way.
//
//WHY THIS RATHER THAN A SHARED FOLDER, which is the whole argument for the file
//existing. A guest pushing to a writable mount runs `receive-pack` ITSELF, on
//its own side of the share — so the repository's hooks execute in the guest,
//and the guest can also rewrite them, because the mount is writable and they
//live inside it. Enforcement at that end is a request, not a rule. Served over
//HTTP the pack programs run HERE, in a directory no guest can reach, and a
//refusal is a refusal.
//
//It stays generic the way everything else here does: it does not know the name
//of a single repository. It serves what it finds.
//
//---- READING ONLY, AND THAT IS DELIBERATE RATHER THAN UNFINISHED ----------
//
//`upload-pack` is here. `receive-pack` is NOT, and ./gitapi.js refuses it in
//words rather than leaving it to fail as a protocol error.
//
//A push carries a great deal more than a packfile: which branch it may land on,
//whether that branch is protected, whether a judgement is trying to write to
//the thing it was asked to read, and whether a checkout on this host is sitting
//on the branch and has to be stepped off first. Every one of those rules is
//already ported — see ../branches and ../pr — and every one of them has to be
//wired to the `pre-receive` hook that carries them across, which is not.
//
//SO THE HALF THAT IS HERE IS THE HALF THAT IS COMPLETE. A read has one rule —
//may this machine see this repository — and ./gitapi.js applies it. Shipping
//the write path with three of its four checks would be the more dangerous kind
//of half-finished, because it would look finished.
//---------------------------------------------------------------------------

module.exports = function serving(d) {
    var workspace = d.workspace;
    var say = d.say;

    function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }
    function isFile(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }

    //A NAME FROM A URL IS NEVER JOINED TO A PATH UNTIL IT HAS BEEN THROUGH THIS.
    //
    //Not a blocklist of "../" and friends: a name either matches this or it is
    //not a name. Anything else — a slash, a backslash, a drive letter, a leading
    //dot — is refused before it can be part of a path, because the alternative
    //is being sure that every way of spelling "the parent directory" was thought
    //of.
    var NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

    //WHERE THE REPOSITORIES ARE, ASKED EACH TIME rather than fixed at load, so
    //pointing the app at another workspace takes effect on the next request
    //rather than the next start.
    //
    //AND IT IS ASYNC HERE, WHICH IT IS NOT IN THE APP THIS COMES FROM. Over
    //there `workspaces.dir()` is a value; here ../../workspace can BORROW the
    //other app's folder, so answering means possibly asking it. Everything below
    //is async for that one reason.
    //
    //IT THROWS WHEN NOTHING IS OPEN, and that is caught rather than propagated.
    //This answers "where is that repository", and with no workspace open the
    //honest answer is that there is not one — not an error. Joining a null root
    //would make a RELATIVE path out of a name from a URL, which is the one thing
    //NAME above exists to prevent.
    async function root() {
        try { return await workspace.dir(); }
        catch (e) { return null; }
    }

    //WHERE A REPOSITORY'S GIT DIRECTORY ACTUALLY IS, or null if there is not one.
    //
    //Both shapes are served. An ordinary checkout keeps its git directory in
    //`.git` and is what is sitting in the workspace; a bare one IS the directory.
    //Told apart by what is INSIDE rather than by the name, because `<name>.git`
    //is a convention and conventions are not always followed.
    async function gitDirOf(name) {
        if (!NAME.test(String(name || ''))) return null;

        var at = await root();
        if (!at) return null;

        var base = path.join(at, name);
        if (!isDir(base)) return null;

        var dotGit = path.join(base, '.git');
        if (isDir(dotGit)) return dotGit;
        if (isDir(path.join(base, 'objects')) && isFile(path.join(base, 'HEAD'))) return base;
        return null;
    }

    //WHAT THERE IS TO CLONE. Read fresh per request, like the provisioning
    //scripts, so a repository added to the workspace needs nothing restarted.
    async function list() {
        var at = await root();
        if (!at || !isDir(at)) return [];

        var entries;
        try { entries = fs.readdirSync(at, { withFileTypes: true }); }
        catch (e) { return []; }

        var out = [];
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            if (!e.isDirectory() || !NAME.test(e.name)) continue;
            var dir = await gitDirOf(e.name);
            if (!dir) continue;
            //BARE MEANS THE GIT DIRECTORY IS THE DIRECTORY, rather than a `.git`
            //inside it. Compared rather than read off the name: `<name>.git` is
            //only a convention, and a bare repository not spelled that way would
            //be labelled backwards — which will matter as soon as pushes land in
            //bare repos.
            out.push({ name: e.name, bare: dir === path.join(at, e.name) });
        }
        return out;
    }

    //---- the protocol ------------------------------------------------------
    //
    //Git frames its control messages as "pkt-lines": four hex digits giving the
    //length, then the bytes. THE LENGTH COUNTS THE FOUR DIGITS, which is the
    //detail every hand-written version gets wrong — and it fails as a client
    //that will not clone rather than as an error saying what was wrong. So the
    //length is computed from the finished line here and never written by hand.
    function pkt(line) {
        return (Buffer.byteLength(line) + 4).toString(16).padStart(4, '0') + line;
    }
    var FLUSH = '0000';

    //ONLY THE ONE THAT READS. See the header: the write half is not here, and
    //../repos/gitapi.js says so to a client rather than letting this table
    //answer with a protocol error about an unknown service.
    var SERVICES = { 'git-upload-pack': 'upload-pack' };

    var noCache = {
        'cache-control': 'no-cache, max-age=0, must-revalidate',
        expires: 'Fri, 01 Jan 1980 00:00:00 GMT',
        pragma: 'no-cache'
    };

    //GIT IS SPAWNED THE SAME WAY FOR BOTH PHASES, so its failure is handled once.
    //
    //A spawn that fails AFTER the headers have gone out cannot be turned into an
    //error page — the client is already reading a body. Destroying the response
    //is then the honest move: git reports "the remote end hung up", which is
    //true, rather than a clean-looking empty result that reads as an empty
    //repository.
    function pipeGit(res, args, opts) {
        var o = opts || {};
        var git = spawn('git', args);

        git.on('error', function (err) {
            if (!res.headersSent) {
                res.writeHead(500, { 'content-type': 'text/plain' });
                res.end('git could not be run: ' + err.message + '\n');
            } else {
                res.destroy();
            }
        });

        git.stdout.pipe(res);

        //stderr IS GIT TALKING TO AN OPERATOR, not to the client. It belongs in
        //the live log with everything else rather than corrupting the packfile.
        git.stderr.on('data', function (chunk) {
            var line = String(chunk).trim();
            if (line) say('git').warn(line);
        });

        if (o.onExit) git.on('close', function (code) { o.onExit(code); });
        return git;
    }

    function argsFor(service, dir, extra) {
        return ['upload-pack', '--stateless-rpc'].concat(extra || []).concat([dir]);
    }

    //PHASE ONE: what refs are here, and what this server can do.
    function advertise(res, at) {
        res.writeHead(200, {
            'content-type': 'application/x-' + at.service + '-advertisement',
            'cache-control': noCache['cache-control'],
            expires: noCache.expires,
            pragma: noCache.pragma
        });
        res.write(pkt('# service=' + at.service + '\n') + FLUSH);
        say('git', at.repo).info(at.repo + ': advertising refs for ' + at.service);
        pipeGit(res, argsFor(at.service, at.dir, ['--advertise-refs']));
    }

    //PHASE TWO: the packfile itself.
    //
    //THE REQUEST BODY MAY BE GZIPPED — git compresses it when it is worth it and
    //says so in a header. Piped through undecoded, git reads compressed bytes as
    //protocol and the clone fails in a way that points nowhere near the cause.
    function rpc(req, res, at) {
        res.writeHead(200, {
            'content-type': 'application/x-' + at.service + '-result',
            'cache-control': noCache['cache-control'],
            expires: noCache.expires,
            pragma: noCache.pragma
        });

        var started = Date.now();
        var to = say('git', at.repo);
        to.info(at.repo + ': ' + at.service);

        var git = pipeGit(res, argsFor(at.service, at.dir), {
            onExit: function (code) {
                var took = ((Date.now() - started) / 1000).toFixed(1);
                if (code === 0) to.good(at.repo + ': ' + at.service + ' finished in ' + took + 's');
                else to.bad(at.repo + ': ' + at.service + ' exited ' + code + ' after ' + took + 's');
            }
        });

        var body = req.headers['content-encoding'] === 'gzip'
            ? req.pipe(zlib.createGunzip())
            : req;
        body.pipe(git.stdin);

        //A CLIENT THAT GOES AWAY MID-CLONE leaves git waiting on a pipe that will
        //never close.
        req.on('aborted', function () { git.kill(); });
    }

    return {
        root: root,
        list: list,
        gitDirOf: gitDirOf,
        advertise: advertise,
        rpc: rpc,
        SERVICES: SERVICES,
        NAME: NAME,
        pkt: pkt
    };
};
