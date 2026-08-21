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

    //HOW OFTEN THIS HOST WOULD LOOK. Carried here rather than in the tick,
    //because the board says it out loud and the two must not be able to differ.
    var TICK = 15000;

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
                var there = null;
                //ASKED OF THE OTHER HALF BY NAME, which needs `elsewhere` rather
                //than `call`: this action IS `queueState` here, and `call` tries
                //this table first — so it would call itself until the stack ends,
                //looking from outside like the app simply hanging.
                if (actions.elsewhere) {
                    try { there = await actions.elsewhere('queueState', {}); } catch (e) { there = null; }
                }
                var inFlight = (there && there.inFlight) || [];

                return {
                    inFlight: inFlight,
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
                    tickHere: false,

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
