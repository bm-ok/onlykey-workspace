var makeStore = require('./store');
var makeLend = require('./lend');
var makeChoosing = require('./choosing');
var shape = require('./shape');
var lending = require('./lending');
var makeDesk = require('./desk');

//---------------------------------------------------------------------------
//THE CLAUDE IDENTITIES THIS HOST HOLDS, as actions and as a service.
//
//See ./store for what a sign-in IS and why there is a list rather than one file,
//and ./lending for which machine may hold which.
//
//NOTHING HERE HANDS BACK A TOKEN. Every answer is a name, a date, a fingerprint
//and a holder — the same rule ../../keys is built to, which is that a model may
//know something was done in there without knowing WHAT was done. The one call
//that reads a value is the lending, and it writes it onto a machine rather than
//returning it.
//
//---- what is here, and what is not yet -------------------------------------
//
//THE LIST, THE LABELS AND THE LENDING. Reading it, adding one, relabelling one,
//throwing one away, which supervisor sign-in is in use — and putting one ON a
//machine and taking it back, which is ./lend.
//
//NOT THE BACKUP PAIR, which needs sealing to a PASSPHRASE rather than to this
//Windows account so a backup can be restored somewhere else. That is a piece of
//its own, and it is the last of this plugin still relaying.
//
//---- but the SERVICE is here, because the queue is waiting on it ------------
//
//`freeFor`, `pausedFor` and `forQueue` are the questions ../../queue asks before
//it spends a machine, and `holderOf` and `pause` are what its metering needs to
//bill a run and stop lending a sign-in that failed. Those are rules about this
//list, and they do not wait on the handover.
//---------------------------------------------------------------------------

//`sealed`, `channel`, `ours` AND `dispatch` ARE THE LENDING'S. A credential
//reaches a machine sealed to a key that machine made — see ../../vms/sealed — and
//the means to watch what it does with it goes over in the same round trip, which
//is what ../../vms/dispatch knows where to put.
//`signin` IS THE SIGN-IN DESK'S SHELL — ../../vms/auth, which builds what runs
//on the desk user and reads back what it said. It was ported and nothing
//consumed it, so every Claude sign-in still went to the app being ported from.
plugin.consumes = ['app', 'log', 'secret', 'dataDir', 'settings',
    'sealed', 'channel', 'ours', 'dispatch', 'signin'];
plugin.provides = ['guests'];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log;
    var settings = imports.settings;

    var store = makeStore({
        //A THUNK. ../../core/datadir refuses on a process with no main half
        //behind it, and calling it while the graph is being built makes that
        //refusal a startup failure rather than an answer to a question nobody
        //asked. See what an eager `dataDir.at()` did to ../../vms/provision.
        dir: function () { return imports.dataDir.at('guests'); },
        secret: imports.secret,
        //WHICH SUPERVISOR SIGN-IN IS CHOSEN is a setting, and this is the one
        //place that turns a name into an identity to use.
        chosen: function () {
            try { return settings.read().supervisorKey || null; }
            catch (e) { return null; }
        }
    });

    //---- and an empty list that is not an empty host ------------------------
    //
    //THIS STORE IS THIS APP'S OWN. State lives in a folder named after this app,
    //so a subsystem that has just moved starts EMPTY — which is deliberate, and
    //is what makes it impossible for the port to damage the real sign-ins. It is
    //also indistinguishable, on screen, from having lost them.
    //
    //SO IT IS ASKED RATHER THAN GUESSED. If the app being ported from holds
    //some, the empty note says so; if it holds none, nothing is said and a fresh
    //host reads as a fresh host.
    //
    //ONLY WHEN THIS LIST IS EMPTY, so it costs one relay on a screen that has
    //nothing else to draw and nothing at all the moment there is a sign-in here.
    //
    //`elsewhere`, NOT `call`: `guests` IS this action, and `call` tries this
    //table first — so it would call itself until the stack ends, looking from
    //outside like the app simply hanging. The same trap ../../queue and
    //../../carryover both name.
    async function alsoElsewhere(role) {
        if (!actions || !actions.elsewhere) return '';
        var there = null;
        try { there = await actions.elsewhere('guests', role ? { role: role } : {}); }
        catch (e) { return ''; }

        var held = ((there && there.guests) || []).length;
        if (!held) return '';

        return ' The app this is being ported from still holds ' + held + ' — they have not been lost, and '
            + 'they are not read from here: this app keeps its own, so that porting it cannot damage a '
            + 'credential a machine is using.';
    }

    //---- putting one on a machine, and taking it back -----------------------
    //
    //THE ORDER OF ITS CHECKS IS THE DESIGN — see ./lend, which is where they are
    //and where they are tested. Handed the pieces rather than reaching for them,
    //so the sequence can be exercised without a machine.
    var lend = makeLend({
        store: store,
        ours: imports.ours,
        channel: imports.channel,
        sealed: imports.sealed,
        dispatch: imports.dispatch,
        say: function (who, machine) { return log.on(who, machine); },
        paused: shape.paused,
        whyNotOn: lending.whyNotOn,
        roleFrom: shape.roleFrom
    });

    //---- and which one a machine is handed ---------------------------------
    //
    //THE WORK DECIDES THE KIND, not the box — see ./choosing, which is where
    //that rule and the three different ways a host can have nothing to give both
    //live.
    var choosing = makeChoosing({
        all: store.all,
        paused: shape.paused,
        kindsOf: imports.ours.kindsOf
    });

    //---- and which machine holds the sign-in desk ---------------------------
    //
    //See ./desk: one machine provides every sign-in, and a runner asking for a
    //login URL is refused with the whole reason rather than a fact.
    var signin = imports.signin;
    var DESK = signin.DESK;

    var desk = makeDesk({
        ours: imports.ours,
        connected: imports.channel.connected
    });

    var undo = [];

    if (actions) {
        undo.push(actions.define('guests', {
            about: 'The Claude identities this host holds — one per name, each with a sealed token',
            //BOTH ROLES BY DEFAULT, because "what sign-ins does this host have"
            //is one question and answering half of it silently is how a
            //duplicate gets added. The panes ask for one role each.
            takes: ['role'],
            run: async function (args) {
                var role = (args && args.role) || null;

                //ONCE, AND THEN NEVER AGAIN. See ./store.ensurePlans: it writes
                //the plan into any record made before that was kept and is a
                //cheap no-op afterwards. Here because this is the one door every
                //list goes through, and a fact filled in on the way out cannot
                //be forgotten by a caller that did not know to ask for it.
                try { store.ensurePlans(); } catch (e) { /* a missing label is not worth failing a list for */ }

                var all = role
                    ? store.all().filter(function (g) { return g.role === role; })
                    : store.all();

                return {
                    guests: all,
                    held: all.filter(function (g) { return g.has; }).length,
                    lent: all.filter(function (g) { return g.holder; }).length,
                    supervisors: all.filter(function (g) { return g.role === 'supervisor'; }).length,
                    where: store.root(),
                    note: all.length
                        ? noteFor(role, all.length)
                        : noteFor(role, 0) + (await alsoElsewhere(role))
                };
            }
        }));

        undo.push(actions.define('guestAdd', {
            about: 'Keep a Claude token here under a name. It is sealed to this account and never shown again',
            takes: ['name', 'token', 'note', 'role'],
            run: function (args) {
                var a = args || {};
                var made = store.add({
                    name: a.name, token: a.token, note: a.note || null,
                    from: 'typed in', role: a.role || 'worker'
                });

                //THE NAME AND THE FINGERPRINT, NEVER THE TOKEN. This line is
                //kept in the durable record, so it has to be safe to read six
                //weeks later.
                log.on('keys').good('a Claude ' + made.role + ' called "' + made.name + '" was added — '
                    + made.fingerprint);

                return Object.assign({}, made, {
                    note: '"' + made.name + '" is kept, sealed to this Windows account. Nothing shows it '
                        + 'again — what is reported from here is a name, a date and a fingerprint.'
                });
            }
        }));

        undo.push(actions.define('guestRole', {
            about: 'Change what a Claude sign-in is for: a worker, a judge, or a supervisor. '
                + 'The token is untouched',
            takes: ['name', 'role'],
            run: function (args) {
                var a = args || {};

                //A RELABELLING, NOT A REPLACEMENT. Nothing is re-sealed and
                //nothing is read; the fingerprint afterwards is the same one,
                //which is how somebody can tell this did what it says.
                var was = store.get(a.name);
                if (!was) throw new Error('There is no sign-in called "' + a.name + '".');

                var to = store.roleOf(a.name, a.role);
                log.on('keys').good('the Claude sign-in "' + a.name + '" is a ' + to.role + ' now'
                    + (was.role === to.role ? '' : ' — it was a ' + was.role));

                return Object.assign({}, to, {
                    was: was.role,
                    note: was.role === to.role
                        ? '"' + a.name + '" was already a ' + to.role + '.'
                        : '"' + a.name + '" is a ' + to.role + ' now, and can be lent to a '
                            + (to.role === 'supervisor' ? 'supervisor machine' : to.role + ' machine')
                            + ' and nothing else. Its token was not touched — the fingerprint is the same one.'
                });
            }
        }));

        undo.push(actions.define('guestForget', {
            about: 'Throw a Claude identity away, token and all',
            takes: ['name'],
            run: function (args) {
                var name = (args || {}).name;
                var gone = store.forget(name);

                log.on('keys').warn('the Claude guest "' + gone.gone + '" was thrown away');
                return {
                    gone: gone.gone,
                    note: '"' + gone.gone + '" is gone. Anything that was using it will have to be '
                        + 'given another.'
                };
            }
        }));

        undo.push(actions.define('guestLend', {
            about: 'Lend a guest to a machine, so a worker on it can authenticate',
            takes: ['name', 'machine'],
            run: async function (args) {
                var a = args || {};
                return await lend.toMachine(a.name, a.machine);
            }
        }));

        undo.push(actions.define('guestBack', {
            about: 'Take a guest back off a machine, keeping whatever the worker refreshed',
            takes: ['name', 'machine'],
            run: async function (args) {
                var a = args || {};
                return await lend.fromMachine(a.name, a.machine);
            }
        }));

        //---- HANDING A MACHINE THE SIGN-IN FOR THE WORK IT IS ABOUT TO DO ----
        //
        //THE ONE ../../queue CALLS on every run. It is ./choosing and then
        //./lend: which sign-in, and then the sealed handover — and the two are
        //separate because the choosing is a rule about a list and the handing
        //over is a conversation with a machine.
        undo.push(actions.define('vmCredentialsPut', {
            about: 'Hand a machine the sign-in for the work it is about to do. '
                + '--role worker or judge, needed only when a machine is tagged as both',
            //`role` NAMES THE WORK, not the machine — and is needed only for a
            //machine tagged as more than one thing.
            takes: ['name', 'role'],
            run: async function (args) {
                var a = args || {};

                //THE MACHINE FIRST, because everything after this is about a
                //machine that exists. ./lend asks again in its own order, for
                //its own reason.
                var vm = imports.ours.get(a.name);
                if (!imports.channel.connected(a.name)) {
                    throw new Error('"' + a.name + '" is not dialled in.');
                }

                var chosen = choosing.forMachine(a.name, vm, a.role || null);
                var done = await lend.toMachine(chosen.name, a.name);

                return Object.assign({}, done, { role: chosen.role, guest: chosen.name });
            }
        }));

        //=====================================================================
        //THE SIGN-IN DESK.
        //
        //TWO HALVES, BECAUSE THERE IS A PERSON IN THE MIDDLE. The desk prints an
        //address, somebody visits it and approves, and a code comes back.
        //Nothing here can do that half, and nothing should.
        //
        //ALL OF IT HAPPENS AS THE DESK USER, which is not the machine's own user
        //and not the supervisor. A Claude sign-in writes to
        //`~/.claude/.credentials.json` of WHOEVER RUNS IT, and the supervisor
        //runs as a credential — so signing in as that user would overwrite the
        //one it is working with, mid-thought. See
        //../../vms/provision/scripts/supervisor.sh, which makes the desk.
        //=====================================================================

        //A SHARED GATE, because all four ask the same two things and a fifth
        //copy of them is a fifth place to forget one.
        async function atTheDesk(name, what) {
            var on = desk.which(name);
            if (!imports.channel.connected(on)) {
                throw new Error('"' + on + '" is not dialled in, so ' + what + '. Start it and wait '
                    + 'for it to connect.');
            }
            return on;
        }

        undo.push(actions.define('vmAuthBegin', {
            about: "Start a sign-in at the desk, and return the URL to visit",
            takes: ['name', 'wait'],
            run: async function (args) {
                var a = args || {};
                var on = await atTheDesk(a.name, 'no sign-in can be started');

                var wait = Math.max(5, Math.min(Number(a.wait) || 25, 120));
                var r = await imports.channel.run(on,
                    signin.asDesk(signin.begin(wait), DESK),
                    { what: 'starting a sign-in at the desk', timeout: (wait + 30) * 1000 });

                var out = signin.read(r.output);

                if (out.url) {
                    log.on('vm', on).good(on + ' is waiting to be signed in — open ' + out.url);
                    return {
                        name: on,
                        url: out.url,
                        next: 'visit it, then: okc.js vmAuthCode --name ' + on + ' --code "<what it gives you>"',
                        log: out.log
                    };
                }

                //NO URL IS NOT AUTOMATICALLY A FAILURE — it may already be
                //signed in, or it may have refused for a reason of its own. Its
                //OWN WORDS are the answer; guessing between those would be
                //inventing one.
                //
                //AND THE RAW REPLY WHEN THE PARSED ONE IS EMPTY. A message built
                //only from fields that turned out to be blank says nothing at
                //all, and what actually came back is the thing most likely to
                //explain that.
                throw new Error('"' + on + '" did not offer a sign-in URL'
                    + (out.finished ? ' (it exited ' + out.exit + ')' : '') + '.\n'
                    + 'it said: ' + (out.log || '(nothing)') + '\n' + (out.why || '')
                    + (out.log || out.why ? '' : '\nraw reply:\n' + String(r.output || '(empty)').slice(-800)));
            }
        }));

        //---- AND WHETHER A MACHINE'S OWN WORKER IS SIGNED IN ----------------
        //
        //A DIFFERENT QUESTION FROM THE DESK, and about a different machine. The
        //desk is where a credential is MADE; this asks a runner whether the one
        //it was handed still works — so it takes any machine this app made, not
        //only a supervisor.
        //
        //ASKED OF THE MACHINE rather than read from the register, because the
        //register knows what was HANDED OVER and the machine knows what it has.
        //A credential can be signed in on the machine itself, or carried in its
        //environment, and neither reaches the register.
        undo.push(actions.define('vmAuthStatus', {
            about: "Whether a machine's worker is signed in",
            takes: ['name'],
            run: async function (args) {
                var name = (args || {}).name;
                imports.ours.get(name);
                if (!imports.channel.connected(name)) {
                    throw new Error('"' + name + '" is not dialled in, so its worker cannot be asked.');
                }

                var r = await imports.channel.run(name,
                    'claude auth status 2>&1 | head -20; echo "---"; '
                    + 'ls -l ~/.claude/.credentials.json 2>/dev/null || echo "no credential file"',
                    { what: 'checking its worker sign-in', timeout: 60000 });

                return { name: name, status: r.output };
            }
        }));

        undo.push(actions.define('vmAuthCode', {
            about: 'Give a waiting desk the code from the sign-in page',
            takes: ['name', 'code', 'wait'],
            run: async function (args) {
                var a = args || {};
                var on = await atTheDesk(a.name, 'the code cannot be given back');
                if (!a.code || !String(a.code).trim()) throw new Error('Say what the code is.');

                var wait = Math.max(5, Math.min(Number(a.wait) || 40, 120));
                var r = await imports.channel.run(on,
                    signin.asDesk(signin.code(String(a.code).trim(), wait), DESK),
                    { what: 'finishing a sign-in at the desk', timeout: (wait + 30) * 1000 });

                var out = signin.read(r.output);

                //NOT WAITING IS ITS OWN ANSWER, and a different one from a bad
                //code: the first is fixed by starting again, the second by
                //reading the page more carefully.
                if (out.noPipe) {
                    throw new Error('"' + on + '" is not waiting for a code. Start it again with vmAuthBegin.');
                }
                if (!(out.finished && out.exit === 0)) {
                    throw new Error('"' + on + '" did not accept that code.\n'
                        + 'it said: ' + (out.log || '(nothing)') + '\n' + (out.why || ''));
                }

                return { name: on, ok: true, log: out.log };
            }
        }));

        undo.push(actions.define('vmAuthCancel', {
            about: 'Stop a sign-in the desk is holding open',
            takes: ['name'],
            run: async function (args) {
                var on = await atTheDesk((args || {}).name, 'there is nothing to stop');
                var r = await imports.channel.run(on, signin.asDesk(signin.cancel(), DESK),
                    { what: 'stopping a sign-in at the desk', timeout: 30000 });

                log.on('vm', on).warn('the sign-in at the desk was stopped');
                return Object.assign({ name: on, stopped: true }, signin.read(r.output));
            }
        }));

        undo.push(actions.define('supervisorKey', {
            about: 'Which supervisor sign-in this host uses, and switching it. Pass nothing to read it',
            takes: ['name'],
            run: async function (args) {
                var name = (args || {}).name;
                if (name === undefined || name === null || name === '') return store.supervisorKey();

                //CHOSEN FROM WHAT IS ACTUALLY HERE. A setting naming a sign-in
                //this host does not hold is a supervisor that fails the next
                //time it is woken, which is the worst moment to find out.
                var one = store.get(name);
                if (!one) throw new Error('There is no sign-in called "' + name + '".');
                if (one.role !== 'supervisor') {
                    throw new Error('"' + name + '" is a ' + one.role + ', not a supervisor. A supervisor '
                        + 'sign-in is the one this host decides with rather than one it lends to a '
                        + 'machine — change what it is for with guestRole first.');
                }

                await settings.write({ supervisorKey: name });
                log.on('keys').good('the supervisor uses the Claude sign-in "' + name + '" now');
                return store.supervisorKey();
            }
        }));
    }

    //---- and what a machine found out, recorded from wherever it happened ----
    //
    //NOT AN ACTION, because nothing types this: it is what a placement probe or
    //a finished run reports, and both of those already hold the answer. An
    //action would be a second way in with a second set of rules about which
    //evidence may overturn which — see ./shape.mayOverturn for why that rule has
    //to live in exactly one place.
    await register(null, {
        guests: {
            //---- reading, which is everything except the one door ------------
            all: store.all,
            get: store.get,
            supervisorKey: store.supervisorKey,

            //---- what the queue asks before it spends a machine ---------------
            freeFor: store.freeFor,
            pausedFor: store.pausedFor,
            forQueue: store.forQueue,

            //WHICH SIGN-IN IS ON A MACHINE, which is how a run is billed. Asked
            //rather than assumed: a machine holds whichever credential was lent
            //to it, and that is the account the cost belongs to.
            holderOf: function (machine) {
                var on = store.all().filter(function (g) { return g.holder === machine; })[0];
                return on ? on.name : null;
            },

            //---- and what a machine found out about one ----------------------
            //
            //PAUSED RATHER THAN REVOKED. A sign-in that cannot authenticate
            //stops being lent out, and nothing spends a machine on it again
            //until somebody replaces it — which is a different act from deciding
            //it is gone, and the user's rule is that revoking is never
            //automatic.
            //AND LENDING, on the service as well as as actions — ../../queue
            //hands a machine a credential on every run, and going through the
            //action table for it would be the queue calling a door it also
            //defines.
            toMachine: lend.toMachine,
            fromMachine: lend.fromMachine,

            checked: store.checked,
            pause: function (name, how) {
                return store.checked(name, Object.assign({ ready: false }, how || {}));
            },
            noteAccount: store.noteAccount,

            //THE ONE DOOR. Declared here as well as in ./store so that a reader
            //of this file sees it, and so ../../../test/runners/guests-boundary
            //has one list to hold both to.
            token: store.token,
            EXITS: store.EXITS,

            paused: shape.paused,
            ROLES: shape.ROLES
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}

//SAID IN THE WORDS OF THE ROLE ASKED FOR. This answered "guest" whatever was
//asked, which was fine while there were two roles and one of them was called
//that. With three it told a judge pane about guests.
function noteFor(role, held) {
    if (!held) {
        if (role === 'supervisor') {
            return 'No supervisor sign-in yet. A supervisor is the identity this host works with itself, '
                + 'rather than one lent to a machine.';
        }
        if (role === 'judge') {
            return 'No judge sign-in yet. A judge machine is lent one of these and nothing else, which is '
                + 'what keeps "who said this work holds" separate from "who wrote it".';
        }
        return 'No worker sign-in yet. A worker is a Claude sign-in kept here under a name — add one with '
            + 'its token, and a machine can be lent it.';
    }

    if (role === 'supervisor') {
        return held + ' supervisor sign-in' + (held === 1 ? '' : 's')
            + '. A supervisor is spent by this host and never lent to a machine.';
    }

    return held + ' ' + (role || 'worker') + ' sign-in' + (held === 1 ? '' : 's')
        + '. It is lent to a machine while it works and taken back after, so two machines never share one.';
}

module.exports = plugin;
