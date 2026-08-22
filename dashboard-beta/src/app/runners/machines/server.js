var path = require('path');
var makeLifecycle = require('./lifecycle');
var makeSpeaking = require('./speaking');
var makeRestoring = require('./restoring');
var makeAwaiting = require('./awaiting');

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

plugin.consumes = ['app', 'log', 'vbox', 'ours', 'busy', 'channel', 'dataDir'];
plugin.provides = [];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log;

    var vbox = imports.vbox;
    var ours = imports.ours;

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
                var file = path.join(imports.dataDir.at('shots'),
                    name + '-' + stamp() + '.png');

                return { name: name, file: await vbox.screenshot(name, file) };
            }
        }));
    }

    await register(null, { onDestroy: function () { while (undo.length) undo.pop()(); } });
}
module.exports = plugin;
