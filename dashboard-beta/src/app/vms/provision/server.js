var path = require('path');

var makeSpec = require('./spec');
var makeScripts = require('./scripts');
var makeBuilding = require('./building');
var makeSettling = require('./settling');
var makeInstalling = require('./installing');
var makeRepairs = require('./repairs');
var makeGuestApi = require('./guestapi');
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

plugin.consumes = ['app', 'log', 'ours', 'channel', 'vbox', 'dataDir', 'tls', 'cron', 'guestApi'];
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

    //---- the machines that already existed when a rule arrived --------------
    //
    //JOBS RATHER THAN A STARTUP STEP, and the version this comes from made the
    //argument itself: "a machine that is up right now gets its port the next
    //time it is off, and this is called again on the next start". VirtualBox
    //will not add a serial port to a RUNNING machine, so the machine that most
    //needs one is exactly the one a startup sweep always skips — and the repair
    //then waited for somebody to restart the app.
    //
    //AND THEY BECOME ANSWERABLE. ../../core/cron can say when each last ran,
    //what it found and whether it is failing, which a startup step could not be
    //asked. That is the whole point of rounding these up.
    var fix = makeRepairs({
        vbox: vbox,
        ours: ours,
        say: imports.log.on,
        //THE SAME FILE ./building.js WOULD HAVE CHOSEN. Two opinions about where
        //a console goes is a record naming a file nothing writes to.
        serialFor: build.serialFor
    });

    //AUTOSTARTED, because both only read the register and repair configuration
    //on a machine that is switched off. Neither gives a machine work — that is
    //the line ../../core/cron/schedule.js draws, and the queue's job is on the
    //other side of it.
    imports.cron.add({
        name: 'machine-consoles',
        every: 300000,
        autoStart: true,
        about: 'Gives a console to a machine built before every machine had one, once it is off'
    });
    var stopConsoles = imports.cron.does('machine-consoles', function () { return fix.consoles(); });

    imports.cron.add({
        name: 'machine-pools',
        every: 300000,
        autoStart: true,
        about: 'Puts a machine that carries no tag into the ordinary pool — every machine is in one'
    });
    var stopPools = imports.cron.does('machine-pools', function () { return fix.pools(); });

    //---- and what a machine may ask this plugin for ------------------------
    //
    //REGISTERED WITH ../https RATHER THAN SERVED HERE. That plugin owns the
    //certificate, the port and proving which machine is asking; this one owns
    //the verbs and the sentence about who may have them — see ./guestapi.js.
    var stopServing = imports.guestApi.api(makeGuestApi({
        scripts: scripts,
        settle: settle,
        say: imports.log.on,

        //WHAT A RENDERED SCRIPT IS TOLD ABOUT THIS HOST. Asked at the moment it
        //is rendered rather than remembered: the address can change between one
        //machine being built and the next, and a script carrying yesterday's is
        //a machine that cannot reach anything.
        where: async function () {
            return {
                hostAddress: await vbox.hostAddress().catch(function () { return '127.0.0.1'; }),
                port: imports.guestApi.PORT,
                channelPort: imports.guestApi.CHANNEL_PORT,
                caPort: imports.guestApi.CA_PORT,
                caFingerprint: imports.tls.ensure().fingerprint
            };
        }
    }));

    //---- AND THE DOOR IS ACTUALLY OPENED -----------------------------------
    //
    //NOBODY WAS CALLING THIS. Every plugin registered its verbs correctly, the
    //registry matched them correctly, and no socket was ever bound — so a
    //machine built by this app would have had nowhere to report to, nowhere to
    //fetch its scripts from, and nowhere to dial in. It would have installed for
    //twenty-five minutes and then looked exactly like a machine that had wedged.
    //
    //HERE BECAUSE `onHello` HAS TO COME FROM SOMEWHERE, and ../https says so in
    //its own header: it cannot consume this plugin to get the handler, because
    //this plugin consumes IT to register verbs, and the graph would be a cycle.
    //So whoever has the dial-in work calls listen and hands it over. That is
    //this plugin — ./settling.js's `firstSnapshotIfItNeedsOne` IS the dial-in
    //work, and it was written for this moment and never reached.
    //OPENING THE DOOR MUST NOT BE ABLE TO TAKE THE APP DOWN WITH IT.
    //
    //`listen` reaches for the certificate before it binds anything, and a host
    //with no data directory — the test suite builds server halves against a bare
    //one — has no certificate to reach for. Letting that throw here took the
    //WHOLE plugin graph down: six failures, none of them mentioning a port.
    //
    //So it is caught and SAID, never swallowed. A door that would not open is
    //the failure that otherwise looks like nothing at all, and the difference
    //between "no machines are talking to us" and "we never opened the socket" is
    //not something anybody downstream can work out.
    var opened = { refused: [] };
    try {
        opened = await imports.guestApi.listen({
            //A MACHINE'S FIRST WORDS. It has finished installing and booted into
            //the system it installed, which is the one moment a clean snapshot
            //means anything — see ./settling.js, which decides whether it is.
            onHello: function (name) {
                return settle.firstSnapshotIfItNeedsOne(name);
            }
        });
    } catch (e) {
        opened = { refused: [{ what: 'everything', port: imports.guestApi.PORT, why: e.message }] };
    }

    //EVERY ONE OF THESE IS A MACHINE THAT WILL NOT BE ABLE TO REACH THIS HOST,
    //and the reason is knowable HERE and nowhere downstream.
    (opened.refused || []).forEach(function (no) {
        log.bad('nothing is listening for machines on ' + no.what + ' port ' + no.port
            + ' — ' + no.why + '. A machine built now would install and never report back.');
    });

    await register(null, {
        //THE NODE BUNDLE IS REBUILT ON EVERY SAVE, so what this registered has
        //to come off again or a save leaves two of it — see ../channel/server.js.
        //THE SOCKETS TOO: ../https closes them, and a save that left one bound
        //would stop the next load from binding at all.
        onDestroy: function () { stopConsoles(); stopPools(); stopServing(); imports.guestApi.close(); },

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
