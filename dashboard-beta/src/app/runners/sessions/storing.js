var fs = require('fs');
var path = require('path');

var keying = require('./keying');

//---------------------------------------------------------------------------
//KEEPING WHAT A PIECE OF WORK REMEMBERS.
//
//ONE ARCHIVE PER KEY, AND IT IS REPLACED RATHER THAN ADDED TO — which is the
//opposite of how the artifacts beside it behave, and right for the same
//underlying reason. An artifact is a DELIVERY: two runs producing `firmware.bin`
//are two results and losing either loses work, so ../../core/archive's store
//suffixes a clash rather than overwriting. A session is a CONVERSATION, and the
//newer copy is the older one plus what happened since — keeping both would be
//keeping a prefix of a file beside the file.
//
//---- per workspace, which the app being ported from did not do ------------
//
//There, sessions live in one folder for the whole app. Here they go under the
//workspace's own drawer, beside the artifacts, because that is what everything
//else kept about work already does — and because a session is keyed by a BRANCH,
//which is a thing that only means something inside one workspace. Two workspaces
//with a `main` are two different conversations.
//
//NO WORKSPACE IS REFUSED, NOT DROPPED. This is a record of something that
//happened on a machine that is about to be rolled back; "kept" and "there was
//nowhere to keep it" are different answers and only one of them is true.
//---------------------------------------------------------------------------

//The session id a run reported, checked before it is written into a record that
//is later read back and shown. Claude writes uuids.
var ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
function okId(id) { return !id || ID.test(String(id)); }

//An hour of work with a lot of file reading in it. Big enough for a real run,
//small enough that a machine cannot fill this host's disk unnoticed.
var MOST = 256 * 1024 * 1024;

module.exports = function storing(deps) {
    var d = deps || {};

    var root = d.root;          //async () -> the workspace's sessions folder, or null
    var inspect = d.inspect;    //(bytes) -> { inside, refuse: [name] }
    var most = d.most || MOST;
    var io = d.fs || fs;

    async function dirFor(uid) {
        var at = await root();
        return at ? path.join(at, keying.safe(uid)) : null;
    }

    //ONE NAME, because there is one per key. A second would be the first plus
    //what happened since, and two files where one is a prefix of the other is
    //two files nothing on screen can choose between.
    async function fileFor(uid) {
        var dir = await dirFor(uid);
        return dir ? path.join(dir, 'claude.tgz') : null;
    }

    async function aboutFor(uid) {
        var dir = await dirFor(uid);
        return dir ? path.join(dir, 'about.json') : null;
    }

    //---- KEPT, OR REFUSED WITH A REASON -----------------------------------
    async function keep(uid, bytes, about) {
        var meta = about || {};

        if (!uid) throw new Error('there is nothing to file this under');
        if (!okId(meta.id)) throw new Error('that is not a session id');
        if (!bytes || !bytes.length) throw new Error('there was nothing in it');
        if (bytes.length > most) {
            throw new Error('that is ' + Math.round(bytes.length / 1048576) + ' MB, and the most this '
                + 'takes is ' + Math.round(most / 1048576) + ' MB');
        }

        //---- LOOKED AT BEFORE IT IS WRITTEN, NOT AFTER --------------------
        //
        //THE ORDER IS THE WHOLE POINT. Writing first and checking after would
        //put the thing being refused on disk, in the folder it was being kept
        //out of, and then delete it — which leaves it recoverable and leaves a
        //window where it is simply there.
        //
        //See ./looking.js for what may never be in one and why the guest's own
        //exclusion is not a boundary.
        var seen = inspect(bytes);
        if (seen.refuse && seen.refuse.length) {
            throw new Error('that archive has ' + seen.refuse.join(', ') + ' in it, and a credential is '
                + 'never kept unsealed. It is meant to be excluded when the archive is built — see '
                + 'vms/dispatch/guest/job-api.js — so something on that machine is not doing that. '
                + 'Nothing was kept.');
        }

        var dir = await dirFor(uid);
        if (!dir) {
            throw new Error('no workspace is open, so there is nowhere to keep what this remembers. '
                + 'Sessions are kept per workspace — see core/state.');
        }

        //READ BEFORE IT IS OVERWRITTEN, because half of what goes in the record
        //below is carried forward from the copy this one replaces.
        var was = await get(uid);

        io.mkdirSync(dir, { recursive: true });
        io.writeFileSync(path.join(dir, 'claude.tgz'), bytes);

        //WHO SIGNED IT, kept as the latest AND as the whole set. The set is
        //built from what is already on disk rather than from the sign-in list,
        //so a sign-in thrown away afterwards is still named by the conversations
        //it paid for.
        var signed = {};
        var already = (was && was.guests) || [];
        for (var i = 0; i < already.length; i++) signed[already[i]] = true;
        if (meta.guest) signed[meta.guest] = true;

        io.writeFileSync(path.join(dir, 'about.json'), JSON.stringify({
            //WHAT IS IN IT, READ HERE ONCE — see ./looking.js. Not on every
            //paint: that would gunzip and re-parse the whole conversation on a
            //three-second draw loop.
            inside: seen.inside,

            task: uid,
            taskId: meta.taskId || (was && was.taskId) || null,
            number: meta.number || (was && was.number) || null,
            id: meta.id || (was && was.id) || null,
            run: meta.run || null,
            machine: meta.machine || null,

            //THE ONE ON THE MACHINE FOR THIS RUN, kept even when it is null. A
            //run with no sign-in named is a run signed by whatever this host
            //used to keep, and blanking it is more honest than inheriting the
            //previous name.
            guest: meta.guest || null,
            guests: Object.keys(signed),

            //---- WHAT THIS CONVERSATION IS ABOUT, IN WORDS ----------------
            //
            //The key already says it — `worker--cut--fix_thing` — and a key is
            //a filename, not a sentence. Every panel that showed a session
            //showed the NUMBER of the work that last wrote it, so a list read
            //"#61, task is gone": true, useless, and actively misleading now
            //that a session outlives the task that started it.
            //
            //A session belongs to a SUBJECT and a LANE. Those are the two things
            //somebody needs to know what they are looking at, and neither
            //survives being derived from a filename by whichever panel happens
            //to be drawing. See ./keying.js, which works both out at once.
            lane: meta.lane || (was && was.lane) || null,
            about: meta.about || (was && was.about) || null,

            folder: meta.folder || null,
            bytes: bytes.length,
            kept: new Date().toISOString(),

            //HOW MANY TIMES THIS HAS PICKED THE CONVERSATION BACK UP, which is
            //the one number that says "this was resumed" rather than "this ran
            //once".
            runs: ((was && was.runs) || 0) + 1,
            first: (was && was.first) || new Date().toISOString()
        }, null, 2));

        return await get(uid);
    }

    //---- WHAT IS KEPT FOR ONE KEY, OR NULL --------------------------------
    //
    //READ FROM DISK RATHER THAN FROM A RECORD ELSEWHERE, so a conversation whose
    //task was thrown away is still findable. What was produced outlives the note
    //about it, which is the right way round and is already how the run logs
    //behave.
    async function get(uid) {
        var file = await fileFor(uid);
        if (!file) return null;

        var bytes = 0;
        try { bytes = io.statSync(file).size; } catch (e) { return null; }

        var about = {};
        try { about = JSON.parse(io.readFileSync(await aboutFor(uid), 'utf8')); }
        catch (e) { /* an interrupted keep, and the archive still counts */ }

        //---- WHAT AN OLDER RECORD IS MISSING, FROM ITS OWN NAME -----------
        //
        //`lane` and `about` are written down now; anything kept before that has
        //neither, and those two are exactly what a panel needs to say what it is
        //looking at. The key already carries both, so they are recovered on the
        //way OUT rather than by rewriting files.
        //
        //Read-time and idempotent: a record that already has them is untouched,
        //and one that never will — a uid from before subject keying — keeps null
        //and says so.
        var named = /^(worker|judge)--(?:cut|pull)--(.+)$/.exec(String(uid));

        return Object.assign({}, about, {
            uid: uid,
            path: file,
            bytes: bytes,
            lane: about.lane || (named ? named[1] : null),
            about: about.about || (named ? named[2] : null)
        });
    }

    async function has(uid) { return !!(await get(uid)); }

    async function forget(uid) {
        var found = await get(uid);
        if (!found) throw new Error('there is no session kept under that name');

        var dir = await dirFor(uid);
        try { io.unlinkSync(path.join(dir, 'claude.tgz')); } catch (e) { /* already gone */ }
        try { io.unlinkSync(path.join(dir, 'about.json')); } catch (e) { /* may never have been written */ }
        try { io.rmdirSync(dir); } catch (e) { /* something else is in there */ }

        return { forgotten: uid, bytes: found.bytes };
    }

    //Everything with one, including work the board has forgotten.
    async function everything() {
        var at = await root();
        if (!at) return [];

        var names = [];
        try {
            names = io.readdirSync(at, { withFileTypes: true })
                .filter(function (e) { return e.isDirectory(); })
                .map(function (e) { return e.name; });
        } catch (e) { return []; }

        var out = [];
        for (var i = 0; i < names.length; i++) {
            var one = await get(names[i]);
            if (one) out.push(one);
        }

        //NEWEST FIRST, by when it was last kept.
        return out.sort(function (a, b) {
            return String(b.kept || '').localeCompare(String(a.kept || ''));
        });
    }

    return {
        keep: keep, get: get, has: has, forget: forget, everything: everything,
        dirFor: dirFor, fileFor: fileFor
    };
};

module.exports.okId = okId;
module.exports.MOST = MOST;
