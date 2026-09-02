var path = require('path');

var keying = require('./keying');
var looking = require('./looking');
var makeStoring = require('./storing');
var makeGuestApi = require('./guestapi');

//---------------------------------------------------------------------------
//WHAT A WORKER KEEPS BETWEEN MACHINES.
//
//A MEMORY, NOT A TRANSCRIPT, and the two were one plugin until this moved here.
//The distinction is what decided where each half went:
//
//  a session ON a machine     what Claude is writing right now, in the guest's
//                             own `~/.claude`. Read live over the channel, as a
//                             delta with a bookmark. That is a fact about a
//                             MACHINE and it stayed with the machines —
//                             `vmSessions` and `vmSessionTail`, now in
//                             ../../runners/runs, the door for everything else
//                             asked of a box that is dialled in.
//  a session KEPT here        the archive of that folder, handed back when a run
//                             ends and filed by SUBJECT, so the next piece of
//                             work on the same branch cut picks the
//                             conversation up. That outlives every machine it
//                             passes through, and it is the WORKER's.
//
//AND ONLY A WORKER HAS ONE. ./keying.js refuses a judge outright — a judge that
//remembers the last four readings of the same line is a judge with an opinion
//formed before it looked. So this belongs under the tab named after the thing
//that keeps one, next to the board of what it has done, rather than under the
//boxes it is lent.
//
//---- IT ASKS TO BE REACHED; IT IS NOT REACHED INTO ------------------------
//
//Nothing consumes this. It registers at three doors owned elsewhere and each
//registration is the same shape as ../../inbox's sources and ../../permissions'
//rules — the plugin that OWNS a fact declares it, at the door that will act on
//it:
//
//  guestApi.api(...)      the two verbs a machine on a run reaches over https
//  briefings.says(...)    what a continuation is told, in front of its brief
//  actions.define(...)    what a person at the command line may ask
//
//../../runners/runs used to consume this for the announcement alone, which made
//the dispatcher of BOTH lanes depend on one of the two things it dispatches. It
//asks its contributors now, and this is one.
//
//THE ANNOUNCEMENT IS ./keying.js's AND HAS TO BE SAID AT THE JOIN. A worker
//handed a conversation begun by different work is a worker still obeying
//instructions that ended with that work — measured, not supposed. Both paths to
//a worker pass through `briefings`, which is why registering there rather than
//writing the words at either end is what makes it fire at all: the first
//version of it was written into one path and never once ran.
//---------------------------------------------------------------------------

//`whatIsOn` and `guestApi` ARE FOR THE GUEST DOOR ONLY — ./guestapi.js. This is
//`whatIsOn`'s second reader, and the reason it is a plugin of its own rather
//than something the queue keeps: the machine asking here may be running a task
//or a judgement, and only the join between the two boards can say which.
//
//`ours` IS NOT FOR REACHING A MACHINE — it is read to find which sign-in a
//machine is holding, because a worker naming its own identity would be a worker
//choosing which one to bill.
plugin.consumes = ['app', 'log', 'ours', 'state', 'archive',
    'whatIsOn', 'guestApi', 'briefings'];
plugin.provides = [];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;

    var archive = imports.archive;

    //---- LOOKING INSIDE ONE, ONCE, ON THE WAY IN --------------------------
    //
    //`checked` IS SEPARATE FROM `refuse` AND THAT IS THE POINT.
    //
    //An archive that cannot be parsed has no entries, so asking "does it hold a
    //credential" of an empty list answers no — and "not checked" would arrive
    //looking exactly like "checked and clean". That is the conflation this app
    //refuses everywhere else it appears: `vmHolds` reports NOT ASKED as its own
    //answer for the same reason, because a machine that is off is exactly the
    //one nobody has looked at recently.
    //
    //So an unreadable archive is refused by ./storing.js rather than kept with a
    //note. It cannot be vouched for, and it cannot be handed back to a machine
    //either — what would be kept is bytes nobody has looked at, in the folder
    //that exists to be kept for a long time.
    function inspect(bytes) {
        var seen = archive.inside(bytes);

        if (seen.unreadable) {
            return { inside: { unreadable: seen.unreadable, files: 0 }, refuse: [], checked: false };
        }

        var refuse = looking.mustNotHave(seen.entries);
        if (refuse.length) return { inside: null, refuse: refuse, checked: true };

        var jsonl = looking.transcriptIn(seen.entries);
        if (!jsonl) {
            return {
                inside: { unreadable: 'there is no transcript in it', files: seen.files },
                refuse: [],
                checked: true
            };
        }

        var summary = looking.summarise(archive.text(jsonl));
        summary.files = seen.files;
        summary.transcript = jsonl.name;
        return { inside: summary, refuse: [], checked: true };
    }

    var store = makeStoring({
        //UNDER THE WORKSPACE'S OWN DRAWER, beside the artifacts. A session is
        //keyed by a BRANCH, and a branch only means something inside one
        //workspace — two workspaces with a `main` are two different
        //conversations. See ./storing.js.
        root: async function () {
            var at = null;
            try { at = await imports.state.here.where(); } catch (e) { at = null; }
            return at ? path.join(at, 'sessions') : null;
        },
        inspect: inspect
    });

    var undo = [];

    if (actions) {
        //---- WHAT IS KEPT, AND WHOSE IT IS --------------------------------
        //
        //A SESSION OUTLIVES THE TASK IT BELONGS TO, deliberately: a task that
        //was thrown away leaves its transcript behind, because what a worker did
        //is worth reading after somebody decides the work was not. So this joins
        //two lists and the join is allowed to fail on one side — an orphan is a
        //row, not a gap.
        //
        //THE BOARD IS ASKED FOR BY NAME rather than consumed. ../../queue
        //says of itself that nothing consumes it, "so none of these can be a
        //cycle — which is worth saying out loud, because an unresolved name
        //takes down the whole graph". Making this the first consumer would spend
        //that property to read one list. `actions.call` resolves at call time
        //and costs the graph nothing.
        undo.push(actions.define('sessions', {
            about: 'What workers remember, kept per task — restored before a run and taken back after',
            run: async function () {
                var kept = await store.everything();

                //A BOARD THAT WILL NOT ANSWER IS NOT A REASON TO SHOW NOTHING.
                //Every session is still on disk and still worth listing; what is
                //lost is the title and the branch, and the rows say so by
                //carrying nulls rather than by not existing.
                var board = {};
                try {
                    var said = await actions.call('tasks', {});
                    ((said && said.tasks) || []).forEach(function (t) { board[t.uid] = t; });
                } catch (e) { /* the rows below say what they can */ }

                var rows = kept.map(function (s) {
                    var t = board[s.uid] || null;
                    return Object.assign({}, s, {
                        //FROM THE BOARD WHERE IT STILL EXISTS, and from the
                        //record beside the archive where it does not.
                        task: t ? t.id : s.taskId,
                        number: t ? t.number : s.number,
                        title: t ? t.title : null,
                        branch: t ? t.branch : null,
                        orphaned: !t,

                        //---- FOR THE ONES KEPT BEFORE EITHER WAS RECORDED ----
                        //
                        //History rather than an ongoing hole: sessions kept
                        //before there were lanes name none, and a list of them
                        //reads "#42, the work it began with is gone" — which
                        //says nothing about the only question somebody has,
                        //which is what branch line it was for.
                        //
                        //A LOOKUP, NOT A GUESS, and that is what makes filling
                        //anything in allowable at all: `board` is the TASK
                        //board, so a uid found on it belonged to a task, and a
                        //task is worked rather than read. A judgement is not on
                        //this board and so is never given a lane here.
                        //
                        //AND WHAT IS NOT RECOVERABLE IS LEFT EMPTY. A session
                        //whose task was thrown away has no branch line anywhere
                        //on this host; filing it under the likelier of two lanes
                        //would be inventing the answer.
                        lane: s.lane || (t ? 'worker' : null),
                        about: s.about || (t ? t.branch : null)
                    });
                });

                return {
                    sessions: rows,
                    bytes: rows.reduce(function (n, s) { return n + (s.bytes || 0); }, 0),
                    note: rows.length
                        ? 'Restored before a worker starts and taken back when it stops, so a task keeps '
                            + 'one conversation however many machines it passes through.'
                        : 'Nothing yet. A worker started by a job hands its memory back when it finishes, '
                            + 'and gets it again next time that task runs.'
                };
            }
        }));

        undo.push(actions.define('sessionForget', {
            about: 'Throw away what a task remembers. The next run starts a fresh conversation',
            takes: ['id'],
            run: async function (args) {
                var id = String((args || {}).id == null ? '' : (args || {}).id);

                //BY UID, AND BY TASK NAME, because both are what somebody has in
                //front of them: the pane holds uids, and a person at the command
                //line has "#42". A memory that outlives its task and cannot then
                //be deleted is kept twice over.
                var uid = id;
                var task = null;
                try {
                    var said = await actions.call('tasks', {});
                    ((said && said.tasks) || []).forEach(function (t) {
                        if (t.uid === id || String(t.id) === id || String(t.number) === id) {
                            task = t;
                            uid = t.uid;
                        }
                    });
                } catch (e) { /* an orphan's uid still works */ }

                var gone = await store.forget(uid);

                imports.log.on('task', task ? task.id : uid).warn(task
                    ? '#' + task.number + ' will start a fresh conversation next time — what it '
                        + 'remembered was thrown away'
                    : 'threw away a session left behind by a task that is gone (' + uid + ')');

                return Object.assign({}, gone, {
                    task: task ? task.id : null,
                    number: task ? task.number : null,
                    note: task
                        ? '#' + task.number + ' remembers nothing now. The next run starts a fresh conversation.'
                        : 'Thrown away. It belonged to a task this host no longer has.'
                });
            }
        }));
    }

    //---- AND THE DOOR A WORKER REACHES IT THROUGH -------------------------
    //
    //REGISTERED WITH ../../vms/https RATHER THAN SERVED HERE, which owns the
    //certificate, the port, and has already turned `vm:token` into a machine
    //record before anything in ./guestapi.js runs. What is this plugin's is the
    //two verbs and the rule about who may reach them.
    var stopServing = imports.guestApi.api(makeGuestApi({
        whatIsOn: imports.whatIsOn,
        say: imports.log.on,
        readFile: function (at) { return require('fs').readFileSync(at); },

        //WHICH SIGN-IN THIS MACHINE IS HOLDING, read off the registry. The
        //machine is told which credential it has when one is put on it, and a
        //worker naming its own identity would be a worker choosing which one to
        //bill.
        signedBy: function (name) {
            var vm = (imports.ours.read() || []).filter(function (v) { return v.name === name; })[0];
            return (vm && vm.guest) || null;
        },

        sessions: {
            keyFor: keying.keyFor,
            aboutWork: keying.aboutWork,
            get: store.get,
            keep: store.keep,
            MOST: makeStoring.MOST
        }
    }));
    undo.push(stopServing);

    //---- AND WHAT A CONTINUATION IS TOLD, IN FRONT OF ITS BRIEF -----------
    //
    //SAID AT THE JOIN, WHICH IS WHY THIS IS A REGISTRATION. There are two paths
    //to a worker — `vmDispatch` and `jobRun` — and the first version of this
    //warning was written into one of them, where it never once fired: a task
    //with a JOB never touches `vmDispatch`, and every task in the drill that
    //found the problem had one. ../../runners/runs asks its contributors on both
    //paths, so a warning registered here cannot go missing down one of them.
    //
    //IT ANSWERS FOR THE RUN IT IS GIVEN, NOT FOR A MACHINE. `doing` is what the
    //run IS — `{kind, id, uid, item}` — and ./keying.js refuses a judgement by
    //returning no key for one, so a judge picks nothing up and this says nothing
    //about it. That refusal stays in one place rather than being restated here.
    //
    //THROWING IS THE CALLER'S TO SWALLOW, and it does: a brief that could not be
    //annotated is still the brief, and refusing to dispatch over a note about a
    //memory folder would stop work for the sake of describing it.
    undo.push(imports.briefings.says(async function (doing) {
        var kept = await store.get(keying.keyFor(doing));
        return keying.announcement(doing, kept);
    }));

    //---- AND NOTHING CONSUMES THIS ---------------------------------------
    //
    //It provides no service. Everything it does, it does at a door somebody else
    //owns — the guest api above, `briefings` here, and the action table. What
    //used to be a `sessions` service existed for ../../runners/runs to read the
    //announcement out of, and reading it from there is exactly what put the
    //dispatcher of both lanes downstream of one of the two lanes.
    await register(null, {
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
