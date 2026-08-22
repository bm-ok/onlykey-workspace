var path = require('path');

var makeSpec = require('./spec');
var makeScripts = require('./scripts');
var makeBuilding = require('./building');
var makeSettling = require('./settling');
var makeInstalling = require('./installing');
var makeAutoinstall = require('./autoinstall');
var header = require('./header');

//---------------------------------------------------------------------------
//THE SETUP: what a machine is built as, and what it is handed when it boots.
//
//THE SCRIPTS ARE FILES, NOT STRINGS IN HERE, and that is the design rather than
//an accident of how it grew. Making a different KIND of machine is editing or
//replacing a script; a machine's spec can name a different file for any stage.
//So this plugin knows the STAGES and the ORDER and the HEADER, and never what
//any particular step is for.
//
//---- what is here ---------------------------------------------------------
//
//./spec.js    — what a machine is built as, decided once. The flag, the tag and
//               the secret cannot disagree because there is one moment where
//               any of them is set.
//./scripts.js — which file a machine gets for a stage, and the rule that a spec
//               may not name a PATH.
//./header.js  — the block of values every script is given, and the quoting that
//               keeps a typed value from becoming a command on a machine that
//               runs it as root.
//
//./building.js — making one in VirtualBox, which is not the same as making a
//               machine. Mostly an ORDER rather than a set of commands.
//
//---- and making one, which is where the three meet ------------------------
//
//`create` IS SHORT BECAUSE THE THREE KNOW NOTHING ABOUT EACH OTHER. The spec
//decides what it will be, the build makes it, and ../ours writes it down —
//and the only place that has all three is here.
//
//IT CHECKS THE NAME AGAINST ALL OF VirtualBox rather than against our own list.
//The collision that matters is with ANY machine on this host, especially one
//this app must not touch: creating over somebody else's machine is the mistake
//the whole register exists to prevent, and checking only our own would walk
//into it while looking careful.
//
//---- and what is not here yet ---------------------------------------------
//
//NO `vmCreate` ACTION, for the reason ../ours registers no `vmList`: the two
//have to move together. A machine made here goes in THIS app's register, and
//with `vmList` still relayed it would be invisible everywhere — made, running,
//and on no list anybody can see. The pair is a decision about what the Runners
//tab shows, not a step in porting a function.
//
//AND NO `vmInstall` ACTION EITHER, for the same reason and one more: an install
//tells the machine two ports to come back to, and the half that LISTENS on them
//has not moved yet. `install` takes them as arguments rather than deciding
//them, so the plugin that owns those ports can hand them over when it arrives.
//---------------------------------------------------------------------------

plugin.consumes = ['app', 'log', 'ours', 'channel', 'vbox', 'dataDir', 'tls'];
plugin.provides = ['provision'];
async function plugin(imports, register) {
    var log = imports.log.on('vm');
    var ours = imports.ours;
    var vbox = imports.vbox;
    //WHAT THE APP SHIPS. Beside the server bundle, because that is what survives
    //being packaged — see `node: { __dirname: false }` in webpack.config.js.
    var appDir = process.env.OKC_APP_PROVISION_DIR || path.join(__dirname, 'provision');

    //AND WHAT THE PROJECT BRINGS. Outside the app on purpose: project-specific
    //content is exactly what belongs there, and it is why the check that keeps
    //this app generic does not scan it.
    var workspaceDir = process.env.OKC_PROVISION_DIR || null;

    var scripts = makeScripts({ appDir: appDir, workspaceDir: workspaceDir });

    var spec = makeSpec({
        //ISSUED BY THE THING THAT CHECKS THEM. A token this app makes and a
        //token this app accepts must come from one place, or the two drift and
        //the failure is a machine that cannot dial in for a reason nothing
        //explains.
        newToken: imports.channel.newToken,

        //THE TAGS THIS APP GIVES A MEANING TO, from ../ours — where a role is a
        //fact about a machine record. Taken rather than restated, so a supervisor
        //means the same thing at the moment one is BUILT and at the moment the
        //queue decides whether to give it work.
        SUPERVISOR: imports.ours.SUPERVISOR,
        POOL: imports.ours.POOL
    });

    //---- making one --------------------------------------------------------
    //
    //THE THREE HALVES MEET HERE AND NOWHERE ELSE: ./spec.js decides what it will
    //be, ./building.js makes it in VirtualBox, and ../ours writes it down. Each
    //of those knows nothing about the other two, which is why this function is
    //short and why there is only one of it.
    var build = makeBuilding({
        vbox: vbox,
        //ONE FOLDER FOR THE HOST rather than one per machine: "show me what that
        //machine said" should not need to know where the machine lives.
        //ASKED WHEN A MACHINE IS BUILT, NOT WHEN THIS LOADS. ../../core/datadir
        //refuses to answer in a process with no main half behind it, and asking
        //here took the whole server graph down in one that has none — ../../keys
        //and ../../../queue pass a thunk for exactly this reason.
        serialDir: function () { return imports.dataDir.at('serial'); }
    });

    //AND WHAT HAPPENS AFTER IT IS BUILT, which is not part of building it: the
    //guest talking back while it installs, and the first clean snapshot taken at
    //the moment it dials in. Nothing here is on the path that creates anything.
    //`imports.log.on` AND NOT `log.on`: `log` is already scoped to 'vm', and its
    //`.on` APPENDS — so the scoped one would tag every line 'vm','vm',<name>.
    var settle = makeSettling({ vbox: vbox, ours: ours, say: imports.log.on });

    //AND GETTING AN OPERATING SYSTEM ONTO ONE, which is an ORDER rather than a
    //set of commands — see ./installing.js. Every piece it needs is built above;
    //what it adds is the sequence.
    var installer = makeInstalling({
        vbox: vbox,
        ours: ours,
        channel: imports.channel,
        tls: imports.tls,
        build: build,
        //THE TEMPLATE COMES OFF THE SAME SEARCH PATH AS EVERY OTHER
        //PROVISIONING FILE, so a project can replace it — but it is never
        //served to a guest, which is why it is `hostFile` and not `resolve`.
        template: makeAutoinstall({ find: scripts.hostFile, read: scripts.readFile }),
        say: imports.log.on
    });

    async function create(input) {
        if (!vbox.available()) {
            throw new Error('VirtualBox is not installed, or not where this expected to find it.');
        }

        var built = spec.fill(input);
        var to = log.on(built.name);

        //CHECKED AGAINST ALL OF VirtualBox, NOT JUST AGAINST OURS.
        //
        //The collision that matters is with ANY machine on this host, including
        //ones this app must not touch — and especially those: creating over
        //somebody else's machine is the one mistake the whole register exists to
        //make impossible, and checking only our own list would walk straight
        //into it while looking careful.
        if (await vbox.exists(built.name)) {
            throw new Error('VirtualBox already has a machine called "' + built.name + '". '
                + 'Pick another name — this app will not touch a machine it did not make.');
        }

        var made = await build.buildInVbox(built, to);

        //WHAT THE BUILD DECIDED GOES INTO THE RECORD, carried out of the one
        //place that made it. `serial` among the rest: the port was attached as
        //the machine was built, and the register has to say so or the window
        //will not know there is a console to read.
        var vm = ours.add(Object.assign({}, built, {
            iso: made.iso, bridge: made.bridge, disk: made.disk, serial: made.serial
        }));

        to.good(built.name + ' created. It has no operating system yet — install one next.');
        return vm;
    }

    await register(null, {
        provision: {
            fill: spec.fill,
            create: create,

            //THE BUILD, FOR THE ONE OTHER CALLER THERE WILL BE. An install
            //rebuilds a machine from nothing, and it must go through the same
            //path rather than a second one that drifts.
            buildInVbox: build.buildInVbox,
            blankTheDisk: build.blankTheDisk,

            //AFTER IT IS BUILT — see ./settling.js. `base` is also what the
            //vmBaseSnapshot button will call, so a person pressing it and a
            //machine dialling in for the first time go through one function
            //rather than two that drift.
            report: settle.report,
            base: settle.base,
            firstSnapshotIfItNeedsOne: settle.firstSnapshotIfItNeedsOne,

            //THE LONG ONE: an unattended install, twenty-five minutes, watched
            //on the console ./building.js attached. It takes the two ports it
            //should tell the machine to come back to, because the half that
            //LISTENS on them is not this plugin's.
            install: installer.install,
            resolveISO: build.resolveISO,
            pickBridge: build.pickBridge,
            hostOnlyAdapter: build.hostOnlyAdapter,

            render: scripts.render,
            raw: scripts.raw,
            fileFor: scripts.fileFor,
            has: scripts.has,
            list: scripts.list,
            resolve: scripts.resolve,
            sourceOf: scripts.sourceOf,
            stageOfFile: scripts.stageOfFile,
            searchPath: scripts.searchPath,

            header: header,
            STAGES: scripts.STAGES
        }
    });
}
module.exports = plugin;
