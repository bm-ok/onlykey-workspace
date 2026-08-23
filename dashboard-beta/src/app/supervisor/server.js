var fs = require('fs');

var makeGuestApi = require('./guestapi');
var makeTodos = require('./todos');
var makeSaid = require('./said');
//THE FENCE ITSELF, read by the pane as well as enforced by the door — see
//`supervisorMay` below for why it is the same call rather than a second list.
var allowed = require('./allowed');

//---------------------------------------------------------------------------
//THE LIST OF THINGS TO DO, as actions.
//
//Written for two callers who are not the same and must not be given the same
//door. See the head of ./todos.js for what this list is and, more usefully, what
//it is NOT — it is neither the task board nor the triage notebook.
//
//A SUPERVISOR MAY WRITE TO IT. That is the point of it existing: a decision taken
//at 3am that cannot be acted on until somebody is awake has nowhere else to go,
//and a note in the conversation is lost the moment the conversation is long. So
//it may add, change and finish.
//
//A SUPERVISOR MAY NOT DELETE. "Done" and "gone" are different claims: done is
//kept and shown, gone leaves no trace that anything was ever there. A list the
//worker can empty is a list nobody can use to check up on the worker, and that is
//the whole reason a person looks at this tab. Deleting is a person's, in the
//window, like every other irreversible thing here.
//
//THE REFUSAL SURVIVED THE MOVE UNCHANGED, WHICH WAS THE POINT OF MOVING THIS ONE
//SECOND. Over there it turns on `_overTheWire || _driven`; here it is
//`_overTheWire` alone, and that is not a weakening. `_driven` covered the window
//being worked from outside, and ../core/drive refuses to press a guarded button
//at all — the refusal moved earlier rather than being dropped. So the Remove
//button on the pane is `protected`, and both halves of the rule are real.
//---------------------------------------------------------------------------

//`provision` BECAUSE A SKILL IS A PROVISIONING FILE. It is not installed on a
//machine and never was — it is fetched from this host at the head of every turn
//and written to ~/.claude/skills/supervising/SKILL.md there, so it lives on the
//same search path as every other provisioning file and a project can replace it.
//..\vms\provision is the one thing that knows where that path is, and asking it
//is cheaper than being right about the two environment variables twice.
plugin.consumes = ['app', 'log', 'state', 'ours', 'guestApi', 'provision', 'guests'];
plugin.provides = [];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log.on('todo');

    //`actions` is absent when this half is built against a bare host — the test
    //suite does exactly that. See ../core/okc/server.js.
    if (!actions) return register(null, {});

    //IN THE HOST'S DRAWER, NOT THE WORKSPACE'S. What somebody is carrying spans
    //whatever folder they happened to be looking at — the same reasoning the app
    //being ported from gives for keeping this beside the triage notebook rather
    //than per workspace. ../core/state has both; this one is `app`.
    var todos = makeTodos(imports.state.app.doc('todo'));

    //THE REGISTER AND THE SIGN-INS, which is what "can it run" is made of. See
    //`supervisorState` below: a supervisor with no credential is not a broken
    //supervisor, it is one that exits in three seconds having asked for nothing.
    var ours = imports.ours;
    var guests = imports.guests;

    //AND THE CONVERSATION, in the host's drawer beside the list. It is host-wide
    //in the app being ported from too — a supervisor is one machine for this
    //host, not one per folder somebody happens to be looking at.
    var talk = makeSaid(imports.state.app.doc('chat'), imports.state.app.doc('chat-read'));

    //ONE SHAPE FOR EVERY ANSWER THAT RETURNS THE LIST, so the window and a model
    //are reading the same thing.
    function board() {
        var all = todos.all();
        function counted(s) { return all.filter(function (t) { return t.state === s; }).length; }
        return { todos: all, open: counted('open'), doing: counted('doing'), done: counted('done') };
    }

    var undo = [];

    undo.push(actions.define('todos', {
        about: 'The list of things to do: what is open, what is being done, and what is finished',
        run: function () {
            var now = board();
            return Object.assign({}, now, {
                states: todos.STATES,
                note: now.todos.length
                    ? null
                    : 'Nothing on the list. todoAdd puts something on it — a line saying what is to be done, and why if the line is not enough on its own.'
            });
        }
    }));

    undo.push(actions.define('todoAdd', {
        about: 'Put something on the list: what is to be done, and why',
        takes: ['what', 'why', 'state'],
        run: function (args) {
            var a = args || {};
            var by = actions.whoAsked(a);
            var one = todos.add(a.what, a.why == null ? null : a.why, a.state || 'open', by);
            log.good(one.ref + ' "' + one.what + '" — added by ' + by);
            return Object.assign({}, one, board(), { note: one.ref + ' is on the list.' });
        }
    }));

    undo.push(actions.define('todoSet', {
        about: 'Change something on the list: its wording, its reason, or what state it is in',
        takes: ['id', 'what', 'why', 'state'],
        run: function (args) {
            var a = args || {};
            var was = todos.get(a.id);
            if (!was) throw new Error('There is no todo "' + a.id + '". Ask for the list to see what there is.');

            var by = actions.whoAsked(a);
            var one = todos.edit(a.id, { what: a.what, why: a.why, state: a.state, by: by });

            //SAID ONLY WHEN IT MOVED. Rewording something is not an event worth a
            //line in the record; finishing it is, and so is picking it up.
            if (was.state !== one.state) log.good(one.ref + ' "' + one.what + '" — ' + was.state + ' to ' + one.state + ', by ' + by);
            return Object.assign({}, one, board(), { was: was.state, note: one.ref + ' is ' + one.state + '.' });
        }
    }));

    undo.push(actions.define('todoRemove', {
        about: 'Take something off the list for good. A person, in the window — a supervisor marks things done instead',
        takes: ['id'],
        run: function (args) {
            var a = args || {};

            //THE REFUSAL THAT MAKES THE LIST WORTH READING.
            //
            //Everything else here is open to both ends deliberately. This one is
            //not, because a list that the thing doing the work can empty says
            //nothing about what the work was — and "it is no longer on the list"
            //would stop meaning "it was dealt with".
            if (a._overTheWire) {
                throw new Error(
                    'Taking something off the list for good is done in the window, by a person. '
                    + 'Mark it done instead — done is kept and shown; removed leaves no trace that it was ever there.'
                );
            }

            var one = todos.remove(a.id);
            log.warn(one.ref + ' "' + one.what + '" removed');
            return Object.assign({}, one, board(), { note: one.ref + ' is gone. It was ' + one.state + '.' });
        }
    }));

    //---- the conversation --------------------------------------------------
    //
    //TWO ENDS, AND NEITHER GETS TO SAY WHICH IT IS. `chatSay` is the person's —
    //it is what the window calls, and a supervisor cannot reach it because its
    //allowlist does not name it. The machine's half is `supervisorSays`, which
    //records the machine that asked rather than anything the message claims.
    //
    //"SENT" MEANS WRITTEN DOWN, NOT DELIVERED. A supervisor is off most of the
    //time; a line here may have been read a second ago or may be waiting for a
    //machine to boot, and from this side those look identical. So the answer
    //carries how far the far end has actually read, and the note says which.
    undo.push(actions.define('chat', {
        about: 'The conversation with the supervisor: what was asked for, and what it said',
        takes: ['since'],
        run: function (args) {
            var a = args || {};
            var rows = a.since == null
                ? { messages: talk.all(), bookmark: talk.lastNumber(), missed: 0 }
                : talk.since(a.since);

            //HOW FAR THE SUPERVISOR HAS READ, so the window can show which
            //messages have actually reached it. One number rather than a field
            //per message — see ./said.js.
            var read = talk.readMark();

            //AND WHAT IT WOULD NOT SEE IF IT WOKE NOW.
            //
            //`missed` on this answer is always zero and always will be: the
            //window asks with no bookmark and is handed everything, so that
            //field describes the WINDOW's reading rather than anybody's problem.
            //The number worth showing is the other end's — asked here from the
            //same bookmark it will use, so this is a rehearsal rather than an
            //estimate. Without it, a conversation passing the trim length would
            //silently stop being readable from the far end.
            var beyond = talk.since(read.n || 0).missed || 0;

            return Object.assign({}, rows, {
                read: read,
                beyondReach: beyond,
                note: rows.messages.length
                    ? rows.messages.length + ' message(s)'
                        + (rows.missed ? ', and ' + rows.missed + ' older ones not shown' : '') + '.'
                    : 'Nothing has been said yet. Type something and the supervisor will read it next '
                        + 'time it looks.'
            });
        }
    }));

    undo.push(actions.define('chatSay', {
        about: 'Say something to the supervisor. It reads this when it next asks what is new',
        takes: ['text', 'about'],
        run: function (args) {
            var a = args || {};

            //HOW IT ARRIVED, TAKEN FROM THE CALL rather than from an argument
            //anybody could pass. A message that could claim to be from the
            //window would make the label worth nothing — which is the same rule
            //the machine's half of this record follows.
            var via = a._fromTest ? 'test' : (a._overTheWire || a._driven) ? 'cli' : 'window';
            var line = talk.say({ who: 'person', text: a.text, about: a.about || null, via: via });

            //KEPT, BECAUSE THIS IS WHERE WORK COMES FROM NOW. A task nobody wrote
            //by hand was asked for in here, and six weeks later this line is the
            //answer to "why did it do that".
            log.on('supervisor').info(
                (line.via === 'window' ? 'you' : line.via) + ' said: '
                + line.text.slice(0, 120) + (line.text.length > 120 ? '…' : '')
            );

            //IT DOES NOT WAKE ANYTHING YET, AND THE NOTE SAYS SO. `supervisorWake`
            //has not moved, so there is no "answers by itself" to honour here —
            //and a note promising an answer that cannot come is the failure this
            //whole action exists to make visible. When wake lands, the settings
            //flag and the un-awaited call belong here.
            return Object.assign({}, line, {
                woke: false,
                note: 'Said. It reads this when it next wakes.'
            });
        }
    }));

    //---- is there one, and can it actually run -----------------------------
    //
    //THREE THINGS HAVE TO BE TRUE AND THE THIRD IS THE ONE THAT IS MISSED. The
    //machine has to exist, it has to be up and dialled in, and it has to be
    //HOLDING A CLAUDE SIGN-IN. Without the third it starts, runs, exits in about
    //three seconds and reports that it asked for nothing — which from outside is
    //indistinguishable from a supervisor with nothing to do.
    //
    //So every reason it cannot run is collected and said in one sentence rather
    //than the pane showing a disabled button. "Not running" is a whole state
    //here, not a control that is greyed out.
    //
    //BY NAME AND FINGERPRINT, NEVER A VALUE. Which sign-in it is holding is the
    //same rule the Keys tab is built to: a model may know something is there
    //without being able to know what it is.
    undo.push(actions.define('supervisorState', {
        about: 'The supervisor machine: whether it is up, signed in, and able to run',
        run: async function () {
            //THE ROLE IS ASKED OF ../vms/ours RATHER THAN READ OFF THE TAGS. It
            //owns what a role means, and a second reading of a tag list here
            //would be a second definition of "supervisor" that agrees until
            //somebody changes one of them.
            var mine = (ours.read() || []).filter(function (v) { return ours.canBe(v, 'supervisor'); });

            if (!mine.length) {
                return {
                    there: false,
                    note: 'This host has no supervisor machine. Make one on the Runners tab — tick '
                        + '"supervisor machine?" when you create it.'
                };
            }

            //`vmList` FOR WHAT IT IS DOING NOW, because the register records what
            //a machine last said and VirtualBox knows whether it is switched on.
            //Asked once for all of them rather than once each.
            var live = {};
            try {
                var said = await actions.call('vmList', {});
                ((said && said.vms) || []).forEach(function (v) { live[v.name] = v; });
            } catch (e) { /* unreachable: the register is still worth reporting */ }

            var held = [];
            try { held = guests.all() || []; }
            catch (e) { /* no store yet, which reads as holding nothing */ }

            //ONE IS THE ORDINARY CASE and more than one is refused from running
            //together. Reported as a list so a host with two says so rather than
            //picking one quietly.
            var rows = mine.map(function (v) {
                var now = live[v.name] || v;
                var sign = held.filter(function (g) { return g.holder === v.name; })[0] || null;

                var why = [];
                if (now.state !== 'running') why.push('it is switched off');
                else if (!now.connected) why.push('it is starting up — it has not dialled in yet');
                if (!sign) why.push('it is holding no credential, so a worker on it cannot authenticate');

                return {
                    name: v.name,
                    state: now.state || null,
                    connected: !!now.connected,
                    signedInAs: sign ? sign.name : null,
                    fingerprint: sign ? sign.fingerprint : null,
                    ready: !why.length,
                    why: why.length ? why.join(', and ') : null
                };
            });

            var up = rows.filter(function (r) { return r.ready; })[0] || null;

            return {
                there: true,
                supervisors: rows,
                ready: !!up,
                name: up ? up.name : rows[0].name,

                //NOT PORTED YET AND SAID AS FALSE RATHER THAN LEFT OFF. It is
                //"this app has a turn running", and this app cannot start one
                //until `supervisorWake` moves — so false is the true answer here
                //and not a placeholder. The badge it drives simply never shows.
                thinking: false,

                //THE TOP-LEVEL `why` IS WHAT THE PANE LEADS WITH when nothing is
                //ready. It reads `why || note`, and a note that describes the
                //situation is worse than a sentence naming the one thing to fix.
                why: up ? null : rows[0].why,
                note: up
                    ? up.name + ' is up and signed in as "' + up.signedInAs + '". It answers when you '
                        + 'say something, if that is switched on.'
                    : rows[0].name + ' cannot run: ' + rows[0].why + '.'
            };
        }
    }));

    //---- what it is TOLD, which is the other half of the same question -----
    //
    //THE SKILL IS A DOCUMENT AND THE ALLOWLIST IS CODE, and that is why they are
    //two actions rather than one pane's worth of settings. The loop a supervisor
    //works to, the vocabulary it uses and the things it may propose are the
    //actual control surface, and until this pane existed they were a file only
    //somebody with a checkout could read.
    //
    //NOTHING IS INSTALLED ON A MACHINE. It is fetched from this host at the head
    //of every turn, so a change takes effect on the next waking — no restart, no
    //reinstall, no machine work.
    //
    //TWO NAMED DOCUMENTS, NOT "ANY FILE IN provision/". The point of this is the
    //instructions given to a model; a general file editor pointed at the
    //provisioning directory is a different and much larger thing, and it would
    //arrive without anybody deciding to build it.
    var WHICH = {
        supervisor: {
            stage: 'skill',
            title: "the supervisor's skill",
            about: 'How the supervisor works: the loop, what it may propose, what it may never do. '
                + 'Fetched fresh at the head of every turn.'
        },
        worker: {
            stage: 'workerSkill',
            title: "a worker's skill",
            about: 'What a worker is told when it runs a job on a machine that will be rolled back '
                + 'underneath it.'
        }
    };

    //`fileFor(null, stage)` — NO MACHINE, SO THE STAGE'S DEFAULT. A machine may
    //name a different file for any stage in its spec, and that is exactly what
    //should NOT happen here: this pane is about the document this host serves,
    //not about what one machine happened to be built with.
    function skillFile(stage) { return imports.provision.fileFor(null, stage); }

    function skillNamed(which) {
        var one = WHICH[String(which || 'supervisor')];
        if (!one) {
            throw new Error('"' + which + '" is not a skill this app keeps. One of: '
                + Object.keys(WHICH).join(', ') + '.');
        }
        return one;
    }

    undo.push(actions.define('skills', {
        about: 'The instructions a supervisor and a worker are given: read one in full, or list what there is',
        takes: ['which'],
        run: function (args) {
            var which = (args || {}).which || null;

            if (!which) {
                return {
                    skills: Object.keys(WHICH).map(function (key) {
                        var one = WHICH[key];
                        var at = null;
                        var bytes = null;
                        var edited = null;
                        //ABSENT IS A ROW, NOT AN ERROR. A project can replace
                        //either of these and one of them not being on the search
                        //path is a fact worth showing rather than a failure that
                        //takes the whole list down with it.
                        try {
                            at = skillFile(one.stage);
                            var stat = fs.statSync(at);
                            bytes = stat.size;
                            edited = stat.mtime.toISOString();
                        } catch (e) { /* the row says so by carrying nulls */ }

                        return {
                            which: key, title: one.title, about: one.about,
                            bytes: bytes, edited: edited, there: bytes !== null
                        };
                    }),
                    note: 'Editing one changes the next waking. It is fetched from this host at the head '
                        + 'of every turn — nothing is installed on a machine.'
                };
            }

            var one = skillNamed(which);
            var file;
            var text;
            try {
                file = skillFile(one.stage);
                text = fs.readFileSync(file, 'utf8');
            } catch (e) {
                throw new Error('Could not read ' + one.title + ': ' + e.message);
            }

            var when = null;
            try { when = fs.statSync(file).mtime.toISOString(); }
            catch (e) { /* an unreadable date is not worth losing the document over */ }

            return {
                which: String(which),
                title: one.title,
                about: one.about,
                text: text,
                characters: text.length,
                lines: text.split('\n').length,
                edited: when,
                where: file
            };
        }
    }));

    //NO `skillSave` AND NO `skillHolding`, DELIBERATELY, and the pane says so.
    //Saving is refused while a window holds unsaved edits, and that handshake is
    //the whole point of it — a save action without it is a save that silently
    //overwrites whoever is typing. Half of that is worse than none of it.
    //
    //THE SUPERVISOR COULD NOT CALL EITHER ANYWAY: neither name is in
    //./allowed.js, which is where "it may not rewrite its own instructions"
    //actually lives.

    //---- and what it may ask for, which is the fence made readable ---------
    //
    //ONE SOURCE, READ TWICE, AND THAT IS THE WHOLE VALUE OF IT. `allowed.list()`
    //is what the supervisor is handed when it asks what it may do; this hands the
    //same call's answer to the pane. So "what the supervisor was told" and "what
    //the person is shown" cannot drift, because there is nothing to keep in step
    //— a second list assembled here would be a permission list that agrees with
    //the real one only until somebody edits one of them.
    //
    //NO WRITE, AND THE ANSWER SAYS SO rather than leaving somebody hunting for
    //the button. A permission list anything reaching this app could edit is not a
    //permission list, and a supervisor able to widen its own is not supervised.
    //It changes in a checkout, in a commit, with a message.
    undo.push(actions.define('supervisorMay', {
        about: 'Every action the supervisor may call, and the reason each one is on the list',
        run: function () {
            //`action`, NOT `what`. ./allowed.js answers a MACHINE, which asks
            //"what may I do"; the pane is a table of actions. Renamed at this
            //edge rather than in ./allowed.js, because changing the shape there
            //would change what a supervisor reads to suit a pane.
            var rows = allowed.list().map(function (r) {
                return { action: r.what, why: r.why };
            });

            return {
                may: rows,
                count: rows.length,
                where: 'supervisor/allowed.js',
                note: 'Read only. A permission list that anything reaching this app could edit is not a '
                    + 'permission list — this changes in a checkout, in a commit, with a message. The '
                    + 'reasons are what the supervisor is shown when it asks what it may do.'
            };
        }
    }));

    //---- the only door a supervisor has into this host ---------------------
    //
    //REGISTERED WITH ../vms/https RATHER THAN SERVED HERE, which owns the
    //certificate and has proved which machine is asking. What is this plugin's
    //is the two verbs and ./allowed.js — the fence that counts.
    var stopServing = imports.guestApi.api(makeGuestApi({
        ours: imports.ours,
        say: imports.log.on,

        //THE SAME `call` EVERY OTHER CALLER USES, so every refusal, every
        //workspace gate and every record still applies. ./allowed.js decides
        //WHETHER, never HOW.
        call: function (what, args) { return actions.call(what, args); },

        //WHAT EACH VERB TAKES, so a supervisor is not guessing argument names at
        //the same time as choosing a verb. `all()` rather than `list()`: most of
        //these are still answered by the app being ported from, and this app's
        //own half of the table does not know them yet.
        catalogue: async function () { return (await actions.all()).actions || []; }
    }));

    await register(null, {
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
