var path = require('path');

var keying = require('./keying');
var looking = require('./looking');
var makeStoring = require('./storing');
var makeGuestApi = require('./guestapi');

//../runs OWNS THE TWO GATES, and this asks the same two. Both are under
//../, the same way ../../repositories/repos reaches ../branches — a rule
//that decides who may ask something of a machine is one rule, and a second copy
//of it here is how the two come to disagree about a machine that is off.
var makeAsking = require('../runs/asking');

//---------------------------------------------------------------------------
//WHAT A WORKER SAID, AND WHAT IT KEEPS BETWEEN MACHINES.
//
//TWO DIFFERENT THINGS UNDER ONE NAME, and they are worth separating before
//reading further:
//
//  a session ON a machine     the transcript Claude is writing right now, in
//                             the guest's own `~/.claude`. Read live, over the
//                             channel, as a DELTA with a bookmark. Nothing here
//                             stores it.
//  a session KEPT here        the archive of that folder, handed back at the end
//                             of a run and filed by SUBJECT so the next piece of
//                             work on the same branch picks the conversation up.
//
//The first is what `vmSessions` and `vmSessionTail` read. The second is what
//./storing.js keeps and ./keying.js decides the shape of.
//
//---- and what a continuation is TOLD --------------------------------------
//
//./keying.js's `announcement`, which is the reason this plugin blocks the two
//dispatch actions rather than merely accompanying them. A worker handed a
//conversation from a different piece of work is a worker still obeying
//instructions that ended with that work — measured, not supposed. It has to be
//said at the one place both paths to a worker pass through, and that is here.
//---------------------------------------------------------------------------

//`whatIsOn` and `guestApi` ARE FOR THE GUEST DOOR ONLY — ./guestapi.js. This is
//`whatIsOn`'s second reader, and the reason it is a plugin of its own rather
//than something the queue keeps: the machine asking here may be running a task
//or a judgement, and only the join between the two boards can say which.
plugin.consumes = ['app', 'log', 'ours', 'channel', 'dispatch', 'state', 'archive',
    'whatIsOn', 'guestApi'];
plugin.provides = ['sessions'];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;

    var channel = imports.channel;
    var dispatch = imports.dispatch;
    var archive = imports.archive;

    var asking = makeAsking({
        ours: imports.ours,
        connected: channel.connected
    });

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
        //---- THE SESSIONS ON A MACHINE, RIGHT NOW -------------------------
        undo.push(actions.define('vmSessions', {
            about: 'The Claude sessions on a machine, newest first',
            takes: ['name'],
            run: async function (args) {
                var name = (args || {}).name;
                asking.reachable(name, 'its sessions cannot be read');

                var r = await channel.run(name, dispatch.sessionCommand('list'),
                    { what: 'reading its claude sessions', timeout: 60000 });
                return dispatch.sessionAnswer(r.output);
            }
        }));

        //---- WHAT ONE HAS DONE SINCE YOU LAST LOOKED ----------------------
        //
        //A DELTA, AND THE BOOKMARK IS THE POINT. `since` is a line number in the
        //transcript and comes back as `bookmark`; pass it in next time. A
        //watcher that re-reads from the top spends its whole context
        //re-deriving what it already reported, which for a task running an hour
        //is most of it.
        //
        //Only what is worth reporting: what it ran, what it wrote, what it was
        //asked, and the lines of a result that carry a verdict. A tool result is
        //tens of kilobytes and almost none of it is news.
        undo.push(actions.define('vmSessionTail', {
            about: "What a machine's Claude session has done since a bookmark",
            takes: ['name', 'session', 'since', 'limit'],
            run: async function (args) {
                var a = args || {};
                asking.reachable(a.name, 'its session cannot be read');

                var which = a.session == null ? '' : String(a.session);
                var since = a.since == null ? 0 : Number(a.since);
                var limit = a.limit == null ? 40 : Number(a.limit);

                var r = await channel.run(a.name, dispatch.sessionCommand('tail', [which, since, limit]),
                    { what: 'reading its session', timeout: 120000 });
                var out = dispatch.sessionAnswer(r.output);

                //THE REFUSAL NAMES WHAT IT COULD HAVE READ INSTEAD. Asking for a
                //session that is not there is nearly always a stale id, and the
                //list is the answer to the question behind the mistake.
                if (!out.ok) {
                    throw new Error(out.error + (out.sessions
                        ? ' — ' + out.sessions.map(function (s) {
                            return String(s.id).slice(0, 8) + ' (' + (s.title || 'untitled') + ')';
                        }).join(', ')
                        : ''));
                }
                return out;
            }
        }));
    }

    if (actions) {
        //---- WHAT IS KEPT, AND WHOSE IT IS --------------------------------
        //
        //A SESSION OUTLIVES THE TASK IT BELONGS TO, deliberately: a task that
        //was thrown away leaves its transcript behind, because what a worker did
        //is worth reading after somebody decides the work was not. So this joins
        //two lists and the join is allowed to fail on one side — an orphan is a
        //row, not a gap.
        //
        //THE BOARD IS ASKED FOR BY NAME rather than consumed. ../../../queue
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

    await register(null, {
        sessions: {
            //---- where a conversation is filed, and what it is told --------
            keyFor: keying.keyFor,
            aboutWork: keying.aboutWork,
            remembers: keying.remembers,

            //ASKED WITH WHAT IS KEPT, rather than reaching for it itself, so the
            //one caller that already has the record does not read it twice — and
            //so this stays testable without a disk. See ./keying.js.
            announcement: keying.announcement,

            //---- and what is kept -----------------------------------------
            keep: store.keep,
            get: store.get,
            has: store.has,
            forget: store.forget,
            everything: store.everything,

            //---- for whatever needs one on its own -------------------------
            inspect: inspect,
            MOST: makeStoring.MOST
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
