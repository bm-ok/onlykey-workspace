var Drawers = require('./drawers');

//---------------------------------------------------------------------------
//`cached` — one mechanism, so nobody writes a seventh copy of it.
//
//WHY THIS IS A PLUGIN AND NOT A HELPER IN WHOEVER NEEDED IT FIRST. The app being
//ported from had every git read in one file — ../../../../dashboard/repos/branches.js
//— with one chokepoint, one memo, and one `forgetRefs()`. That file WAS the
//isolation, which is why its memo never needed exporting. This app split those
//reads across four plugins in ../../repositories, and the shared layer is the
//half that did not survive the split: two of its three caches and the whole
//de-duplicating layer are simply absent here, and the board takes seven seconds.
//
//So it comes back as the thing it always was — one owner — rather than as a
//copy in each of the four. See ./drawers.js for the rule itself.
//
//---- what belongs in here, and what emphatically does not -----------------
//
//A CACHE IS DEFINED BY BEING DROPPABLE. Throw one away and the app is slower;
//that is the whole contract, and it is what lets this evict, wipe and reload
//without asking anybody.
//
//WHICH IS WHY ../state IS STILL CONSUMED DIRECTLY BY ../../repositories, and
//must go on being. Everything it keeps there is a RECORD, not a cache:
//
//    lines, cuts        branch lines somebody defined — derivable from nothing
//    pr-drafts          a draft somebody typed
//    pr-allowed         a human approved THIS pull request at THIS commit
//    repositories       what GitHub last said, and WHEN it was asked
//
//`pr-allowed` is the one that makes this a rule rather than a preference: it is
//the record standing between a stranger's pull request and a judge running on
//it. Put it behind something whose contract is "may be evicted or rebuilt" and
//the approval gate quietly stops meaning what it says. Nothing in here may ever
//become the store for something a person decided.
//
//---- where a `byContent` drawer is written down ---------------------------
//
//`state.here`, so the file is per-workspace — and the drawer is reloaded when
//the workspace changes, so one workspace's file does not slowly fill with
//another's answers.
//
//THAT IS TIDINESS RATHER THAN SAFETY, and the difference is worth being exact
//about, because ../state's own header is about contamination and this looks like
//the same problem. It is not. A content key holds the shas: two commits with the
//same shas ARE the same commits, whatever folder they were read in, so the
//answer is the same answer. A content-keyed drawer cannot be contaminated by a
//workspace switch in the way a list of tasks can — that property is exactly what
//"key on something that changes when the answer changes" buys.
//
//A CLOCK- OR STAMP-KEYED DRAWER NEVER REACHES DISK. See ./drawers.js: the first
//would come back stale by exactly the window it promises not to have, and the
//second is what an unsealed credential lands in.
//---------------------------------------------------------------------------

//HOW LONG A CHANGED DRAWER WAITS BEFORE IT IS WRITTEN.
//
//BECAUSE A WRITE IS A WHOLE DOCUMENT. ../state serialises the lot and renames it
//into place — right for a record written when somebody presses a button, and
//ruinous per cache entry: a board filling a drawer would rewrite the file once
//per branch. So changes pile up and go down together, and the only cost of the
//delay is answers recomputed after a crash, which is what a cache is for.
var SETTLE = 2000;

plugin.consumes = ['app', 'log', 'state'];
plugin.provides = ['cached'];
async function plugin(imports, register) {
    var state = imports.state;
    var log = imports.log.on('cached');

    var dirty = {};
    var soon = null;
    var loadedFor = null;
    var ready = {};
    var gone = false;

    var core = Drawers({
        keep: {
            dirty: function (name) {
                dirty[name] = true;
                if (soon || gone) return;
                soon = setTimeout(function () { soon = null; flush(); }, SETTLE);
                //SO A PENDING WRITE NEVER HOLDS THE PROCESS OPEN. Losing a
                //flush at exit costs answers that get worked out again.
                if (soon.unref) soon.unref();
            }
        }
    });

    function docFor(name) { return state.here.doc('cached-' + name); }

    //WHERE WE ARE, OR NULL. `state.here` throws when no workspace is open, which
    //is the correct answer for a record and merely means "nowhere to keep this"
    //for a cache — so it is caught here rather than at every call.
    async function where() {
        try { return await state.here.where(); }
        catch (e) { return null; }
    }

    //WHAT WAS KEPT LAST TIME, MERGED UNDER WHAT IS HELD NOW. `load` in
    //./drawers.js skips a key already in hand, so a fresh answer always beats
    //the file — which matters on a workspace switch, where this runs against a
    //drawer that is not empty.
    async function load(d) {
        var here = await where();
        if (!here) return;
        //THE FIRST DRAWER OPENED SETS WHERE WE THINK WE ARE, so a switch that
        //happens before anything has been written down is still noticed.
        if (loadedFor === null) loadedFor = here;
        try {
            var doc = await docFor(d.name);
            var rows = doc.read(null);
            if (rows) d.load(rows);
        } catch (e) {
            //A DRAWER THAT WILL NOT LOAD IS AN EMPTY DRAWER, which is a cache
            //doing its job. Worth a line, never worth a throw.
            log.info('could not read what was kept for "' + d.name + '": ' + e.message);
        }
    }

    async function flush() {
        var names = Object.keys(dirty);
        dirty = {};
        if (!names.length) return;

        var here = await where();
        if (!here) return;

        //---- the workspace moved while these were waiting to be written -----
        //
        //SO THE NEW ONE'S FILE IS PICKED UP FIRST, and then everything held goes
        //down together. What that means, said plainly rather than implied:
        //
        //ANSWERS WORKED OUT UNDER THE OLD WORKSPACE MIGRATE INTO THE NEW ONE'S
        //FILE. Keeping them apart would need to know, per entry, which workspace
        //it was worked out in, and there is nowhere to write the old one's file
        //once we have moved away from it.
        //
        //THAT IS UNTIDY AND IT IS NOT UNSAFE, and the difference is the whole
        //reason the three doors exist. A content key holds the shas: two commits
        //with the same shas ARE the same commits, in any folder, so a migrated
        //entry is a correct answer to a question the new workspace may simply
        //never ask. It falls out at the next wipe.
        //
        //../state's header is about contamination and this is the case that
        //looks like it and is not — a list of tasks carried across would answer
        //ABOUT THE WRONG PLACE, which is exactly what a key made of content
        //cannot do. Nothing keyed on a clock or a stamp is written down at all,
        //so this reasoning never has to hold for them.
        //THE FINGERPRINT DRAWERS COME UP WITH THE CONTENT ONES, for the same
        //reason and with an easier conscience: what they hold is never served
        //without asking the far end first, so an entry that migrated across a
        //workspace switch can at worst send a fingerprint nobody recognises and
        //get a full answer — which is what an empty drawer does anyway.
        if (loadedFor && here !== loadedFor) {
            var written = core.drawers().filter(function (d) { return d.kind === 'content' || d.kind === 'etag'; });
            for (var j = 0; j < written.length; j++) await load(written[j]);
        }
        loadedFor = here;

        for (var i = 0; i < names.length; i++) {
            var d = core.drawers().filter(function (x) { return x.name === names[i]; })[0];
            if (!d) continue;
            var rows = d.save();
            if (!rows) continue;
            try { (await docFor(d.name)).write(rows); }
            catch (e) { log.info('could not keep "' + d.name + '": ' + e.message); }
        }
    }

    //THE LOAD IS AWAITED RATHER THAN FIRED OFF, so "what survived the restart is
    //used" is true rather than usually true. Without it the first `get` races the
    //read and recomputes an answer that was already on disk — which no test
    //would fail on and nothing would ever say.
    function byContent(name) {
        var d = core.byContent(name);
        if (ready[name]) return d;

        var done = load(d);
        ready[name] = done;

        return Object.assign({}, d, {
            get: async function (key, make) {
                await done;
                return d.get(key, make);
            }
        });
    }

    //---- and the same for the fingerprint drawer, where only one verb waits --
    //
    //`byContent` CAN WRAP `get` BECAUSE `get` IS ASYNC. The etag door's three
    //verbs are not, so the wait has to go somewhere it is true rather than
    //everywhere it would be tidy.
    //
    //IT GOES ON `tag`, WHICH IS THE ONE THAT MUST SEE THE FILE. Asking for a
    //fingerprint before the file has been read answers "none", and none means a
    //full download of something already on disk — the restart paying for itself
    //twice.
    //
    //`got` DOES NOT NEED IT, and this is a property of ./drawers.js rather than
    //luck: `load` skips a key already held, so a fresh answer written before the
    //file arrives is not overwritten by the older one in it.
    //
    //`still` DOES NOT NEED IT EITHER, because it cannot be reached without
    //having called `tag` first — a 304 only comes back when a fingerprint went
    //out, and the only place one comes from is `tag`.
    function byEtag(name) {
        var d = core.byEtag(name);
        if (ready[name]) return d;

        var done = load(d);
        ready[name] = done;

        return Object.assign({}, d, {
            tag: async function (key) {
                await done;
                return d.tag(key);
            },

            //THE WHOLE ENTRY, FOR A CALLER THAT KEEPS MORE THAN A VALUE BESIDE
            //THE FINGERPRINT. ../../github stores where a moved repository
            //actually answers, so it can go straight there instead of being
            //redirected every time — and it needs the fingerprint and the
            //address in one look, before it builds the request.
            //
            //NAMED APART FROM `peek`, WHICH IS SYNC ON EVERY OTHER DRAWER. One
            //verb that means the same thing and returns a promise in one place
            //and a value in another is the kind of difference nobody notices
            //until it is awaited by accident.
            entry: async function (key) {
                await done;
                return d.peek(key);
            }
        });
    }

    var cached = {
        byContent: byContent,
        byEtag: byEtag,
        byStamp: core.byStamp,
        whileFresh: core.whileFresh,

        //THE ONE CALL A WRITE DOOR MAKES. See ./drawers.js for why it takes the
        //clock-keyed drawers and nothing else.
        stale: core.stale,

        about: core.about,

        //FOR A TEST, AND FOR SHUTDOWN. Nothing in ordinary use waits on a write.
        settle: async function () {
            if (soon) { clearTimeout(soon); soon = null; }
            await flush();
        }
    };

    await register(null, {
        cached: cached,
        onDestroy: function () {
            gone = true;
            if (soon) { clearTimeout(soon); soon = null; }
            //NOT AWAITED, BECAUSE onDestroy IS NOT ASYNC HERE. What is lost is
            //answers that get worked out again — the only kind of loss a cache
            //is allowed to have.
            flush();
        }
    });
}
module.exports = plugin;
