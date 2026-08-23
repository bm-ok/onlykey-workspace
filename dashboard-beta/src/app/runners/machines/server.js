var path = require('path');
var makeLifecycle = require('./lifecycle');
var makeSpeaking = require('./speaking');
var makeRestoring = require('./restoring');
var makeAwaiting = require('./awaiting');
var makeSnapshotting = require('./snapshotting');

//---------------------------------------------------------------------------
//THE MACHINES, AS ACTIONS.
//
//../../vms is where a machine is DRIVEN — ../../vms/vbox knows how to talk to
//VirtualBox, ../../vms/ours knows which machines this app is allowed to touch,
//../../vms/channel knows how to reach one. None of them defines an action, on
//purpose: they are services, and what a PERSON or the queue may ask is a
//different question from what the code can do.
//
//THIS IS WHERE THAT QUESTION IS ANSWERED, beside the pane that asks it.
//
//---- and only ever the machines this app made -----------------------------
//
//Every action here goes through `ours.get`, which refuses anything not in the
//registry — including a machine that exists in VirtualBox and was made by hand.
//These actions stop, roll back and photograph; a registry is the difference
//between this app being a tool and being loose on somebody's host.
//
//The refusal is deliberately the SAME for "no such machine" and "not ours",
//because saying which would be a way to probe what else is on the host.
//
//---- what is here, and what is not, yet -----------------------------------
//
//THE LIFECYCLE: the list, starting, stopping, the snapshots a machine has, and a
//photograph of its screen. The two rules that cost something live in
//./lifecycle.js and ./speaking.js and are tested there.
//
//NOT THE ROLLBACK OR THE WAITING. `vmSnapshotRestore` carries a rule about what
//a machine may push after its disk goes back, and `vmAwait` is four different
//waits behind one name. Both are real pieces rather than wrappers, and both are
//still relayed until they are written.
//
//NOR MAKING OR DESTROYING ONE. `vmCreate`, `vmInstall` and `vmRemove` are
//../../vms/provision's subject and are the largest thing left on this tab.
//
//NOR `vmTags`, AND IT CARRIES A RULE THAT HAS TO COME WITH IT. The `supervisor`
//tag may not be ADDED and may not be TAKEN OFF — it is decided when the machine
//is built, because a supervisor is a different BUILD: permanently out of the
//queue, holding no repositories, with a slim setup of node and Claude Code. The
//dialog that makes one says "this cannot be changed later", and the app being
//ported from refuses both directions, for the two failures each causes:
//
//  typed on    a machine with a full build and repositories joins the set of
//              things nothing may queue work to, reading as a queue gone quiet
//  typed off   a supervisor joins the pool, and the first queued task rolls it
//              back to its base snapshot while it is working
//
//./lifecycle.js READS THAT TAG and refuses to bring a second supervisor up. That
//is only sound while the tag cannot move, so whoever ports `vmTags` is porting
//this rule with it — not as tidiness, but because the check above depends on it.
//---------------------------------------------------------------------------

//A FILENAME THAT SORTS, and has nothing in it a filesystem objects to.
function stamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

//`repoWorkspaces` IS THE DECIDING, AND THIS PLUGIN IS THE DOING. Which branch a
//machine may work on, in which repositories, and what the script should say is
//../../repositories/repos' — every gate of it, decided with nothing run and no
//machine touched. What is left here is the three acts that touch something, and
//the machine's own token, which this plugin has and that one must not.
plugin.consumes = ['app', 'log', 'vbox', 'ours', 'busy', 'channel', 'dataDir',
    'repoWorkspaces', 'tls', 'guestApi',
    //`provision` OWNS MAKING ONE, including the refusal of a name VirtualBox
    //already has. This plugin owns the door, not the build.
    'provision'];
plugin.provides = [];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log;

    var vbox = imports.vbox;
    var ours = imports.ours;
    var repoWorkspaces = imports.repoWorkspaces;

    var speaking = makeSpeaking({
        //ONLY WHAT THE REGISTER SAYS IS CAPTURED, and not a path that merely
        //could exist. ../../vms/provision decides where a console GOES; this
        //asks where one IS, and a file nothing is writing to is silence that
        //means nothing — which is exactly the case ./speaking is careful about.
        serialFor: function (name) {
            var vm = (ours.read() || []).filter(function (v) { return v.name === name; })[0];
            return (vm && vm.serial) || null;
        },
        sizeOf: function (file) {
            try { return require('fs').statSync(file).size; } catch (e) { return 0; }
        },
        portOf: async function (name) {
            var conf = null;
            try { conf = await vbox.info(name); } catch (e) { conf = {}; }
            return (conf || {}).uart1 || null;
        },
        vbox: vbox
    });

    var restoring = makeRestoring({
        ours: ours,
        vbox: vbox,
        busy: imports.busy,
        channel: imports.channel,
        say: function (who, name) { return log.on(who, name); }
    });

    var awaiting = makeAwaiting({
        ours: ours,
        vbox: vbox,
        channel: imports.channel,
        speaking: speaking,
        //WORKED OUT RATHER THAN READ OFF THE REGISTER, which is what the app
        //being ported from does here and is NOT the same as ./speaking's
        //question — see the note in ./awaiting.js. ../../vms/provision decides
        //this path and records it; this composes the same one.
        consoleFor: function (name) {
            return path.join(imports.dataDir.at('serial'), name + '.log');
        },
        readFile: function (file) { return require('fs').readFileSync(file, 'utf8'); },
        say: function (who, name) { return log.on(who, name); }
    });

    var snapshotting = makeSnapshotting({
        ours: ours,
        snapshotsOf: function (name) { return vbox.snapshots(name); },
        isOff: function (name) { return vbox.isOff(name); }
    });

    var lifecycle = makeLifecycle({
        ours: ours,
        vbox: vbox,
        busy: imports.busy,
        channel: imports.channel,
        speaking: speaking,
        say: function (who, name) { return log.on(who, name); }
    });

    var undo = [];

    if (actions) {
        //---- MAKING ONE, AND THE NAME IT MAY NOT HAVE ----------------------
        //
        //THE COLLISION IS CHECKED AGAINST ALL OF VirtualBox, not against this
        //app's register — see ../../vms/provision/server.js, which owns the
        //refusal. That matters more here than it did in the app being ported
        //from, because there are now TWO registers on this host: this one and
        //the one belonging to the app being ported from. Either could be empty
        //while VirtualBox still holds the name.
        //
        //So clearing this app's state makes its machines invisible HERE and
        //changes nothing about what may be created: `runner1` is refused for as
        //long as VirtualBox has a `runner1`, whoever made it.
        undo.push(actions.define('vmCreate', {
            about: 'Make a virtual machine and its disk',
            takes: ['vm'],
            run: async function (args) {
                return await imports.provision.create((args || {}).vm || {});
            }
        }));

        //---- INSTALLING ONE, WHICH HOLDS THE HOST WHILE IT STARTS -----------
        //
        //AN INSTALL IS THE ONE THING HERE THAT CANNOT BE TOLD APART FROM A WEDGE
        //WHILE IT IS HAPPENING. It takes about twenty-five minutes and does not
        //dial in until its first boot, so for most of that time there is no
        //agent, no channel and nothing to ask.
        //
        //---- and the lock is on the FIRST MINUTE, not the install -----------
        //
        //The app being ported from got this wrong twice and says so. The lock
        //was first held for the duration of the CALL — but `install` starts an
        //installer and returns, with the twenty-five minutes happening inside
        //the machine, so the host was held for about four seconds and a second
        //install began straight over the first.
        //
        //REFUSING THE SECOND ONE WAS THE WRONG CORRECTION. What actually
        //competes is the first minute: a snapshot restore and a cold kernel
        //boot, pulling on disk and every core at once. After that an install is
        //mostly waiting on a mirror, and two coexist perfectly well. Blocking
        //the second for twenty-five minutes would cost most of an evening to
        //avoid one minute of contention.
        //
        //SO THE TURN ENDS WHEN THIS MACHINE'S CONSOLE SAYS SOMETHING. That is
        //the machine reporting that its kernel is up and running code — a fact
        //rather than a guess about how long a boot takes, and exactly what the
        //serial port was attached for.
        //
        //THE PORTS ARE PASSED IN because the half that LISTENS on them is not
        //../../vms/provision's. They are baked into the machine here and now —
        //see ../../vms/https, which explains why they are what they are.
        undo.push(actions.define('vmInstall', {
            about: 'Install an operating system, unattended, and run its provisioning scripts. '
                + 'Nothing else comes up while it does',
            takes: ['name'],
            run: async function (args) {
                var name = (args || {}).name;
                ours.get(name);

                return await imports.busy.during(name, 'being installed', function () {
                    return imports.busy.comingUp(name, async function () {
                        var started = await imports.provision.install(name, {
                            port: imports.guestApi.PORT,
                            caPort: imports.guestApi.CA_PORT
                        });

                        //THREE STARTS AT MOST. An installer that never reaches a
                        //kernel is a machine that will sit there for
                        //twenty-five minutes achieving nothing, which is exactly
                        //how an evening was lost once already.
                        await speaking.untilItSpeaks(name, log.on('vm', name), { tries: 3 });
                        return started;
                    }, { kind: 'install' });
                });
            }
        }));

        //---- AND UNMAKING ONE, WHICH ONLY EVER MEANS ONE OF OURS ------------
        //
        //`ours.get` IS THE WHOLE GUARD AND IT IS THE FIRST LINE. It refuses
        //anything not in THIS app's register — including a machine that exists
        //in VirtualBox, including one the app being ported from made and is
        //still using. There is no flag to override it.
        //
        //WHICH MEANS A FRESH INSTALL OF THIS APP CAN DELETE NOTHING. Its
        //register is empty, so every name is somebody else's, so every removal
        //is refused. That is the property, stated as a consequence rather than
        //implemented as a special case.
        //
        //THE REFUSAL IS DELIBERATELY THE SAME for "no such machine" and "not
        //ours", because saying which would be a way to probe what else is on
        //this host.
        undo.push(actions.define('vmRemove', {
            about: 'Delete a virtual machine and its disks, and forget it',
            takes: ['name'],
            run: async function (args) {
                var name = (args || {}).name;
                ours.get(name);

                return await imports.busy.during(name, 'being deleted', async function () {
                    //BEFORE THE MACHINE GOES, so nothing is left holding a
                    //session for something that no longer exists — and so a new
                    //machine of the same name cannot inherit it.
                    imports.channel.drop(name, 'was deleted');

                    var out = await vbox.destroy(name);
                    return Object.assign({}, out, ours.forget(name));
                });
            }
        }));

        //---- OR JUST LETTING GO OF IT --------------------------------------
        //
        //A DIFFERENT ACT FROM REMOVING, and the difference matters more here
        //than it did in the app being ported from. Two registers can now name
        //one VirtualBox machine, so "stop managing this" and "destroy this" are
        //questions with different answers — and the first is the one to reach
        //for when the other app is still using it.
        undo.push(actions.define('vmForget', {
            about: 'Stop managing a virtual machine without deleting it',
            takes: ['name'],
            run: function (args) {
                var name = (args || {}).name;
                ours.get(name);
                imports.channel.drop(name, 'is no longer managed here');
                return ours.forget(name);
            }
        }));

        undo.push(actions.define('vmList', {
            about: 'The virtual machines this app made, with live state and stage',
            run: function () { return ours.all(); }
        }));

        undo.push(actions.define('vmStart', {
            about: 'Start a virtual machine, waiting its turn if another is coming up',
            takes: ['name', 'type'],
            run: async function (args) {
                var a = args || {};
                return await lifecycle.start(a.name, a.type);
            }
        }));

        undo.push(actions.define('vmStop', {
            about: 'Shut a virtual machine down and wait for it, or pull its power with force',
            takes: ['name', 'force', 'seconds'],
            run: async function (args) {
                var a = args || {};
                return await lifecycle.stop(a.name, { force: a.force, seconds: a.seconds });
            }
        }));

        //---- TAKING ONE ----------------------------------------------------
        //
        //THE FOUR REFUSALS ARE ./snapshotting.js's, in the order that costs
        //least to be told. The one that matters most is free to check and is
        //checked first: a snapshot of a machine holding a worker credential
        //keeps an unsealed copy for as long as the snapshot exists, and a
        //snapshot is exactly what this app keeps, rolls back to and clones.
        undo.push(actions.define('vmSnapshotTake', {
            about: 'Take a snapshot, with a title of your choosing',
            takes: ['name', 'title', 'description'],
            run: async function (args) {
                var a = args || {};
                ours.get(a.name);

                return await imports.busy.during(a.name, 'being snapshotted', async function () {
                    var title = await snapshotting.mayTake(a.name, a.title);

                    //POWERED OFF IS NOT UNLOCKED, and a snapshot taken into that
                    //window is taken of a disk VirtualBox has not finished with.
                    await vbox.waitUntilUnlocked(a.name);
                    await vbox.takeSnapshot(a.name, title, a.description || '');

                    //READ AGAIN RATHER THAN REUSED. Whatever was read before the
                    //snapshot is now older than the thing being recorded.
                    ours.update(a.name, makeSnapshotting.recordFor(ours.get(a.name), title, Date.now()));
                    return await vbox.snapshots(a.name);
                });
            }
        }));

        //---- AND THROWING ONE AWAY -----------------------------------------
        //
        //WHAT THE REGISTER SAID ABOUT IT GOES TOO, or the branch it named
        //outlives the point it belonged to — and a later reader would take that
        //branch as still reachable.
        //
        //AND IF IT WAS THE BASE, THE MACHINE NO LONGER HAS ONE. Saying so is the
        //honest answer: leaving the name would make "put it away" point at a
        //snapshot that is not there, which fails at the moment a machine is
        //being handed back rather than now.
        undo.push(actions.define('vmSnapshotDelete', {
            about: 'Throw a snapshot away, merging its disk back',
            takes: ['name', 'title'],
            run: async function (args) {
                var a = args || {};
                var vm = ours.get(a.name);
                if (!a.title) throw new Error('Say which snapshot.');

                return await imports.busy.during(a.name, 'having a snapshot removed', async function () {
                    await vbox.waitUntilUnlocked(a.name);
                    await vbox.deleteSnapshot(a.name, a.title);

                    var kept = Object.assign({}, vm.snapshots || {});
                    delete kept[a.title];
                    ours.update(a.name, {
                        snapshots: kept,
                        baseSnapshot: vm.baseSnapshot === a.title ? null : vm.baseSnapshot
                    });

                    log.on('vm', a.name).good('snapshot "' + a.title + '" is gone');
                    return Object.assign({}, await vbox.snapshots(a.name), { removed: a.title });
                });
            }
        }));

        //---- A CLEAN STARTING POINT, WHICH SHUTS IT DOWN FOR YOU ------------
        //
        //THE ONE THAT TAKES A RUNNING MACHINE, because it stops it, snapshots,
        //and starts it again — which is what the other one refuses to do
        //silently. ../../vms/provision owns the sequence: the same function runs
        //when a machine dials in for the first time, so a person pressing this
        //and a machine arriving go through one path rather than two that drift.
        //---- A CLEAN STARTING POINT, TAKEN BY HAND -------------------------
        //
        //NOT THE SAME ACT AS THE FIRST ONE, and collapsing the two was a mistake
        //worth writing down. ../../vms/provision takes a machine's FIRST
        //snapshot when it dials in and leaves it off, which is right: it has
        //just been built and is waiting for work.
        //
        //THIS IS A BUTTON, PRESSED ON A MACHINE SOMEBODY IS USING. It was
        //written as a wrapper around that other function, so pressing it on a
        //running machine snapshotted it correctly and then silently left it
        //off — the snapshot was fine and the machine was gone, which is the
        //worst shape for a fault to have.
        undo.push(actions.define('vmBaseSnapshot', {
            about: 'Shut a machine down, snapshot it as a clean starting point, and start it again',
            takes: ['name', 'title'],
            run: async function (args) {
                var a = args || {};
                var vm = ours.get(a.name);
                var title = snapshotting.titleFor(a.title || 'base');

                return await imports.busy.during(a.name, 'being snapshotted', async function () {
                    //BOTH REFUSALS BEFORE THE MACHINE IS SHUT DOWN, not after.
                    //This one stops a machine first, so a refusal that came
                    //later would have already cost somebody their machine and
                    //everything running on it.
                    snapshotting.refuseIfItHoldsASignIn(a.name);
                    await snapshotting.refuseIfTaken(a.name, title);

                    var to = log.on('vm', a.name);
                    var wasRunning = !(await vbox.isOff(a.name));

                    if (wasRunning) {
                        to.info('shutting down to take a clean snapshot');
                        await vbox.stop(a.name, false);

                        //ASKED POLITELY FIRST. Only after waiting is the plug
                        //pulled, because a guest part-way through writing is
                        //what a clean snapshot must not capture.
                        if (!(await vbox.waitUntilOff(a.name, { timeout: 120000 }))) {
                            to.warn('it did not shut down in two minutes; pulling the power');
                            try { await vbox.stop(a.name, true); } catch (e) { /* it may have gone */ }
                            await vbox.waitUntilOff(a.name, { timeout: 60000 });
                        }
                        await vbox.waitUntilUnlocked(a.name);
                    }

                    await vbox.takeSnapshot(a.name, title, 'a clean starting point, taken once it was set up');
                    ours.update(a.name, makeSnapshotting.recordFor(ours.get(a.name), title, Date.now()));
                    to.good('"' + title + '" is now the point this machine can be returned to');

                    if (wasRunning) {
                        //---- AND IT COMES BACK, WHICH IS ITS OWN RACE --------
                        //
                        //TAKING THE SNAPSHOT LOCKS THE MACHINE, and VirtualBox
                        //releases that lock a moment AFTER the command returns —
                        //so starting straight away loses, and this failed every
                        //time with "already locked by a session". The snapshot
                        //was fine; only the restart was lost, which is the
                        //confusing part: the error names the harmless half and
                        //the machine is left off with no obvious reason why.
                        //
                        //WAITED OUT AND THEN RETRIED, because they cover
                        //different things — SessionState can read "Unlocked" for
                        //the instant the lock still lives, measured at 100ms
                        //before a start was refused. The wait is the ordinary
                        //path; the retry is what makes it true.
                        await vbox.waitUntilUnlocked(a.name);
                        await vbox.retrying(function () { return vbox.start(a.name, 'gui'); },
                            { what: 'starting it again', tags: [a.name] });
                        to.info('started again; it will dial back in shortly');
                    }

                    return Object.assign({}, await vbox.snapshots(a.name), {
                        baseSnapshot: title,
                        //SAID, because "it is off" is a thing somebody will
                        //otherwise have to discover.
                        restarted: wasRunning
                    });
                });
            }
        }));

        undo.push(actions.define('vmSnapshots', {
            about: 'The snapshots a machine has, and which one it is on',
            takes: ['name'],
            run: async function (args) {
                var name = (args || {}).name;
                ours.get(name);
                return await vbox.snapshots(name);
            }
        }));

        undo.push(actions.define('vmAwait', {
            about: 'Wait until a machine speaks on its console, says something in particular, '
                + 'has dialled in, or is off',
            takes: ['name', 'for', 'seconds', 'tries', 'find'],
            run: async function (args) {
                var a = args || {};
                return await awaiting.until(a.name, {
                    for: a.for, seconds: a.seconds, tries: a.tries, find: a.find
                });
            }
        }));

        undo.push(actions.define('vmSnapshotRestore', {
            about: 'Go back to a snapshot, discarding everything since',
            takes: ['name', 'title', 'keepBorrow'],
            run: async function (args) {
                var a = args || {};
                return await restoring.toSnapshot(a.name, a.title, { keepBorrow: a.keepBorrow });
            }
        }));

        //---- WHAT A MACHINE WROTE TO ITS CONSOLE ---------------------------
        //
        //THE ONLY WAY TO WATCH A BOOT THAT NEVER FINISHES. There is no agent
        //during an install, so for twenty-five minutes nothing else in this app
        //can say a word about the machine — and this file is being written the
        //whole time.
        //
        //READ HERE RATHER THAN IN ../../vms/vbox, because the console is a file
        //THIS APP chose the name of. That plugin knows about VirtualBox's own
        //logs and nothing about ours.
        //
        //AND IT HAD TO BE PORTED BEFORE THE TERMINAL TAB MEANT ANYTHING: while
        //`vmLog` relayed, this app's Terminal read the OTHER app's serial
        //directory. It would have shown that app's machines booting and had
        //nothing at all to say about its own.
        undo.push(actions.define('vmLog', {
            about: "Read a machine's console, or the console from the boot before this one",
            takes: ['name', 'which', 'lines', 'find'],
            run: async function (args) {
                var a = args || {};
                var which = String(a.which || '');

                //---- THE BOOT BEFORE THIS ONE, usually the one worth reading --
                //
                //STARTING A MACHINE TRUNCATES ITS CONSOLE, so the record of a
                //boot that went wrong is destroyed by the obvious response to
                //it. One generation is kept aside on start — see
                //../../vms/vbox/doing.js, `keepThePreviousBoot` — and this is
                //how it is read.
                var back = /^(serial|console)[-.]?(previous|last|before)$/i.test(which);

                //ANYTHING THIS APP DOES NOT OWN IS PASSED ON RATHER THAN
                //REFUSED. VirtualBox's own VBox.log needs a reader that is not
                //ported yet; `elsewhere` is how a half-moved action stays honest
                //instead of this one pretending the question is invalid.
                if (!back && !/^serial$|^console$/i.test(which)) {
                    return await actions.elsewhere('vmLog', a);
                }

                ours.get(a.name);

                var file = path.join(imports.dataDir.at('serial'),
                    a.name + (back ? '.previous' : '') + '.log');

                var text = null;
                try { text = require('fs').readFileSync(file, 'utf8'); } catch (e) {
                    //THE TWO ABSENCES ARE DIFFERENT QUESTIONS, so they are
                    //different sentences.
                    if (back) {
                        throw new Error('There is no earlier console for "' + a.name + '" at ' + file
                            + '. One is kept aside each time a machine starts, so there is none until '
                            + 'it has been started twice with its console being captured.');
                    }
                    throw new Error('Nothing has been written to ' + file + '. Either the console is '
                        + 'not being captured — vmSerial --name ' + a.name + ' turns it on, with the '
                        + 'machine off — or the guest has not been told to use ttyS0, which is a '
                        + 'kernel command line and needs provisioning.');
                }

                var all = text.split(/\r?\n/);
                var rows = a.find ? all.filter(function (l) { return new RegExp(a.find, 'i').test(l); }) : all;
                var want = Math.max(1, Math.min(Number(a.lines) || 200, 5000));

                return {
                    file: file,
                    which: back ? 'the boot before this one' : 'this boot',
                    lines: rows.slice(-want),
                    //HOW LONG THE FILE IS, so a reader can ask for only what is
                    //new next time rather than redrawing a megabyte.
                    of: all.length,
                    matched: a.find ? rows.length : null,

                    //AN EMPTY FILE IS A DIAGNOSIS, NOT AN ABSENCE. The port is
                    //there and the guest is not talking through it, which is a
                    //different fault from the port not being there.
                    note: all.length <= 1
                        ? file + ' exists and is empty. The port is there and the guest is not '
                            + 'talking through it — its kernel command line needs console=ttyS0,115200n8.'
                        : 'The last ' + Math.min(want, rows.length) + ' of ' + all.length
                            + ' lines the guest wrote to its console'
                            + (back ? ' the time before this one' : '') + '.'
                };
            }
        }));

        undo.push(actions.define('vmScreenshot', {
            about: 'A photograph of what is on a machine\'s screen right now',
            takes: ['name'],
            run: async function (args) {
                var name = (args || {}).name;
                ours.get(name);

                //THE ONLY THING THAT ANSWERS "working or stuck" before a machine
                //can be talked to. An unattended install is twenty-five minutes
                //with no agent, no network and no channel; this and the console
                //are the whole of what can be known about it.
                //
                //NAMED BY THE MOMENT rather than by the machine, so a second
                //photograph does not overwrite the one somebody is looking at —
                //two shots of a machine that changed are the whole point.
                //---- THE FOLDER IS MADE, BECAUSE `at()` ONLY JOINS -----------
                //
                //../../core/datadir builds a path and never creates anything, so
                //every caller makes its own directory. This one did not, and
                //VirtualBox answered `VERR_PATH_NOT_FOUND` — at the exact moment
                //a photograph was the only thing that could say whether a
                //machine mid-install was working or stuck. It is the one
                //diagnostic that answers that question, and it was the one that
                //failed.
                var where = imports.dataDir.at('shots');
                require('fs').mkdirSync(where, { recursive: true });

                var file = path.join(where, name + '-' + stamp() + '.png');

                return { name: name, file: await vbox.screenshot(name, file) };
            }
        }));

        //---- SETTING A MACHINE'S WORKSPACE UP -------------------------------
        //
        //EVERY REPOSITORY THE WORK IS ABOUT, ON ONE BRANCH, POINTED BACK HERE.
        //
        //The deciding is ../../repositories/repos/setting-up.js and the script is its
        //workspace.js — both reached through the `repoWorkspaces` service, and neither
        //runs anything. What is left here is the order of the three acts that DO
        //something, and that order is the design:
        //
        //  1. the host steps off the branch, or says whose work is in the way
        //  2. the machine is handed the script
        //  3. and ONLY THEN is the branch recorded
        //
        //THE RECORDING IS LAST BECAUSE IT IS A PERMISSION. What a machine may
        //push is checked against this record — the machine knows which branch it
        //is on and cannot be trusted to say so, since being the thing the rule is
        //about is exactly what disqualifies it as the source. Written before the
        //setup, a machine that never got its workspace would have been given
        //permission to push anyway.
        undo.push(actions.define('vmWorkspace', {
            about: 'Set up a machine\'s workspace: every repository, on one branch, pointed back here',
            needs: 'workspace',
            takes: ['name', 'branch', 'reading', 'folder', 'task'],
            run: async function (args) {
                var a = args || {};
                var to = log.on('vm', a.name);

                var plan = await repoWorkspaces.plan(a.name, {
                    branch: a.branch, reading: a.reading, folder: a.folder
                });

                //SAID BEFORE ANYTHING IS DONE, so a person watching the live log
                //knows what this machine is about to be able to reach.
                if (plan.reading) {
                    to.info('reading "' + plan.reading.branch + '" in ' + plan.reading.repo + ' at '
                        + String(plan.reading.head).slice(0, 7) + '; everything else on its default');
                } else {
                    to.info('"' + plan.branch + '" exists in ' + plan.in.join(', ')
                        + (plan.group ? ' — the "' + plan.group + '" line' : '')
                        + (plan.gone.length ? ', which also named ' + plan.gone.join(', ')
                            + ', no longer here' : ''));
                }

                //---- 1. THE HOST STEPS OUT OF THE WAY -----------------------
                //
                //ONLY WHEN WORKING. A reading machine pushes nothing, and the
                //defaults are what the host normally sits on — so doing this
                //would move somebody's own checkouts for a machine that is only
                //looking.
                if (!plan.reading) {
                    var freed = await repoWorkspaces.freeEverywhere(plan.branch);
                    for (var i = 0; i < freed.length; i++) {
                        if (freed[i].busy) throw new Error(freed[i].why);
                        to.info(freed[i].repo + ' was on ' + freed[i].from + ' here; moved it back to '
                            + freed[i].to + ' so ' + a.name + ' can use it');
                    }
                }

                //---- 2. THE MACHINE IS HANDED THE SCRIPT --------------------
                var vm = ours.get(a.name);
                //NOT `host`, WHICH IN THIS FILE IS ALREADY `imports.app.host`.
                //A local of that name would shadow it for the whole function, and
                //the app being ported from paid for exactly this shape once with
                //`log`: the shadowed logger threw `log.on is not a function`
                //AFTER a credential had already landed on the machine.
                var hostAddr = await vbox.hostAddress();
                var keys = await imports.tls.ensure();

                var script = repoWorkspaces.script({
                    repos: plan.repos,
                    branch: plan.branch,
                    on: plan.on,
                    folder: a.folder || repoWorkspaces.folderFor(vm.spec),
                    origin: 'https://' + hostAddr + ':' + imports.guestApi.PORT,
                    machine: a.name,
                    token: (vm.spec || {}).token,
                    ca: String(keys.ca || ''),
                    readOnly: plan.readOnly,

                    //WHAT THIS MACHINE IS FOR, left on the machine. Every path
                    //that puts a task on one comes through here — the queue, a
                    //hand-over, taking one by hand — so this is the one place
                    //that knows and the one place it has to be written.
                    task: a.task || null
                });

                var r = await imports.channel.run(a.name, script, {
                    what: 'setting up the workspace on ' + plan.branch,
                    timeout: 10 * 60 * 1000
                });

                if (r.code !== 0) {
                    throw new Error('The workspace was not fully set up on ' + a.name
                        + ' — see the live log.');
                }

                //---- 3. AND ONLY THEN IS THE BRANCH RECORDED ----------------
                if (plan.claims) {
                    ours.update(a.name, { branch: plan.claims });
                    to.good(a.name + ' may now push ' + plan.claims + ', and nothing else');
                } else {
                    //A READING MACHINE CLAIMS NOTHING, and this is the record
                    //saying so.
                    to.good(a.name + ' is set up to read ' + plan.reading.repo + '/'
                        + plan.reading.branch + '; it claims nothing and may push nothing');
                }

                return {
                    branch: plan.branch,
                    reading: plan.reading
                        ? Object.assign({}, plan.reading, { everyRepo: plan.repos })
                        : null,
                    folder: a.folder || repoWorkspaces.folderFor(vm.spec),
                    repos: plan.repos,
                    in: plan.in,
                    readOnly: plan.readOnly,
                    output: r.output
                };
            }
        }));
    }

    await register(null, { onDestroy: function () { while (undo.length) undo.pop()(); } });
}
module.exports = plugin;
