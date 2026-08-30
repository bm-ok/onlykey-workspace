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

//---- BUILDING A MACHINE NEEDS TWO KEYS, AND NOW IT SAYS SO -----------------
//
//    tls    the authority a guest checks before it trusts anything this host
//           says — ../../core/tls
//    ssh    the ssh key that makes the machine reachable at all — ../../core/ssh
//
//THE SECOND ONE WAS NOT DECLARED AND WAS NOT ASKED FOR. `spec.sshKey` defaulted
//to an empty string, so every machine built here was unreachable, and the only
//sign was a warning twenty lines into an install: "this machine has no ssh key,
//so the installer environment cannot be logged into". It was found by watching
//an install fail and having no way in to see why.
//
//That is the argument for this line existing. In the app being ported from, the
//same dependency is one name pulled out of a forty-entry `shared.js`, where
//"what does building a machine actually need" is not a question the source can
//answer. Here it is a list, it is enforced, and a missing one does not build.
plugin.consumes = ['app', 'log', 'ours', 'channel', 'vbox', 'dataDir', 'tls', 'cron', 'guestApi',
    'ssh', 'workspace', 'state'];
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
    //
    //---- THE DEFAULT CAME ACROSS AS `null` -----------------------------------
    //
    //The app being ported from falls back to <repo>/workspace/provision and this
    //did not, so the project's half was fetched only if somebody happened to set
    //an environment variable — and nothing anywhere sets it.
    //
    //IT IS INVISIBLE, BECAUSE A SUPERVISOR STILL WORKS. `supervisor-user.sh` is
    //one of the app's OWN scripts and installs Claude itself, so supervisor
    //machines came up complete and proved the whole install path. A runner's
    //Claude comes from the project's `extra-user.sh` — the app's
    //`toolchain-user.sh` deliberately does not install it — so every runner
    //built here came up without one, installed cleanly, snapshotted, reported
    //ready, and then refused its first job with "claude is not installed on this
    //machine". Fifteen minutes to find that out, with nothing in the install log
    //saying a script had been skipped, because none had: there was no second
    //folder to read.
    //
    //`searchPath` DROPS A FOLDER THAT IS NOT THERE, so naming one costs nothing
    //when a project brings no scripts of its own — see ./scripts.js.
    //---- AND IT IS THE WORKSPACE'S FOLDER, NOT A GUESS AT THE LAYOUT --------
    //
    //The first repair of this walked up from `__dirname` to <repo>/workspace,
    //which is this repository's shape and no other's — the one thing nothing
    //in this app is allowed to know. ../../workspace is the plugin that owns
    //the question, so it is asked.
    //
    //ASKED EACH TIME, NOT ONCE. `workspace.dir()` is async and refuses when
    //nothing is open, and the answer changes when somebody opens a different
    //workspace — so this keeps the last good answer and hands ./scripts.js a
    //function rather than a value. Read once at startup it would be null on a
    //cold boot and stale for every workspace after the first.
    var projectDir = null;

    async function noteProjectDir() {
        try {
            projectDir = path.join(await imports.workspace.dir(), 'provision');
        } catch (e) {
            //NO WORKSPACE OPEN IS NOT A FAULT. Nothing can be built without one
            //either, and `searchPath` drops a folder that is not there.
            projectDir = null;
        }
        return projectDir;
    }

    //---- AND WHERE A PERSON'S OWN COPY IS KEPT -----------------------------
    //
    //THE WORKSPACE'S DRAWER, beside its jobs — which is where everything else
    //somebody authors already lives. A skill written at the window used to be
    //saved back over whichever file it had been READ from, and in a checkout
    //that is the app's own copy inside a build output: the next rebuild copied
    //the shipped one over it and the edit was gone with nothing said.
    //
    //THE SAME SHAPE AS `projectDir` ABOVE, and for the same reason: which
    //workspace is open is not known when this is built and changes when
    //somebody opens another, so ./scripts.js is handed a function.
    var keptDir = null;

    //AND A BUNDLE UNPACKED INTO A WORKSPACE LANDS IN IT. `.okc/provision/` is
    //what a bundle's `provision/` folder is — the same names, byte for byte —
    //so there is one folder and no second place to look. It briefly had one:
    //bundles carried skills as `skills/<which>.md` and this had to look there
    //too. ../../bootstrap/bundle.js carries them under their real names now.
    async function noteKeptDir() {
        try {
            var at = await imports.state.here.where();
            keptDir = at ? path.join(at, 'provision') : null;
        } catch (e) {
            //NO WORKSPACE OPEN IS NOT A FAULT, exactly as above: `searchPath`
            //drops a folder that is not there, and the app's shipped copy
            //answers instead.
            keptDir = null;
        }
        return keptDir;
    }

    //BOTH TOGETHER, BECAUSE THEY ARE ONE QUESTION -- which workspace is open.
    //Refreshing one and not the other is how a machine gets this project's
    //scripts and last project's skills.
    async function noteWhere() {
        await noteProjectDir();
        await noteKeptDir();
        return { project: projectDir, kept: keptDir };
    }

    var scripts = makeScripts({
        appDir: appDir,
        workspaceDir: function () { return projectDir; },
        keptDir: function () { return keptDir; }
    });

    //LEARNED NOW, NOT WHEN SOMETHING HAPPENS TO ASK. `keptDir` was null from
    //the moment this half was rebuilt -- which is every save -- until a
    //machine dialled in or a skill was saved, and in that window every read
    //of a skill resolved to the app's shipped copy over the one a person had
    //approved. `skillReading` answered 32k characters about a 38k file, and
    //said nothing was wrong. Fire-and-forget: a state that is not ready yet
    //answers null and the next asker notes again.
    Promise.resolve().then(noteWhere).catch(function () { /* noted by the next asker */ });

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

        //WHICH WORKSPACE THIS IS BEING BUILT FOR, asked now rather than at
        //startup: a machine is built for the workspace that is open when it is
        //built, and that is where its scripts come from.
        //
        //BOTH HALVES, because they are one question. A machine built with this
        //project's scripts and last project's skills is the failure refreshing
        //only one of them produces.
        await noteWhere();

        //---- THE APP'S OWN SSH KEY, UNLESS ONE WAS NAMED ------------------
        //
        //MADE IF IT IS NOT THERE, which is the first thing that ever asks for
        //it — so the key comes into existence the first time a machine is built
        //rather than needing anybody to think of it.
        //
        //A CALLER MAY STILL PASS ONE and it wins: putting somebody's own key on
        //a machine is a real thing to want. What is fixed is the DEFAULT, which
        //used to be an empty string and made every machine unreachable.
        var built = spec.fill(Object.assign({}, input, {
            sshKey: (input && input.sshKey) || imports.ssh.ensure().publicKey || ''
        }));
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

        //WHICH WORKSPACE'S SCRIPTS, ASKED PER REQUEST. See ./guestapi.js: a
        //machine asks for these long after it was made, and this half is
        //rebuilt on every save in between.
        freshen: noteWhere,

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
            onHello: function (name, seen) {
                //---- THE INSTALL TICKET DIES HERE ------------------------
                //
                //IT HAS A TOKEN NOW, so the ticket has nothing left to open —
                //and it must not keep opening things, because the command line
                //that carried it OUTLIVES the install. VirtualBox writes it into
                //`vboxpostinstall.sh` in the machine's folder, where it sits for
                //as long as the machine exists. A live secret in a plain file;
                //a spent ticket is a string that opens nothing.
                //
                //See ../https, which accepts it up to this moment and not after.
                try {
                    ours.update(name, Object.assign({ installTicket: null },
                        (seen && seen.address)
                            ? {
                                //WHERE IT ACTUALLY IS, recorded while it is
                                //still connected. The moment somebody needs to
                                //ssh in and find out why an agent went quiet is
                                //the moment there is no socket left to ask.
                                lastAddress: seen.address,
                                lastUser: seen.user || null,
                                lastSeenAt: new Date().toISOString()
                            }
                            : {}));
                } catch (e) { /* it may already be gone */ }

                //---- AND IT BECOMES REACHABLE BY NAME --------------------
                //
                //HERE BECAUSE THIS IS WHERE ITS ADDRESS IS FIRST KNOWN. The
                //config is rewritten WHOLE from the register — see
                //../../core/ssh — so doing it on every dial-in keeps
                //it true as addresses change, rather than accumulating entries
                //that point at nothing.
                //
                //NEVER FATAL. A machine that came up is a machine that came up;
                //failing to write a convenience file is not a reason to lose it.
                try {
                    imports.ssh.writeConfig(ours.read() || []);
                    imports.ssh.ensureInclude();
                } catch (e) {
                    log.warn('could not write the ssh config: ' + e.message
                        + ' — the machine is up, but `ssh ' + name + '` will not find it by name');
                }

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

            //---- WHERE A PERSON'S OWN COPY GOES, ASKED RATHER THAN GUESSED ---
            //
            //A CALLER THAT WRITES ONE NEEDS THIS AND MUST NOT WORK IT OUT. The
            //search path is this file's arrangement -- what a person wrote, then
            //the project's, then the app's shipped copy -- and a writer that
            //derived its own path would be a second opinion about it, right
            //until the day the two disagreed.
            //
            //IT IS AWAITED, because which workspace is open changes and the
            //answer is refreshed rather than held.
            keptFor: async function (stage) {
                await noteWhere();
                if (!keptDir) return null;
                var name = scripts.STAGES[stage];
                if (!name) throw new Error('"' + stage + '" is not a provisioning stage.');
                return path.join(keptDir, name);
            },
            //THE FOLDER ITSELF, for a caller that writes a file this app has no
            //STAGE for — a bundle carrying a project's own script. `keptFor`
            //answers for a known stage; this answers for the directory, and the
            //caller is held to a plain filename inside it.
            keptDir: async function () {
                await noteWhere();
                return keptDir;
            },

            freshen: noteWhere,
            has: scripts.has,
            list: scripts.list,

            //WHAT THIS WORKSPACE OWN FOLDER HOLDS, which is what a bundle carries.
            //Not the search path -- see ./scripts.js: a bundle carrying the app
            //shipped copies would pin them.
            kept: function () { return scripts.kept(); },

            resolve: scripts.resolve,
            sourceOf: scripts.sourceOf,
            stageOfFile: scripts.stageOfFile,
            searchPath: scripts.searchPath,

            header: header,
            STAGES: scripts.STAGES,
            SERVABLE: makeScripts.SERVABLE
        }
    });
}
module.exports = plugin;
