//what ../../test/vms/provision-installing.test.js has to be able to catch.
//
//This file is an ORDER rather than a set of commands, so most of these breaks
//move a line rather than delete it — a step that still happens, in the wrong
//place, is the failure shape this module has actually had.
module.exports = {
    file: 'src/app/vms/provision/installing.js',
    test: 'test/vms/provision-installing.test.js',
    breaks: [
        //---- the refusals ---------------------------------------------------

        ['a machine with no installer image is installed anyway',
            "        if (!spec.iso) throw new Error('\"' + name + '\" has no installer image, so there is nothing to install.');",
            ''],

        ['a running machine is rebuilt underneath itself',
            '        if (!await vbox.isOff(name)) throw new Error(\'"\' + name + \'" is running. Shut it down before installing.\');',
            ''],

        //A REFUSAL THAT HAS ALREADY DESTROYED THE MACHINE IS NOT A REFUSAL.
        ['the machine is checked for being off after it has been destroyed',
            '        if (!await vbox.isOff(name)) throw new Error(\'"\' + name + \'" is running. Shut it down before installing.\');\n\n        //---- from nothing ---------------------------------------------------\n        var rebuilt = await vbox.exists(name);',
            '        //---- from nothing ---------------------------------------------------\n        var rebuilt = await vbox.exists(name);'],

        //---- from nothing ---------------------------------------------------

        //A FORCE-STOP SENDS NO FIN, so a machine reads as connected for another
        //seventy seconds — and this is about to destroy it.
        ['the machine is destroyed while its channel is still held open',
            "            channel.drop(name, 'is being rebuilt');\n            await vbox.destroy(name);",
            "            await vbox.destroy(name);\n            channel.drop(name, 'is being rebuilt');"],

        ['the channel is never dropped at all',
            "            channel.drop(name, 'is being rebuilt');",
            ''],

        ['the existing build is kept and only its disk replaced',
            '            await vbox.destroy(name);',
            ''],

        //WHAT THE OLD BUILD CARRIED IS NOT TRUE OF THE NEW ONE. Snapshots are
        //points on a disk that no longer exists, and nothing fails until the
        //queue tries to put the machine away.
        ['the snapshots survive the machine they were points on',
            '            ours.update(name, { baseSnapshot: null, snapshots: {}, branch: null, borrowed: null });',
            ''],

        ['it keeps the base snapshot while replacing the disk under it',
            'baseSnapshot: null, snapshots: {}, branch: null, borrowed: null',
            'branch: null, borrowed: null'],

        ['a branch claimed by work on the old machine survives it',
            'baseSnapshot: null, snapshots: {}, branch: null, borrowed: null',
            'baseSnapshot: null, snapshots: {}'],

        //THE CONSOLE COMES BACK WITH THE BUILD, or the record names a file
        //nothing will ever write to again.
        ['the record still names the console of a machine that was destroyed',
            '            ours.update(name, { serial: made.serial });',
            ''],

        //A BLANK DISK, EVERY TIME. The boot order is disk before dvd, so a
        //machine whose disk already boots never reaches the installer.
        ['a machine that was not rebuilt boots what is already on its disk',
            '        if (!rebuilt) await build.blankTheDisk(name, spec, to);',
            ''],

        ['a disk one minute old is deleted and made again',
            '        if (!rebuilt) await build.blankTheDisk(name, spec, to);',
            '        await build.blankTheDisk(name, spec, to);'],

        //---- the ticket ------------------------------------------------------

        //THE COMMAND LINE OUTLIVES THE INSTALL — VirtualBox writes it into
        //vboxpostinstall.sh in the machine's folder, where it stays.
        ['every machine is installed with the same ticket',
            '        var ticket = channel.newToken();',
            "        var ticket = 'shared';"],

        ['the ticket is not written down, so nothing can check it',
            '        ours.update(name, { installTicket: ticket });',
            ''],

        ['the machine is never told its ticket',
            "            + '?vm=' + encodeURIComponent(name) + '&ticket=' + ticket;",
            "            + '?vm=' + encodeURIComponent(name);"],

        //---- the flag --------------------------------------------------------

        //A 25-MINUTE INSTALL RUNNING WITH THE REGISTER SAYING NOTHING IS
        //HAPPENING is the state that makes the Runners tab lie.
        ['it is marked installing only after VirtualBox has finished being asked',
            "        ours.update(name, { installing: new Date().toISOString(), reported: null });",
            ''],

        //A MACHINE LEFT MARKED "installing" IS ONE NOTHING WILL START, install
        //or pick up, while the tab says it is busy doing something that stopped.
        ['a failed install leaves the machine marked as installing forever',
            '            ours.update(name, { installing: null });',
            ''],

        //---- the password ----------------------------------------------------

        //THE LOG IS KEPT AND READ LATER, so a secret reaching it is a secret
        //permanently written down.
        ['the field line VBoxManage echoes the password on is not redacted',
            "                if (/^\\s*(user-|admin-)?password\\s*=/.test(line)) line = line.replace(/=.*/, '= <hidden>');",
            ''],

        ['the password is left in every other line it appears in',
            "                secrets.forEach(function (s) { line = line.split(s).join('<hidden>'); });",
            ''],

        ['a failure carries the password out in its message',
            "            secrets.forEach(function (s) { why = why.split(s).join('<hidden>'); });",
            ''],

        //BLANKING A SHORT PASSWORD EVERYWHERE makes the log lie about names for
        //no security gain: "okc" turned okc-bootstrap.sh into <hidden>-bootstrap.sh.
        ['a password too short to be distinctive is blanked everywhere',
            '            return s && s.length >= 8 && name.indexOf(s) < 0;',
            '            return !!s;'],

        //---- watching it -----------------------------------------------------

        //A MACHINE THAT WILL NOT BUILD BECAUSE OF A LOGGING CONVENIENCE is the
        //wrong trade.
        ['a template that could not be built stops the install',
            "        if (!extra.file) {\n            to.warn(\"installing without the dashboard's autoinstall additions (\" + extra.why + ')'\n                + ' — the install will not be watchable over the serial port or ssh');",
            "        if (!extra.file) {\n            throw new Error(extra.why);"],

        ['a template that lost only its ssh half is thrown away',
            '        if (extra.file) args = args.concat([\'--script-template\', extra.file]);',
            ''],

        ['nothing is said when the install cannot be watched',
            "            to.warn(\"installing without the dashboard's autoinstall additions (\" + extra.why + ')'\n                + ' — the install will not be watchable over the serial port or ssh');",
            ''],

        ['nothing is said when the installer cannot be logged into',
            '        } else if (extra.lost) {\n            to.warn(extra.lost);\n        }',
            '        }']
    ]
};
