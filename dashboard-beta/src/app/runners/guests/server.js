var makeStore = require('./store');
var shape = require('./shape');

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
//THE LIST AND THE LABELS ARE HERE. Reading it, adding one, relabelling one,
//throwing one away, and which supervisor sign-in is in use.
//
//THE LENDING IS NOT, and it is deliberately the last thing to move. `guestLend`
//and `guestBack` are the two calls that put a credential ON a machine and take
//it off again, and they need the sealed handover, the channel and the runs
//directory — none of which is here yet. Until they move, the pane's Lend and
//Take back buttons relay to the app being ported from, which still owns the
//machines they would touch.
//
//Neither is the backup pair, which needs sealing to a PASSPHRASE rather than to
//this Windows account, and that is a piece of its own.
//
//---- but the SERVICE is here, because the queue is waiting on it ------------
//
//`freeFor`, `pausedFor` and `forQueue` are the questions ../../queue asks before
//it spends a machine, and `holderOf` and `pause` are what its metering needs to
//bill a run and stop lending a sign-in that failed. Those are rules about this
//list, and they do not wait on the handover.
//---------------------------------------------------------------------------

plugin.consumes = ['app', 'log', 'secret', 'dataDir', 'settings'];
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
