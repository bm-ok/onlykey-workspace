var makeStore = require('./store');
var makeLend = require('./lend');
var makeChoosing = require('./choosing');
var shape = require('./shape');
var lending = require('./lending');
var makeDesk = require('./desk');
var makeLife = require('./life');

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
        //`host()` AND NOT `read()`. Which sign-in the supervisor uses is about
        //this computer's keyring, so it is one of the few settings that does not
        //follow the open folder — and `read` is async now that most of them do.
        //This store is synchronous and has nothing to wait for.
        chosen: function () {
            try { return settings.host().supervisorKey || null; }
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

    //---- and how long each one has left ------------------------------------
    //
    //READ FROM THE CREDENTIAL, never by trying it — see ./life, and note that
    //`usable` is never true: a clock cannot say a credential works.
    var life = makeLife({
        read: function (file) { return imports.secret.read(file); },
        statOf: function (file) { return require('fs').statSync(file); }
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

        //---- AND A WAY BACK FOR ONE THAT WAS STOPPED BY MISTAKE ------------
        //
        //A PAUSE IS A CONCLUSION DRAWN FROM A RUN, and a conclusion can be
        //wrong. It was: this host answered 401 to a route it did not serve, the
        //guest reported that accurately, and the reading of it paused a sign-in
        //that had just worked for three minutes. Without this the only way back
        //was to throw the credential away and sign in again — which destroys a
        //working thing to correct a wrong opinion about it.
        //
        //A PERSON'S PRESS, NEVER AUTOMATIC. See ./shape.js: a probe may condemn
        //a credential and may not absolve one, precisely because a probe said
        //yes three times about a dead credential and erased what a real run had
        //established. This is the other kind of answer — somebody looked and
        //decided — so it is a door rather than a rule.
        //
        //IT SAYS WHAT IT IS OVERTURNING. A resume with no reason is how the same
        //credential gets un-paused every week and nobody learns why it keeps
        //failing.
        undo.push(actions.define('guestResume', {
            about: 'Let a paused sign-in be lent again. It does not test it — it says the pause was wrong',
            takes: ['name', 'why'],
            run: async function (args) {
                var a = args || {};
                var name = String(a.name || '').trim();
                if (!name) throw new Error('Say which sign-in.');

                var was = store.get(name);
                if (!was) throw new Error('There is no sign-in called "' + name + '".');
                if (!(was.lastCheck && was.lastCheck.ready === false)) {
                    return Object.assign({}, was, {
                        note: '"' + name + '" is not paused, so there is nothing to let go.'
                    });
                }

                var stopped = was.lastCheck.why || 'it did not say';
                var now = store.resume(name, a.why ? String(a.why).trim() : null);

                log.on('keys', name).warn('"' + name + '" may be lent again'
                    + (a.why ? ' — ' + String(a.why).trim() : '')
                    + '. It was paused because: ' + String(stopped).slice(0, 160));

                return Object.assign({}, now || {}, {
                    note: '"' + name + '" may be lent again. It was paused because: '
                        + String(stopped).slice(0, 200)
                        + ' — nothing was tested just now; this says that reading was wrong.'
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

        //---- THE DESK IS BROUGHT UP IF IT IS DOWN --------------------------
        //
        //THIS REFUSED, AND THE REFUSAL WAS THE WHOLE FLOW. "It is not dialled in,
        //so no sign-in can be started. Start it and wait for it to connect." —
        //said to somebody who has just pressed a button called "Get the link",
        //on a machine this app owns, about a wait this app knows how to do. The
        //app being ported from starts it: see `supervisorMachine` in
        //../../../../dashboard/actions/shared.js, which every sign-in goes
        //through and which brings the machine up and waits four minutes for it.
        //
        //IT COSTS NOTHING TO HAVE RUNNING AND IT IS NOT A RUNNER. The desk is a
        //user on the supervisor machine that exists for nothing else, so nothing
        //is borrowed and no queue is disturbed — which is precisely why sign-ins
        //were moved there.
        //
        //NOT FOLDED INTO `desk.which`, on purpose, and its header says why:
        //deciding which machine and starting one are different jobs, and only
        //the first can be tested without a machine.
        //
        //THE SAME THREE LINES `supervisorWake` ALREADY USES. A second way to
        //bring a supervisor up would be a second thing to get wrong about
        //waiting.
        //
        //WHICH MACHINES THIS BROUGHT UP, so they can be left as they were found.
        //In memory, because a restart means this process started nothing.
        var weStarted = new Set();

        //ONLY BEGINNING ONE STARTS A MACHINE, and the other three still refuse.
        //
        //THE FIRST VERSION OF THIS PUT THE START IN THE SHARED GATE, which reads
        //well and is wrong: `vmAuthCancel` on a machine that is off would boot it
        //for a minute in order to stop a sign-in that cannot exist, because a
        //desk that is not running is holding nothing. Same for giving a code
        //back. For those three, "it is not dialled in" IS the answer — there is
        //nothing there — and it is free.
        async function atTheDesk(name, what) {
            var on = desk.which(name);
            if (!imports.channel.connected(on)) {
                throw new Error('"' + on + '" is not dialled in, so ' + what + '. Start it and wait '
                    + 'for it to connect.');
            }
            return on;
        }

        async function deskForSigningIn(name) {
            var on = desk.which(name);
            if (imports.channel.connected(on)) return on;

            log.on('vm', on).info('starting it — a sign-in needs the desk');
            await actions.call('vmStart', { name: on });
            await actions.call('vmAwait', { name: on, for: 'connected', seconds: 240 });
            weStarted.add(on);
            log.on('vm', on).good('it is up');
            return on;
        }

        //---- AND LEFT AS IT WAS FOUND -------------------------------------
        //
        //A MACHINE SOMEBODY HAD RUNNING STAYS RUNNING, and one this brought up
        //for a sign-in goes back down when the sign-in is over. That rule is the
        //app being ported from's own, written on `credentialRecover` — "AS IT
        //WAS FOUND" — and applied here, where its own sign-in path leaves the
        //machine up instead. This is the one place this goes further than what
        //it is ported from, and it goes further by following a rule that app
        //already wrote down.
        //
        //ONLY IF THIS STARTED IT. The set is the whole of that: a supervisor
        //somebody had running, or one woken to think, is not this function's to
        //switch off.
        //
        //NEVER FATAL, AND NEVER BEFORE THE ANSWER. A sign-in that worked is not
        //undone by a machine that would not stop — the credential is already
        //kept, and what is left is a machine that is up when it need not be.
        async function deskIsDone(on) {
            if (!weStarted.has(on)) return null;
            weStarted.delete(on);
            try {
                await actions.call('vmStop', { name: on });
                log.on('vm', on).good('stopped it again — it was off before the sign-in');
                return 'stopped it again';
            } catch (e) {
                log.on('vm', on).warn('the sign-in is done and it could not be stopped again: ' + e.message);
                return null;
            }
        }

        undo.push(actions.define('vmAuthBegin', {
            about: "Start a sign-in at the desk, and return the URL to visit",
            takes: ['name', 'wait'],
            run: async function (args) {
                var a = args || {};
                var on = await deskForSigningIn(a.name);

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

                //AND THE MACHINE GOES BACK DOWN IF THIS BROUGHT IT UP. Giving up
                //is the other end of the same errand, and leaving a machine
                //running because somebody changed their mind is the cost this
                //whole arrangement exists to avoid.
                var put = await deskIsDone(on);

                return Object.assign({ name: on, stopped: true, machine: put },
                    signin.read(r.output));
            }
        }));

        //---- IS THERE ANYTHING TO HAND A MACHINE --------------------------
        //
        //ASKED ON THE DRAW LOOP, by panes that need one answer to "is there a
        //sign-in at all" — which is why the clock per guest is read from the
        //credential rather than by trying it. Free, instant, and needs no
        //machine; the alternative was booting one, handing the credential over
        //and watching a worker fail.
        //
        //THIS WAS THE LAST ACTION READING THE OTHER APP'S CREDENTIALS. While it
        //relayed it answered `dir: ...\okc-dashboard\guests` and listed that
        //app's live sign-ins — fingerprints, plans and all — inside this one.
        //---- TAKING ONE BACK OFF A MACHINE ---------------------------------
        //
        //THE QUEUE CALLS THIS AT THE END OF EVERY RUN — ../../queue/putting.js
        //— and it was still relayed, so with the app being ported from switched
        //off a machine could not give its sign-in back at all. Nothing said so:
        //putting a machine away catches, and the machine goes off holding a
        //credential this host then believes it has.
        //
        //IT READS BEFORE IT DELETES, and that is not tidiness. The Claude CLI
        //refreshes the token as a worker runs, so what is on the machine at the
        //end is NEWER than what went on. An earlier version of this in the app
        //being ported from did `rm -f` and nothing else, and every rotation was
        //thrown away — the host went on handing out a token one or more
        //refreshes behind until it died, while its own panel reported the
        //refresh half good. The reading half lives in ./lend.js, which is where
        //../../queue already goes, so this is the machine-shaped door onto the
        //same function rather than a second copy of it.
        undo.push(actions.define('vmCredentialsForget', {
            about: 'Take the worker credential off a machine, keeping whatever the worker refreshed',
            takes: ['name'],
            run: async function (args) {
                var name = (args || {}).name;
                var vm = imports.ours.get(name);

                //WHICH SIGN-IN IS ON IT, from the register rather than from the
                //caller. A machine holds one at a time and the record is what
                //says which.
                var who = vm.guest || null;

                //WHETHER THERE WAS ANYTHING TO TAKE, asked before anything is
                //done and used only to decide whether to SAY so. This is called
                //more than once for one machine — a drill takes it back, and
                //putting the machine away takes it back again — and the second
                //call is a no-op that announced itself anyway, about a machine
                //that had not held one for a second by then.
                //
                //THE WORK IS NOT SKIPPED, ONLY THE SENTENCE. The record saying a
                //machine holds nothing is not proof the file is gone — drift is
                //exactly what this exists to clean up.
                var hadSomething = !!(vm.guest || vm.holdsCredential);

                if (!who) {
                    //NO GUEST RECORDED AND MAYBE A FILE ANYWAY. Cleared directly,
                    //because there is nothing to give back to.
                    if (!imports.channel.connected(name)) {
                        throw new Error('"' + name + '" is not dialled in, so its credential cannot be taken off it.');
                    }
                    await imports.channel.run(name,
                        'rm -f "$HOME/.claude/.credentials.json" && echo okc-credential-gone',
                        { what: 'taking its worker credential away', timeout: 60000 });
                    imports.ours.update(name, { holdsCredential: false, guest: null });
                    if (hadSomething) log.on('vm', name).good(name + ' no longer holds a credential');
                    return { from: name, removed: true, guest: null, rotated: false, kept: false };
                }

                var back = await lend.fromMachine(who, name);

                //NAMED, RATHER THAN "A WORKER CREDENTIAL" FOR EVERY MACHINE. Said
                //that way it claimed the wrong KIND of credential had come off a
                //supervisor, which is a sentence somebody reads afterwards and
                //believes.
                if (hadSomething) log.on('vm', name).good(name + ' no longer holds the sign-in "' + who + '"');

                //NOT CARRIED OVER: the app being ported from also reads
                //`~/.claude.json` here when a sign-in has no account on it yet,
                //to learn whose it is without signing it in again. It is one
                //round trip once in the life of a sign-in and it is worth having;
                //it is left out rather than half-done, because it belongs in
                //./lend.js beside the read it would sit next to, and ../../queue
                //goes through that function too.
                return {
                    from: name, removed: true, guest: who,
                    rotated: !!back.rotated,
                    kept: back.rotated !== undefined
                };
            }
        }));

        //---- AND GETTING ONE BACK OFF A MACHINE THAT IS NOT RUNNING ---------
        //
        //THE BANNER SAID THIS FOR A WHILE AND THERE WAS NOTHING TO PRESS: "X is
        //powered off and still holding a worker credential — start it, take the
        //credential back, and shut it down again". Three steps, in an order that
        //matters, that somebody has to do by hand at the moment they least want
        //a procedure. It happened on this host after a Windows update stopped a
        //machine outside the ordinary sequence.
        //
        //WHY IT CANNOT JUST BE FORGOTTEN: the copy on that disk may be NEWER than
        //the one here. Marking it back without reading throws away the newest
        //token this host will ever see, and then hands out an older one until it
        //dies.
        //
        //IT PUTS THE MACHINE BACK AS IT FOUND IT. Started to be read and stopped
        //again — a machine that was off is off afterwards. One that was already
        //running is LEFT running: it may be being used, and this is a repair
        //rather than a tidy-up.
        undo.push(actions.define('credentialRecover', {
            about: 'Start a machine that is holding a sign-in, take it back with whatever the worker '
                + 'refreshed, and leave the machine as it was found',
            takes: ['name'],
            run: async function (args) {
                var name = (args || {}).name;
                var vm = imports.ours.get(name);

                var live = {};
                try {
                    var said = await actions.call('vmList', {});
                    live = ((said && said.vms) || []).filter(function (v) { return v.name === name; })[0] || {};
                } catch (e) { /* the register below is still an answer */ }

                if (!vm.holdsCredential && !live.holdsCredential) {
                    throw new Error('"' + name + '" is not recorded as holding a sign-in, so there is '
                        + 'nothing to take back.');
                }

                var wasRunning = live.state === 'running';
                var did = [];

                if (!wasRunning) {
                    await actions.call('vmStart', { name: name });
                    did.push('started it');

                    //WAITED FOR RATHER THAN ASSUMED. `vmStart` returns when the
                    //kernel speaks, which is before the agent has dialled in —
                    //and a credential cannot be read off a machine that is not
                    //talking yet. `vmAwait` is this app's own bounded wait; a
                    //loop with a sleep in it here would be a second one.
                    try {
                        await actions.call('vmAwait', { name: name, for: 'connected', seconds: 180 });
                    } catch (e) {
                        throw new Error('"' + name + '" started but has not dialled in, so its sign-in '
                            + 'still cannot be read. It is running now — try again, or take it back by '
                            + 'hand once it connects.');
                    }
                    did.push('waited for it to dial in');
                }

                var back = await actions.call('vmCredentialsForget', { name: name });
                did.push(back.rotated ? 'took the sign-in back, refreshed' : 'took the sign-in back unchanged');

                //AS IT WAS FOUND.
                if (!wasRunning) {
                    await actions.call('vmStop', { name: name });
                    did.push('stopped it again');
                }

                return {
                    name: name,
                    rotated: !!back.rotated,
                    guest: back.guest || null,
                    wasRunning: wasRunning,
                    did: did,
                    note: name + ': ' + did.join(', and ') + '.' + (back.rotated
                        ? ' That token was newer than the one here — it would have been lost.'
                        : ' It was the same token this host already had.')
                };
            }
        }));

        undo.push(actions.define('credentialsHeld', {
            about: 'Whether this host holds a worker credential, how long it has left, and where it '
                + 'came from',
            run: function () {
                //WORKERS AND JUDGES ONLY. This answers "is there anything to
                //hand a machine", and a supervisor sign-in is never handed to
                //one.
                var held = store.all().filter(function (g) { return g.role !== 'supervisor'; });

                //---- AND A COUNT OF THE OTHER KIND, WHICH IS NOT THE SAME
                //     QUESTION -------------------------------------------
                //
                //The line above is right and was READ as saying more than it
                //says. A draw loop asks this once and uses the answer for every
                //"is there a sign-in" it needs — so a list that deliberately
                //omits supervisors was read as "there are none", and a banner
                //told somebody this host had no supervisor sign-in while one sat
                //on the Runners tab with a "here" badge on it.
                //
                //A COUNT AND A FLAG, NOT A ROW. What belongs in an answer about
                //handing things out is whether there is one and whether it is
                //free — the difference between "one press" and "go and sign one
                //in", and getting that wrong sends somebody to do a thing they
                //have already done.
                //
                //FROM THE ONE FUNCTION THAT DECIDES IT. Two answers to "is there
                //a sign-in to give" that can disagree is the exact fault this
                //field was added to fix; writing the rule out again here would
                //reintroduce it a level down.
                var use = store.supervisorKey();
                var sups = store.all().filter(function (g) { return g.role === 'supervisor'; });

                var supervisor = {
                    kept: sups.length,
                    //NOT "ONE IS FREE" BUT "ONE IS AVAILABLE TO USE", which
                    //differs the moment a choice has been made: an unchosen
                    //sign-in sitting free is not something anything will reach
                    //for.
                    free: !!use.key,
                    using: use.inUse ? use.inUse.name : (use.key ? use.key.name : null),
                    chosen: use.chosen,
                    why: use.why,
                    //WHICH MACHINE HAS IT, if any. A supervisor sign-in that is
                    //out is not free and not missing, and those need different
                    //sentences.
                    out: use.out || (sups.filter(function (g) { return g.holder; })[0] || {}).holder || null
                };

                return {
                    held: held.some(function (g) { return g.has; }),
                    dir: store.root(),

                    //WHAT EACH ONE IS, AND NEVER WHAT IT SAYS. Names, dates,
                    //fingerprints, holders and clocks — the rule this whole
                    //surface is built to.
                    guests: held.map(function (g) {
                        return Object.assign({}, g, {
                            life: g.has
                                ? life.of(store.fileFor(g.name))
                                : { usable: null, why: 'there is no token file for it' }
                        });
                    }),

                    supervisor: supervisor,

                    //THE OLD SINGLE-FILE SHAPE IS NOT PORTED, deliberately. The
                    //app being ported from falls back to one `claude.json` for
                    //hosts that predate the list — one credential handed to
                    //every machine, which is several workers rotating one token
                    //and is the shape the list replaced. This app never had it,
                    //so there is nothing to fall back TO.
                    note: held.length
                        ? held.length + ' Claude sign-in' + (held.length === 1 ? '' : 's')
                            + ' kept here. One is lent per machine — see the Claude guest pane.'
                        : 'No worker sign-in kept here yet.'
                };
            }
        }));

        //---- THE TWO HALVES A PERSON SEES ----------------------------------
        //
        //`vmAuth*` ABOVE ARE THE MACHINE'S SIDE. These are the ones a person or
        //the window calls: get me a URL, and here is the code — with the desk
        //chosen rather than named, and the credential filed under a name at the
        //end. Everything else is the same two calls.
        undo.push(actions.define('claudeSignIn', {
            about: 'Get a Claude login URL from the sign-in desk. Every credential this host holds '
                + 'comes from there',
            takes: ['name', 'wait'],
            run: async function (args) {
                var a = args || {};
                var started = await actions.call('vmAuthBegin', { name: a.name, wait: a.wait });

                if (!started.url) {
                    throw new Error(started.why || 'the desk did not produce a sign-in address');
                }

                return {
                    name: started.name,
                    url: started.url,
                    note: 'The desk on ' + started.name + ' is holding the sign-in open. Visit that '
                        + 'address, approve it, and give the code back with claudeSignedIn. Nothing the '
                        + 'supervisor is working with is touched by this.'
                };
            }
        }));

        undo.push(actions.define('claudeSignedIn', {
            about: 'Give the code back. The credential is kept here under a name, and the desk is '
                + 'left empty',
            takes: ['name', 'code', 'as', 'role', 'note'],
            run: async function (args) {
                var a = args || {};

                //EVERY ROLE, ASKED OF THE ONE PLACE THAT KNOWS THEM.
                //
                //THIS WAS A SECOND COPY OF `roleFrom` and it went stale the day a
                //fourth role was added. It had already been wrong once — the note
                //it carried said so, about the Claude Judge pane signing somebody
                //in and quietly filing them as a worker — and the repair was to
                //add a branch rather than to stop keeping a copy. So when `diy`
                //arrived, the DIY pane signed a credential in and filed it as a
                //worker, in exactly the same way, for exactly the same reason.
                //
                //A credential filed under the wrong role cannot be lent to the
                //machine it was made for: ./lending.js refuses a worker sign-in
                //on a machine tagged diy, which is the rule working correctly on
                //a record that is wrong.
                //
                //./shape.js OWNS THE LIST. A branch here would be a third repair
                //of the same shape, waiting for a fifth role.
                var kind = shape.roleFrom(a.role);

                var called = String(a.as || '').trim();
                if (!called) {
                    throw new Error('Say what to call it. A credential is kept under a name, and a '
                        + 'list of "claude-code-2" is a list nobody can read six weeks later.');
                }
                if (store.get(called)) {
                    throw new Error('There is already a sign-in called "' + called + '". Pick another '
                        + 'name, or throw that one away first.');
                }

                //THROWS ON A CODE THAT DID NOT WORK, and nothing is undone when
                //it does: a sign-in is retryable and nothing was borrowed to
                //hold it.
                var said = await actions.call('vmAuthCode', { name: a.name, code: a.code });
                var on = said.name;

                //---- OFF THE DESK AND INTO THE LIST ------------------------
                //
                //READ AS THE DESK USER, because the file is 0600 in the desk's
                //home and the machine's own user is not it. base64 so a newline
                //or a shell metacharacter cannot change what arrives.
                //
                //AND QUIET, WHICH IS THE HALF THAT WAS MISSING ONCE. base64 is
                //not readable and IS the credential — anybody reading the log
                //can decode it in one command. It does not go to the log at all.
                var r = await imports.channel.run(on,
                    'sudo -n -u ' + DESK + ' -H bash -c \'base64 -w0 "$HOME/.claude/.credentials.json" '
                    + '2>/dev/null || echo OKC_NO_CREDENTIAL\'',
                    { what: 'taking the credential off the sign-in desk', timeout: 60000, quiet: true });

                var b64 = String(r.output || '').split('\n')
                    .map(function (x) { return x.trim(); })
                    .filter(Boolean).pop() || '';

                if (!b64 || b64 === 'OKC_NO_CREDENTIAL') {
                    throw new Error('The code was accepted and the desk on ' + on + ' has no credential '
                        + 'to take. The sign-in did not finish — start it again.');
                }

                //---- AND WHO THAT TURNED OUT TO BE -------------------------
                //
                //READ HERE BECAUSE HERE IS THE ONLY PLACE IT EXISTS. The desk is
                //cleared below — deliberately, and `.claude.json` goes with it —
                //so this is the last moment anything on this host can find out
                //which account was just signed in. Read afterwards it is gone;
                //read from the credential it was never there.
                //
                //BEST EFFORT, AND NEVER A REASON TO FAIL A SIGN-IN. A credential
                //that works and does not say whose it is beats no credential:
                //this is a label, and the token is what somebody was waiting for.
                //
                //`quiet` for the same reason. Not a credential, but it is
                //somebody's account sitting in a live log, and what is kept is
                //the three fields `accountOf` takes and no more.
                var account = null;
                try {
                    var who = await imports.channel.run(on,
                        'sudo -n -u ' + DESK + ' -H bash -c \'base64 -w0 "$HOME/.claude.json" '
                        + '2>/dev/null || echo OKC_NO_ACCOUNT\'',
                        { what: 'reading which account signed in', timeout: 30000, quiet: true });

                    var raw = String(who.output || '').split('\n')
                        .map(function (x) { return x.trim(); })
                        .filter(Boolean).pop() || '';

                    if (raw && raw !== 'OKC_NO_ACCOUNT') {
                        account = shape.accountOf(Buffer.from(raw, 'base64').toString('utf8'));
                    }
                } catch (e) { /* a sign-in without a name on it is still a sign-in */ }

                var made = store.add({
                    name: called,
                    token: Buffer.from(b64, 'base64').toString('utf8'),
                    role: kind,
                    from: 'signed in at the desk on ' + on,
                    note: a.note || null,
                    account: account
                });

                //---- AND THE DESK IS LEFT EMPTY ----------------------------
                //
                //IT EXISTS TO HOLD A CONVERSATION, NOT A CREDENTIAL. One left
                //there is a token on a machine's disk that nothing on this host
                //is recording, which is the state this whole app is arranged to
                //avoid. Done here rather than at the next sign-in, because "it
                //will be cleaned up eventually" is how it is still there in six
                //weeks.
                //
                //AND `.claude.json` GOES TOO, which the first version left
                //behind. Claude Code writes a config file beside the credential
                //and after a sign-in it holds the account — the email address,
                //the account uuid, when it was created, what it is billed as.
                //Not a credential, and not nothing.
                //
                //FOUND BY LOOKING RATHER THAN BY ASSUMING: the desk was reported
                //empty and had 1,973 bytes of account in it.
                try {
                    await imports.channel.run(on,
                        'sudo -n -u ' + DESK + ' -H bash -c \'rm -rf "$HOME/.claude" "$HOME/.claude.json" '
                        + '"$HOME/.okc-auth"\' && echo okc-desk-clear',
                        { what: 'clearing the sign-in desk', timeout: 60000 });
                } catch (e) {
                    log.on('vm', on).warn('the desk was not cleared: ' + e.message);
                }

                log.on('guest', called).good('signed in at the desk on ' + on + ' and kept as "'
                    + called + '" (' + kind + ')');

                //---- AND THE MACHINE IS LEFT AS IT WAS FOUND ---------------
                //
                //THE ERRAND IS OVER. The credential is kept here and the desk is
                //empty, so a machine this brought up for the sign-in has nothing
                //left to do. One somebody already had running is not touched.
                //
                //AFTER EVERYTHING ELSE, and that order is the point: the token is
                //already sealed on this host, so a machine that will not stop
                //costs a machine left running rather than a sign-in lost.
                var put = await deskIsDone(on);

                //NAME, ROLE AND FINGERPRINT — never the token. The same rule
                //every other answer in this plugin is built to.
                return {
                    name: called,
                    role: kind,
                    on: on,
                    fingerprint: made && made.fingerprint,
                    account: made && made.account,
                    machine: put,
                    note: 'Kept here and taken off the desk. Lend it to a machine when it works.'
                        + (put ? ' ' + on + ' was off before this and has been stopped again.' : '')
                };
            }
        }));

        undo.push(actions.define('claudeSignInCancel', {
            about: 'Stop a sign-in the desk is holding open',
            takes: ['name'],
            run: async function (args) {
                return await actions.call('vmAuthCancel', { name: (args || {}).name });
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

            //WHICH MACHINE IS THE SUPERVISOR, and the refusal that says what to
            //do instead. On the service because ../../supervisor needs the same
            //answer before it wakes one, and "which supervisor" is a decision:
            //two copies of it drift, and the way they drift is that one of them
            //starts sending people to a runner for a sign-in.
            //
            //IT STILL DOES NOT START ANYTHING — see ./desk.js for why that is
            //the caller's step.
            whichSupervisor: desk.which,
            isSupervisor: desk.isSupervisor,

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
