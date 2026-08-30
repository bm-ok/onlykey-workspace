//---------------------------------------------------------------------------
//DIY — A WORKER LANE WITH NO QUEUE IN IT, AND THE DOOR ONTO THE EDITOR.
//
//A queued worker gets a machine, a branch cut laid down on it, a sign-in, and a
//session somebody can read. Every one of those already exists as an action. What
//did not exist was a way to drive them AS A LANE, for a person, without the
//queue picking the machine, the judge reading the result, or the sweep tidying
//it away. That is this tab: the same lane, driven by hand.
//
//THE ONLY NEW ACTION IS THE ONE WITH NO DOOR. ../vms/editor registers an
//`editor` service over a 270-line file that already knows every way starting VS
//Code fails on a real workstation — and its own header says "NO ACTION YET",
//because the thing that called it over there lives with the branch machinery.
//Nothing on the server side consumed it, so the whole engine was unreachable:
//somebody was told "VS Code, Remote-SSH, okc-beta-worker1, open /home/okc/
//workspace" and had to type it.
//
//AND THE KEY HALF IS NOT NEW EITHER. ../core/ssh keeps this app's own ssh key,
//writes the config that names it, and adds the one Include line to the
//operator's own config — and says in its header that VS CODE IS WHY it does. So
//"set up the ssh key and launch VS Code" is not two jobs here. It is three calls
//to things that were already built and one that was not.
//
//WHY THE ACTION IS HERE RATHER THAN BESIDE THE ENGINE. ../../CLAUDE.md: a
//service goes where it is owned, an action goes where the pane is. The engine is
//about machines and stays under ../vms; the press is the DIY tab's.
//---------------------------------------------------------------------------

var makeStore = require('./store');

plugin.consumes = ['app', 'log', 'editor', 'ssh', 'ours', 'repoWorkspaces', 'state'];
plugin.provides = [];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log;

    var editor = imports.editor;
    var ssh = imports.ssh;
    var ours = imports.ours;
    var repoWorkspaces = imports.repoWorkspaces;

    //IN THE WORKSPACE'S DRAWER, because a cut only means something inside one
    //workspace — see ./store.js.
    var store = makeStore(function () { return imports.state.here.doc('diy'); });

    var undo = [];

    //---- WHAT IS TRUE RIGHT NOW, ASKED RATHER THAN REMEMBERED ---------------
    //
    //./store.js keeps the title, the notes, the cut and which machine was taken.
    //Everything else on the answer below is worked out on every read: whether
    //that machine is running, whether it is holding a sign-in and whose. A pane
    //drawing a remembered "running" beside a machine that is off is worse than
    //one that says nothing, and these are exactly the facts that go stale
    //between two reads.
    async function whoHolds() {
        var by = {};
        try {
            var said = await actions.call('credentialsHeld', {});
            ((said && said.guests) || []).forEach(function (g) {
                if (g.holder) by[g.holder] = { as: g.name, role: g.role };
            });
        } catch (e) { /* no sign-ins kept here yet; the rest of the answer stands */ }
        return by;
    }

    function seatOf(it, held) {
        var vm = it.machine ? ours.get(it.machine) : null;
        var sign = it.machine ? (held[it.machine] || null) : null;

        return {
            id: it.id,
            title: it.title,
            notes: it.notes,
            state: it.state,
            madeAt: it.madeAt,
            changedAt: it.changedAt,

            cut: it.cut,

            //NAMED EVEN WHEN IT IS GONE. A machine deleted out from under a
            //piece of work is a thing the pane has to be able to SAY, and
            //answering `machine: null` for it would read as "none taken yet"
            //— which is the state you fix by taking one, not by noticing.
            machine: it.machine
                ? {
                    name: it.machine,
                    there: !!vm,
                    running: !!(vm && vm.running),
                    connected: !!(vm && vm.connected),
                    holdsCredential: !!(vm && vm.holdsCredential)
                }
                : null,

            signIn: sign
        };
    }

    if (actions) {
        //---- EVERYTHING OF MINE, AND WHAT THERE IS TO PUSH INTO ------------
        //
        //ONE READ FOR THE WHOLE PANE. The list, the state of each seat, and the
        //cuts a new one could take are the three things drawing this pane needs
        //at once — three actions would be three round trips and three moments
        //at which they could disagree about which cuts are free.
        undo.push(actions.define('diy', {
            about: 'Every piece of work of my own: what it is, what it is sitting on, and which cuts are free',
            needs: 'workspace',
            takes: [],
            run: async function () {
                var items = await store.all();
                var held = await whoHolds();
                var taken = await store.cutsTaken();

                //THE CUTS, FROM THE PLUGIN THAT OWNS BRANCHES. `cut: true` is
                //what marks a real cut as opposed to any old branch somebody
                //made — ../repositories/branches decides that, not this.
                var cuts = [];
                try {
                    var board = await actions.call('branchBoard', {});
                    cuts = ((board && board.branches) || [])
                        .filter(function (b) { return b.cut; })
                        .map(function (b) {
                            var by = taken[b.name] || null;
                            return {
                                branch: b.name,
                                repos: (b.in || []).length,
                                reason: (b.note && b.note.reason) || null,
                                //SAID, NOT FILTERED OUT. The pane leaves a taken
                                //one out of its picker; the ANSWER says who has
                                //it, because "why is my branch not in the list"
                                //is the question that gets asked next.
                                takenBy: by
                            };
                        });
                } catch (e) { /* branches unreadable; the seats are still worth answering */ }

                //---- AND WHAT A SEAT COULD BE MADE FROM --------------------
                //
                //ON THE SAME ANSWER, because the pane asks for these at the
                //moment somebody presses the button and a second round trip
                //there is a dialog that opens empty and fills in.
                //
                //A SUPERVISOR MACHINE IS NOT OFFERED, and neither is a
                //supervisor sign-in. Both are refused downstream — giving a
                //supervisor task work would roll it back mid-thought — and
                //offering something whose only outcome is a refusal is how a
                //person learns a rule by walking into it.
                var machines = (ours.read() || [])
                    .filter(function (v) { return (v.tags || []).indexOf('supervisor') < 0; })
                    .map(function (v) {
                        var whose = null;
                        items.forEach(function (x) { if (x.machine === v.name) whose = x.title; });
                        return {
                            name: v.name,
                            running: !!v.running,
                            keptBack: v.forTasks === false,
                            holdsCredential: !!v.holdsCredential,
                            branch: v.branch || null,
                            tags: v.tags || [],
                            usedBy: whose
                        };
                    });

                var signIns = [];
                try {
                    var all = await actions.call('guests', {});
                    signIns = ((all && all.guests) || [])
                        .filter(function (g) { return g.has && g.role !== 'supervisor'; })
                        .map(function (g) { return { name: g.name, role: g.role, holder: g.holder || null }; });
                } catch (e) { /* no sign-ins kept here; the rest of the answer stands */ }

                return {
                    items: items.map(function (it) { return seatOf(it, held); }),
                    cuts: cuts,
                    machines: machines,
                    signIns: signIns,
                    note: items.length
                        ? null
                        : 'Nothing of your own yet. This is the lane nothing else touches: not the queue, not the '
                            + 'judge, not the sweep.'
                };
            }
        }));

        undo.push(actions.define('diyStart', {
            about: 'Start a piece of work of my own, on a branch cut nothing else is using',
            needs: 'workspace',
            takes: ['title', 'notes', 'cut'],
            run: async function (args) {
                var a = args || {};
                var it = await store.start({ title: a.title, notes: a.notes, cut: a.cut });
                log.on('diy').good('started "' + it.title + '"' + (it.cut ? ' on ' + it.cut : ', with no cut yet'));
                return Object.assign({}, it, {
                    note: it.cut
                        ? 'Started. Nothing is set up yet — one press takes a machine, lays ' + it.cut
                            + ' on it and lends it your sign-in.'
                        : 'Started, with nowhere to push yet. Pick a cut on it when there is one.'
                });
            }
        }));

        undo.push(actions.define('diyChange', {
            about: 'Change what a piece of work is called or says. The cut is fixed once it is set',
            needs: 'workspace',
            takes: ['id', 'title', 'notes', 'cut', 'state'],
            run: async function (args) {
                var a = args || {};
                if (!a.id) throw new Error('Say which one: diyChange --id <id>. "diy" lists them.');

                //ONLY WHAT WAS ACTUALLY SENT IS PASSED ON. ./store.js treats
                //`undefined` as "leave it alone", and building the patch with
                //`a.notes || ''` here would blank a description every time
                //somebody renamed something.
                var patch = {};
                ['title', 'notes', 'cut', 'state'].forEach(function (k) {
                    if (a[k] !== undefined) patch[k] = a[k];
                });

                var it = await store.change(a.id, patch);
                log.on('diy').info('changed "' + it.title + '"');
                return Object.assign({}, it, { note: 'Changed.' });
            }
        }));

        undo.push(actions.define('diyForget', {
            about: 'Take a piece of work off my list. It does not touch the branch or the machine',
            needs: 'workspace',
            takes: ['id'],
            run: async function (args) {
                var a = args || {};
                var it = await store.get(a.id);
                if (!it) throw new Error('There is no piece of work called "' + a.id + '".');

                await store.forget(a.id);
                log.on('diy').warn('forgot "' + it.title + '"');

                //WHAT IS LEFT BEHIND IS SAID, because this is the act somebody
                //reaches for to tidy up and it is the one that leaves the most
                //standing: the branch keeps its commits and the machine stays
                //taken until it is given back.
                return {
                    id: a.id,
                    forgotten: true,
                    note: 'Off the list. ' + (it.cut ? '"' + it.cut + '" and anything pushed to it are untouched. ' : '')
                        + (it.machine ? it.machine + ' is still yours — give it back on Runners if you are done with it.' : '')
                };
            }
        }));

        //---- THE ONE PRESS -------------------------------------------------
        //
        //FOUR ACTS TO THE APP AND ONE ACT TO THE PERSON: let me get back to
        //work. Take the machine out of the pool, bring it up, lay the cut on it,
        //lend it the sign-in, open it. Making somebody do those in order, from
        //four different tabs, is what this whole plugin exists to stop — it is
        //how a session ended with "VS Code, Remote-SSH, okc-beta-worker1, open
        ///home/okc/workspace" typed out by hand.
        //
        //EVERY STEP IS SKIPPED IF IT IS ALREADY TRUE, which is what makes this
        //the same press the second time. Coming back tomorrow to a machine that
        //is off runs three of them; coming back after lunch runs none and just
        //opens the editor.
        //
        //IT ASKS ONLY FOR WHAT IT CANNOT KNOW. Which machine and which sign-in
        //are a person's choice the first time and are then remembered on the
        //piece of work. It REFUSES rather than guessing — ../runners/guests
        //makes the same argument about roles: an unlabelled machine means
        //guessing whose identity to send, and it does not guess.
        //
        //AND IT SAYS WHAT IT DID, in order, on the answer and in Live. A press
        //that silently performs four acts on real machines is one nobody can
        //check afterwards.
        undo.push(actions.define('diyOpen', {
            about: 'Set a piece of work up if it needs it and open it in VS Code: machine, cut, sign-in, editor',
            needs: 'workspace',
            takes: ['id', 'machine', 'signIn'],
            run: async function (args) {
                var a = args || {};

                //A PERSON'S PRESS, for the same reason ./open-editor.js is: the
                //last step opens a window on the operator's own computer. The
                //four before it are ordinary machine work, but they are not
                //separable from it here — this action IS the opening.
                if ((a._overTheWire || a._driven) && !a._fromTest) {
                    throw new Error('Opening a piece of work is a person\'s press, made at the window — it ends by '
                        + 'starting a window on the computer this app is running on. It is on the DIY tab.');
                }

                if (!a.id) throw new Error('Say which one: diyOpen --id <id>. "diy" lists them.');
                var it = await store.get(a.id);
                if (!it) throw new Error('There is no piece of work called "' + a.id + '".');

                var to = log.on('diy', it.id);
                var did = [];

                //---- 1. SOMEWHERE FOR THE WORK TO GO ------------------------
                if (!it.cut) {
                    throw new Error('"' + it.title + '" has no branch cut, so there is nowhere for the work to go. '
                        + 'Give it one with Edit, or cut one in Repositories first.');
                }

                //---- 2. A MACHINE OF MY OWN ---------------------------------
                var name = String(a.machine || it.machine || '').trim();
                if (!name) {
                    //THE REFUSAL CARRIES THE ANSWER. "Pick a machine" with no
                    //list is a refusal somebody has to go to another tab to act
                    //on, and this is the moment they are least likely to know
                    //which machines exist.
                    var could = (ours.read() || []).filter(function (v) {
                        return (v.tags || []).indexOf('supervisor') < 0;
                    }).map(function (v) { return v.name; });

                    throw new Error('"' + it.title + '" has no machine yet. Say which one to take: '
                        + (could.length ? could.join(', ') : 'this host has no machines to take'));
                }

                var vm = ours.get(name);
                if (!vm) throw new Error('There is no machine called "' + name + '".');

                //---- 3. OUT OF THE POOL -------------------------------------
                //
                //`vmForTasks`, NOT `vmBorrow`. Borrowing brings a machine up
                //CLEAN — it rolls to the base snapshot — which is right for a
                //machine being taken fresh and is exactly wrong here, where the
                //work of the last three days is on the disk. This says "leave
                //this one out of the pool" and changes nothing else, and it is
                //what ../ui/banners/trouble.js already reads to stop calling a
                //machine somebody is using idle.
                if (vm.forTasks !== false) {
                    await actions.call('vmForTasks', { name: name, enabled: false });
                    did.push('kept ' + name + ' back from the queue');
                }

                //---- 4. UP, AND ACTUALLY THERE ------------------------------
                if (!vm.running) {
                    to.info('starting ' + name);
                    await actions.call('vmStart', { name: name });
                    did.push('started it');
                }

                //DIALLED IN IS NOT THE SAME AS RUNNING, and everything after
                //this needs a channel to the machine. `connected` is what
                //../runners/machines/awaiting.js calls having dialled in.
                if (!vm.connected) {
                    to.info('waiting for ' + name + ' to dial in');
                    await actions.call('vmAwait', { name: name, for: 'connected', seconds: 240 });
                    did.push('waited for it to dial in');
                }

                //---- 5. THE CUT, LAID DOWN ----------------------------------
                //
                //ONLY IF IT IS NOT ALREADY ON IT. `vmWorkspace` moves the host's
                //own checkouts off the branch so the machine can hold it, which
                //is not a thing to redo on every press.
                if (vm.branch !== it.cut) {
                    to.info('putting ' + it.cut + ' on ' + name);
                    await actions.call('vmWorkspace', { name: name, branch: it.cut });
                    did.push('laid ' + it.cut + ' on it');
                }

                //---- 6. MY SIGN-IN ON IT ------------------------------------
                var signIn = String(a.signIn || it.signIn || '').trim();
                if (!vm.holdsCredential) {
                    if (!signIn) {
                        var free = [];
                        try {
                            var held = await actions.call('guests', {});
                            free = ((held && held.guests) || [])
                                .filter(function (g) { return g.has && !g.holder && g.role !== 'supervisor'; })
                                .map(function (g) { return g.name + ' (' + g.role + ')'; });
                        } catch (e) { /* the refusal is still worth making */ }

                        throw new Error('"' + it.title + '" has no sign-in chosen, and ' + name + ' is holding none — '
                            + 'so claude on it could not authenticate. Say which to lend: '
                            + (free.length ? free.join(', ') : 'none are free'));
                    }

                    to.info('lending ' + signIn + ' to ' + name);
                    await actions.call('guestLend', { name: signIn, machine: name });
                    did.push('lent it ' + signIn);
                }

                //---- 7. AND OPEN IT -----------------------------------------
                //
                //A CLEAN ARGUMENT OBJECT. `openEditor` refuses a press that came
                //down the pipe, and passing this action's own args through would
                //hand it whatever markers arrived with them — including, from a
                //drill, the `_fromTest` that is meant to be that action's own
                //decision rather than something inherited.
                var opened = await actions.call('openEditor', { name: name });
                did.push('opened ' + opened.opened + ' on ' + opened.on);

                //---- AND WHAT IT NOW REMEMBERS ------------------------------
                //
                //WRITTEN AFTER, NOT BEFORE. A press that fell over at step four
                //should not leave the piece of work claiming a sign-in that was
                //never lent.
                var kept = await store.change(it.id, { machine: name, signIn: signIn || undefined });

                to.good('opened "' + it.title + '"');

                return {
                    id: it.id,
                    title: it.title,
                    machine: name,
                    cut: it.cut,
                    signIn: kept.signIn,
                    opened: opened.opened,
                    on: opened.on,
                    did: did,
                    note: did.join(', then ') + '.'
                };
            }
        }));

        undo.push(actions.define('openEditor', {
            about: 'Open a machine\'s workspace in VS Code over ssh, using this app\'s own key',
            needs: 'workspace',
            takes: ['name', 'dir'],
            run: async function (args) {
                var a = args || {};

                //---- A PERSON'S PRESS, AND THE REFUSAL IS THE POINT ---------
                //
                //THIS ONE RUNS ON THE OPERATOR'S OWN COMPUTER. Everything else
                //that touches a machine puts shell down a channel and reads what
                //comes back; this opens a WINDOW, here, on the desk of whoever
                //is sitting in front of it.
                //
                //../../CLAUDE.md's test for a guarded thing is never "is this
                //important" — it is whether reaching for it is out of bounds. A
                //model deciding to open windows on somebody's screen is, however
                //harmless the window.
                //
                //`_fromTest` IS LET THROUGH DELIBERATELY, the same way
                //../library/server.js lets it through: a refusal nothing can
                //exercise is a refusal nobody finds out has stopped working.
                if ((a._overTheWire || a._driven) && !a._fromTest) {
                    throw new Error('Opening an editor is a person\'s press, made at the window. It starts a '
                        + 'window on the computer this app is running on, which is not something to reach for '
                        + 'down a pipe. It is on the DIY tab.');
                }

                var name = String(a.name || '').trim();
                if (!name) throw new Error('Say which machine to open: openEditor --name <machine>.');

                var vm = ours.get(name);
                if (!vm) throw new Error('There is no machine called "' + name + '".');

                var to = log.on('diy', name);

                //---- 1. THE KEY, AND THE FILE THAT MAKES IT FINDABLE --------
                //
                //ALL THREE, EVERY PRESS, because none of them is the expensive
                //kind and the state each one repairs is invisible until the
                //moment it matters. `ensure` makes the key only if there is
                //none; `writeConfig` is rewritten whole from the register anyway
                //on every dial-in; `ensureInclude` is idempotent and says so.
                //
                //A PRESS THAT ONLY WORKS IF SOMETHING ELSE WAS PRESSED FIRST is
                //the shape this is avoiding. The Keys pane can write this file
                //and a person who has never opened Keys should still be able to
                //press this.
                ssh.ensure();
                ssh.writeConfig(ours.read() || []);
                ssh.ensureInclude();

                //---- 2. WHERE IT IS, ASKED ONCE ----------------------------
                //
                //../core/ssh hands out the same reading the config file is
                //WRITTEN from, precisely so a pane does not work it out a second
                //time and disagree.
                var m = ssh.readingOf(vm);

                if (!m.address || !m.user) {
                    throw new Error(name + ' has not said where it is yet' + (vm.running ? '' : ' — it is not running')
                        + '. A machine reports its address and its user when it dials in, and until it does there is '
                        + 'no host for ssh to open. Start it and wait for it to come up.');
                }

                //---- 3. THE FAR END IS THE ALIAS, NOT user@address ----------
                //
                //AND THAT IS THE WHOLE REASON ../core/ssh WRITES A CONFIG.
                //
                //ssh matches its configuration on the host argument it was
                //GIVEN. Hand VS Code `okc@192.168.51.221` and the `Host
                //okc-<name>` block never matches, so `IdentityFile` and
                //`IdentitiesOnly` never apply — and the connection falls back to
                //whatever identity the operator happens to have, which is the
                //one key that file exists to stop using.
                //
                //The alias matches, so the block applies, so the key this app
                //made is the key that is offered. ./open-editor.js's own note
                //argues for user@address on the grounds that a config entry goes
                //stale; that objection is answered here rather than ignored —
                //the file is rewritten whole from the register whenever a machine
                //dials in or is deleted, so the alias cannot be staler than the
                //register is.
                var folder = a.dir ? String(a.dir) : repoWorkspaces.folderFor(vm.spec);

                var said = await editor.open({ dir: folder, remote: m.alias, tags: [name] });

                //NOT AN ERROR, AND WORTH SAYING. A machine built before this app
                //had a key of its own has somebody else's public half in its
                //authorized_keys, so the config leaves it to ssh's defaults —
                //which is what reached it before and still does. It just is not
                //this app's key doing it, and that is the sort of thing nobody
                //discovers on the day it stops working.
                if (!m.usesOurKey) {
                    to.warn(name + ' was not built with this app\'s ssh key, so VS Code will offer whatever '
                        + 'identity ssh has by default');
                }

                return {
                    name: name,
                    opened: folder,
                    on: m.alias,
                    address: m.address,
                    user: m.user,
                    usesOurKey: m.usesOurKey,
                    using: said && said.using,
                    found: said && said.found,
                    note: 'VS Code was asked to open ' + folder + ' on ' + m.alias
                        + ' (' + m.user + '@' + m.address + ').'
                        + (m.usesOurKey ? '' : ' It was not built with this app\'s key, so ssh will use its own default identity.')
                };
            }
        }));
    }

    await register(null, {
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
