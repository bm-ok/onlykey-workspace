var path = require('path');

var bootstrap = require('./bootstrap');

//---------------------------------------------------------------------------
//GETTING AN OPERATING SYSTEM ONTO A MACHINE.
//
//THIS IS AN ORDER, not a set of commands. Almost every line delegates —
//./building.js makes the machine, ./bootstrap.js writes the one command line the
//install is trusted with, ./autoinstall.js fills in the template — and what is
//left here is the sequence, which is the part that has actually been wrong.
//
//---- a machine is built from nothing, never reused -------------------------
//
//Installing used to keep the machine and replace only its disk. Everything else
//came along: the snapshots, which are points on a disk that no longer existed;
//the MAC addresses; whatever `modifyvm` had been told by a version of this app
//that has since changed its mind.
//
//That produced a machine with a fresh operating system and a base snapshot from
//an hour earlier, pointing at a disk that had been deleted underneath it.
//NOTHING FAILED. The queue would have taken that machine, worked on it, and
//found out at the moment it tried to put it away.
//
//So the VirtualBox machine is DESTROYED and made again from the spec this app
//holds. The spec is the machine's definition; the thing in VirtualBox is a build
//of it, and a build is cheap. What survives is what should: its name, its size,
//its key, its token, and its place in this app's register.
//
//The cost is honest and worth stating: new MAC addresses, so a new host-only
//lease and a new address on the network, and any snapshot anybody was keeping is
//gone. That is what "install" has always meant here.
//---------------------------------------------------------------------------

module.exports = function installing(deps) {
    var d = deps || {};
    var vbox = d.vbox;
    var ours = d.ours;
    var channel = d.channel;
    var tls = d.tls;
    var build = d.build;
    var template = d.template;
    var say = d.say || function () {
        var to = { good: function () {}, warn: function () {}, info: function () {}, bad: function () {}, out: function () {}, on: function () { return to; } };
        return to;
    };

    async function install(name, where) {
        var at = where || {};
        var vm = ours.get(name);
        var spec = vm.spec;
        var to = say('vm', name);

        if (!spec.iso) throw new Error('"' + name + '" has no installer image, so there is nothing to install.');
        var iso = await build.resolveISO(spec.iso);
        if (!await vbox.isOff(name)) throw new Error('"' + name + '" is running. Shut it down before installing.');

        //---- from nothing ---------------------------------------------------
        var rebuilt = await vbox.exists(name);
        if (rebuilt) {
            to.info('removing the existing machine, so this install starts from nothing '
                + 'rather than from whatever it was carrying');

            //THE CHANNEL GOES FIRST. A force-stop sends no FIN, so a machine
            //reads as connected for another seventy seconds — and this is about
            //to destroy it.
            channel.drop(name, 'is being rebuilt');
            await vbox.destroy(name);

            //WHAT THE OLD BUILD CARRIED IS NOT TRUE OF THE NEW ONE. The
            //snapshots pointed at a disk that no longer exists, and a branch or
            //a borrow belonged to work on a machine that is gone.
            ours.update(name, { baseSnapshot: null, snapshots: {}, branch: null, borrowed: null });

            var made = await build.buildInVbox(spec, to);

            //AND THE CONSOLE COMES BACK WITH IT.
            //
            //The serial port is configuration ON the VirtualBox machine, so
            //destroying the build destroyed it — while this app's own record
            //still said the console was being captured. That is the worst kind
            //of instrument: a terminal open on a file that will never grow
            //again, saying nothing, while the install it was opened to watch
            //runs invisibly. Reported as "the serial never reconnected".
            //
            //TAKEN FROM WHAT THE BUILD RETURNED rather than worked out again
            //here. ./building.js decided where it goes; a second opinion about
            //that is how the record comes to name a file nothing writes to.
            ours.update(name, { serial: made.serial });
            if (made.serial) {
                to.info('its console is captured again on the new build, at ' + path.basename(made.serial));
            }
            to.good(name + ' is a new machine again — installing onto it');
        }

        //A BLANK DISK, EVERY TIME, and this is not tidiness.
        //
        //The boot order is disk before dvd, so a machine whose disk already
        //boots never reaches the installer at all — it just starts the operating
        //system that is already there. Installing a second time therefore did
        //nothing, while the dashboard reported "installing" and the machine sat
        //at a login screen: the state said one thing, the screen said another,
        //and nothing failed.
        //
        //ONLY WHEN IT WAS NOT JUST REBUILT. A rebuild has already made a disk
        //that has never held anything, and blanking it again would delete and
        //recreate a file one minute old.
        if (!rebuilt) await build.blankTheDisk(name, spec, to);

        var host = await vbox.hostAddress();

        //---- the one credential a machine with nothing on it can hold --------
        //
        //Scripts carry the machine's TOKEN, so they cannot be handed to whoever
        //asks — but a machine being installed has no token yet to prove itself
        //with. The ticket bridges exactly that gap: made here, carried on the
        //installer's command line, and DEAD the moment the machine dials in,
        //which is the moment it has a token instead.
        //
        //MADE FRESH PER INSTALL rather than kept on the machine, because the
        //command line outlives the install: VirtualBox writes it into
        //`vboxpostinstall.sh` in the machine's folder, where it stays. A token
        //there would be a live secret in a plain file; a spent ticket is a
        //string that opens nothing.
        var ticket = channel.newToken();
        ours.update(name, { installTicket: ticket });

        //ONLY ONE SCRIPT IS NAMED HERE. What it then fetches and in what order
        //is decided in first-boot.sh, which anyone can edit or replace — so
        //changing how a machine is built never means touching this app.
        var url = 'https://' + host + ':' + at.port + '/provision/first-boot.sh'
            + '?vm=' + encodeURIComponent(name) + '&ticket=' + ticket;
        var caUrl = 'http://' + host + ':' + at.caPort + '/ca.pem';

        //THE TRUST ANCHOR, and the only one available at this moment — see
        //./bootstrap.js, which refuses to build a line that would check nothing.
        var inner = bootstrap.bootstrapLine({
            caUrl: caUrl,
            scriptUrl: url,
            fingerprint: tls.ensure().fingerprint
        });

        //---- a way to watch it ----------------------------------------------
        var extra = template.fill(name, spec.sshKey);
        if (!extra.file) {
            to.warn("installing without the dashboard's autoinstall additions (" + extra.why + ')'
                + ' — the install will not be watchable over the serial port or ssh');
        } else if (extra.lost) {
            to.warn(extra.lost);
        }

        var args = ['unattended', 'install', name, '--iso', iso];
        if (extra.file) args = args.concat(['--script-template', extra.file]);
        args = args.concat([
            '--user', spec.user,
            '--password', spec.password || 'okc',
            '--full-user-name', spec.fullName,
            '--hostname', spec.hostname.indexOf('.') >= 0 ? spec.hostname : spec.hostname + '.local',
            '--locale', spec.locale,
            '--time-zone', spec.timeZone,
            '--post-install-command', 'bash -c "' + inner + '"'
        ]);
        //---- NO `--install-additions`, AND THE ADDITIONS STILL ARRIVE --------
        //
        //THIS PASSED IT WHENEVER `spec.installAdditions` WAS SET, and that flag
        //follows `desktop`. It is what made VirtualBox splice a `packages:` list
        //into the autoinstall -- build-essential, linux-headers-generic, dkms --
        //so it could BUILD the additions kernel modules mid-install.
        //
        //THAT KILLED THE INSTALL ON EVERY MACHINE WITH A SCREEN. A live-server
        //install has no package index but the CD's, so the download resolved to
        //`E: Unable to locate package build-essential` and exit 100. See the
        //note in ./scripts/autoinstall-user-data for the whole trail.
        //
        //SO THE ADDITIONS ARE POST-BOOT NOW, like everything else this app puts
        //on a machine: `virtualbox-guest-utils` in ./scripts/toolchain.sh for
        //the mount helper and the clock, `virtualbox-guest-x11` in
        //./scripts/desktop.sh for clipboard and resize. Ubuntu already ships the
        //kernel half, so none of it is compiled and none of it needs a compiler
        //at install time.
        //
        //`spec.installAdditions` IS GONE from ../provision/spec.js with this. A
        //flag nothing reads is worse than no flag: it reads as a switch somebody
        //can still turn.
        args.push('--start-vm', 'gui');

        to.info('installing ' + path.basename(iso) + ' on ' + name + '; it will fetch its setup from ' + url);
        ours.update(name, { installing: new Date().toISOString(), reported: null });

        //VBoxManage ECHOES BACK EVERY VALUE IT WAS GIVEN, INCLUDING THE
        //PASSWORD. The log is kept and read later, so a secret reaching it is a
        //secret permanently written down.
        //
        //The field lines are where it actually appears and those are always
        //redacted. Blanking the password everywhere as well is only safe when it
        //is long enough to be distinctive: a password of "okc" turned
        //okc-flow.local into <hidden>-flow.local and okc-bootstrap.sh into
        //<hidden>-bootstrap.sh, which makes the log lie about names for no
        //security gain.
        var secrets = [spec.password].filter(function (s) {
            return s && s.length >= 8 && name.indexOf(s) < 0;
        });

        try {
            var out = await vbox.run(args, { timeout: 300000, quiet: true });
            String(out).split('\n').forEach(function (raw) {
                var line = raw.trim();
                if (!line) return;
                if (/^\s*(user-|admin-)?password\s*=/.test(line)) line = line.replace(/=.*/, '= <hidden>');
                secrets.forEach(function (s) { line = line.split(s).join('<hidden>'); });
                to.out(line);
            });
        } catch (e) {
            var why = e.message;
            secrets.forEach(function (s) { why = why.split(s).join('<hidden>'); });

            //THE FLAG COMES OFF ON THE WAY OUT. A machine left marked
            //"installing" by a failure is one nothing will start, install or
            //pick up, and the Runners tab says it is busy doing something that
            //stopped.
            ours.update(name, { installing: null });
            throw new Error(why);
        }

        to.good(name + ' is installing. It takes a while, and will report back here when it is up.');
        return { name: name, iso: iso, url: url };
    }

    return { install: install };
};
