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
var guestEditor = require('../vms/editor/on-the-guest');

//WHAT MAKES THIS EDITOR WORTH OPENING. A DIY machine exists so somebody can run
//their own claude session in it, and the VS Code half of that is one extension —
//which runs on the MACHINE, not on this desktop. Named once, here, rather than
//spelled into a shell command in the middle of the press.
var CLAUDE_EXTENSION = 'anthropic.claude-code';

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

    //---- THE POOL, ASKED IN ONE PLACE ---------------------------------------
    //
    //A MACHINE TAGGED `diy` IS A MACHINE OF MINE. That is the whole rule, and
    //it was written out three times in this file with three different answers:
    //here it was `canBe(v, 'diy')`, and in `diyOpen`'s refusal it was "anything
    //not tagged supervisor" — which offered workers, and taking one hands the
    //queue's own machine to a person for an afternoon.
    //
    //`ours.canBe` OWNS WHAT A TAG MEANS. Reading `tags.indexOf('diy')` here
    //would be a second reading of the same fact, and the second one goes stale.
    function pool() {
        return (ours.read() || []).filter(function (v) { return ours.canBe(v, 'diy'); });
    }

    //AND FREE MEANS NO OTHER PIECE OF WORK HAS IT. Not "off", not "kept back" —
    //a DIY machine is kept back from the queue on purpose, by the press below,
    //so treating that as unavailable would make the second press refuse the
    //machine the first one took.
    function freeIn(items, exceptId) {
        var taken = {};
        (items || []).forEach(function (x) {
            if (x.machine && x.id !== exceptId) taken[x.machine] = true;
        });
        return pool().filter(function (v) { return !taken[v.name]; });
    }

    //THE SAME QUESTION ABOUT SIGN-INS. `diy` only: ../runners/guests refuses a
    //worker credential on a machine tagged diy, so offering one is offering a
    //refusal five steps into the press.
    async function freeSignIns() {
        try {
            var all = await actions.call('guests', {});
            return ((all && all.guests) || [])
                .filter(function (g) { return g.has && !g.holder && g.role === 'diy'; });
        } catch (e) { return []; }
    }

    //---- WHAT THE MACHINES ARE ACTUALLY DOING -------------------------------
    //
    //`ours.all()`, NOT `ours.read()`. The register's records are what was
    //WRITTEN DOWN — name, tags, branch, whether it is holding a credential —
    //and `running` and `connected` are not among them, because they are not
    //facts about a machine, they are facts about right now. Only `all()` asks
    //VirtualBox and the channel.
    //
    //SO THIS PANE HAS DRAWN "off" AGAINST EVERY MACHINE SINCE IT WAS WRITTEN,
    //taken or free, whatever the machine was doing — including the one somebody
    //was working inside. `holdsCredential` looked right beside it and made it
    //convincing, because that one IS written down.
    //
    //AND IT IS THE SAME PRICE. `../vbox` caches, so the second read costs what
    //the record read cost: 216ms against 220ms, measured, with the machine up.
    async function liveByName() {
        var by = {};
        try {
            var said = await ours.all();
            ((said && said.vms) || []).forEach(function (v) { by[v.name] = v; });
        } catch (e) {
            //A HOST WITHOUT VirtualBox STILL HAS SEATS. Answering nothing here
            //draws every machine as gone, which is a much larger claim than
            //"this could not be asked".
            (ours.read() || []).forEach(function (v) { by[v.name] = v; });
        }
        return by;
    }

    //---- A PATH A URI CAN CARRY, WHICH IS NOT THE SAME AS A PATH A SHELL CAN --
    //
    //`repoWorkspaces.folderFor` ANSWERS `$HOME/workspace`, and it is right to.
    //Every other caller of it — ../runners/runs, ../runners/machines — puts that
    //string into a shell command running ON the machine, where `$HOME` is the
    //machine's own answer to a question this app cannot answer for it.
    //
    //THIS IS THE ONE CALLER THAT IS NOT A SHELL. It goes into
    //`vscode-remote://ssh-remote+<alias><path>`, and nothing anywhere expands a
    //shell variable in a URI — so VS Code opened a folder literally called
    //`$HOME` and said the workspace does not exist. The press reported success:
    //the editor started, which is all `open` ever claimed.
    //
    //ASKED, NOT ASSUMED. `/home/<user>` is right for these machines and wrong
    //for root, and wrong again for any machine somebody built differently — and
    //this is the app that must not guess where somebody's work is. The machine
    //is already up and already dialled in by the time this runs.
    var homes = {};
    async function homeOf(name, vm) {
        if (homes[name]) return homes[name];

        var said = null;
        try {
            said = await actions.call('vmRun', {
                name: name, what: 'asking where home is', timeout: 20000,
                command: 'printf %s "$HOME"'
            });
        } catch (e) { /* the fallback below is still better than a literal $HOME */ }

        var out = String((said && said.output) || '');
        //THE LAST LINE, because the answer carries the echoed `$ what` line in
        //front of it, and `printf` adds nothing of its own after.
        var home = out.split('\n').map(function (l) { return l.trim(); })
            .filter(Boolean).pop() || '';

        if (!/^\//.test(home)) {
            //NOT AN ABSOLUTE PATH IS NOT AN ANSWER. Falling back is a guess and
            //it says so, because the alternative is a URI that cannot work.
            var user = (vm && vm.spec && vm.spec.user) || 'okc';
            home = user === 'root' ? '/root' : '/home/' + user;
            log.on('editor', name).warn(name + ' did not say where home is, so ' + home + ' was assumed');
        }

        homes[name] = home;
        return home;
    }

    async function absoluteOn(name, vm) {
        var folder = repoWorkspaces.folderFor(vm && vm.spec);
        if (!/\$HOME|^~/.test(folder)) return folder;

        var home = await homeOf(name, vm);
        return folder.replace(/^~/, home).split('$HOME').join(home);
    }

    function seatOf(it, held, live) {
        //`live[name]`, NOT `ours.get(name)`. `get` THROWS for a machine that is
        //not in the register — so a seat whose machine was deleted somewhere
        //else took the whole action down and the pane drew nothing at all,
        //while the branch below that says `there: false` sat unreachable
        //underneath it, describing an answer this could never give.
        var vm = it.machine ? (live[it.machine] || null) : null;
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
                    holdsCredential: !!(vm && vm.holdsCredential),

                    //WHETHER ITS DISK STILL HAS THE WORK ON IT. The difference
                    //between "asleep with my afternoon on it" and "back at
                    //base" is the difference between waking a machine and
                    //starting again, and it is the one thing a person coming
                    //back tomorrow needs the pane to say.
                    dirty: !!(vm && vm.dirty),
                    canClear: !!(vm && vm.baseSnapshot)
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
            about: 'Every piece of work of my own, what it is sitting on, and what a new one could be made from',
            needs: 'workspace',
            takes: [],
            run: async function () {
                var items = await store.all();
                var held = await whoHolds();
                var live = await liveByName();


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
                //---- THE POOL IS THE `diy` TAG -----------------------------
                //
                //ASKED OF ../vms/ours, WHICH OWNS WHAT A TAG MEANS. A machine's
                //role is a tag on its record and `kindsOf` is the one reader of
                //it — writing `tags.indexOf('diy')` here would be a second
                //reading of the same fact, and the second one is the one that
                //turns out to be wrong.
                //
                //ONLY DIY MACHINES, rather than everything with the supervisor
                //filtered out. A person's seat has to be a machine the queue
                //will never pick up, and `diy` is exactly what says so —
                //offering a worker here would hand somebody a machine the tick
                //can roll back underneath them.
                var machines = pool()
                    .map(function (rec) {
                        //THE LIVE ONE IF THERE IS ONE. Same reason as `seatOf`:
                        //`running` is not on the record.
                        var v = live[rec.name] || rec;
                        var whose = null;
                        items.forEach(function (x) { if (x.machine === v.name) whose = x.title; });

                        //WHETHER A SIGN-IN COULD EVEN GO ON IT, worked out here
                        //rather than found out at the far end of the press. See
                        //POOL above: `diy` says which machines are ours to take,
                        //and the ROLE tag is what ../runners/guests lends
                        //against — a machine in the pool with no role is one the
                        //press sets up completely and then cannot sign in.
                        var roles = ours.kindsOf(v) || [];

                        return {
                            name: v.name,
                            running: !!v.running,
                            keptBack: v.forTasks === false,
                            holdsCredential: !!v.holdsCredential,
                            branch: v.branch || null,
                            tags: v.tags || [],
                            dirty: !!v.dirty,
                            roles: roles,
                            takesASignIn: roles.length > 0,
                            usedBy: whose
                        };
                    });

                //---- AND ONLY THE PERSON'S OWN SIGN-INS --------------------
                //
                //A DIY SIGN-IN, NOT A WORKER'S. ../runners/guests refuses a
                //worker credential on a machine tagged diy anyway — so offering
                //one here would be this pane handing somebody a choice whose
                //only outcome is a refusal five steps into the press.
                //
                //AND THE REASON IT REFUSES IS THE REASON THE ROLE EXISTS: the
                //pool the queue draws from is finite, so a person holding a
                //worker sign-in for an afternoon is an afternoon the queue
                //cannot run.
                var signIns = [];
                try {
                    var all = await actions.call('guests', {});
                    signIns = ((all && all.guests) || [])
                        .filter(function (g) { return g.has && g.role === 'diy'; })
                        .map(function (g) { return { name: g.name, role: g.role, holder: g.holder || null }; });
                } catch (e) { /* no sign-ins kept here; the rest of the answer stands */ }

                return {
                    items: items.map(function (it) { return seatOf(it, held, live); }),
                    machines: machines,
                    signIns: signIns,
                    note: items.length
                        ? null
                        : 'Nothing of your own yet. This is the lane nothing else touches: not the queue, not the '
                            + 'judge, not the sweep.'
                };
            }
        }));

        //---- WHAT A PIECE OF WORK COULD BE PUT ON -------------------------
        //
        //ITS OWN ACTION, AND IT USED TO BE PART OF `diy`. That answer is polled
        //every few seconds to draw the pane; this one walks the repositories
        //through ../repositories/branches to find out which branches are cuts.
        //Bundling them meant paying for the second on every tick of the first —
        //on a project of nine repositories that is real git work, twelve times a
        //minute, to draw a list that had not changed.
        //
        //ASKED WHEN A PICKER OPENS, which is the only time the answer is used:
        //the dialog behind + and the one behind Edit. Nothing draws it.
        undo.push(actions.define('diyCuts', {
            about: 'The branch cuts a piece of work could be put on, and which are already spoken for',
            needs: 'workspace',
            takes: [],
            run: async function () {
                var taken = await store.cutsTaken();

                var board = await actions.call('branchBoard', {});
                return {
                    cuts: ((board && board.branches) || [])
                        .filter(function (b) { return b.cut; })
                        .map(function (b) {
                            return {
                                branch: b.name,
                                repos: (b.in || []).length,
                                reason: (b.note && b.note.reason) || null,
                                //SAID, NOT FILTERED OUT. The pane leaves a taken
                                //one out of its picker; the ANSWER says who has
                                //it, because "why is my branch not in the list"
                                //is the question that gets asked next.
                                takenBy: taken[b.name] || null
                            };
                        })
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

        //---- STOPPING FOR THE DAY, WHICH IS NOT THROWING IT AWAY -----------
        //
        //TWO ACTS, DELIBERATELY NOT ONE. The queue only has the one: a worker
        //finishes and `putAway` takes the credential, stops the machine and
        //rolls it back, because between tasks a machine should hold nothing. A
        //person's seat is the opposite — the whole point of it is that what is
        //on that disk is theirs and stays theirs until they say otherwise.
        //
        //SO SLEEPING RELEASES THE KEY AND STOPS THE MACHINE, and nothing else.
        //The credential comes home because it is the one thing that is not the
        //person's — it is lent, it is finite, and a machine sitting powered off
        //for a week holding one is a week the queue cannot use it. Everything
        //else stays exactly where it is.
        //
        //AND WAKING IT IS THE PRESS THAT ALREADY EXISTS. `diyOpen` skips every
        //step that is already true, so a slept machine wakes, takes its sign-in
        //back and opens — the workspace is already laid down and is not laid
        //again.
        undo.push(actions.define('diySleep', {
            about: 'Stop for the day: take the sign-in back and power the machine down, keeping the work on it',
            needs: 'workspace',
            takes: ['id'],
            run: async function (args) {
                var a = args || {};
                if (!a.id) throw new Error('Say which one: diySleep --id <id>. "diy" lists them.');

                var it = await store.get(a.id);
                if (!it) throw new Error('There is no piece of work called "' + a.id + '".');
                if (!it.machine) throw new Error('"' + it.title + '" has no machine, so there is nothing to put down.');

                var to = log.on('diy', it.id);
                var did = [];

                //THE KEY FIRST, WHILE THE MACHINE CAN STILL BE SPOKEN TO. Same
                //order and the same reason as ../queue/putting.js: taking it
                //back means it stops existing on that disk, not that the
                //register stops saying it is there — and a machine that fails
                //to shut down would otherwise sit powered on holding a live
                //credential.
                //
                //`guestBack` KEEPS WHATEVER CLAUDE REFRESHED. A session in
                //there rotates the token; `rm -f` would throw that away and
                //this host would go on handing out one several rotations
                //behind. That failure is already on record.
                var live = (await liveByName())[it.machine];
                if (live && live.holdsCredential) {
                    to.info('taking the sign-in back off ' + it.machine);
                    await actions.call('vmCredentialsForget', { name: it.machine });
                    did.push('took the sign-in back, keeping whatever claude refreshed');
                }

                if (live && live.running) {
                    to.info('shutting ' + it.machine + ' down');
                    await actions.call('vmStop', { name: it.machine });
                    did.push('shut it down');
                }

                //NOT ROLLED BACK, AND NOT RELEASED. The machine stays this
                //seat's — see `freeIn` — because the work is still on it and
                //handing it to another piece of work would be handing over
                //somebody's afternoon.
                return {
                    id: it.id,
                    machine: it.machine,
                    did: did,
                    note: did.length
                        ? it.machine + ' is off with your work still on it. Opening this again wakes it and '
                            + 'lends the sign-in back — everything else is already laid down.'
                        : it.machine + ' was already off and holding nothing.'
                };
            }
        }));

        //---- AND THROWING THE DISK AWAY, WHICH IS THE OTHER ONE -------------
        //
        //A SEPARATE PRESS BECAUSE IT IS A SEPARATE DECISION, and the two were
        //one act in the first sketch of this. Rolling back is how a machine
        //becomes reusable and it is also how an afternoon disappears, and those
        //should not share a button with "I am done for today".
        //
        //IT LEANS ON `vmSnapshotRestore`, which already clears the branch, the
        //credential and the dirty mark, and stamps `cleanSince`. Nothing here
        //reimplements any of that.
        undo.push(actions.define('diyClear', {
            about: 'Roll the machine back to its base snapshot, discarding everything on it, and release it',
            needs: 'workspace',
            takes: ['id'],
            run: async function (args) {
                var a = args || {};
                if (!a.id) throw new Error('Say which one: diyClear --id <id>. "diy" lists them.');

                var it = await store.get(a.id);
                if (!it) throw new Error('There is no piece of work called "' + a.id + '".');
                if (!it.machine) throw new Error('"' + it.title + '" has no machine, so there is nothing to clear.');

                var live = (await liveByName())[it.machine];
                if (!live) throw new Error('There is no machine called "' + it.machine + '" any more.');

                //NOWHERE TO GO BACK TO IS A REFUSAL, NOT A POWER-OFF. A machine
                //with no base snapshot would otherwise be shut down and left
                //exactly as dirty as it was, having reported success at
                //"clearing" it.
                if (!live.baseSnapshot) {
                    throw new Error(it.machine + ' has no base snapshot, so there is nowhere to roll it back to. '
                        + 'Take one on Runners → Virtual machines first, or the work on it can only be deleted '
                        + 'by rebuilding the machine.');
                }

                var to = log.on('diy', it.id);
                var did = [];

                //---- IT MUST ALREADY BE DOWN ------------------------------
                //
                //NOT BECAUSE VirtualBox MINDS — it does, a snapshot will not
                //restore under a running machine — but because of what stopping
                //it PROPERLY does on the way. `diySleep` takes the sign-in back
                //while the machine can still be spoken to, and that is what
                //brings the REFRESHED token home: a session in there rotates it,
                //and rolling a running machine back would discard whatever
                //claude rotated along with the disk. That failure is on record.
                //
                //SO THE TWO PRESSES ARE A SEQUENCE, and this refuses rather than
                //quietly doing half of the other one. An earlier version stopped
                //the machine itself, which worked and skipped the one step that
                //makes stopping worth doing.
                if (live.running) {
                    throw new Error('"' + it.machine + '" is still running. Put it to sleep first — that takes '
                        + 'your sign-in back while the machine can still be spoken to, which is what brings '
                        + 'home whatever claude refreshed on it. Rolling it back now would discard that with '
                        + 'the disk.');
                }

                //AND IF IT IS DOWN STILL HOLDING ONE, that is a machine that was
                //stopped some other way. The credential is recorded as lent, so
                //it is taken back on the register before the disk goes — the
                //file itself is about to stop existing either way, and a sign-in
                //this host thinks is out on a machine that has been wiped is one
                //nothing will ever lend again.
                if (live.holdsCredential) {
                    to.info('taking the sign-in back off ' + it.machine);
                    try {
                        await actions.call('vmCredentialsForget', { name: it.machine });
                        did.push('took the sign-in back');
                    } catch (e) {
                        to.warn('could not take the sign-in back off it: ' + e.message);
                    }
                }

                to.info('rolling ' + it.machine + ' back to "' + live.baseSnapshot + '"');
                await actions.call('vmSnapshotRestore', { name: it.machine, title: live.baseSnapshot });
                did.push('rolled it back to "' + live.baseSnapshot + '"');

                //AND THE SEAT LETS GO OF IT. The machine is clean and holds
                //nothing of this piece of work, so keeping its name here would
                //hold it out of the pool for a seat that has no claim on it any
                //more — see `freeIn`, which reads exactly this.
                await store.change(it.id, { machine: null, signIn: null });
                did.push('released it back into the diy pool');

                return {
                    id: it.id,
                    machine: it.machine,
                    did: did,
                    note: it.machine + ' is off, back at "' + live.baseSnapshot + '", and free again. '
                        + it.cut + ' and everything pushed to it are untouched — they are on this host.'
                };
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

                //---- NOT WHILE IT IS STILL HOLDING A MACHINE ---------------
                //
                //THE NOTE BELOW USED TO BE THE WHOLE ANSWER TO THIS: forget the
                //seat, and say that the machine stays taken. It reads as
                //careful and it is not, because the seat is the ONLY thing that
                //remembers which machine that was — `freeIn` reads it. Forget
                //the seat and the machine keeps running with an afternoon of
                //somebody's work on it, out of the pool, held by nothing, and
                //the pane that would have said so is the pane just deleted.
                //
                //A RUNNING MACHINE AND A DIRTY ONE ARE BOTH THAT, differently.
                //One is a machine still being used; the other is a disk with
                //work on it that nothing points at any more. The way past is
                //the two presses that exist: put it to sleep, then clear it.
                if (it.machine) {
                    var vm = (await liveByName())[it.machine];
                    if (vm && vm.running) {
                        throw new Error('"' + it.title + '" is still using ' + it.machine + ', which is running. '
                            + 'Put it to sleep first — forgetting this now would leave the machine out of the '
                            + 'pool with nothing pointing at it.');
                    }
                    if (vm && vm.dirty) {
                        throw new Error('"' + it.title + '" is still holding ' + it.machine + ', and there is '
                            + 'work on its disk. Clear the machine first, or that work is left on a machine '
                            + 'nothing points at any more.');
                    }
                }

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
                //ONE FREE DIY MACHINE IS NOT A DECISION. It asked which machine
                //to take when there was exactly one it could possibly have
                //meant — a dialog whose only correct answer was already on the
                //screen behind it, in front of the only press this tab has.
                //
                //IT STILL ASKS WHEN THERE IS SOMETHING TO ASK. Two free
                //machines is a choice nobody else can make, because which one
                //has last week's work on its disk is not a fact this app holds.
                var name = String(a.machine || it.machine || '').trim();
                if (!name) {
                    var could = freeIn(await store.all(), it.id);

                    if (could.length === 1) {
                        name = could[0].name;
                        did.push('took ' + name + ', the one diy machine free');
                    } else {
                        //THE REFUSAL CARRIES THE ANSWER. "Pick a machine" with
                        //no list is a refusal somebody has to go to another tab
                        //to act on, and this is the moment they are least
                        //likely to know which machines exist.
                        //
                        //AND WHEN THERE ARE NONE it says what would make one,
                        //because "no machines" and "none tagged diy" are a tag
                        //apart and only one of them needs a machine built.
                        throw new Error('"' + it.title + '" has no machine yet. '
                            + (could.length
                                ? 'Say which one to take: ' + could.map(function (v) { return v.name; }).join(', ')
                                : pool().length
                                    ? 'Every diy machine is already taken by something else on this list.'
                                    : 'Nothing in this workspace is tagged "diy". Tag one on Runners → Virtual '
                                        + 'machines → Tags — a worker cannot be used, because the queue would '
                                        + 'take it back underneath you.'));
                    }
                }

                //THE LIVE READING, NOT THE RECORD. Every "skip it if it is
                //already true" below turns on this object, and two of the five
                //facts it is asked for — `running` and `connected` — are not
                //written down anywhere. Off a record they are `undefined`, so
                //those two steps were never skipped: closing VS Code and
                //pressing again START THE MACHINE THAT WAS ALREADY UP and then
                //waited four minutes for it to dial in a second time.
                //
                //THE OTHER THREE ARE RECORDED, so they skipped correctly, and
                //that is what made it look like the press worked. `forTasks`,
                //`branch` and `holdsCredential` are facts about a machine;
                //`running` and `connected` are facts about right now.
                //
                //AND `ours.get` THROWS FOR A MACHINE THAT IS NOT THERE, so the
                //line under it never ran and the friendly refusal below was
                //dead. A map lookup answers `undefined`, which is what it was
                //written for.
                var vm = (await liveByName())[name];
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
                        //SAME AGAIN: one free diy sign-in is not a decision.
                        //And the list it used to refuse against was every free
                        //sign-in that was not a supervisor's — so it offered
                        //worker keys, which `guestLend` then refuses on a diy
                        //machine. A choice whose only outcome is a refusal.
                        var free = await freeSignIns();

                        if (free.length === 1) {
                            signIn = free[0].name;
                            did.push('used ' + signIn + ', the one diy sign-in free');
                        } else {
                            throw new Error('"' + it.title + '" has no sign-in chosen, and ' + name
                                + ' is holding none — so claude on it could not authenticate. '
                                + (free.length
                                    ? 'Say which to lend: ' + free.map(function (g) { return g.name; }).join(', ')
                                    : 'There is no diy sign-in free. Add one on Keys → Claude DIY — a worker key '
                                        + 'cannot be lent to a diy machine.'));
                        }
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

                //LIVE AGAIN, for the same reason and a smaller cost: the only
                //thing read off it here is `running`, and only to decorate a
                //refusal — so off a record that refusal told somebody a machine
                //that was up was not running, which is a diagnosis pointing at
                //the wrong thing at the moment they most need it right.
                var vm = (await liveByName())[name];
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
                var folder = a.dir ? String(a.dir) : await absoluteOn(name, vm);

                var said = await editor.open({ dir: folder, remote: m.alias, tags: [name] });

                //---- AND CLAUDE INSIDE IT ---------------------------------
                //
                //AN EDITOR OPENED ON A MACHINE WITH NO CLAUDE IN IT is most of
                //a press. The extension runs in the REMOTE extension host, so
                //the one installed on this desktop is not the one that window
                //uses — it says so itself: "This extension is disabled in this
                //workspace because it is defined to run in the Remote Extension
                //Host."
                //
                //AFTER `open`, NOT BEFORE, and this is the whole reason it is
                //here rather than up beside the workspace. There is no VS Code
                //server on a machine that has just been rolled back to base —
                //the editor puts one there when it connects — so before the
                //launch there is nothing to install with. See ../vms/editor/
                //on-the-guest.js, which waits on the machine rather than making
                //this host ask over and over.
                //
                //AND IT NEVER FAILS THE PRESS. The editor is open either way,
                //and refusing to report a press that worked because a
                //convenience did not is how somebody stops believing what this
                //answers.
                var extension = { done: false, why: null };
                try {
                    var ran = await actions.call('vmRun', {
                        name: name,
                        what: 'making sure claude is in the editor over there',
                        timeout: (guestEditor.WAIT_SECONDS + 60) * 1000,
                        command: guestEditor.installing(CLAUDE_EXTENSION)
                    });
                    extension = guestEditor.said(ran && ran.output);
                } catch (e) {
                    extension = { done: false, why: 'it could not be asked: ' + e.message };
                }

                if (extension.done) {
                    if (extension.why !== 'already there') to.good('claude in the editor: ' + extension.why);
                } else {
                    to.warn('claude may not be in the editor on ' + name
                        + (extension.why ? ': ' + extension.why : ''));
                }

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

                    //WHETHER THE EDITOR HAS CLAUDE IN IT, on the answer rather
                    //than only in the log. It is the difference between an
                    //editor and the reason for opening one, and a press that
                    //quietly half-worked is the shape of every bug in this file
                    //so far.
                    claude: extension.done ? extension.why : false,

                    note: 'VS Code was asked to open ' + folder + ' on ' + m.alias
                        + ' (' + m.user + '@' + m.address + ').'
                        + (extension.done ? '' : ' Claude may not be in it' + (extension.why ? ' — ' + extension.why : '.'))
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
