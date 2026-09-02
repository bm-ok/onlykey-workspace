//---------------------------------------------------------------------------
//WHAT A RECORD IS, AND WHERE THE MACHINE IT DESCRIBES HAS GOT TO.
//
//Pure, and separate from the file it is kept in, because these are the two
//questions a stand-in can answer without a disk and without VirtualBox.
//---------------------------------------------------------------------------

//---- filling in what an older record never wrote down ----------------------
//
//`tags` and `serial` are read off the top of a record, but a machine made
//before that has them only in its `spec`. Both are read on every draw and by
//the queue, so a missing one is not cosmetic: NO TAGS MEANT A SUPERVISOR
//MACHINE WAS OFFERED TO THE QUEUE AS AN ORDINARY RUNNER.
//
//READ-TIME AND IDEMPOTENT, so nothing has to be migrated and a record that
//already has them is untouched. `tags: []` set on purpose is left alone — only
//a record that never had the field AT ALL falls back to its spec, which is why
//this tests the field's presence rather than its truth.
function asRecorded(vm) {
    var spec = (vm && vm.spec) || {};
    var out = {};
    for (var k in vm) if (Object.prototype.hasOwnProperty.call(vm, k)) out[k] = vm[k];

    out.tags = Array.isArray(vm && vm.tags) ? vm.tags : (Array.isArray(spec.tags) ? spec.tags : []);
    out.serial = (vm && vm.serial !== undefined) ? vm.serial : (spec.serial || null);
    return out;
}

//---- what a machine looks like the moment it is added ----------------------
//
//EVERY FIELD IS NAMED HERE RATHER THAN APPEARING THE FIRST TIME ONE IS SET, so
//a machine that has never been set up reads as "not allowed yet" instead of as
//a field somebody forgot. `branch` is the one it may push, and null means it
//may push nothing.
//
//TAGS ARE LIFTED OUT OF THE SPEC, and this is a fix rather than a tidy-up.
//Provisioning puts tags in the spec, because that is where what somebody asked
//for at creation goes. Everything that READS a tag reads it at the top. So a
//machine made with tags had them written down in a place nothing looked at —
//it came back carrying none, and the supervisor machine built with the box
//ticked was offered to the queue like any other runner.
//
//One place to read from, filled from the one place it is asked for.
function newRecord(spec, now) {
    var s = spec || {};
    return {
        name: s.name,
        spec: s,
        tags: Array.isArray(s.tags) ? s.tags : [],
        //Where its console is written: the window opens a terminal on this, and
        //whatever built the machine is what attached the port.
        serial: s.serial || null,
        created: now,
        baseSnapshot: null,
        reported: null,
        branch: null,

        //---- WHETHER ITS DISK IS STILL THE ONE IT WAS BUILT WITH -----------
        //
        //`cleanSince` WAS ALREADY STAMPED HERE AND NOTHING READ IT. ../../
        //runners/machines/restoring.js writes it on a rollback and
        //snapshotting.js writes it when a snapshot is taken — the two moments a
        //disk becomes a snapshot again — and no line anywhere asked. Half a
        //fact, kept honestly, for nobody.
        //
        //THIS IS THE OTHER HALF. Stamped the moment this app CHANGES a disk, so
        //the pair answers "is what is on there still just what we built" without
        //anybody having to remember. See ./roles.js's neighbour `dirty` below
        //for what counts.
        //
        //IT MATTERS BECAUSE OF THE LANE THAT LEAVES A MACHINE DIRTY ON PURPOSE.
        //The queue always rolls a machine back when it finishes, so a worker is
        //never left in this state and nothing needed to name it. A person's seat
        //is different: they stop for the night with an afternoon's work on the
        //disk, and the difference between "asleep with my work on it" and "back
        //at base" is the difference between waking it and starting again.
        dirtySince: null,

        //---- WHOSE WORKSPACE MADE IT ---------------------------------------
        //
        //THE REGISTER IS THE HOST'S AND THE MEMBERSHIP IS A WORKSPACE'S, and
        //those are two different facts that used to be one. This app keeps one
        //register because a machine dialling in has to be authenticated whichever
        //folder happens to be open — the channel looks it up BY NAME and must
        //find it. But which machines you SEE, and which the queue may spend, is a
        //question about the work, and the work is per workspace.
        //
        //Switching folders showed the other workspace's machines, because the
        //register predates workspaces being switchable and nothing had asked the
        //question since.
        //
        //NULL MEANS NOBODY'S YET, which is a real state rather than a default:
        //every machine made before this field existed has it, and guessing which
        //workspace those belong to is exactly the mistake this field exists to
        //stop. ../ours/store.js says what is done with them.
        workspace: s.workspace || null
    };
}

//---- where a machine has got to --------------------------------------------
//
//REPORTED AS A STAGE RATHER THAN A BOOLEAN because "it is not working" has
//several very different causes and the useful thing is which one.
//
//`live` and `connected` ARE PASSED IN rather than asked for here. They are the
//two questions this module cannot answer — one is VirtualBox's, one is the
//channel's — and taking them as arguments is what lets every branch below be
//checked without either.
var STAGES = ['defined', 'created', 'installing', 'online', 'ready', 'connected'];

function stageOf(vm, seen) {
    var s = seen || {};
    var v = vm || {};

    //---- ORDER IS THE WHOLE OF THIS, AND IT WAS WRONG -------------------
    //
    //`installing` WAS BELOW `reported` AND SO COULD NEVER BE REACHED. A machine
    //reports while it is being installed — that is what fills the live log — so
    //the first line it says flips this to "online" and the install is never
    //mentioned again. The stage said `online` for the twenty-five minutes a
    //machine was being built, with nothing anywhere saying otherwise.
    //
    //IT MADE A CORRECT GUARD UNREACHABLE. ../../ui/banners/trouble.js filters
    //idle machines with `v.stage !== 'installing'` and a comment saying "it is
    //being built" — right, deliberate, and dead. So the banner told somebody to
    //shut down a machine in the middle of its install.
    //
    //`connected` STAYS ABOVE IT, because a machine whose agent is talking is
    //past installing whatever a leftover flag says — that is the one case where
    //the newer fact should win.
    if (!s.live) return 'defined';        //we wrote it down; VirtualBox has no such machine
    if (s.connected) return 'connected';  //its agent is talking to us now
    if (v.installing) return 'installing';//an unattended install is under way
    if (v.baseSnapshot) return 'ready';   //has a snapshot to reset to
    if (v.reported) return 'online';      //it has reported in at least once
    return 'created';                     //exists, never heard from
}

//---- and whether its disk is still the one it was built with ---------------
//
//TWO STAMPS COMPARED, RATHER THAN A FLAG. A boolean has to be set right by every
//path that changes a disk and cleared right by every path that restores one, and
//the first place either is missed it lies quietly and for ever. Two timestamps
//cannot get out of order: whichever happened last is the answer.
//
//AND IT SURVIVES A RECORD THAT PREDATES BOTH. No stamps at all means a machine
//nobody has told us about either way, and the honest answer there is CLEAN —
//because the alternative is every machine this host has ever made suddenly
//reading dirty and offering somebody a rollback they did not ask for.
//
//A MACHINE MID-INSTALL IS NOT DIRTY. It is being built; its disk is not
//supposed to match a snapshot yet, and there is no snapshot to go back to.
function dirty(vm) {
    var v = vm || {};
    if (v.installing) return false;
    if (!v.dirtySince) return false;
    if (!v.cleanSince) return true;
    return String(v.dirtySince) > String(v.cleanSince);
}

//---- AND WHETHER IT IS ACTUALLY INSTALLING ---------------------------------
//
//`installing` IS A STAMP AND NOTHING CLEARS IT WHEN AN INSTALL FALLS OVER. The
//machine ends up powered off with the record still saying it is installing, for
//ever.
//
//WHICH IS THE ONE MACHINE SOMEBODY MOST WANTS RID OF. Rebuild and Remove were
//both refused on that flag alone, so the window would not let them touch it,
//and the reason it gave was "it is installing" about a machine that is off.
//`vmRebuild`'s own error says "let it finish or remove it" -- and Remove was
//disabled by the same flag, so the way out it names was shut.
//
//THE GUARD WAS ALWAYS ABOUT A LIVE INSTALLER, not about destroying a disk out
//from under one. A powered-off machine has no installer to be under.
//
//THE OTHER REFUSALS ARE UNTOUCHED. A held sign-in and a claimed branch are
//about losing something, and being switched off changes neither.
function reallyInstalling(vm) {
    var v = vm || {};
    return !!v.installing && !!v.running;
}

//---- WHOSE KEEP-BACK IT IS -------------------------------------------------
//
//`forTasks: false` WORE TWO DIFFERENT FACTS. A person taking a machine out of
//the pool, and the DIY lane holding one while somebody sits in it. They look
//identical on the record and they are not the same decision: a person's is
//theirs to undo, and the lane's has to be given back when the lane lets go.
//
//THE DIFFERENCE MATTERS MOST WHERE THE MACHINE IS DESTROYED. `vmRebuild`
//carries a keep-back across on purpose — "a machine taken out of the pool on
//purpose must not quietly rejoin it because it was made again" — which is a
//person's reasoning exactly, and wrong for a lane whose seat cannot survive
//the disk. One machine sat out of the pool for two days that way.
//
//SO IT IS ASKED HERE, beside `dirty`, for the same reason that one is: a rule
//about a record belongs with the record, and everything reading it should get
//one answer.
function keptBackByThem(vm) {
    var v = vm || {};
    return v.forTasks === false && v.keptBackBy !== 'diy';
}

module.exports = {
    asRecorded: asRecorded,
    newRecord: newRecord,
    dirty: dirty,
    keptBackByThem: keptBackByThem,
    reallyInstalling: reallyInstalling,
    stageOf: stageOf,
    STAGES: STAGES
};
