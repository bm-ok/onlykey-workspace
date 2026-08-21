var fs = require('fs');

var records = require('./records');
var roles = require('./roles');

//---------------------------------------------------------------------------
//THE VIRTUAL MACHINES THIS APP MADE, AND ONLY THOSE.
//
//THIS REGISTRY IS A SAFETY BOUNDARY, NOT BOOKKEEPING. The app can power off,
//snapshot, restore and DELETE what it lists — so it must never list a machine
//somebody else made. VirtualBox is asked for LIVE STATE, but never for the
//MEMBERSHIP of this list: anything not created here is invisible to every
//action that goes through it, which is a stronger guarantee than remembering to
//be careful at each one.
//
//WHICH IS WHY IT IS ITS OWN PLUGIN RATHER THAN PART OF THE DRIVER. `vbox` knows
//HOW to drive VirtualBox; this knows WHICH machines may be driven. Folded into
//the driver, "delete this machine" would be one forgotten check away from
//deleting a machine this app never created.
//---------------------------------------------------------------------------

module.exports = function ours(deps) {
    var d = deps || {};
    var doc = d.doc;                                   //state.app.doc('machines')
    var say = d.say || function () { return { bad: function () {}, info: function () {} }; };
    var vbox = d.vbox || null;
    //WHETHER ITS AGENT IS TALKING TO US, which is a different question from
    //whether VirtualBox says it is powered on — and one nothing here can answer.
    //Passed in, and answering "no" until vms/channel is across.
    var connected = d.connected || function () { return false; };
    var agentFor = d.agentFor || function () { return null; };
    var now = d.now || function () { return new Date().toISOString(); };

    //---- what is written down ---------------------------------------------

    function read() {
        var kept = doc.read(null);

        //A DOCUMENT THAT IS THERE AND UNREADABLE IS NOT "no machines yet", and
        //the difference matters more here than anywhere else in the app: the
        //quiet answer is an empty registry, and an empty registry means every
        //machine on this host has become untouchable. Said out loud, once.
        if (kept === null) {
            var there = false;
            try { there = fs.existsSync(doc.path); } catch (e) { there = false; }
            if (there) {
                say('vm').bad(doc.path + ' could not be read. Fix or delete it; '
                    + 'no machine is listed until then.');
            }
            return [];
        }

        //A LONE OBJECT WHERE A LIST WAS EXPECTED is somebody having edited the
        //file by hand, and reading it as "there are none" is the worst of the
        //available answers.
        var list = Array.isArray(kept) ? kept : [kept];

        //EVERY READER COMES THROUGH HERE — the queue, the pane, update() — so
        //the filling-in happens once rather than at each place that asks.
        return list.map(records.asRecorded);
    }

    function write(list) { return doc.write(list); }

    function get(name) {
        var vm = read().filter(function (v) { return v.name === name; })[0];

        //DELIBERATELY THE SAME ANSWER as for a machine that exists but was not
        //made here. Nothing outside this registry is actionable, and saying so
        //any more precisely would be a way to probe what else is on the host.
        if (!vm) {
            throw new Error('"' + name + '" is not a virtual machine this app made, '
                + 'so it will not touch it.');
        }
        return vm;
    }

    function has(name) {
        return read().some(function (v) { return v.name === name; });
    }

    function add(spec) {
        var s = spec || {};
        if (!s.name) throw new Error('A virtual machine needs a name.');

        var list = read();
        if (list.some(function (v) { return v.name === s.name; })) {
            throw new Error('This app already has a virtual machine called "' + s.name + '".');
        }

        var vm = records.newRecord(s, now());
        write(list.concat([vm]));
        return vm;
    }

    function update(name, patch) {
        var list = read();
        var vm = list.filter(function (v) { return v.name === name; })[0];
        if (!vm) return null;

        //THE NAME IS NOT PATCHABLE. It is what every other action addresses this
        //machine by, and what VirtualBox knows it as — renaming it in the
        //register alone would make the machine unreachable and unforgettable at
        //the same time.
        var k;
        for (k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) vm[k] = patch[k];
        vm.name = name;

        write(list);
        return vm;
    }

    //FORGETTING IS NOT DELETING, and the message says so because the two are one
    //click apart and only one of them can be undone.
    function forget(name) {
        var vm = get(name);
        write(read().filter(function (v) { return v.name !== name; }));
        say('vm', name).info('Removed "' + name + '" from this app\'s list. '
            + 'The virtual machine itself was not deleted.');
        return { forgotten: vm.name };
    }

    //---- the list somebody looks at ---------------------------------------
    //
    //OURS ONLY, WITH LIVE STATE ATTACHED. The membership comes from the file;
    //VirtualBox is asked only about the machines already in it.
    async function all() {
        var mine = read();
        var available = vbox ? vbox.available() : false;

        if (!mine.length) return { available: available, vms: [] };

        //NO VirtualBox IS NOT NO MACHINES. The records are still what this app
        //made, and a host where it has been uninstalled should say that rather
        //than appear to have lost them.
        if (!available) {
            return {
                available: false,
                vms: mine.map(function (vm) {
                    return Object.assign({}, vm, { live: false, state: 'unknown', stage: 'defined' });
                })
            };
        }

        //TWO LISTS, ONE ROUND TRIP EACH, rather than two questions per machine.
        var both = await Promise.all([vbox.listAll(), vbox.runningAll()]);
        var defined = both[0];
        var up = {};
        both[1].forEach(function (v) { up[v.name] = true; });

        var vms = [];
        for (var i = 0; i < mine.length; i++) {
            var vm = mine[i];
            var live = defined.some(function (v) { return v.name === vm.name; });
            var agent = agentFor(vm.name);
            var talking = connected(vm.name);

            vms.push(Object.assign({}, vm, {
                live: live,
                running: !!up[vm.name],
                state: live ? await vbox.state(vm.name) : 'missing',
                stage: records.stageOf(vm, { live: live, connected: talking }),
                connected: talking,

                //AND A THIRD QUESTION AGAIN: whether anybody has a DESKTOP on it.
                //
                //The agent starts as soon as the network works, a minute or two
                //before a graphical session exists — so a machine reports itself
                //connected while it is still showing a splash screen. Anything
                //that needs a display, an editor or a browser sign-in, arrives
                //too early and fails for a reason that points nowhere near the
                //cause.
                desktop: !!((agent || {}).facts || {}).desktop,

                //AND WHETHER IT WAS EVER MEANT TO HAVE ONE, which is a fact about
                //how it was built and is answerable with the machine switched
                //off. Missing means yes, deliberately: every machine made before
                //this existed was installed from a desktop image and has one.
                desktopWanted: (vm.spec || {}).desktop !== false,

                //WHAT IT IS FOR, READ FROM THE TAG rather than from the spec
                //flag. The tag is what every reader acts on, and two sources for
                //one answer is how they come to disagree — the flag is what put
                //the tag there, and nothing may move it afterwards.
                //
                //`kind` IS NULL FOR A MACHINE THAT IS BOTH, on purpose: there is
                //no single answer, and anything comparing against one would be
                //picking a winner silently. `kindSaid` is for a card to read and
                //nothing else.
                supervisor: roles.canBe(vm, 'supervisor'),
                judge: roles.canBe(vm, 'judge'),
                kind: roles.kindOf(vm),
                kinds: roles.kindsOf(vm),
                kindSaid: roles.kindSaid(vm),

                agent: agent
            }));
        }

        return { available: true, vms: vms };
    }

    return {
        read: read, get: get, has: has,
        add: add, update: update, forget: forget,
        all: all
    };
};
