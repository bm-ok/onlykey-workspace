var policy = require('./policy');

//---------------------------------------------------------------------------
//THE QUEUE, AS A THING OF ITS OWN.
//
//It was one panel inside Tasks, answered by an action that lived with the task
//actions, because for a long time a task was the only thing that could be
//queued. That stops being true the moment judging exists: a judgement waits for
//a machine exactly as a task does, and the two share ONE queue rather than
//having one each.
//
//TWO QUEUES WOULD BE THE FAULT THIS PLUGIN EXISTS TO PREVENT. Given a queue of
//tasks and a queue of judgements there are two answers to "what is next" and no
//answer at all to "what is this host doing" — and the priority between them
//becomes a thing nobody wrote down, decided by whichever loop ticked first.
//
//SO WHAT IS QUEUED IS AN ENTRY, and its `kind` says what it is. The ordering,
//the machines that could take it, and the reasons they cannot are the same
//question for both, which is the argument for one queue.
//
//---- and it depends on neither of them ------------------------------------
//
//The Worker and the Judge consume THIS as a service. This reaches them by
//action name and never declares them — `actions.call` resolves when it is
//called, which is a lookup rather than a graph edge. Declaring them would be a
//cycle and the plugin graph would not build at all; worse, it would be the wrong
//shape even if it did, because a queue that must be linked against the things it
//dispatches to cannot have one of them swapped out.
//
//---- what is here, and what is not, yet -----------------------------------
//
//THE POLICY IS HERE AND PROVEN: who is free, what goes next, and where each kind
//of work may land — ./policy.js, and test/queue-policy.test.js sabotages both
//halves of the rule that keeps reading and writing on separate accounts.
//
//THE TICK IS NOT. Nothing on this host dispatches yet, which is deliberate:
//the queue drives real machines, and a half-ported app that started handing out
//work would be doing it with half of the checks. What runs the work today is the
//app being ported from, and `inFlight` below is read from there and SAID to be
//from there — a board reporting "nothing running" while a machine is running
//something is the confident wrong report this whole app is arranged against.
//---------------------------------------------------------------------------
plugin.consumes = ['app', 'log'];
plugin.provides = ['queue'];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log.on('queue');

    //THE CLOCK AND THE IN-FLIGHT RECORD, FROM ./main.js. They outlive this
    //bundle, which is rebuilt every time a file is saved — see the header there
    //for what a queue that forgot in-flight on every save would do to a machine.
    //
    //ABSENT WHEN THIS HALF IS BUILT AGAINST A BARE HOST, which the test suite
    //does. A stand-in that is permanently stopped and holding nothing is the
    //right answer there: every method exists, and none of them reaches a machine.
    var engine = (host && host.queue) || {
        TICK: 15000,
        running: function () { return false; },
        since: function () { return null; },
        start: function () { return false; },
        stop: function () { return false; },
        does: function () { return function () {}; },
        inFlight: function () { return []; },
        doing: function () { return {}; },
        claim: function () { return false; },
        release: function () { return false; },
        armed: function () { return false; },
        held: function () { return null; }
    };

    //HOW OFTEN THIS HOST LOOKS, taken from the clock rather than written again.
    //The board says it out loud, and a second number here would be a board
    //describing a cadence that is not the one running.
    var TICK = engine.TICK;

    //A QUEUE THAT CANNOT BE READ IS NOT AN EMPTY QUEUE.
    //
    //This swallowed the error and answered null, which the board then drew as
    //"nothing is waiting, no machine is free" — the single most misleading thing
    //this screen can say. "The host is keeping up" and "I cannot see the work"
    //are opposite reports and they looked identical.
    //
    //It is not hypothetical: the app being ported from was stopped while this was
    //being written, and the first answer this action ever gave was a confident,
    //completely empty board. So a failure is CARRIED rather than flattened.
    var unreachable = [];
    async function relayed(name, args) {
        if (!actions) return null;
        try { return await actions.call(name, args || {}); }
        catch (e) {
            unreachable.push(name);
            return null;
        }
    }

    //---- one entry, whichever kind it is -----------------------------------
    //
    //WHAT KIND OF WORK THIS IS, SAID ON EVERY ENTRY rather than implied by which
    //list it came from. A board that has to know where a row was read from in
    //order to say what it is cannot show two kinds in one list.
    function asJudgement(j) {
        return {
            kind: 'judgement',
            number: j.number,
            //ITS OWN LABEL, CARRIED RATHER THAN DERIVED. A judgement and a task
            //can both be number 4, and nothing drawing a row should have to know
            //this app's prefix conventions to say which is which.
            ref: j.ref || ('j' + j.number),
            id: j.id,
            title: j.title,
            //WHAT IT READS. A judgement takes no branch of its own — it is not
            //delivering anywhere — so this is the subject, not a destination.
            on: j.subject && j.subject.name,
            reads: j.subject && j.subject.kind,
            tag: j.tag || null
        };
    }

    function asTask(t) {
        return {
            kind: 'task',
            number: t.number,
            ref: '#' + t.number,
            id: t.id,
            title: t.title,
            //WHAT IT DELIVERS ON. A task works on a branch; a judgement names
            //the cut or line it reads instead, which is why this is not called
            //"branch" at the top level of an entry.
            on: t.branch,
            branch: t.branch,
            //A TAGGED ENTRY WAITS FOR ITS OWN KIND OF MACHINE rather than taking
            //somebody else's — so a row that is not moving has its reason here
            //rather than in a log line nobody was watching.
            tag: t.tag || null
        };
    }

    //---- and what has already been through ---------------------------------
    //
    //A QUEUE WITH NOTHING IN IT LOOKS THE SAME AS ONE NOTHING HAS EVER USED, and
    //those want opposite responses: one is a host keeping up, the other is a host
    //where something is wrong upstream and no work is arriving. "Nothing is
    //waiting and nothing is running" was the whole screen on an idle host, and it
    //said neither.
    var ENDED = { done: true, accepted: true, rejected: true, failed: true };
    function when(r) { return r.read || r.updated || r.touched || r.created || r.written || ''; }

    var undo = [];
    if (actions) {
        //=================================================================
        //STARTING THE QUEUE IS A PERSON'S PRESS.
        //
        //It is not a setting and it is not a preference: switching this on
        //means this host will roll a machine back to its base snapshot, hand
        //it a credential, and run somebody's instructions on it unattended,
        //again and again, without asking. Nothing that can be reached over a
        //socket may decide that.
        //
        //THE SAME BOUNDARY AS APPROVING A JOB, and the same standing rule
        //behind it: the command line needs approvals because a model runs
        //them, and it must not be able to create work that runs by itself.
        //Starting the thing that RUNS the work is the same act one level up.
        //
        //STOPPING IS NOT SYMMETRICAL AND IS DELIBERATELY NOT REFUSED. Anything
        //that can see something going wrong should be able to stop new work
        //being picked up. The cost of a stop nobody meant is a queue somebody
        //restarts; the cost of a start nobody meant is a machine running a
        //stranger's code.
        //=================================================================
        undo.push(actions.define('queueStart', {
            about: 'Start handing queued work to machines on this host',
            takes: ['why'],
            run: function (args) {
                var a = args || {};
                if (a._overTheWire) {
                    throw new Error('Starting the queue is done in the window, by a person. It gives real machines '
                        + 'real work — rolled back, handed a credential, and run unattended — and a model may not '
                        + 'decide that this host should begin doing that.');
                }
                var was = engine.running();
                engine.start(actions.whoAsked(a));
                return {
                    running: engine.running(),
                    since: engine.since(),
                    note: was
                        ? 'The queue was already running.'
                        : 'The queue is running. It looks every ' + (TICK / 1000) + 's and gives waiting work to '
                            + 'free machines. Stop it to have it pick nothing new up.'
                };
            }
        }));

        undo.push(actions.define('queueStop', {
            about: 'Stop giving new work to machines. Anything already running is not interrupted',
            takes: ['why'],
            run: function (args) {
                var a = args || {};
                var was = engine.running();
                engine.stop(a.why ? String(a.why) : null);
                var held = engine.inFlight();
                return {
                    running: false,
                    stillWorking: held,
                    note: (was ? 'The queue is stopped. ' : 'The queue was not running. ')
                        + (held.length
                            //A STOP THAT READ AS "EVERYTHING HAS STOPPED" WOULD BE
                            //THE WRONG SENTENCE. The machines carry on; what
                            //stopped is anything NEW being picked up.
                            ? held.length + ' machine(s) are still working and are not interrupted — '
                                + held.map(function (r) { return r.machine + ' (' + r.doing + ')'; }).join(', ') + '.'
                            : 'Nothing was in flight.')
                };
            }
        }));

        undo.push(actions.define('queueState', {
            about: 'What the queue is doing: what is waiting, in what order, and which machines could take it',
            run: async function () {
                unreachable = [];
                var machines = await relayed('vmList');
                var vms = (machines && machines.vms) || [];

                //BOTH KINDS, READ SEPARATELY AND SORTED TOGETHER. Two stores,
                //because a judgement and a task are different records; one line,
                //because they want the same machines. `order` is what decides
                //which goes first, and it is the same function a tick would
                //dispatch by.
                var saidJ = await relayed('judging');
                var judgements = (saidJ && (saidJ.judgements || saidJ.judging)) || [];

                var saidT = await relayed('tasks');
                var tasks = (saidT && saidT.tasks) || [];

                var waiting = policy.order(
                    judgements.filter(function (j) { return j.state === 'queued'; }).map(asJudgement)
                        .concat(tasks.filter(function (t) { return t.state === 'queued'; }).map(asTask))
                );

                var past = judgements.filter(function (j) { return ENDED[j.state]; }).map(function (j) {
                    return {
                        kind: 'judgement', ref: j.ref || ('j' + j.number), id: j.id, title: j.title,
                        on: j.subject && j.subject.name, machine: j.machine || null,
                        at: when(j), state: j.state,
                        //A JUDGEMENT ENDING IS NOT A VERDICT. `done` means
                        //somebody read it; what they decided is recorded
                        //separately and is often not decided at all, which is a
                        //real state and worth showing as one.
                        verdict: j.verdict || null,
                        concluded: j.concluded || null
                    };
                }).concat(tasks.filter(function (t) { return ENDED[t.state]; }).map(function (t) {
                    return {
                        kind: 'task', ref: '#' + t.number, id: t.id, title: t.title,
                        on: t.branch, machine: t.machine || null,
                        at: when(t), state: t.state, verdict: t.verdict || null,
                        //WHETHER IT RAN AT ALL. A task can be `done` having never
                        //been given a machine — see what the queue does when it
                        //can be given no identity — and a history showing those
                        //the same as a real run would be the most misleading list
                        //on the screen.
                        tries: (t.attempts || []).length
                    };
                })).sort(function (a, b) {
                    return String(b.at).localeCompare(String(a.at));
                //ENOUGH TO SEE THE SHAPE OF THE DAY, not an archive. The Worker
                //and Judge tabs are where everything lives; this is the last few
                //things this queue did, beside what it is about to do.
                }).slice(0, 12);

                //---- WHAT IS RUNNING, AND WHOSE TICK IS RUNNING IT -----------
                //
                //THIS HOST DISPATCHES NOTHING YET. Reporting an empty `inFlight`
                //would be a board saying nothing is running while a machine is
                //running something — so it is read from the app being ported
                //from, and `tickHere` says whose it is. When the tick moves, this
                //reads its own and that flag flips.
                //WHAT THIS HOST IS RUNNING, from the record that outlives a save.
                //Empty until the tick lands here, which is why the other half is
                //asked below and said to be the other half's.
                var mine = engine.inFlight();

                var there = null;
                //ASKED OF THE OTHER HALF BY NAME, which needs `elsewhere` rather
                //than `call`: this action IS `queueState` here, and `call` tries
                //this table first — so it would call itself until the stack ends,
                //looking from outside like the app simply hanging.
                if (actions.elsewhere) {
                    try { there = await actions.elsewhere('queueState', {}); } catch (e) { there = null; }
                }
                //THIS HOST'S FIRST, THE OTHER HALF'S ONLY WHILE THERE IS NOTHING
                //OF ITS OWN. The day the tick lands here, `mine` fills and this
                //stops looking anywhere else — without a second edit, and without
                //a moment where a machine is in both lists.
                var inFlight = mine.length
                    ? mine.map(function (r) { return { machine: r.machine, task: r.doing }; })
                    : ((there && there.inFlight) || []);

                return {
                    inFlight: inFlight,
                    //WHOSE CLOCK IS RUNNING, AND WHETHER IT IS. Two different
                    //facts: this host can own the tick and have it switched off,
                    //which is what it does on every start.
                    ticking: engine.running(),
                    startedBy: engine.since(),
                    waiting: waiting,
                    history: past,
                    //COUNTED PER KIND, because "four waiting" says nothing about
                    //whether this host is behind on READING work or behind on
                    //DOING it.
                    counts: waiting.reduce(function (n, e) {
                        n[e.kind] = (n[e.kind] || 0) + 1;
                        return n;
                    }, {}),
                    machines: policy.availability(vms, inFlight.reduce(function (n, r) {
                        n[r.machine] = r.task;
                        return n;
                    }, {})),
                    order: policy.ORDER,
                    every: (TICK / 1000) + 's',
                    tickHere: engine.armed(),

                    //AND WHAT COULD NOT BE READ, NAMED. An empty board with this
                    //list on it is a different sentence from an empty board
                    //without one, and anything reading this — a person, a pane, a
                    //model writing a progress report — has to be able to tell
                    //them apart.
                    unreachable: unreachable.slice(),
                    note: unreachable.length
                        ? 'THIS BOARD IS INCOMPLETE — ' + unreachable.join(', ') + ' could not be read. What is shown '
                            + 'is not "nothing is waiting", it is "this could not be seen". The app being ported from '
                            + 'answers those and may not be running.'
                        : 'The order and the pool are this host\'s. Nothing here dispatches yet — what is running is '
                            + 'being run by the app this is being ported from, and is shown as it reports it.'
                };
            }
        }));
    }

    await register(null, {
        queue: {
            //THE POLICY, HANDED OUT WHOLE. Anything that TELLS somebody what
            //will happen applies the same rule the tick will dispatch by — that
            //is the entire reason this is a service and not a private function.
            availability: policy.availability,
            order: policy.order,
            takes: policy.takes,
            ofItsOwnKind: policy.ofItsOwnKind,
            kindsOf: policy.kindsOf,
            canBe: policy.canBe,
            kindSaid: policy.kindSaid,
            ORDER: policy.ORDER,
            TICK: TICK,

            //AND WHETHER IT IS RUNNING, which is false until the tick lands here.
            //A consumer asking "is this host dispatching" must get an honest no
            //rather than an absent method.
            running: function () { return false; }
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
    log.info && log.info('queue policy up; nothing dispatches from this host yet');
}
module.exports = plugin;
