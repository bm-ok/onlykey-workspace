var fs = require('fs');

var makeGuestApi = require('./guestapi');
var makeTodos = require('./todos');
var makeSaid = require('./said');
var makeCarrying = require('./carrying');
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
plugin.consumes = ['app', 'log', 'state', 'ours', 'guestApi', 'provision', 'guests', 'channel', 'dispatch'];
plugin.provides = [];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    //TWO WAYS IN, AND THE DIFFERENCE IS NOT STYLE. `log` is scoped to 'todo' for
    //the list below; `say` is UNSCOPED, because `.on` APPENDS.
    //
    //This file was the todo list once and is now the whole tab, so every
    //supervisor line went out tagged `todo,supervisor,<machine>` — a waking, a
    //turn that did nothing, a machine being started, all filed under a list they
    //have nothing to do with. Found by reading the log of the first real wake,
    //which is the only place it shows.
    var log = imports.log.on('todo');
    var say = imports.log.on;

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
    var talk = makeSaid(imports.state.app.doc('chat'), imports.state.app.doc('chat-read'),
        imports.state.app.doc('chat-from'));

    //AND THE NOTEBOOK, in the host's drawer for the reason ./carrying.js gives:
    //a supervisor's train of thought spans whatever folder it was looking at.
    var notebook = makeCarrying(imports.state.app.doc('triage'));

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

            //AND WHERE THE PERSON IS READING FROM, which is not where the
            //supervisor has read TO. Both are pointers into this one list and
            //they mean opposite things — see ./said.js. The window does the
            //hiding, because everything is still here: this says where.
            var from = talk.fromMark();

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
                from: from,
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
            say('supervisor').info(
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

    //---- start reading from here -------------------------------------------
    //
    //WHAT "CLEAR" SHOULD HAVE BEEN, and the button says Clear because that is
    //what somebody reaches for when a screen is long. Nothing is deleted: the
    //bookmark moves and everything before it stops being drawn. Ask with n 0 to
    //take it back.
    //
    //A CONVERSATION WITH A SUPERVISOR IS THE RECORD OF WHY WORK EXISTS — what
    //was asked for, what it decided, what it was told. Throwing that away to
    //tidy a screen is a trade nobody would make twice, and it cannot be undone.
    //
    //THIS APP HAD NO SUCH ACTION AND ITS BUTTON CALLED `chatClear`, which is not
    //defined here — so it relayed, and the thing it would have emptied is the
    //conversation in the app being ported FROM, the one app nothing here may
    //write to. A destructive action that is missing does not refuse; it travels.
    undo.push(actions.define('chatFrom', {
        about: 'Start reading from here: hide what came before without deleting any of it',
        takes: ['n'],
        run: function (args) {
            var a = args || {};
            //NO ARGUMENT MEANS "FROM NOW", which is the ordinary press.
            var at = a.n === undefined || a.n === null || a.n === ''
                ? talk.lastNumber()
                : Number(a.n);
            var by = a._fromMachine || (a._overTheWire ? 'the command line'
                : a._fromTest ? 'a drill' : 'the window');
            var set = talk.markFrom(at, by);

            return Object.assign({}, set, {
                of: talk.lastNumber(),
                note: set.n
                    ? 'Reading from message ' + (set.n + 1) + ' on. Nothing was deleted — ask for '
                        + 'chatFrom with n 0 to see all of it again.'
                    : 'Showing the whole conversation again.'
            });
        }
    }));

    //THE DESTRUCTIVE ONE, AND IT IS HERE TO SHADOW THE RELAY.
    //
    //An action this app does not define is not refused. `actions.call` tries
    //this table and then the pipe to the app being ported from — so while
    //`chatClear` was missing here, every way of asking for it, the window's own
    //Clear button included, emptied the REAL conversation over there: the one
    //app nothing here may write to, and the only copy of what a person asked a
    //supervisor for. Nothing said so, because a relay is what is SUPPOSED to
    //happen to an action that has not been ported yet. Defining it is what makes
    //asking for it land on this app's own record.
    //
    //AND WHAT IT LANDS ON IS A REFUSAL, from everywhere except a person at the
    //window — where there is deliberately no button, because `chatFrom` is what
    //somebody tidying a screen actually wants and it deletes nothing. So this is
    //an action that exists in order to say no, and the sentence it says no with
    //is the useful half.
    undo.push(actions.define('chatClear', {
        about: 'Throw the whole conversation away. Refused: chatFrom hides it instead, and deletes nothing',
        run: function (args) {
            var a = args || {};
            if (a._overTheWire || a._driven || a._fromMachine || a._fromTest) {
                throw new Error(
                    'Throwing the conversation away is not done from here. It is the record of what was '
                    + 'asked for and why work exists, and there is nowhere to get it back from. Use '
                    + 'chatFrom to start reading from a point instead — nothing is deleted and chatFrom '
                    + 'with n 0 shows all of it again.'
                );
            }
            var n = talk.clear();
            say('supervisor').warn('the conversation was thrown away');
            return {
                cleared: n,
                note: n + ' message(s) gone. What was DONE is still in the event stream; this was only '
                    + 'what was said about it.'
            };
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

    //---- THE MACHINE'S END OF THE SAME CONVERSATION ------------------------
    //
    //THIS IS HOW A SUPERVISOR ANSWERS YOU, and until it existed a supervisor
    //could think and could not speak. The first successful wake on this app read
    //the board — tasks, todos, branchBoard, judging, prCuts, repositories —
    //formed an answer, called this, and was refused: "Nothing here answers
    //supervisorSays". From the Chat tab that is indistinguishable from a model
    //that ignored you, which is the exact failure `asksSoFar` was ported to make
    //visible and which this one had reintroduced one layer up.
    //
    //WHICH MACHINE, TAKEN FROM THE CALL AND NEVER FROM THE MESSAGE. ./guestapi.js
    //strips every `_` key off what the machine sent and then stamps
    //`_fromMachine` from the TOKEN that authenticated the request — so a
    //supervisor cannot sign a message as another machine, and cannot sign one as
    //a person. The one question this record has to answer six weeks later is who
    //asked for a thing.
    //
    //AND IT IS THE ONLY WAY IN FOR A MACHINE. `chatSay` is the person's and is
    //not on ./allowed.js, so the two ends cannot be confused even by a
    //supervisor that wanted to.
    undo.push(actions.define('supervisorSays', {
        about: 'The supervisor saying something to the person',
        takes: ['text', 'about'],
        run: function (args) {
            var a = args || {};
            var line = talk.say({
                who: 'supervisor',
                text: a.text,
                about: a.about || null,
                from: a._fromMachine || null,
                via: 'wire'
            });

            say('supervisor', a._fromMachine || undefined).info(
                'it said: ' + line.text.slice(0, 120) + (line.text.length > 120 ? '…' : '')
            );

            return Object.assign({}, line, { note: 'Said. It is on the Chat tab now.' });
        }
    }));

    //---- WHAT IT IS IN THE MIDDLE OF, AND WHAT BECAME OF IT ----------------
    //
    //THE NOTEBOOK HOLDS THE INTENT; THE STORES HOLD THE TRUTH. An entry says "I
    //asked J5 to check this and I am waiting"; whether J5 has finished is a fact
    //about the judgement, read from the judgement. Writing "waiting" and then
    //believing it later is how a supervisor waits for something that finished an
    //hour ago — so every entry is resolved against what is actually there.
    //
    //THAT IS THE MOST USEFUL THING THIS DOES. "You asked and it is still
    //running" and "you asked and the answer is sitting there" are the two states
    //a supervisor cannot tell apart from its own notes, and they want opposite
    //responses.
    //
    //ASKED OF THE TABLE, NOT OF A SERVICE. `judging` and `tasks` are actions
    //this app already answers, and going through them keeps this plugin from
    //growing an edge into the judge and the queue to read two lists.
    async function whereIsIt(about) {
        var what = String(about == null ? '' : about).trim();

        //A BARE NUMBER MEANS A TASK, and that is the only shape decided here: a
        //judgement's number is written J5 and never 5. Everything else is asked
        //of both stores by whatever it is called, because a supervisor writes
        //down the name it was just handed — it asked for a judgement, got back
        //an id like "judge-survey-codebase-1", and wrote THAT. A resolver that
        //only understood "J5" answered "this is just a note" about the one thing
        //it was actually waiting for.
        var looksLikeATask = /^#?\d+$/.test(what);

        if (!looksLikeATask) {
            try {
                var seen = ((await actions.call('judging', {})) || {}).judgements || [];
                var j = seen.filter(function (x) {
                    return x.ref === what || x.id === what || x.uid === what;
                })[0];

                if (j) {
                    return {
                        kind: 'judgement',
                        state: j.state,
                        //FINISHED IS THE ONE THAT MATTERS. It is the moment the
                        //thing being waited on became an answer, and the moment
                        //to stop waiting and go and read it.
                        landed: j.state === 'done',
                        concluded: j.concluded || j.verdict || null,
                        reads: j.reads || (j.subject && j.subject.name) || null,
                        how: j.state === 'done'
                            ? (j.ref || what) + ' has finished — read it with judgementFindings'
                            : (j.ref || what) + ' is ' + j.state
                    };
                }
                //NOT A JUDGEMENT IS NOT THE SAME AS A JUDGEMENT THAT IS GONE.
                //Anything can be written in this notebook — an issue, a line, a
                //sentence — so finding none falls through to the note below
                //rather than reporting a thing that never existed as vanished.
            } catch (e) { /* the same fall-through */ }
        }

        if (looksLikeATask) {
            try {
                var board = ((await actions.call('tasks', {})) || {}).tasks || [];
                var want = what.replace(/^#/, '');
                var t = board.filter(function (x) {
                    return String(x.number) === want || x.id === want || x.uid === want;
                })[0];

                if (!t) {
                    return { kind: 'task', state: 'gone', landed: false, how: what + ' is not on the board any more' };
                }

                return {
                    kind: 'task',
                    state: t.state,
                    landed: t.state === 'done',
                    //NOT "IT WORKED". A task finishing means the machine stopped,
                    //and whether anything was actually done is a judge's answer.
                    how: t.state === 'done'
                        ? '#' + t.number + ' has finished — judge the line to find out whether it did what was asked'
                        : '#' + t.number + ' is ' + t.state
                };
            } catch (e) {
                return { kind: 'task', state: 'gone', landed: false, how: what + ' could not be looked up' };
            }
        }

        //An issue, a line, a repository, a sentence. Nothing to resolve it
        //against, and that is fine: it is the supervisor's own note about its
        //own thinking.
        return { kind: 'note', state: null, landed: false, how: null };
    }

    undo.push(actions.define('triage', {
        about: 'What the supervisor is in the middle of, and which of those things have finished since',
        takes: ['about'],
        run: async function (args) {
            var a = args || {};
            var want = a.about == null ? null : String(a.about).trim();

            var rows = [];
            var kept = notebook.all().filter(function (r) { return !want || r.about === want; });
            for (var i = 0; i < kept.length; i++) {
                rows.push(Object.assign({}, kept[i], { now: await whereIsIt(kept[i].about) }));
            }

            //WHAT IT WAS WAITING FOR AND IS NOW READY, pulled out rather than
            //left to be spotted. This is the whole reason the notebook is
            //resolved against the stores instead of being believed.
            var ready = rows.filter(function (r) {
                return r.now.landed && /wait/i.test(r.state || '');
            });

            return {
                carrying: rows,
                ready: ready.map(function (r) {
                    return { about: r.about, was: r.state, now: r.now.how };
                }),
                note: rows.length
                    ? (ready.length
                        ? ready.length + ' of ' + rows.length + ' finished while you were away — read those '
                            + 'first, then say what you are doing about them.'
                        : rows.length + ' thing(s) in hand, none of them finished since.')
                    : 'Nothing in hand. Write one down when you ask for something and will not get the '
                        + 'answer in this waking.',
                states: notebook.USUAL
            };
        }
    }));

    undo.push(actions.define('triageSet', {
        about: 'Write down what you are in the middle of: what it is about, what state it is in, and why',
        takes: ['about', 'state', 'note'],
        run: async function (args) {
            var a = args || {};
            var row = notebook.set({
                about: a.about,
                state: a.state,
                note: a.note,
                //WHO IS CARRYING IT. Almost always the supervisor, and worth
                //recording because a person can write one too — an entry with no
                //author reads as the app's own opinion, which it never is.
                by: a._fromMachine || (a._overTheWire ? 'the command line'
                    : a._fromTest ? 'a drill' : 'the window')
            });

            say('supervisor').info('triage: ' + row.about + ' — ' + row.state);
            return Object.assign({}, row, { now: await whereIsIt(row.about) });
        }
    }));

    undo.push(actions.define('triageForget', {
        about: 'Stop carrying something. Nothing about the task or judgement itself is touched',
        takes: ['about'],
        run: function (args) { return notebook.forget((args || {}).about); }
    }));

    //---- WHAT HAPPENED WHILE IT WAS AWAY, IN ONE CALL ----------------------
    //
    //A SUPERVISOR THINKS IN BURSTS: it wakes, reads, decides, does something and
    //stops. Everything it needs on waking is "what is different since last
    //time", and that spans several records — what was said to it, what the queue
    //finished, what this host did.
    //
    //ONE BOOKMARK, WHICH IS THE POINT. Four calls would be four bookmarks and a
    //model keeping all four correctly across a restart; this takes one number
    //and hands back the next. Nothing here goes to the network.
    undo.push(actions.define('whatsNew', {
        about: 'Everything that changed since a bookmark: what was said, what finished, what is waiting',
        takes: ['since', 'events'],
        run: async function (args) {
            var a = args || {};

            //---- NEVER LESS THAN WHAT IT HAS NOT ANSWERED ----------------
            //
            //THIS ACTION USED TO ERASE WHAT IT RETURNED. It marks read on the
            //way out, and the skill tells a supervisor to keep the bookmark and
            //pass it — so the FIRST call in a turn returned the message and moved
            //the mark, and the SECOND call, made with that fresh bookmark,
            //returned an empty conversation. It is called two to four times a
            //turn, every turn.
            //
            //Four messages in a row were read and answered with "nothing to do",
            //including one that said "you have twice not answered me". The
            //bookmark proved they were delivered; the second look is what decided
            //the reply. From outside it was indistinguishable from a model
            //ignoring somebody, and that is where two hours went.
            //
            //SO THE FLOOR IS THE LAST THING THE SUPERVISOR ITSELF SAID.
            //Everything after that is by definition something it has not replied
            //to, and no bookmark it can pass will hide it. Asking twice in one
            //turn gives the same answer twice, which is what "what is new" has to
            //mean if a model may ask it more than once.
            var spoke = talk.all()
                .filter(function (m) { return m.who === 'supervisor'; })
                .map(function (m) { return Number(m.n); });
            var lastSaid = spoke.length ? Math.max.apply(null, spoke) : 0;
            var asked = a.since == null ? 0 : (Number(a.since) || 0);

            //A BUDGET, BECAUSE THE READING END HAS ONE. This is answered into a
            //tool result on a machine, and an answer too large to accept does not
            //arrive — which is not a smaller version of arriving, it is the
            //supervisor going blind to everything said to it. The conversation
            //was once 81% of a 102,000-character reply.
            var said = talk.since(Math.min(asked, lastSaid), { bytes: 20000 });

            //THE RECEIPT, WRITTEN HERE BECAUSE HERE IS WHERE THE WORDS ARRIVE.
            //Not when the message was stored, which says only that this host took
            //it, and not when the supervisor replies, which may never happen — a
            //supervisor that reads something and decides to do nothing has still
            //read it. From the person's side this is the difference between "it
            //has not looked yet" and "it looked and said nothing".
            if (said.messages.length) talk.markRead(said.bookmark, a._fromMachine || null);

            //THE BOARD AS IT STANDS, rather than a diff of it. A supervisor
            //deciding what to do next needs the state, and the state is small.
            var board = [];
            try {
                var got = await actions.call('tasks', {});
                board = (got && got.tasks) || [];
            } catch (e) { /* the note below says what could not be read */ }

            function inState(s) { return board.filter(function (t) { return t.state === s; }); }
            var finished = board.filter(function (t) { return t.state === 'done' && !t.verdict; });

            var cuts = 0;
            var unsent = [];
            try {
                var cutRows = ((await actions.call('prCuts', {})) || {}).cuts || [];
                cuts = cutRows.length;

                //NOT ONE THAT HAS ALREADY BEEN CUT. The text was written for that
                //cut and the cut exists; listing it as outstanding is asking for
                //the same thing twice.
                var already = {};
                cutRows.forEach(function (c) { already[c.source + ' -> ' + c.target] = true; });

                //A DRAFT IS ITS OWN UNFINISHED WORK AND IT COULD NOT SEE IT.
                //Writing one is on its list and reading them back was not, so a
                //supervisor that wrote a draft, went to sleep and woke had no way
                //of learning it had one — `cuts` counts what has already GONE.
                //The consequence was a change sitting drafted and unsent with
                //nothing wrong with it, and its skill says in as many words "do
                //not stop at the draft and ask".
                ((await actions.call('prDrafts', {})) || {}).drafts?.forEach(function (d) {
                    if (!already[d.source + ' -> ' + d.target]) {
                        unsent.push({ source: d.source, target: d.target, title: d.title || null, at: d.at || null });
                    }
                });
            } catch (e) { /* named in `notRead` below */ }

            var machines = 0;
            try { machines = (ours.read() || []).length; } catch (e) { /* none */ }

            var out = {
                said: said.messages,
                bookmark: said.bookmark,
                //HOW MANY WERE NOT SENT, which now has two reasons to be
                //non-zero: too many messages, or too much text. Either way it is
                //the difference between "nobody said anything" and "you were not
                //shown it", and only one of those is a reason to ask again.
                missed: said.missed,
                saidNote: said.missed
                    ? said.missed + ' earlier message(s) are not in this answer — the newest that fit are. '
                        + 'Ask "chat" for the whole conversation if what you need is older than this.'
                    : null,

                tasks: {
                    queued: inState('queued').map(function (t) {
                        return { id: t.id, number: t.number, title: t.title, branch: t.branch, tag: t.tag || null };
                    }),
                    running: inState('given').map(function (t) {
                        return { id: t.id, number: t.number, title: t.title, machine: t.machine };
                    }),
                    //THE ONES WORTH ITS ATTENTION: finished, and nobody has
                    //judged them.
                    waitingOnAVerdict: finished.map(function (t) {
                        return { id: t.id, number: t.number, title: t.title, branch: t.branch };
                    })
                },

                machines: machines,
                cuts: cuts,
                unsent: unsent,

                //---- AND WHAT THIS APP CANNOT TELL IT YET -----------------
                //
                //`arrived` IS MISSING AND IS NAMED RATHER THAN OMITTED. Over
                //there it carries what the GitHub watcher last saw — an issue
                //somebody filed, a pull request somebody proposed — which are the
                //only two things here that turn up on their own. That watcher has
                //not been ported.
                //
                //IT MATTERS MORE THAN THE OTHER GAPS ON THIS ANSWER. A supervisor
                //CAN ask (`issues` and `pulls` are on its list) but is never told
                //there is anything to ask ABOUT — so it wakes, sees nothing new,
                //and goes back to sleep with an open issue sitting there. That
                //happened over there, which is why the field exists at all.
                //
                //SAID IN THE ANSWER, so a model reads it rather than inferring
                //silence. An empty `arrived` would be a claim that nothing has
                //arrived.
                arrived: null,
                notRead: ['arrived — nothing here watches GitHub yet, so ask `issues` and `pulls` directly']
            };

            //AND WHAT THIS HOST DID, when asked for. Off by default because it is
            //the long half and a supervisor mostly wants the short one.
            if (a.events !== false && a.events !== 'false') {
                try {
                    var happened = ((await actions.call('events', { limit: 60 })) || {}).events || [];
                    out.happened = happened.map(function (e) {
                        return { at: e.at, level: e.level, tags: e.tags, text: e.text };
                    });
                } catch (e) { out.notRead.push('happened — the event stream would not answer'); }
            }

            out.note = said.messages.length
                ? said.messages.length + ' thing(s) said to you. Ask again with since=' + out.bookmark + '.'
                : 'Nothing said since ' + (a.since == null ? 'ever' : a.since)
                    + '. Ask again with since=' + out.bookmark + '.';

            return out;
        }
    }));

    //---- waking it, which is the only thing here that spends anything ------
    //
    //ONE TURN AT A TIME, ACROSS EVERYTHING THAT MIGHT ASK. A chat message, a task
    //finishing and somebody pressing the button are three doors into the same
    //model, and two turns at once on one machine is two things deciding — which
    //is the fault the one-supervisor rule exists to prevent, arriving from
    //inside instead of from outside.
    //
    //A FLAG IN MEMORY RATHER THAN ON DISK, deliberately: it is about THIS process
    //having a child running, and a restart genuinely does end that.
    var thinking = false;

    //AND WHAT HAPPENED WHILE IT WAS THINKING IS NOT DROPPED.
    //
    //Refusing a second turn is right and was the whole of it — so anything that
    //happened mid-turn was simply lost: a task finishing thirty seconds into a
    //turn woke nothing, and the supervisor found out whenever somebody next
    //spoke to it. That is the difference between a supervisor that watches and
    //one that is polled by hand.
    //
    //ONE PENDING WAKE, NOT A QUEUE OF THEM. Waking is "go and read what
    //changed", and three in a row would read the same thing three times: what is
    //worth keeping is THAT something happened, not how many times.
    var pending = null;
    function alsoWake(why) { pending = pending ? (pending + '; ' + why) : why; }

    //WHAT IT IS TOLD WHEN IT WAKES. Deliberately short: the skill on the machine
    //is what knows the loop, and repeating it here would be a second copy that
    //goes stale.
    var WAKE = 'Wake. Use the supervising skill: call whatsNew, read what changed, '
        + 'do what needs doing if anything does, and reply to the person with supervisorSays. '
        + 'One message, two or three sentences. If there is nothing to do, say that instead.';

    undo.push(actions.define('supervisorWake', {
        about: 'Wake the supervisor: one turn of its model, reading what changed and answering',
        takes: ['name', 'why'],
        run: async function (args) {
            var a = args || {};

            if (thinking) {
                //KEPT, NOT DROPPED. It goes again when this turn ends — once,
                //however many things happened while it was busy.
                alsoWake(a.why || 'something happened while it was thinking');
                return {
                    woke: false, pending: true,
                    why: 'it is already thinking. One turn at a time — two would be two things '
                        + 'deciding, which is the thing the one-supervisor rule exists to prevent. '
                        + 'It will look again when this turn ends.'
                };
            }

            //WHICH MACHINE IS ../../runners/guests's ANSWER — the same one the
            //sign-in desk uses. Not decided here: "which supervisor" is a
            //decision, and a second copy of it drifts.
            var on = guests.whichSupervisor(a.name);

            //STARTED IF IT IS DOWN, and that is this caller's step rather than
            //something folded into the pick — starting a machine is a minute of
            //waiting, and a function that sometimes does it is one nobody can
            //predict the cost of.
            if (!imports.channel.connected(on)) {
                say('vm', on).info('starting it — something wants the supervisor');
                await actions.call('vmStart', { name: on });
                await actions.call('vmAwait', { name: on, for: 'connected', seconds: 240 });
                say('vm', on).good('it is up');
            }

            //AND IT CAN ACTUALLY THINK BEFORE IT IS ASKED TO.
            //
            //Dialling in signs a supervisor in, which covers every ordinary
            //route — but a wake that STARTED the machine is racing that, and a
            //wake that found it already up has no dial-in to have caught it.
            //Both end the same way without this: the model runs, hits a sign-in
            //menu, exits in three seconds, and the record says it asked for
            //nothing.
            //
            //NOT FATAL. With no sign-in to give, the turn still runs and still
            //fails — and it fails saying so, which is better than this refusing
            //on its behalf.
            try {
                var put = await actions.call('supervisorSignIn', { name: on });
                if (put && put.did) {
                    say('supervisor', on).info('it had no sign-in when it was woken — given one before the turn');
                }
            } catch (e) {
                say('supervisor', on).warn('could not check its sign-in before waking it: ' + e.message);
            }

            thinking = true;
            var began = Date.now();
            say('supervisor', on).info(a.why ? ('waking it — ' + a.why) : 'waking it');

            try {
                //TAKEN BEFORE THE TURN STARTS, so what is compared afterwards is
                //what THIS turn asked for. A count rather than a flag, because
                //two turns can overlap on a busy host and a flag would be reset
                //by whichever finished first.
                var askedBefore = allowed.asksSoFar();

                //THE PROMPT GOES OVER AS BASE64. It is prose with apostrophes in
                //it, heading for a `bash -c` inside an ssh command.
                var brief = Buffer.from(WAKE, 'utf8').toString('base64');

                //THE SKILL IS RE-FETCHED EVERY TIME IT WAKES, and that is not
                //tidiness. The skill on the machine is what knows the loop, and
                //it is fetched once during provisioning — so a machine built
                //before the loop changed goes on supervising by the old one for
                //ever. The day judging arrived, the supervisor on this host was
                //still being told to read an action it is no longer allowed to
                //call.
                //
                //WHERE THIS HOST LISTENS COMES FROM THIS HOST. The first version
                //of this read `$OKC_BASE` out of the agent's env file, which
                //holds the machine's name, its token and the authority — and not
                //the base. It failed with "No host part in the URL", and would
                //have failed silently for ever behind the `|| true`.
                var where = null;
                try {
                    var at = await actions.call('vmHostAddress', {});
                    //THE PORT COMES FROM THE PLUGIN THAT LISTENS ON IT. A
                    //number written here is a number that is right until
                    //../vms/https moves, and the failure would be a fetch that
                    //quietly does nothing behind its own `|| true`.
                    var host = at && at.address;
                    if (host) where = 'https://' + host + ':' + imports.guestApi.PORT;
                } catch (e) { /* no address means no refresh, and the turn still happens */ }

                var refresh = where
                    ? 'mkdir -p "$HOME/.claude/skills/supervising" && '
                        + 'eval "$(sudo -n cat /etc/okc-agent.env | grep -E \'^OKC_(VM|TOKEN|CA)=\')" && '
                        + 'curl -fsS --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" '
                        + '-o "$HOME/.claude/skills/supervising/SKILL.md" '
                        + '"' + where + '/provision/supervisor-skill.md?vm=$OKC_VM" '
                        + '&& echo okc-skill-refreshed || echo okc-skill-stale'
                    : 'echo okc-skill-stale';

                //THE SHELL IS BUILT IN ../vms/dispatch AND CHECKED THERE. What
                //reaches a machine is shell, and shell assembled inside an action
                //is shell nothing can render without waking a supervisor to see
                //it — which is how a `continue` outside a loop and a
                //self-matching `pkill` both got as far as a guest in this
                //project.
                var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
                var said = await imports.channel.run(on,
                    imports.dispatch.supervisorTurn({ stamp: stamp, brief: brief, refresh: refresh }),
                    { what: 'one turn of the supervisor', timeout: 660000 });

                if (/okc-skill-stale/.test(said.output || '')) {
                    say('supervisor', on).warn('it could not refresh the supervising skill, so it took its '
                        + 'turn on whatever copy it already had');
                }

                var took = Math.round((Date.now() - began) / 1000);

                //---- DID ANYTHING ACTUALLY HAPPEN? -------------------------
                //
                //A turn that ends normally having asked this host for nothing
                //did nothing, whatever it printed. The commonest cause is a
                //machine that cannot run a model at all — no credential, a
                //launcher that is gone, a machine that came up wrong — and every
                //one of those ends in seconds and leaves every panel looking
                //exactly as it did.
                //
                //SAID IN THE CHAT, not only in the log, because the chat is where
                //somebody is waiting. A message that is never answered is the
                //exact shape of this failure, so the answer goes where the
                //question is.
                var used = allowed.asksSoFar() - askedBefore;
                if (!used) {
                    say('supervisor', on).bad('it woke and asked for nothing in ' + took
                        + 's — it cannot use this app, so nothing was done');

                    //AND WHAT IT SAID BEFORE IT STOPPED. A turn that asked for
                    //nothing has a reason and the reason is in its transcript.
                    //Best effort and short: the failure being diagnosed may well
                    //be the machine itself, so this must not become a second
                    //thing that hangs.
                    try {
                        var tail = await imports.channel.run(on,
                            'tail -c 1200 ' + imports.dispatch.SUPERVISOR + '/current.log 2>/dev/null || true',
                            { what: 'reading why the turn did nothing', timeout: 20000, quiet: true });
                        var words = String(tail.output || '').trim();
                        if (words) say('supervisor', on).info('the end of its transcript: ' + words.slice(-600));
                    } catch (e) {
                        say('supervisor', on).warn('could not read its transcript: ' + e.message);
                    }

                    try {
                        talk.say({
                            who: 'supervisor', from: on, via: 'wire', about: 'it could not run',
                            text: 'I woke and stopped after ' + took + 's without asking this host for '
                                + 'anything, so nothing was done.\n\nThat usually means the machine cannot '
                                + 'run a worker at all — most often it is holding no credential '
                                + '(Runners → Claude sign-ins), and sometimes the launcher or the tool '
                                + 'server is missing. Nothing about your message was lost; wake me again '
                                + 'once it can run.'
                        });
                    } catch (e) {
                        say('supervisor', on).warn('could not say that it failed to run: ' + e.message);
                    }
                } else {
                    say('supervisor', on).good('it thought for ' + took + 's');
                }

                return {
                    woke: true,
                    name: on,
                    seconds: took,
                    //WHETHER IT USED THIS APP AT ALL, on the answer as well as in
                    //the chat, so a caller at the command line sees it without
                    //reading a log.
                    asked: used,
                    ranProperly: used > 0,
                    //WHAT IT PRINTED, which is its own summary rather than what
                    //it said to the person — that went through `supervisorSays`
                    //and is in the conversation.
                    said: String(said.output || '').split('\n').slice(1).join('\n').trim().slice(-2000),
                    note: on + ' took a turn. What it said to you is on the Chat tab.'
                };
            } finally {
                thinking = false;

                //AND THEN CATCH UP, if anything happened while it was busy. Not
                //awaited and not recursive in any way that matters: it starts one
                //more turn and returns, and that turn clears the flag the same
                //way.
                var again = pending;
                pending = null;
                if (again) {
                    say('supervisor', on).info('going again — ' + again);
                    setTimeout(function () {
                        actions.call('supervisorWake', { name: on, why: again }).catch(function (e) {
                            say('supervisor').warn('the catch-up turn did not run: ' + e.message);
                        });
                    }, 1000);
                }
            }
        }
    }));

    //---- and it holds its sign-in, without anybody pressing anything -------
    //
    //A SUPERVISOR THAT IS UP SHOULD BE SIGNED IN, FULL STOP. There was a button
    //for this and a banner explaining when to press it, which is a tool asking
    //somebody to perform a step that has exactly one right answer: a supervisor
    //is not handed an identity per task the way a runner is — it holds one for as
    //long as it is up, it is useless without one, and there is nothing else this
    //host would rather do with a supervisor sign-in.
    //
    //WHY IT KEPT NOT HAPPENING. Every path that starts the machine is a path
    //somebody wrote for another reason — a host restart, `vmStart`, a person at
    //the window — so the machine came up able to do nothing rather more often
    //than it came up ready. And the failure is SILENT: a wake with no credential
    //runs, exits in about three seconds, and reports that it asked for nothing.
    //
    //IDEMPOTENT AND QUIET. It is meant to be called when a machine dials in and
    //again before every wake, so holding one already is the ordinary answer and
    //says nothing to the log.
    //
    //IT NEVER TAKES A SIGN-IN OFF ANYTHING. One that is out on another machine is
    //a person's decision and stays that way. If you want a signed-out supervisor,
    //stop the machine — that is the same one press it always was, and this cannot
    //undo it.
    undo.push(actions.define('supervisorSignIn', {
        about: 'Make sure a supervisor that is up is holding its sign-in. Does nothing if it already is',
        takes: ['name'],
        run: async function (args) {
            var a = args || {};
            var all = (ours.read() || [])
                .filter(function (v) { return ours.canBe(v, 'supervisor'); })
                .filter(function (v) { return !a.name || v.name === a.name; });

            if (!all.length) {
                return {
                    did: null,
                    why: a.name
                        ? '"' + a.name + '" is not a supervisor machine'
                        : 'there is no supervisor machine on this host'
                };
            }

            //ONLY WHAT IS UP. Starting a machine is a decision with a cost and
            //this is not the thing that gets to make it — a supervisor that is
            //off is off on purpose.
            var up = all.filter(function (v) { return imports.channel.connected(v.name); });
            if (!up.length) return { did: null, why: 'it is not up' };

            var done = [];
            for (var i = 0; i < up.length; i++) {
                var machine = up[i].name;
                var already = guests.all().filter(function (g) { return g.holder === machine; }).length;
                if (already) continue;

                //THE ONE THAT WAS CHOSEN, not whichever is free. `supervisorKey`
                //is the single function that decides it, and asking it here
                //rather than picking from the list is what keeps "which account
                //is this machine spending" a question with one answer.
                var use = guests.supervisorKey();
                if (!use.key) {
                    //SAID ONCE PER CALL AND NEVER AS AN ERROR. Having no sign-in
                    //to give is a real state with a real repair, and the repair
                    //is a person. Throwing here would turn every dial-in and
                    //every wake into a failure.
                    return { did: null, why: use.why };
                }

                await guests.toMachine(use.key.name, machine);
                say('supervisor', machine).good(
                    'signed it in as "' + use.key.name + '" — a supervisor that is up holds its sign-in'
                );
                done.push(machine + ' signed in as "' + use.key.name + '"');
            }

            return {
                did: done.length ? done.join(', ') : null,
                why: done.length ? null : 'it was already signed in'
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

    //---- AND WRITING ONE, WHICH IS BOTH HALVES OR NEITHER ------------------
    //
    //THIS SAID "NO `skillSave` AND NO `skillHolding`, DELIBERATELY" and gave the
    //reason: saving is refused while a window holds unsaved edits, that handshake
    //is the whole point, and a save action without it silently overwrites whoever
    //is typing — half of it being worse than none. That was right, and the drill
    //beside it has been asking for both ever since: "changing its instructions"
    //failed on `skillSave` not existing, four of its six checks unrunnable behind
    //that.
    //
    //SO BOTH ARRIVE TOGETHER. Neither is useful alone and neither is safe alone.
    //
    //THE SUPERVISOR CANNOT CALL EITHER, and that is not enforced here. Neither
    //name is in ./allowed.js, which is where "it may not rewrite its own
    //instructions" actually lives. The app being ported from once carried a
    //second copy of that rule as "refused over the wire", which caught the
    //COMMAND LINE — a person with a checkout who can already edit the file with
    //an editor — and never caught the supervisor, which was never coming through
    //this door. It is not repeated here.
    //
    //WHICH SKILLS A WINDOW IS HOLDING UNSAVED EDITS IN. In memory on purpose: a
    //restart means no window is open and nothing is being held, and a file kept
    //on disk would go on claiming otherwise for ever.
    var held = new Map();

    undo.push(actions.define('skillHolding', {
        about: 'Say that a skill is open in the window with unsaved edits, so a save from elsewhere does not quietly overwrite them',
        takes: ['which', 'holding'],
        run: function (args) {
            var a = args || {};
            //ONLY THE WINDOW CAN SAY WHAT THE WINDOW IS HOLDING. Anything else
            //claiming it would be able to block every save by saying so once.
            if (a._overTheWire || a._driven) {
                throw new Error('Only the window can say what the window is holding.');
            }
            var key = String(a.which || 'supervisor');
            if (a.holding === false || a.holding === 'false') held.delete(key);
            else held.set(key, new Date().toISOString());
            return { which: key, holding: held.has(key) };
        }
    }));

    undo.push(actions.define('skillSave', {
        about: 'Rewrite a skill. Refused while the window has unsaved edits in it, unless force is passed',
        takes: ['which', 'text', 'from', 'force'],
        run: function (args) {
            var a = args || {};
            var which = String(a.which || 'supervisor');
            var one = skillNamed(which);
            var text = a.text;

            //FROM A FILE, BECAUSE A SKILL DOES NOT FIT ON A COMMAND LINE.
            //
            //Two reasons, and the second is the one that actually bit over
            //there. A skill is twenty-six thousand characters, which is a silly
            //thing to pass as an argument. And it STARTS WITH `---`: the CLI
            //reads that as the beginning of a flag, so `--text` arrived empty and
            //the save was refused for having no frontmatter — an error about the
            //content of a file that had never been read.
            //
            //The window still passes `text`, having the string in hand with no
            //shell between them.
            if (a.from && (text == null || text === '')) {
                try { text = fs.readFileSync(String(a.from), 'utf8'); }
                catch (e) { throw new Error('Could not read "' + a.from + '": ' + e.message); }
            }

            //WHAT IS WORTH REFUSING IS OVERWRITING SOMEBODY MID-SENTENCE. The
            //window says when it is holding unsaved edits; a save from anywhere
            //else is refused until whoever is typing decides, or until somebody
            //passes force having decided for them.
            var holding = held.get(which);
            var forced = a.force === true || a.force === 'true';
            if (holding && !forced) {
                throw new Error('The window has "' + one.title + '" open with unsaved edits (since ' + holding
                    + '). Saving now would overwrite them without them ever being seen. Save or undo in the '
                    + 'window, or pass force to overwrite anyway — the window will reload and say that its '
                    + 'edits were dropped.');
            }

            var body = String(text == null ? '' : text);
            if (!body.trim()) {
                throw new Error('A skill with nothing in it would leave the next waking with no instructions at '
                    + 'all. To stop using one, empty its content deliberately in a checkout.');
            }

            //THE FRONTMATTER IS WHAT MAKES IT A SKILL. Without a name and a
            //description the CLI does not load it, and a supervisor then works
            //from the wake brief alone — which looks exactly like a model that
            //has stopped following instructions, and is the most expensive way to
            //discover a missing header.
            if (!/^---\s*\n[\s\S]*?\bname:\s*\S/.test(body) || !/\bdescription:\s*\S/.test(body)) {
                throw new Error('A skill starts with frontmatter carrying "name:" and "description:" — without '
                    + 'both, the CLI never loads it and the machine works from the wake brief alone, which reads '
                    + 'as a model that has stopped following instructions.');
            }

            var file = skillFile(one.stage);
            var was = '';
            try { was = fs.readFileSync(file, 'utf8'); }
            catch (e) { /* new, which is allowed */ }

            if (was === body) {
                return { which: which, saved: false, characters: body.length,
                    note: 'Nothing changed, so nothing was written.' };
            }

            try { fs.writeFileSync(file, body); }
            catch (e) { throw new Error('Could not write ' + one.title + ': ' + e.message); }

            //FORCED OVER SOMEBODY'S EDITS IS A DIFFERENT EVENT, and is recorded
            //as one. The window drops what it was holding when it notices the
            //file moved, so this line is the only place that says what was lost.
            var trampled = !!holding;
            held.delete(which);
            //`say('supervisor')`, NOT `log` — which is tagged `todo` in this
            //file, and a rewritten skill filed under todos is a line nobody
            //reading about the supervisor would ever find.
            say('supervisor')[trampled ? 'warn' : 'good'](one.title + ' was rewritten — ' + was.length + ' to '
                + body.length + ' characters' + (trampled ? ', forced over unsaved edits open in the window' : ''));

            return {
                which: which,
                saved: true,
                was: was.length,
                characters: body.length,
                forced: trampled,
                where: file,
                note: trampled
                    ? 'Saved, over unsaved edits that were open in the window. Those are gone, and the window '
                        + 'will reload and say so. The next waking fetches this — nothing needs restarting.'
                    : 'Saved. The next waking fetches it — nothing needs restarting, and no machine is touched.'
            };
        }
    }));

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
